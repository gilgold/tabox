export const FOLDER_COLLAPSE_STORAGE_KEYS = {
    popup: 'popupFolderCollapsedState',
    fullpage: 'fullpageFolderCollapsedState',
};

export const getFolderCollapseStorageKey = (viewContext = 'popup') => {
    return viewContext === 'fullpage'
        ? FOLDER_COLLAPSE_STORAGE_KEYS.fullpage
        : FOLDER_COLLAPSE_STORAGE_KEYS.popup;
};

export const resolveFolderCollapsed = ({
    folder,
    collapsedState = {},
    viewContext = 'popup',
}) => {
    if (!folder?.uid) {
        return false;
    }

    if (collapsedState[folder.uid] !== undefined) {
        return !!collapsedState[folder.uid];
    }

    return viewContext === 'fullpage'
        ? false
        : !!folder.collapsed;
};

export const applyFolderCollapsedState = ({
    folders = [],
    collapsedState = {},
    viewContext = 'popup',
}) => {
    return folders.map((folder) => ({
        ...folder,
        collapsed: resolveFolderCollapsed({
            folder,
            collapsedState,
            viewContext,
        }),
    }));
};
