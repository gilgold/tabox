// Task 9/Task 15 review follow-up: two data-safety gaps in the backup-restore path
// (chrome/background.js overwriteBackupSelection) plus one in the unshare path
// (chrome/shared-folders.js unmarkLocalFolderShared):
//
//   1. Restoring a backup must not strip a `shared` marker for a folder that is
//      CURRENTLY live-shared - auto-backups are plain snapshots of everything (unlike
//      the Drive sync payload, which Task 9 already excludes shared data from), so a
//      routine backup taken while a folder was shared still contains it. Restoring that
//      backup must not silently unshare it locally (which would make the next Drive
//      sync upload it - the exact leak Task 9 prevents).
//   2. A full-backup restore's prune step (`pruneMissingFolders`) must never delete a
//      folder that's currently live-shared, even though shared folders are never part
//      of the backup selection (they're worker-owned, not backup-owned).
//   3. Unsharing a folder must purge its tombstones (deleted_collection_tombstones for
//      every uid in shared_sync_state[folderId].knownUids, plus the folder's own entry
//      in deleted_folder_tombstones) - otherwise stale tombstones leak into the next
//      Drive upload once the suppressing sync-state entry is gone.
//
// NOTE ON ORDERING: the shared-folders.js describe block runs FIRST because it relies
// on the top-level `import { browser } from '../static/globals'` (jest-webextension-mock's
// singleton). The background.js describe block below it reassigns AND `delete`s
// `global.browser` per test (mirroring tests/sharedDriveSyncExclusion.test.js's harness
// pattern) - running it first would leave `global.browser` deleted for the rest of the
// file, breaking shared-folders.js's own bare `browser` references.

import { browser } from '../static/globals';
import { unmarkLocalFolderShared } from '../chrome/shared-folders';

jest.mock('../chrome/background-utils', () => ({
    ...jest.requireActual('../chrome/background-utils'),
    getAuthToken: jest.fn(),
}));

const { createBrowserHarness } = require('./helpers/browserHarness');

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as static
// jest.fn()s (no real backing store), so install a tiny in-memory store here — mirrors
// tests/sharedFoldersClient.test.js and tests/sharedSyncEngine.test.js.
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

describe('chrome/shared-folders.js unmarkLocalFolderShared - tombstone purge on unshare', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        installStorageMock();
    });

    test('(c) unsharing purges the folder\'s known-collection tombstones and its own folder tombstone', async () => {
        await browser.storage.local.set({
            folder_f1: { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'owner' } },
            folders_index: { f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'owner' } } },
            shared_sync_state: { f1: { lastRev: 3, lastSyncedAt: 100, knownUids: ['c1', 'c2'] } },
            deleted_collection_tombstones: { c1: 500, c2: 600, 'unrelated-c': 700 },
            deleted_folder_tombstones: { f1: 800, 'unrelated-f': 900 },
        });

        await unmarkLocalFolderShared('f1');

        const after = await browser.storage.local.get([
            'folder_f1', 'folders_index', 'shared_sync_state',
            'deleted_collection_tombstones', 'deleted_folder_tombstones',
        ]);

        expect(after.folder_f1.shared).toBeUndefined();
        expect(after.folders_index.f1.shared).toBeUndefined();
        expect(after.shared_sync_state.f1).toBeUndefined();
        // c1/c2 (this folder's knownUids) are purged; the unrelated tombstone survives.
        expect(after.deleted_collection_tombstones).toEqual({ 'unrelated-c': 700 });
        // The folder's own tombstone is purged; the unrelated one survives.
        expect(after.deleted_folder_tombstones).toEqual({ 'unrelated-f': 900 });
    });

    test('unsharing a folder with no prior tombstones is a no-op on the tombstone keys', async () => {
        await browser.storage.local.set({
            folder_f3: { uid: 'f3', name: 'Solo', type: 'folder', shared: { folderId: 'f3', role: 'owner' } },
            folders_index: { f3: { uid: 'f3', name: 'Solo', shared: { folderId: 'f3', role: 'owner' } } },
            shared_sync_state: { f3: { lastRev: 1, lastSyncedAt: 1, knownUids: [] } },
        });

        await unmarkLocalFolderShared('f3');

        const after = await browser.storage.local.get(['folder_f3', 'deleted_collection_tombstones', 'deleted_folder_tombstones']);
        expect(after.folder_f3.shared).toBeUndefined();
        expect(after.deleted_collection_tombstones).toEqual({});
        expect(after.deleted_folder_tombstones).toEqual({});
    });
});

describe('chrome/background.js overwriteBackupSelection - shared-folder restore guards', () => {
    let browserHarness;
    let foldersState;
    let collectionsState;
    let deleteSingleFolderBGCalls;

    function setupHarness({ localData } = {}) {
        foldersState = [];
        collectionsState = [];
        deleteSingleFolderBGCalls = [];
        browserHarness = createBrowserHarness(localData ? { localData } : {});

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
        global.deleteSingleFolderBG = jest.fn(async (uid) => {
            deleteSingleFolderBGCalls.push(uid);
            const index = foldersState.findIndex((entry) => entry.uid === uid);
            if (index > -1) {
                foldersState.splice(index, 1);
                return true;
            }
            return false;
        });
        global.forceLegacyStorageSync = jest.fn(async () => {});
        global.generateUid = jest.fn(() => `generated-uid-${foldersState.length + collectionsState.length + 1}`);
        global.applyUid = jest.fn((value) => value);
    }

    beforeEach(() => {
        jest.resetModules();
        setupHarness();
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
        delete global.deleteSingleFolderBG;
        delete global.forceLegacyStorageSync;
        delete global.generateUid;
        delete global.applyUid;
    });

    test('(a) restoring a backup containing a currently-live shared folder keeps the live marker', async () => {
        // The folder is CURRENTLY shared in local storage...
        foldersState.push({
            uid: 'f1', name: 'Team', color: 'blue', collapsed: false,
            shared: { folderId: 'f1', role: 'owner', members: [{ email: 'a@x.com', role: 'read' }] },
        });

        require('../chrome/background.js');

        // ...but the backup selection being restored has no marker at all (e.g. an older
        // snapshot, or a folder record that came from a path that already stripped it).
        const result = await browserHarness.runtime.sendMessage({
            type: 'restoreBackupSelection',
            mode: 'overwrite',
            payload: {
                folders: [{ uid: 'f1', name: 'Team (renamed in backup)', color: 'blue', collapsed: false }],
                collections: [],
            },
        });

        expect(result.success).toBe(true);
        const restored = foldersState.find((f) => f.uid === 'f1');
        expect(restored).toBeDefined();
        // The CURRENT live marker wins - it must not be stripped just because the
        // backup's own folder record didn't carry one.
        expect(restored.shared).toEqual({ folderId: 'f1', role: 'owner', members: [{ email: 'a@x.com', role: 'read' }] });
        // Everything else about the restored folder (name, etc.) still comes from the backup.
        expect(restored.name).toBe('Team (renamed in backup)');
    });

    test('a folder that is NOT currently shared still has its backup `shared` marker stripped', async () => {
        // No current folder f2 at all (e.g. it was deleted locally since the backup was taken).
        require('../chrome/background.js');

        const result = await browserHarness.runtime.sendMessage({
            type: 'restoreBackupSelection',
            mode: 'overwrite',
            payload: {
                folders: [{ uid: 'f2', name: 'Stale Team', color: 'red', collapsed: false, shared: { folderId: 'f2', role: 'owner', members: [] } }],
                collections: [],
            },
        });

        expect(result.success).toBe(true);
        const restored = foldersState.find((f) => f.uid === 'f2');
        expect(restored).toBeDefined();
        expect(restored.shared).toBeUndefined();
    });

    test('(b) prune (full-restore) skips deleting a currently-live shared folder even when absent from the backup', async () => {
        foldersState.push(
            { uid: 'f1', name: 'Team', color: 'blue', collapsed: false, shared: { folderId: 'f1', role: 'owner', members: [] } },
            { uid: 'f2', name: 'Plain Folder', color: 'gray', collapsed: false },
        );

        require('../chrome/background.js');

        // Full-backup restore: the backup selection contains neither folder (simulating a
        // Drive-sync-derived backup, which never includes shared folders per Task 9).
        const result = await browserHarness.runtime.sendMessage({
            type: 'restoreBackupSelection',
            mode: 'overwrite',
            payload: { folders: [], collections: [], pruneMissingFolders: true },
        });

        expect(result.success).toBe(true);
        // f2 (plain, not shared) gets pruned...
        expect(deleteSingleFolderBGCalls).toEqual(['f2']);
        expect(result.removedFolders).toBe(1);
        // ...but f1 (currently live-shared) survives, marker intact.
        const survivor = foldersState.find((f) => f.uid === 'f1');
        expect(survivor).toBeDefined();
        expect(survivor.shared).toEqual({ folderId: 'f1', role: 'owner', members: [] });
        expect(foldersState.find((f) => f.uid === 'f2')).toBeUndefined();
    });

    test('(b) recoverFromBackup (full restore) also skips pruning a currently-live shared folder', async () => {
        setupHarness({
            localData: {
                backup: {
                    version: '4.0.0',
                    timestamp: 1,
                    tabsArray: [],
                    foldersArray: [],
                },
            },
        });
        foldersState.push({ uid: 'f1', name: 'Team', color: 'blue', collapsed: false, shared: { folderId: 'f1', role: 'owner', members: [] } });

        require('../chrome/background.js');

        const result = await browserHarness.runtime.sendMessage({ type: 'recoverFromBackup', backupType: 'version' });

        expect(result).toBe(true);
        expect(deleteSingleFolderBGCalls).toEqual([]);
        const survivor = foldersState.find((f) => f.uid === 'f1');
        expect(survivor).toBeDefined();
        expect(survivor.shared).toEqual({ folderId: 'f1', role: 'owner', members: [] });
    });
});
