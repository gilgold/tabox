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