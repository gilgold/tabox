import { browser } from '../static/globals';
import { handleSharedMessage, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn(),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as
// static jest.fn()s (no real backing store, no `.clear()`), so we install a
// tiny in-memory store here rather than relying on `browser.storage.local.clear()`.
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
    names.forEach((k) => {
      delete store[k];
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  installStorageMock();
});

test('sharedUnshareFolder deletes server share but keeps the local folder and collections', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-1');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ deleted: true }),
  });
  await browser.storage.local.set({
    folders_index: { f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'owner' } } },
    folder_f1: { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'owner' } },
    collection_c1: { uid: 'c1', parentId: 'f1', name: 'A' },
    collections_index: { c1: { uid: 'c1', parentId: 'f1' } },
    shared_sync_state: { f1: { lastRev: 3, knownUids: ['c1'] } },
  });
  const res = await handleSharedMessage({ type: 'sharedUnshareFolder', folderId: 'f1' });
  expect(res.ok).toBe(true);
  const store = await browser.storage.local.get(['folder_f1', 'collection_c1', 'shared_sync_state', 'folders_index']);
  expect(store.folder_f1.shared).toBeUndefined();     // marker gone
  expect(store.collection_c1).toBeDefined();          // data preserved
  expect(store.shared_sync_state.f1).toBeUndefined(); // sync state cleaned
  expect(store.folders_index.f1.shared).toBeUndefined(); // marker gone from index too
});

test('sharedUnshareFolder purges tombstones for folder and its collections', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-1');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ deleted: true }),
  });
  await browser.storage.local.set({
    folders_index: { f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'owner' } } },
    folder_f1: { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'owner' } },
    collection_c1: { uid: 'c1', parentId: 'f1', name: 'A' },
    collections_index: { c1: { uid: 'c1', parentId: 'f1' } },
    shared_sync_state: { f1: { lastRev: 3, knownUids: ['c1'] } },
    // Tombstones from collections deleted while shared
    deleted_collection_tombstones: { c1: { uid: 'c1', deletedAt: 1000 } },
    // Tombstone for the folder itself
    deleted_folder_tombstones: { f1: { uid: 'f1', deletedAt: 2000 } },
  });
  const res = await handleSharedMessage({ type: 'sharedUnshareFolder', folderId: 'f1' });
  expect(res.ok).toBe(true);
  const store = await browser.storage.local.get([
    'folder_f1',
    'collection_c1',
    'shared_sync_state',
    'deleted_collection_tombstones',
    'deleted_folder_tombstones',
  ]);
  expect(store.folder_f1.shared).toBeUndefined();     // marker gone
  expect(store.collection_c1).toBeDefined();          // collection data preserved
  expect(store.shared_sync_state.f1).toBeUndefined(); // sync state cleaned
  // Tombstones purged
  expect(store.deleted_collection_tombstones.c1).toBeUndefined();
  expect(store.deleted_folder_tombstones.f1).toBeUndefined();
});
