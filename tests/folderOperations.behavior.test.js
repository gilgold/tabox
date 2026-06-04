jest.mock('../app/utils/storageUtils', () => ({
    saveSingleFolder: jest.fn(),
    loadSingleFolder: jest.fn(),
    deleteSingleFolder: jest.fn(),
    loadAllFolders: jest.fn(),
    updateFoldersOrder: jest.fn(),
    updateFolderCollectionCount: jest.fn(),
    saveSingleCollection: jest.fn(),
    loadSingleCollection: jest.fn(),
    deleteSingleCollection: jest.fn(),
    batchDeleteCollections: jest.fn(),
    batchUpdateCollections: jest.fn(),
    loadCollectionsIndex: jest.fn(),
    loadAllCollections: jest.fn(),
}));

jest.mock('../app/utils/sharedSync', () => ({
    triggerBackgroundSync: jest.fn(),
}));

const storageUtils = require('../app/utils/storageUtils');
const sharedSync = require('../app/utils/sharedSync');
const {
    deleteFolder,
    duplicateFolder,
    moveCollectionToFolder,
    removeCollectionFromFolder,
    getFolderCollections,
    toggleFolderCollapsed,
} = require('../app/utils/folderOperations');

describe('folderOperations additional behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        storageUtils.deleteSingleFolder.mockResolvedValue(true);
        storageUtils.deleteSingleCollection.mockResolvedValue(true);
        storageUtils.batchDeleteCollections.mockResolvedValue(true);
        storageUtils.batchUpdateCollections.mockResolvedValue(true);
        storageUtils.saveSingleCollection.mockResolvedValue(true);
        storageUtils.saveSingleFolder.mockResolvedValue(true);
        storageUtils.updateFolderCollectionCount.mockResolvedValue(true);
        storageUtils.loadAllFolders.mockResolvedValue([]);
        storageUtils.loadAllCollections.mockResolvedValue([]);
        storageUtils.loadCollectionsIndex.mockResolvedValue({});
        sharedSync.triggerBackgroundSync.mockResolvedValue(true);
    });

    test('triggers the background sync by default when deleting a folder', async () => {
        const result = await deleteFolder('folder-1', true, true);

        expect(result.success).toBe(true);
        expect(sharedSync.triggerBackgroundSync).toHaveBeenCalledTimes(1);
    });

    test('skips the background sync when skipSync is set so the caller can drive sync + indicator', async () => {
        const result = await deleteFolder('folder-1', true, true, { skipSync: true });

        expect(result.success).toBe(true);
        expect(sharedSync.triggerBackgroundSync).not.toHaveBeenCalled();
    });

    test('moves collections in a deleted folder back to root when force deleting without deletion', async () => {
        storageUtils.loadCollectionsIndex.mockResolvedValue({
            'collection-1': { parentId: 'folder-1' },
        });
        storageUtils.loadSingleCollection.mockResolvedValue({
            uid: 'collection-1',
            parentId: 'folder-1',
        });

        const result = await deleteFolder('folder-1', true, false);

        expect(result).toEqual({
            success: true,
            collectionsMovedToRoot: 1,
            collectionsDeleted: 0,
        });
        // Collections must be moved in a single atomic index pass to avoid
        // racing on the shared collections_index.
        expect(storageUtils.batchUpdateCollections).toHaveBeenCalledWith([
            expect.objectContaining({
                uid: 'collection-1',
                parentId: null,
            }),
        ]);
        expect(storageUtils.deleteSingleFolder).toHaveBeenCalledWith('folder-1');
    });

    test('deletes contained collections when force deleting with deleteCollections enabled', async () => {
        storageUtils.loadCollectionsIndex.mockResolvedValue({
            'collection-1': { parentId: 'folder-1' },
            'collection-2': { parentId: 'folder-1' },
        });

        const result = await deleteFolder('folder-1', true, true);

        expect(result).toEqual({
            success: true,
            collectionsMovedToRoot: 0,
            collectionsDeleted: 2,
        });
        // Collections must be deleted in a single atomic index pass; deleting them
        // concurrently races on collections_index and leaves stale entries pointing
        // at already-removed storage (the "found in index but not in storage" bug).
        expect(storageUtils.batchDeleteCollections).toHaveBeenCalledWith(['collection-1', 'collection-2']);
    });

    test('waits for the background sync to complete before resolving the deletion', async () => {
        storageUtils.loadCollectionsIndex.mockResolvedValue({});

        let resolveSync;
        sharedSync.triggerBackgroundSync.mockImplementation(
            () => new Promise((resolve) => { resolveSync = () => resolve(true); })
        );

        let deleteResolved = false;
        const deletion = deleteFolder('folder-1', true, false).then((result) => {
            deleteResolved = true;
            return result;
        });

        // Drain pending tasks so deletion runs through to the sync call. The
        // deletion must NOT resolve yet because the background sync has not
        // completed - otherwise the popup can tear down before the deletion
        // reaches the remote (Manifest V3 service worker lifecycle).
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sharedSync.triggerBackgroundSync).toHaveBeenCalledTimes(1);
        expect(deleteResolved).toBe(false);

        resolveSync();
        await deletion;
        expect(deleteResolved).toBe(true);
    });

    test('duplicates folders and nested collections into a new folder', async () => {
        storageUtils.loadSingleFolder.mockResolvedValue({
            uid: 'folder-1',
            name: 'Original Folder',
            color: 'blue',
            collapsed: false,
        });
        storageUtils.loadAllFolders.mockResolvedValue([
            { uid: 'folder-1', name: 'Original Folder' },
        ]);
        storageUtils.loadCollectionsIndex.mockResolvedValue({
            'collection-1': { parentId: 'folder-1' },
        });
        storageUtils.loadAllCollections.mockResolvedValue([
            {
                uid: 'collection-1',
                parentId: 'folder-1',
                name: 'Original Collection',
                tabs: [{ uid: 'tab-1', url: 'https://example.com' }],
                chromeGroups: [],
                color: 'blue',
            },
        ]);

        const result = await duplicateFolder('folder-1');

        expect(result).toEqual(expect.objectContaining({
            success: true,
            duplicatedCollections: 1,
            newFolder: expect.objectContaining({
                name: 'Original Folder (copy)',
            }),
        }));
        expect(storageUtils.saveSingleCollection).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Original Collection (copy)',
                parentId: result.newFolder.uid,
            }),
            true,
        );
        expect(storageUtils.updateFolderCollectionCount).toHaveBeenCalledWith(result.newFolder.uid);
    });

    test('waits for the background sync to complete before resolving the duplication', async () => {
        storageUtils.loadSingleFolder.mockResolvedValue({
            uid: 'folder-1',
            name: 'Original Folder',
            color: 'blue',
            collapsed: false,
        });
        storageUtils.loadAllFolders.mockResolvedValue([
            { uid: 'folder-1', name: 'Original Folder' },
        ]);
        storageUtils.loadCollectionsIndex.mockResolvedValue({});
        storageUtils.loadAllCollections.mockResolvedValue([]);

        let resolveSync;
        sharedSync.triggerBackgroundSync.mockImplementation(
            () => new Promise((resolve) => { resolveSync = () => resolve(true); })
        );

        let duplicateResolved = false;
        const duplication = duplicateFolder('folder-1').then((result) => {
            duplicateResolved = true;
            return result;
        });

        // Drain pending tasks so duplication runs through to the sync call. The
        // duplication must NOT resolve yet because the background sync has not
        // completed - otherwise the popup can tear down before the duplicate
        // reaches the remote.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sharedSync.triggerBackgroundSync).toHaveBeenCalledTimes(1);
        expect(duplicateResolved).toBe(false);

        resolveSync();
        await duplication;
        expect(duplicateResolved).toBe(true);
    });

    test('moves a collection into a folder and refreshes both folder counts', async () => {
        storageUtils.loadSingleFolder.mockResolvedValueOnce({ uid: 'folder-2' });
        storageUtils.loadSingleCollection.mockResolvedValue({
            uid: 'collection-1',
            parentId: 'folder-1',
        });

        const result = await moveCollectionToFolder('collection-1', 'folder-2');

        expect(result).toBe(true);
        expect(storageUtils.saveSingleCollection).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: 'collection-1',
                parentId: 'folder-2',
            }),
            true,
        );
        expect(storageUtils.updateFolderCollectionCount).toHaveBeenCalledWith('folder-2');
        expect(storageUtils.updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
    });

    test('removes a collection from its folder back to root', async () => {
        storageUtils.loadSingleCollection.mockResolvedValue({
            uid: 'collection-1',
            parentId: 'folder-1',
        });

        const result = await removeCollectionFromFolder('collection-1');

        expect(result).toBe(true);
        expect(storageUtils.saveSingleCollection).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: 'collection-1',
                parentId: null,
            }),
            true,
        );
        expect(storageUtils.updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
    });

    test('loads only collections that belong to a specific folder', async () => {
        storageUtils.loadCollectionsIndex.mockResolvedValue({
            'collection-1': { parentId: 'folder-1' },
            'collection-2': { parentId: null },
        });
        storageUtils.loadAllCollections.mockResolvedValue([
            { uid: 'collection-1', parentId: 'folder-1' },
            { uid: 'collection-2', parentId: null },
        ]);

        const collections = await getFolderCollections('folder-1');

        expect(collections).toEqual([
            { uid: 'collection-1', parentId: 'folder-1' },
        ]);
    });

    test('toggles the collapsed flag without forcing timestamp updates', async () => {
        storageUtils.loadSingleFolder.mockResolvedValue({
            uid: 'folder-1',
            collapsed: false,
        });

        const collapsed = await toggleFolderCollapsed('folder-1');

        expect(collapsed).toBe(true);
        expect(storageUtils.saveSingleFolder).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: 'folder-1',
                collapsed: true,
            }),
            false,
            true,
        );
    });
});
