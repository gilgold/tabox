const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot, createVersion40RemoteDocument } = require('./helpers/upgradeFixtures');

describe('sync conflict merge integration', () => {
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

    test('merges disjoint 4.0 collection edits instead of losing one side during a conflict window', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9080;
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const localCollection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');
        localCollection.name = 'Root Alpha (Local)';
        localCollection.lastUpdated = 9060;
        await backgroundUtils.saveSingleCollectionBG(localCollection, false);

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 9090;
        remoteDocument.tabsArray = remoteDocument.tabsArray.map((collection) => (
            collection.uid === 'collection-folder-a'
                ? { ...collection, name: 'Foldered One (Remote)', lastUpdated: 9070 }
                : collection
        ));

        global.fetch = jest.fn(async (url, options = {}) => {
            if (url.includes('/drive/v3/files/remote-file-id?alt=media')) {
                return {
                    ok: true,
                    json: async () => cloneValue(remoteDocument)
                };
            }

            if (url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'remote-file-id', uploaded: true, body: options.body })
                };
            }

            return {
                ok: true,
                json: async () => ({ modifiedByMeTime: new Date(remoteDocument.timestamp).toISOString() })
            };
        });

        const result = await backgroundUtils.syncData('token-123');
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        const patchCall = global.fetch.mock.calls.find(([url]) => url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media'));

        expect(result).toBe(true);
        expect(collections.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                name: 'Root Alpha (Local)'
            })
        );
        expect(collections.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
            expect.objectContaining({
                name: 'Foldered One (Remote)'
            })
        );
        expect(patchCall).toBeDefined();

        const uploadedPayload = JSON.parse(patchCall[1].body);
        expect(uploadedPayload.tabsArray.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                name: 'Root Alpha (Local)'
            })
        );
        expect(uploadedPayload.tabsArray.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
            expect.objectContaining({
                name: 'Foldered One (Remote)'
            })
        );
    });

    test('preserves a local deletion instead of resurrecting the older remote collection during a conflict window', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9095;
        delete snapshot.collection_collection_folder_b;
        delete snapshot.collections_index['collection-folder-b'];
        snapshot.tabsArray = snapshot.tabsArray.filter((collection) => collection.uid !== 'collection-folder-b');
        snapshot.deleted_collection_tombstones = {
            'collection-folder-b': 9095
        };

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 9090;

        global.fetch = jest.fn(async (url, options = {}) => {
            if (url.includes('/drive/v3/files/remote-file-id?alt=media')) {
                return {
                    ok: true,
                    json: async () => cloneValue(remoteDocument)
                };
            }

            if (url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'remote-file-id', uploaded: true, body: options.body })
                };
            }

            return {
                ok: true,
                json: async () => ({ modifiedByMeTime: new Date(remoteDocument.timestamp).toISOString() })
            };
        });

        const result = await backgroundUtils.syncData('token-123');
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        const patchCall = global.fetch.mock.calls.find(([url]) => url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media'));
        const uploadedPayload = JSON.parse(patchCall[1].body);

        expect(result).toBe(true);
        expect(collections.find((collection) => collection.uid === 'collection-folder-b')).toBeUndefined();
        expect(uploadedPayload.tabsArray.find((collection) => collection.uid === 'collection-folder-b')).toBeUndefined();
        expect(uploadedPayload.deletedCollections).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    uid: 'collection-folder-b'
                })
            ])
        );
    });

    test('applies a remote deletion to a stale local collection during a conflict window', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9090;

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 9095;
        remoteDocument.tabsArray = remoteDocument.tabsArray.filter((collection) => collection.uid !== 'collection-folder-b');
        remoteDocument.deletedCollections = [
            {
                uid: 'collection-folder-b',
                lastUpdated: 9095
            }
        ];

        global.fetch = jest.fn(async (url, options = {}) => {
            if (url.includes('/drive/v3/files/remote-file-id?alt=media')) {
                return {
                    ok: true,
                    json: async () => cloneValue(remoteDocument)
                };
            }

            if (url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'remote-file-id', uploaded: true, body: options.body })
                };
            }

            return {
                ok: true,
                json: async () => ({ modifiedByMeTime: new Date(remoteDocument.timestamp).toISOString() })
            };
        });

        const result = await backgroundUtils.syncData('token-123');
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        const patchCall = global.fetch.mock.calls.find(([url]) => url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media'));
        const uploadedPayload = JSON.parse(patchCall[1].body);

        expect(result).toBe(true);
        expect(collections.find((collection) => collection.uid === 'collection-folder-b')).toBeUndefined();
        expect(uploadedPayload.tabsArray.find((collection) => collection.uid === 'collection-folder-b')).toBeUndefined();
        expect(uploadedPayload.deletedCollections).toEqual(
            expect.arrayContaining([
                {
                    uid: 'collection-folder-b',
                    lastUpdated: 9095
                }
            ])
        );
    });
});
