// syncData's "local claims newer" safety check must measure the same data set the
// upload would actually send: shared folders/collections are excluded from every
// Drive push (excludeSharedFromSyncData), so a device whose only content lives in
// shared folders is EMPTY from Drive's point of view and must download, not push.
const { createBrowserHarness } = require('./helpers/browserHarness');

const REMOTE_TIMESTAMP = 100000;
// Keep local far enough ahead of remote (> 60s) that syncData takes the plain
// "local is newer" push path rather than the conflict-merge path.
const LOCAL_TIMESTAMP = 900000;

const buildRemoteDoc = () => ({
    timestamp: REMOTE_TIMESTAMP,
    syncVersion: '4.0',
    storageVersion: 3,
    tabsArray: [
        { uid: 'r1', name: 'Remote Collection', tabs: [], chromeGroups: [], createdOn: 1, lastUpdated: 2 }
    ],
    foldersArray: []
});

// Local storage where the ONLY collection lives inside a shared folder.
const sharedOnlyLocalData = () => ({
    localTimestamp: LOCAL_TIMESTAMP,
    folders_index: {
        f2: { uid: 'f2', name: 'Team', shared: { folderId: 'f2', role: 'owner' } }
    },
    folder_f2: { uid: 'f2', name: 'Team', type: 'folder', shared: { folderId: 'f2', role: 'owner' } },
    collections_index: { c2: { uid: 'c2', parentId: 'f2' } },
    collection_c2: { uid: 'c2', name: 'Ours', parentId: 'f2', tabs: [], createdOn: 1, lastUpdated: 2 }
});

describe('syncData shared-aware empty-local safety check', () => {
    let browser;
    let errorSpy;
    let logSpy;
    let mediaUploadUrls;

    const installFetchMock = () => {
        mediaUploadUrls = [];
        global.fetch = jest.fn(async (url, init = {}) => {
            if (url.includes('alt=media') && (!init.method || init.method === 'GET')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => buildRemoteDoc()
                };
            }

            if (url.includes('uploadType=media')) {
                mediaUploadUrls.push(url);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ id: 'remote-file-id', uploaded: true })
                };
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({})
            };
        });
    };

    const runSyncData = async (backgroundUtils) => {
        const syncPromise = backgroundUtils.syncData('token-123');
        await jest.runAllTimersAsync();
        return syncPromise;
    };

    const findLogLine = (spy, fragment) =>
        spy.mock.calls
            .map((call) => call[0])
            .find((entry) => typeof entry === 'string' && entry.includes(fragment));

    beforeEach(() => {
        jest.resetModules();
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.useFakeTimers();
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        browser.storage.sync._data = { syncFileId: 'remote-file-id' };
        installFetchMock();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.fetch;
    });

    test('local with ONLY shared collections is treated as empty: downloads instead of pushing', async () => {
        browser.storage.local._data = sharedOnlyLocalData();
        const backgroundUtils = require('../chrome/background-utils.js');

        const result = await runSyncData(backgroundUtils);

        expect(result).toBe(true);
        // Safety block fired with both counts in the payload.
        const safetyLog = findLogLine(errorSpy, 'SAFETY BLOCK: Local claims newer but has no data while server has data');
        expect(safetyLog).toBeDefined();
        expect(safetyLog).toContain('localCollectionCount=0');
        expect(safetyLog).toContain('sharedCollectionCount=1');
        // Download path taken: local timestamp adopted from server, nothing pushed.
        expect(browser.storage.local._data.localTimestamp).toBe(REMOTE_TIMESTAMP);
        expect(mediaUploadUrls).toEqual([]);
    });

    test('local with at least one non-shared collection still pushes (safety block does not fire)', async () => {
        browser.storage.local._data = {
            ...sharedOnlyLocalData(),
            collections_index: {
                c1: { uid: 'c1', parentId: null },
                c2: { uid: 'c2', parentId: 'f2' }
            },
            collection_c1: { uid: 'c1', name: 'Mine', parentId: null, tabs: [], createdOn: 1, lastUpdated: 2 }
        };
        const backgroundUtils = require('../chrome/background-utils.js');

        const result = await runSyncData(backgroundUtils);

        expect(result).toBe(true);
        expect(findLogLine(errorSpy, 'SAFETY BLOCK: Local claims newer but has no data while server has data')).toBeUndefined();
        // Push path proceeded and logged the non-shared count.
        const pushLog = findLogLine(logSpy, 'Local data is newer, updating remote');
        expect(pushLog).toBeDefined();
        expect(pushLog).toContain('localCollectionCount=1');
        expect(mediaUploadUrls.length).toBeGreaterThan(0);
    });

    test('local with only shared collections but a non-shared folder still pushes (folders are Drive data)', async () => {
        // Regression: adding a plain folder on a device whose collections all live in
        // shared folders must push (the folder rides in foldersArray) - not trip the
        // safety block, download, and clobber the brand-new folder as a stale key.
        browser.storage.local._data = {
            ...sharedOnlyLocalData(),
            folders_index: {
                f2: { uid: 'f2', name: 'Team', shared: { folderId: 'f2', role: 'owner' } },
                f3: { uid: 'f3', name: 'Brand New Plain Folder' }
            },
            folder_f3: { uid: 'f3', name: 'Brand New Plain Folder', type: 'folder', createdOn: 1, lastUpdated: 2 }
        };
        const backgroundUtils = require('../chrome/background-utils.js');

        const result = await runSyncData(backgroundUtils);

        expect(result).toBe(true);
        expect(findLogLine(errorSpy, 'SAFETY BLOCK: Local claims newer but has no data while server has data')).toBeUndefined();
        expect(findLogLine(errorSpy, 'SAFETY BLOCK: Refusing to push empty data to server')).toBeUndefined();
        const pushLog = findLogLine(logSpy, 'Local data is newer, updating remote');
        expect(pushLog).toBeDefined();
        expect(pushLog).toContain('nonSharedFolderCount=1');
        expect(mediaUploadUrls.length).toBeGreaterThan(0);
        // The new plain folder must survive the sync untouched.
        expect(browser.storage.local._data.folder_f3).toBeDefined();
    });

    test('falls back to counting all collections when partitionSharedUids is unavailable', async () => {
        jest.doMock('../chrome/shared-folders.js', () => ({}));
        browser.storage.local._data = sharedOnlyLocalData();
        const backgroundUtils = require('../chrome/background-utils.js');

        const result = await runSyncData(backgroundUtils);

        // No crash; legacy behavior preserved: the lone (shared) collection counts as
        // data, so the safety block does not fire and the push path proceeds.
        expect(result).toBe(true);
        expect(findLogLine(errorSpy, 'SAFETY BLOCK: Local claims newer but has no data while server has data')).toBeUndefined();
        const pushLog = findLogLine(logSpy, 'Local data is newer, updating remote');
        expect(pushLog).toBeDefined();
        expect(pushLog).toContain('localCollectionCount=1');
    });
});
