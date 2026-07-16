// Task 9: shared folders/collections (Task 8) must never enter the Google Drive sync
// payload, must never be resurrected/deleted by a Drive pull, and must lose their
// `shared` marker on import or backup restore. This file covers all three chokepoints:
//   1. chrome/background-utils.js -> prepareSyncDataForUpload (upload)
//   2. chrome/sync-apply.js -> buildIndexedSyncPayload / applySyncSnapshotAtomically (pull)
//   3. chrome/background.js -> import + backup-restore handlers (marker strip)

import { browser } from '../static/globals';
import { prepareSyncDataForUpload } from '../chrome/background-utils';
import { isSharedFolderRecord, partitionSharedUids } from '../chrome/shared-folders';

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as static
// jest.fn()s (no real backing store, no `.clear()`), so install a tiny in-memory store
// here instead (mirrors tests/sharedFoldersClient.test.js from Task 8).
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
    return store;
}

describe('chrome/shared-folders.js helpers', () => {
    test('isSharedFolderRecord requires a shared.folderId', () => {
        expect(isSharedFolderRecord({ uid: 'f1', shared: { folderId: 'f1' } })).toBe(true);
        expect(isSharedFolderRecord({ uid: 'f1' })).toBe(false);
        expect(isSharedFolderRecord({ uid: 'f1', shared: {} })).toBe(false);
        expect(isSharedFolderRecord(null)).toBe(false);
    });

    test('partitionSharedUids collects shared folder uids and the collections that live in them', () => {
        const folders = [
            { uid: 'f1', name: 'Private' },
            { uid: 'f2', name: 'Team', shared: { folderId: 'f2', role: 'owner' } },
        ];
        const collections = [
            { uid: 'c1', parentId: 'f1' },
            { uid: 'c2', parentId: 'f2' },
        ];

        const { sharedFolderUids, sharedCollectionUids } = partitionSharedUids(folders, collections);

        expect([...sharedFolderUids]).toEqual(['f2']);
        expect([...sharedCollectionUids]).toEqual(['c2']);
    });
});

describe('prepareSyncDataForUpload excludes shared data from the Drive payload', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        installStorageMock();
    });

    test('shared folders, their collections, and their tombstones never enter the Drive payload', async () => {
        await browser.storage.local.set({
            folders_index: {
                f1: { uid: 'f1', name: 'Private' },
                f2: { uid: 'f2', name: 'Team', shared: { folderId: 'f2', role: 'owner' } },
            },
            folder_f1: { uid: 'f1', name: 'Private', type: 'folder' },
            folder_f2: { uid: 'f2', name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } },
            collections_index: { c1: { uid: 'c1', parentId: 'f1' }, c2: { uid: 'c2', parentId: 'f2' } },
            collection_c1: { uid: 'c1', name: 'Mine', parentId: 'f1', tabs: [] },
            collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [] },
            deleted_collection_tombstones: { c2: Date.now(), c9: Date.now() },
            deleted_folder_tombstones: { f2: Date.now() },
        });

        const payload = await prepareSyncDataForUpload();

        expect(payload.tabsArray.map((c) => c.uid)).toEqual(['c1']);
        expect(payload.foldersArray.map((f) => f.uid)).toEqual(['f1']);
        // Tombstones are arrays of {uid, lastUpdated} here (not the object map the raw
        // storage keys use) - assert against the real shape prepareSyncDataForUpload emits.
        expect(payload.deletedCollections.map((t) => t.uid)).toEqual(['c9']);
        expect(payload.deletedFolders.map((t) => t.uid)).toEqual([]);
    });

    test('a tombstoned collection remembered as shared via shared_sync_state.knownUids is excluded even without a live folder marker', async () => {
        await browser.storage.local.set({
            folders_index: {},
            collections_index: {},
            deleted_collection_tombstones: { c5: 100, c6: 200 },
            deleted_folder_tombstones: {},
            shared_sync_state: { f9: { lastRev: 3, lastSyncedAt: 1, knownUids: ['c5'] } },
        });

        const payload = await prepareSyncDataForUpload();

        expect(payload.deletedCollections.map((t) => t.uid)).toEqual(['c6']);
    });

    test('a folder tombstone still tracked in shared_sync_state is excluded from the payload', async () => {
        await browser.storage.local.set({
            folders_index: {},
            collections_index: {},
            deleted_collection_tombstones: {},
            deleted_folder_tombstones: { f9: 100 },
            shared_sync_state: { f9: { lastRev: 1, lastSyncedAt: 1, knownUids: [] } },
        });

        const payload = await prepareSyncDataForUpload();

        expect(payload.deletedFolders).toEqual([]);
    });

    test('non-shared data and tombstones are left untouched', async () => {
        await browser.storage.local.set({
            folders_index: { f1: { uid: 'f1', name: 'Private' } },
            folder_f1: { uid: 'f1', name: 'Private', type: 'folder' },
            collections_index: { c1: { uid: 'c1', parentId: 'f1' } },
            collection_c1: { uid: 'c1', name: 'Mine', parentId: 'f1', tabs: [] },
            deleted_collection_tombstones: { c9: 1 },
            deleted_folder_tombstones: {},
        });

        const payload = await prepareSyncDataForUpload();

        expect(payload.tabsArray.map((c) => c.uid)).toEqual(['c1']);
        expect(payload.foldersArray.map((f) => f.uid)).toEqual(['f1']);
        expect(payload.deletedCollections.map((t) => t.uid)).toEqual(['c9']);
    });

    test('the incremental-sync path also excludes shared folders/collections', async () => {
        await browser.storage.local.set({
            lastSyncTimestamp: 100,
            folders_index: {
                f1: { uid: 'f1', name: 'Private', lastUpdated: 200 },
                f2: { uid: 'f2', name: 'Team', shared: { folderId: 'f2', role: 'owner' }, lastUpdated: 200 },
            },
            folder_f1: { uid: 'f1', name: 'Private', type: 'folder', lastUpdated: 200 },
            folder_f2: { uid: 'f2', name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' }, lastUpdated: 200 },
            collections_index: {
                c1: { uid: 'c1', parentId: 'f1', lastUpdated: 200 },
                c2: { uid: 'c2', parentId: 'f2', lastUpdated: 200 },
            },
            collection_c1: { uid: 'c1', name: 'Mine', parentId: 'f1', tabs: [], lastUpdated: 200 },
            collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [], lastUpdated: 200 },
        });

        const payload = await prepareSyncDataForUpload(undefined, true);

        expect(payload.isIncrementalSync).toBe(true);
        expect(payload.tabsArray.map((c) => c.uid)).toEqual(['c1']);
        expect(payload.foldersArray.map((f) => f.uid)).toEqual(['f1']);
        expect(payload.changedCollectionCount).toBe(1);
        expect(payload.changedFolderCount).toBe(1);
    });
});

describe('chrome/sync-apply.js protects shared folders/collections from Drive pulls', () => {
    // Requiring lazily (rather than a top-level import) keeps this block symmetric with
    // the rest of the file and avoids any ambiguity about module-registry timing.
    const { buildIndexedSyncPayload, applySyncSnapshotAtomically, isSharedFolderRecord: isSharedFolderRecordSyncApply } =
        require('../chrome/sync-apply.js');

    test('isSharedFolderRecord (local copy) requires shared.folderId', () => {
        expect(isSharedFolderRecordSyncApply({ uid: 'f1', shared: { folderId: 'f1' } })).toBe(true);
        expect(isSharedFolderRecordSyncApply({ uid: 'f1' })).toBe(false);
        expect(isSharedFolderRecordSyncApply({ uid: 'f1', shared: {} })).toBe(false);
        expect(isSharedFolderRecordSyncApply(null)).toBe(false);
    });

    test('drops an incoming update to a locally shared folder while still syncing an unrelated private folder', () => {
        const currentStorage = {
            folders_index: {
                f1: { name: 'Private (local)', type: 'folder' },
                f2: { name: 'Team (local)', type: 'folder', shared: { folderId: 'f2', role: 'owner' } },
            },
            folder_f2: {
                uid: 'f2', name: 'Team (local)', type: 'folder', color: 'blue', collapsed: false,
                createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' },
            },
            collections_index: {},
        };
        const syncData = {
            tabsArray: [],
            foldersArray: [
                { uid: 'f1', name: 'Private (from Drive)', color: 'green', collapsed: false, createdOn: 1, lastUpdated: 50 },
                { uid: 'f2', name: 'Team (from Drive)', color: 'red', collapsed: false, createdOn: 1, lastUpdated: 999 },
            ],
        };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        const foldersByUid = Object.fromEntries(payload.folders.map((f) => [f.uid, f]));
        expect(foldersByUid.f1).toEqual(expect.objectContaining({ name: 'Private (from Drive)' }));
        expect(foldersByUid.f2).toEqual(expect.objectContaining({ uid: 'f2', name: 'Team (local)', color: 'blue' }));
        expect(payload.removeKeys).toEqual([]);
    });

    test('drops an incoming update to a locally shared collection even when it reports a different parentId', () => {
        const currentStorage = {
            folders_index: {
                f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } },
            },
            folder_f2: {
                uid: 'f2', name: 'Team', type: 'folder', color: 'blue', collapsed: false,
                createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' },
            },
            collections_index: {
                c2: { name: 'Ours (local)', type: 'collection', parentId: 'f2' },
                c9: { name: 'Local Only', type: 'collection', parentId: null },
            },
            collection_c2: { uid: 'c2', name: 'Ours (local)', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 2 },
        };
        const syncData = {
            tabsArray: [
                { uid: 'c2', name: 'Ours (tampered)', parentId: null, tabs: [], createdOn: 1, lastUpdated: 999 },
                { uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 5 },
            ],
            foldersArray: [],
        };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        const byUid = Object.fromEntries(payload.collections.map((c) => [c.uid, c]));
        expect(byUid.c1).toEqual(expect.objectContaining({ name: 'Mine' }));
        expect(byUid.c2).toEqual(expect.objectContaining({ name: 'Ours (local)', parentId: 'f2' }));
    });

    test('drops a brand new incoming collection that targets a locally shared folder', () => {
        const currentStorage = {
            folders_index: {
                f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } },
            },
            folder_f2: {
                uid: 'f2', name: 'Team', type: 'folder', color: 'blue', collapsed: false,
                createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' },
            },
            collections_index: {
                c2: { name: 'Ours', type: 'collection', parentId: 'f2' },
            },
            collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 2 },
        };
        const syncData = {
            tabsArray: [
                { uid: 'c-foreign', name: 'Injected', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 5 },
                { uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 5 },
            ],
            foldersArray: [],
        };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        expect(payload.collections.map((c) => c.uid).sort()).toEqual(['c1', 'c2']);
        expect(payload.removeKeys).toEqual([]);
    });

    test('skips an incoming folder tombstone for a locally shared folder', () => {
        const currentStorage = {
            folders_index: { f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } } },
            folder_f2: { uid: 'f2', name: 'Team', type: 'folder', createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' } },
            collections_index: {},
        };
        const syncData = {
            tabsArray: [{ uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 5 }],
            foldersArray: [],
            deletedFolders: [
                { uid: 'f2', lastUpdated: 999 },
                { uid: 'f-other', lastUpdated: 111 },
            ],
        };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        expect(payload.setPayload.deleted_folder_tombstones).toEqual({ 'f-other': 111 });
        expect(payload.folders.map((f) => f.uid)).toEqual(['f2']);
    });

    test('skips an incoming collection tombstone for a locally shared collection', () => {
        const currentStorage = {
            folders_index: { f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } } },
            folder_f2: { uid: 'f2', name: 'Team', type: 'folder', createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' } },
            collections_index: { c2: { name: 'Ours', type: 'collection', parentId: 'f2' } },
            collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 2 },
        };
        const syncData = {
            tabsArray: [{ uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 5 }],
            foldersArray: [],
            deletedCollections: [
                { uid: 'c2', lastUpdated: 999 },
                { uid: 'c-other', lastUpdated: 111 },
            ],
        };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        expect(payload.setPayload.deleted_collection_tombstones).toEqual({ 'c-other': 111 });
        expect(payload.collections.map((c) => c.uid).sort()).toEqual(['c1', 'c2']);
    });

    test('preserves a locally shared folder/collection when the incoming snapshot is completely empty', () => {
        const currentStorage = {
            folders_index: { f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } } },
            folder_f2: { uid: 'f2', name: 'Team', type: 'folder', createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' } },
            collections_index: { c2: { name: 'Ours', type: 'collection', parentId: 'f2' } },
            collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 2 },
        };
        const syncData = { tabsArray: [], foldersArray: [] };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        expect(payload.folders.map((f) => f.uid)).toEqual(['f2']);
        expect(payload.collections.map((c) => c.uid)).toEqual(['c2']);
        expect(payload.removeKeys).toEqual([]);
    });

    test('omits a shared folder/collection gracefully when its index entry has no matching full record', () => {
        const currentStorage = {
            folders_index: { f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } } },
            // folder_f2 deliberately missing - index/record store out of sync.
            collections_index: { c2: { name: 'Ours', type: 'collection', parentId: 'f2' } },
            // collection_c2 deliberately missing.
        };
        const syncData = {
            tabsArray: [{ uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 5 }],
            foldersArray: [],
        };

        const payload = buildIndexedSyncPayload({ currentStorage, syncData });

        expect(payload.folders).toEqual([]);
        expect(payload.collections.map((c) => c.uid)).toEqual(['c1']);
    });

    test('applySyncSnapshotAtomically never deletes or overwrites a locally shared folder/collection from a pulled Drive snapshot', async () => {
        const initialData = {
            folders_index: { f2: { name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } } },
            folder_f2: { uid: 'f2', name: 'Team', type: 'folder', createdOn: 1, lastUpdated: 2, shared: { folderId: 'f2', role: 'owner' } },
            collections_index: { c2: { name: 'Ours', type: 'collection', parentId: 'f2' } },
            collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 2 },
        };
        let store = JSON.parse(JSON.stringify(initialData));
        const storageArea = {
            get: jest.fn(async (keys) => {
                if (keys === null || keys === undefined) return JSON.parse(JSON.stringify(store));
                const names = Array.isArray(keys) ? keys : [keys];
                return names.reduce((acc, k) => (store[k] !== undefined ? { ...acc, [k]: store[k] } : acc), {});
            }),
            set: jest.fn(async (items) => { Object.assign(store, JSON.parse(JSON.stringify(items))); }),
            remove: jest.fn(async (keys) => {
                (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
            }),
        };

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: {
                tabsArray: [{ uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 5 }],
                foldersArray: [],
                deletedFolders: [{ uid: 'f2', lastUpdated: 999 }],
                deletedCollections: [{ uid: 'c2', lastUpdated: 999 }],
            },
        });

        expect(result.success).toBe(true);
        expect(store.folder_f2).toEqual(expect.objectContaining({ name: 'Team' }));
        expect(store.collection_c2).toEqual(expect.objectContaining({ name: 'Ours' }));
        expect(store.deleted_folder_tombstones).toEqual({});
        expect(store.deleted_collection_tombstones).toEqual({});
    });
});

describe('chrome/background.js strips the shared marker on import and backup restore', () => {
    let browserHarness;
    let foldersState;
    let collectionsState;

    beforeEach(() => {
        jest.resetModules();
        const { createBrowserHarness } = require('./helpers/browserHarness');

        foldersState = [];
        collectionsState = [];
        browserHarness = createBrowserHarness();

        global.browser = browserHarness;
        global.chrome = { runtime: browserHarness.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.loadAllCollectionsBG = jest.fn(async () => collectionsState);
        global.loadAllFoldersBG = jest.fn(async () => foldersState);
        global.loadSingleCollectionBG = jest.fn(async (uid) => collectionsState.find((c) => c.uid === uid) || { uid });
        global.loadSingleFolderBG = jest.fn(async (uid) => foldersState.find((f) => f.uid === uid) || null);
        global.saveSingleCollectionBG = jest.fn(async (collection) => {
            const index = collectionsState.findIndex((entry) => entry.uid === collection.uid);
            if (index > -1) {
                collectionsState[index] = { ...collectionsState[index], ...collection };
            } else {
                collectionsState.push({ ...collection });
            }
            return true;
        });
        global.saveSingleFolderBG = jest.fn(async (folder) => {
            const index = foldersState.findIndex((entry) => entry.uid === folder.uid);
            if (index > -1) {
                foldersState[index] = { ...folder };
            } else {
                foldersState.push({ ...folder });
            }
            return true;
        });
        global.forceLegacyStorageSync = jest.fn(async () => {});
        global.generateUid = jest.fn(() => `generated-uid-${foldersState.length + collectionsState.length + 1}`);
        global.applyUid = jest.fn((value) => value);
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.loadAllCollectionsBG;
        delete global.loadAllFoldersBG;
        delete global.loadSingleCollectionBG;
        delete global.loadSingleFolderBG;
        delete global.saveSingleCollectionBG;
        delete global.saveSingleFolderBG;
        delete global.forceLegacyStorageSync;
        delete global.generateUid;
        delete global.applyUid;
    });

    test('full_export import strips the shared marker from an imported folder', async () => {
        require('../chrome/background.js');

        const result = await browserHarness.runtime.sendMessage({
            type: 'importData',
            data: {
                type: 'full_export',
                folders: [
                    { uid: 'orig-1', name: 'Shared Folder', color: 'blue', shared: { folderId: 'orig-1', role: 'owner', members: [] } },
                ],
                collections: [],
            },
        });

        expect(result.success).toBe(true);
        expect(foldersState).toHaveLength(1);
        expect(foldersState[0].name).toBe('Shared Folder');
        expect(foldersState[0].shared).toBeUndefined();
    });

    test('single-folder import strips the shared marker from the imported folder', async () => {
        require('../chrome/background.js');

        const result = await browserHarness.runtime.sendMessage({
            type: 'importData',
            data: {
                type: 'folder',
                folder: { uid: 'orig-2', name: 'Team', color: 'red', shared: { folderId: 'orig-2', role: 'member', members: [] } },
                collections: [],
            },
        });

        expect(result.success).toBe(true);
        expect(foldersState).toHaveLength(1);
        expect(foldersState[0].name).toBe('Team');
        expect(foldersState[0].shared).toBeUndefined();
    });

    test('backup-restore overwrite strips the shared marker from a restored folder', async () => {
        require('../chrome/background.js');

        const result = await browserHarness.runtime.sendMessage({
            type: 'restoreBackupSelection',
            mode: 'overwrite',
            payload: {
                folders: [
                    { uid: 'f2', name: 'Team', color: 'blue', collapsed: false, shared: { folderId: 'f2', role: 'owner', members: [] } },
                ],
                collections: [],
            },
        });

        expect(result.success).toBe(true);
        expect(foldersState).toHaveLength(1);
        expect(foldersState[0].uid).toBe('f2');
        expect(foldersState[0].shared).toBeUndefined();
    });

    test('recoverFromBackup (full restore) strips the shared marker from every restored folder', async () => {
        // recoverFromBackup funnels through overwriteBackupSelection with pruneMissingFolders,
        // covering the "full restore" variant of the same code path exercised above.
        const { createBrowserHarness } = require('./helpers/browserHarness');
        browserHarness = createBrowserHarness({
            localData: {
                backup: {
                    version: '4.0.0',
                    timestamp: 1,
                    tabsArray: [],
                    foldersArray: [
                        { uid: 'f3', name: 'Was Shared', color: 'green', collapsed: false, shared: { folderId: 'f3', role: 'owner', members: [] } },
                    ],
                },
            },
        });
        global.browser = browserHarness;
        global.chrome = { runtime: browserHarness.runtime };

        require('../chrome/background.js');

        const result = await browserHarness.runtime.sendMessage({
            type: 'recoverFromBackup',
            backupType: 'version',
        });

        expect(result).toBe(true);
        expect(foldersState).toHaveLength(1);
        expect(foldersState[0].uid).toBe('f3');
        expect(foldersState[0].shared).toBeUndefined();
    });
});
