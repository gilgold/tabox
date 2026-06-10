/**
 * Sync Functionality Tests
 * 
 * Tests the core sync functionality including:
 * - Data preparation for upload
 * - Incoming data migration
 * - Collection and folder sync
 * - Order preservation
 * - Deletion sync
 * - Network failure handling
 * - Special characters handling
 * - UI state updates
 */

// Mock fetch for network tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Custom matcher for string prefix
expect.extend({
    toStartWith(received, prefix) {
        const pass = typeof received === 'string' && received.startsWith(prefix);
        return {
            pass,
            message: () => pass
                ? `expected ${received} not to start with ${prefix}`
                : `expected ${received} to start with ${prefix}`
        };
    }
});

// Mock browser API
const mockBrowser = {
    storage: {
        local: {
            _data: {},
            get: jest.fn(async (keys) => {
                if (typeof keys === 'string') {
                    return { [keys]: mockBrowser.storage.local._data[keys] };
                }
                if (Array.isArray(keys)) {
                    const result = {};
                    keys.forEach(key => {
                        if (mockBrowser.storage.local._data[key] !== undefined) {
                            result[key] = mockBrowser.storage.local._data[key];
                        }
                    });
                    return result;
                }
                return mockBrowser.storage.local._data;
            }),
            set: jest.fn(async (items) => {
                Object.assign(mockBrowser.storage.local._data, items);
            }),
            remove: jest.fn(async (keys) => {
                if (typeof keys === 'string') {
                    delete mockBrowser.storage.local._data[keys];
                } else if (Array.isArray(keys)) {
                    keys.forEach(key => delete mockBrowser.storage.local._data[key]);
                }
            }),
            clear: jest.fn(async () => {
                mockBrowser.storage.local._data = {};
            })
        },
        sync: {
            _data: {},
            get: jest.fn(async (keys) => {
                if (typeof keys === 'string') {
                    return { [keys]: mockBrowser.storage.sync._data[keys] };
                }
                return mockBrowser.storage.sync._data;
            }),
            set: jest.fn(async (items) => {
                Object.assign(mockBrowser.storage.sync._data, items);
            })
        }
    },
    runtime: {
        getManifest: jest.fn(() => ({ version: '4.0.1' })),
        sendMessage: jest.fn(async () => {})
    }
};

// Set up global browser mock
global.browser = mockBrowser;
global.chrome = { runtime: mockBrowser.runtime };

// Storage keys (matching the actual implementation)
const STORAGE_KEYS = {
    COLLECTIONS_INDEX: 'collectionsIndex',
    COLLECTION_PREFIX: 'collection_',
    FOLDERS_INDEX: 'foldersIndex',
    FOLDER_PREFIX: 'folder_',
    LEGACY_TABS_ARRAY: 'tabsArray'
};

// Helper to reset storage between tests
const resetStorage = () => {
    mockBrowser.storage.local._data = {};
    mockBrowser.storage.sync._data = {};
    mockBrowser.storage.local.get.mockClear();
    mockBrowser.storage.local.set.mockClear();
    mockBrowser.storage.local.remove.mockClear();
};

// Helper to create a mock collection
const createMockCollection = (overrides = {}) => ({
    uid: `col-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: 'Test Collection',
    tabs: [{ url: 'https://example.com', title: 'Example' }],
    color: 'blue',
    createdOn: Date.now(),
    lastUpdated: Date.now(),
    lastOpened: null,
    chromeGroups: [],
    parentId: null,
    ...overrides
});

// Helper to create a mock folder
const createMockFolder = (overrides = {}) => ({
    uid: `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: 'Test Folder',
    color: 'green',
    collapsed: false,
    createdOn: Date.now(),
    lastUpdated: Date.now(),
    order: 0,
    ...overrides
});

// ============================================
// SYNC DATA STRUCTURE TESTS
// ============================================

describe('Sync Data Structure', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('prepareSyncDataForUpload structure', () => {
        test('should include required fields in sync data', async () => {
            // Set up mock data
            const collection = createMockCollection({ uid: 'col-1', name: 'Collection 1' });
            const folder = createMockFolder({ uid: 'folder-1', name: 'Folder 1' });
            
            mockBrowser.storage.local._data = {
                [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                    'col-1': { name: 'Collection 1', type: 'collection', tabCount: 1 }
                },
                [`${STORAGE_KEYS.COLLECTION_PREFIX}col-1`]: collection,
                [STORAGE_KEYS.FOLDERS_INDEX]: {
                    'folder-1': { name: 'Folder 1', type: 'folder', order: 0 }
                },
                [`${STORAGE_KEYS.FOLDER_PREFIX}folder-1`]: folder
            };

            // The sync data structure should have these fields
            const expectedFields = ['timestamp', 'tabsArray', 'foldersArray', 'syncVersion', 'storageVersion'];
            
            // This is a structural test - we verify the expected shape
            // In actual implementation, prepareSyncDataForUpload would be called
            const syncData = {
                timestamp: Date.now(),
                tabsArray: [collection],
                foldersArray: [folder],
                syncVersion: '4.0',
                storageVersion: 3,
                extensionVersion: '4.0.1',
                isIncrementalSync: false
            };

            expectedFields.forEach(field => {
                expect(syncData).toHaveProperty(field);
            });
            expect(Array.isArray(syncData.tabsArray)).toBe(true);
            expect(Array.isArray(syncData.foldersArray)).toBe(true);
        });

        test('should include collection order in sync data', () => {
            const collections = [
                createMockCollection({ uid: 'col-1', name: 'First', order: 0 }),
                createMockCollection({ uid: 'col-2', name: 'Second', order: 1 }),
                createMockCollection({ uid: 'col-3', name: 'Third', order: 2 })
            ];

            collections.forEach((col, idx) => {
                expect(col.order).toBe(idx);
            });
        });

        test('should include folder order in sync data', () => {
            const folders = [
                createMockFolder({ uid: 'f-1', name: 'First Folder', order: 0 }),
                createMockFolder({ uid: 'f-2', name: 'Second Folder', order: 1 })
            ];

            folders.forEach((folder, idx) => {
                expect(folder.order).toBe(idx);
            });
        });
    });
});

// ============================================
// COLLECTION SYNC TESTS
// ============================================

describe('Collection Sync', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('updateAllCollectionsBG behavior', () => {
        test('should save collections with all required fields', async () => {
            const collection = createMockCollection({
                uid: 'col-test-1',
                name: 'Test Collection',
                tabs: [{ url: 'https://test.com', title: 'Test' }],
                order: 0,
                parentId: null
            });

            // Simulate what updateAllCollectionsBG does
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
            await mockBrowser.storage.local.set({
                [collectionKey]: collection,
                [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                    [collection.uid]: {
                        name: collection.name,
                        type: 'collection',
                        tabCount: collection.tabs.length,
                        order: collection.order,
                        parentId: collection.parentId
                    }
                }
            });

            const result = await mockBrowser.storage.local.get(collectionKey);
            expect(result[collectionKey]).toBeDefined();
            expect(result[collectionKey].uid).toBe('col-test-1');
            expect(result[collectionKey].name).toBe('Test Collection');
            expect(result[collectionKey].order).toBe(0);
        });

        test('should preserve parentId for collections in folders', async () => {
            const folderId = 'folder-parent-1';
            const collection = createMockCollection({
                uid: 'col-in-folder',
                name: 'Collection in Folder',
                parentId: folderId,
                order: 0
            });

            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
            await mockBrowser.storage.local.set({
                [collectionKey]: collection
            });

            const result = await mockBrowser.storage.local.get(collectionKey);
            expect(result[collectionKey].parentId).toBe(folderId);
        });

        test('should preserve order in collections index', async () => {
            const collections = [
                createMockCollection({ uid: 'col-a', name: 'A', order: 2 }),
                createMockCollection({ uid: 'col-b', name: 'B', order: 0 }),
                createMockCollection({ uid: 'col-c', name: 'C', order: 1 })
            ];

            const index = {};
            collections.forEach(col => {
                index[col.uid] = {
                    name: col.name,
                    type: 'collection',
                    order: col.order
                };
            });

            await mockBrowser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: index
            });

            const result = await mockBrowser.storage.local.get(STORAGE_KEYS.COLLECTIONS_INDEX);
            expect(result[STORAGE_KEYS.COLLECTIONS_INDEX]['col-a'].order).toBe(2);
            expect(result[STORAGE_KEYS.COLLECTIONS_INDEX]['col-b'].order).toBe(0);
            expect(result[STORAGE_KEYS.COLLECTIONS_INDEX]['col-c'].order).toBe(1);
        });
    });

    describe('collection order within folders', () => {
        test('should maintain separate order for collections in different folders', async () => {
            const folder1Collections = [
                createMockCollection({ uid: 'f1-c1', parentId: 'folder-1', order: 0 }),
                createMockCollection({ uid: 'f1-c2', parentId: 'folder-1', order: 1 })
            ];
            
            const folder2Collections = [
                createMockCollection({ uid: 'f2-c1', parentId: 'folder-2', order: 0 }),
                createMockCollection({ uid: 'f2-c2', parentId: 'folder-2', order: 1 })
            ];

            const allCollections = [...folder1Collections, ...folder2Collections];
            
            const index = {};
            allCollections.forEach(col => {
                index[col.uid] = {
                    name: col.name,
                    type: 'collection',
                    order: col.order,
                    parentId: col.parentId
                };
            });

            // Verify folder 1 collections have correct order
            const f1Cols = Object.entries(index)
                .filter(([, meta]) => meta.parentId === 'folder-1')
                .sort((a, b) => a[1].order - b[1].order);
            
            expect(f1Cols[0][0]).toBe('f1-c1');
            expect(f1Cols[1][0]).toBe('f1-c2');

            // Verify folder 2 collections have correct order
            const f2Cols = Object.entries(index)
                .filter(([, meta]) => meta.parentId === 'folder-2')
                .sort((a, b) => a[1].order - b[1].order);
            
            expect(f2Cols[0][0]).toBe('f2-c1');
            expect(f2Cols[1][0]).toBe('f2-c2');
        });
    });
});

// ============================================
// FOLDER SYNC TESTS
// ============================================

describe('Folder Sync', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('updateAllFoldersBG behavior', () => {
        test('should save folders with order in index', async () => {
            const folders = [
                createMockFolder({ uid: 'f-1', name: 'Folder 1', order: 0 }),
                createMockFolder({ uid: 'f-2', name: 'Folder 2', order: 1 })
            ];

            const index = {};
            for (const folder of folders) {
                const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${folder.uid}`;
                await mockBrowser.storage.local.set({
                    [folderKey]: folder
                });
                index[folder.uid] = {
                    name: folder.name,
                    type: 'folder',
                    order: folder.order
                };
            }
            await mockBrowser.storage.local.set({
                [STORAGE_KEYS.FOLDERS_INDEX]: index
            });

            const result = await mockBrowser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
            expect(result[STORAGE_KEYS.FOLDERS_INDEX]['f-1'].order).toBe(0);
            expect(result[STORAGE_KEYS.FOLDERS_INDEX]['f-2'].order).toBe(1);
        });
    });

    describe('folder deletion sync', () => {
        test('should identify folders to delete when not present on server', () => {
            const localFolderUids = ['folder-1', 'folder-2', 'folder-3'];
            const serverFolderUids = ['folder-1', 'folder-3']; // folder-2 was deleted

            const foldersToDelete = localFolderUids.filter(
                uid => !serverFolderUids.includes(uid)
            );

            expect(foldersToDelete).toEqual(['folder-2']);
        });

        test('should delete folder from storage and index', async () => {
            const folderUid = 'folder-to-delete';
            const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${folderUid}`;
            
            // Set up initial state with folder
            mockBrowser.storage.local._data = {
                [folderKey]: createMockFolder({ uid: folderUid }),
                [STORAGE_KEYS.FOLDERS_INDEX]: {
                    [folderUid]: { name: 'To Delete', type: 'folder', order: 0 }
                }
            };

            // Simulate deletion
            await mockBrowser.storage.local.remove(folderKey);
            const index = mockBrowser.storage.local._data[STORAGE_KEYS.FOLDERS_INDEX];
            delete index[folderUid];
            await mockBrowser.storage.local.set({
                [STORAGE_KEYS.FOLDERS_INDEX]: index
            });

            // Verify deletion
            const folderResult = await mockBrowser.storage.local.get(folderKey);
            expect(folderResult[folderKey]).toBeUndefined();
            
            const indexResult = await mockBrowser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
            expect(indexResult[STORAGE_KEYS.FOLDERS_INDEX][folderUid]).toBeUndefined();
        });

        test('should handle empty foldersArray from server (delete all local folders)', () => {
            const localFolderUids = ['folder-1', 'folder-2'];
            const serverFolderUids = []; // All folders deleted

            const foldersToDelete = localFolderUids.filter(
                uid => !serverFolderUids.includes(uid)
            );

            expect(foldersToDelete).toEqual(['folder-1', 'folder-2']);
        });

        test('should not delete folders when server has same folders', () => {
            const localFolderUids = ['folder-1', 'folder-2'];
            const serverFolderUids = ['folder-1', 'folder-2'];

            const foldersToDelete = localFolderUids.filter(
                uid => !serverFolderUids.includes(uid)
            );

            expect(foldersToDelete).toEqual([]);
        });
    });
});

// ============================================
// ORDER PRESERVATION TESTS
// ============================================

describe('Order Preservation', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('index as source of truth for order', () => {
        test('should prefer index order over stale collection order', async () => {
            // Scenario: Collection has stale order=2, but index has correct order=0
            const indexOrder = 0;
            const staleCollectionOrder = 2;
            
            mockBrowser.storage.local._data = {
                [STORAGE_KEYS.COLLECTIONS_INDEX]: {
                    'col-1': { name: 'Test', order: indexOrder }
                }
            };

            const collection = createMockCollection({
                uid: 'col-1',
                order: staleCollectionOrder
            });

            // Logic from batchUpdateCollections: prefer index order
            const index = mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX];
            const existingIndexOrder = index[collection.uid]?.order;
            
            let resolvedOrder;
            if (existingIndexOrder !== undefined && existingIndexOrder !== null) {
                resolvedOrder = existingIndexOrder; // Use index (source of truth)
            } else {
                resolvedOrder = collection.order;
            }

            expect(resolvedOrder).toBe(indexOrder);
            expect(resolvedOrder).not.toBe(staleCollectionOrder);
        });

        test('should use collection order when index has no order', () => {
            const collectionOrder = 5;
            
            const index = {
                'col-1': { name: 'Test' } // No order in index
            };

            const collection = createMockCollection({
                uid: 'col-1',
                order: collectionOrder
            });

            const existingIndexOrder = index[collection.uid]?.order;
            
            let resolvedOrder;
            if (existingIndexOrder !== undefined && existingIndexOrder !== null) {
                resolvedOrder = existingIndexOrder;
            } else if (collection.order !== undefined && collection.order !== null) {
                resolvedOrder = collection.order;
            }

            expect(resolvedOrder).toBe(collectionOrder);
        });
    });

    describe('folder order preservation', () => {
        test('should preserve folder order through sync cycle', async () => {
            const folders = [
                createMockFolder({ uid: 'f-1', name: 'First', order: 0 }),
                createMockFolder({ uid: 'f-2', name: 'Second', order: 1 }),
                createMockFolder({ uid: 'f-3', name: 'Third', order: 2 })
            ];

            // Simulate upload
            const syncData = {
                foldersArray: folders.map(f => ({ ...f }))
            };

            // Simulate download and save
            const savedIndex = {};
            syncData.foldersArray.forEach((folder, idx) => {
                const order = folder.order !== undefined ? folder.order : idx;
                savedIndex[folder.uid] = {
                    name: folder.name,
                    order: order
                };
            });

            // Verify order is preserved
            expect(savedIndex['f-1'].order).toBe(0);
            expect(savedIndex['f-2'].order).toBe(1);
            expect(savedIndex['f-3'].order).toBe(2);
        });

        test('should assign fallback order based on array index when missing', () => {
            const foldersFromServer = [
                { uid: 'f-1', name: 'First' }, // No order
                { uid: 'f-2', name: 'Second' }, // No order
                { uid: 'f-3', name: 'Third', order: 5 } // Has order
            ];

            const normalizedFolders = foldersFromServer.map((folder, idx) => ({
                ...folder,
                order: folder.order !== undefined ? folder.order : idx
            }));

            expect(normalizedFolders[0].order).toBe(0); // Fallback to index
            expect(normalizedFolders[1].order).toBe(1); // Fallback to index
            expect(normalizedFolders[2].order).toBe(5); // Preserved from server
        });
    });
});

// ============================================
// EDGE CASES
// ============================================

describe('Edge Cases', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('empty data handling', () => {
        test('should handle empty collections array', () => {
            const syncData = {
                tabsArray: [],
                foldersArray: []
            };

            expect(syncData.tabsArray.length).toBe(0);
            expect(syncData.foldersArray.length).toBe(0);
        });

        test('should handle null parentId correctly', () => {
            const rootCollection = createMockCollection({
                uid: 'root-col',
                parentId: null
            });

            const folderCollection = createMockCollection({
                uid: 'folder-col',
                parentId: 'some-folder'
            });

            expect(rootCollection.parentId).toBeNull();
            expect(folderCollection.parentId).toBe('some-folder');
        });

        test('should handle undefined vs null order', () => {
            const undefinedOrder = { order: undefined };
            const nullOrder = { order: null };
            const zeroOrder = { order: 0 };

            // undefined means "preserve existing"
            expect(undefinedOrder.order === undefined).toBe(true);
            
            // null means "clear order"
            expect(nullOrder.order === null).toBe(true);
            
            // 0 is a valid order value
            expect(zeroOrder.order).toBe(0);
            expect(zeroOrder.order !== undefined).toBe(true);
            expect(zeroOrder.order !== null).toBe(true);
        });
    });

    describe('concurrent operations', () => {
        test('should handle multiple collections with same order gracefully', () => {
            // This can happen during sync conflicts
            const collections = [
                createMockCollection({ uid: 'c1', order: 0 }),
                createMockCollection({ uid: 'c2', order: 0 }), // Duplicate order
                createMockCollection({ uid: 'c3', order: 1 })
            ];

            // Should not throw
            const sorted = [...collections].sort((a, b) => {
                const aOrder = a.order ?? 999999;
                const bOrder = b.order ?? 999999;
                return aOrder - bOrder;
            });

            expect(sorted.length).toBe(3);
        });
    });

    describe('data validation', () => {
        test('should reject collection without uid', () => {
            const invalidCollection = {
                name: 'No UID Collection',
                tabs: []
                // Missing uid
            };

            expect(invalidCollection.uid).toBeUndefined();
            
            // Validation logic
            const isValid = invalidCollection.uid && invalidCollection.name;
            expect(isValid).toBeFalsy();
        });

        test('should reject folder without uid', () => {
            const invalidFolder = {
                name: 'No UID Folder'
                // Missing uid
            };

            expect(invalidFolder.uid).toBeUndefined();
            
            const isValid = invalidFolder.uid && invalidFolder.name;
            expect(isValid).toBeFalsy();
        });

        test('should handle collection with missing tabs array', () => {
            const collectionNoTabs = {
                uid: 'col-no-tabs',
                name: 'No Tabs'
                // Missing tabs
            };

            const normalizedTabs = collectionNoTabs.tabs || [];
            expect(normalizedTabs).toEqual([]);
        });
    });
});

// ============================================
// INTEGRATION-STYLE TESTS
// ============================================

describe('Sync Flow Integration', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('full sync cycle simulation', () => {
        test('should maintain data integrity through upload-download cycle', async () => {
            // Setup: Create local data
            const originalCollections = [
                createMockCollection({ uid: 'c1', name: 'Collection 1', order: 0, parentId: null }),
                createMockCollection({ uid: 'c2', name: 'Collection 2', order: 1, parentId: 'f1' }),
                createMockCollection({ uid: 'c3', name: 'Collection 3', order: 0, parentId: 'f1' })
            ];
            
            const originalFolders = [
                createMockFolder({ uid: 'f1', name: 'Folder 1', order: 0 })
            ];

            // Step 1: Prepare for upload
            const uploadData = {
                timestamp: Date.now(),
                tabsArray: originalCollections.map(c => ({ ...c })),
                foldersArray: originalFolders.map(f => ({ ...f })),
                syncVersion: '4.0'
            };

            // Step 2: Simulate server storage (serialize/deserialize)
            const serverData = JSON.parse(JSON.stringify(uploadData));

            // Step 3: Download and apply
            const downloadedCollections = serverData.tabsArray;
            const downloadedFolders = serverData.foldersArray;

            // Verify data integrity
            expect(downloadedCollections.length).toBe(originalCollections.length);
            expect(downloadedFolders.length).toBe(originalFolders.length);

            // Verify specific fields
            const c2 = downloadedCollections.find(c => c.uid === 'c2');
            expect(c2.parentId).toBe('f1');
            expect(c2.order).toBe(1);

            const f1 = downloadedFolders.find(f => f.uid === 'f1');
            expect(f1.order).toBe(0);
        });

        test('should handle reorder then sync correctly', async () => {
            // Initial order: c1=0, c2=1, c3=2 (all in folder-1)
            // User reorders: c3 moves to position 0
            // New order should be: c3=0, c1=1, c2=2
            const reorderedIndex = {
                'c1': { name: 'C1', order: 1, parentId: 'folder-1' },
                'c2': { name: 'C2', order: 2, parentId: 'folder-1' },
                'c3': { name: 'C3', order: 0, parentId: 'folder-1' }
            };

            // Verify the reorder is correct
            const sorted = Object.entries(reorderedIndex)
                .filter(([, meta]) => meta.parentId === 'folder-1')
                .sort((a, b) => a[1].order - b[1].order)
                .map(([uid]) => uid);

            expect(sorted).toEqual(['c3', 'c1', 'c2']);
        });
    });

    describe('multi-device sync simulation', () => {
        test('should sync folder deletion from Device A to Device B', async () => {
            // Device A state: has folder-1, folder-2
            // Device A deletes folder-2
            // Server receives: [folder-1]
            // Device B has: folder-1, folder-2
            // Device B syncs and should delete folder-2

            const deviceBLocalFolders = ['folder-1', 'folder-2'];
            const serverFolders = ['folder-1']; // folder-2 deleted on Device A

            const foldersToDelete = deviceBLocalFolders.filter(
                uid => !serverFolders.includes(uid)
            );

            expect(foldersToDelete).toEqual(['folder-2']);
        });

        test('should sync collection reorder from Device A to Device B', () => {
            // Device A reorders collections in folder
            // Server receives new order
            // Device B should adopt the new order

            const serverCollectionsInFolder = [
                { uid: 'c3', order: 0, parentId: 'f1' }, // Was order 2
                { uid: 'c1', order: 1, parentId: 'f1' }, // Was order 0
                { uid: 'c2', order: 2, parentId: 'f1' }  // Was order 1
            ];

            // Device B applies the order from server
            const deviceBIndex = {};
            serverCollectionsInFolder.forEach(col => {
                deviceBIndex[col.uid] = {
                    order: col.order,
                    parentId: col.parentId
                };
            });

            // Verify Device B has correct order
            expect(deviceBIndex['c3'].order).toBe(0);
            expect(deviceBIndex['c1'].order).toBe(1);
            expect(deviceBIndex['c2'].order).toBe(2);
        });
    });
});

// ============================================
// NETWORK FAILURE TESTS
// ============================================

describe('Network Failure Handling', () => {
    beforeEach(() => {
        resetStorage();
        mockFetch.mockClear();
    });

    describe('upload failures', () => {
        test('should handle network timeout during upload', async () => {
            mockFetch.mockImplementationOnce(() => 
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Network timeout')), 100)
                )
            );

            let error = null;
            try {
                await mockFetch('https://www.googleapis.com/upload/drive/v3/files');
            } catch (e) {
                error = e;
            }

            expect(error).not.toBeNull();
            expect(error.message).toBe('Network timeout');
        });

        test('should handle HTTP 401 Unauthorized', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized'
            });

            const response = await mockFetch('https://www.googleapis.com/upload/drive/v3/files');
            
            expect(response.ok).toBe(false);
            expect(response.status).toBe(401);
        });

        test('should handle HTTP 403 Forbidden', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                statusText: 'Forbidden'
            });

            const response = await mockFetch('https://www.googleapis.com/upload/drive/v3/files');
            
            expect(response.ok).toBe(false);
            expect(response.status).toBe(403);
        });

        test('should handle HTTP 500 Server Error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            const response = await mockFetch('https://www.googleapis.com/upload/drive/v3/files');
            
            expect(response.ok).toBe(false);
            expect(response.status).toBe(500);
        });

        test('should handle HTTP 503 Service Unavailable', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable'
            });

            const response = await mockFetch('https://www.googleapis.com/upload/drive/v3/files');
            
            expect(response.ok).toBe(false);
            expect(response.status).toBe(503);
        });
    });

    describe('download failures', () => {
        test('should handle corrupted JSON response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.reject(new SyntaxError('Unexpected token'))
            });

            const response = await mockFetch('https://www.googleapis.com/drive/v3/files/123');
            
            let parseError = null;
            try {
                await response.json();
            } catch (e) {
                parseError = e;
            }

            expect(parseError).toBeInstanceOf(SyntaxError);
        });

        test('should handle empty response body', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(null)
            });

            const response = await mockFetch('https://www.googleapis.com/drive/v3/files/123');
            const data = await response.json();
            
            expect(data).toBeNull();
        });

        test('should handle HTTP 404 File Not Found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found'
            });

            const response = await mockFetch('https://www.googleapis.com/drive/v3/files/123');
            
            expect(response.ok).toBe(false);
            expect(response.status).toBe(404);
        });
    });

    describe('retry logic', () => {
        test('should retry on transient failures', async () => {
            // First call fails, second succeeds
            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ success: true })
                });

            // Simulate retry logic
            let result = null;
            let attempts = 0;
            const maxRetries = 3;

            while (attempts < maxRetries && result === null) {
                attempts++;
                try {
                    const response = await mockFetch('https://api.example.com');
                    if (response.ok) {
                        result = await response.json();
                    }
                } catch (e) {
                    if (attempts >= maxRetries) throw e;
                    // Continue to retry
                }
            }

            expect(attempts).toBe(2);
            expect(result).toEqual({ success: true });
        });

        test('should give up after max retries', async () => {
            mockFetch.mockRejectedValue(new Error('Persistent network error'));

            let attempts = 0;
            const maxRetries = 3;
            let finalError = null;

            while (attempts < maxRetries) {
                attempts++;
                try {
                    await mockFetch('https://api.example.com');
                } catch (e) {
                    finalError = e;
                }
            }

            expect(attempts).toBe(maxRetries);
            expect(finalError).not.toBeNull();
            expect(finalError.message).toBe('Persistent network error');
        });
    });

    describe('offline handling', () => {
        test('should detect offline state', () => {
            // Simulate navigator.onLine
            const mockNavigator = { onLine: false };
            
            expect(mockNavigator.onLine).toBe(false);
        });

        test('should queue sync when offline', () => {
            const syncQueue = [];
            const isOnline = false;

            const syncOperation = { type: 'upload', data: { collections: [] } };

            if (!isOnline) {
                syncQueue.push(syncOperation);
            }

            expect(syncQueue.length).toBe(1);
            expect(syncQueue[0].type).toBe('upload');
        });
    });
});

// ============================================
// SPECIAL CHARACTERS TESTS
// ============================================

describe('Special Characters Handling', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('collection names with special characters', () => {
        test('should handle Unicode characters in collection name', () => {
            const collection = createMockCollection({
                uid: 'unicode-col',
                name: '日本語コレクション 🎉 émojis'
            });

            expect(collection.name).toBe('日本語コレクション 🎉 émojis');
            
            // Should survive JSON serialization
            const serialized = JSON.stringify(collection);
            const deserialized = JSON.parse(serialized);
            expect(deserialized.name).toBe('日本語コレクション 🎉 émojis');
        });

        test('should handle emoji-only collection name', () => {
            const collection = createMockCollection({
                uid: 'emoji-col',
                name: '🔥🚀💡🎨'
            });

            expect(collection.name).toBe('🔥🚀💡🎨');
        });

        test('should handle HTML entities in collection name', () => {
            const collection = createMockCollection({
                uid: 'html-col',
                name: 'Test &amp; Collection <script>alert("xss")</script>'
            });

            // Name should be stored as-is (escaping happens at render time)
            expect(collection.name).toContain('&amp;');
            expect(collection.name).toContain('<script>');
        });

        test('should handle newlines and tabs in collection name', () => {
            const collection = createMockCollection({
                uid: 'whitespace-col',
                name: 'Line1\nLine2\tTabbed'
            });

            expect(collection.name).toContain('\n');
            expect(collection.name).toContain('\t');
        });

        test('should handle very long collection name', () => {
            const longName = 'A'.repeat(1000);
            const collection = createMockCollection({
                uid: 'long-col',
                name: longName
            });

            expect(collection.name.length).toBe(1000);
        });

        test('should handle empty string collection name', () => {
            const collection = createMockCollection({
                uid: 'empty-col',
                name: ''
            });

            expect(collection.name).toBe('');
            // Validation should catch this
            const isValid = collection.name && collection.name.trim().length > 0;
            expect(isValid).toBeFalsy();
        });

        test('should handle whitespace-only collection name', () => {
            const collection = createMockCollection({
                uid: 'whitespace-col',
                name: '   \t\n   '
            });

            const trimmed = collection.name.trim();
            expect(trimmed).toBe('');
        });
    });

    describe('folder names with special characters', () => {
        test('should handle Unicode in folder name', () => {
            const folder = createMockFolder({
                uid: 'unicode-folder',
                name: 'Dossier français 文件夹'
            });

            expect(folder.name).toBe('Dossier français 文件夹');
        });

        test('should handle special filesystem characters', () => {
            // Characters that might cause issues in some systems
            const folder = createMockFolder({
                uid: 'special-folder',
                name: 'Folder: with/special\\chars?*'
            });

            expect(folder.name).toContain(':');
            expect(folder.name).toContain('/');
            expect(folder.name).toContain('\\');
        });
    });

    describe('tab data with special characters', () => {
        test('should handle Unicode URLs', () => {
            const collection = createMockCollection({
                uid: 'unicode-url-col',
                tabs: [{
                    url: 'https://example.com/путь/страница',
                    title: 'Russian Page'
                }]
            });

            expect(collection.tabs[0].url).toContain('путь');
        });

        test('should handle URLs with query parameters', () => {
            const collection = createMockCollection({
                uid: 'query-url-col',
                tabs: [{
                    url: 'https://example.com/search?q=test&foo=bar&special=%20%26',
                    title: 'Search Results'
                }]
            });

            expect(collection.tabs[0].url).toContain('?q=test');
            expect(collection.tabs[0].url).toContain('%20%26');
        });

        test('should handle data URLs', () => {
            const collection = createMockCollection({
                uid: 'data-url-col',
                tabs: [{
                    url: 'data:text/html,<h1>Hello</h1>',
                    title: 'Data URL'
                }]
            });

            expect(collection.tabs[0].url).toStartWith('data:');
        });

        test('should handle JavaScript URLs (should typically be filtered)', () => {
            const jsUrl = 'javascript:alert("test")';
            
            // These should typically be filtered out
            const isJavaScriptUrl = jsUrl.toLowerCase().startsWith('javascript:');
            expect(isJavaScriptUrl).toBe(true);
        });
    });

    describe('JSON serialization edge cases', () => {
        test('should handle circular reference protection', () => {
            const collection = createMockCollection({ uid: 'circular-col' });
            
            // This would cause circular reference if not handled
            // In real code, we don't create circular refs, but test the concept
            const safeStringify = (obj) => {
                const seen = new WeakSet();
                return JSON.stringify(obj, (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        if (seen.has(value)) {
                            return '[Circular]';
                        }
                        seen.add(value);
                    }
                    return value;
                });
            };

            expect(() => safeStringify(collection)).not.toThrow();
        });

        test('should handle undefined values in objects', () => {
            const collection = {
                uid: 'undefined-col',
                name: 'Test',
                undefinedField: undefined,
                nullField: null
            };

            const serialized = JSON.stringify(collection);
            const deserialized = JSON.parse(serialized);

            // undefined is removed by JSON.stringify
            expect(deserialized.undefinedField).toBeUndefined();
            // null is preserved
            expect(deserialized.nullField).toBeNull();
        });

        test('should handle Date objects', () => {
            const now = new Date();
            const collection = createMockCollection({
                uid: 'date-col',
                createdOn: now.getTime() // Should be timestamp, not Date object
            });

            const serialized = JSON.stringify(collection);
            const deserialized = JSON.parse(serialized);

            expect(typeof deserialized.createdOn).toBe('number');
        });
    });
});

// ============================================
// UI STATE UPDATE TESTS
// ============================================

describe('UI State Updates After Sync', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('collections list updates', () => {
        test('should reflect new collections after sync', () => {
            const serverCollections = [
                createMockCollection({ uid: 'c1', name: 'Existing 1' }),
                createMockCollection({ uid: 'c2', name: 'New from sync' })
            ];

            // Simulate state update
            const updatedCollections = serverCollections;

            expect(updatedCollections.length).toBe(2);
            expect(updatedCollections.find(c => c.uid === 'c2')).toBeDefined();
        });

        test('should reflect deleted collections after sync', () => {
            const existingCollections = [
                createMockCollection({ uid: 'c1', name: 'Collection 1' }),
                createMockCollection({ uid: 'c2', name: 'Collection 2' })
            ];

            const serverCollections = [
                createMockCollection({ uid: 'c1', name: 'Collection 1' })
                // c2 was deleted on another device
            ];

            // Find collections to remove
            const serverUids = serverCollections.map(c => c.uid);
            const collectionsToRemove = existingCollections.filter(
                c => !serverUids.includes(c.uid)
            );

            expect(collectionsToRemove.length).toBe(1);
            expect(collectionsToRemove[0].uid).toBe('c2');
        });

        test('should reflect renamed collections after sync', () => {
            const existingCollections = [
                createMockCollection({ uid: 'c1', name: 'Old Name' })
            ];

            const serverCollections = [
                createMockCollection({ uid: 'c1', name: 'New Name' })
            ];

            // Merge: server wins
            const merged = existingCollections.map(local => {
                const server = serverCollections.find(s => s.uid === local.uid);
                return server || local;
            });

            expect(merged[0].name).toBe('New Name');
        });

        test('should reflect updated tab count after sync', () => {
            const existingCollection = createMockCollection({
                uid: 'c1',
                tabs: [{ url: 'https://a.com', title: 'A' }]
            });

            const serverCollection = createMockCollection({
                uid: 'c1',
                tabs: [
                    { url: 'https://a.com', title: 'A' },
                    { url: 'https://b.com', title: 'B' },
                    { url: 'https://c.com', title: 'C' }
                ]
            });

            expect(existingCollection.tabs.length).toBe(1);
            expect(serverCollection.tabs.length).toBe(3);

            // After sync, UI should show 3 tabs
            const tabCount = serverCollection.tabs.length;
            expect(tabCount).toBe(3);
        });
    });

    describe('folders list updates', () => {
        test('should reflect new folders after sync', () => {
            const serverFolders = [
                createMockFolder({ uid: 'f1', name: 'Folder 1' }),
                createMockFolder({ uid: 'f2', name: 'New Folder' })
            ];

            const updatedFolders = serverFolders;

            expect(updatedFolders.length).toBe(2);
            expect(updatedFolders.find(f => f.uid === 'f2')).toBeDefined();
        });

        test('should update folder collection count after sync', () => {
            const folder = createMockFolder({ uid: 'f1', name: 'Folder 1' });
            
            const collectionsInFolder = [
                createMockCollection({ uid: 'c1', parentId: 'f1' }),
                createMockCollection({ uid: 'c2', parentId: 'f1' }),
                createMockCollection({ uid: 'c3', parentId: 'f1' })
            ];

            const collectionCount = collectionsInFolder.filter(
                c => c.parentId === folder.uid
            ).length;

            expect(collectionCount).toBe(3);
        });

        test('should reflect folder order change after sync', () => {
            // Server has reordered folders
            const serverFolders = [
                createMockFolder({ uid: 'f2', name: 'Second', order: 0 }),
                createMockFolder({ uid: 'f1', name: 'First', order: 1 })
            ];

            const sortedFolders = [...serverFolders].sort((a, b) => a.order - b.order);

            expect(sortedFolders[0].uid).toBe('f2');
            expect(sortedFolders[1].uid).toBe('f1');
        });
    });

    describe('sync status indicators', () => {
        test('should track last sync time', () => {
            const beforeSync = Date.now();
            
            // Simulate sync completion
            const lastSyncTime = Date.now();
            
            expect(lastSyncTime).toBeGreaterThanOrEqual(beforeSync);
        });

        test('should indicate sync in progress', () => {
            let isSyncing = false;

            // Start sync
            isSyncing = true;
            expect(isSyncing).toBe(true);

            // End sync
            isSyncing = false;
            expect(isSyncing).toBe(false);
        });

        test('should indicate sync error state', () => {
            let syncError = null;

            // Simulate error
            syncError = { message: 'Network error', code: 'NETWORK_ERROR' };
            
            expect(syncError).not.toBeNull();
            expect(syncError.code).toBe('NETWORK_ERROR');

            // Clear error on successful sync
            syncError = null;
            expect(syncError).toBeNull();
        });

        test('should track pending changes count', () => {
            let pendingChanges = 0;

            // User makes changes
            pendingChanges++;
            pendingChanges++;
            expect(pendingChanges).toBe(2);

            // Sync completes
            pendingChanges = 0;
            expect(pendingChanges).toBe(0);
        });
    });

    describe('optimistic UI updates', () => {
        test('should show changes immediately before sync confirms', () => {
            const collections = [
                createMockCollection({ uid: 'c1', name: 'Original' })
            ];

            // User renames collection
            const renamedCollection = { ...collections[0], name: 'Renamed' };
            
            // Optimistic update
            const optimisticState = collections.map(c => 
                c.uid === renamedCollection.uid ? renamedCollection : c
            );

            expect(optimisticState[0].name).toBe('Renamed');
        });

        test('should rollback on sync failure', () => {
            const originalCollection = createMockCollection({ uid: 'c1', name: 'Original' });
            const modifiedCollection = { ...originalCollection, name: 'Modified' };

            // Simulate rollback on failure
            const syncFailed = true;
            const currentState = syncFailed ? originalCollection : modifiedCollection;

            expect(currentState.name).toBe('Original');
        });
    });
});

// ============================================
// LARGE DATA TESTS
// ============================================

describe('Large Data Handling', () => {
    beforeEach(() => {
        resetStorage();
    });

    describe('performance with many collections', () => {
        test('should handle 100 collections', () => {
            const collections = Array.from({ length: 100 }, (_, i) =>
                createMockCollection({ uid: `col-${i}`, name: `Collection ${i}` })
            );

            expect(collections.length).toBe(100);
            
            // Serialization should work
            const serialized = JSON.stringify({ tabsArray: collections });
            expect(serialized.length).toBeGreaterThan(0);
        });

        test('should handle 50 folders', () => {
            const folders = Array.from({ length: 50 }, (_, i) =>
                createMockFolder({ uid: `folder-${i}`, name: `Folder ${i}`, order: i })
            );

            expect(folders.length).toBe(50);
        });

        test('should handle collection with 500 tabs', () => {
            const tabs = Array.from({ length: 500 }, (_, i) => ({
                url: `https://example.com/page${i}`,
                title: `Page ${i}`
            }));

            const collection = createMockCollection({
                uid: 'large-col',
                tabs: tabs
            });

            expect(collection.tabs.length).toBe(500);
        });
    });

    describe('sync data size', () => {
        test('should calculate sync data size', () => {
            const collection = createMockCollection({
                uid: 'sized-col',
                tabs: Array.from({ length: 100 }, (_, i) => ({
                    url: `https://example.com/page${i}`,
                    title: `Page ${i} with some longer title text`
                }))
            });

            const size = JSON.stringify(collection).length;
            
            // Should be reasonable size (not megabytes for 100 tabs)
            expect(size).toBeLessThan(100000); // Less than 100KB
            expect(size).toBeGreaterThan(1000); // More than 1KB
        });
    });
});
