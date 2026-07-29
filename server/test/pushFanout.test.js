import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webcrypto, createHmac, createDecipheriv } from 'node:crypto';
import worker from '../src/index.js';
import { makeDB } from './helpers/d1Mock.js';

const subtle = webcrypto.subtle;

// ---------------------------------------------------------------------------
// RFC 8291 decrypt helper, adapted from test/pushNotify.test.js, needed to
// assert the invite payload decrypts to {invite:true} (test 3).
// ---------------------------------------------------------------------------

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function hkdf(salt, ikm, info, length) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const okm = createHmac('sha256', prk).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();
  return okm.subarray(0, length);
}
async function makeUaKeys() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = Buffer.from(await subtle.exportKey('raw', pair.publicKey));
  const authSecret = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16)));
  return {
    privateKey: pair.privateKey,
    publicRaw,
    authSecret,
    p256dh: b64u(publicRaw),
    auth: b64u(authSecret),
  };
}
async function decryptWebPush(bodyBuf, ua) {
  const body = Buffer.from(bodyBuf);
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = Buffer.from(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const info = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), ua.publicRaw, asPublic]);
  const ikm = hkdf(ua.authSecret, ecdhSecret, info, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(data), decipher.final()]);
  let end = record.length;
  while (end > 0 && record[end - 1] === 0x00) end -= 1;
  return record.subarray(0, end - 1).toString('utf8');
}

async function makeVapidEnv() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = Buffer.from(await subtle.exportKey('raw', pair.publicKey));
  return {
    VAPID_PRIVATE_KEY: JSON.stringify(privateJwk),
    VAPID_PUBLIC_KEY: b64u(publicRaw),
    VAPID_SUBJECT: 'mailto:support@tabox.co',
  };
}

// ---------------------------------------------------------------------------
// Worker plumbing: auth mock (as in sharedRoutes.test.js) + push-send capture
// on the SAME global fetch mock, routed by URL shape.
// ---------------------------------------------------------------------------

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
});
const PRO_RECORD = { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' };
const req = (method, path, token, body) => new Request(`https://api${path}`, {
  method, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
});

let pushSends;

function mockFetch(identities) {
  pushSends = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.includes('tokeninfo') || u.includes('googleapis.com/drive')) {
      const token = u.includes('tokeninfo')
        ? new URL(u).searchParams.get('access_token')
        : (opts?.headers?.Authorization || '').replace('Bearer ', '');
      const id = identities[token];
      if (!id) return { ok: false };
      if (u.includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
      return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
    }
    // Web Push send: capture endpoint + raw body for optional decryption.
    pushSends.push({ endpoint: u, body: opts.body });
    return { status: 201 };
  });
}

async function env(db, vapid, kvStore = {}) {
  return {
    GOOGLE_CLIENT_ID: 'cid', JWT_SECRET: 's', ENTITLEMENTS: makeKV(kvStore), SHARED_DB: db,
    ...vapid,
  };
}

function addSub(db, endpoint, email, ua) {
  db._raw.prepare('INSERT INTO push_subscriptions (endpoint, user_email, p256dh, auth, created_at) VALUES (?,?,?,?,?)')
    .run(endpoint, email, ua.p256dh, ua.auth, 1000);
}

function makeCtx() {
  const promises = [];
  return { ctx: { waitUntil: (p) => promises.push(p) }, flush: () => Promise.all(promises) };
}

describe('push tickle fan-out on shared-folder mutations', () => {
  let db;
  let vapid;
  let uaA;
  let uaB;

  beforeEach(async () => {
    db = makeDB();
    vapid = await makeVapidEnv();
    uaA = await makeUaKeys();
    uaB = await makeUaKeys();
    mockFetch({
      't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
      't-guest': { googleId: 'g-guest', email: 'guest@x.com' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('1: PUT collection by member A sends pushes to the owner, member B, AND member A themselves', async () => {
    // Same-account multi-device fix: the acting member's own OTHER devices
    // need the tickle too, so the actor is no longer excluded from the
    // fan-out. This also pins the owner-union fix: the owner has no
    // shared_members row at all, only shared_folders.owner_email, yet must
    // still receive the tickle.
    const uaOwner = await makeUaKeys();
    const identities = {
      't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
      't-a': { googleId: 'g-a', email: 'a@x.com' },
      't-b': { googleId: 'g-b', email: 'b@x.com' },
    };
    mockFetch(identities);
    const e = await env(db, vapid, {
      'ent:g-owner': PRO_RECORD, 'ent:g-a': PRO_RECORD, 'ent:g-b': PRO_RECORD,
    });
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
    await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'a@x.com', role: 'write' }), e);
    await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-a', { accept: true }), e);
    await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'b@x.com', role: 'write' }), e);
    await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-b', { accept: true }), e);
    addSub(db, 'https://push.example.com/owner', 'owner@x.com', uaOwner);
    addSub(db, 'https://push.example.com/a', 'a@x.com', uaA);
    addSub(db, 'https://push.example.com/b', 'b@x.com', uaB);

    const { ctx, flush } = makeCtx();
    // Actor is member A (an active member, not the owner).
    const res = await worker.fetch(req('PUT', '/shared/folders/f1/collections/c1', 't-a', { data: { name: 'A' } }), e, ctx);
    expect(res.status).toBe(200);
    await flush();

    const endpoints = pushSends.map((p) => p.endpoint).sort();
    expect(endpoints).toEqual([
      'https://push.example.com/a', 'https://push.example.com/b', 'https://push.example.com/owner',
    ]);
  });

  it('2: failed mutation (stale baseRev conflict) sends zero pushes', async () => {
    const e = await env(db, vapid, { 'ent:g-owner': PRO_RECORD, 'ent:g-guest': PRO_RECORD });
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
    await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'guest@x.com', role: 'write' }), e);
    await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-guest', { accept: true }), e);
    addSub(db, 'https://push.example.com/guest', 'guest@x.com', uaB);
    // First write establishes rev=2 for c1.
    await worker.fetch(req('PUT', '/shared/folders/f1/collections/c1', 't-owner', { data: { name: 'A' } }), e);

    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(
      req('PUT', '/shared/folders/f1/collections/c1', 't-owner', { data: { name: 'B' }, baseRev: 1 }), e, ctx,
    );
    expect(res.status).toBe(409);
    await flush();
    expect(pushSends).toHaveLength(0);
  });

  it('3: invite POST pushes to the invited email, payload decrypts to {invite:true}', async () => {
    const e = await env(db, vapid, { 'ent:g-owner': PRO_RECORD });
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
    addSub(db, 'https://push.example.com/guest', 'guest@x.com', uaB);

    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(
      req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'guest@x.com', role: 'write' }), e, ctx,
    );
    expect(res.status).toBe(200);
    await flush();

    expect(pushSends).toHaveLength(1);
    expect(pushSends[0].endpoint).toBe('https://push.example.com/guest');
    const plaintext = await decryptWebPush(pushSends[0].body, uaB);
    expect(JSON.parse(plaintext)).toEqual({ invite: true });
  });

  it('4: member DELETE pushes to remaining members (incl. the acting owner) AND the removed member', async () => {
    const e = await env(db, vapid, { 'ent:g-owner': PRO_RECORD, 'ent:g-guest': PRO_RECORD });
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
    await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'guest@x.com', role: 'write' }), e);
    await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-guest', { accept: true }), e);
    addSub(db, 'https://push.example.com/owner', 'owner@x.com', uaA);
    addSub(db, 'https://push.example.com/guest', 'guest@x.com', uaB);

    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(
      req('DELETE', '/shared/folders/f1/members/guest%40x.com', 't-owner'), e, ctx,
    );
    expect(res.status).toBe(200);
    await flush();

    // The acting owner's own other devices are tickled too (same-account
    // multi-device fix); the removed guest is added in via extraEmails so
    // their devices learn the revocation promptly.
    const endpoints = pushSends.map((p) => p.endpoint).sort();
    expect(endpoints).toEqual(['https://push.example.com/guest', 'https://push.example.com/owner']);
  });

  it('5: folder DELETE pushes reach members that existed before deletion', async () => {
    const e = await env(db, vapid, { 'ent:g-owner': PRO_RECORD, 'ent:g-guest': PRO_RECORD });
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
    await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'guest@x.com', role: 'write' }), e);
    await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-guest', { accept: true }), e);
    addSub(db, 'https://push.example.com/owner', 'owner@x.com', uaA);
    addSub(db, 'https://push.example.com/guest', 'guest@x.com', uaB);

    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(req('DELETE', '/shared/folders/f1', 't-owner'), e, ctx);
    expect(res.status).toBe(200);
    await flush();

    // The acting owner's own other devices are tickled too (same-account
    // multi-device fix) so they drop the deleted folder live.
    const endpoints = pushSends.map((p) => p.endpoint).sort();
    expect(endpoints).toEqual(['https://push.example.com/guest', 'https://push.example.com/owner']);
  });

  it('6: mutation still returns 200 even when the push service itself returns 500', async () => {
    const e = await env(db, vapid, { 'ent:g-owner': PRO_RECORD, 'ent:g-guest': PRO_RECORD });
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
    await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'guest@x.com', role: 'write' }), e);
    await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-guest', { accept: true }), e);
    addSub(db, 'https://push.example.com/guest', 'guest@x.com', uaB);
    const pushAttempts = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u.includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
      if (u.includes('googleapis.com/drive')) {
        const token = (opts?.headers?.Authorization || '').replace('Bearer ', '');
        const id = { 't-owner': { googleId: 'g-owner', email: 'owner@x.com' }, 't-guest': { googleId: 'g-guest', email: 'guest@x.com' } }[token];
        return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
      }
      pushAttempts.push(u);
      return { status: 500 };
    });

    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(
      req('PUT', '/shared/folders/f1/collections/c1', 't-owner', { data: { name: 'A' } }), e, ctx,
    );
    expect(res.status).toBe(200);
    await expect(flush()).resolves.toBeDefined();
    // Must actually prove a send was attempted (and to the right recipient) —
    // otherwise a broken/no-op tickle would vacuously pass this test too.
    expect(pushAttempts).toEqual(['https://push.example.com/guest']);
  });
});
