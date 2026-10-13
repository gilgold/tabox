// Issue #67: a device that has never completed a sync against the account's Drive
// file must NOT resolve sync by raw timestamp comparison — outside the 60s conflict
// window that meant a wholesale overwrite in one direction or the other:
//  - local "newer" (e.g. collections created while logged out, then first login):
//    updateRemote overwrote the Drive file with only the sparse local data, wiping
//    every other device on their next pull;
//  - remote "newer": the plain download applied the remote snapshot atomically and
//    removed the local-only collections as stale keys.
// First sync on a device must go through mergeSyncSnapshots in both directions.

const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot, createVersion40RemoteDocument } = require('./helpers/upgradeFixtures');

describe('first-login sync merges instead of overwriting (issue #67)', () => {
    let browser;
    let backgroundUtils;

    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        backgroundUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.fetch;
    });

    const remoteOnlyCollection = (template) => ({
        ...cloneValue(template),
        uid: 'collection-remote-only',
        name: 'Remote Only',
        parentId: null,
        lastUpdated: 100000
    });

    const mockDrive = (remoteDocument, serverTimestamp) => {
        const fetchMock = jest.fn(async (url, options = {}) => {
            if (url.includes('/drive/v3/files/remote-file-id?alt=media')) {
                return { ok: true, json: async () => cloneValue(remoteDocument) };
            }
            if (url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media')) {
                return { ok: true, json: async () => ({ id: 'remote-file-id', body: options.body }) };
            }
            return { ok: true, json: async () => ({ modifiedByMeTime: new Date(serverTimestamp).toISOString() }) };
        });
        global.fetch = fetchMock;
        return fetchMock;
    };

    test('local far "newer" on a never-synced device: remote collections survive the first push', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 500000; // way past the 60s conflict window
        delete snapshot.lastSuccessfulSyncTime; // never synced on this device
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = { syncFileId: 'remote-file-id' };

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 100000;
        remoteDocument.tabsArray.push(remoteOnlyCollection(remoteDocument.tabsArray[0]));

        const fetchMock = mockDrive(remoteDocument, remoteDocument.timestamp);

        const result = await backgroundUtils.syncData('token-123');
        expect(result).toBe(true);

        // The merged content already equals Drive: download without rewriting it.
        expect(fetchMock.mock.calls.some(([url]) => url.includes('uploadType=media'))).toBe(false);
        expect(remoteDocument.tabsArray.map(c => c.uid)).toContain('collection-remote-only');

        // And the remote-only collection landed locally too.
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        expect(collections.map((c) => c.uid)).toEqual(expect.arrayContaining(['collection-remote-only']));
    });

    test('remote newer on a never-synced device with local data: local collections survive the first pull', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 100000;
        delete snapshot.lastSuccessfulSyncTime;
        // Give the device a local-only collection the remote has never seen.
        const localOnly = {
            ...cloneValue(snapshot.tabsArray[0]),
            uid: 'collection-local-only',
            name: 'Local Only',
            parentId: null,
            lastUpdated: 100000
        };
        snapshot['collection_collection-local-only'] = localOnly;
        snapshot.collections_index['collection-local-only'] = {
            name: 'Local Only', type: 'collection', parentId: null, lastUpdated: 100000, order: 99
        };
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = { syncFileId: 'remote-file-id' };

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 500000; // remote far newer

        mockDrive(remoteDocument, remoteDocument.timestamp);

        const result = await backgroundUtils.syncData('token-123');
        expect(result).toBe(true);

        // The local-only collection was merged, not removed as a stale key.
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        expect(collections.map((c) => c.uid)).toEqual(expect.arrayContaining(['collection-local-only']));
    });

    test('previously synced devices also preserve remote-only content without redundant uploads', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 500000;
        snapshot.lastSuccessfulSyncTime = 400000; // synced before
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = { syncFileId: 'remote-file-id' };

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 100000;
        remoteDocument.tabsArray.push(remoteOnlyCollection(remoteDocument.tabsArray[0]));
        const fetchMock = mockDrive(remoteDocument, remoteDocument.timestamp);

        const result = await backgroundUtils.syncData('token-123');
        expect(result).toBe(true);

        expect(fetchMock.mock.calls.some(([url]) => url.includes('uploadType=media'))).toBe(false);
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        expect(collections.map(c => c.uid)).toContain('collection-remote-only');
    });
});
