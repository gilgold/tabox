const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot, createVersion40RemoteDocument } = require('./helpers/upgradeFixtures');

describe('4.0 upgrade compatibility - regressions', () => {
    let browser;
    let backgroundUtils;
    let errorSpy;

    beforeEach(() => {
        jest.resetModules();
        // The sync logger intentionally emits console.error on the safety-block
        // and credential-failure paths exercised below.
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.fetch = jest.fn(async (url) => {
            if (url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({ timestamp: 9500 })
                };
            }

            if (url.includes('modifiedByMeTime')) {
                return {
                    ok: true,
                    json: async () => ({ modifiedByMeTime: new Date(9500).toISOString() })
                };
            }

            return {
                ok: true,
                json: async () => ({ id: 'upload-response-id' })
            };
        });
        backgroundUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.fetch;
    });

    test('refuses to push an empty upgraded local dataset over an existing remote file', async () => {
        browser.storage.local._data = {
            collections_index: {},
            folders_index: {},
            localTimestamp: 0
        };
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const result = await backgroundUtils.updateRemote('token-123');

        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/upload/drive/v3/files/remote-file-id'),
            expect.objectContaining({ method: 'PATCH' })
        );
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('SAFETY BLOCK: Refusing to push empty data to server')
        );
    });

    test('downloads 4.0 remote data for an empty upgraded device instead of leaving it empty', async () => {
        browser.storage.local._data = {
            collections_index: {},
            folders_index: {},
            localTimestamp: 0
        };
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const remoteDocument = createVersion40RemoteDocument();
        global.fetch.mockImplementation(async (url) => {
            if (url.includes('alt=media')) {
                if (url.includes('files/remote-file-id')) {
                    return {
                        ok: true,
                        json: async () => cloneValue(remoteDocument)
                    };
                }

                return {
                    ok: true,
                    json: async () => ({ timestamp: remoteDocument.timestamp })
                };
            }

            return {
                ok: true,
                json: async () => ({ modifiedByMeTime: new Date(remoteDocument.timestamp).toISOString() })
            };
        });

        const result = await backgroundUtils.updateLocalDataFromServer('token-123', true);
        const collections = await backgroundUtils.loadAllCollectionsBG(true);

        expect(result).not.toBe(false);
        expect(collections.map((collection) => collection.uid).sort()).toEqual([
            'collection-folder-a',
            'collection-folder-b',
            'collection-root-a'
        ]);
    });

    test('first sync after upgrade merges and uploads the remote snapshot when timestamps conflict', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 8500;
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        const remoteDocument = createVersion40RemoteDocument({
            renameRootCollection: true
        });

        global.fetch.mockImplementation(async (url) => {
            if (url.includes('/drive/v3/files/remote-file-id?alt=media')) {
                return {
                    ok: true,
                    json: async () => cloneValue(remoteDocument)
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
        expect(collections.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                name: 'Root Alpha (Remote)'
            })
        );
        expect(uploadedPayload.tabsArray.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                name: 'Root Alpha (Remote)'
            })
        );
    });

    test('re-applying the same 4.0 remote document does not duplicate upgraded data', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();

        const remoteDocument = createVersion40RemoteDocument();
        await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDocument));
        await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDocument));

        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        const folders = await backgroundUtils.loadAllFoldersBG();

        expect(collections).toHaveLength(3);
        expect(folders).toHaveLength(2);
        expect(new Set(collections.map((collection) => collection.uid)).size).toBe(3);
        expect(new Set(folders.map((folder) => folder.uid)).size).toBe(2);
    });

    test('first sync after upgrade uploads a merged full snapshot when local data is newer', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9100;
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };
        const remoteDocument = createVersion40RemoteDocument();

        global.fetch.mockImplementation(async (url, options = {}) => {
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
        expect(uploadedPayload.foldersArray.map((folder) => ({ uid: folder.uid, order: folder.order }))).toEqual([
            { uid: 'folder-alpha', order: 0 },
            { uid: 'folder-empty', order: 1 }
        ]);
        expect(uploadedPayload.tabsArray.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
            expect.objectContaining({
                parentId: 'folder-alpha',
                order: 0
            })
        );
    });

    test('creates a new remote sync file and uploads upgraded local data when no remote file exists yet', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();
        browser.storage.sync._data = {};

        global.fetch.mockImplementation(async (url) => {
            if (url.includes('/drive/v3/files/?corpora=user')) {
                return {
                    ok: true,
                    json: async () => ({ files: [] })
                };
            }

            if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'created-sync-file-id' })
                };
            }

            if (url.includes('/upload/drive/v3/files/created-sync-file-id?uploadType=media')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'created-sync-file-id', updated: true })
                };
            }

            return {
                ok: true,
                json: async () => ({})
            };
        });

        const result = await backgroundUtils.updateRemote('token-123');

        expect(result).not.toBe(false);
        expect(browser.storage.sync._data.syncFileId).toBe('created-sync-file-id');
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/upload/drive/v3/files?uploadType=multipart'),
            expect.objectContaining({ method: 'POST' })
        );
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/upload/drive/v3/files/created-sync-file-id?uploadType=media'),
            expect.objectContaining({ method: 'PATCH' })
        );
    });

    test('treats equal local and remote timestamps as a no-op after upgrade', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9000;
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        global.fetch.mockImplementation(async (url) => {
            if (url.includes('alt=media')) {
                return {
                    ok: true,
                    json: async () => ({ timestamp: 9000 })
                };
            }

            return {
                ok: true,
                json: async () => ({ modifiedByMeTime: new Date(9000).toISOString() })
            };
        });

        const result = await backgroundUtils.syncData('token-123');

        expect(result).toBe(true);
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/upload/drive/v3/files/remote-file-id?uploadType=media'),
            expect.objectContaining({ method: 'PATCH' })
        );
    });

    test('auth recovery failures do not delete upgraded local data', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();
        browser.storage.local._data.googleRefreshToken = 'refresh-token';

        global.fetch.mockImplementation(async () => ({
            ok: false,
            status: 400,
            json: async () => ({
                error: 'invalid_grant',
                error_description: 'Token has been expired or revoked.'
            })
        }));

        const token = await backgroundUtils.getNewAccessToken();

        expect(token).toBe(false);
        expect(browser.storage.local._data['collection_collection-root-a']).toBeDefined();
        expect(browser.storage.local._data['folder_folder-alpha']).toBeDefined();
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('sync credentials not configured')
        );
    });
});
