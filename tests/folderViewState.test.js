import {
    applyFolderCollapsedState,
    getFolderCollapseStorageKey,
    resolveFolderCollapsed,
} from '../app/utils/folderViewState';

describe('folderViewState', () => {
    const folder = { uid: 'folder-1', name: 'Folder 1', collapsed: true };

    test('uses separate storage keys for popup and full-page folder state', () => {
        expect(getFolderCollapseStorageKey('popup')).toBe('popupFolderCollapsedState');
        expect(getFolderCollapseStorageKey('fullpage')).toBe('fullpageFolderCollapsedState');
    });

    test('keeps popup fallback aligned with the folder record when no popup preference exists', () => {
        expect(resolveFolderCollapsed({
            folder,
            collapsedState: {},
            viewContext: 'popup',
        })).toBe(true);
    });

    test('defaults full-page folders to expanded when no full-page preference exists', () => {
        expect(resolveFolderCollapsed({
            folder,
            collapsedState: {},
            viewContext: 'fullpage',
        })).toBe(false);
    });

    test('applies saved per-view collapsed preferences over the folder record', () => {
        expect(applyFolderCollapsedState({
            folders: [folder],
            collapsedState: { 'folder-1': false },
            viewContext: 'popup',
        })[0].collapsed).toBe(false);

        expect(applyFolderCollapsedState({
            folders: [folder],
            collapsedState: { 'folder-1': true },
            viewContext: 'fullpage',
        })[0].collapsed).toBe(true);
    });
});
