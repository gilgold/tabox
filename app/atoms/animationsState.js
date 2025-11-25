import { atom } from 'jotai';

// New UID-based highlighting system
export const highlightedCollectionUidState = atom(null);

// New delete animation tracking system
export const deletingCollectionUidsState = atom(new Set());

// Track when a tab is being dragged (for cross-collection drag and drop)
export const draggingTabState = atom(null); // { tab, sourceCollection }

// Track when a group is being dragged (for cross-collection drag and drop)
export const draggingGroupState = atom(null); // { group, tabs, sourceCollection }