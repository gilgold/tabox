/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

// Storage utilities for background script - NEW INDEXED STORAGE HELPERS

// Storage key constants - SYNCHRONIZED WITH app/utils/sharedConstants.js
// Note: Cannot directly import due to webpack configuration, but kept in sync
const STORAGE_KEYS = {
    COLLECTIONS_INDEX: 'collections_index',
    FOLDERS_INDEX: 'folders_index',
    LEGACY_TABS_ARRAY: 'tabsArray',
    COLLECTION_PREFIX: 'collection_',
    FOLDER_PREFIX: 'folder_',
    STORAGE_VERSION: 'tabox_storage_version'
};

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

// Load single collection in background script  
const loadSingleCollectionBG = async (uid) => {
    try {
        const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
        const { [key]: collection } = await browser.storage.local.get(key);
        
        if (!collection) {
            console.warn(`Background: Collection ${uid} not found in storage`);
            return null;
        }
        
        return collection;
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
        
        const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
        const now = Date.now();
        
        // Load existing collection to preserve critical local data like parentId
        let existingCollection = null;
        try {
            const { [collectionKey]: existing } = await browser.storage.local.get(collectionKey);
            existingCollection = existing;
        } catch (error) {
            // Collection doesn't exist yet, that's fine
        }
        
        // Only update lastUpdated if explicitly requested or if it's missing
        const lastUpdated = forceUpdateTimestamp ? now : (collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : now);
        
        // Preserve existing parentId if incoming collection doesn't have one (from cloud sync)
        const preservedParentId = collection.parentId !== undefined ? collection.parentId : 
                                  (existingCollection?.parentId !== undefined ? existingCollection.parentId : null);
        
        
        // Save collection data
        await browser.storage.local.set({
            [collectionKey]: {
                uid: collection.uid,
                name: collection.name,
                tabs: collection.tabs || [],
                color: collection.color,
                createdOn: collection.createdOn || now,
                lastUpdated: lastUpdated,
                lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null,
                chromeGroups: collection.chromeGroups || [],
                // Preserve parentId from existing collection if incoming doesn't have it
                parentId: preservedParentId,
                // Store any other collection properties
                ...collection
            }
        });
        
        // Update index
        const index = await loadCollectionsIndexBG();
        const collectionSize = JSON.stringify(collection).length;
        
        index[collection.uid] = {
            name: collection.name,
            type: 'collection',
            tabCount: collection.tabs ? collection.tabs.length : 0,
            lastUpdated: lastUpdated,
            lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null,
            createdOn: collection.createdOn || now,
            color: collection.color || 'default',
            size: collectionSize,
            parentId: preservedParentId
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index
        });
        
        if (globalThis.DEBUG_STORAGE) {
        }
        return true;
        
    } catch (error) {
        console.error('Background: Failed to save collection:', error);
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
                        collections.push(results[key]);
                    }
                });
                
                // Only log if debug mode is explicitly enabled
                if (globalThis.DEBUG_STORAGE) {
                }
                return collections;
            }
        }
        
        // Fallback to legacy storage
        if (globalThis.DEBUG_STORAGE) {
        }
        const { [STORAGE_KEYS.LEGACY_TABS_ARRAY]: tabsArray } = await browser.storage.local.get(STORAGE_KEYS.LEGACY_TABS_ARRAY);
        return tabsArray || [];
        
    } catch (error) {
        console.error('Background: Failed to load collections:', error);
        return [];
    }
};

// Throttled legacy storage sync (prevent excessive updates)
// BACKWARDS COMPATIBILITY: Keep tabsArray updated for v3.6 compatibility
// v3.6 relies on tabsArray in local storage - if it's missing, it shows 0 collections
// and can sync empty data to Google Drive, wiping out all data
let legacySyncTimeout = null;
let legacySyncEnabled = true; // MUST be enabled for v3.6 backwards compatibility
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
            if (globalThis.DEBUG_STORAGE) {
            }
        } catch (error) {
            console.error('Background: Failed to sync legacy storage:', error);
        } finally {
            legacySyncTimeout = null;
        }
    }, 5000); // Sync legacy storage at most once every 5 seconds
};

// Enable legacy storage sync (for backwards compatibility or backup operations)
const enableLegacyStorageSync = () => {
    legacySyncEnabled = true;
};

// Disable legacy storage sync (default for performance)
const disableLegacyStorageSync = () => {
    legacySyncEnabled = false;
};

// Force immediate legacy storage sync (for backup/export operations)
const forceLegacyStorageSync = async () => {
    try {
        const collections = await loadAllCollectionsBG(true);
        await browser.storage.local.set({ 
            [STORAGE_KEYS.LEGACY_TABS_ARRAY]: collections,
            localTimestamp: Date.now() 
        });
        if (globalThis.DEBUG_STORAGE) {
        }
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
            for (const collection of collections) {
                if (!collection.uid) {
                    console.error('Collection missing UID, skipping:', collection.name);
                    continue;
                }
                
                const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
                const lastUpdated = collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : now;
                
                // Prepare collection data
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
                    ...collection
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
                    parentId: collection.parentId !== undefined ? collection.parentId : null
                };
            }
            
            // OPTIMIZATION: Single batched write with chunking for Chrome limits
            await batchWriteCollections(updates, 50);
            
            // Update index in a single write
            await browser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: newIndex
            });
            
            if (globalThis.DEBUG_STORAGE) {
            }
            
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
        
        foldersIndex[folder.uid] = {
            name: folder.name,
            type: 'folder',
            color: folder.color || 'var(--folder-default-color)',
            collapsed: folder.collapsed !== undefined ? folder.collapsed : false,
            collectionCount: collectionCount,
            lastUpdated: lastUpdated,
            createdOn: folder.createdOn || now,
            size: folderSize
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
                folders.push(results[key]);
            }
        });
        
        return folders;
        
    } catch (error) {
        console.error('Background: Failed to load folders:', error);
        return [];
    }
};

// Update all folders from sync data
const updateAllFoldersBG = async (folders) => {
    try {
        if (!folders || folders.length === 0) {
            return true;
        }
        
        
        // Update each folder individually using new system
        const savePromises = folders.map(folder => saveSingleFolderBG(folder));
        const results = await Promise.all(savePromises);
        
        const successCount = results.filter(Boolean).length;
        
        return successCount === folders.length;
        
    } catch (error) {
        console.error('📁 Background: Failed to update folders:', error);
        return false;
    }
};

let lastValidated = 0;
let syncLock = false; // Prevent concurrent sync operations
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
    const logEntry = {
        timestamp,
        level,
        message,
        data,
        stackTrace: level === 'error' ? new Error().stack : undefined
    };
    
    // Only log errors and critical info, skip routine success messages
    if (level === 'error' || (level === 'info' && message.includes('Acquired') === false && message.includes('Released') === false && message.includes('Created pre-sync backup') === false)) {
        console[level === 'error' ? 'error' : 'log'](`[SYNC ${level.toUpperCase()}] ${message}`, data);
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
        
        if (globalThis.DEBUG_STORAGE) {
        }
        
        return true;
    } catch (error) {
        logSyncOperation('error', 'Failed to create pre-sync backup', { error: error.message });
        return false;
    }
}

// Acquire sync lock to prevent concurrent operations
async function acquireSyncLock(operation = 'unknown', timeout = 30000) {
    const startTime = Date.now();
    
    while (syncLock) {
        if (Date.now() - startTime > timeout) {
            logSyncOperation('error', `Sync lock timeout for operation: ${operation}`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    syncLock = true;
    logSyncOperation('info', `Acquired sync lock for: ${operation}`);
    return true;
}

// Release sync lock
function releaseSyncLock(operation = 'unknown') {
    syncLock = false;
    logSyncOperation('info', `Released sync lock for: ${operation}`);
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

async function getNewAccessToken() {
    try {
        const { oauth2 } = browser.runtime.getManifest();
        const clientId = oauth2.client_id;
        const keysUrl = browser.runtime.getURL('api-keys.json');
        const response = await fetch(keysUrl);
        const { clientSecret } = await response.json();
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
                logSyncOperation('error', 'Refresh token is invalid or expired, clearing auth data', {
                    error: errorData.error_description || 'Invalid grant'
                });
                
                // Clear invalid tokens but keep user info for UI purposes
                await browser.storage.local.remove(['googleToken', 'googleRefreshToken', 'tokenExpiryTime']);
                return false;
            } else {
                // Other errors might be temporary
                logSyncOperation('error', 'Token refresh failed with error', {
                    status: tokenResponse.status,
                    error: errorData.error || 'Unknown error',
                    description: errorData.error_description
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
    
    if (globalThis.DEBUG_STORAGE) {
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
    if (syncFileId) {
        return;
    }
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
            await _createNewSyncFile(token);
        } else {
            await browser.storage.sync.set({ syncFileId: response.files[0].id });
        }
        return true;
    }
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
    const init = {
        method: 'GET',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        'contentType': 'json'
    };
    const response = await handleRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, init)
    if (response.timestamp === undefined) {
        const response = await handleRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=json&fields=modifiedByMeTime`, init);
        return response ? Date.parse(response.modifiedByMeTime) : response;
    }
    return response.timestamp;
}

// Enhanced updateRemote with atomic operations and better error handling
async function updateRemote(token, collections = null) {
    const operation = 'updateRemote';
    
    if (!await acquireSyncLock(operation)) {
        logSyncOperation('error', 'Failed to acquire sync lock for updateRemote');
        return false;
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
            version: dataToSync.syncVersion || 'legacy'
        });
        
        const url = `https://www.googleapis.com/upload/drive/v3/files/${syncFileId}?uploadType=media&access_token=${token}`;
        const response = await handleRequest(url, init);
        
        if (response !== false) {
            // Only update local timestamp and lastSyncTimestamp after successful remote update
            await browser.storage.local.set({ 
                localTimestamp: dataToSync.timestamp,
                lastSyncTimestamp: dataToSync.timestamp // Store for incremental sync tracking
            });
            logSyncOperation('success', 'Cloud sync completed');
            return response;
        } else {
            logSyncOperation('error', 'Failed to update remote data');
            return false;
        }
        
    } catch (error) {
        logSyncOperation('error', 'Exception in updateRemote', { error: error.message });
        return false;
    } finally {
        releaseSyncLock(operation);
    }
}

// Enhanced _loadSettingsFile with validation and conflict detection
async function _loadSettingsFile(token, fileId) {
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
        
        if (data === false) {
            logSyncOperation('error', 'Failed to load sync file from server');
            return false;
        }
        
        // Validate loaded data
        const validation = validateCollectionData(data);
        if (!validation.valid) {
            logSyncOperation('error', 'Loaded data failed validation', { error: validation.error });
            // Try to recover from backup if available
            return await recoverFromBackup('invalid-remote-data');
        }
        
        logSyncOperation('success', 'Successfully loaded and validated sync file', { 
            collections: data.tabsArray?.length || 0,
            folders: data.foldersArray?.length || 0,
            hasFoldersArray: !!data.foldersArray,
            timestamp: data.timestamp,
            syncVersion: data.syncVersion || 'legacy'
        });
        
        // 🚀 NEW: Cross-version compatibility - migrate incoming data to v4.0
        const migratedCollections = await migrateIncomingSyncData(data);
        if (migratedCollections === false) {
            logSyncOperation('error', 'Failed to migrate incoming sync data');
            return false;
        }
        
        return updateCollectionsUids(migratedCollections);
        
    } catch (error) {
        logSyncOperation('error', 'Exception in _loadSettingsFile', { error: error.message });
        return false;
    }
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
async function updateLocalDataFromServer(token, force = false) {
    const operation = 'updateLocalDataFromServer';
    
    if (!await acquireSyncLock(operation)) {
        logSyncOperation('error', 'Failed to acquire sync lock for updateLocalDataFromServer');
        return false;
    }
    
    try {
        await createPreSyncBackup('before-server-update');
        
        const { syncFileId } = await browser.storage.sync.get('syncFileId');
        const serverTimestamp = await _getServerFileTimestamp(token, syncFileId);
        
        if (serverTimestamp === undefined || serverTimestamp === false) {
            logSyncOperation('error', 'Failed to get server timestamp, creating new sync file');
            await createNewSyncFileAndBackup(token);
            return false;
        }
        
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
                // 🚀 NEW: Ensure both legacy and indexed storage are updated
                const updateSuccess = await updateAllCollectionsBG(tabsArray);
                if (updateSuccess) {
                    await browser.storage.local.set({ 
                        localTimestamp: serverTimestamp 
                    });
                    logSyncOperation('success', 'Successfully updated local data from server with cross-version compatibility');
                    return tabsArray;
                } else {
                    logSyncOperation('error', 'Failed to update local storage systems');
                    return false;
                }
            } else {
                logSyncOperation('error', 'Failed to load settings file from server');
                return false;
            }
        }
        
        logSyncOperation('info', 'Local data is up to date, no server update needed');
        return 'no_update_needed';
        
    } catch (error) {
        logSyncOperation('error', 'Exception in updateLocalDataFromServer', { error: error.message });
        return false;
    } finally {
        releaseSyncLock(operation);
    }
}

async function getTokens(code) {
    const redirectURL = browser.identity.getRedirectURL();
    const { oauth2 } = browser.runtime.getManifest();
    const clientId = oauth2.client_id;
    const keysUrl = browser.runtime.getURL('api-keys.json');
    const response = await fetch(keysUrl);
    const { clientSecret } = await response.json();
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
    await browser.storage.local.set({ googleToken: data.access_token, googleRefreshToken: data.refresh_token });
    return data ? data.access_token : false;
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
        
        let tabs = await browser.tabs.query(tabQueryProperties);
        
        // Verify window still exists before trying to get it
        let window;
        try {
            window = await browser.windows.get(windowId, { populate: true, windowTypes: ['normal'] });
            delete window.tabs;
        } catch (windowError) {
            // Return null to indicate the update failed due to missing window
            return null;
        }
        
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
            if (t.url.indexOf('deferedLoading.html') > -1) {
                const url = new URL(t.url);
                const urlParams = url.searchParams;
                const params = Object.fromEntries(urlParams.entries());
                t.url = params?.url || t.url;
            }
            return t;
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
            window: window
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
    
    if (!await acquireSyncLock(operation)) {
        logSyncOperation('error', 'Failed to acquire sync lock for syncData');
        return false;
    }
    
    try {
        // Create backup before any sync operations
        await createPreSyncBackup('before-sync');
        
        const { syncFileId } = await browser.storage.sync.get('syncFileId');
        let { localTimestamp } = await browser.storage.local.get('localTimestamp');
        if (!localTimestamp) localTimestamp = 0;
        
        const serverTimestamp = await _getServerFileTimestamp(token, syncFileId);
        
        if (serverTimestamp === undefined || serverTimestamp === false) {
            if (localTimestamp === 0) { 
                logSyncOperation('info', 'No local or remote data, nothing to sync');
                return true; 
            }
            
            logSyncOperation('info', 'Server file invalid, creating new sync file');
            await createNewSyncFileAndBackup(token);
            const result = await updateRemote(token);
            return result !== false;
        }
        
        if (serverTimestamp === localTimestamp) {
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
            }
            
            const tabsArray = await _loadSettingsFile(token, syncFileId);
            if (tabsArray !== false) {
                // 🚀 NEW: Cross-version sync - update both storage systems
                const updateSuccess = await updateAllCollectionsBG(tabsArray);
                if (updateSuccess) {
                    await browser.storage.local.set({ 
                        localTimestamp: serverTimestamp 
                    });
                    logSyncOperation('success', 'Successfully updated local data from server with cross-version compatibility');
                    return true;
                } else {
                    logSyncOperation('error', 'Failed to update local storage systems during sync');
                    return false;
                }
            } else {
                logSyncOperation('error', 'Failed to load data from server');
                return false;
            }
        } else {
            logSyncOperation('info', 'Local data is newer, updating remote', { 
                serverTimestamp, 
                localTimestamp,
                isConflict 
            });
            
            if (isConflict) {
                // Potential conflict - create additional backup
                await createPreSyncBackup('conflict-before-local-update');
            }
            
            const result = await updateRemote(token);
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
const LEGACY_SYNC_VERSION = '3.5';

/**
 * Enhanced sync data format with version detection
 * v4.0 format: { timestamp, tabsArray, syncVersion: '4.0', storageVersion: 3 }
 * v3.5 format: { timestamp, tabsArray } (no syncVersion field)
 */

// Detect sync data version and format
const detectSyncDataVersion = (data) => {
    if (!data || typeof data !== 'object') {
        return { version: 'unknown', valid: false };
    }
    
    // v4.0+ has explicit version fields
    if (data.syncVersion) {
        return { 
            version: data.syncVersion, 
            storageVersion: data.storageVersion || 1,
            valid: true 
        };
    }
    
    // v3.5 and earlier - detect by structure
    if (data.tabsArray && Array.isArray(data.tabsArray) && data.timestamp) {
        return { 
            version: LEGACY_SYNC_VERSION, 
            storageVersion: 1,
            valid: true 
        };
    }
    
    return { version: 'unknown', valid: false };
};

// Migrate v3.5 collections to v4.0 indexed storage
const migrateIncomingSyncData = async (data) => {
    try {
        const detection = detectSyncDataVersion(data);
        
        if (!detection.valid) {
            console.error('❌ Invalid sync data format detected');
            return false;
        }
        
        
        if (detection.version === LEGACY_SYNC_VERSION) {
            
            // Validate tabsArray exists and is an array
            if (!data.tabsArray || !Array.isArray(data.tabsArray)) {
                console.error('❌ Invalid tabsArray in v3.5 sync data:', data.tabsArray);
                return [];
            }
            
            // Ensure all collections have required fields for v4.0
            // BACKWARDS COMPATIBILITY: Fallback to createdOn if lastUpdated is missing
            const normalizedCollections = data.tabsArray.map(collection => {
                const fallbackTimestamp = collection.createdOn || Date.now();
                return {
                    ...collection,
                    uid: collection.uid || ((crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)),
                    name: collection.name || 'Untitled Collection',
                    tabs: collection.tabs || [],
                    createdOn: collection.createdOn || Date.now(),
                    // BACKWARDS COMPATIBILITY: Use createdOn as fallback if lastUpdated is missing
                    lastUpdated: collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : fallbackTimestamp,
                    lastOpened: collection.lastOpened || null, // Default to null for synced collections
                    color: collection.color || 'default',
                    type: 'collection'
                };
            });
            
            // v3.5 didn't have folders, so no need to sync them (they'll be preserved locally)
            const success = await updateAllCollectionsBG(normalizedCollections);
            
            if (success) {
                return normalizedCollections;
            } else {
                console.error('❌ Failed to migrate v3.5 collections to v4.0 storage');
                return false;
            }
        } else if (detection.version === SYNC_VERSION) {
            
            // Validate tabsArray exists and is an array
            if (!data.tabsArray || !Array.isArray(data.tabsArray)) {
                console.error('❌ Invalid tabsArray in v4.0 sync data:', data.tabsArray);
                return [];
            }
            
            // BACKWARDS COMPATIBILITY: Ensure all collections have lastUpdated timestamps
            const normalizedCollections = data.tabsArray.map(collection => {
                const fallbackTimestamp = collection.createdOn || Date.now();
                return {
                    ...collection,
                    // Ensure lastUpdated exists, fallback to createdOn
                    lastUpdated: collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : fallbackTimestamp,
                    lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null
                };
            });
            
            // Update collections
            const collectionsSuccess = await updateAllCollectionsBG(normalizedCollections);
            
            // Update folders if they exist in the sync data
            let foldersSuccess = true;
            if (data.foldersArray && Array.isArray(data.foldersArray) && data.foldersArray.length > 0) {
                
                // BACKWARDS COMPATIBILITY: Ensure all folders have lastUpdated timestamps
                const normalizedFolders = data.foldersArray.map(folder => {
                    const fallbackTimestamp = folder.createdOn || Date.now();
                    return {
                        ...folder,
                        // Ensure lastUpdated exists, fallback to createdOn
                        lastUpdated: folder.lastUpdated !== null && folder.lastUpdated !== undefined ? folder.lastUpdated : fallbackTimestamp
                    };
                });
                
                foldersSuccess = await updateAllFoldersBG(normalizedFolders);
            } else {
            }
            
            if (collectionsSuccess && foldersSuccess) {
                // Ensure storage writes are fully committed
                await new Promise(resolve => setTimeout(resolve, 150));
                return data.tabsArray;
            } else {
                console.error('❌ Failed to update data in indexed storage');
                console.error(`Collections success: ${collectionsSuccess}, Folders success: ${foldersSuccess}`);
                return false;
            }
        } else {
            console.warn(`⚠️ Unknown sync version ${detection.version} - attempting legacy migration`);
            return await migrateIncomingSyncData({ 
                ...data, 
                syncVersion: LEGACY_SYNC_VERSION 
            });
        }
        
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
                collections.push(results[key]);
            }
        });
        
        return collections;
    } catch (error) {
        console.error('Background: Failed to load collections by UIDs:', error);
        return [];
    }
};

// Enhanced data preparation for upload with version info
// BACKWARDS COMPATIBILITY: Incremental sync disabled by default for v3.6 compatibility
// v3.6 cannot understand incremental sync - it treats partial data as the full dataset
// This would cause v3.6 to delete all collections not included in the incremental sync
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
                
                // Mark this as incremental sync data
                const syncData = {
                    timestamp: Date.now(),
                    tabsArray: tabsArray,
                    foldersArray: foldersArray,
                    syncVersion: SYNC_VERSION,
                    storageVersion: 3,
                    extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime) ? 
                        chrome.runtime.getManifest().version : '4.0',
                    isIncrementalSync: true,
                    lastSyncTimestamp: lastSyncTimestamp,
                    changedCollectionCount: tabsArray.length,
                    changedFolderCount: foldersArray.length
                };
                
                if (globalThis.DEBUG_STORAGE) {
                }
                
                return syncData;
            } else {
                // First sync, do full sync
                tabsArray = await loadAllCollectionsBG(true);
                foldersArray = await loadAllFoldersBG();
            }
        } else {
            // Full sync (default for v3.6 backwards compatibility)
            tabsArray = await loadAllCollectionsBG(true);
            foldersArray = await loadAllFoldersBG();
        }
        
        // v4.0 enhanced sync format with version detection and folders support
        const syncData = {
            timestamp: Date.now(),
            tabsArray: tabsArray,
            foldersArray: foldersArray,
            syncVersion: SYNC_VERSION,
            storageVersion: 3,
            extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime) ? 
                chrome.runtime.getManifest().version : '4.0',
            isIncrementalSync: false
        };
        
        // Only log for debug mode
        if (globalThis.DEBUG_STORAGE) {
        }
        return syncData;
        
    } catch (error) {
        console.error('❌ Error preparing sync data:', error);
        // Fallback to legacy format for compatibility
        return {
            timestamp: Date.now(),
            tabsArray: collections || [],
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