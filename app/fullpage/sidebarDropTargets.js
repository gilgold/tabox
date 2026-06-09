// Hit-tests the sidebar folder rows (and the root-level item) at a viewport
// point. Used while dragging a collection card so the sidebar can act as a
// cross-context drop target without belonging to the content DndContext.
export const findSidebarDropTarget = (x, y) => {
    const folderItems = document.querySelectorAll('[data-sidebar-folder-uid]');
    for (const item of folderItems) {
        const rect = item.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return item.getAttribute('data-sidebar-folder-uid');
        }
    }
    const noFolderItem = document.querySelector('[data-sidebar-no-folder]');
    if (noFolderItem) {
        const rect = noFolderItem.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return 'no-folder';
        }
    }
    return null;
};
