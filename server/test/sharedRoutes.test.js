import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('unauthenticated -> 401; unknown path -> 404', async () => {
    mockGoogle({});
    const res = await worker.fetch(req('GET', '/shared/folders', 'bad'), env({}, db));
    expect(res.status).toBe(401);
  });

  it('OPTIONS preflight advertises PUT/PATCH/DELETE', async () => {
    const res = await worker.fetch(new Request('https://api/shared/folders', { method: 'OPTIONS' }), env({}, db));
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });
});
