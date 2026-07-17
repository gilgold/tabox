// Adversarial probes for conflict resolution & edge cases around shared folders.
// Confirmed bugs are NOT locked in here (see .superpowers/sdd/adversarial-backend-report.md) —
// this file only contains tests for behavior confirmed correct or acceptable-by-design.
import { describe, it, expect, vi } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import worker from '../src/index.js';
import {
  createSharedFolder, inviteMember, respondInvite,
  getFolderDelta, putCollection, deleteCollection, updateFolderMeta,
  updateMemberRole, removeMember, deleteSharedFolder,
  requireFolderAccess, MAX_MEMBERS_PER_FOLDER, MAX_COLLECTION_BYTES,
} from '../src/sharedFolders.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const WRITER = { googleId: 'g-w', email: 'w@x.com' };
const READER = { googleId: 'g-r', email: 'r@x.com' };

async function seed() {
  const db = makeDB();
  await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [{ uid: 'c1', data: { name: 'A' } }] }, 1000);
  await inviteMember(db, OWNER, 'f1', { email: 'w@x.com', role: 'write' }, 1000);
  await inviteMember(db, OWNER, 'f1', { email: 'r@x.com', role: 'read' }, 1000);
  await respondInvite(db, WRITER, 'f1', true, 1001);
  await respondInvite(db, READER, 'f1', true, 1001);
  return db;
}

describe('revision protocol edges', () => {
  it('baseRev equal to current rev succeeds', async () => {
    const db = await seed();
    expect(await putCollection(db, WRITER, 'f1', 'c1', { data: { v: 1 }, baseRev: 1 }, 2000))
      .toEqual({ ok: true, data: { revision: 2 } });
  });

  it('baseRev strictly greater than current rev is accepted (no distinct signal for an impossible client state)', async () => {
    // Surprising-but-acceptable: the conflict check is `row.rev > baseRev`, so a baseRev the
    // client could never legitimately have (ahead of the server) is treated the same as "not stale".
    const db = await seed();
    expect(await putCollection(db, WRITER, 'f1', 'c1', { data: { v: 1 }, baseRev: 999 }, 2000))
      .toEqual({ ok: true, data: { revision: 2 } });
  });

  it('baseRev 0 / -1 / null against an existing row are all treated as maximally stale -> conflict', async () => {
    for (const baseRev of [0, -1, null]) {
      const db = await seed();
      await putCollection(db, OWNER, 'f1', 'c1', { data: { v: 'server' }, baseRev: 1 }, 1500); // rev -> 2
      expect(await putCollection(db, WRITER, 'f1', 'c1', { data: { v: 1 }, baseRev }, 2000))
        .toEqual({ ok: false, status: 409, error: 'conflict' });
    }
  });

  it('new-uid insert ignores baseRev entirely (no prior row to conflict with)', async () => {
    const db = await seed();
    expect(await putCollection(db, WRITER, 'f1', 'brand-new-uid', { data: { v: 1 }, baseRev: 0 }, 2000))
      .toEqual({ ok: true, data: { revision: 2 } });
  });

  it('100 sequential alternating writes on one uid keep revision strictly monotonic', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [{ uid: 'c1', data: { v: 0 } }] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'w@x.com', role: 'write' }, 1000);
    await respondInvite(db, WRITER, 'f1', true, 1001);
    let lastRev = 1;
    for (let i = 0; i < 100; i++) {
      const who = i % 2 === 0 ? OWNER : WRITER;
      const res = await putCollection(db, who, 'f1', 'c1', { data: { v: i }, baseRev: lastRev }, 2000 + i);
      expect(res.ok).toBe(true);
      expect(res.data.revision).toBe(lastRev + 1);
      lastRev = res.data.revision;
    }
    expect(lastRev).toBe(101);
  });

  it('getFolderDelta sinceRev tolerates negative/huge/fractional/non-numeric values', async () => {
    const db = await seed();
    await putCollection(db, WRITER, 'f1', 'c2', { data: { v: 1 }, baseRev: 1 }, 2000); // rev -> 2
    expect((await getFolderDelta(db, OWNER, 'f1', -5)).data.collections).toHaveLength(2); // negative behaves like 0
    expect((await getFolderDelta(db, OWNER, 'f1', 1e15)).data.collections).toHaveLength(0); // huge -> nothing newer
    expect((await getFolderDelta(db, OWNER, 'f1', 1.5)).data.collections.map((c) => c.rev)).toEqual([2]); // fractional is honored literally
    expect((await getFolderDelta(db, OWNER, 'f1', 'abc')).data.collections).toHaveLength(2); // non-numeric defaults to 0
  });
});

describe('tombstone resurrection', () => {
  it('delete then put the same uid resurrects it with correct baseRev, still conflicts on stale baseRev', async () => {
    const db = await seed();
    const del = await deleteCollection(db, WRITER, 'f1', 'c1', 2000); // rev -> 2, tombstoned
    expect(del).toEqual({ ok: true, data: { revision: 2 } });
    expect(await putCollection(db, OWNER, 'f1', 'c1', { data: { v: 'resurrected' }, baseRev: 2 }, 2001))
      .toEqual({ ok: true, data: { revision: 3 } });
    // A second writer who never saw the delete (still thinks baseRev 1) correctly conflicts
    const fresh = await seed();
    await deleteCollection(fresh, WRITER, 'f1', 'c1', 2000);
    expect(await putCollection(fresh, OWNER, 'f1', 'c1', { data: { v: 'x' }, baseRev: 1 }, 2002))
      .toEqual({ ok: false, status: 409, error: 'conflict' });
  });

  it('put-then-delete of a freshly created uid produces a proper tombstone (data:null, deleted:1) in the delta', async () => {
    const db = await seed();
    await putCollection(db, WRITER, 'f1', 'c-new', { data: { v: 1 }, baseRev: 1 }, 2000);
    await deleteCollection(db, WRITER, 'f1', 'c-new', 2001);
    const delta = await getFolderDelta(db, OWNER, 'f1', 1);
    expect(delta.data.collections).toEqual([
      { uid: 'c-new', data: null, rev: 3, deleted: 1, updatedBy: 'w@x.com', updatedAt: 2001 },
    ]);
  });

  it('deleting a uid that was never created still succeeds, inserting a fresh tombstone (idempotent-delete semantics)', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    const res = await deleteCollection(db, OWNER, 'f1', 'never-existed', 2000);
    expect(res).toEqual({ ok: true, data: { revision: 2 } });
    const delta = await getFolderDelta(db, OWNER, 'f1', 0);
    expect(delta.data.collections).toEqual([
      { uid: 'never-existed', data: null, rev: 2, deleted: 1, updatedBy: 'owner@x.com', updatedAt: 2000 },
    ]);
  });

  it('deleteCollection has no baseRev/conflict check at all: a stale writer can blindly delete over a newer, unseen write', async () => {
    // Surprising-but-acceptable: unlike putCollection, deleteCollection accepts no baseRev,
    // so it can never return 409. A write-role member who last saw rev 1 can delete a
    // collection that has since been updated to rev 2 by someone else, with no warning.
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [{ uid: 'c1', data: { v: 'orig' } }] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'w@x.com', role: 'write' }, 1000);
    await respondInvite(db, WRITER, 'f1', true, 1001);
    await putCollection(db, OWNER, 'f1', 'c1', { data: { v: 'updated-by-owner' }, baseRev: 1 }, 1500); // rev -> 2
    const del = await deleteCollection(db, WRITER, 'f1', 'c1', 2000);
    expect(del).toEqual({ ok: true, data: { revision: 3 } });
    const delta = await getFolderDelta(db, OWNER, 'f1', 0);
    expect(delta.data.collections.find((c) => c.uid === 'c1')).toMatchObject({ deleted: 1, data: null });
  });
});

describe('updateFolderMeta null/empty semantics', () => {
  it('name: null is a no-op (preserves existing name); color: null actively clears color', async () => {
    // Surprising-but-acceptable asymmetry: name uses `??` (null falls back to existing),
    // color uses a strict `=== undefined` check (only undefined falls back; null clears it).
    const db1 = await seed();
    await updateFolderMeta(db1, OWNER, 'f1', { name: null }, 2000);
    expect((await getFolderDelta(db1, OWNER, 'f1', 0)).data.folder.name).toBe('Team');

    const db2 = await seed();
    await updateFolderMeta(db2, OWNER, 'f1', { color: null }, 2000);
    expect((await getFolderDelta(db2, OWNER, 'f1', 0)).data.folder.color).toBeNull();
  });

  it('an empty-body PATCH still bumps the revision even though nothing actually changed', async () => {
    const db = await seed();
    const before = await getFolderDelta(db, OWNER, 'f1', 0);
    const res = await updateFolderMeta(db, OWNER, 'f1', {}, 2000);
    expect(res.data.revision).toBe(before.data.revision + 1);
  });
});

describe('invite/membership races (sequential simulation)', () => {
  it('invite -> revoke -> respondInvite: stale accept after revoke is rejected', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'g@x.com', role: 'read' }, 1000);
    await removeMember(db, OWNER, 'f1', 'g@x.com', 1500);
    expect(await respondInvite(db, { googleId: 'gg', email: 'g@x.com' }, 'f1', true, 2000))
      .toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('respondInvite accept twice: second call 404s (no longer an "invited" row)', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'g@x.com', role: 'read' }, 1000);
    const G = { googleId: 'gg', email: 'g@x.com' };
    expect((await respondInvite(db, G, 'f1', true, 2000)).ok).toBe(true);
    expect(await respondInvite(db, G, 'f1', true, 2001)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('owner deletes the share between invite and accept: cascade removes the invite too', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'g@x.com', role: 'read' }, 1000);
    await deleteSharedFolder(db, OWNER, 'f1');
    expect(await respondInvite(db, { googleId: 'gg', email: 'g@x.com' }, 'f1', true, 2000))
      .toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('updateMemberRole works on an invited-but-not-yet-accepted member (owner can pre-set the role)', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'g@x.com', role: 'read' }, 1000);
    const res = await updateMemberRole(db, OWNER, 'f1', 'g@x.com', 'write', 1500);
    expect(res.ok).toBe(true);
    expect(res.data.members[0]).toMatchObject({ email: 'g@x.com', role: 'write', status: 'invited' });
  });

  it('removeMember cancels an invited (not yet accepted) member', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    await inviteMember(db, OWNER, 'f1', { email: 'g@x.com', role: 'read' }, 1000);
    expect(await removeMember(db, OWNER, 'f1', 'g@x.com', 1500)).toEqual({ ok: true, data: { members: [] } });
  });

  it('re-invite at exactly the cap boundary: a declined member does not count, so the 20th non-declined invite succeeds and the 21st is blocked', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    for (let i = 0; i < 19; i++) {
      await inviteMember(db, OWNER, 'f1', { email: `active${i}@x.com`, role: 'read' }, 1000);
    }
    await inviteMember(db, OWNER, 'f1', { email: 'declined@x.com', role: 'read' }, 1000);
    await respondInvite(db, { googleId: 'gd', email: 'declined@x.com' }, 'f1', false, 1100);
    // 19 non-declined + 1 declined; count(status != declined) === 19 < MAX_MEMBERS_PER_FOLDER
    const res20 = await inviteMember(db, OWNER, 'f1', { email: 'new20@x.com', role: 'read' }, 1200);
    expect(res20.ok).toBe(true);
    expect(res20.data.members.filter((m) => m.status !== 'declined')).toHaveLength(MAX_MEMBERS_PER_FOLDER);
    expect(await inviteMember(db, OWNER, 'f1', { email: 'new21@x.com', role: 'read' }, 1300))
      .toEqual({ ok: false, status: 409, error: 'member_limit' });
  });

  it('two folders, same member email, different roles - fully isolated per folder', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'fA', name: 'A', collections: [] }, 1000);
    await createSharedFolder(db, OWNER, { folderId: 'fB', name: 'B', collections: [] }, 1000);
    await inviteMember(db, OWNER, 'fA', { email: 'g@x.com', role: 'read' }, 1000);
    await inviteMember(db, OWNER, 'fB', { email: 'g@x.com', role: 'write' }, 1000);
    const G = { googleId: 'gg', email: 'g@x.com' };
    await respondInvite(db, G, 'fA', true, 1100);
    await respondInvite(db, G, 'fB', true, 1100);
    expect(await putCollection(db, G, 'fA', 'x', { data: {}, baseRev: 1 }, 1200))
      .toEqual({ ok: false, status: 403, error: 'forbidden' });
    expect(await putCollection(db, G, 'fB', 'x', { data: {}, baseRev: 1 }, 1200))
      .toEqual({ ok: true, data: { revision: 2 } });
  });
});

describe('input hostility', () => {
  it('collection data exactly at the 512KB boundary succeeds; one byte over is rejected', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    const overhead = '{"blob":"'.length + '"}'.length;
    const blobLenExact = MAX_COLLECTION_BYTES - overhead;
    const dataExact = { blob: 'x'.repeat(blobLenExact) };
    expect(JSON.stringify(dataExact).length).toBe(MAX_COLLECTION_BYTES);
    expect(await putCollection(db, OWNER, 'f1', 'c1', { data: dataExact, baseRev: 1 }, 2000))
      .toEqual({ ok: true, data: { revision: 2 } });
    const dataOver = { blob: 'x'.repeat(blobLenExact + 1) };
    expect(await putCollection(db, OWNER, 'f1', 'c2', { data: dataOver, baseRev: 1 }, 2000))
      .toEqual({ ok: false, status: 413, error: 'collection_too_large' });
  });

  it('folder ids with slashes/dot-segments/percent-encoding/unicode/500+ chars are accepted as opaque strings', async () => {
    const db = makeDB();
    const weirdId = 'a/b/../c%2Fd-' + 'x'.repeat(500) + '-é中​';
    expect(await createSharedFolder(db, OWNER, { folderId: weirdId, name: 'T', collections: [] }, 1000))
      .toEqual({ ok: true, data: { folderId: weirdId, revision: 1 } });
    const access = await requireFolderAccess(db, OWNER, weirdId, 'read');
    expect(access.ok).not.toBe(false);
  });

  it('folder name at exactly 200 chars (UTF-16 length, emoji included) is accepted; 201 is rejected', async () => {
    const db = makeDB();
    const emoji = '\u{1F600}'; // surrogate pair -> length 2
    const name200 = emoji.repeat(99) + 'xx'; // 99*2 + 2 = 200
    expect(name200.length).toBe(200);
    expect(await createSharedFolder(db, OWNER, { folderId: 'f200', name: name200, collections: [] }, 1000))
      .toEqual({ ok: true, data: { folderId: 'f200', revision: 1 } });
    expect(await createSharedFolder(db, OWNER, { folderId: 'f201', name: name200 + 'x', collections: [] }, 1000))
      .toEqual({ ok: false, status: 400, error: 'invalid_request' });
  });

  it('a moderately deep (but well within byte cap) nested JSON payload round-trips fine', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    let nested = { v: 1 };
    for (let i = 0; i < 5000; i++) nested = { child: nested };
    const put = await putCollection(db, OWNER, 'f1', 'deep', { data: nested, baseRev: 1 }, 2000);
    expect(put.ok).toBe(true);
    const delta = await getFolderDelta(db, OWNER, 'f1', 0);
    expect(delta.data.collections.find((c) => c.uid === 'deep')).toBeTruthy();
  });

  it('email at 254 chars with +tag/dots and an uppercase domain is accepted and normalized to lowercase', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    const local = 'a.b+tag'.padEnd(64, 'z');
    const email = `${local}@EXAMPLE-DOMAIN.COM`;
    const res = await inviteMember(db, OWNER, 'f1', { email, role: 'read' }, 1000);
    expect(res.ok).toBe(true);
    expect(res.data.members[0].email).toBe(email.toLowerCase());
  });
});

describe('route layer', () => {
  const makeKV = (store = {}) => ({
    get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
    put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
  });
  const PRO_RECORD = { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' };
  const routeEnv = (kvStore, db) => ({ GOOGLE_CLIENT_ID: 'cid', JWT_SECRET: 's', ENTITLEMENTS: makeKV(kvStore), SHARED_DB: db });
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

  it('HEAD on a folder-detail path is not implemented and falls through to 404', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    const res = await worker.fetch(new Request('https://api/shared/folders/f1', { method: 'HEAD', headers: { Authorization: 'Bearer t-owner' } }), routeEnv({}, db));
    expect(res.status).toBe(404);
  });

  it('POST to a GET/PATCH/DELETE-only route (folder-detail) yields 404, not 405', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    const res = await worker.fetch(new Request('https://api/shared/folders/f1', { method: 'POST', headers: { Authorization: 'Bearer t-owner' }, body: '{}' }), routeEnv({}, db));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('OPTIONS preflight is honored for any /shared/* path, even a nonexistent one', async () => {
    const db = makeDB();
    const res = await worker.fetch(new Request('https://api/shared/does/not/exist', { method: 'OPTIONS' }), routeEnv({}, db));
    expect(res.status).toBe(204);
  });

  it('Authorization scheme match is case-sensitive: only canonical "Bearer <token>" authenticates', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    const variants = ['bearer t-owner', 't-owner', 'Bearert-owner'];
    for (const Authorization of variants) {
      const res = await worker.fetch(new Request('https://api/shared/folders', { method: 'GET', headers: { Authorization } }), routeEnv({}, db));
      expect(res.status).toBe(401);
    }
    const valid = await worker.fetch(new Request('https://api/shared/folders', { method: 'GET', headers: { Authorization: 'Bearer t-owner' } }), routeEnv({}, db));
    expect(valid.status).toBe(200);
  });

  it('missing body on POST /shared/folders degrades to a clean 400, not a crash', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    const res = await worker.fetch(new Request('https://api/shared/folders', { method: 'POST', headers: { Authorization: 'Bearer t-owner' } }), routeEnv({ 'ent:g-owner': PRO_RECORD }, db));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('a double-percent-encoded folderId segment (%252F) decodes to a literal "%2F" segment, not a path-traversal slash', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    await createSharedFolder(db, OWNER, { folderId: 'a/b', name: 'T', collections: [] }, 1000);
    const res = await worker.fetch(new Request('https://api/shared/folders/a%252Fb', { method: 'GET', headers: { Authorization: 'Bearer t-owner' } }), routeEnv({}, db));
    expect(res.status).toBe(404); // does not match the folder literally named "a/b"
  });

  it('a single-percent-encoded slash in a folderId (%2F) correctly reaches the folder literally named "a/b"', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    await createSharedFolder(db, OWNER, { folderId: 'a/b', name: 'T', collections: [] }, 1000);
    const res = await worker.fetch(new Request('https://api/shared/folders/a%2Fb', { method: 'GET', headers: { Authorization: 'Bearer t-owner' } }), routeEnv({}, db));
    expect(res.status).toBe(200);
    expect((await res.json()).folder.name).toBe('T');
  });
});
