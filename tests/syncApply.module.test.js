const {
    STORAGE_KEYS,
    buildIndexedSyncPayload,
    applySyncSnapshotAtomically
} = require('../chrome/sync-apply.js');

const createNextSyncData = () => ({
    tabsArray: [
        {
            uid: 'collection-next',
            name: 'Next Collection',
            tabs: [],
            createdOn: 10,
            lastUpdated: 20,
            parentId: null,
            order: 0
        }
    ],
    foldersArray: []
});

const createStorageArea = (initialData = {}) => {
    let store = JSON.parse(JSON.stringify(initialData));

    return {
        get: jest.fn(async (keys) => {
            if (keys === null || keys === undefined) {
                return JSON.parse(JSON.stringify(store));
            }

            if (typeof keys === 'string') {
                return { [keys]: JSON.parse(JSON.stringify(store[keys])) };
            }

            if (Array.isArray(keys)) {
                return keys.reduce((result, key) => {
                    if (store[key] !== undefined) {
                        result[key] = JSON.parse(JSON.stringify(store[key]));
                    }
                    return result;
                }, {});
            }

            return {};
        }),
        set: jest.fn(async (items) => {
            Object.assign(store, JSON.parse(JSON.stringify(items)));
        }),
        remove: jest.fn(async (keys) => {
            const targetKeys = Array.isArray(keys) ? keys : [keys];
            targetKeys.forEach((key) => {
                delete store[key];
            });
        }),
        clear: jest.fn(async () => {
            store = {};
        }),
        dump: () => JSON.parse(JSON.stringify(store))
    };
};

describe('sync apply module', () => {
    test('builds a full indexed payload and removal list from a sync snapshot', () => {
        const payload = buildIndexedSyncPayload({
            currentStorage: {
                collections_index: {
                    'collection-stale': { name: 'Stale' }
                },
                folders_index: {
                    'folder-stale': { name: 'Stale Folder' }
                }
            },
            syncData: {
                tabsArray: [
                    {
                        uid: 'collection-next',
                        name: 'Next Collection',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 20,
                        parentId: null,
                        order: 0
                    }
                ],
                foldersArray: [
                    {
                        uid: 'folder-next',
                        name: 'Next Folder',
                        color: 'blue',
                        collapsed: false,
                        createdOn: 5,
                        lastUpdated: 15,
                        order: 0
                    }
                ]
            }
        });

        expect(payload.setPayload).toEqual(expect.objectContaining({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'collection-next': expect.objectContaining({
                    name: 'Next Collection',
                    order: 0
                })
            },
            [STORAGE_KEYS.FOLDERS_INDEX]: {
                'folder-next': expect.objectContaining({
                    name: 'Next Folder',
                    order: 0
                })
            },
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-next`]: expect.objectContaining({
                uid: 'collection-next'
            }),
            [`${STORAGE_KEYS.FOLDER_PREFIX}folder-next`]: expect.objectContaining({
                uid: 'folder-next'
            }),
            [STORAGE_KEYS.LEGACY_TABS_ARRAY]: [
                expect.objectContaining({
                    uid: 'collection-next'
                })
            ],
            [STORAGE_KEYS.STORAGE_VERSION]: 3
        }));
        expect(payload.removeKeys.sort()).toEqual([
            `${STORAGE_KEYS.COLLECTION_PREFIX}collection-stale`,
            `${STORAGE_KEYS.FOLDER_PREFIX}folder-stale`
        ]);
    });

    test('treats missing sync arrays as empty collections and folders', () => {
        const payload = buildIndexedSyncPayload({
            currentStorage: {},
            syncData: {}
        });

        expect(payload).toEqual({
            setPayload: {
                [STORAGE_KEYS.COLLECTIONS_INDEX]: {},
                deleted_collection_tombstones: {},
                deleted_folder_tombstones: {},
                [STORAGE_KEYS.FOLDERS_INDEX]: {},
                [STORAGE_KEYS.LEGACY_TABS_ARRAY]: [],
                [STORAGE_KEYS.STORAGE_VERSION]: 3
            },
            removeKeys: [],
            collections: [],
            folders: []
        });
    });

    test('refuses to delete local collections when the incoming snapshot is empty', () => {
        // A stale/corrupt empty remote snapshot must not wipe existing local data.
        const payload = buildIndexedSyncPayload({
            currentStorage: {
                collections_index: {
                    'collection-local': { name: 'Local', type: 'collection', order: 0 }
                },
                'collection_collection-local': {
                    uid: 'collection-local',
                    name: 'Local',
                    tabs: [{ uid: 't1', url: 'https://example.com' }],
                    createdOn: 10,
                    lastUpdated: 20
                },
                folders_index: {
                    'folder-local': { name: 'Local Folder', type: 'folder', order: 0 }
                },
                'folder_folder-local': {
                    uid: 'folder-local',
                    name: 'Local Folder',
                    createdOn: 5,
                    lastUpdated: 15
                }
            },
            syncData: { tabsArray: [], foldersArray: [] }
        });

        // Nothing is deleted.
        expect(payload.removeKeys).toEqual([]);
        // Local data is preserved in the rebuilt index and mirror.
        expect(payload.setPayload[STORAGE_KEYS.COLLECTIONS_INDEX]).toHaveProperty('collection-local');
        expect(payload.setPayload[STORAGE_KEYS.FOLDERS_INDEX]).toHaveProperty('folder-local');
        expect(payload.setPayload[`${STORAGE_KEYS.COLLECTION_PREFIX}collection-local`]).toEqual(
            expect.objectContaining({ uid: 'collection-local' })
        );
        expect(payload.setPayload[STORAGE_KEYS.LEGACY_TABS_ARRAY]).toEqual([
            expect.objectContaining({ uid: 'collection-local' })
        ]);
        expect(payload.collections).toEqual([
            expect.objectContaining({ uid: 'collection-local' })
        ]);
    });

    test('normalizes missing collection and folder fields while building the indexed payload', () => {
        const payload = buildIndexedSyncPayload({
            currentStorage: {},
            syncData: {
                tabsArray: [
                    {
                        uid: 'collection-next'
                    }
                ],
                foldersArray: [
                    {
                        uid: 'folder-next'
                    }
                ]
            }
        }, 9000);

        expect(payload.setPayload['collection_collection-next']).toEqual(expect.objectContaining({
            uid: 'collection-next',
            name: 'Untitled Collection',
            tabs: [],
            chromeGroups: [],
            color: 'default',
            lastOpened: null,
            parentId: null,
            type: 'collection'
        }));
        expect(payload.setPayload['folder_folder-next']).toEqual(expect.objectContaining({
            uid: 'folder-next',
            name: 'Untitled Folder',
            color: 'var(--folder-default-color)',
            collapsed: false,
            type: 'folder'
        }));
    });

    test('ignores malformed deleted collection tombstones while building the indexed payload', () => {
        const payload = buildIndexedSyncPayload({
            currentStorage: {},
            syncData: {
                tabsArray: [],
                foldersArray: [],
                deletedCollections: [
                    { uid: 'deleted-valid', lastUpdated: 55 },
                    { uid: 'deleted-missing-time' },
                    { lastUpdated: 99 },
                ]
            }
        });

        expect(payload.setPayload.deleted_collection_tombstones).toEqual({
            'deleted-valid': 55
        });
    });

    test('persists deleted folder tombstones and ignores malformed ones while building the indexed payload', () => {
        const payload = buildIndexedSyncPayload({
            currentStorage: {},
            syncData: {
                tabsArray: [],
                foldersArray: [],
                deletedFolders: [
                    { uid: 'folder-deleted', lastUpdated: 77 },
                    { uid: 'folder-missing-time' },
                    { lastUpdated: 12 },
                ]
            }
        });

        expect(payload.setPayload.deleted_folder_tombstones).toEqual({
            'folder-deleted': 77
        });
    });

    test('applies a sync snapshot atomically and removes stale records', async () => {
        const storageArea = createStorageArea({
            collections_index: {
                'collection-stale': { name: 'Stale' }
            },
            'collection_collection-stale': { uid: 'collection-stale', name: 'Stale', tabs: [] },
            folders_index: {}
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: true,
            collections: [
                expect.objectContaining({
                    uid: 'collection-next'
                })
            ],
            folders: []
        });
        expect(storageArea.dump()).toEqual(expect.objectContaining({
            collections_index: {
                'collection-next': expect.objectContaining({
                    name: 'Next Collection'
                })
            },
            'collection_collection-next': expect.objectContaining({
                uid: 'collection-next'
            })
        }));
        expect(storageArea.dump()['collection_collection-stale']).toBeUndefined();
    });

    test('rolls back storage when applying a sync snapshot fails', async () => {
        const storageArea = createStorageArea({
            collections_index: {},
            folders_index: {},
            keepMe: { safe: true }
        });
        storageArea.remove.mockImplementationOnce(async () => {
            throw new Error('Remove failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: false,
            error: 'Remove failed',
            rollbackSucceeded: true
        });
        expect(storageArea.dump()).toEqual({
            collections_index: {},
            folders_index: {},
            keepMe: { safe: true }
        });
    });

    test('rolls back storage when the atomic set itself fails', async () => {
        const storageArea = createStorageArea({
            collections_index: {},
            folders_index: {},
            keepMe: { safe: true }
        });
        storageArea.set.mockImplementationOnce(async () => {
            throw new Error('Set failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: {
                tabsArray: [],
                foldersArray: []
            }
        });

        expect(result).toEqual({
            success: false,
            error: 'Set failed',
            rollbackSucceeded: true
        });
        expect(storageArea.dump()).toEqual({
            collections_index: {},
            folders_index: {},
            keepMe: { safe: true }
        });
    });

    test('preserves unrelated concurrent local writes while rolling back sync-owned keys', async () => {
        const storageArea = createStorageArea({
            collections_index: {
                'collection-stale': { name: 'Stale' }
            },
            'collection_collection-stale': { uid: 'collection-stale', name: 'Stale', tabs: [] },
            folders_index: {},
            uiDraft: { name: 'before-sync' }
        });
        storageArea.remove.mockImplementationOnce(async () => {
            await storageArea.set({
                uiDraft: { name: 'concurrent-user-edit' }
            });
            throw new Error('Remove failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: false,
            error: 'Remove failed',
            rollbackSucceeded: true
        });
        expect(storageArea.dump()).toEqual({
            collections_index: {
                'collection-stale': { name: 'Stale' }
            },
            'collection_collection-stale': { uid: 'collection-stale', name: 'Stale', tabs: [] },
            folders_index: {},
            uiDraft: { name: 'concurrent-user-edit' }
        });
        expect(storageArea.clear).not.toHaveBeenCalled();
    });

    test('lets a concurrent write win for a touched sync key when it differs from the failed apply payload', async () => {
        const storageArea = createStorageArea({
            collections_index: {
                'collection-next': {
                    name: 'Existing Collection',
                    type: 'collection',
                    tabCount: 0,
                    lastUpdated: 5,
                    lastOpened: null,
                    createdOn: 5,
                    color: 'default',
                    size: 20,
                    parentId: null,
                    order: 0
                }
            },
            'collection_collection-next': {
                uid: 'collection-next',
                name: 'Existing Collection',
                tabs: [],
                chromeGroups: [],
                color: 'default',
                createdOn: 5,
                lastUpdated: 5,
                lastOpened: null,
                parentId: null,
                order: 0,
                type: 'collection'
            },
            folders_index: {}
        });
        storageArea.remove.mockImplementationOnce(async () => {
            await storageArea.set({
                'collection_collection-next': {
                    uid: 'collection-next',
                    name: 'Concurrent Winner',
                    tabs: [{ url: 'https://example.com', title: 'Concurrent Tab' }],
                    chromeGroups: [],
                    color: 'default',
                    createdOn: 5,
                    lastUpdated: 99,
                    lastOpened: null,
                    parentId: null,
                    order: 0,
                    type: 'collection'
                }
            });
            throw new Error('Remove failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: false,
            error: 'Remove failed',
            rollbackSucceeded: true
        });
        expect(storageArea.dump()).toEqual(expect.objectContaining({
            collections_index: {
                'collection-next': expect.objectContaining({
                    name: 'Existing Collection'
                })
            },
            'collection_collection-next': expect.objectContaining({
                name: 'Concurrent Winner',
                lastUpdated: 99
            })
        }));
    });

    test('removes keys written only by the failed apply when they were not changed again before rollback', async () => {
        const storageArea = createStorageArea({
            collections_index: {
                'collection-stale': { name: 'Stale' }
            },
            'collection_collection-stale': { uid: 'collection-stale', name: 'Stale', tabs: [] },
            folders_index: {}
        });
        storageArea.remove.mockImplementationOnce(async () => {
            throw new Error('Remove failed');
        });

        await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(storageArea.dump().collection_collection_next).toBeUndefined();
        expect(storageArea.dump()['collection_collection-next']).toBeUndefined();
        expect(storageArea.dump().tabsArray).toBeUndefined();
        expect(storageArea.dump().tabox_storage_version).toBeUndefined();
    });

    test('rolls back with remove-only cleanup when the snapshot had no prior sync-managed keys', async () => {
        const storageArea = createStorageArea({});
        storageArea.remove.mockImplementationOnce(async () => {
            throw new Error('Remove failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: false,
            error: 'Remove failed',
            rollbackSucceeded: true
        });
        expect(storageArea.dump()).toEqual({});
    });

    test('restores untouched sync-managed snapshot keys that were not part of the failed payload', async () => {
        const storageArea = createStorageArea({
            collections_index: {},
            folders_index: {},
            'collection_orphaned-record': {
                uid: 'orphaned-record',
                name: 'Orphaned Record',
                tabs: [],
                chromeGroups: [],
                color: 'default',
                createdOn: 1,
                lastUpdated: 1,
                lastOpened: null,
                parentId: null,
                order: 0,
                type: 'collection'
            }
        });
        storageArea.remove.mockImplementationOnce(async () => {
            throw new Error('Remove failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: false,
            error: 'Remove failed',
            rollbackSucceeded: true
        });
        expect(storageArea.dump()).toEqual(expect.objectContaining({
            'collection_orphaned-record': expect.objectContaining({
                name: 'Orphaned Record'
            })
        }));
    });

    test('returns a structured failure when rollback itself cannot finish', async () => {
        const storageArea = createStorageArea({
            collections_index: {},
            folders_index: {}
        });
        let removeCount = 0;
        storageArea.remove.mockImplementation(async () => {
            removeCount += 1;

            if (removeCount === 1) {
                throw new Error('Apply remove failed');
            }

            throw new Error('Rollback remove failed');
        });

        const result = await applySyncSnapshotAtomically({
            storageArea,
            syncData: createNextSyncData()
        });

        expect(result).toEqual({
            success: false,
            error: 'Apply remove failed',
            rollbackSucceeded: false,
            rollbackError: 'Rollback remove failed'
        });
    });

    test('builds a payload when currentStorage and syncData rely on their defaults', () => {
        const payload = buildIndexedSyncPayload({});

        expect(payload.collections).toEqual([]);
        expect(payload.folders).toEqual([]);
        expect(payload.removeKeys).toEqual([]);
    });
});
