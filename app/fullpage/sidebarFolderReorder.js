import { arrayMove } from '@dnd-kit/sortable';

export const reorderSidebarFolders = (folders = [], activeId, overId) => {
    if (!Array.isArray(folders) || !activeId || !overId || activeId === overId) {
        return folders;
    }

    const activeIndex = folders.findIndex((folder) => folder.uid === activeId);
    const overIndex = folders.findIndex((folder) => folder.uid === overId);

    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
        return folders;
    }

    return arrayMove(folders, activeIndex, overIndex);
};
