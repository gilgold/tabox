// Task 10/13: chrome/background.js's tab-tracking auto-update (handleAutoUpdate)
// must never persist a local write for a collection that lives in a read-only
// shared folder — the shared-folders sync engine (chrome/shared-folders.js)
// treats the server as the source of truth for read-role folders, so a local
// auto-update here would just get discarded (or race) on the next pull.
// Mirrors the harness/mocking pattern used by tests/backgroundSyncSafety.followups.test.js
// for this same handleAutoUpdate code path.
const { createBrowserHarness } = require('./helpers/browserHarness');

describe('shared folder auto-update guard', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        browser = createBrowserHarness({
            localData: {
                googleUser: { email: 'sync@example.com' },
                googleRefreshToken: 'refresh-token',
                chkEnableAutoUpdate: true,
                collectionsToTrack: [
                    { windowId: 1, collectionUid: 'collection-shared-read' }
                ]
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.loadAllCollectionsBG = jest.fn(async () => ([]));
        global.updateCollection = jest.fn(async () => ({
            uid: 'collection-shared-read',
            name: 'Shared Read Collection',
            parentId: 'folder-shared-read',
            tabs: [
                { url: 'https://alpha.example.com', title: 'Alpha' },
                { url: 'https://alpha.example.com/new', title: 'Alpha New' }
            ],
            chromeGroups: []
        }));
        global.saveSingleCollectionBG = jest.fn(async () => true);
        global.getAuthToken = jest.fn(async () => 'token-123');
        global.syncData = jest.fn(async () => true);
        global.updateRemote = jest.fn(async () => true);
        global.updateLocalDataFromServer = jest.fn(async () => []);
        global.logSyncOperation = jest.fn();
        global.handleContextMenuCreation = jest.fn(async () => {});
        global.cleanupLargeBackups = jest.fn(async () => {});
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.loadAllCollectionsBG;
        delete global.loadSingleCollectionBG;
        delete global.loadSingleFolderBG;
        delete global.updateCollection;
        delete global.saveSingleCollectionBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.updateRemote;
        delete global.updateLocalDataFromServer;
        delete global.logSyncOperation;
        delete global.handleContextMenuCreation;
        delete global.cleanupLargeBackups;
    });

    test('skips persisting an auto-update for a collection whose parent folder is read-only shared', async () => {
        global.loadSingleCollectionBG = jest.fn(async () => ({
            uid: 'collection-shared-read',
            name: 'Shared Read Collection',
            parentId: 'folder-shared-read',
            tabs: [{ url: 'https://alpha.example.com', title: 'Alpha' }],
            chromeGroups: []
        }));
        global.loadSingleFolderBG = jest.fn(async (uid) => (
            uid === 'folder-shared-read'
                ? { uid: 'folder-shared-read', name: 'Team', shared: { folderId: 'folder-shared-read', role: 'read' } }
                : null
        ));

        require('../chrome/background.js');

        await browser.tabs.onCreated.trigger({ id: 10, windowId: 1 });
        await jest.runAllTimersAsync();

        expect(global.loadSingleFolderBG).toHaveBeenCalledWith('folder-shared-read');
        expect(global.saveSingleCollectionBG).not.toHaveBeenCalled();
    });

    test('still persists an auto-update for a collection in a write-role shared folder', async () => {
        global.loadSingleCollectionBG = jest.fn(async () => ({
            uid: 'collection-shared-read',
            name: 'Shared Write Collection',
            parentId: 'folder-shared-write',
            tabs: [{ url: 'https://alpha.example.com', title: 'Alpha' }],
            chromeGroups: []
        }));
        global.loadSingleFolderBG = jest.fn(async (uid) => (
            uid === 'folder-shared-write'
                ? { uid: 'folder-shared-write', name: 'Team', shared: { folderId: 'folder-shared-write', role: 'write' } }
                : null
        ));

        require('../chrome/background.js');

        await browser.tabs.onCreated.trigger({ id: 10, windowId: 1 });
        await jest.runAllTimersAsync();

        expect(global.saveSingleCollectionBG).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-shared-read',
            lastUpdated: expect.any(Number)
        }), true);
    });

    test('still persists an auto-update for a collection with no parent folder (unfiled)', async () => {
        global.loadSingleCollectionBG = jest.fn(async () => ({
            uid: 'collection-shared-read',
            name: 'Unfiled Collection',
            tabs: [{ url: 'https://alpha.example.com', title: 'Alpha' }],
            chromeGroups: []
        }));
        global.loadSingleFolderBG = jest.fn(async () => null);

        require('../chrome/background.js');

        await browser.tabs.onCreated.trigger({ id: 10, windowId: 1 });
        await jest.runAllTimersAsync();

        expect(global.loadSingleFolderBG).not.toHaveBeenCalled();
        expect(global.saveSingleCollectionBG).toHaveBeenCalled();
    });
});
