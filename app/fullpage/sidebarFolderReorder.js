export const reorderSidebarFolders = (folders = [], activeId, overId) => {
    if (!Array.isArray(folders) || !activeId || !overId || activeId === overId) {
        return folders;
    }

    const activeIndex = folders.findIndex((folder) => folder.uid === activeId);
    const overIndex = folders.findIndex((folder) => folder.uid === overId);

    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
        return folders;
    }

    const reorderedFolders = [...folders];
    const [movedFolder] = reorderedFolders.splice(activeIndex, 1);
    reorderedFolders.splice(overIndex, 0, movedFolder);

    return reorderedFolders;
};
