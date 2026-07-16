import { browser } from '../static/globals';
import { syncSharedFolders, handleSharedMessage, SHARED_EVENTS_KEY, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn().mockResolvedValue('tok'),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as static
// jest.fn()s (no real backing store, no `.clear()`/`.remove()`), so install a tiny
// in-memory store here — mirrors tests/sharedFoldersClient.test.js (Task 8) and
// tests/sharedDriveSyncExclusion.test.js (Task 9).
function installStorageMock() {
  const store = {};
  browser.storage.local.get = jest.fn(async (keys) => {
    if (keys === undefined || keys === null) return { ...store };
    const names = Array.isArray(keys) ? keys : [keys];
    return names.reduce((acc, k) => ({ ...acc, [k]: store[k] }), {});
  });
  browser.storage.local.set = jest.fn(async (obj) => {
    Object.assign(store, obj);
  });
  browser.storage.local.remove = jest.fn(async (keys) => {
    const names = Array.isArray(keys) ? keys : [keys];
    names.forEach((k) => { delete store[k]; });
  });
  browser.storage.local.clear = jest.fn(async () => {
    Object.keys(store).forEach((k) => { delete store[k]; });
  });
  return store;
}

const SHARED_FOLDER = { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'write', ownerEmail: 'o@x.com' } };

function seedLocal(extra = {}) {
  return browser.storage.local.set({
    googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
    folders_index: { f1: { uid: 'f1', name: 'Team', shared: SHARED_FOLDER.shared } },
    folder_f1: SHARED_FOLDER,
    collections_index: { c1: { uid: 'c1', parentId: 'f1', lastUpdated: 100 } },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [], lastUpdated: 100 },
    [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 100, knownUids: ['c1'] } },
    ...extra,
  });
}
const deltaResponse = (overrides = {}) => ({
  ok: true, status: 200,
  json: async () => ({
    revision: 2, role: 'write',
    folder: { name: 'Team', color: null, updatedBy: 'o@x.com' },
    members: [],
    collections: [{ uid: 'c2', data: { name: 'B', tabs: [] }, rev: 2, deleted: 0, updatedBy: 'o@x.com', updatedAt: 200 }],
    ...overrides,
  }),
});

beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(); installStorageMock(); });

test('pull applies remote upsert locally and records an event for the other user\'s change', async () => {
  await seedLocal();
  global.fetch.mockResolvedValue(deltaResponse());
  const res = await syncSharedFolders();
  expect(res.ok).toBe(true);
  const store = await browser.storage.local.get(['collection_c2', 'collections_index', SHARED_EVENTS_KEY, SHARED_SYNC_STATE_KEY]);
  expect(store.collection_c2).toMatchObject({ uid: 'c2', name: 'B', parentId: 'f1' });
  expect(store.collections_index.c2).toBeDefined();
  expect(store[SHARED_EVENTS_KEY][0]).toMatchObject({ folderId: 'f1', actorEmail: 'o@x.com', kind: 'updated' });
  expect(store[SHARED_SYNC_STATE_KEY].f1.lastRev).toBe(2);
});

test('push sends locally-updated collections with baseRev and local deletions as DELETE', async () => {
  await seedLocal({ [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 50, knownUids: ['c1', 'gone'] } } });
  global.fetch.mockImplementation(async (url, opts = {}) => {
    if (!opts.method || opts.method === 'GET') return deltaResponse({ collections: [] });
    return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
  });
  await syncSharedFolders();
  const calls = global.fetch.mock.calls.map(([url, opts]) => `${(opts && opts.method) || 'GET'} ${url}`);
  expect(calls.some((c) => c.startsWith('PUT') && c.includes('/collections/c1'))).toBe(true);   // lastUpdated 100 > lastSyncedAt 50
  expect(calls.some((c) => c.startsWith('DELETE') && c.includes('/collections/gone'))).toBe(true); // knownUid vanished locally
});

test('403 on pull converts the folder to a local unshared folder and records a revoked event', async () => {
  await seedLocal();
  global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
  await syncSharedFolders();
  const store = await browser.storage.local.get(['folder_f1', SHARED_EVENTS_KEY]);
  expect(store.folder_f1.shared).toBeUndefined();
  expect(store[SHARED_EVENTS_KEY][0]).toMatchObject({ kind: 'revoked', folderId: 'f1' });
});

// Task 15 review: the popup previously drained shared_folder_events with a plain
// storage.local.get followed by a separate storage.local.set([]) - a read-then-clear
// that can race a concurrent event append and silently drop it. sharedDrainEvents reads
// and resets the key under the SAME withStorageLock acquisition, so the two are atomic
// from the caller's point of view.
describe('sharedDrainEvents', () => {
  test('(d) returns the current events and clears the key atomically - a second sequential drain returns []', async () => {
    const events = [
      { folderId: 'f1', folderName: 'Team', actorEmail: 'o@x.com', kind: 'updated', collectionName: 'A', at: 1 },
      { folderId: 'f1', folderName: 'Team', actorEmail: 'o@x.com', kind: 'deleted', collectionName: null, at: 2 },
    ];
    await browser.storage.local.set({ [SHARED_EVENTS_KEY]: events });

    const first = await handleSharedMessage({ type: 'sharedDrainEvents' });
    expect(first).toEqual({ ok: true, data: { events } });
    expect((await browser.storage.local.get(SHARED_EVENTS_KEY))[SHARED_EVENTS_KEY]).toEqual([]);

    const second = await handleSharedMessage({ type: 'sharedDrainEvents' });
    expect(second).toEqual({ ok: true, data: { events: [] } });
  });

  test('drains an empty/missing events key as []', async () => {
    const res = await handleSharedMessage({ type: 'sharedDrainEvents' });
    expect(res).toEqual({ ok: true, data: { events: [] } });
  });
});
