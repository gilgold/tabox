// Task 12: invite polling (with Chrome notifications) + invite response
// (accept materializes the shared folder + collections locally; decline just
// drops the pending invite).
import { browser } from '../static/globals';
import { pollInvites, respondToInvite, SHARED_PENDING_INVITES_KEY, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn().mockResolvedValue('tok'),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as static
// jest.fn()s (no real backing store, no `.clear()`) — install a tiny in-memory
// store here, mirroring tests/sharedFoldersClient.test.js and
// tests/sharedSyncEngine.test.js.
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

// jest-webextension-mock ships a `notifications` stub, but jest.setup.js's
// own hand-rolled `mockBrowser` (what `../static/globals`'s `browser` actually
// resolves to, via `jest.mock('webextension-polyfill', ...)`) does not define
// `notifications` at all. Define it here on the shared singleton.
if (!browser.notifications) {
  browser.notifications = {};
}
browser.notifications.create = jest.fn().mockResolvedValue('notif-id');

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  installStorageMock();
  browser.notifications.create = jest.fn().mockResolvedValue('notif-id');
});

test('pollInvites stores invites and notifies once per folder', async () => {
  const invite = { folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'read', invitedAt: 1 };
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });
  await pollInvites();
  await pollInvites(); // second poll must not re-notify
  const { [SHARED_PENDING_INVITES_KEY]: stored } = await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);
  expect(stored.invites).toEqual([invite]);
  expect(browser.notifications.create).toHaveBeenCalledTimes(1);
});

test('accepting materializes folder + collections locally in one set and seeds sync state', async () => {
  await browser.storage.local.set({
    [SHARED_PENDING_INVITES_KEY]: { invites: [{ folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'write' }], notifiedFolderIds: ['f1'] },
  });
  global.fetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      accepted: true,
      folder: { folderId: 'f1', name: 'Team', color: '#f00', revision: 4, role: 'write', ownerEmail: 'o@x.com', members: [] },
      collections: [{ uid: 'c1', data: { name: 'A', tabs: [] } }],
    }),
  });
  const res = await respondToInvite({ folderId: 'f1', accept: true });
  expect(res.ok).toBe(true);
  const store = await browser.storage.local.get(['folder_f1', 'collection_c1', 'folders_index', 'collections_index', SHARED_SYNC_STATE_KEY, SHARED_PENDING_INVITES_KEY]);
  expect(store.folder_f1).toMatchObject({ uid: 'f1', name: 'Team', shared: { role: 'write', ownerEmail: 'o@x.com' } });
  expect(store.collection_c1).toMatchObject({ uid: 'c1', name: 'A', parentId: 'f1' });
  expect(store.folders_index.f1).toBeDefined();
  expect(store.collections_index.c1).toBeDefined();
  expect(store[SHARED_SYNC_STATE_KEY].f1).toMatchObject({ lastRev: 4, knownUids: ['c1'] });
  expect(store[SHARED_PENDING_INVITES_KEY].invites).toEqual([]);
});

test('declining removes the invite without creating anything', async () => {
  await browser.storage.local.set({ [SHARED_PENDING_INVITES_KEY]: { invites: [{ folderId: 'f1', folderName: 'Team' }], notifiedFolderIds: ['f1'] } });
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: false }) });
  await respondToInvite({ folderId: 'f1', accept: false });
  const store = await browser.storage.local.get(['folder_f1', SHARED_PENDING_INVITES_KEY]);
  expect(store.folder_f1).toBeUndefined();
  expect(store[SHARED_PENDING_INVITES_KEY].invites).toEqual([]);
});

// Edge case (self-review): accepting an invite for a folder that ALREADY exists
// locally (e.g. re-accepting after a stale local copy, or a race with a prior
// partial accept) must overwrite cleanly and keep both indexes consistent —
// no leftover fields from the old record, no duplicate index entries.
test('accepting overwrites an existing local folder/collection cleanly (indexes stay consistent)', async () => {
  await browser.storage.local.set({
    folder_f1: { uid: 'f1', name: 'Old Name', type: 'folder', color: '#000', stalePreExistingField: true },
    folders_index: { f1: { uid: 'f1', name: 'Old Name' }, other: { uid: 'other', name: 'Unrelated' } },
    collection_c1: { uid: 'c1', name: 'Old collection', parentId: 'f1', tabs: [{ url: 'https://old.example' }] },
    collections_index: { c1: { uid: 'c1', name: 'Old collection', parentId: 'f1' } },
  });
  global.fetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      accepted: true,
      folder: { folderId: 'f1', name: 'Team', color: '#f00', revision: 7, role: 'read', ownerEmail: 'o@x.com', members: [] },
      collections: [{ uid: 'c1', data: { name: 'A (fresh)', tabs: [] } }],
    }),
  });
  await respondToInvite({ folderId: 'f1', accept: true });
  const store = await browser.storage.local.get(['folder_f1', 'collection_c1', 'folders_index', 'collections_index']);
  expect(store.folder_f1).toEqual({
    uid: 'f1', name: 'Team', type: 'folder', color: '#f00',
    collapsed: false, order: 999999, collectionCount: 1,
    createdOn: expect.any(Number), lastUpdated: expect.any(Number),
    shared: { folderId: 'f1', role: 'read', ownerEmail: 'o@x.com', members: [] },
  });
  expect(store.folder_f1.stalePreExistingField).toBeUndefined();
  expect(store.collection_c1).toMatchObject({ uid: 'c1', name: 'A (fresh)', parentId: 'f1' });
  expect(store.collection_c1.tabs).toEqual([]);
  // Both indexes still have exactly one entry for f1/c1, and the unrelated
  // folder entry is untouched.
  expect(Object.keys(store.folders_index).sort()).toEqual(['f1', 'other']);
  expect(Object.keys(store.collections_index)).toEqual(['c1']);
});
