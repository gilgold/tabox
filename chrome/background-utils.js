/* eslint-disable no-unused-vars */

// Storage utilities for background script - NEW INDEXED STORAGE HELPERS

// Storage key constants - SYNCHRONIZED WITH app/utils/sharedConstants.js
// Note: Cannot directly import due to webpack configuration, but kept in sync
const STORAGE_KEYS = {
    COLLECTIONS_INDEX: 'collections_index',
    FOLDERS_INDEX: 'folders_index',
    LEGACY_TABS_ARRAY: 'tabsArray',
    DELETED_COLLECTION_TOMBSTONES: 'deleted_collection_tombstones',
    DELETED_FOLDER_TOMBSTONES: 'deleted_folder_tombstones',
    COLLECTION_PREFIX: 'collection_',
    FOLDER_PREFIX: 'folder_',
    STORAGE_VERSION: 'tabox_storage_version'
};

// Deferred-loading URL helpers.
// SYNCHRONIZED WITH app/utils/urlUtils.js (unwrapDeferredUrl / isDeferredLoadingUrl).
// The service worker loads its scripts via importScripts and cannot import the app ES
// module, so this is an intentional duplicate. Keep both copies in sync.
const DEFERRED_PAGE_MARKER = 'deferedLoading.html';

const isDeferredLoadingUrl = (url) =>
    typeof url === 'string' && url.indexOf(DEFERRED_PAGE_MARKER) > -1;

const unwrapDeferredUrl = (url) => {
    if (!isDeferredLoadingUrl(url)) {
        return url;
    }

    try {
        const parsed = new URL(url);

        // Current format: payload lives in the hash fragment.
        if (parsed.hash && parsed.hash.length > 1) {
            const decoded = JSON.parse(decodeURIComponent(parsed.hash.slice(1)));
            if (decoded && typeof decoded.url === 'string' && decoded.url) {
                return decoded.url;
            }
        }

        // Legacy format: payload lives in the query string.
        const queryUrl = parsed.searchParams.get('url');
        if (queryUrl) {
            return queryUrl;
        }
    } catch (error) {
        // Malformed wrapper - fall through and return the original string.
    }

    return url;
};

const syncTransportApi = typeof require === 'function'
    ? require('./sync-transport.js')
    : globalThis.TaboxSyncTransport;
const syncMergeApi = typeof require === 'function'
    ? require('./sync-merge.js')
    : globalThis.TaboxSyncMerge;
const syncApplyApi = typeof require === 'function'
    ? require('./sync-apply.js')
    : globalThis.TaboxSyncApply;

const {
    SERVER_FILE_TIMESTAMP_STATE,
    fetchServerFileTimestampState,
    getServerFileTimestampOrFalse
} = syncTransportApi;
const {
    normalizeSyncSnapshot,
    mergeSyncSnapshots
} = syncMergeApi;
const {
    applySyncSnapshotAtomically
} = syncApplyApi;

const normalizeCollectionRecordBG = (collection = {}) => ({
    ...collection,
});

/**
 * Background-compatible functions for new indexed storage
 */

// Load collections index in background script
const loadCollectionsIndexBG = async () => {
    try {
        const { [STORAGE_KEYS.COLLECTIONS_INDEX]: index } = await browser.storage.local.get(STORAGE_KEYS.COLLECTIONS_INDEX);
        return index || {};
    } catch (error) {
        console.error('Background: Failed to load collections index:', error);
        return {};
    }
};

const loadDeletedCollectionTombstonesBG = async () => {
    try {
        const { [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: tombstones } = await browser.storage.local.get(STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES);
        return tombstones || {};
    } catch (error) {
        console.error('Background: Failed to load deleted collection tombstones:', error);
        return {};
    }
};

const loadDeletedFolderTombstonesBG = async () => {
    try {
        const { [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: tombstones } = await browser.storage.local.get(STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES);
        return tombstones || {};
    } catch (error) {
        console.error('Background: Failed to load deleted folder tombstones:', error);
        return {};
    }
};

// Load single collection in background script  
const loadSingleCollectionBG = async (uid) => {
    try {
        const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
        const { [key]: collection } = await browser.storage.local.get(key);
        
        if (!collection) {
            console.warn(`Background: Collection ${uid} not found in storage`);
            return null;
        }
        
        return normalizeCollectionRecordBG(collection);
    } catch (error) {
        console.error(`Background: Failed to load collection ${uid}:`, error);
        return null;
    }
};

// Save single collection in background script
const saveSingleCollectionBG = async (collection, forceUpdateTimestamp = false) => {
    try {
        if (!collection.uid) {
            throw new Error('Collection must have a UID');
        }

        const normalizedIncomingCollection = normalizeCollectionRecordBG(collection);
        const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${normalizedIncomingCollection.uid}`;
        const now = Date.now();
        
        // Load existing collection to preserve critical local data like parentId
        let existingCollection = null;
        try {
            const { [collectionKey]: existing } = await browser.storage.local.get(collectionKey);
            existingCollection = normalizeCollectionRecordBG(existing);
        } catch (error) {
            // Collection doesn't exist yet, that's fine
        }
        
        // Only update lastUpdated if explicitly requested or if it's missing
        const lastUpdated = forceUpdateTimestamp
            ? now
            : (normalizedIncomingCollection.lastUpdated !== null && normalizedIncomingCollection.lastUpdated !== undefined
                ? normalizedIncomingCollection.lastUpdated
                : now);
        
        // Preserve existing parentId if incoming collection doesn't have one (from cloud sync)
        const preservedParentId = normalizedIncomingCollection.parentId !== undefined ? normalizedIncomingCollection.parentId : 
                                  (existingCollection?.parentId !== undefined ? existingCollection.parentId : null);
        const tabsToSave = normalizedIncomingCollection.tabs !== undefined
            ? normalizedIncomingCollection.tabs
            : (existingCollection?.tabs || []);
        const groupsToSave = normalizedIncomingCollection.chromeGroups !== undefined
            ? normalizedIncomingCollection.chromeGroups
            : (existingCollection?.chromeGroups || []);

        const index = await loadCollectionsIndexBG();
        const existingOrder = index[normalizedIncomingCollection.uid]?.order;
        const collectionOrder = normalizedIncomingCollection.order !== undefined ? normalizedIncomingCollection.order : existingOrder;
        const collectionToSave = normalizeCollectionRecordBG({
            ...(existingCollection || {}),
            ...normalizedIncomingCollection,
            tabs: tabsToSave,
            chromeGroups: groupsToSave,
            parentId: preservedParentId,
            order: collectionOrder,
        });

        // Save collection data
        await browser.storage.local.set({
            [collectionKey]: {
                uid: collectionToSave.uid,
                name: collectionToSave.name,
                tabs: collectionToSave.tabs || [],
                color: collectionToSave.color,
                createdOn: collectionToSave.createdOn || now,
                lastUpdated: lastUpdated,
                lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
                chromeGroups: collectionToSave.chromeGroups || [],
                // Preserve parentId from existing collection if incoming doesn't have it
                parentId: preservedParentId,
                // Store any other collection properties
                ...collectionToSave
            }
        });
        
        // Update index
        const collectionSize = JSON.stringify(collectionToSave).length;
        
        index[collectionToSave.uid] = {
            name: collectionToSave.name,
            type: 'collection',
            tabCount: collectionToSave.tabs ? collectionToSave.tabs.length : 0,
            lastUpdated: lastUpdated,
            lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
            createdOn: collectionToSave.createdOn || now,
            color: collectionToSave.color || 'default',
            size: collectionSize,
            parentId: preservedParentId,
            order: collectionOrder // Include order in index for proper sorting
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index
        });
        
        return true;
        
    } catch (error) {
        console.error('Background: Failed to save collection:', error);
        return false;
    }
};

// Mark a collection as recently opened. This is the authoritative place to record
// `lastOpened`: doing it in the background (instead of the popup/fullpage UI) means
// the write survives the popup being torn down when a new window steals focus, and
// it lands before the tab-load auto-update can rebuild the collection. Opening is not
// a content edit, so `lastUpdated` is intentionally preserved (no forced timestamp).
const markCollectionOpenedBG = async (uid, timestamp = Date.now()) => {
    if (!uid) {
        return false;
    }

    try {
        const existing = await loadSingleCollectionBG(uid);
        if (!existing) {
            return false;
        }

        return await saveSingleCollectionBG({ ...existing, lastOpened: timestamp }, false);
    } catch (error) {
        console.error(`Background: Failed to mark collection ${uid} as opened:`, error);
        return false;
    }
};

// Load all collections with backward compatibility for background script
const loadAllCollectionsBG = async (useNewStorageFirst = true) => {
    try {
        if (useNewStorageFirst) {
            // Try new storage first
            const index = await loadCollectionsIndexBG();
            
            if (Object.keys(index).length > 0) {
                // Load all collections using new system  
                const uids = Object.keys(index);
                const keys = uids.map(uid => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
                const results = await browser.storage.local.get(keys);
                
                const collections = [];
                uids.forEach(uid => {
                    const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
                    if (results[key]) {
                        const collection = normalizeCollectionRecordBG(results[key]);
                        // Include order from index if not in collection data
                        if (collection.order === undefined && index[uid].order !== undefined) {
                            collection.order = index[uid].order;
                        }
                        collections.push(collection);
                    }
                });
                
                // Only log if debug mode is explicitly enabled
                return collections;
            }
        }
        
        // Fallback to legacy storage
        const { [STORAGE_KEYS.LEGACY_TABS_ARRAY]: tabsArray } = await browser.storage.local.get(STORAGE_KEYS.LEGACY_TABS_ARRAY);
        return (tabsArray || []).map((collection) => normalizeCollectionRecordBG(collection));
        
    } catch (error) {
        console.error('Background: Failed to load collections:', error);
        return [];
    }
};

// Throttled tabsArray mirror sync (prevent excessive updates)
// Keep the local tabsArray mirror available for same-version repair and backup/export flows.
let legacySyncTimeout = null;
let legacySyncEnabled = true;
const syncLegacyStorageThrottled = async () => {
    if (!legacySyncEnabled) return; // Skip if lazy sync is disabled
    if (legacySyncTimeout) return; // Already scheduled
    
    legacySyncTimeout = setTimeout(async () => {
        try {
            const collections = await loadAllCollectionsBG(true);
            await browser.storage.local.set({ 
                [STORAGE_KEYS.LEGACY_TABS_ARRAY]: collections,
                localTimestamp: Date.now() 
            });
        } catch (error) {
            console.error('Background: Failed to sync legacy storage:', error);
        } finally {
            legacySyncTimeout = null;
        }
    }, 5000); // Sync legacy storage at most once every 5 seconds
};

// Enable tabsArray mirror sync (for repair or backup/export operations)
const enableLegacyStorageSync = () => {
    legacySyncEnabled = true;
};

// Disable tabsArray mirror sync when batching larger write operations
const disableLegacyStorageSync = () => {
    legacySyncEnabled = false;
};

// Force immediate tabsArray mirror sync (for backup/export operations)
const forceLegacyStorageSync = async () => {
    try {
        const collections = await loadAllCollectionsBG(true);
        await browser.storage.local.set({ 
            [STORAGE_KEYS.LEGACY_TABS_ARRAY]: collections,
            localTimestamp: Date.now() 
        });
        return true;
    } catch (error) {
        console.error('Background: Failed to force sync legacy storage:', error);
        return false;
    }
};

// Helper function to batch write collections with chunking
const batchWriteCollections = async (updates, chunkSize = 50) => {
    const keys = Object.keys(updates);
    const totalChunks = Math.ceil(keys.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
        const chunkKeys = keys.slice(i * chunkSize, (i + 1) * chunkSize);
        const chunkUpdates = {};
        
        chunkKeys.forEach(key => {
            chunkUpdates[key] = updates[key];
        });
        
        try {
            await browser.storage.local.set(chunkUpdates);
            
            // Small delay between chunks to avoid quota issues
            if (i < totalChunks - 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch (error) {
            if (error.message && error.message.includes('QUOTA_EXCEEDED')) {
                console.error(`Quota exceeded at chunk ${i + 1}/${totalChunks}, reducing chunk size`);
                // Retry with smaller chunks
                const smallerChunkSize = Math.floor(chunkSize / 2);
                if (smallerChunkSize > 0) {
                    return await batchWriteCollections(updates, smallerChunkSize);
                }
            }
            throw error;
        }
    }
    
    return true;
};

// Update entire collections array with backward compatibility (OPTIMIZED with batching)
const updateAllCollectionsBG = async (collections) => {
    try {
        // Try to use new indexed storage first
        const index = await loadCollectionsIndexBG();
        const hasIndexedStorage = Object.keys(index).length > 0 || collections.length > 0;
        
        if (hasIndexedStorage) {
            // OPTIMIZATION: Batch all updates into a single write operation
            const now = Date.now();
            const updates = {};
            const newIndex = { ...index };
            
            // Prepare all updates
            for (const rawCollection of collections) {
                const collection = normalizeCollectionRecordBG(rawCollection);
                if (!collection.uid) {
                    console.error('Collection missing UID, skipping:', collection.name);
                    continue;
                }
                
                const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
                const lastUpdated = collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : now;
                
                // Preserve existing order if not provided in the collection data
                const existingOrder = newIndex[collection.uid]?.order;
                const collectionOrder = collection.order !== undefined ? collection.order : existingOrder;
                
                // Prepare collection data (include order)
                    updates[collectionKey] = {
                        uid: collection.uid,
                        name: collection.name,
                        tabs: collection.tabs || [],
                    color: collection.color,
                        createdOn: collection.createdOn || now,
                        lastUpdated: lastUpdated,
                        lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null,
                        chromeGroups: collection.chromeGroups || [],
                        parentId: collection.parentId !== undefined ? collection.parentId : null,
                        ...collection,
                        order: collectionOrder // Ensure order is preserved in collection data
                };
                
                // Update index entry
                const collectionSize = JSON.stringify(updates[collectionKey]).length;
                
                newIndex[collection.uid] = {
                    name: collection.name,
                    type: 'collection',
                    tabCount: collection.tabs ? collection.tabs.length : 0,
                    lastUpdated: lastUpdated,
                    lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null,
                    createdOn: collection.createdOn || now,
                    color: collection.color || 'default',
                    size: collectionSize,
                    parentId: collection.parentId !== undefined ? collection.parentId : null,
                    order: collectionOrder // Include order in index for proper sorting
                };
            }
            
            // OPTIMIZATION: Single batched write with chunking for Chrome limits
            await batchWriteCollections(updates, 50);
            
            // Update index in a single write
            await browser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: newIndex
            });
            
            
            // Schedule throttled legacy storage sync (non-blocking)
            syncLegacyStorageThrottled();
            return true;
        }
        
        // Fallback to legacy storage
        await browser.storage.local.set({ 
            [STORAGE_KEYS.LEGACY_TABS_ARRAY]: collections,
            localTimestamp: Date.now() 
        });
        return true;
        
    } catch (error) {
        console.error('Background: Failed to update collections:', error);
        return false;
    }
};

// ========================================
// FOLDER BACKGROUND FUNCTIONS
// ========================================

// Load folders index in background script
const loadFoldersIndexBG = async () => {
    try {
        const { [STORAGE_KEYS.FOLDERS_INDEX]: index } = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
        console.log('📁 loadFoldersIndexBG: Index loaded with', Object.keys(index || {}).length, 'entries');
        return index || {};
    } catch (error) {
        console.error('Background: Failed to load folders index:', error);
        return {};
    }
};

// Load single folder in background script
const loadSingleFolderBG = async (uid) => {
    try {
        const key = `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`;
        const { [key]: folder } = await browser.storage.local.get(key);
        
        if (!folder) {
            console.warn(`Background: Folder ${uid} not found in storage`);
            return null;
        }
        
        return folder;
    } catch (error) {
        console.error(`Background: Failed to load folder ${uid}:`, error);
        return null;
    }
};

// Save single folder in background script
const saveSingleFolderBG = async (folder, forceUpdateTimestamp = false) => {
    try {
        if (!folder.uid) {
            throw new Error('Folder must have a UID');
        }
        
        console.log('📁 saveSingleFolderBG: Saving folder', folder.uid, folder.name);
        
        const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${folder.uid}`;
        const now = Date.now();
        
        // Only update lastUpdated if explicitly requested or if it's missing
        const lastUpdated = forceUpdateTimestamp ? now : (folder.lastUpdated !== null && folder.lastUpdated !== undefined ? folder.lastUpdated : now);
        
        // Calculate collection count from collections index
        const collectionsIndex = await loadCollectionsIndexBG();
        const collectionCount = Object.values(collectionsIndex).filter(c => c.parentId === folder.uid).length;
        
        // Save folder data
        await browser.storage.local.set({
            [folderKey]: {
                uid: folder.uid,
                name: folder.name,
                type: 'folder',
                color: folder.color,
                collapsed: folder.collapsed !== undefined ? folder.collapsed : false,
                createdOn: folder.createdOn || now,
                lastUpdated: lastUpdated,
                collectionCount: collectionCount,
                // Store any other folder properties
                ...folder
            }
        });
        
        // Update folders index
        const foldersIndex = await loadFoldersIndexBG();
        const folderSize = JSON.stringify(folder).length;
        
        // Preserve existing order if not provided in the folder data
        const existingOrder = foldersIndex[folder.uid]?.order;
        const folderOrder = folder.order !== undefined ? folder.order : existingOrder;
        
        foldersIndex[folder.uid] = {
            name: folder.name,
            type: 'folder',
            color: folder.color || 'var(--folder-default-color)',
            collapsed: folder.collapsed !== undefined ? folder.collapsed : false,
            collectionCount: collectionCount,
            lastUpdated: lastUpdated,
            createdOn: folder.createdOn || now,
            size: folderSize,
            order: folderOrder // Include order in index for proper sorting
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
        });
        
        return true;
        
    } catch (error) {
        console.error('Background: Failed to save folder:', error);
        return false;
    }
};

// Load all folders in background script
const loadAllFoldersBG = async () => {
    try {
        const index = await loadFoldersIndexBG();
        
        console.log('📁 loadAllFoldersBG: Folders index has', Object.keys(index).length, 'entries');
        
        if (Object.keys(index).length === 0) {
            return [];
        }
        
        // Load all folders using index
        const uids = Object.keys(index);
        const keys = uids.map(uid => `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`);
        const results = await browser.storage.local.get(keys);
        
        const folders = [];
        uids.forEach(uid => {
            const key = `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`;
            if (results[key]) {
                // Include order from index if not in folder data
                const folder = results[key];
                if (folder.order === undefined && index[uid].order !== undefined) {
                    folder.order = index[uid].order;
                }
                folders.push(folder);
            }
        });
        
        // Sort by order before returning
        folders.sort((a, b) => {
            const aOrder = a.order !== undefined ? a.order : 999999;
            const bOrder = b.order !== undefined ? b.order : 999999;
            return aOrder - bOrder;
        });
        
        console.log('📁 loadAllFoldersBG: Loaded', folders.length, 'folders (sorted by order)');
        
        return folders;
        
    } catch (error) {
        console.error('Background: Failed to load folders:', error);
        return [];
    }
};

// Update all folders from sync data
const updateAllFoldersBG = async (folders) => {
    try {
        logSyncOperation('info', 'updateAllFoldersBG starting', { folderCount: folders?.length || 0 });
        
        if (!folders || folders.length === 0) {
            logSyncOperation('info', 'updateAllFoldersBG: No folders to update');
            return true;
        }
        
        // IMPORTANT: Save folders SEQUENTIALLY to avoid race condition on folders index
        // Each saveSingleFolderBG loads, updates, and saves the index
        // Running in parallel would cause overwrites
        let successCount = 0;
        for (const folder of folders) {
            const success = await saveSingleFolderBG(folder);
            if (success) successCount++;
        }
        
        logSyncOperation('info', 'updateAllFoldersBG completed', { 
            successCount, 
            totalCount: folders.length,
            allSuccess: successCount === folders.length 
        });
        
        return successCount === folders.length;
        
    } catch (error) {
        logSyncOperation('error', 'updateAllFoldersBG failed', { error: error.message });
        return false;
    }
};

// Delete a single collection in background script
const deleteSingleCollectionBG = async (uid) => {
    try {
        if (!uid) {
            console.error('Background: Cannot delete collection - no UID provided');
            return false;
        }

        const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
        await browser.storage.local.remove(collectionKey);

        const index = await loadCollectionsIndexBG();
        if (index[uid]) {
            delete index[uid];
            await browser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: index
            });
        }

        return true;
    } catch (error) {
        console.error(`Background: Failed to delete collection ${uid}:`, error);
        return false;
    }
};

// Delete a single folder in background script
const deleteSingleFolderBG = async (uid) => {
    try {
        if (!uid) {
            console.error('Background: Cannot delete folder - no UID provided');
            return false;
        }
        
        logSyncOperation('info', 'deleteSingleFolderBG: Deleting folder', { uid });
        
        const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`;
        
        // Remove folder data
        await browser.storage.local.remove(folderKey);
        
        // Update folders index
        const foldersIndex = await loadFoldersIndexBG();
        if (foldersIndex[uid]) {
            delete foldersIndex[uid];
            await browser.storage.local.set({
                [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
            });
        }
        
        logSyncOperation('info', 'deleteSingleFolderBG: Folder deleted successfully', { uid });
        return true;
        
    } catch (error) {
        logSyncOperation('error', 'deleteSingleFolderBG failed', { uid, error: error.message });
        return false;
    }
};

let lastValidated = 0;
let syncLock = false; // Prevent concurrent sync operations
let syncLockOperation = null; // Track what operation holds the lock
let syncLockTime = 0; // Track when lock was acquired
let syncQueue = []; // Queue pending sync operations

// Enhanced error handling with retry logic (OPTIMIZED: reduced retries from 5 to 3)
async function handleRequest(url, options = null, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                const data = await response.json();
                if (attempt > 0) {
                    logSyncOperation('success', `Request successful after ${attempt + 1} attempts: ${url}`);
                }
                return data;
            } else {
                lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                logSyncOperation('error', `Request failed: ${url}`, { 
                    status: response.status, 
                    attempt: attempt + 1,
                    maxRetries: maxRetries + 1 
                });
            }
        } catch (error) {
            lastError = error;
            logSyncOperation('error', `Network error: ${url}`, { 
                error: error.message, 
                attempt: attempt + 1,
                maxRetries: maxRetries + 1 
            });
        }
        
        // Wait before retry (exponential backoff, capped at 4 seconds)
        if (attempt < maxRetries) {
            const backoffDelay = Math.min(delay * Math.pow(2, attempt), 4000);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
    }
    
    // All retries failed
    logSyncOperation('error', `All retries failed for: ${url}`, { error: lastError?.message });
    return false;
}

// Enhanced logging for debugging sync issues
function logSyncOperation(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    
    // Format data for better console readability - convert objects to readable strings
    const formatDataForLog = (obj) => {
        if (!obj || Object.keys(obj).length === 0) return '';
        try {
            const parts = [];
            for (const [key, value] of Object.entries(obj)) {
                if (value !== undefined && value !== null) {
                    parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
                }
            }
            return parts.length > 0 ? ` | ${parts.join(', ')}` : '';
        } catch (e) {
            return ` | ${JSON.stringify(obj)}`;
        }
    };
    
    const logEntry = {
        timestamp,
        level,
        message,
        data,
        stackTrace: level === 'error' ? new Error().stack : undefined
    };
    
    // Only log errors and critical info, skip routine success messages
    if (level === 'error' || (level === 'info' && message.includes('Acquired') === false && message.includes('Released') === false && message.includes('Created pre-sync backup') === false)) {
        const formattedData = formatDataForLog(data);
        console[level === 'error' ? 'error' : 'log'](`[SYNC ${level.toUpperCase()}] ${message}${formattedData}`);
    }
    
    // Store recent logs for debugging
    browser.storage.local.get('syncLogs').then(({ syncLogs = [] }) => {
        syncLogs.unshift(logEntry);
        // Keep only last 20 log entries (reduced from 50 for memory optimization)
        if (syncLogs.length > 20) {
            syncLogs = syncLogs.slice(0, 20);
        }
        browser.storage.local.set({ syncLogs });
    });
}

// Validate collection data structure (optimized to avoid unnecessary JSON.stringify)
function validateCollectionData(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Data is not an object' };
    }
    
    if (!Array.isArray(data.tabsArray)) {
        return { valid: false, error: 'tabsArray is not an array' };
    }
    
    if (typeof data.timestamp !== 'number') {
        return { valid: false, error: 'timestamp is not a number' };
    }
    
    // Validate each collection (lightweight validation, no JSON.stringify)
    for (let i = 0; i < data.tabsArray.length; i++) {
        const collection = data.tabsArray[i];
        if (!collection.uid || !collection.name || !Array.isArray(collection.tabs)) {
            return { 
                valid: false, 
                error: `Collection at index ${i} is missing required fields (uid, name, tabs)` 
            };
        }
    }
    
    // Validate folders if present (optional, since older versions don't have folders)
    if (data.foldersArray !== undefined) {
        if (!Array.isArray(data.foldersArray)) {
            return { valid: false, error: 'foldersArray exists but is not an array' };
        }
        
        // Validate each folder (lightweight validation)
        for (let i = 0; i < data.foldersArray.length; i++) {
            const folder = data.foldersArray[i];
            if (!folder.uid || !folder.name) {
                return { 
                    valid: false, 
                    error: `Folder at index ${i} is missing required fields (uid, name)` 
                };
            }
        }
    }
    
    return { valid: true };
}

// Create backup before risky operations with storage optimization
async function createPreSyncBackup(label = 'pre-sync') {
    try {
        // 🚀 NEW: Load from indexed storage
        const tabsArray = await loadAllCollectionsBG(true);
        const { localTimestamp } = await browser.storage.local.get('localTimestamp');
        
        let { preSyncBackups = [] } = await browser.storage.local.get('preSyncBackups');
        
        // Create optimized backup data
        const backup = {
            timestamp: Date.now(),
            localTimestamp: localTimestamp || 0,
            collectionCount: tabsArray?.length || 0,
            label,
            // Only store essential data to reduce size
            tabsArray: (tabsArray || []).map(collection => ({
                uid: collection.uid,
                name: collection.name,
                createdOn: collection.createdOn,
                lastUpdated: collection.lastUpdated,
                color: collection.color,
                tabCount: collection.tabs?.length || 0,
                // Only store first 3 tabs for debugging (not full data)
                sampleTabs: collection.tabs?.slice(0, 3)?.map(tab => ({
                    title: tab.title,
                    url: tab.url
                })) || []
            }))
        };
        
        // Calculate backup size
        const backupSize = JSON.stringify(backup).length;
        
        preSyncBackups.unshift(backup);
        
        // Aggressive storage limits: Keep max 2 backups and enforce size limits for memory optimization
        const MAX_BACKUPS = 2; // Reduced from 3 for memory optimization
        const MAX_TOTAL_SIZE = 2 * 1024 * 1024; // 2MB total limit
        
        // Remove excess backups
        if (preSyncBackups.length > MAX_BACKUPS) {
            preSyncBackups = preSyncBackups.slice(0, MAX_BACKUPS);
        }
        
        // Check total size and remove oldest if needed
        let totalSize = preSyncBackups.reduce((sum, backup) => sum + JSON.stringify(backup).length, 0);
        while (totalSize > MAX_TOTAL_SIZE && preSyncBackups.length > 1) {
            preSyncBackups.pop(); // Remove oldest
            totalSize = preSyncBackups.reduce((sum, backup) => sum + JSON.stringify(backup).length, 0);
        }
        
        await browser.storage.local.set({ preSyncBackups });
        
        
        return true;
    } catch (error) {
        logSyncOperation('error', 'Failed to create pre-sync backup', { error: error.message });
        return false;
    }
}

// Acquire sync lock to prevent concurrent operations
// Returns: true if lock acquired, false if timeout, 'busy' if should skip (lock held by same-type operation)
async function acquireSyncLock(operation = 'unknown', timeout = 15000) {
    const startTime = Date.now();
    
    // If lock is already held, check if we should wait or skip
    if (syncLock) {
        // If the same type of operation is already running, skip instead of waiting
        if (syncLockOperation === operation) {
            logSyncOperation('info', `Skipping duplicate ${operation} - already in progress`);
            return 'busy';
        }
        
        // Log what we're waiting for
        logSyncOperation('info', `Waiting for lock: ${operation} (held by: ${syncLockOperation})`);
    }
    
    while (syncLock) {
        if (Date.now() - startTime > timeout) {
            const lockDuration = Date.now() - syncLockTime;
            logSyncOperation('error', `Sync lock timeout for operation: ${operation}`, {
                heldBy: syncLockOperation,
                lockDuration: lockDuration
            });
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    syncLock = true;
    syncLockOperation = operation;
    syncLockTime = Date.now();
    logSyncOperation('info', `Acquired sync lock for: ${operation}`);
    return true;
}

// Release sync lock
function releaseSyncLock(operation = 'unknown') {
    const lockDuration = Date.now() - syncLockTime;
    syncLock = false;
    syncLockOperation = null;
    syncLockTime = 0;
    logSyncOperation('info', `Released sync lock for: ${operation}`, { duration: lockDuration });
}

// Update collection UIDs to ensure uniqueness
function updateCollectionsUids(collections) {
    if (!collections || !Array.isArray(collections)) { 
        console.warn('updateCollectionsUids: Invalid collections input, returning empty array');
        return []; 
    }
    let tabsArray = collections;
    tabsArray.forEach((collection, index) => {
        if (collection.uid && collection.uid.includes('uid')) {
            const newUid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            tabsArray[index].uid = newUid;
        }
    });
    return tabsArray;
}

const createCollectionContextMenu = (collection) => {
    browser.contextMenus.create({
        title: collection.name,
        contexts: ['all'],
        parentId: 'tabox-super',
        id: collection.chromeGroups?.length > 0 ? `${collection.uid}-main` : collection.uid,
    });
    if (collection.chromeGroups && collection.chromeGroups.length > 0) {
        browser.contextMenus.create({
            title: 'Add tab to this collection',
            contexts: ['all'],
            parentId: `${collection.uid}-main`,
            id: collection.uid,
        });
        browser.contextMenus.create({
            parentId: `${collection.uid}-main`,
            id: `${collection.uid}-seperator`,
            type: 'separator'
        });
        browser.contextMenus.create({
            title: 'Add tab to a group inside this collection',
            contexts: ['all'],
            enabled: false,
            parentId: `${collection.uid}-main`,
            id: `${collection.uid}-title`,
        });
        collection.chromeGroups.forEach(cg => {
            browser.contextMenus.create({
                title: cg.title || '-',
                contexts: ['all'],
                parentId: `${collection.uid}-main`,
                id: `${Math.random().toString(36).slice(2)}|${cg.uid}`,
            });
        })
    }
}

// Context menu throttling - update at most once every 5 seconds
let contextMenuTimeout = null;
let pendingContextMenuUpdate = false;

const handleContextMenuCreation = async () => {
    pendingContextMenuUpdate = true;
    
    if (contextMenuTimeout) {
        return; // Already scheduled
    }
    
    contextMenuTimeout = setTimeout(async () => {
        if (pendingContextMenuUpdate) {
            await browser.contextMenus.removeAll();
            // 🚀 NEW: Load from indexed storage
            const tabsArray = await loadAllCollectionsBG(true);
            if (tabsArray && tabsArray.length > 0) {
                setTimeout(() => {
                    browser.contextMenus.create({
                        title: 'Add tab to Tabox Collection',
                        contexts: ['all'],
                        id: 'tabox-super'
                    });
                    tabsArray.forEach(collection => createCollectionContextMenu(collection));
                }, 500);
            }
            pendingContextMenuUpdate = false;
        }
        contextMenuTimeout = null;
    }, 5000); // 5 seconds throttle
}

function applyChromeGroupSettings(windowId, collection) {
    if (!collection.chromeGroups || !browser.tabs.group || !browser.tabGroups) {
        return;
    }
    collection.chromeGroups.forEach((chromeGroup) => {
        const tabsToGroup = collection.tabs.filter(({ groupId }) => chromeGroup.id === groupId).map((t) => t.newTabId);
        const groupProperties = {
            createProperties: {
                windowId: windowId
            },
            tabIds: tabsToGroup
        }
        const updateProperties = {
            collapsed: chromeGroup.collapsed,
            color: chromeGroup.color,
            title: chromeGroup.title
        };
        if (tabsToGroup && tabsToGroup.length > 0) {
            browser.tabs.group(groupProperties).then((groupId) => {
                browser.tabGroups.update(groupId, updateProperties)
            });
        }
    });
}

// ─── Smart Organize: apply + undo ────────────────────────────────────────────

const SMART_ORGANIZE_UNDO_KEY = 'smartOrganizeUndo';

// Apply a Smart Organize plan to a live window. Snapshots the window's current
// tab order + the set of tabs being grouped BEFORE mutating, so undo can fully
// restore. Tabs that no longer exist are skipped by Chrome.
async function applySmartOrganizePlan({ windowId, plan, createdAt }) {
    const beforeTabs = await browser.tabs.query({ windowId });
    const orderedTabIds = beforeTabs.map((t) => t.id);
    const affectedTabIds = [
        ...plan.newGroups.flatMap((g) => g.tabIds),
        ...plan.additions.flatMap((a) => a.tabIds),
    ];

    await browser.storage.local.set({
        [SMART_ORGANIZE_UNDO_KEY]: {
            windowId,
            createdAt: createdAt || Date.now(),
            orderedTabIds,
            affectedTabIds,
            summary: { groupsCreated: plan.newGroups.length, tabsAdded: affectedTabIds.length },
        },
    });

    let groupsCreated = 0;
    let tabsAdded = 0;

    for (const add of plan.additions) {
        if (!add.tabIds.length) continue;
        try {
            await browser.tabs.group({ groupId: add.groupId, tabIds: add.tabIds });
            tabsAdded += add.tabIds.length;
        } catch (e) {
            console.error('Smart Organize: addition failed for group', add.groupId, e);
        }
    }

    for (const g of plan.newGroups) {
        if (!g.tabIds.length) continue;
        try {
            const groupId = await browser.tabs.group({ createProperties: { windowId }, tabIds: g.tabIds });
            await browser.tabGroups.update(groupId, { title: g.name, color: g.color });
            groupsCreated += 1;
        } catch (e) {
            console.error('Smart Organize: new group failed', g.name, e);
        }
    }

    return { success: true, groupsCreated, tabsAdded, skipped: plan.skippedTabIds?.length || 0 };
}

// Undo the last Smart Organize run: ungroup the tabs we grouped (empty new
// groups auto-remove; existing groups just lose the added tabs), then restore
// the original tab order best-effort. Clears the snapshot.
async function undoSmartOrganize({ windowId } = {}) {
    const stored = await browser.storage.local.get(SMART_ORGANIZE_UNDO_KEY);
    const snap = stored[SMART_ORGANIZE_UNDO_KEY];
    if (!snap) return { success: false, reason: 'missing' };

    const targetWindowId = windowId ?? snap.windowId;
    try {
        await browser.windows.get(targetWindowId);
    } catch {
        await browser.storage.local.remove(SMART_ORGANIZE_UNDO_KEY);
        return { success: false, reason: 'expired' };
    }

    const affected = (snap.affectedTabIds || []).filter(Boolean);
    if (affected.length) {
        try {
            await browser.tabs.ungroup(affected);
        } catch (e) {
            console.error('Smart Organize undo: ungroup failed', e);
        }
    }

    // Restore original order best-effort: move surviving tabs back in sequence.
    const liveIds = new Set((await browser.tabs.query({ windowId: targetWindowId })).map((t) => t.id));
    let index = 0;
    for (const tabId of snap.orderedTabIds || []) {
        if (!liveIds.has(tabId)) continue;
        try {
            await browser.tabs.move(tabId, { index });
        } catch {
            // tab may be pinned or gone; skip
        }
        index += 1;
    }

    await browser.storage.local.remove(SMART_ORGANIZE_UNDO_KEY);
    return { success: true };
}

// ─── end Smart Organize ──────────────────────────────────────────────────────

async function getNewAccessToken() {
    try {
        const { oauth2 } = browser.runtime.getManifest();
        const clientId = oauth2.client_id;
        const keysUrl = browser.runtime.getURL('api-keys.json');
        
        let clientSecret;
        try {
            const response = await fetch(keysUrl);
            if (!response.ok) {
                logSyncOperation('error', 'Failed to load api-keys.json - sync credentials not configured', {
                    status: response.status
                });
                return false;
            }
            const keys = await response.json();
            clientSecret = keys.clientSecret;
            
            // Check if credentials are actually configured
            if (!clientSecret || clientSecret.trim() === '') {
                logSyncOperation('error', 'OAuth client secret is not configured in api-keys.json - sync will not work until credentials are added', {
                    hint: 'For development, add your Google OAuth credentials to chrome/api-keys.json'
                });
                await browser.storage.local.set({ 
                    syncAuthError: {
                        type: 'missing_credentials',
                        message: 'Sync credentials not configured. Please contact the developer or configure api-keys.json for development.',
                        timestamp: Date.now()
                    }
                });
                return false;
            }
        } catch (fetchError) {
            logSyncOperation('error', 'Failed to fetch api-keys.json', { error: fetchError.message });
            return false;
        }
        
        const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
        
        if (!googleRefreshToken) {
            logSyncOperation('error', 'No refresh token available, user needs to re-authenticate');
            return false;
        }
        
        const requestBody = {
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: googleRefreshToken,
            grant_type: 'refresh_token',
        }
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        }
        
        logSyncOperation('info', 'Requesting new access token with refresh token');
        
        // Use direct fetch instead of handleRequest to avoid unnecessary retries
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', options);
        
        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            await browser.storage.local.set({ 
                googleToken: tokenData.access_token,
                tokenExpiryTime: Date.now() + ((tokenData.expires_in || 3600) * 1000)
            });
            
            // Update refresh token if a new one is provided
            if (tokenData.refresh_token) {
                await browser.storage.local.set({ googleRefreshToken: tokenData.refresh_token });
            }
            
            logSyncOperation('success', 'Successfully refreshed access token', {
                expiresIn: tokenData.expires_in
            });
            return tokenData.access_token;
        } else {
            const errorData = await tokenResponse.json().catch(() => ({}));
            
            if (tokenResponse.status === 400 && errorData.error === 'invalid_grant') {
                // Refresh token is invalid/expired - user needs to re-authenticate
                logSyncOperation('error', 'Refresh token is invalid or expired - please sign out and sign back in to restore sync', {
                    error: errorData.error_description || 'Invalid grant',
                    action: 'User must re-authenticate'
                });
                
                // Clear invalid tokens and set a flag for the UI to detect
                await browser.storage.local.remove(['googleToken', 'googleRefreshToken', 'tokenExpiryTime']);
                await browser.storage.local.set({ 
                    syncAuthError: {
                        type: 'invalid_grant',
                        message: 'Your sync session has expired. Please sign out and sign back in to continue syncing.',
                        timestamp: Date.now()
                    }
                });
                return false;
            } else if (tokenResponse.status === 401) {
                // Unauthorized - token completely invalid
                logSyncOperation('error', 'Authentication failed (401) - please sign out and sign back in', {
                    status: tokenResponse.status,
                    error: errorData.error || 'Unauthorized'
                });
                
                await browser.storage.local.remove(['googleToken', 'googleRefreshToken', 'tokenExpiryTime']);
                await browser.storage.local.set({ 
                    syncAuthError: {
                        type: 'unauthorized',
                        message: 'Authentication failed. Please sign out and sign back in.',
                        timestamp: Date.now()
                    }
                });
                return false;
            } else {
                // Other errors might be temporary (network issues, rate limiting, etc.)
                logSyncOperation('error', 'Token refresh failed - will retry automatically', {
                    status: tokenResponse.status,
                    error: errorData.error || 'Unknown error',
                    description: errorData.error_description || 'No description',
                    retryable: true
                });
                return false;
            }
        }
    } catch (error) {
        logSyncOperation('error', 'Token refresh failed with network error', { 
            error: error.message 
        });
        return false;
    }
}

// Specialized token validation that doesn't retry on auth errors
async function validateToken(token) {
    try {
        const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
        if (response.ok) {
            const tokenInfo = await response.json();
            // Store token expiry for proactive refresh
            const expiresIn = parseInt(tokenInfo.expires_in) || 3600; // Default 1 hour
            const expiryTime = Date.now() + (expiresIn * 1000);
            await browser.storage.local.set({ tokenExpiryTime: expiryTime });
            
            logSyncOperation('success', 'Token validation successful', { 
                expiresIn: expiresIn,
                expiryTime: new Date(expiryTime).toISOString()
            });
            return true;
        } else if (response.status === 400 || response.status === 401) {
            // Token is invalid/expired - don't retry, just refresh
            logSyncOperation('info', 'Token expired or invalid, needs refresh', { status: response.status });
            return false;
        } else {
            // Other errors might be temporary, log but don't retry here
            logSyncOperation('error', 'Token validation failed with non-auth error', { status: response.status });
            return false;
        }
    } catch (error) {
        logSyncOperation('error', 'Token validation network error', { error: error.message });
        return false;
    }
}

async function getAuthToken() {
    const { googleToken, tokenExpiryTime } = await browser.storage.local.get(['googleToken', 'tokenExpiryTime']);
    
    if (!googleToken) {
        return await getNewAccessToken();
    }
    
    // Check if token is expired or expires soon (within 5 minutes)
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (tokenExpiryTime && now >= (tokenExpiryTime - fiveMinutes)) {
        return await getNewAccessToken();
    }
    
    // Only validate if we haven't validated recently AND we don't have expiry info
    if (Date.now() - lastValidated < 60000 && tokenExpiryTime) {
        return googleToken;
    }
    
    const isValid = await validateToken(googleToken);
    lastValidated = Date.now();
    
    if (isValid) {
        return googleToken;
    }
    
    return await getNewAccessToken();
}

async function getGoogleUser(token) {
    const { googleUser } = await browser.storage.local.get('googleUser');
    if (googleUser) return googleUser;
    const url = browser.runtime.getURL('api-keys.json');
    const fileResponse = await fetch(url);
    const { googleDrive: googleApiKey } = await fileResponse.json();
    const init = {
        method: 'GET',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
        'contentType': 'json'
    };
    const response = await handleRequest(
        `https://www.googleapis.com/drive/v3/about?alt=json&fields=user&prettyPrint=false&key=${googleApiKey}`,
        init)
    if (response) {
        await browser.storage.local.set({ googleUser: response.user });
        return response.user;
    }
    return false;
}

async function removeToken(token) {
    const _token = token === -1 ? (await browser.storage.local.get('googleToken')).googleToken : token;
    const url = 'https://accounts.google.com/o/oauth2/revoke?token=' + _token;
    await browser.storage.local.remove('googleToken');
    if (_token) await handleRequest(url);
}

async function getOrCreateSyncFile(token) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    console.log('🔑 getOrCreateSyncFile: Current syncFileId from storage.sync:', syncFileId || 'NOT FOUND');
    
    if (syncFileId) {
        console.log('🔑 getOrCreateSyncFile: Using existing syncFileId from storage.sync');
        return;
    }
    
    console.log('🔑 getOrCreateSyncFile: Searching Google Drive for appSettings.json');
    const url = "https://www.googleapis.com/drive/v3/files/?corpora=user&spaces=appDataFolder&fields=files(id)&q=name='appSettings.json'&pageSize=1&orderBy=modifiedByMeTime desc";
    const response = await handleRequest(url, {
        mode: 'cors',
        withCredentials: true,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    if (response) {
        if (response.files.length === 0) {
            console.log('🔑 getOrCreateSyncFile: No existing file found, creating new sync file');
            await _createNewSyncFile(token);
        } else {
            console.log('🔑 getOrCreateSyncFile: Found existing file in Google Drive:', response.files[0].id);
            await browser.storage.sync.set({ syncFileId: response.files[0].id });
        }
        return true;
    }
    console.log('🔑 getOrCreateSyncFile: Failed to search/create sync file');
    return false;
}

async function _createNewSyncFile(token) {
    // 🚀 NEW: Enhanced sync file creation with version compatibility
    const tabsArray = await loadAllCollectionsBG(true);
    const metadata = {
        name: 'appSettings.json',
        mimeType: 'application/json',
        parents: ['appDataFolder'],
    };
    const { localTimestamp } = await browser.storage.local.get('localTimestamp');
    
    // Use new versioned sync format
    let fileContent = await prepareSyncDataForUpload(tabsArray);
    fileContent.timestamp = localTimestamp || fileContent.timestamp;
    let file = new Blob([JSON.stringify(fileContent)], { type: 'application/json' });
    let form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);
    const init = {
        method: 'POST',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token
        },
        body: form
    };
    const response = await handleRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', init);
    if (response) {
        await browser.storage.sync.set({ syncFileId: response.id });
        return response.id;
    }
    return false;
}

async function _getServerFileTimestamp(token, fileId) {
    const timestampResult = await fetchServerFileTimestampState({
        token,
        fileId,
        fetchImpl: fetch
    });

    return getServerFileTimestampOrFalse(timestampResult);
}

async function _getServerFileTimestampState(token, fileId) {
    return fetchServerFileTimestampState({
        token,
        fileId,
        fetchImpl: fetch
    });
}

async function markSuccessfulSyncCompletion() {
    await browser.storage.local.set({
        lastSuccessfulSyncTime: Date.now()
    });
}

async function uploadPreparedSyncData(token, dataToSync) {
    await getOrCreateSyncFile(token);
    const { syncFileId } = await browser.storage.sync.get('syncFileId');

    if (!syncFileId) {
        logSyncOperation('error', 'No sync file ID available for remote update');
        return false;
    }

    const init = {
        method: 'PATCH',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        'contentType': 'json',
        body: JSON.stringify(dataToSync)
    };

    logSyncOperation('info', 'Syncing data to cloud', {
        collections: dataToSync.tabsArray.length,
        folders: dataToSync.foldersArray?.length || 0,
        version: dataToSync.syncVersion || SYNC_VERSION
    });

    const url = `https://www.googleapis.com/upload/drive/v3/files/${syncFileId}?uploadType=media&access_token=${token}`;
    const response = await handleRequest(url, init);

    if (response !== false) {
        await browser.storage.local.set({
            localTimestamp: dataToSync.timestamp,
            lastSyncTimestamp: dataToSync.timestamp
        });
        await markSuccessfulSyncCompletion();
        logSyncOperation('success', 'Cloud sync completed');
        return response;
    }

    logSyncOperation('error', 'Failed to update remote data');
    return false;
}

// Enhanced updateRemote with atomic operations and better error handling
// skipLock parameter allows calling from within syncData which already holds the lock
async function updateRemote(token, collections = null, skipLock = false) {
    const operation = 'updateRemote';
    
    if (!skipLock) {
        const lockResult = await acquireSyncLock(operation);
        if (lockResult === 'busy') {
            // Same operation already in progress, return success
            return 'already_in_progress';
        }
        if (!lockResult) {
            logSyncOperation('error', 'Failed to acquire sync lock for updateRemote');
            return false;
        }
    }
    
    try {
        // Create backup before making changes
        await createPreSyncBackup('before-remote-update');
        
        // 🚀 NEW: Enhanced sync data with version compatibility
        const dataToSync = await prepareSyncDataForUpload(collections);
        const validation = validateCollectionData(dataToSync);
        if (!validation.valid) {
            logSyncOperation('error', 'Data validation failed before remote update', { error: validation.error });
            return false;
        }
        
        // 🛡️ SAFETY CHECK: Prevent pushing empty data when server has data
        // This prevents new/empty devices from accidentally wiping existing collections
        const localCollectionCount = dataToSync.tabsArray ? dataToSync.tabsArray.length : 0;
        if (localCollectionCount === 0) {
            // Check if server has data before we overwrite it with nothing
            const { syncFileId } = await browser.storage.sync.get('syncFileId');
            if (syncFileId) {
                try {
                    const serverTimestampResult = await _getServerFileTimestampState(token, syncFileId);
                    if (serverTimestampResult.status === SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE) {
                        logSyncOperation('error', 'SAFETY BLOCK: Cannot verify server state before pushing empty data - aborting', {
                            reason: 'remote_unavailable'
                        });
                        return false;
                    }

                    if (serverTimestampResult.status === SERVER_FILE_TIMESTAMP_STATE.OK && serverTimestampResult.timestamp > 0) {
                        logSyncOperation('error', 'SAFETY BLOCK: Refusing to push empty data to server - server has existing data', {
                            serverTimestamp: serverTimestampResult.timestamp,
                            localCollectionCount: 0,
                            action: 'Use loadFromServer to download existing data first'
                        });
                        return false;
                    }
                } catch (checkError) {
                    logSyncOperation('error', 'SAFETY BLOCK: Cannot verify server state before pushing empty data - aborting', {
                        error: checkError.message
                    });
                    return false;
                }
            }
            logSyncOperation('info', 'Pushing empty data to server (server appears empty or new)');
        }

        return await uploadPreparedSyncData(token, dataToSync);
        
    } catch (error) {
        logSyncOperation('error', 'Exception in updateRemote', { error: error.message });
        return false;
    } finally {
        if (!skipLock) {
            releaseSyncLock(operation);
        }
    }
}

// Enhanced remote sync document loader with validation
async function _readRemoteSyncDocument(token, fileId) {
    try {
        const init = {
            method: 'GET',
            async: true,
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            'contentType': 'json'
        };
        
        logSyncOperation('info', 'Loading sync file from server', { fileId });
        const data = await handleRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, init);
        
        logSyncOperation('info', 'Raw server response received', { 
            dataType: typeof data,
            isObject: data && typeof data === 'object',
            hasTabsArray: data && !!data.tabsArray,
            hasFoldersArray: data && !!data.foldersArray,
            foldersCount: data && data.foldersArray ? data.foldersArray.length : 'N/A'
        });
        
        if (data === false) {
            logSyncOperation('error', 'Failed to load sync file from server');
            return false;
        }
        
        // Validate loaded data
        const validation = validateCollectionData(data);
        if (!validation.valid) {
            logSyncOperation('error', 'Loaded data failed validation', { error: validation.error });
            return false;
        }

        const normalizedData = {
            ...data,
            foldersArray: Array.isArray(data.foldersArray)
                ? data.foldersArray
                : await loadAllFoldersBG()
        };
        const detection = detectSyncDataVersion(normalizedData);
        if (!detection.valid) {
            logSyncOperation('error', 'Loaded data uses an unsupported sync version', {
                version: normalizedData.syncVersion || 'missing'
            });
            return false;
        }

        logSyncOperation('success', 'Successfully loaded and validated sync file', {
            collections: normalizedData.tabsArray?.length || 0,
            folders: normalizedData.foldersArray?.length || 0,
            hasFoldersArray: !!normalizedData.foldersArray,
            timestamp: normalizedData.timestamp,
            syncVersion: normalizedData.syncVersion || 'missing'
        });

        return normalizeSyncSnapshot(normalizedData);
        
    } catch (error) {
        logSyncOperation('error', 'Exception in _loadSettingsFile', { error: error.message });
        return false;
    }
}

// Enhanced _loadSettingsFile with validation and atomic local apply
async function _loadSettingsFile(token, fileId) {
    const remoteSyncData = await _readRemoteSyncDocument(token, fileId);
    if (remoteSyncData === false) {
        return false;
    }

    const migratedCollections = await migrateIncomingSyncData(remoteSyncData);
    if (migratedCollections === false) {
        logSyncOperation('error', 'Failed to migrate incoming sync data');
        return false;
    }

    return updateCollectionsUids(migratedCollections);
}

// Recovery function for data corruption scenarios
async function recoverFromBackup(reason = 'unknown') {
    try {
        logSyncOperation('info', `Attempting recovery from backup due to: ${reason}`);
        
        // Try pre-sync backups first (but these are now compact metadata only)
        const { preSyncBackups = [] } = await browser.storage.local.get('preSyncBackups');
        if (preSyncBackups.length > 0) {
            const latestBackup = preSyncBackups[0];
            logSyncOperation('info', 'Pre-sync backup available but contains only metadata for debugging', { 
                backupTimestamp: latestBackup.timestamp,
                collectionCount: latestBackup.collectionCount || 0 
            });
            // Note: These backups no longer contain full data, skip to auto backups
        }
        
        // Try auto backups
        const { autoBackups = [] } = await browser.storage.local.get('autoBackups');
        if (autoBackups.length > 0) {
            const latestAutoBackup = autoBackups[0];
            logSyncOperation('info', 'Recovering from auto backup', { 
                backupTimestamp: latestAutoBackup.timestamp,
                collectionCount: latestAutoBackup.tabsArray?.length || 0 
            });
            return latestAutoBackup.tabsArray;
        }
        
        // Try version backup
        const { backup } = await browser.storage.local.get('backup');
        if (backup && backup.tabsArray) {
            logSyncOperation('info', 'Recovering from version backup', { 
                version: backup.version,
                collectionCount: backup.tabsArray?.length || 0 
            });
            return backup.tabsArray;
        }
        
        logSyncOperation('error', 'No backups available for recovery');
        return [];
        
    } catch (error) {
        logSyncOperation('error', 'Exception during backup recovery', { error: error.message });
        return [];
    }
}

async function createNewSyncFileAndBackup(token) {
    await browser.storage.sync.remove('syncFileId');
    await getOrCreateSyncFile(token);
}

// Enhanced updateLocalDataFromServer with validation and atomic operations
// skipLock parameter allows calling from within syncData which already holds the lock
async function updateLocalDataFromServer(token, force = false, skipLock = false) {
    const operation = 'updateLocalDataFromServer';
    
    if (!skipLock) {
        const lockResult = await acquireSyncLock(operation);
        if (lockResult === 'busy') {
            // Same operation already in progress, return success
            return 'already_in_progress';
        }
        if (!lockResult) {
            logSyncOperation('error', 'Failed to acquire sync lock for updateLocalDataFromServer');
            return false;
        }
    }
    
    try {
        await createPreSyncBackup('before-server-update');
        
        const { syncFileId } = await browser.storage.sync.get('syncFileId');
        const timestampResult = await _getServerFileTimestampState(token, syncFileId);

        if (timestampResult.status === SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE) {
            logSyncOperation('error', 'Failed to get server timestamp because the remote file is temporarily unavailable');
            return false;
        }

        if (timestampResult.status === SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID) {
            logSyncOperation('error', 'Failed to get server timestamp, creating new sync file');
            await createNewSyncFileAndBackup(token);
            return false;
        }

        const serverTimestamp = timestampResult.timestamp;
        
        let { localTimestamp } = await browser.storage.local.get('localTimestamp');
        if (!localTimestamp) localTimestamp = 0;
        
        if (serverTimestamp > localTimestamp || force) {
            logSyncOperation('info', 'Loading data from server', { 
                serverTimestamp, 
                localTimestamp, 
                force 
            });
            
            const tabsArray = await _loadSettingsFile(token, syncFileId);
            if (tabsArray !== false) {
                await browser.storage.local.set({
                    localTimestamp: serverTimestamp
                });
                await markSuccessfulSyncCompletion();
                logSyncOperation('success', 'Successfully updated local data from server with cross-version compatibility');
                return tabsArray;
            } else {
                logSyncOperation('error', 'Failed to load settings file from server');
                return false;
            }
        }
        
        await markSuccessfulSyncCompletion();
        logSyncOperation('info', 'Local data is up to date, no server update needed');
        return 'no_update_needed';
        
    } catch (error) {
        logSyncOperation('error', 'Exception in updateLocalDataFromServer', { error: error.message });
        return false;
    } finally {
        if (!skipLock) {
            releaseSyncLock(operation);
        }
    }
}

async function getTokens(code) {
    const redirectURL = browser.identity.getRedirectURL();
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    const keysUrl = browser.runtime.getURL('api-keys.json');
    
    let clientSecret;
    try {
        const response = await fetch(keysUrl);
        if (!response.ok) {
            console.error('Failed to load api-keys.json - sync credentials not configured');
            return false;
        }
        const keys = await response.json();
        clientSecret = keys.clientSecret;
        
        if (!clientSecret || clientSecret.trim() === '') {
            console.error('OAuth client secret is not configured in api-keys.json - login will fail');
            logSyncOperation('error', 'Cannot complete login - OAuth credentials not configured', {
                hint: 'Add Google OAuth credentials to chrome/api-keys.json'
            });
            return false;
        }
    } catch (fetchError) {
        console.error('Failed to fetch api-keys.json:', fetchError);
        return false;
    }
    
    const requestBody = {
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectURL,
    }
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    }
    const data = await handleRequest('https://oauth2.googleapis.com/token', options);
    if (data && data.access_token) {
        await browser.storage.local.set({ googleToken: data.access_token, googleRefreshToken: data.refresh_token });
        return data.access_token;
    }
    return false;
}

function createAuthEndpoint() {
    const redirectURL = browser.identity.getRedirectURL();
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    const authParams = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        access_type: 'offline',
        redirect_uri: redirectURL,
        prompt: 'consent',
        scope: 'openid ' + oauth2.scopes.join(' '),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;
}

// Shared UID generator - SYNCHRONIZED WITH app/utils/sharedConstants.js
const generateUid = () => {
    return (crypto && crypto.randomUUID) ? 
        crypto.randomUUID() : 
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
};

function applyUid(item) {
    // Applies a unique id to all tabs and groups in a TaboxCollection
    // SYNCHRONIZED WITH app/utils.js applyUid function
    if (!item || !('tabs' in item) || item.tabs.length === 0) return item;
    let tabs = [...item.tabs];
    let chromeGroups = item.chromeGroups ? [...item.chromeGroups] : [];
    tabs.forEach((tab) => {
        tab.uid = generateUid();
    });
    if (chromeGroups.length > 0) {
        chromeGroups.forEach((group) => {
            const groupUid = generateUid();
            group.uid = groupUid;
            tabs = tabs.map(t => (t.groupId === group.id ? { ...t, groupUid: groupUid } : t));
        });
    }
    const newCollection = { ...item };
    newCollection.tabs = tabs;
    newCollection.chromeGroups = chromeGroups;
    return newCollection;
}

// Enhanced updateCollection with better error handling for closed windows
async function updateCollection(collection, windowId) {
    try {
        let tabQueryProperties = {
            windowId: windowId,
        };
        const { chkIgnorePinned } = await browser.storage.local.get('chkIgnorePinned');
        if (chkIgnorePinned) tabQueryProperties.pinned = false;
        
        const fullPageUrl = browser.runtime.getURL('fullpage.html');
        let tabs = (await browser.tabs.query(tabQueryProperties)).filter(t => t.url !== fullPageUrl);

        // Verify window still exists before trying to get it
        let window;
        try {
            window = await browser.windows.get(windowId, { populate: true, windowTypes: ['normal'] });
            delete window.tabs;
        } catch (windowError) {
            // Return null to indicate the update failed due to missing window
            return null;
        }
        
        // Detect if this collection was saved from an incognito window
        const isFromIncognito = window.incognito === true;
        
        // Count how many tabs are from incognito (in case of mixed scenarios)
        const incognitoTabCount = tabs.filter(t => t.incognito === true).length;
        
        let allChromeGroups;
        if (browser.tabGroups) {
            allChromeGroups = await browser.tabGroups.query({ windowId: windowId });
            if (allChromeGroups && allChromeGroups.length > 0) {
                const groupIds = [...new Set(tabs.filter(({ groupId }) => groupId > -1).map((t) => t.groupId))];
                allChromeGroups = allChromeGroups.filter(({ id }) => groupIds.includes(id));
            }
        } else {
            allChromeGroups = [];
        }
        
        tabs = [...tabs].map(t => {
            // Never persist the deferred-loading wrapper as the saved tab URL.
            const resolvedUrl = unwrapDeferredUrl(t.url);
            // Store incognito status per tab for reference
            return {
                ...t,
                url: resolvedUrl,
                wasIncognito: t.incognito === true
            };
        })
        
        const newItem = {
            uid: collection.uid,
            name: collection.name,
            tabs: tabs,
            chromeGroups: allChromeGroups,
            color: collection.color,
            createdOn: collection.createdOn, // Preserve original creation time
            lastUpdated: collection.lastUpdated, // Preserve existing timestamp for now
            lastOpened: collection.lastOpened, // Preserve last opened timestamp
            parentId: collection.parentId, // Preserve folder assignment (fixes eject bug)
            window: window,
            // Store incognito metadata for restoration
            savedFromIncognito: isFromIncognito,
            incognitoTabCount: incognitoTabCount
        };
        
        return applyUid(newItem);
        
    } catch (error) {
        console.error('Error in updateCollection:', error, 'windowId:', windowId);
        return null;
    }
}

// Enhanced syncData with conflict resolution and atomic operations
async function syncData(token) {
    const operation = 'syncData';
    
    const lockResult = await acquireSyncLock(operation);
    if (lockResult === 'busy') {
        // Same operation already in progress, return success
        logSyncOperation('info', 'syncData already in progress, skipping duplicate call');
        return 'already_in_progress';
    }
    if (!lockResult) {
        logSyncOperation('error', 'Failed to acquire sync lock for syncData');
        return false;
    }
    
    try {
        // Create backup before any sync operations
        await createPreSyncBackup('before-sync');
        
        const { syncFileId } = await browser.storage.sync.get('syncFileId');
        let { localTimestamp } = await browser.storage.local.get('localTimestamp');
        if (!localTimestamp) localTimestamp = 0;

        const timestampResult = await _getServerFileTimestampState(token, syncFileId);

        if (timestampResult.status === SERVER_FILE_TIMESTAMP_STATE.UNAVAILABLE) {
            logSyncOperation('error', 'Server timestamp is temporarily unavailable, aborting sync safely');
            return false;
        }

        if (timestampResult.status === SERVER_FILE_TIMESTAMP_STATE.MISSING_OR_INVALID) {
            if (localTimestamp === 0) { 
                logSyncOperation('info', 'No local or remote data, nothing to sync');
                return true; 
            }
            
            logSyncOperation('info', 'Server file invalid, creating new sync file');
            await createNewSyncFileAndBackup(token);
            // Pass skipLock=true since syncData already holds the lock
            const result = await updateRemote(token, null, true);
            return result !== false;
        }

        const serverTimestamp = timestampResult.timestamp;
        
        if (serverTimestamp === localTimestamp) {
            await markSuccessfulSyncCompletion();
            logSyncOperation('info', 'Local and remote data are in sync');
            return true;
        }
        
        // Check for potential conflicts
        const timeDifference = Math.abs(serverTimestamp - localTimestamp);
        const isConflict = timeDifference < 60000; // Within 1 minute might be conflict
        
        if (serverTimestamp > localTimestamp) {
            logSyncOperation('info', 'Remote data is newer, updating local', { 
                serverTimestamp, 
                localTimestamp,
                isConflict 
            });
            
            if (isConflict) {
                // Potential conflict - create additional backup
                await createPreSyncBackup('conflict-before-remote-update');

                const remoteSyncData = await _readRemoteSyncDocument(token, syncFileId);
                if (remoteSyncData === false) {
                    logSyncOperation('error', 'Failed to load remote data for conflict merge');
                    return false;
                }

                const localSyncData = await prepareSyncDataForUpload();
                // Use the real last-local-change time (not Date.now()) so the merge's
                // single-sided-deletion heuristic does not mistake brand-new remote
                // entities (e.g. a folder duplicated on another device) for local
                // deletions and drop them.
                localSyncData.timestamp = localTimestamp;
                const mergedSyncData = mergeSyncSnapshots({
                    localSnapshot: localSyncData,
                    remoteSnapshot: remoteSyncData
                });
                mergedSyncData.timestamp = Date.now();

                const mergedCollections = await migrateIncomingSyncData(mergedSyncData);
                if (mergedCollections === false) {
                    logSyncOperation('error', 'Failed to apply merged conflict snapshot locally');
                    return false;
                }

                const uploadResult = await uploadPreparedSyncData(token, mergedSyncData);
                return uploadResult !== false;
            }

            const tabsArray = await _loadSettingsFile(token, syncFileId);
            if (tabsArray !== false) {
                await browser.storage.local.set({
                    localTimestamp: serverTimestamp
                });
                await markSuccessfulSyncCompletion();
                logSyncOperation('success', 'Successfully updated local data from server with cross-version compatibility');
                return true;
            } else {
                logSyncOperation('error', 'Failed to load data from server');
                return false;
            }
        } else {
            // Local data claims to be newer - but verify we actually have data before pushing
            const localCollections = await loadAllCollectionsBG(true);
            const localCollectionCount = localCollections ? localCollections.length : 0;
            
            // 🛡️ SAFETY CHECK: If local is "newer" but EMPTY, and server has data,
            // this is likely a new device with wrong timestamp - download instead
            if (localCollectionCount === 0 && serverTimestamp > 0) {
                logSyncOperation('error', 'SAFETY BLOCK: Local claims newer but has no data while server has data - downloading instead', {
                    localTimestamp,
                    serverTimestamp,
                    localCollectionCount: 0,
                    action: 'Downloading from server to prevent data loss'
                });
                
                // Force download from server to prevent data loss
                const tabsArray = await _loadSettingsFile(token, syncFileId);
                if (tabsArray !== false && tabsArray.length > 0) {
                    await browser.storage.local.set({
                        localTimestamp: serverTimestamp
                    });
                    await markSuccessfulSyncCompletion();
                    logSyncOperation('success', 'Safety download completed - recovered data from server');
                    return true;
                }
                return false;
            }
            
            logSyncOperation('info', 'Local data is newer, updating remote', { 
                serverTimestamp, 
                localTimestamp,
                localCollectionCount,
                isConflict 
            });
            
            if (isConflict) {
                // Potential conflict - create additional backup
                await createPreSyncBackup('conflict-before-local-update');

                const remoteSyncData = await _readRemoteSyncDocument(token, syncFileId);
                if (remoteSyncData === false) {
                    logSyncOperation('error', 'Failed to load remote data for conflict merge');
                    return false;
                }

                const localSyncData = await prepareSyncDataForUpload();
                // Use the real last-local-change time (not Date.now()) so the merge's
                // single-sided-deletion heuristic does not mistake brand-new remote
                // entities (e.g. a folder duplicated on another device) for local
                // deletions and drop them.
                localSyncData.timestamp = localTimestamp;
                const mergedSyncData = mergeSyncSnapshots({
                    localSnapshot: localSyncData,
                    remoteSnapshot: remoteSyncData
                });
                mergedSyncData.timestamp = Date.now();

                const mergedCollections = await migrateIncomingSyncData(mergedSyncData);
                if (mergedCollections === false) {
                    logSyncOperation('error', 'Failed to apply merged conflict snapshot locally');
                    return false;
                }

                const uploadResult = await uploadPreparedSyncData(token, mergedSyncData);
                return uploadResult !== false;
            }

            // Pass skipLock=true since syncData already holds the lock
            const result = await updateRemote(token, null, true);
            return result !== false;
        }
        
    } catch (error) {
        logSyncOperation('error', 'Exception in syncData', { error: error.message });
        return false;
    } finally {
        releaseSyncLock(operation);
    }
}

// Storage cleanup and monitoring utilities
const cleanupLargeBackups = async () => {
    try {
        const { preSyncBackups = [], autoBackups = [] } = await browser.storage.local.get(['preSyncBackups', 'autoBackups']);
        
        // Calculate current sizes
        const preSyncSize = JSON.stringify(preSyncBackups).length;
        const autoBackupSize = JSON.stringify(autoBackups).length;
        const totalBackupSize = preSyncSize + autoBackupSize;
        
        
        let cleaned = false;
        
        // Clean up oversized preSyncBackups (convert old full backups to metadata)
        if (preSyncSize > 500 * 1024) { // > 500KB
            const cleanedPreSync = preSyncBackups.map(backup => {
                if (backup.tabsArray && backup.tabsArray[0] && backup.tabsArray[0].tabs) {
                    // This is an old full backup, convert to metadata
                    return {
                        timestamp: backup.timestamp,
                        localTimestamp: backup.localTimestamp,
                        collectionCount: backup.tabsArray.length,
                        label: backup.label,
                        tabsArray: backup.tabsArray.map(collection => ({
                            uid: collection.uid,
                            name: collection.name,
                            createdOn: collection.createdOn,
                            lastUpdated: collection.lastUpdated,
                            color: collection.color,
                            tabCount: collection.tabs?.length || 0,
                            sampleTabs: collection.tabs?.slice(0, 2)?.map(tab => ({
                                title: tab.title,
                                url: tab.url
                            })) || []
                        }))
                    };
                }
                return backup; // Already optimized
            }).slice(0, 3); // Keep only 3 most recent
            
            await browser.storage.local.set({ preSyncBackups: cleanedPreSync });
            cleaned = true;
        }
        
        // Clean up oversized autoBackups
        if (autoBackupSize > 1.5 * 1024 * 1024) { // > 1.5MB
            const cleanedAutoBackups = autoBackups.slice(0, 2); // Keep only 2 most recent
            await browser.storage.local.set({ autoBackups: cleanedAutoBackups });
            cleaned = true;
        }
        
        if (cleaned) {
            // Recalculate after cleanup
            const { preSyncBackups: newPreSync = [], autoBackups: newAuto = [] } = await browser.storage.local.get(['preSyncBackups', 'autoBackups']);
            const newTotal = JSON.stringify(newPreSync).length + JSON.stringify(newAuto).length;
        }
        
        return totalBackupSize;
    } catch (error) {
        console.error('Error during backup cleanup:', error);
        return 0;
    }
};

// Debug helper - set globalThis.DEBUG_STORAGE = true to enable verbose logging
if (typeof globalThis !== 'undefined') {
    globalThis.enableStorageDebug = () => {
        globalThis.DEBUG_STORAGE = true;
    };
    globalThis.disableStorageDebug = () => {
        globalThis.DEBUG_STORAGE = false;
    };
    globalThis.cleanupBackups = cleanupLargeBackups;
    globalThis.checkBackupSizes = async () => {
        const { preSyncBackups = [], autoBackups = [] } = await browser.storage.local.get(['preSyncBackups', 'autoBackups']);
        const preSyncSize = JSON.stringify(preSyncBackups).length;
        const autoBackupSize = JSON.stringify(autoBackups).length;
        return { preSyncSize, autoBackupSize, totalSize: preSyncSize + autoBackupSize };
    };
}

// Cross-version sync compatibility functions
const SYNC_VERSION = '4.0';

/**
 * Enhanced sync data format with version detection
 * Supported format: { timestamp, tabsArray, foldersArray, syncVersion: '4.0', storageVersion: 3 }
 */

const detectSyncDataVersion = (data) => {
    if (!data || typeof data !== 'object') {
        return { version: 'unknown', valid: false };
    }

    const parsedVersion = Number.parseFloat(data.syncVersion);
    if (Number.isFinite(parsedVersion) && parsedVersion >= 4.0 && Array.isArray(data.tabsArray)) {
        return {
            version: data.syncVersion,
            storageVersion: data.storageVersion || 3,
            valid: true
        };
    }

    return { version: data.syncVersion || 'unknown', valid: false };
};

const migrateIncomingSyncData = async (data) => {
    try {
        const detection = detectSyncDataVersion(data);

        if (!detection.valid) {
            console.error('❌ Invalid sync data format detected');
            return false;
        }

        const normalizedSyncData = normalizeSyncSnapshot({
            ...data,
            foldersArray: Array.isArray(data.foldersArray)
                ? data.foldersArray
                : await loadAllFoldersBG()
        });

        logSyncOperation('info', 'Applying normalized 4.0 sync data', {
            collections: normalizedSyncData.tabsArray.length,
            folders: normalizedSyncData.foldersArray.length
        });

        const applyResult = await applySyncSnapshotAtomically({
            storageArea: browser.storage.local,
            syncData: normalizedSyncData
        });

        if (!applyResult.success) {
            logSyncOperation('error', 'Atomic sync apply failed', {
                error: applyResult.error,
                rollbackSucceeded: applyResult.rollbackSucceeded,
                rollbackError: applyResult.rollbackError
            });
            return false;
        }

        return applyResult.collections;
    } catch (error) {
        console.error('💥 Error migrating sync data:', error);
        return false;
    }
};

// Load collections by UIDs (for incremental sync)
const loadCollectionsByUids = async (uids) => {
    try {
        if (!uids || uids.length === 0) {
            return [];
        }
        
        const keys = uids.map(uid => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
        const results = await browser.storage.local.get(keys);
        
        const collections = [];
        uids.forEach(uid => {
            const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            if (results[key]) {
                collections.push(normalizeCollectionRecordBG(results[key]));
            }
        });
        
        return collections;
    } catch (error) {
        console.error('Background: Failed to load collections by UIDs:', error);
        return [];
    }
};

// Enhanced data preparation for upload with version info.
// Sync still emits full 4.0 snapshots by default; incremental sync remains off until the
// wire contract is upgraded end-to-end for partial updates.
const prepareSyncDataForUpload = async (collections, useIncrementalSync = false) => {
    try {
        let tabsArray;
        let foldersArray;
        
        if (collections) {
            // Collections explicitly provided
            tabsArray = collections;
            foldersArray = await loadAllFoldersBG();
        } else if (useIncrementalSync) {
            // OPTIMIZATION: Incremental sync - only load changed collections
            const { lastSyncTimestamp = 0 } = await browser.storage.local.get('lastSyncTimestamp');
            
            if (lastSyncTimestamp > 0) {
                // Load only collections changed since last sync
                const collectionsIndex = await loadCollectionsIndexBG();
                const changedCollectionUids = Object.keys(collectionsIndex).filter(uid => {
                    const meta = collectionsIndex[uid];
                    const updated = meta.lastUpdated || meta.createdOn || 0;
                    return updated > lastSyncTimestamp;
                });
                
                if (changedCollectionUids.length > 0) {
                    tabsArray = await loadCollectionsByUids(changedCollectionUids);
                } else {
                    // Still need to send current timestamp to indicate sync happened
                    tabsArray = [];
                }
                
                // Check folders too
                const foldersIndex = await loadFoldersIndexBG();
                const changedFolderUids = Object.keys(foldersIndex).filter(uid => {
                    const meta = foldersIndex[uid];
                    const updated = meta.lastUpdated || meta.createdOn || 0;
                    return updated > lastSyncTimestamp;
                });
                
                if (changedFolderUids.length > 0) {
                    // Load changed folders (would need a loadFoldersByUids function)
                    foldersArray = await loadAllFoldersBG(); // For now, load all folders
                } else {
                    foldersArray = [];
                }

                const normalizedTabsArray = (tabsArray || []).map((collection) => normalizeCollectionRecordBG(collection));
                
                // Mark this as incremental sync data
                const syncData = {
                    timestamp: Date.now(),
                    tabsArray: normalizedTabsArray,
                    foldersArray: foldersArray,
                    syncVersion: SYNC_VERSION,
                    storageVersion: 3,
                    extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime) ? 
                        chrome.runtime.getManifest().version : '4.0',
                    isIncrementalSync: true,
                    lastSyncTimestamp: lastSyncTimestamp,
                    changedCollectionCount: normalizedTabsArray.length,
                    changedFolderCount: foldersArray.length
                };
                
                
                return syncData;
            } else {
                // First sync, do full sync
                tabsArray = await loadAllCollectionsBG(true);
                foldersArray = await loadAllFoldersBG();
            }
        } else {
            // Full sync remains the default 4.0+ contract.
            tabsArray = await loadAllCollectionsBG(true);
            foldersArray = await loadAllFoldersBG();
        }

        const normalizedTabsArray = (tabsArray || []).map((collection) => normalizeCollectionRecordBG(collection));
        const deletedCollectionTombstones = await loadDeletedCollectionTombstonesBG();
        const deletedCollections = Object.entries(deletedCollectionTombstones).map(([uid, lastUpdated]) => ({
            uid,
            lastUpdated
        }));
        const deletedFolderTombstones = await loadDeletedFolderTombstonesBG();
        const deletedFolders = Object.entries(deletedFolderTombstones).map(([uid, lastUpdated]) => ({
            uid,
            lastUpdated
        }));

        // v4.0 enhanced sync format with version detection and folders support
        const syncData = {
            timestamp: Date.now(),
            tabsArray: normalizedTabsArray,
            foldersArray: foldersArray,
            deletedCollections,
            deletedFolders,
            syncVersion: SYNC_VERSION,
            storageVersion: 3,
            extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime) ? 
                chrome.runtime.getManifest().version : '4.0',
            isIncrementalSync: false
        };
        
        console.log('📤 prepareSyncDataForUpload: Preparing sync data with', normalizedTabsArray.length, 'collections and', foldersArray.length, 'folders');
        console.log('📤 prepareSyncDataForUpload: Folder order:', foldersArray.map(f => ({ name: f.name, order: f.order })));
        console.log('📤 prepareSyncDataForUpload: Collection order:', normalizedTabsArray.map(c => ({ name: c.name, order: c.order, parentId: c.parentId })));
        
        return syncData;
        
    } catch (error) {
        console.error('❌ Error preparing sync data:', error);
        // Fallback to legacy format for compatibility
        return {
            timestamp: Date.now(),
            tabsArray: (collections || []).map((collection) => normalizeCollectionRecordBG(collection)),
            foldersArray: [],
            syncVersion: SYNC_VERSION,
            storageVersion: 3,
            isIncrementalSync: false
        };
    }
};

// Automatic authentication recovery function
async function attemptAuthRecovery(operation = 'unknown', maxAttempts = 3) {
    logSyncOperation('info', `Attempting authentication recovery for: ${operation}`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Check if we have a refresh token
            const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
            if (!googleRefreshToken) {
                logSyncOperation('error', 'No refresh token available for auth recovery');
                return false;
            }
            
            // Clear current invalid token
            await browser.storage.local.remove(['googleToken', 'tokenExpiryTime']);
            
            // Wait a bit before retry to avoid rate limiting
            if (attempt > 1) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            // Try to get a new token
            const newToken = await getNewAccessToken();
            if (newToken !== false) {
                logSyncOperation('success', `Authentication recovery successful on attempt ${attempt}`);
                return newToken;
            }
            
            logSyncOperation('info', `Auth recovery attempt ${attempt} failed, trying again`, {
                attempt,
                maxAttempts
            });
            
        } catch (error) {
            logSyncOperation('error', `Exception during auth recovery attempt ${attempt}`, {
                error: error.message,
                attempt,
                maxAttempts
            });
        }
    }
    
    logSyncOperation('error', `Authentication recovery failed after ${maxAttempts} attempts`);
    return false;
}

// Enhanced authentication wrapper that provides seamless recovery
async function getAuthTokenWithRecovery(operation = 'unknown') {
    try {
        // First try normal token retrieval
        const token = await getAuthToken();
        if (token !== false) {
            return token;
        }
        
        // If that fails, attempt recovery
        logSyncOperation('info', `Normal auth failed for ${operation}, attempting recovery`);
        return await attemptAuthRecovery(operation);
        
    } catch (error) {
        logSyncOperation('error', `Exception in getAuthTokenWithRecovery for ${operation}`, {
            error: error.message
        });
        
        // Still try recovery even if there was an exception
        return await attemptAuthRecovery(operation);
    }
}

const backgroundUtilsApi = {
    STORAGE_KEYS,
    SYNC_VERSION,
    unwrapDeferredUrl,
    isDeferredLoadingUrl,
    loadCollectionsIndexBG,
    loadSingleCollectionBG,
    saveSingleCollectionBG,
    markCollectionOpenedBG,
    loadAllCollectionsBG,
    updateAllCollectionsBG,
    deleteSingleCollectionBG,
    loadFoldersIndexBG,
    loadSingleFolderBG,
    saveSingleFolderBG,
    loadAllFoldersBG,
    updateAllFoldersBG,
    deleteSingleFolderBG,
    handleRequest,
    logSyncOperation,
    validateCollectionData,
    detectSyncDataVersion,
    migrateIncomingSyncData,
    prepareSyncDataForUpload,
    getNewAccessToken,
    validateToken,
    getAuthToken,
    getGoogleUser,
    removeToken,
    getOrCreateSyncFile,
    _getServerFileTimestamp,
    updateRemote,
    updateLocalDataFromServer,
    syncData,
    getAuthTokenWithRecovery,
    createPreSyncBackup,
    recoverFromBackup,
    updateCollection,
    updateCollectionsUids,
    createNewSyncFileAndBackup,
    SMART_ORGANIZE_UNDO_KEY,
    applySmartOrganizePlan,
    undoSmartOrganize,
};

if (typeof globalThis !== 'undefined') {
    globalThis.TaboxBackgroundUtils = backgroundUtilsApi;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = backgroundUtilsApi;
}
