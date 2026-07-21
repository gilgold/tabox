import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import worker from '../src/index.js';
import {
  createSharedFolder, inviteMember, respondInvite, putCollection, deleteCollection,
  updateFolderMeta, updateMemberRole, removeMember, deleteSharedFolder, getFolderDelta,
} from '../src/sharedFolders.js';
import {
  recordActivity, listActivity, MAX_ACTIVITY_ROWS, ACTIVITY_COALESCE_MS,
} from '../src/sharedActivity.js';
import { createOrRotateFolderLink, joinViaFolderLink } from '../src/shareLinks.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const GUEST = { googleId: 'g-guest', email: 'guest@x.com' };
const STRANGER = { googleId: 'g-str', email: 'stranger@x.com' };
const MIN = 60 * 1000;

async function seed({ withGuest = true } = {}) {
  const db = makeDB();
  await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [] }, 1000);
  if (withGuest) {
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'write' }, 1000);
    await respondInvite(db, GUEST, 'f1', true, 1001, { isPro: true });
  }
  return db;
}

const events = async (db, identity = OWNER, opts = {}) => (await listActivity(db, identity, 'f1', opts)).data.events;
const rowCount = (db) => db._raw.prepare('SELECT COUNT(*) AS n FROM shared_activity').get().n;

describe('activity recording by mutators', () => {
  it('putCollection records collection_added for a new row, collection_updated for an existing one', async () => {
    const db = await seed({ withGuest: false });
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'Research' } }, 2000);
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'Research v2' } }, 3000);
    const evs = await events(db);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ action: 'collection_updated', subject: 'c1', actorEmail: 'owner@x.com', detail: { name: 'Research v2' }, createdAt: 3000 });
    expect(evs[1]).toMatchObject({ action: 'collection_added', subject: 'c1', detail: { name: 'Research' }, createdAt: 2000 });
  });

  it('re-adding over a tombstone reads as collection_added again', async () => {
    const db = await seed({ withGuest: false });
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'A' } }, 2000);
    await deleteCollection(db, OWNER, 'f1', 'c1', 3000);
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'A again' } }, 4000 + 20 * MIN);
    expect((await events(db))[0]).toMatchObject({ action: 'collection_added', detail: { name: 'A again' } });
  });

  it('deleteCollection snapshots the pre-delete name into detail', async () => {
    const db = await seed({ withGuest: false });
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'Doomed' } }, 2000);
    await deleteCollection(db, OWNER, 'f1', 'c1', 3000);
    expect((await events(db))[0]).toMatchObject({ action: 'collection_deleted', subject: 'c1', detail: { name: 'Doomed' } });
  });

  it('updateFolderMeta records folder_renamed only when the name actually changed', async () => {
    const db = await seed({ withGuest: false });
    await updateFolderMeta(db, OWNER, 'f1', { color: '#f00' }, 2000); // color-only: no event
    await updateFolderMeta(db, OWNER, 'f1', { name: 'Team' }, 2500);  // same name: no event
    expect(await events(db)).toHaveLength(0);
    await updateFolderMeta(db, OWNER, 'f1', { name: 'Squad' }, 3000);
    const evs = await events(db);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ action: 'folder_renamed', subject: null, detail: { from: 'Team', to: 'Squad' } });
  });

  it('respondInvite(accept) records member_joined with the effective role', async () => {
    const db = await seed({ withGuest: false });
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'write' }, 1500);
    await respondInvite(db, GUEST, 'f1', true, 1600, { isPro: false }); // downgraded to read
    const evs = await events(db);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ action: 'member_joined', actorEmail: 'guest@x.com', subject: 'guest@x.com', detail: { role: 'read' } });
  });

  it('declining an invite records nothing', async () => {
    const db = await seed({ withGuest: false });
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, 1500);
    await respondInvite(db, GUEST, 'f1', false, 1600);
    expect(await events(db)).toHaveLength(0);
  });

  it('joinViaFolderLink records member_joined; re-opening the link as an active member does not', async () => {
    const db = await seed({ withGuest: false });
    const { data: { token } } = await createOrRotateFolderLink(db, OWNER, 'f1', { role: 'write' }, 1500);
    await joinViaFolderLink(db, GUEST, token, 1600, { isPro: true });
    await joinViaFolderLink(db, GUEST, token, 1700, { isPro: true });
    const evs = await events(db);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ action: 'member_joined', actorEmail: 'guest@x.com', detail: { role: 'write' } });
  });

  it('removeMember records member_left for self, member_removed for owner-initiated', async () => {
    const db = await seed();
    await removeMember(db, GUEST, 'f1', 'guest@x.com', 5000);
    let evs = await events(db);
    expect(evs[0]).toMatchObject({ action: 'member_left', actorEmail: 'guest@x.com', subject: 'guest@x.com', detail: null });

    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, 6000);
    await respondInvite(db, GUEST, 'f1', true, 6001, { isPro: false });
    await removeMember(db, OWNER, 'f1', 'guest@x.com', 7000);
    evs = await events(db);
    expect(evs[0]).toMatchObject({ action: 'member_removed', actorEmail: 'owner@x.com', subject: 'guest@x.com' });
  });

  it('updateMemberRole records role_changed with the new role', async () => {
    const db = await seed();
    await updateMemberRole(db, OWNER, 'f1', 'guest@x.com', 'read', 5000);
    expect((await events(db))[0]).toMatchObject({ action: 'role_changed', actorEmail: 'owner@x.com', subject: 'guest@x.com', detail: { role: 'read' } });
  });
});

describe('coalescing', () => {
  it('same (actor, action, subject) within 10 minutes updates the row instead of inserting', async () => {
    const db = await seed({ withGuest: false });
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'v1' } }, 10_000);
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'v2' } }, 10_000 + 2 * MIN);
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'v3' } }, 10_000 + 5 * MIN);
    const evs = await events(db);
    // one collection_added + one coalesced collection_updated
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ action: 'collection_updated', detail: { name: 'v3' }, createdAt: 10_000 + 5 * MIN });
  });

  it('window is measured from the coalesced row\'s (bumped) created_at', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: [] }, 1000);
    await recordActivity(db, 'f1', OWNER.email, 'collection_updated', 'c1', { name: 'a' }, 0);
    await recordActivity(db, 'f1', OWNER.email, 'collection_updated', 'c1', { name: 'b' }, 5 * MIN); // coalesce, bump to 5min
    await recordActivity(db, 'f1', OWNER.email, 'collection_updated', 'c1', { name: 'c' }, 9 * MIN); // 4min since bump: coalesce
    expect(await events(db)).toHaveLength(1);
    await recordActivity(db, 'f1', OWNER.email, 'collection_updated', 'c1', { name: 'd' }, 9 * MIN + ACTIVITY_COALESCE_MS); // outside: new row
    expect(await events(db)).toHaveLength(2);
  });

  it('a different actor, subject, or intervening event breaks coalescing', async () => {
    const db = await seed();
    await recordActivity(db, 'f1', OWNER.email, 'collection_updated', 'c1', null, 10_000);
    await recordActivity(db, 'f1', GUEST.email, 'collection_updated', 'c1', null, 11_000); // different actor
    await recordActivity(db, 'f1', GUEST.email, 'collection_updated', 'c2', null, 12_000); // different subject
    await recordActivity(db, 'f1', GUEST.email, 'collection_updated', 'c1', null, 13_000); // c1 no longer most recent
    const evs = await events(db);
    expect(evs.filter((e) => e.action === 'collection_updated')).toHaveLength(4);
  });
});

describe('retention', () => {
  it('prunes to the newest 200 rows per folder', async () => {
    const db = await seed({ withGuest: false });
    for (let i = 0; i < MAX_ACTIVITY_ROWS + 5; i++) {
      await recordActivity(db, 'f1', OWNER.email, 'collection_added', `c${i}`, null, 1000 + i);
    }
    expect(rowCount(db)).toBe(MAX_ACTIVITY_ROWS);
    // the oldest 5 are the ones that got pruned
    const oldest = db._raw.prepare('SELECT MIN(id) AS m FROM shared_activity').get().m;
    expect(oldest).toBe(6);
  });

  it('pruning is per folder', async () => {
    const db = await seed({ withGuest: false });
    await createSharedFolder(db, OWNER, { folderId: 'f2', name: 'Other', collections: [] }, 1000);
    for (let i = 0; i < MAX_ACTIVITY_ROWS + 5; i++) {
      await recordActivity(db, 'f1', OWNER.email, 'collection_added', `c${i}`, null, 1000 + i);
    }
    await recordActivity(db, 'f2', OWNER.email, 'collection_added', 'z1', null, 999);
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM shared_activity WHERE folder_id = 'f2'").get().n).toBe(1);
  });
});

describe('listActivity', () => {
  it('non-members get 404 (never learn the folder exists)', async () => {
    const db = await seed();
    expect(await listActivity(db, STRANGER, 'f1', {})).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('read members can list; newest first; default and max limit 50; beforeId pages older', async () => {
    const db = await seed();
    for (let i = 0; i < 60; i++) {
      await recordActivity(db, 'f1', OWNER.email, 'collection_added', `c${i}`, null, 1000 + i);
    }
    const page1 = await events(db, GUEST);
    expect(page1).toHaveLength(50);
    expect(page1[0].subject).toBe('c59');
    expect(page1[0].id).toBeGreaterThan(page1[1].id);
    const page2 = await events(db, GUEST, { beforeId: page1[49].id });
    // 60 recordActivity rows + 1 member_joined from seed, minus 50 on page 1
    expect(page2).toHaveLength(11);
    expect(page2.every((e) => e.id < page1[49].id)).toBe(true);
    expect(await events(db, GUEST, { limit: 10 })).toHaveLength(10);
    expect(await events(db, GUEST, { limit: 500 })).toHaveLength(50); // capped
  });

  it('present-but-garbage beforeId/limit is a 400', async () => {
    const db = await seed();
    for (const opts of [{ beforeId: 'abc' }, { limit: 'abc' }, { limit: 0 }, { beforeId: NaN }, { limit: Infinity }]) {
      expect(await listActivity(db, OWNER, 'f1', opts)).toEqual({ ok: false, status: 400, error: 'invalid_request' });
    }
  });
});

describe('resilience & lifecycle', () => {
  it('a recordActivity failure does not fail the parent mutation', async () => {
    const db = await seed({ withGuest: false });
    const flaky = {
      prepare(sql) {
        if (sql.includes('shared_activity')) throw new Error('boom');
        return db.prepare(sql);
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await putCollection(flaky, OWNER, 'f1', 'c1', { data: { name: 'X' } }, 2000);
      expect(res.ok).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    // the collection write itself landed
    expect((await getFolderDelta(db, OWNER, 'f1', 0)).data.collections).toHaveLength(1);
  });

  it('folder deletion cascades to shared_activity', async () => {
    const db = await seed();
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'X' } }, 2000);
    expect(rowCount(db)).toBeGreaterThan(0);
    await deleteSharedFolder(db, OWNER, 'f1');
    expect(rowCount(db)).toBe(0);
  });

  it('getFolderDelta reports lastActivityId (0 when the feed is empty)', async () => {
    const db = await seed({ withGuest: false });
    expect((await getFolderDelta(db, OWNER, 'f1', 0)).data.lastActivityId).toBe(0);
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'X' } }, 2000);
    await putCollection(db, OWNER, 'f1', 'c2', { data: { name: 'Y' } }, 3000);
    const maxId = db._raw.prepare('SELECT MAX(id) AS m FROM shared_activity').get().m;
    expect((await getFolderDelta(db, OWNER, 'f1', 0)).data.lastActivityId).toBe(maxId);
  });
});

// ---- route layer ----------------------------------------------------------

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
});
const PRO_RECORD = { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' };
const env = (kvStore, db) => ({ GOOGLE_CLIENT_ID: 'cid', JWT_SECRET: 's', ENTITLEMENTS: makeKV(kvStore), SHARED_DB: db });
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

describe('GET /shared/folders/:id/activity', () => {
  let db, e;
  beforeEach(async () => {
    db = await seed();
    e = env({ 'ent:g-owner': PRO_RECORD }, db);
    mockGoogle({
      't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
      't-stranger': { googleId: 'g-str', email: 'stranger@x.com' },
    });
  });

  it('returns the feed newest-first', async () => {
    await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'X' } }, 20 * MIN);
    const res = await worker.fetch(req('GET', '/shared/folders/f1/activity', 't-owner'), e);
    expect(res.status).toBe(200);
    const { events: evs } = await res.json();
    expect(evs[0]).toMatchObject({ action: 'collection_added', subject: 'c1', detail: { name: 'X' } });
    expect(evs[1]).toMatchObject({ action: 'member_joined' });
  });

  it('garbage beforeId/limit -> 400 invalid_request; stranger -> 404', async () => {
    for (const qs of ['?beforeId=abc', '?limit=abc', '?limit=0']) {
      const res = await worker.fetch(req('GET', `/shared/folders/f1/activity${qs}`, 't-owner'), e);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
    }
    const res = await worker.fetch(req('GET', '/shared/folders/f1/activity', 't-stranger'), e);
    expect(res.status).toBe(404);
  });
});
