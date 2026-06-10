import { atom } from 'jotai';

// New UID-based highlighting system
export const highlightedCollectionUidState = atom(null);

// Full-page reveal batches for newly-created/imported collections.
// Shape: {
//   runId: string,
//   items: [{ uid: string, parentId: string | null }]
// }
export const collectionRevealBatchState = atom(null);

// New delete animation tracking system
export const deletingCollectionUidsState = atom(new Set());

// Track tab/group drags across collection detail surfaces and collection cards.
// Shape: {
//   kind: 'tab' | 'group',
//   itemId: string,
//   sourceCollectionUid: string,
//   snapshot: object,
//   pointer: { x: number, y: number } | null,
//   overCollectionUid: string | null,
// }
export const dragSessionState = atom(null);

// Track when a collection is being dragged (for cross-context sidebar drops)
export const draggingCollectionState = atom(null); // { collection: TaboxCollection, overSidebarTarget: string|null } or null

// Track which context menu is currently open (only one at a time)
export const activeContextMenuState = atom(null); // menu ID string or null
