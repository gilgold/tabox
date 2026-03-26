import { createFolder, updateFolderDetails } from '../app/utils/folderOperations';

jest.mock('../app/utils/storageUtils', () => ({
    saveSingleFolder: jest.fn(),
    loadSingleFolder: jest.fn(),
    loadAllFolders: jest.fn(),
    updateFoldersOrder: jest.fn(),
}));

const {
    saveSingleFolder,
    loadSingleFolder,
    loadAllFolders,
    updateFoldersOrder,
} = jest.requireMock('../app/utils/storageUtils');

describe('folderOperations.createFolder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.set.mockResolvedValue(undefined);
        browser.runtime.sendMessage.mockResolvedValue(undefined);
        loadAllFolders.mockResolvedValue([
            { uid: 'existing-folder', name: 'Existing Folder', order: 0 },
        ]);
        saveSingleFolder.mockResolvedValue(true);
        updateFoldersOrder.mockResolvedValue(true);
    });

    test('persists a newly-created folder at the top of the folder order', async () => {
        const folder = await createFolder('New Folder', 'blue', false);

        expect(loadAllFolders).toHaveBeenCalledWith({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc',
        });
        expect(saveSingleFolder).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'New Folder',
                order: 0,
            }),
            true,
        );
        expect(updateFoldersOrder).toHaveBeenCalledWith([
            expect.objectContaining({
                name: 'New Folder',
                order: 0,
            }),
            expect.objectContaining({
                uid: 'existing-folder',
                order: 0,
            }),
        ]);
        expect(folder).toEqual(
            expect.objectContaining({
                name: 'New Folder',
                order: 0,
            }),
        );
    });
});

describe('folderOperations.updateFolderDetails', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.set.mockResolvedValue(undefined);
        browser.runtime.sendMessage.mockResolvedValue(undefined);
        loadSingleFolder.mockResolvedValue({
            uid: 'folder-1',
            name: 'Original Name',
            color: '#4facfe',
            collapsed: false,
            createdOn: 123,
            lastUpdated: 456,
        });
        saveSingleFolder.mockResolvedValue(true);
    });

    test('persists folder detail edits with a single folder save', async () => {
        const result = await updateFolderDetails('folder-1', {
            name: 'Renamed Folder',
            color: '#ef4444',
        });

        expect(result).toBe(true);
        expect(loadSingleFolder).toHaveBeenCalledWith('folder-1');
        expect(saveSingleFolder).toHaveBeenCalledTimes(1);
        expect(saveSingleFolder).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: 'folder-1',
                name: 'Renamed Folder',
                color: '#ef4444',
            }),
            true,
        );
    });

    test('skips saving when no folder details changed', async () => {
        const result = await updateFolderDetails('folder-1', {
            name: 'Original Name',
            color: '#4facfe',
        });

        expect(result).toBe(true);
        expect(loadSingleFolder).toHaveBeenCalledWith('folder-1');
        expect(saveSingleFolder).not.toHaveBeenCalled();
    });
});
