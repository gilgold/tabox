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
    COLLECTION_PREFIX: 'collection_',
    FOLDER_PREFIX: 'folder_',
    STORAGE_VERSION: 'tabox_storage_version'
};

export const CURRENT_STORAGE_VERSION = 3;

// Simple UID generator (same logic throughout the app)
export const generateUid = () => {
    return (crypto && crypto.randomUUID) ? 
        crypto.randomUUID() : 
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
};

