/**
 * Regression: every folders_index writer that rebuilds an entry from a fixed
 * field list must carry the `shared` marker through. Stripping it silently
 * un-protects the folder — delete guards, auto-arrange's shared-folder
 * exclusion, and sync-apply's rematerialize logic all key off
 * folders_index[uid].shared.folderId.
 */
require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();

const SHARED = { folderId: 'srv-1', role: 'owner', ownerEmail: 'me@example.com', members: [] };
const T = 1710000000000;

const sharedFolderRecord = {
    uid: 'sf1', name: 'Team Shared', type: 'folder', color: '#ff9800',
    collapsed: false, collectionCount: 0, order: 1, createdOn: T, lastUpdated: T,
    shared: SHARED,
};
const sharedFolderIndexEntry = {
    name: 'Team Shared', type: 'folder', color: '#ff9800', collapsed: false,
    collectionCount: 0, order: 1, createdOn: T, lastUpdated: T, size: 0,
    shared: SHARED,
};

beforeEach(async () => { await browser.storage.local.clear(); });

describe('app-side storageUtils', () => {
    const { saveSingleFolder, migrateLegacyStorage } = require('../app/utils/storageUtils');

    test('saveSingleFolder keeps the shared marker in the rebuilt index entry', async () => {
        await browser.storage.local.set({
            folders_index: { sf1: { ...sharedFolderIndexEntry } },
            folder_sf1: { ...sharedFolderRecord },
            collections_index: {},
        });
        // A rename flow saves the full record (marker present on the folder).
        await saveSingleFolder({ ...sharedFolderRecord, name: 'Renamed' }, true);
        const { folders_index: idx } = await browser.storage.local.get('folders_index');
        expect(idx.sf1.shared).toEqual(SHARED);

        // Even a caller passing a folder WITHOUT the marker must not strip a
        // marker the index already carries.
        const noMarker = { ...sharedFolderRecord, name: 'Renamed again' };
        delete noMarker.shared;
        await saveSingleFolder(noMarker, true);
        const { folders_index: idx2 } = await browser.storage.local.get('folders_index');
        expect(idx2.sf1.shared).toEqual(SHARED);
    });

    test('migrateLegacyStorage index rebuild keeps the shared marker', async () => {
        await browser.storage.local.set({
            collections_index: {},
            folders_index: { sf1: { ...sharedFolderIndexEntry } },
            folder_sf1: { ...sharedFolderRecord },
            // no tabox_storage_version -> migration performs a full rebuild
        });
        const result = await migrateLegacyStorage();
        expect(result.success).toBe(true);
        const { folders_index: idx, folder_sf1: rec } = await browser.storage.local.get(['folders_index', 'folder_sf1']);
        expect(idx.sf1.shared).toEqual(SHARED);
        expect(rec.shared).toEqual(SHARED);
    });
});

describe('background saveSingleFolderBG', () => {
    const { saveSingleFolderBG } = require('../chrome/background-utils');

    test('keeps the shared marker in the rebuilt index entry', async () => {
        await browser.storage.local.set({
            folders_index: { sf1: { ...sharedFolderIndexEntry } },
            folder_sf1: { ...sharedFolderRecord },
            collections_index: {},
        });
        await saveSingleFolderBG({ ...sharedFolderRecord, name: 'Renamed' });
        const { folders_index: idx } = await browser.storage.local.get('folders_index');
        expect(idx.sf1.shared).toEqual(SHARED);

        const noMarker = { ...sharedFolderRecord, name: 'Renamed again' };
        delete noMarker.shared;
        await saveSingleFolderBG(noMarker);
        const { folders_index: idx2 } = await browser.storage.local.get('folders_index');
        expect(idx2.sf1.shared).toEqual(SHARED);
    });
});
