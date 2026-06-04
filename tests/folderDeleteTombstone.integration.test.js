// Integration test: the REAL deleteFolder + REAL storageUtils against an
// in-memory browser.storage.local. The existing folderOperations.behavior test
// mocks storageUtils, so it cannot verify that deleting a folder actually
// records a folder deletion tombstone alongside the collection tombstones.

let mockStore = {};

jest.mock('../static/globals', () => {
    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
    return {
        browser: {
            storage: {
                local: {
                    get: jest.fn(async (keys) => {
                        if (keys === undefined || keys === null) return clone(mockStore);
                        if (typeof keys === 'string') return { [keys]: clone(mockStore[keys]) };
                        if (Array.isArray(keys)) {
                            return keys.reduce((acc, k) => {
                                if (mockStore[k] !== undefined) acc[k] = clone(mockStore[k]);
                                return acc;
                            }, {});
                        }
                        return Object.keys(keys).reduce((acc, k) => {
                            acc[k] = mockStore[k] !== undefined ? clone(mockStore[k]) : keys[k];
                            return acc;
                        }, {});
                    }),
                    set: jest.fn(async (obj) => {
                        Object.entries(obj).forEach(([k, v]) => { mockStore[k] = clone(v); });
                    }),
                    remove: jest.fn(async (keys) => {
                        (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete mockStore[k]; });
                    }),
                    clear: jest.fn(async () => { mockStore = {}; })
                },
                sync: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) }
            },
            runtime: { sendMessage: jest.fn(async () => true) }
        }
    };
});

const { STORAGE_KEYS } = require('../app/utils/storageUtils');
const { deleteFolder } = require('../app/utils/folderOperations');

describe('deleteFolder tombstone integration (real storageUtils)', () => {
    beforeEach(() => {
        mockStore = {
            [STORAGE_KEYS.FOLDERS_INDEX]: {
                'folder-copy': { name: 'Folder (copy)', type: 'folder', order: 0 }
            },
            [`${STORAGE_KEYS.FOLDER_PREFIX}folder-copy`]: {
                uid: 'folder-copy',
                name: 'Folder (copy)',
                type: 'folder',
                createdOn: 1000,
                lastUpdated: 1000
            },
            [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                'coll-1': { name: 'C1', type: 'collection', parentId: 'folder-copy', order: 0 }
            },
            [`${STORAGE_KEYS.COLLECTION_PREFIX}coll-1`]: {
                uid: 'coll-1', name: 'C1', tabs: [], parentId: 'folder-copy', createdOn: 1000, lastUpdated: 1000
            },
            [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: {},
            [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: {}
        };
    });

    test('deleting a folder and its collections records BOTH a folder tombstone and collection tombstones', async () => {
        const result = await deleteFolder('folder-copy', true, true);

        expect(result.success).toBe(true);
        // The folder itself must be gone from storage and index.
        expect(mockStore[`${STORAGE_KEYS.FOLDER_PREFIX}folder-copy`]).toBeUndefined();
        expect(mockStore[STORAGE_KEYS.FOLDERS_INDEX]['folder-copy']).toBeUndefined();

        // Collection deletion is tombstoned (this already worked)...
        expect(mockStore[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]['coll-1']).toEqual(expect.any(Number));
        // ...and crucially the FOLDER deletion must be tombstoned too, so the
        // folder is removed on other devices instead of lingering empty.
        expect(mockStore[STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]['folder-copy']).toEqual(expect.any(Number));
    });
});
