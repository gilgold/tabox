jest.mock('../static/globals', () => ({
    browser: {
        storage: {
            local: {
                get: jest.fn(),
                set: jest.fn(),
                remove: jest.fn(),
                clear: jest.fn()
            }
        }
    }
}));

import { browser } from '../static/globals';
import {
    atomicStorageTransaction,
    batchUpdateCollections,
    batchDeleteCollections,
    loadAllFolders,
    saveSingleCollection,
    saveSingleFolder,
    deleteSingleFolder,
    sortCollectionsForDisplay,
    STORAGE_KEYS,
} from '../app/utils/storageUtils';

const resolveStorageGet = async (keys, storage) => {
    if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
            result[key] = storage[key];
            return result;
        }, {});
    }

    if (typeof keys === 'string') {
        return { [keys]: storage[keys] };
    }

    return {};
};

describe('sortCollectionsForDisplay', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('sorts collections by lastUpdated descending when order is absent', () => {
        const collections = [
            { uid: 'alpha', name: 'Alpha', lastUpdated: 100, parentId: null },
            { uid: 'beta', name: 'Beta', lastUpdated: 300, parentId: null },
            { uid: 'gamma', name: 'Gamma', lastUpdated: 200, parentId: null }
        ];

        const sorted = sortCollectionsForDisplay(collections, {
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });

        expect(sorted.map(collection => collection.uid)).toEqual(['beta', 'gamma', 'alpha']);
    });

    test('keeps manual order when both collections have explicit order values', () => {
        const collections = [
            { uid: 'first', name: 'First', order: 1, lastUpdated: 100, parentId: null },
            { uid: 'second', name: 'Second', order: 0, lastUpdated: 300, parentId: null }
        ];

        const sorted = sortCollectionsForDisplay(collections, {
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });

        expect(sorted.map(collection => collection.uid)).toEqual(['second', 'first']);
    });

    test('groups folder collections ahead of root collections in hierarchical mode', () => {
        const collections = [
            { uid: 'root', name: 'Root', lastUpdated: 100, parentId: null },
            { uid: 'folder-b', name: 'Folder B', lastUpdated: 200, parentId: 'folder-2' },
            { uid: 'folder-a', name: 'Folder A', lastUpdated: 150, parentId: 'folder-1' }
        ];

        const sorted = sortCollectionsForDisplay(collections, {
            sortBy: 'lastUpdated',
            sortOrder: 'desc',
            flatSort: false
        });

        expect(sorted.map(collection => collection.uid)).toEqual(['folder-a', 'folder-b', 'root']);
    });

    test('ignores folder grouping in flatSort mode', () => {
        const collections = [
            { uid: 'root', name: 'Root', lastUpdated: 100, parentId: null },
            { uid: 'folder', name: 'Folder', lastUpdated: 200, parentId: 'folder-1' }
        ];

        const sorted = sortCollectionsForDisplay(collections, {
            sortBy: 'lastUpdated',
            sortOrder: 'desc',
            flatSort: true
        });

        expect(sorted.map(collection => collection.uid)).toEqual(['folder', 'root']);
    });
});

describe('loadAllFolders', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('recomputes folder collection counts from the collections index', async () => {
        const storage = {
            [STORAGE_KEYS.FOLDERS_INDEX]: {
                'folder-1': {
                    name: 'Folder One',
                    type: 'folder',
                    color: 'blue',
                    collapsed: false,
                    collectionCount: 0,
                    lastUpdated: 10,
                    createdOn: 1,
                    order: 0,
                    size: 100
                }
            },
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'collection-1': {
                    name: 'Collection One',
                    type: 'collection',
                    tabCount: 1,
                    lastUpdated: 10,
                    createdOn: 1,
                    color: 'default',
                    size: 200,
                    parentId: 'folder-1',
                    order: 0
                }
            },
            [`${STORAGE_KEYS.FOLDER_PREFIX}folder-1`]: {
                uid: 'folder-1',
                name: 'Folder One',
                type: 'folder',
                color: 'blue',
                collapsed: false,
                collectionCount: 0,
                lastUpdated: 10,
                createdOn: 1,
                order: 0
            }
        };

        browser.storage.local.get.mockImplementation((keys) => resolveStorageGet(keys, storage));

        const folders = await loadAllFolders({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc'
        });

        expect(folders).toEqual([
            expect.objectContaining({
                uid: 'folder-1',
                collectionCount: 1
            })
        ]);
    });
});

describe('batchDeleteCollections', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('removes multiple collection records and updates the index once', async () => {
        const storage = {
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'collection-1': { name: 'Collection One' },
                'collection-2': { name: 'Collection Two' },
                'collection-3': { name: 'Collection Three' },
            },
            [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: {},
        };

        browser.storage.local.get.mockImplementation((keys) => resolveStorageGet(keys, storage));

        const success = await batchDeleteCollections(['collection-1', 'collection-3']);

        expect(success).toBe(true);
        expect(browser.storage.local.remove).toHaveBeenCalledWith([
            `${STORAGE_KEYS.COLLECTION_PREFIX}collection-1`,
            `${STORAGE_KEYS.COLLECTION_PREFIX}collection-3`,
        ]);
        expect(browser.storage.local.set).toHaveBeenCalledWith({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'collection-2': { name: 'Collection Two' },
            },
        });
        expect(browser.storage.local.set.mock.calls).toEqual(expect.arrayContaining([
            [{
                deleted_collection_tombstones: {
                    'collection-1': expect.any(Number),
                    'collection-3': expect.any(Number),
                },
            }]
        ]));
    });
});

describe('batchUpdateCollections', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('preserves newer stored order and lastUpdated metadata when a stale reorder payload is saved', async () => {
        const storage = {
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'collection-1': {
                    name: 'Collection One',
                    type: 'collection',
                    tabCount: 1,
                    lastUpdated: 5000,
                    lastOpened: null,
                    createdOn: 1,
                    color: 'default',
                    size: 100,
                    parentId: 'folder-1',
                    order: 1,
                },
                'collection-2': {
                    name: 'Collection Two',
                    type: 'collection',
                    tabCount: 1,
                    lastUpdated: 5001,
                    lastOpened: null,
                    createdOn: 2,
                    color: 'default',
                    size: 100,
                    parentId: 'folder-1',
                    order: 0,
                },
            },
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-1`]: {
                uid: 'collection-1',
                name: 'Collection One',
                tabs: [{ uid: 'tab-1', title: 'One', url: 'https://one.example.com' }],
                chromeGroups: [],
                color: 'default',
                createdOn: 1,
                lastUpdated: 5000,
                lastOpened: null,
                parentId: 'folder-1',
                order: 1,
            },
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-2`]: {
                uid: 'collection-2',
                name: 'Collection Two',
                tabs: [{ uid: 'tab-2', title: 'Two', url: 'https://two.example.com' }],
                chromeGroups: [],
                color: 'default',
                createdOn: 2,
                lastUpdated: 5001,
                lastOpened: null,
                parentId: 'folder-1',
                order: 0,
            },
            [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: {
                'collection-1': 9999,
            },
        };

        browser.storage.local.get.mockImplementation((keys) => resolveStorageGet(keys, storage));
        browser.storage.local.set.mockResolvedValue(undefined);

        const success = await batchUpdateCollections([
            {
                uid: 'collection-1',
                name: 'Collection One',
                tabs: [{ uid: 'tab-1', title: 'One', url: 'https://one.example.com' }],
                chromeGroups: [],
                color: 'default',
                createdOn: 1,
                lastUpdated: 1000,
                lastOpened: null,
                parentId: 'folder-1',
                order: 0,
            },
            {
                uid: 'collection-2',
                name: 'Collection Two',
                tabs: [{ uid: 'tab-2', title: 'Two', url: 'https://two.example.com' }],
                chromeGroups: [],
                color: 'default',
                createdOn: 2,
                lastUpdated: 1001,
                lastOpened: null,
                parentId: 'folder-1',
                order: 1,
            },
        ]);

        expect(success).toBe(true);
        expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-1`]: expect.objectContaining({
                order: 1,
                lastUpdated: 5000,
            }),
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-2`]: expect.objectContaining({
                order: 0,
                lastUpdated: 5001,
            }),
            [STORAGE_KEYS.COLLECTIONS_INDEX]: expect.objectContaining({
                'collection-1': expect.objectContaining({
                    order: 1,
                    lastUpdated: 5000,
                }),
                'collection-2': expect.objectContaining({
                    order: 0,
                    lastUpdated: 5001,
                }),
            }),
        }));
        expect(browser.storage.local.set.mock.calls).toEqual(expect.arrayContaining([
            [{
                deleted_collection_tombstones: {},
            }]
        ]));
    });
});

describe('saveSingleCollection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('updates the stored collection during partial updates', async () => {
        const storage = {
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'collection-1': {
                    name: 'Original Name',
                    type: 'collection',
                    tabCount: 1,
                    lastUpdated: 10,
                    lastOpened: null,
                    createdOn: 1,
                    color: 'default',
                    size: 100,
                    parentId: null,
                    order: 0,
                },
            },
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-1`]: {
                uid: 'collection-1',
                name: 'Original Name',
                tabs: [{ uid: 'tab-1', title: 'Tab', url: 'https://example.com' }],
                chromeGroups: [],
                color: 'default',
                createdOn: 1,
                lastUpdated: 10,
                lastOpened: null,
                parentId: null,
                order: 0,
            },
            [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: {
                'collection-1': 1234,
            },
        };

        browser.storage.local.get.mockImplementation((keys) => resolveStorageGet(keys, storage));
        browser.storage.local.set.mockResolvedValue(undefined);

        const success = await saveSingleCollection({
            uid: 'collection-1',
            name: 'Updated Name',
            tabs: [{ uid: 'tab-1', title: 'Tab', url: 'https://example.com' }],
            chromeGroups: [],
        }, true);

        expect(success).toBe(true);
        expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            [`${STORAGE_KEYS.COLLECTION_PREFIX}collection-1`]: expect.objectContaining({
                name: 'Updated Name',
            }),
        }));
        expect(browser.storage.local.set.mock.calls).toEqual(expect.arrayContaining([
            [{
                deleted_collection_tombstones: {},
            }]
        ]));
    });
});

describe('atomicStorageTransaction', () => {
    let store;
    let errorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        // The transaction helper intentionally logs console.error when it
        // rolls back — the failure tests below exercise exactly that path.
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        store = {
            collections_index: { a: { name: 'A' } },
            collection_a: { uid: 'a', name: 'A', tabs: [] },
            tabox_storage_version: 3,
        };

        browser.storage.local.get.mockImplementation(async (keys) => {
            if (keys === null || keys === undefined) {
                return { ...store };
            }
            if (Array.isArray(keys)) {
                return keys.reduce((result, key) => {
                    if (key in store) result[key] = store[key];
                    return result;
                }, {});
            }
            if (typeof keys === 'string') {
                return keys in store ? { [keys]: store[keys] } : {};
            }
            return {};
        });
        browser.storage.local.set.mockImplementation(async (items) => {
            Object.assign(store, items);
        });
        browser.storage.local.remove.mockImplementation(async (keys) => {
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]);
        });
        browser.storage.local.clear.mockImplementation(async () => {
            store = {};
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('commits changes when the transaction succeeds', async () => {
        const result = await atomicStorageTransaction(async () => {
            await browser.storage.local.set({ collection_b: { uid: 'b', tabs: [] } });
        });

        expect(result).toBe(true);
        expect(store.collection_b).toEqual({ uid: 'b', tabs: [] });
    });

    test('rolls back modified and added keys without clearing storage on failure', async () => {
        const result = await atomicStorageTransaction(async () => {
            await browser.storage.local.set({
                collection_a: { uid: 'a', name: 'MUTATED', tabs: [] }, // modify existing
                collection_b: { uid: 'b', tabs: [] },                  // add new
            });
            throw new Error('boom');
        });

        expect(result).toBe(false);
        // Modified key restored to its pre-transaction value.
        expect(store.collection_a).toEqual({ uid: 'a', name: 'A', tabs: [] });
        // Added key removed.
        expect(store.collection_b).toBeUndefined();
        // Untouched keys preserved.
        expect(store.collections_index).toEqual({ a: { name: 'A' } });
        // The destructive clear() path must never be taken.
        expect(browser.storage.local.clear).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith('Transaction failed, rolling back:', expect.any(Error));
    });

    test('never wipes live data when the pre-transaction snapshot is empty', async () => {
        // Simulate a failed snapshot read: the first get(null) returns {}.
        browser.storage.local.get.mockImplementationOnce(async () => ({}));

        const result = await atomicStorageTransaction(async () => {
            await browser.storage.local.set({ collection_b: { uid: 'b', tabs: [] } });
            throw new Error('boom');
        });

        expect(result).toBe(false);
        // Live data must survive an empty/failed snapshot.
        expect(store.collection_a).toEqual({ uid: 'a', name: 'A', tabs: [] });
        expect(store.collections_index).toEqual({ a: { name: 'A' } });
        expect(browser.storage.local.clear).not.toHaveBeenCalled();
    });
});

describe('folder deletion tombstones', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('deleteSingleFolder records a folder tombstone so the deletion can sync', async () => {
        const storage = {
            [STORAGE_KEYS.FOLDERS_INDEX]: {
                'folder-1': { name: 'Folder One' },
                'folder-2': { name: 'Folder Two' },
            },
            [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: {},
        };

        browser.storage.local.get.mockImplementation((keys) => resolveStorageGet(keys, storage));

        const success = await deleteSingleFolder('folder-1');

        expect(success).toBe(true);
        expect(browser.storage.local.remove).toHaveBeenCalledWith(
            `${STORAGE_KEYS.FOLDER_PREFIX}folder-1`
        );
        expect(browser.storage.local.set.mock.calls).toEqual(expect.arrayContaining([
            [{
                [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: {
                    'folder-1': expect.any(Number),
                },
            }]
        ]));
    });

    test('saveSingleFolder clears any stale folder tombstone for its uid', async () => {
        const storage = {
            [STORAGE_KEYS.FOLDERS_INDEX]: {},
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {},
            [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: {
                'folder-1': 123,
            },
        };

        browser.storage.local.get.mockImplementation((keys) => resolveStorageGet(keys, storage));

        const success = await saveSingleFolder({ uid: 'folder-1', name: 'Reborn Folder', color: 'blue' }, true);

        expect(success).toBe(true);
        expect(browser.storage.local.set.mock.calls).toEqual(expect.arrayContaining([
            [{
                [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: {},
            }]
        ]));
    });
});
