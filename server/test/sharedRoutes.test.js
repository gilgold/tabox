import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { makeDB } from './helpers/d1Mock.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
});
const PRO_RECORD = { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' };
const env = (kvStore, db) => ({ GOOGLE_CLIENT_ID: 'cid', JWT_SECRET: 's', ENTITLEMENTS: makeKV(kvStore), SHARED_DB: db });

// authenticate() calls Google tokeninfo then drive/about — mock both per identity token
function mockGoogle(identities) {
  globalThis.fetch = vi.fn(async (url, opts) => {
    const token = String(url).includes('tokeninfo')
      ? new URL(url).searchParams.get('access_token')
      : (opts?.headers?.Authorization || '').replace('Bearer ', '');
    const id = identities[token];
    if (!id) return { ok: false };
    if (String(url).includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
    return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
  });
}
const req = (method, path, token, body) => new Request(`https://api${path}`, {
  method, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
});

describe('/shared routes', () => {
  let db;
  beforeEach(() => {
    db = makeDB();
    mockGoogle({
      't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
      't-guest': { googleId: 'g-guest', email: 'guest@x.com' },
    });
  });

  it('POST /shared/folders requires Pro', async () => {
    const res = await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), env({}, db));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'pro_required' });
  });

  it('full happy path: create -> invite -> accept -> write -> delta', async () => {
    const e = env({ 'ent:g-owner': PRO_RECORD }, db);
    expect((await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [{ uid: 'c1', data: { name: 'A' } }] }), e)).status).toBe(200);
    expect((await worker.fetch(req('POST', '/shared/folders/f1/invites', 't-owner', { email: 'guest@x.com', role: 'write' }), e)).status).toBe(200);
    const invites = await (await worker.fetch(req('GET', '/shared/invites', 't-guest'), e)).json();
    expect(invites.invites).toHaveLength(1);
    const accept = await (await worker.fetch(req('POST', '/shared/invites/f1/respond', 't-guest', { accept: true }), e)).json();
    expect(accept.accepted).toBe(true);
    expect((await worker.fetch(req('PUT', '/shared/folders/f1/collections/c2', 't-guest', { data: { name: 'B' }, baseRev: 1 }), e)).status).toBe(200);
    const delta = await (await worker.fetch(req('GET', '/shared/folders/f1?sinceRev=1', 't-owner'), e)).json();
    expect(delta.collections).toHaveLength(1);
    expect(delta.collections[0].uid).toBe('c2');
    const members = await (await worker.fetch(req('GET', '/shared/folders/f1/members', 't-owner'), e)).json();
    expect(members.members[0]).toMatchObject({ email: 'guest@x.com', status: 'active' });
  });

  it('unauthenticated -> 401; authenticated unknown path -> 404', async () => {
    mockGoogle({});
    const unauth = await worker.fetch(req('GET', '/shared/folders', 'bad'), env({}, db));
    expect(unauth.status).toBe(401);

    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    const unknown = await worker.fetch(req('GET', '/shared/unknown', 't-owner'), env({}, db));
    expect(unknown.status).toBe(404);
  });

  it('OPTIONS preflight advertises PUT/PATCH/DELETE', async () => {
    const res = await worker.fetch(new Request('https://api/shared/folders', { method: 'OPTIONS' }), env({}, db));
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });

  describe('body-size guard', () => {
    it('413 payload_too_large when Content-Length header exceeds 1MB', async () => {
      const e = env({ 'ent:g-owner': PRO_RECORD }, db);
      const res = await worker.fetch(new Request('https://api/shared/folders', {
        method: 'POST',
        headers: { Authorization: 'Bearer t-owner', 'Content-Length': String(2_000_000) },
        body: JSON.stringify({ folderId: 'f1', name: 'T', collections: [] }),
      }), e);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'payload_too_large' });
    });

    it('413 payload_too_large when the real body text exceeds 1MB despite an absent/fake Content-Length', async () => {
      const e = env({ 'ent:g-owner': PRO_RECORD }, db);
      const oversized = 'x'.repeat(1_048_577);
      const request = new Request('https://api/shared/folders', {
        method: 'POST',
        headers: { Authorization: 'Bearer t-owner' },
        body: oversized,
      });
      // Requests built from a string body don't populate a Content-Length header
      // (verified: request.headers.get('content-length') is null here), so this
      // exercises the real-byte-count guard inside body(), not the header fast path.
      expect(request.headers.get('content-length')).toBeNull();
      const res = await worker.fetch(request, e);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'payload_too_large' });
    });
  });

  describe('rate limiting', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('429 rate_limited when the writes bucket is already at the limit', async () => {
      const fixedNow = Date.parse('2026-01-01T00:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);
      const windowStart = Math.floor(fixedNow / 1000 / 60);
      const e = env({ 'ent:g-owner': PRO_RECORD, [`rl:g-owner:writes:${windowStart}`]: 120 }, db);
      const res = await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [] }), e);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: 'rate_limited' });
    });
  });

  describe('internal error boundary', () => {
    it('500 internal_error (with CORS header) when stored collection data is corrupted JSON', async () => {
      const nowMs = Date.now();
      db._raw.prepare(
        'INSERT INTO shared_folders (id, owner_google_id, owner_email, name, color, revision, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run('f-corrupt', 'g-owner', 'owner@x.com', 'Corrupt', null, 1, nowMs, nowMs, 'owner@x.com');
      db._raw.prepare(
        'INSERT INTO shared_collections (folder_id, uid, data, rev, deleted, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)'
      ).run('f-corrupt', 'c1', '{not valid json', 1, 0, nowMs, 'owner@x.com');

      const res = await worker.fetch(req('GET', '/shared/folders/f-corrupt', 't-owner'), env({}, db));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'internal_error' });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});
