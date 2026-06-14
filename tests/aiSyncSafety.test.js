require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const STORAGE_KEYS = { COLLECTIONS_INDEX:'collections_index', FOLDERS_INDEX:'folders_index',
  COLLECTION_PREFIX:'collection_', FOLDER_PREFIX:'folder_',
  DELETED_COLLECTION_TOMBSTONES:'deleted_collection_tombstones', DELETED_FOLDER_TOMBSTONES:'deleted_folder_tombstones',
  LEGACY_TABS_ARRAY:'tabsArray', STORAGE_VERSION:'tabox_storage_version' };
global.STORAGE_KEYS = STORAGE_KEYS;
const aiStore = require('../chrome/ai-storage.js');
const apply = require('../chrome/sync-apply.js');
const local = browser.storage.local;
beforeEach(async () => { await local.clear(); });

test('aiTaskState is NOT a sync-managed key', () => {
  expect(apply.isSyncManagedKey('aiTaskState')).toBe(false);
});

test('AI rename keeps every index entry (no dropped collections)', async () => {
  await local.set({
    [STORAGE_KEYS.COLLECTIONS_INDEX]: { c1:{name:'A'}, c2:{name:'B'}, c3:{name:'C'} },
    [`${STORAGE_KEYS.COLLECTION_PREFIX}c1`]: { uid:'c1', name:'A', tabs:[] },
  });
  await aiStore.renameCollectionsBG([{ uid:'c1', oldName:'A', newName:'A2' }]);
  const idx = (await local.get(STORAGE_KEYS.COLLECTIONS_INDEX))[STORAGE_KEYS.COLLECTIONS_INDEX];
  expect(Object.keys(idx).sort()).toEqual(['c1','c2','c3']);
  expect(idx.c1.name).toBe('A2');
});

test('a sync snapshot apply preserves an unrelated aiTaskState key', async () => {
  await local.set({ aiTaskState: { taskId:'x', status:'running' } });
  await apply.applySyncSnapshotAtomically({
    storageArea: local,
    syncData: { tabsArray: [], foldersArray: [], deletedCollections: [], deletedFolders: [] },
    now: 123,
  });
  const survived = (await local.get('aiTaskState')).aiTaskState;
  expect(survived).toEqual({ taskId:'x', status:'running' });
});
