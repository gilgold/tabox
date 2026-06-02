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
    batchUpdateCollections,
    batchDeleteCollections,
    loadAllFolders,
    saveSingleCollection,
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
