import { reorderSidebarFolders } from '../app/fullpage/sidebarFolderReorder';

describe('reorderSidebarFolders', () => {
    const folders = [
        { uid: 'folder-1', name: 'Folder One' },
        { uid: 'folder-2', name: 'Folder Two' },
        { uid: 'folder-3', name: 'Folder Three' },
    ];

    test('moves the dragged folder to the target position', () => {
        const reorderedFolders = reorderSidebarFolders(folders, 'folder-1', 'folder-3');

        expect(reorderedFolders.map((folder) => folder.uid)).toEqual([
            'folder-2',
            'folder-3',
            'folder-1',
        ]);
    });

    test('returns the original array for no-op moves', () => {
        const reorderedFolders = reorderSidebarFolders(folders, 'folder-2', 'folder-2');

        expect(reorderedFolders).toBe(folders);
    });
});
