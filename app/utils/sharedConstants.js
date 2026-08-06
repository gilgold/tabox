/**
 * Shared Constants for Tabox
 * These constants are used across both app and background scripts
 * to ensure consistency and avoid duplication.
 */

// Storage key constants
export const STORAGE_KEYS = {
    COLLECTIONS_INDEX: 'collections_index',
    FOLDERS_INDEX: 'folders_index',
    LEGACY_TABS_ARRAY: 'tabsArray',
    DELETED_COLLECTION_TOMBSTONES: 'deleted_collection_tombstones',
    DELETED_FOLDER_TOMBSTONES: 'deleted_folder_tombstones',
    COLLECTION_PREFIX: 'collection_',
    FOLDER_PREFIX: 'folder_',
    STORAGE_VERSION: 'tabox_storage_version'
};

export const CURRENT_STORAGE_VERSION = 3;

// Favicon shown when a tab has no favIconUrl or its favicon fails to load
export const FALLBACK_FAVICON = './images/favicon-fallback.png';

// A collection must have at least this many tabs to qualify for AI splitting.
export const SPLIT_MIN_TABS = 30;

// Simple UID generator (same logic throughout the app)
export const generateUid = () => {
    return (crypto && crypto.randomUUID) ? 
        crypto.randomUUID() : 
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
};
