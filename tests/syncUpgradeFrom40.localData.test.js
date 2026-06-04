const { createBrowserHarness } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot } = require('./helpers/upgradeFixtures');

describe('4.0 upgrade compatibility - local data', () => {
    let browser;
    let storageUtils;

    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        jest.doMock('../static/globals', () => ({ browser }));
        storageUtils = require('../app/utils/storageUtils');
    });

    afterEach(() => {
        jest.dontMock('../static/globals');
        delete global.browser;
        delete global.chrome;
    });

    test('preserves collections, folders, order, and membership from a 4.0 local snapshot', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();

        const collections = await storageUtils.loadAllCollections({
            metadataOnly: false,
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });
        const folders = await storageUtils.loadAllFolders({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc'
        });

        expect(collections.map((collection) => collection.uid)).toEqual([
            'collection-folder-a',
            'collection-folder-b',
            'collection-root-a'
        ]);
        expect(collections.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
            expect.objectContaining({
                parentId: 'folder-alpha',
                order: 0,
                lastOpened: 5300
            })
        );
        expect(collections.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                parentId: null,
                order: 0
            })
        );
        expect(folders.map((folder) => folder.uid)).toEqual(['folder-alpha', 'folder-empty']);
        expect(folders.find((folder) => folder.uid === 'folder-alpha')).toEqual(
            expect.objectContaining({
                order: 0,
                collectionCount: 2
            })
        );
        expect(folders.find((folder) => folder.uid === 'folder-empty')).toEqual(
            expect.objectContaining({
                order: 1,
                collectionCount: 0
            })
        );
    });

    test('preserves aggregate counts, folder membership, and manual order during 4.0 upgrade loading', async () => {
        const snapshot = createVersion40LocalSnapshot();
        browser.storage.local._data = snapshot;

        const beforeCollections = snapshot.tabsArray;
        const beforeCollectionMap = beforeCollections.reduce((result, collection) => {
            result[collection.uid] = {
                parentId: collection.parentId || null,
                order: collection.order,
                tabCount: collection.tabs.length
            };
            return result;
        }, {});
        const beforeTabCount = beforeCollections.reduce((sum, collection) => sum + collection.tabs.length, 0);

        const collections = await storageUtils.loadAllCollections({
            metadataOnly: false,
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });
        const folders = await storageUtils.loadAllFolders({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc'
        });

        const afterCollectionMap = collections.reduce((result, collection) => {
            result[collection.uid] = {
                parentId: collection.parentId || null,
                order: collection.order,
                tabCount: collection.tabs.length
            };
            return result;
        }, {});
        const afterTabCount = collections.reduce((sum, collection) => sum + collection.tabs.length, 0);

        expect(collections).toHaveLength(beforeCollections.length);
        expect(folders).toHaveLength(2);
        expect(afterTabCount).toBe(beforeTabCount);
        expect(afterCollectionMap).toEqual(beforeCollectionMap);
        expect(folders.map((folder) => ({ uid: folder.uid, order: folder.order, collectionCount: folder.collectionCount }))).toEqual([
            { uid: 'folder-alpha', order: 0, collectionCount: 2 },
            { uid: 'folder-empty', order: 1, collectionCount: 0 }
        ]);
    });

    test('repairs incomplete indexed data from the 4.0 tabsArray mirror without wiping folders', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot({
            incompleteIndexedCollections: true
        });

        const result = await storageUtils.migrateLegacyStorage();
        const collections = await storageUtils.loadAllCollections({
            metadataOnly: false,
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });
        const folders = await storageUtils.loadAllFolders({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc'
        });

        expect(result.success).toBe(true);
        expect(collections.find((collection) => collection.uid === 'collection-folder-b')).toEqual(
            expect.objectContaining({
                tabs: expect.arrayContaining([
                    expect.objectContaining({ title: 'Beta Home' }),
                    expect.objectContaining({ title: 'Beta Notes' })
                ]),
                parentId: 'folder-alpha'
            })
        );
        expect(folders.map((folder) => folder.uid)).toEqual(['folder-alpha', 'folder-empty']);
    });

    test('repairs orphaned folder references without deleting upgraded collections', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot({
            orphanRootCollection: true
        });

        const result = await storageUtils.repairOrphanCollections();
        const collections = await storageUtils.loadAllCollections({
            metadataOnly: false,
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });

        expect(result).toEqual(
            expect.objectContaining({
                success: true,
                orphansFound: 1,
                orphansRepaired: 1,
                orphanUids: ['collection-root-a']
            })
        );
        expect(collections.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                parentId: null
            })
        );
    });

    test('prunes ghost index entries whose backing storage was removed', async () => {
        // Simulates the corruption left by a concurrent folder-delete that raced on
        // the shared collections_index: the index still references a collection whose
        // storage record is gone (the "found in index but not in storage" warning).
        browser.storage.local._data = {
            collections_index: {
                'collection-live': { name: 'Live', type: 'collection', parentId: null, order: 0 },
                'collection-ghost': { name: 'Ghost', type: 'collection', parentId: null, order: 1 }
            },
            'collection_collection-live': {
                uid: 'collection-live',
                name: 'Live',
                parentId: null,
                tabs: [{ uid: 'tab-1', url: 'https://example.com' }],
                chromeGroups: []
            }
            // No collection_collection-ghost record on purpose.
        };

        const result = await storageUtils.repairOrphanCollections();

        expect(result).toEqual(
            expect.objectContaining({
                success: true,
                orphansFound: 0,
                orphansRepaired: 0,
                ghostsPruned: 1,
                ghostUids: ['collection-ghost']
            })
        );

        // The ghost is gone from the persisted index...
        const index = await storageUtils.loadCollectionsIndex();
        expect(Object.keys(index)).toEqual(['collection-live']);

        // ...and the live collection still loads cleanly.
        const collections = await storageUtils.loadAllCollections({ metadataOnly: false });
        expect(collections.map((collection) => collection.uid)).toEqual(['collection-live']);
    });

    test('backfills missing optional 4.0 local fields without losing upgraded data', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot({
            missingOptionalFields: true
        });

        const result = await storageUtils.migrateLegacyStorage();
        const collections = await storageUtils.loadAllCollections({
            metadataOnly: false,
            sortBy: 'lastUpdated',
            sortOrder: 'desc'
        });
        const folders = await storageUtils.loadAllFolders({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc'
        });

        expect(result.success).toBe(true);
        expect(collections.map((collection) => collection.uid).sort()).toEqual([
            'collection-folder-a',
            'collection-folder-b',
            'collection-root-a'
        ]);
        expect(collections.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
            expect.objectContaining({
                lastOpened: null
            })
        );
        expect(collections.find((collection) => collection.uid === 'collection-folder-b')).toEqual(
            expect.objectContaining({
                lastUpdated: expect.any(Number),
                order: expect.any(Number)
            })
        );
        expect(folders.find((folder) => folder.uid === 'folder-empty')).toEqual(
            expect.objectContaining({
                lastUpdated: expect.any(Number)
            })
        );
    });
});
