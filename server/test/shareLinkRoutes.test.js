import { describe, it, expect, beforeEach, vi } from 'vitest';
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
const req = (method, path, token, body, headers = {}) => new Request(`https://api${path}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

describe('share-link routes', () => {
  let db;
  beforeEach(() => {
    db = makeDB();
    mockGoogle({
      't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
      't-guest': { googleId: 'g-guest', email: 'guest@x.com' },
    });
  });

  it('folder link lifecycle over HTTP, Pro-gated on create only', async () => {
    const e = env({ 'ent:g-owner': PRO_RECORD }, db);
    await worker.fetch(req('POST', '/shared/folders', 't-owner', { folderId: 'f1', name: 'T', collections: [{ uid: 'c1', data: { name: 'A' } }] }), e);
    const noPro = env({}, db);
    // same db, owner without entitlement record -> pro_required
    expect((await worker.fetch(req('POST', '/shared/folders/f1/link', 't-owner', { role: 'read' }), noPro)).status).toBe(403);
    const create = await worker.fetch(req('POST', '/shared/folders/f1/link', 't-owner', { role: 'read' }), e);
    expect(create.status).toBe(200);
    const { token, url } = await create.json();
    expect(url).toBe(`https://api/join/${token}`);
    // guest (never Pro) joins
    const join = await worker.fetch(req('POST', '/shared/join-link', 't-guest', { token }), e);
    expect(join.status).toBe(200);
    expect((await join.json()).folder.folderId).toBe('f1');
    // get + delete
    expect((await (await worker.fetch(req('GET', '/shared/folders/f1/link', 't-owner'), e)).json()).link.token).toBe(token);
    expect((await worker.fetch(req('DELETE', '/shared/folders/f1/link', 't-owner'), e)).status).toBe(200);
    expect((await (await worker.fetch(req('GET', '/shared/folders/f1/link', 't-owner'), e)).json()).link).toBe(null);
  });

  it('collection link lifecycle over HTTP', async () => {
    const e = env({ 'ent:g-owner': PRO_RECORD }, db);
    expect((await worker.fetch(req('PUT', '/shared/collection-link', 't-guest', { uid: 'c1', name: 'R', data: { name: 'R', tabs: [] } }), e)).status).toBe(403);
    const put = await worker.fetch(req('PUT', '/shared/collection-link', 't-owner', { uid: 'c1', name: 'R', data: { name: 'R', tabs: [] } }), e);
    expect(put.status).toBe(200);
    const { token, url } = await put.json();
    expect(url).toBe(`https://api/join/${token}`);
    const list = await (await worker.fetch(req('GET', '/shared/collection-links', 't-owner'), e)).json();
    expect(list.links[0]).toMatchObject({ uid: 'c1', url });
    expect((await worker.fetch(req('DELETE', '/shared/collection-link/c1', 't-owner'), e)).status).toBe(200);
  });

  it('public GET /links/:token needs no auth and rate-limits by IP', async () => {
    const e = env({ 'ent:g-owner': PRO_RECORD }, db);
    const put = await worker.fetch(req('PUT', '/shared/collection-link', 't-owner', { uid: 'c1', name: 'R', data: { name: 'R', tabs: [{ url: 'https://a.com' }] } }), e);
    const { token } = await put.json();
    const pub = await worker.fetch(req('GET', `/links/${token}`, null, null, { 'CF-Connecting-IP': '1.2.3.4' }), e);
    expect(pub.status).toBe(200);
    expect(await pub.json()).toMatchObject({ kind: 'collection', name: 'R', tabCount: 1 });
    expect((await worker.fetch(req('GET', '/links/unknown', null, null, { 'CF-Connecting-IP': '1.2.3.4' }), e)).status).toBe(404);
    let lastStatus = 200;
    for (let i = 0; i < 31; i += 1) {
      lastStatus = (await worker.fetch(req('GET', `/links/${token}`, null, null, { 'CF-Connecting-IP': '9.9.9.9' }), e)).status;
    }
    expect(lastStatus).toBe(429);
  });
});
