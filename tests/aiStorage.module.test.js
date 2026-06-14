require('jest-webextension-mock');
const STORAGE_KEYS = {
  COLLECTIONS_INDEX: 'collections_index', FOLDERS_INDEX: 'folders_index',
  COLLECTION_PREFIX: 'collection_', FOLDER_PREFIX: 'folder_',
  DELETED_FOLDER_TOMBSTONES: 'deleted_folder_tombstones',
};
global.STORAGE_KEYS = STORAGE_KEYS; // background-utils provides this global in the SW
const store = require('../chrome/ai-storage.js');

// The global jest.setup.js overrides browser with a minimal mock; patch in the
// full storage operations we need for these unit tests.
let _store = {};
browser.storage.local.get = jest.fn(async (keys) => {
  if (keys === null || keys === undefined) return { ..._store };
  if (typeof keys === 'string') return { [keys]: _store[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, _store[k]]));
  return Object.fromEntries(Object.keys(keys).map((k) => [k, _store[k]]));
});
browser.storage.local.set = jest.fn(async (payload) => { Object.assign(_store, payload); });
browser.storage.local.remove = jest.fn(async (keys) => {
  (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete _store[k]);
});
browser.storage.local.clear = jest.fn(async () => { _store = {}; });

const local = browser.storage.local;
beforeEach(async () => { await local.clear(); });

test('renameCollectionsBG updates index + record names in one pass', async () => {
  await local.set({
    [STORAGE_KEYS.COLLECTIONS_INDEX]: { c1: { name: 'Old', lastUpdated: 1 } },
    [`${STORAGE_KEYS.COLLECTION_PREFIX}c1`]: { uid: 'c1', name: 'Old', tabs: [] },
  });
  await store.renameCollectionsBG([{ uid: 'c1', oldName: 'Old', newName: 'New' }]);
  const idx = (await local.get(STORAGE_KEYS.COLLECTIONS_INDEX))[STORAGE_KEYS.COLLECTIONS_INDEX];
  const rec = (await local.get(`${STORAGE_KEYS.COLLECTION_PREFIX}c1`))[`${STORAGE_KEYS.COLLECTION_PREFIX}c1`];
  expect(idx.c1.name).toBe('New');
  expect(rec.name).toBe('New');
});

test('moveCollectionsToFoldersBG sets parentId in index + record', async () => {
  await local.set({
    [STORAGE_KEYS.COLLECTIONS_INDEX]: { c1: { name: 'A', parentId: null } },
    [`${STORAGE_KEYS.COLLECTION_PREFIX}c1`]: { uid: 'c1', name: 'A', parentId: null, tabs: [] },
  });
  await store.moveCollectionsToFoldersBG([{ uid: 'c1', parentId: 'f1' }]);
  const idx = (await local.get(STORAGE_KEYS.COLLECTIONS_INDEX))[STORAGE_KEYS.COLLECTIONS_INDEX];
  expect(idx.c1.parentId).toBe('f1');
});

test('createFolderBG writes folder record + index entry', async () => {
  const folder = await store.createFolderBG('Reading', '#4facfe', true);
  const idx = (await local.get(STORAGE_KEYS.FOLDERS_INDEX))[STORAGE_KEYS.FOLDERS_INDEX];
  expect(idx[folder.uid].name).toBe('Reading');
  expect(folder.collapsed).toBe(true);
});

test('deleteFolderBG removes folder and writes a tombstone', async () => {
  const folder = await store.createFolderBG('Temp', '#000', false);
  await store.deleteFolderBG(folder.uid);
  const idx = (await local.get(STORAGE_KEYS.FOLDERS_INDEX))[STORAGE_KEYS.FOLDERS_INDEX];
  const tombs = (await local.get(STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES))[STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES];
  expect(idx[folder.uid]).toBeUndefined();
  expect(tombs[folder.uid]).toBeTruthy();
});
