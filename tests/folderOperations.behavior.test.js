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
        storageUtils.saveSingleCollection.mockResolvedValue(true);
        storageUtils.saveSingleFolder.mockResolvedValue(true);
        storageUtils.updateFolderCollectionCount.mockResolvedValue(true);
        storageUtils.loadAllFolders.mockResolvedValue([]);
        storageUtils.loadAllCollections.mockResolvedValue([]);
        storageUtils.loadCollectionsIndex.mockResolvedValue({});
        sharedSync.triggerBackgroundSync.mockResolvedValue(true);
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
        expect(storageUtils.saveSingleCollection).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: 'collection-1',
                parentId: null,
            }),
            true,
        );
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
        expect(storageUtils.deleteSingleCollection).toHaveBeenCalledWith('collection-1');
        expect(storageUtils.deleteSingleCollection).toHaveBeenCalledWith('collection-2');
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
