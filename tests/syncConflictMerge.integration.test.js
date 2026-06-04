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

    test('preserves a local folder deletion instead of resurrecting the older remote folder during a conflict window', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9095;
        // Delete folder-empty locally and record a folder tombstone for it.
        delete snapshot['folder_folder-empty'];
        delete snapshot.folders_index['folder-empty'];
        snapshot.deleted_folder_tombstones = {
            'folder-empty': 9095
        };

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        // Remote is older and still has folder-empty.
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
        const folders = await backgroundUtils.loadAllFoldersBG();
        const patchCall = global.fetch.mock.calls.find(([url]) => url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media'));
        const uploadedPayload = JSON.parse(patchCall[1].body);

        expect(result).toBe(true);
        // The folder must not be resurrected locally...
        expect(folders.find((folder) => folder.uid === 'folder-empty')).toBeUndefined();
        // ...nor pushed back to the remote...
        expect(uploadedPayload.foldersArray.find((folder) => folder.uid === 'folder-empty')).toBeUndefined();
        // ...and the deletion tombstone propagates so other devices remove it too.
        expect(uploadedPayload.deletedFolders).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    uid: 'folder-empty'
                })
            ])
        );
    });

    test('keeps a brand-new remote folder (e.g. a duplicate from another device) during a conflict window instead of dropping it', async () => {
        // This device made a recent unrelated change, so the sync lands in the
        // conflict window (server slightly newer than local).
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9080;

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        // Remote (another device) just duplicated a folder this device has never seen.
        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 9095; // newer than local, within the 60s conflict window
        remoteDocument.foldersArray = [
            ...remoteDocument.foldersArray,
            {
                uid: 'folder-from-other-device',
                name: 'Duplicated Elsewhere (copy)',
                type: 'folder',
                color: 'blue',
                collapsed: true,
                createdOn: 9050,
                lastUpdated: 9050,
                order: 5
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
        const folders = await backgroundUtils.loadAllFoldersBG();

        expect(result).toBe(true);
        // The brand-new remote folder must NOT be treated as a local deletion.
        expect(folders.find((folder) => folder.uid === 'folder-from-other-device')).toEqual(
            expect.objectContaining({
                name: 'Duplicated Elsewhere (copy)'
            })
        );
    });

    test('removes a locally-present folder when the remote carries its deletion tombstone (non-conflict download)', async () => {
        // This device still has folder-empty locally; another device deleted it.
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 1000;

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        // Remote is far newer (forces the non-conflict download path) and reports
        // folder-empty as deleted.
        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 70000;
        remoteDocument.foldersArray = remoteDocument.foldersArray.filter((folder) => folder.uid !== 'folder-empty');
        remoteDocument.deletedFolders = [
            { uid: 'folder-empty', lastUpdated: 70000 }
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
        const folders = await backgroundUtils.loadAllFoldersBG();

        expect(result).toBe(true);
        expect(folders.find((folder) => folder.uid === 'folder-empty')).toBeUndefined();
    });

    test('removes a locally-present folder when the remote carries its deletion tombstone (conflict window)', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9080;

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 9095;
        remoteDocument.foldersArray = remoteDocument.foldersArray.filter((folder) => folder.uid !== 'folder-empty');
        remoteDocument.deletedFolders = [
            { uid: 'folder-empty', lastUpdated: 9095 }
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
        const folders = await backgroundUtils.loadAllFoldersBG();

        expect(result).toBe(true);
        expect(folders.find((folder) => folder.uid === 'folder-empty')).toBeUndefined();
    });

    test('uploads a folder removal (not just its collections) when a folder with collections is deleted locally', async () => {
        // Simulate the local state right after deleting folder-alpha and its collections:
        // folder + collection records and index entries removed, tombstones recorded.
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9200;
        delete snapshot['folder_folder-alpha'];
        delete snapshot.folders_index['folder-alpha'];
        ['collection-folder-a', 'collection-folder-b'].forEach((uid) => {
            delete snapshot[`collection_${uid}`];
            delete snapshot.collections_index[uid];
        });
        snapshot.deleted_folder_tombstones = { 'folder-alpha': 9200 };
        snapshot.deleted_collection_tombstones = {
            'collection-folder-a': 9200,
            'collection-folder-b': 9200
        };

        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        // Remote still has folder-alpha and its collections.
        const remoteDocument = createVersion40RemoteDocument();
        remoteDocument.timestamp = 9150;

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
        const patchCall = global.fetch.mock.calls.find(([url]) => url.includes('/upload/drive/v3/files/remote-file-id?uploadType=media'));
        const uploadedPayload = JSON.parse(patchCall[1].body);

        expect(result).toBe(true);
        // The folder itself must be removed from the uploaded snapshot...
        expect(uploadedPayload.foldersArray.find((folder) => folder.uid === 'folder-alpha')).toBeUndefined();
        // ...and its deletion tombstone propagated.
        expect(uploadedPayload.deletedFolders).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ uid: 'folder-alpha' })
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
