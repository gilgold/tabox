import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto, createHmac, createDecipheriv } from 'node:crypto';
import { makeDB } from './helpers/d1Mock.js';
import { sendWebPush, notifyEmails, notifyFolderMembers } from '../src/pushNotify.js';

const subtle = webcrypto.subtle;

// ---------------------------------------------------------------------------
// helpers: base64url, HKDF (independent impl via node HMAC), RFC 8291 decrypt
// ---------------------------------------------------------------------------

function b64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// HKDF-SHA256 with a single output block (all uses here are <= 32 bytes).
function hkdf(salt, ikm, info, length) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const okm = createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
    .digest();
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
    sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: b64u(publicRaw), auth: b64u(authSecret) },
  };
}

async function makeVapidEnv() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = Buffer.from(await subtle.exportKey('raw', pair.publicKey));
  return {
    env: {
      VAPID_PRIVATE_KEY: JSON.stringify(privateJwk),
      VAPID_PUBLIC_KEY: b64u(publicRaw),
      VAPID_SUBJECT: 'mailto:support@tabox.co',
    },
    publicRaw,
  };
}

// Full RFC 8291 receiver-side decryption, implemented independently of src.
async function decryptWebPush(bodyBuf, ua) {
  const body = Buffer.from(bodyBuf);
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
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
  let record = Buffer.concat([decipher.update(data), decipher.final()]);

  // Strip zero padding then the 0x02 (last-record) delimiter.
  let end = record.length;
  while (end > 0 && record[end - 1] === 0x00) end -= 1;
  const delim = record[end - 1];
  if (delim !== 0x02) throw new Error(`bad pad delimiter: ${delim}`);
  return { plaintext: record.subarray(0, end - 1).toString('utf8'), rs, asPublicLength: idlen };
}

async function verifyVapidJwt(token, publicRaw) {
  const [h, c, s] = token.split('.');
  const key = await subtle.importKey('raw', publicRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(s), Buffer.from(`${h}.${c}`, 'utf8'));
  return { ok, header: JSON.parse(unb64u(h).toString('utf8')), claims: JSON.parse(unb64u(c).toString('utf8')) };
}

function makePushDB() {
  const db = makeDB();
  return db;
}

function addSub(db, endpoint, email, ua) {
  db._raw.prepare('INSERT INTO push_subscriptions (endpoint, user_email, p256dh, auth, created_at) VALUES (?,?,?,?,?)')
    .run(endpoint, email, ua.sub.p256dh, ua.sub.auth, 1000);
}

function subCount(db, endpoint) {
  return db._raw.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?').get(endpoint).n;
}

// ---------------------------------------------------------------------------

let vapid;
let ua;
let fetchMock;

beforeEach(async () => {
  vapid = await makeVapidEnv();
  ua = await makeUaKeys();
  fetchMock = vi.fn(async () => ({ status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendWebPush', () => {
  it('POSTs to the endpoint with aes128gcm/TTL/Urgency/vapid headers', async () => {
    const status = await sendWebPush(vapid.env, ua.sub, { type: 'tickle' });
    expect(status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ua.sub.endpoint);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Encoding']).toBe('aes128gcm');
    expect(init.headers['Content-Type']).toBe('application/octet-stream');
    expect(init.headers.TTL).toBe('60');
    expect(init.headers.Urgency).toBe('normal');
    expect(init.headers.Authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.env.VAPID_PUBLIC_KEY}$`));
    expect(init.body).toBeInstanceOf(Uint8Array);
  });

  it('signs a VAPID JWT that verifies with ES256 and carries aud/sub/exp', async () => {
    await sendWebPush(vapid.env, ua.sub, { type: 'tickle' });
    const auth = fetchMock.mock.calls[0][1].headers.Authorization;
    const token = auth.slice('vapid t='.length, auth.indexOf(', k='));
    const { ok, header, claims } = await verifyVapidJwt(token, vapid.publicRaw);
    expect(ok).toBe(true);
    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:support@tabox.co');
    const now = Math.floor(Date.now() / 1000);
    expect(claims.exp).toBeGreaterThan(now);
    expect(claims.exp).toBeLessThanOrEqual(now + 24 * 3600);
  });

  it('encrypts a body the UA can decrypt back to the exact JSON payload (RFC 8291)', async () => {
    const payload = { type: 'shared-folder-updated', folderId: 'f1', n: 42 };
    await sendWebPush(vapid.env, ua.sub, payload);
    const body = fetchMock.mock.calls[0][1].body;
    const { plaintext, rs, asPublicLength } = await decryptWebPush(body, ua);
    expect(asPublicLength).toBe(65);
    expect(rs).toBe(4096);
    expect(JSON.parse(plaintext)).toEqual(payload);
    expect(plaintext).toBe(JSON.stringify(payload));
  });

  it('uses a fresh salt and ephemeral key per send', async () => {
    await sendWebPush(vapid.env, ua.sub, { a: 1 });
    await sendWebPush(vapid.env, ua.sub, { a: 1 });
    const [b1, b2] = fetchMock.mock.calls.map((c) => Buffer.from(c[1].body));
    expect(b1.subarray(0, 16).equals(b2.subarray(0, 16))).toBe(false);
    expect(b1.subarray(21, 86).equals(b2.subarray(21, 86))).toBe(false);
  });
});

describe('notifyEmails', () => {
  it('deletes the subscription row on 410 and keeps it on 201', async () => {
    const db = makePushDB();
    const ua2 = await makeUaKeys();
    addSub(db, 'https://push.example.com/gone', 'a@x.com', ua);
    addSub(db, 'https://push.example.com/alive', 'b@x.com', ua2);
    fetchMock.mockImplementation(async (url) => ({ status: url.endsWith('/gone') ? 410 : 201 }));

    await notifyEmails(vapid.env, db, ['A@x.com', 'b@x.com'], { type: 'tickle' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(subCount(db, 'https://push.example.com/gone')).toBe(0);
    expect(subCount(db, 'https://push.example.com/alive')).toBe(1);
  });

  it('deletes the subscription row on 404', async () => {
    const db = makePushDB();
    addSub(db, 'https://push.example.com/missing', 'a@x.com', ua);
    fetchMock.mockResolvedValue({ status: 404 });
    await notifyEmails(vapid.env, db, ['a@x.com'], { type: 'tickle' });
    expect(subCount(db, 'https://push.example.com/missing')).toBe(0);
  });

  it('swallows a network error and still attempts the other recipients', async () => {
    const db = makePushDB();
    const ua2 = await makeUaKeys();
    addSub(db, 'https://push.example.com/boom', 'a@x.com', ua);
    addSub(db, 'https://push.example.com/ok', 'b@x.com', ua2);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/boom')) throw new Error('network down');
      return { status: 201 };
    });

    await expect(notifyEmails(vapid.env, db, ['a@x.com', 'b@x.com'], { type: 'tickle' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://push.example.com/boom', 'https://push.example.com/ok',
    ]);
    expect(subCount(db, 'https://push.example.com/boom')).toBe(1);
  });

  it('does nothing when there are no emails', async () => {
    const db = makePushDB();
    await notifyEmails(vapid.env, db, [null, '', undefined], { type: 'tickle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('notifyFolderMembers', () => {
  async function seedFolder(db) {
    db._raw.prepare(`INSERT INTO shared_folders
      (id, owner_google_id, owner_email, name, revision, created_at, updated_at, updated_by)
      VALUES ('f1','g-a','a@x.com','Team',1,1,1,'a@x.com')`).run();
    const ins = db._raw.prepare(`INSERT INTO shared_members
      (folder_id, email, google_id, role, status, invited_at) VALUES ('f1',?,?,?,?,1)`);
    ins.run('a@x.com', 'g-a', 'write', 'active');
    ins.run('b@x.com', 'g-b', 'write', 'active');
    ins.run('c@x.com', 'g-c', 'read', 'active');
    ins.run('d@x.com', null, 'read', 'invited');
    ins.run('e@x.com', null, 'read', 'declined');
    for (const email of ['a', 'b', 'c', 'd', 'e', 'f']) {
      addSub(db, `https://push.example.com/${email}`, `${email}@x.com`, await makeUaKeys());
    }
  }

  it('pushes to active members only, excluding the actor', async () => {
    const db = makePushDB();
    await seedFolder(db);
    await notifyFolderMembers(vapid.env, db, 'f1', { exceptEmail: 'A@x.com', payload: { type: 'tickle' } });
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://push.example.com/b', 'https://push.example.com/c',
    ]);
  });

  it('unions extraEmails into the recipient set', async () => {
    const db = makePushDB();
    await seedFolder(db);
    await notifyFolderMembers(vapid.env, db, 'f1', {
      exceptEmail: 'a@x.com', payload: { type: 'tickle' }, extraEmails: ['f@x.com'],
    });
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://push.example.com/b', 'https://push.example.com/c', 'https://push.example.com/f',
    ]);
  });

  it('never throws when the folder does not exist', async () => {
    const db = makePushDB();
    await expect(notifyFolderMembers(vapid.env, db, 'nope', { payload: { type: 'tickle' } })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
