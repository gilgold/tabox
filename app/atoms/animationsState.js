import { atom } from 'recoil';

// New UID-based highlighting system
export const highlightedCollectionUidState = atom({
    key: 'highlightedCollectionUidState',
    default: null,
});

// New delete animation tracking system
export const deletingCollectionUidsState = atom({
    key: 'deletingCollectionUidsState',
    default: new Set(),
});

// Track when a tab is being dragged (for cross-collection drag and drop)
export const draggingTabState = atom({
    key: 'draggingTabState',
    default: null, // { tab, sourceCollection }
});

// Track when a group is being dragged (for cross-collection drag and drop)
export const draggingGroupState = atom({
    key: 'draggingGroupState',
    default: null, // { group, tabs, sourceCollection }
});