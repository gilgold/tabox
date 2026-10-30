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

// Google OAuth token exchanges go through the Tabox Worker (which holds the
// client secret); resolve the base URL from pro-config.js in both the
// classic-script (importScripts) world and Jest/CommonJS.
/* global PRO_API_BASE, OAUTH_CLIENT_ID, OAUTH_SCOPES */
const AUTH_API_BASE = typeof require === 'function'
    ? require('./pro-config').PRO_API_BASE
    : PRO_API_BASE;

// Deferred-loading URL helpers.
// SYNCHRONIZED WITH app/utils/urlUtils.js (deferred URL and tab metadata helpers).
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

// Only actual extension pages carry deferred metadata. A website whose
// path happens to contain the page name must retain its own URL and title.
const readDeferredMetadata = (url) => {
    try {
        const parsed = new URL(url);
        if (!['chrome-extension:', 'moz-extension:'].includes(parsed.protocol) ||
            parsed.pathname !== '/deferedLoading.html') return null;
        let payload;
        try {
            payload = JSON.parse(decodeURIComponent(parsed.hash.slice(1)));
        } catch {
            // Legacy query format (also used if a hash is malformed).
        }
        if (!payload || typeof payload.url !== 'string' || !payload.url) {
            payload = Object.fromEntries(parsed.searchParams.entries());
        }
        return typeof payload.url === 'string' && payload.url ? payload : null;
    } catch {
        return null;
    }
};

const hasDeferredTitle = (title) => typeof title === 'string' && title.trim().length > 0;

// Normalize before throwing away the wrapper: its title is independent of the
// browser's transient title (which may still be the extension page's default).
const normalizeDeferredTab = (tab, savedTabs = []) => {
    let url = tab.pendingUrl && readDeferredMetadata(tab.pendingUrl) ? tab.pendingUrl : tab.url;
    let title;
    let wrapped = false;
    for (let depth = 0; depth < 10; depth++) {
        const payload = readDeferredMetadata(url);
        if (!payload || payload.url === url) break;
        wrapped = true;
        if (!hasDeferredTitle(title) && hasDeferredTitle(payload.title)) title = payload.title;
        url = payload.url;
    }
    if (!wrapped) return { ...tab };

    let hostname;
    try { hostname = new URL(url).hostname; } catch { /* Keep malformed destinations unchanged. */ }
    const isPlaceholder = value => !hasDeferredTitle(value) ||
        value === `${hostname} (click to load)` || value === hostname ||
        value === 'Click to load content' || value === 'Tabox - Loading Content';
    if (!hasDeferredTitle(title) && !isPlaceholder(tab.title)) title = tab.title;
    if (!hasDeferredTitle(title)) {
        const matches = savedTabs.filter(saved => unwrapDeferredUrl(saved.url) === url && !isPlaceholder(saved.title));
        const sameTab = matches.find(saved => tab.id != null && saved.id === tab.id);
        // Same-URL duplicates can have different titles: do not guess between them.
        const saved = sameTab || (new Set(matches.map(saved => saved.title)).size === 1 ? matches[0] : null);
        title = saved?.title;
    }
    return { ...tab, url, title: hasDeferredTitle(title) ? title : (hostname || tab.title) };
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
    fetchServerFileTimestampState
} = syncTransportApi;
const {
    normalizeSyncSnapshot,
    mergeSyncSnapshots,
    syncSnapshotsMatch
} = syncMergeApi;
const {
    applySyncSnapshotAtomically,
    buildIndexedSyncPayload
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

const clearDeletedTombstoneBG = async (key, uid) => {
    const { [key]: stored = {} } = await browser.storage.local.get(key);
    if (Object.prototype.hasOwnProperty.call(stored, uid)) {
        const tombstones = { ...stored };
        delete tombstones[uid];
        await browser.storage.local.set({ [key]: tombstones });
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
                lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
                chromeGroups: collectionToSave.chromeGroups || [],
                // Preserve parentId from existing collection if incoming doesn't have it
                parentId: preservedParentId,
                // Store any other collection properties
                ...collectionToSave,
                lastUpdated
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
        await clearDeletedTombstoneBG(STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES, collectionToSave.uid);
        
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

// Load ONLY loose (top-level) collections, projected to a lightweight summary
// (name + first `maxTitles` tab titles). Used by auto-arrange so a large library
// doesn't pay the cost of reading every collection's full tab array. Falls back to
// a legacy full load + filter when no collections_index exists.
const loadLooseCollectionSummariesBG = async (maxTitles = 5) => {
    const projectSummary = (collection, order) => ({
        uid: collection.uid,
        name: collection.name,
        parentId: collection.parentId ?? null,
        order: collection.order ?? order,
        tabs: (collection.tabs || []).slice(0, maxTitles).map((t) => ({ title: t.title, url: t.url })),
    });
    try {
        const index = await loadCollectionsIndexBG();
        const uids = Object.keys(index);
        if (uids.length === 0) {
            const all = await loadAllCollectionsBG(true);
            return all.filter((c) => !c.parentId).map((c) => projectSummary(c, c.order));
        }
        const looseUids = uids.filter((uid) => !index[uid].parentId);
        if (looseUids.length === 0) return [];
        const keys = looseUids.map((uid) => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
        const results = await browser.storage.local.get(keys);
        return looseUids
            .map((uid) => {
                const rec = results[`${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`];
                if (!rec) return null;
                return projectSummary(normalizeCollectionRecordBG(rec), index[uid].order);
            })
            .filter(Boolean);
    } catch (error) {
        console.error('Background: Failed to load loose collection summaries:', error);
        return [];
    }
};

// Throttled tabsArray mirror sync (prevent excessive updates)
// Keep the local tabsArray mirror available for same-version repair and backup/export flows.
let legacySyncTimeout = null;
const syncLegacyStorageThrottled = async () => {
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

        // Load index first so the shared marker can be preserved in both writes.
        const foldersIndex = await loadFoldersIndexBG();
        // Preserve an existing shared marker when the caller passes a folder
        // without one — a rebuild must never silently unshare the folder
        // (delete guards, AI-task exclusion and sync rematerialize key off it).
        const { [folderKey]: existingRecord } = await browser.storage.local.get(folderKey);
        const sharedMarker = folder.shared?.folderId
            ? folder.shared
            : (existingRecord?.shared?.folderId
                ? existingRecord.shared
                : (foldersIndex[folder.uid]?.shared?.folderId ? foldersIndex[folder.uid].shared : null));

        // Save folder data
        await browser.storage.local.set({
            [folderKey]: {
                uid: folder.uid,
                name: folder.name,
                type: 'folder',
                color: folder.color,
                collapsed: folder.collapsed !== undefined ? folder.collapsed : false,
                createdOn: folder.createdOn || now,
                collectionCount: collectionCount,
                // Store any other folder properties
                ...folder,
                lastUpdated,
                ...(sharedMarker ? { shared: sharedMarker } : {})
            }
        });

        // Update folders index
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
            order: folderOrder, // Include order in index for proper sorting
            ...(sharedMarker ? { shared: sharedMarker } : {})
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
        });
        await clearDeletedTombstoneBG(STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES, folder.uid);
        
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

// Enhanced error handling with retry logic (OPTIMIZED: reduced retries from 5 to 3)
async function handleRequest(url, options = null, maxRetries = 3, delay = 1000, onResponse = null) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                if (onResponse) onResponse(response);
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

// One append at a time: fire-and-forget callers must not overwrite each other.
let syncLogQueue = Promise.resolve();
const redactCredentialUrls = value => {
    if (typeof value === 'string') return value.replace(/https?:\/\/[^\s"'<>]+/g, match => {
        try {
            const url = new URL(match);
            url.username = '';
            url.password = '';
            for (const key of [...url.searchParams.keys()]) {
                if (/token|code|secret|key|authorization/i.test(key)) url.searchParams.set(key, '[redacted]');
            }
            return url.toString();
        } catch { return '[invalid-url]'; }
    });
    if (Array.isArray(value)) return value.map(redactCredentialUrls);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redactCredentialUrls(item)])
    );
    return value;
};

// Enhanced logging for debugging sync issues
function logSyncOperation(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    message = redactCredentialUrls(message);
    data = redactCredentialUrls(data);
    
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
    
    // Return a caught promise so lifecycle-owning callers can drain the queue.
    // A failed append may be lost; subsequent entries must still be writable.
    syncLogQueue = syncLogQueue.then(async () => {
        const { syncLogs } = await browser.storage.local.get('syncLogs');
        await browser.storage.local.set({
            ...(level === 'error' && data.stage === 'remote-validation' ? { lastSyncValidationFailure: { timestamp, stage: data.stage, reason: data.reason } } : {}),
            syncLogs: [logEntry, ...(Array.isArray(syncLogs) ? syncLogs : [])].slice(0, 20)
        });
    }).catch(() => { /* Best-effort diagnostics must not reject a caller or poison the queue. */ });
    return syncLogQueue;
}

// Validate collection data structure (optimized to avoid unnecessary JSON.stringify)
function validateCollectionData(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Data is not an object' };
    }
    
    if (!Array.isArray(data.tabsArray)) {
        return { valid: false, error: 'tabsArray is not an array' };
    }
    
    if (!Number.isFinite(data.timestamp)) {
        return { valid: false, error: 'timestamp is not a number' };
    }
    
    const collectionUids = new Set();
    // Validate each collection (lightweight validation, no JSON.stringify)
    for (let i = 0; i < data.tabsArray.length; i++) {
        const collection = data.tabsArray[i];
        if (!collection || typeof collection.uid !== 'string' || !collection.uid ||
            typeof collection.name !== 'string' || !collection.name || !Array.isArray(collection.tabs) ||
            collection.tabs.some(tab => !tab || typeof tab !== 'object' || Array.isArray(tab)) ||
            collectionUids.has(collection.uid) ||
            (collection.chromeGroups !== undefined && !Array.isArray(collection.chromeGroups)) ||
            (collection.createdOn !== undefined && !Number.isFinite(collection.createdOn)) ||
            (collection.lastUpdated !== undefined && !Number.isFinite(collection.lastUpdated))) {
            return { 
                valid: false, 
                error: `Collection at index ${i} is missing required fields (uid, name, tabs)` 
            };
        }
        collectionUids.add(collection.uid);
    }
    
    // Validate folders if present (optional, since older versions don't have folders)
    if (data.foldersArray !== undefined) {
        if (!Array.isArray(data.foldersArray)) {
            return { valid: false, error: 'foldersArray exists but is not an array' };
        }
        
        // Validate each folder (lightweight validation)
        for (let i = 0; i < data.foldersArray.length; i++) {
            const folder = data.foldersArray[i];
            if (!folder || typeof folder.uid !== 'string' || !folder.uid || typeof folder.name !== 'string' || !folder.name) {
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
async function createPreSyncBackup(label = 'pre-sync', snapshot = null) {
    try {
        const data = snapshot || await prepareSyncDataForUpload(null, false, true);
        let { preSyncBackups = [] } = await browser.storage.local.get('preSyncBackups');
        const latest = preSyncBackups[0];
        if (latest && Array.isArray(latest.foldersArray) && syncSnapshotsMatch(latest, data)) {
            return true;
        }
        const backup = {
            ...data,
            timestamp: Date.now(),
            localTimestamp: data.timestamp,
            collectionCount: data.tabsArray.length,
            folderCount: data.foldersArray.length,
            label
        };
        preSyncBackups = [backup, ...preSyncBackups].slice(0, 2);
        // Keep at least one complete snapshot. Never truncate tabs to fit a quota.
        // If storage rejects the write, the caller must abort the incoming apply.
        while (JSON.stringify(preSyncBackups).length > 2 * 1024 * 1024 && preSyncBackups.length > 1) {
            preSyncBackups.pop();
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
    return logSyncOperation('info', `Released sync lock for: ${operation}`, { duration: lockDuration });
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

// ========================================
// CONTEXT MENU (right click → "Add tab to Tabox Collection")
// ========================================
// The menu is rebuilt from a debounced storage.onChanged listener (see
// handleMenuStorageChanged, registered in background.js). Storage is the
// single choke point every mutation path goes through — popup CRUD, folder
// ops, imports, Drive sync, shared-folder sync, share-link joins — so the
// menu can never drift from what actually exists, unlike the old design that
// relied on each path remembering to send an 'addCollection' message.

// A group only renders in the submenu when at least one tab still references
// it — orphaned groups linger in chromeGroups purely so undo can re-attach
// tabs (same rule as app/utils/groupCount.js countNonEmptyGroups).
const nonEmptyGroupsBG = (collection) => {
    const groups = Array.isArray(collection?.chromeGroups) ? collection.chromeGroups : [];
    if (groups.length === 0) return [];
    const groupUidsWithTabs = new Set(
        (collection.tabs || []).filter((tab) => tab && tab.groupUid).map((tab) => tab.groupUid)
    );
    return groups.filter((group) => group && groupUidsWithTabs.has(group.uid));
};

// Pure model builder: returns the ordered contextMenus.create() params for the
// whole menu. Collections inside a read-only shared folder are excluded —
// the menu is a write surface, and 'read' members must not see them.
const buildContextMenuModel = (collections, folders) => {
    const readOnlyFolderUids = new Set(
        (folders || [])
            .filter((folder) => folder?.shared?.folderId && folder.shared.role === 'read')
            .map((folder) => folder.uid)
    );
    const visible = (collections || []).filter((collection) =>
        collection && !readOnlyFolderUids.has(collection.parentId));
    if (visible.length === 0) return [];

    const model = [{
        title: 'Add tab to Tabox Collection',
        contexts: ['all'],
        id: 'tabox-super',
    }];
    visible.forEach((collection) => {
        const groups = nonEmptyGroupsBG(collection);
        if (groups.length === 0) {
            model.push({
                title: collection.name,
                contexts: ['all'],
                parentId: 'tabox-super',
                id: collection.uid,
            });
            return;
        }
        model.push({
            title: collection.name,
            contexts: ['all'],
            parentId: 'tabox-super',
            id: `${collection.uid}-main`,
        });
        model.push({
            title: 'Add tab to this collection',
            contexts: ['all'],
            parentId: `${collection.uid}-main`,
            id: collection.uid,
        });
        model.push({
            parentId: `${collection.uid}-main`,
            id: `${collection.uid}-seperator`,
            type: 'separator',
        });
        model.push({
            title: 'Add tab to a group inside this collection',
            contexts: ['all'],
            enabled: false,
            parentId: `${collection.uid}-main`,
            id: `${collection.uid}-title`,
        });
        groups.forEach((cg) => {
            model.push({
                title: cg.title || '-',
                contexts: ['all'],
                parentId: `${collection.uid}-main`,
                // Deterministic id carrying both uids so the click handler can
                // route without relying on parentMenuItemId.
                id: `${collection.uid}|${cg.uid}`,
            });
        });
    });
    return model;
};

// Routes a clicked menu item id to its target. Structural ids (the super
// item, submenu parents, separators, the disabled title row) resolve to null.
const resolveContextMenuClick = (menuItemId) => {
    if (typeof menuItemId !== 'string' || menuItemId === 'tabox-super') return null;
    if (menuItemId.endsWith('-main') || menuItemId.endsWith('-title') || menuItemId.endsWith('-seperator')) return null;
    if (menuItemId.includes('|')) {
        const [collectionUid, groupUid] = menuItemId.split('|');
        return { collectionUid, groupUid };
    }
    return { collectionUid: menuItemId, groupUid: null };
};

// Applies a context menu click: appends the tab to the target collection (or
// into the clicked group). Returns { handled, isShared } so background.js can
// decide which sync to nudge. Read-only shared folders are blocked here too
// (defense in depth — their collections shouldn't be in the menu at all).
const handleContextMenuClickBG = async (info, tab) => {
    const target = resolveContextMenuClick(info?.menuItemId);
    if (!target) return { handled: false };
    const collection = await loadSingleCollectionBG(target.collectionUid);
    if (!collection) return { handled: false };

    const parentFolder = collection.parentId ? await loadSingleFolderBG(collection.parentId) : null;
    const isShared = Boolean(parentFolder?.shared?.folderId);
    if (parentFolder?.shared?.role === 'read') return { handled: false };

    const tabToAdd = { ...tab };
    collection.tabs = Array.isArray(collection.tabs) ? collection.tabs : [];
    if (target.groupUid) {
        const group = (collection.chromeGroups || []).find((cg) => cg.uid === target.groupUid);
        if (!group) return { handled: false };
        tabToAdd.groupId = group.id;
        tabToAdd.groupUid = group.uid;
        const indexInTabs = collection.tabs.findIndex((t) => t.groupUid === group.uid);
        if (indexInTabs === -1) {
            collection.tabs.push(tabToAdd);
        } else {
            collection.tabs.splice(indexInTabs, 0, tabToAdd);
        }
    } else {
        collection.tabs.push(tabToAdd);
    }

    const saved = await saveSingleCollectionBG(collection, true);
    return { handled: saved === true, isShared };
};

// Debounced rebuild. A fingerprint of the last-applied model skips redundant
// removeAll/create cycles (auto-updated collections churn storage on every
// tab event without changing the menu).
const CONTEXT_MENU_DEBOUNCE_MS = 1500;
let contextMenuTimeout = null;
let lastContextMenuFingerprint = null;

const rebuildContextMenuNow = async () => {
    if (!browser.contextMenus) return; // Firefox for Android has no context menus
    const [tabsArray, foldersArray] = await Promise.all([
        loadAllCollectionsBG(true),
        loadAllFoldersBG(),
    ]);
    const model = buildContextMenuModel(tabsArray, foldersArray);
    const fingerprint = JSON.stringify(model);
    if (fingerprint === lastContextMenuFingerprint) return;
    await browser.contextMenus.removeAll();
    model.forEach((item) => browser.contextMenus.create(item));
    lastContextMenuFingerprint = fingerprint;
    // Debug/e2e observability: what the menu was last built from.
    if (typeof globalThis !== 'undefined') {
        globalThis.__taboxContextMenu = {
            rebuilds: (globalThis.__taboxContextMenu?.rebuilds || 0) + 1,
            model,
        };
    }
};

const handleContextMenuCreation = async () => {
    if (contextMenuTimeout) {
        clearTimeout(contextMenuTimeout);
    }
    contextMenuTimeout = setTimeout(async () => {
        contextMenuTimeout = null;
        try {
            await rebuildContextMenuNow();
        } catch (error) {
            console.error('Context menu rebuild failed:', error);
        }
    }, CONTEXT_MENU_DEBOUNCE_MS);
};

// storage.onChanged listener: any write touching collections/folders (index
// or individual records) schedules a rebuild. Note the '_' in the prefixes —
// unrelated keys like 'collectionsToTrack' must not match.
const handleMenuStorageChanged = (changes, areaName) => {
    if (areaName !== 'local') return;
    const relevant = Object.keys(changes).some((key) =>
        key === STORAGE_KEYS.COLLECTIONS_INDEX ||
        key === STORAGE_KEYS.FOLDERS_INDEX ||
        key.startsWith(STORAGE_KEYS.COLLECTION_PREFIX) ||
        key.startsWith(STORAGE_KEYS.FOLDER_PREFIX));
    if (relevant) {
        handleContextMenuCreation();
    }
};

async function applyChromeGroupSettings(windowId, collection) {
    const result = { groupsRestored: 0, groupsFailed: 0 };
    if (!collection.chromeGroups || !browser.tabs.group || !browser.tabGroups) {
        return result;
    }
    // Reuse groups already in the target window instead of minting an identical
    // one on every open (issue #94 — Chrome additionally saves each created group
    // to its Tab Groups menu, so duplicates piled up there). "Same group" matches
    // the app's own duplicate-group definition: identical title AND color.
    let existingGroups = [];
    try {
        existingGroups = await browser.tabGroups.query({ windowId });
    } catch {
        existingGroups = [];
    }
    for (const chromeGroup of collection.chromeGroups) {
        // Match by the stable groupUid (what the UI groups by) — the numeric
        // Chrome-session groupId drifts across sync/merge/import, so relying on
        // it silently restored every tab flat. Legacy tabs/groups that predate
        // groupUid fall back to the numeric id.
        const tabsToGroup = collection.tabs
            .filter((tab) => (tab.groupUid && chromeGroup.uid)
                ? tab.groupUid === chromeGroup.uid
                : tab.groupId === chromeGroup.id)
            .map((t) => t.newTabId)
            .filter((id) => id !== undefined && id !== null);
        if (tabsToGroup.length === 0) {
            continue; // e.g. all of this group's tabs were dedupe-skipped
        }
        const updateProperties = {
            collapsed: chromeGroup.collapsed,
            color: chromeGroup.color,
            title: chromeGroup.title
        };
        try {
            const match = existingGroups.find((g) => g.title === chromeGroup.title && g.color === chromeGroup.color);
            if (match) {
                await browser.tabs.group({ groupId: match.id, tabIds: tabsToGroup });
                await browser.tabGroups.update(match.id, updateProperties);
            } else {
                const groupId = await browser.tabs.group({
                    createProperties: { windowId: windowId },
                    tabIds: tabsToGroup
                });
                await browser.tabGroups.update(groupId, updateProperties);
                existingGroups.push({ id: groupId, ...updateProperties });
            }
            result.groupsRestored++;
        } catch (e) {
            result.groupsFailed++;
            console.error('Failed to apply group settings for group', chromeGroup.title, e);
        }
    }
    return result;
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

    // Capture the prior collapsed state of the existing groups we're about to
    // add tabs to (and collapse), so undo can restore exactly how the user had
    // them. New groups are removed on undo, so they need no record.
    const groupCollapsedBefore = {};
    const additionGroupIds = [...new Set(plan.additions.map((a) => a.groupId))];
    if (additionGroupIds.length && browser.tabGroups) {
        try {
            const existing = await browser.tabGroups.query({ windowId });
            for (const group of existing) {
                if (additionGroupIds.includes(group.id)) {
                    groupCollapsedBefore[group.id] = group.collapsed === true;
                }
            }
        } catch (e) {
            console.error('Smart Organize: failed to read existing group state', e);
        }
    }

    await browser.storage.local.set({
        [SMART_ORGANIZE_UNDO_KEY]: {
            windowId,
            createdAt: createdAt || Date.now(),
            orderedTabIds,
            affectedTabIds,
            groupCollapsedBefore,
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
            // Keep the organized window tidy: collapse the group we added to.
            // A collapse failure must not negate the successful grouping above.
            await browser.tabGroups.update(add.groupId, { collapsed: true });
        } catch (e) {
            console.error('Smart Organize: addition failed for group', add.groupId, e);
        }
    }

    for (const g of plan.newGroups) {
        if (!g.tabIds.length) continue;
        try {
            const groupId = await browser.tabs.group({ createProperties: { windowId }, tabIds: g.tabIds });
            // New groups are created expanded by default — collapse them so the
            // organized window reads as tidy rather than a wall of open groups.
            await browser.tabGroups.update(groupId, { title: g.name, color: g.color, collapsed: true });
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

    // Restore the prior collapsed state of existing groups we collapsed on apply.
    const collapsedBefore = snap.groupCollapsedBefore || {};
    if (Object.keys(collapsedBefore).length && browser.tabGroups) {
        for (const [groupId, wasCollapsed] of Object.entries(collapsedBefore)) {
            try {
                await browser.tabGroups.update(Number(groupId), { collapsed: wasCollapsed });
            } catch {
                // Group may no longer exist (e.g. all its tabs were closed); skip.
            }
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

async function readWindowForAI(windowId) {
    const fullPageUrl = browser.runtime.getURL('fullpage.html');
    const allTabs = await browser.tabs.query({ windowId });
    const eligible = allTabs.filter((t) => !t.pinned && t.url !== fullPageUrl);
    const ungroupedTabs = eligible.filter((t) => t.groupId === -1).map((t) => ({ tabId: t.id, title: t.title, url: t.url }));
    let groups = [];
    try { groups = await browser.tabGroups.query({ windowId }); } catch (e) { groups = []; }
    const existingGroups = groups.map((g) => ({ id: g.id, title: g.title,
        sampleTitles: allTabs.filter((t) => t.groupId === g.id).slice(0, 3).map((t) => t.title) }));
    return { ungroupedTabs, existingGroups, eligibleCount: ungroupedTabs.length };
}

async function getNewAccessToken() {
    try {
        const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');

        if (!googleRefreshToken) {
            logSyncOperation('error', 'No refresh token available, user needs to re-authenticate');
            return false;
        }

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: googleRefreshToken,
            })
        }

        logSyncOperation('info', 'Requesting new access token with refresh token');

        // The exchange runs on the Tabox Worker, which holds the OAuth client
        // secret. Use direct fetch instead of handleRequest to avoid
        // unnecessary retries.
        const tokenResponse = await fetch(`${AUTH_API_BASE}/auth/token`, options);
        
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
            
            // Any previously stored auth error is now stale since we just obtained a
            // valid token — clear it so the UI doesn't stay stuck on "auth required".
            await browser.storage.local.remove('syncAuthError');

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
        // Fetch never reached Google (offline, sleep/wake, SW woke before network).
        // Not an auth failure — let the caller decide whether the cached token is still usable.
        logSyncOperation('info', 'Token validation skipped - network unavailable', { error: error.message });
        return 'network_error';
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

    if (isValid === true) {
        return googleToken;
    }

    // Network-level validation failure with a token that isn't expired per stored
    // expiry: keep using it — a refresh attempt would hit the same dead network.
    if (isValid === 'network_error' && tokenExpiryTime && now < tokenExpiryTime) {
        return googleToken;
    }

    return await getNewAccessToken();
}

// AI requests are authenticated again by the Tabox Worker before inference.
// When the extension already has a token with trustworthy expiry metadata,
// avoid a redundant Google tokeninfo round-trip here. Missing/expiring tokens
// still use the normal refresh/validation path.
async function getAuthTokenForAI() {
    const { googleToken, tokenExpiryTime } = await browser.storage.local.get(['googleToken', 'tokenExpiryTime']);
    const refreshCutoff = Date.now() + (5 * 60 * 1000);
    if (googleToken && tokenExpiryTime && tokenExpiryTime > refreshCutoff) {
        return googleToken;
    }
    return await getAuthToken();
}

async function getGoogleUser(token) {
    const { googleUser } = await browser.storage.local.get('googleUser');
    if (googleUser) return googleUser;
    const init = {
        method: 'GET',
        async: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
        'contentType': 'json'
    };
    // The OAuth Bearer token authorizes the request on its own — no separate
    // Drive API key is needed (or bundled) anymore.
    const response = await handleRequest(
        'https://www.googleapis.com/drive/v3/about?alt=json&fields=user&prettyPrint=false',
        init)
    if (response) {
        await browser.storage.local.set({ googleUser: response.user });
        return response.user;
    }
    return false;
}

async function getOrCreateSyncFile(token, { rediscover = false } = {}) {
    const { syncFileId } = await browser.storage.sync.get('syncFileId');
    console.log('🔑 getOrCreateSyncFile: Current syncFileId from storage.sync:', syncFileId || 'NOT FOUND');
    
    if (syncFileId && !rediscover) {
        console.log('🔑 getOrCreateSyncFile: Using existing syncFileId from storage.sync');
        return;
    }
    
    console.log('🔑 getOrCreateSyncFile: Searching Google Drive for appSettings.json');
    const url = "https://www.googleapis.com/drive/v3/files/?corpora=user&spaces=appDataFolder&fields=files(id)&q=name='appSettings.json'&pageSize=1&orderBy=modifiedByMeTime desc";
    const response = await handleRequest(url, {
        mode: 'cors',
        credentials: 'omit',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    if (response) {
        if (response.files.length === 0) {
            console.log('🔑 getOrCreateSyncFile: No existing file found, creating new sync file');
            return Boolean(await _createNewSyncFile(token));
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

async function uploadPreparedSyncData(token, dataToSync, syncContext = null) {
    await getOrCreateSyncFile(token);
    const { syncFileId } = await browser.storage.sync.get('syncFileId');

    if (!syncFileId) {
        logSyncOperation('error', 'No sync file ID available for remote update');
        return false;
    }
    if (syncContext && syncContext.fileId !== syncFileId) return false;

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
    if (syncContext?.etag && !syncContext.etag.startsWith('W/')) {
        init.headers['If-Match'] = syncContext.etag;
    }

    logSyncOperation('info', 'Syncing data to cloud', {
        collections: dataToSync.tabsArray.length,
        folders: dataToSync.foldersArray?.length || 0,
        version: dataToSync.syncVersion || SYNC_VERSION
    });

    const url = `https://www.googleapis.com/upload/drive/v3/files/${syncFileId}?uploadType=media`;
    // A failed conditional/upload request must re-read and merge before retrying;
    // replaying the same PATCH could overwrite changes made by another device.
    const response = await handleRequest(url, init, syncContext ? 0 : 3);

    if (response !== false) {
        if (syncContext) {
            const latest = await prepareSyncDataForUpload(null, false, true);
            const currentFile = await browser.storage.sync.get('syncFileId');
            if (currentFile.syncFileId !== syncFileId || !syncSnapshotsMatch(latest, dataToSync)) {
                logSyncOperation('info', 'Local data changed during upload; a fresh sync is required');
                return false;
            }
        }
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
        // This prevents new/empty devices from accidentally wiping existing collections.
        // Folders are Drive data too (foldersArray) - a payload with folders but no
        // collections is a legitimate push, not an empty one.
        const localCollectionCount = dataToSync.tabsArray ? dataToSync.tabsArray.length : 0;
        const localFolderCount = dataToSync.foldersArray ? dataToSync.foldersArray.length : 0;
        if (localCollectionCount === 0 && localFolderCount === 0) {
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
            await releaseSyncLock(operation);
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
        
        logSyncOperation('info', 'Loading sync file from server', { stage: 'remote-read' });
        let etag;
        const data = await handleRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, init, 3, 1000, response => {
            etag = response.headers?.get?.('etag');
        });
        
        const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        const isEnvelope = data !== null && typeof data === 'object' && !Array.isArray(data);
        logSyncOperation('info', 'Raw server response received', {
            stage: 'remote-read',
            topLevelType: typeOf(data),
            topLevelKeyCount: isEnvelope ? Object.keys(data).length : 0,
            tabsArrayPresent: isEnvelope && Object.prototype.hasOwnProperty.call(data, 'tabsArray'),
            tabsArrayType: typeOf(data?.tabsArray),
            tabsArrayIsArray: Array.isArray(data?.tabsArray),
            collectionsCount: Array.isArray(data?.tabsArray) ? data.tabsArray.length : null,
            foldersArrayPresent: isEnvelope && Object.prototype.hasOwnProperty.call(data, 'foldersArray'),
            foldersArrayType: typeOf(data?.foldersArray),
            foldersArrayIsArray: Array.isArray(data?.foldersArray),
            foldersCount: Array.isArray(data?.foldersArray) ? data.foldersArray.length : null,
            syncVersionPresent: isEnvelope && Object.prototype.hasOwnProperty.call(data, 'syncVersion'),
            syncVersionType: typeOf(data?.syncVersion)
        });

        if (data === false) {
            await logSyncOperation('error', 'Failed to load sync file from server', { stage: 'remote-read', reason: 'transport-failed' });
            return false;
        }
        
        const normalizedData = await decodeIncomingSyncData(data);
        if (normalizedData === false) {
            await logSyncOperation('error', 'Loaded data failed validation', {
                stage: 'remote-validation',
                reason: validateCollectionData(data).valid ? 'unsupported-version' : 'invalid-structure'
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

        const snapshot = normalizedData;
        Object.defineProperty(snapshot, 'etag', { value: etag });
        return snapshot;
        
    } catch (error) {
        await logSyncOperation('error', 'Exception in _loadSettingsFile', { stage: 'remote-read', reason: 'read-failed' });
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

    return remoteSyncData[LEGACY_SYNC_ENVELOPE]
        ? migratedCollections
        : updateCollectionsUids(migratedCollections);
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
            
            if (!force) {
                const synced = await reconcileRemoteSyncData(token, syncFileId);
                return synced ? await loadAllCollectionsBG(true) : false;
            }
            if (!await createPreSyncBackup('before-forced-server-update')) return false;
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
            await releaseSyncLock(operation);
        }
    }
}

// Firefox's identity.getRedirectURL() returns a per-profile
// https://<uuid>.extensions.allizom.org/ URL that cannot be pre-registered
// with Google, unlike Chrome's stable *.chromiumapp.org redirect. So on
// Firefox the flow enters through the Tabox Worker's /auth/start (see
// createAuthEndpoint below and server/src/authStart.js), Google gets the
// fixed, registered /auth/callback redirect, and the real per-profile
// redirect rides in `state`; the Worker's callback 302s back to it with the
// code (see docs/superpowers/plans/2026-08-06-firefox-port-phase2-oauth.md).
// Branches ONLY on the getRedirectURL() value (capability/value detection),
// never on user agent.
const CHROMIUMAPP_REDIRECT_SUFFIX = '.chromiumapp.org';

// Firefox for Android has no identity API at all, so there is no
// launchWebAuthFlow to intercept the redirect. There the flow runs in an
// ordinary tab (startTabAuthFlow + background.js handleTabAuthUpdated) and targets the Worker's own /auth/done page,
// which /auth/callback 302s to with the result in the URL fragment.
const AUTH_TAB_FLOW_TIMEOUT_MS = 10 * 60 * 1000;

function hasIdentityFlow() {
    return typeof browser.identity?.getRedirectURL === 'function';
}

function getAuthRedirectConfig() {
    if (!hasIdentityFlow()) {
        const workerCallback = `${AUTH_API_BASE}/auth/callback`;
        return { authRedirect: workerCallback, exchangeRedirect: workerCallback, viaWorker: true, tabFlow: true, target: `${AUTH_API_BASE}/auth/done` };
    }
    const dynamicRedirect = browser.identity.getRedirectURL();
    let hostname = '';
    try {
        hostname = new URL(dynamicRedirect).hostname;
    } catch (error) {
        hostname = '';
    }
    if (hostname.endsWith(CHROMIUMAPP_REDIRECT_SUFFIX)) {
        return { authRedirect: dynamicRedirect, exchangeRedirect: dynamicRedirect, viaWorker: false };
    }
    const workerCallback = `${AUTH_API_BASE}/auth/callback`;
    return { authRedirect: workerCallback, exchangeRedirect: workerCallback, viaWorker: true, target: dynamicRedirect };
}

// Tab-based sign-in (Firefox for Android). The event page can be suspended
// while the user is on Google's pages, so nothing here waits in memory: the
// attempt is persisted under TAB_AUTH_PENDING_KEY and background.js's
// top-level tabs.onUpdated listener (which wakes the page) finishes it when
// the tab reaches the Worker's /auth/done.
const TAB_AUTH_PENDING_KEY = 'tabAuthPending';

async function startTabAuthFlow(authUrl, nonce, { thenCheckout = false } = {}) {
    let returnTabId = null;
    try {
        const [active] = await browser.tabs.query({ active: true });
        returnTabId = active?.id ?? null;
    } catch {
        // No tab to return to — fine.
    }
    const pending = { nonce, tabId: null, returnTabId, thenCheckout, startedAt: Date.now() };
    await browser.storage.local.set({ [TAB_AUTH_PENDING_KEY]: pending });
    const tab = await browser.tabs.create({ url: authUrl, active: true });
    await browser.storage.local.set({ [TAB_AUTH_PENDING_KEY]: { ...pending, tabId: tab.id } });
    return tab.id;
}

// Validates the /auth/done fragment against the pending attempt and returns
// the auth code; throws (without exchanging anything) on a stale attempt,
// nonce mismatch, or a declined consent.
function readTabAuthCode(url, pending) {
    if (!pending || Date.now() - pending.startedAt > AUTH_TAB_FLOW_TIMEOUT_MS) {
        throw new Error('Sign-in attempt expired');
    }
    const params = Object.fromEntries(new URLSearchParams(new URL(url).hash.slice(1)).entries());
    if (!params.state) throw new Error('Missing OAuth state from Worker callback');
    const state = base64UrlDecodeJson(params.state);
    if (!state || state.n !== pending.nonce) throw new Error('OAuth state nonce mismatch');
    if (params.error || !params.code) throw new Error(`OAuth callback error: ${params.error || 'missing code'}`);
    return params.code;
}

// base64url (no padding) encode/decode of a UTF-8 JSON payload — MUST match
// the Worker's b64uDecode exactly (server/src/authCallback.js, read-only from
// the client side): standard base64 with '+'/'/' swapped for '-'/'_' and '='
// padding stripped.
// btoa/atob only handle byte strings (char codes 0-255), so UTF-8 bytes are
// packed into/out of a binary string via the classic encodeURIComponent/
// escape roundtrip rather than TextEncoder/TextDecoder — the latter aren't
// available in every environment this code runs under (e.g. this project's
// jsdom-based Jest tests), while btoa/atob are universal (SW, browser, jsdom).
function base64UrlEncodeJson(obj) {
    const json = JSON.stringify(obj);
    const binary = unescape(encodeURIComponent(json));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeJson(str) {
    const padded = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const json = decodeURIComponent(escape(binary));
    return JSON.parse(json);
}

async function getTokens(code) {
    const { exchangeRedirect } = getAuthRedirectConfig();
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: exchangeRedirect,
        })
    }
    // The code→token exchange runs on the Tabox Worker, which holds the OAuth
    // client secret — the extension bundle no longer ships any credentials.
    // Direct fetch, no retries: authorization codes are single-use, so a
    // rejected exchange can never succeed on retry.
    try {
        const response = await fetch(`${AUTH_API_BASE}/auth/token`, options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Login token exchange failed:', response.status, errorData.error || '');
            return false;
        }
        const data = await response.json();
        if (data && data.access_token) {
            await browser.storage.local.set({ googleToken: data.access_token, googleRefreshToken: data.refresh_token });
            return data.access_token;
        }
        return false;
    } catch (error) {
        console.error('Login token exchange failed with network error:', error);
        return false;
    }
}

function createAuthEndpoint(nonce) {
    const { authRedirect, viaWorker, target } = getAuthRedirectConfig();
    // OAuth client config lives in pro-config.js (loaded before this file in
    // both the Chrome SW importScripts order and the Firefox manifest
    // background.scripts order) — NOT in the manifest: Firefox has no oauth2 key.
    const authParamsInit = {
        client_id: OAUTH_CLIENT_ID,
        response_type: 'code',
        access_type: 'offline',
        redirect_uri: authRedirect,
        prompt: 'consent',
        scope: 'openid ' + OAUTH_SCOPES.join(' '),
    };
    // Chrome/Edge (*.chromiumapp.org, pre-registered with Google): EXACT
    // current behavior, byte-identical auth URL — no `state` param, same
    // param order (tests/oauthConfig.test.js pins this).
    if (!viaWorker) {
        const authParams = new URLSearchParams(authParamsInit);
        return `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;
    }
    // Firefox (and any other non-chromiumapp redirect): Firefox's
    // launchWebAuthFlow validates the `redirect_uri` query param of the URL
    // it is given against identity.getRedirectURL() and rejects everything
    // else with "redirect_uri not allowed" BEFORE opening any window — so
    // Google's auth endpoint (which needs the registered Worker callback as
    // redirect_uri) can't be passed to it directly. Instead the flow starts
    // at the Worker's /auth/start with redirect_uri = the per-profile
    // allizom URL (satisfying Firefox's validator); the Worker 302s to
    // Google with its registered /auth/callback, which later 302s back to
    // the allizom target packed into `state` — the navigation
    // launchWebAuthFlow intercepts. The per-attempt CSRF nonce also rides
    // in `state`; the client verifies `n` before trusting the returned code.
    const authParams = new URLSearchParams({
        redirect_uri: target,
        state: base64UrlEncodeJson({ t: target, n: nonce }),
    });
    return `${AUTH_API_BASE}/auth/start?${authParams.toString()}`;
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
            const normalizedTab = normalizeDeferredTab(t, collection.tabs);
            // Store incognito status per tab for reference
            return {
                ...normalizedTab,
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

// The snapshot timestamp decides neither ownership nor deletion. Offline edits
// can coexist with remote edits regardless of how long a device was disconnected.
async function reconcileRemoteSyncData(token, fileId) {
    const remote = await _readRemoteSyncDocument(token, fileId);
    if (remote === false) return false;
    const local = await prepareSyncDataForUpload(null, false, true);
    // Reuse the apply layer's shared-UID protection before deciding what to upload.
    // A legacy Drive copy must not overwrite or re-export live shared data.
    const projectedRemote = buildIndexedSyncPayload({ currentStorage: local.localStorageSnapshot, syncData: remote });
    const remoteForMerge = {
        ...remote,
        ...await excludeSharedFromSyncData({
            tabsArray: projectedRemote.collections,
            foldersArray: projectedRemote.folders,
            deletedCollections: Object.entries(projectedRemote.setPayload[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES])
                .map(([uid, lastUpdated]) => ({ uid, lastUpdated })),
            deletedFolders: Object.entries(projectedRemote.setPayload[STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES])
                .map(([uid, lastUpdated]) => ({ uid, lastUpdated }))
        }, true)
    };
    const merged = mergeSyncSnapshots({
        localSnapshot: local,
        remoteSnapshot: remoteForMerge,
        disableImplicitLocalDeletions: true
    });
    // Apply the shared-folder exclusion to the final payload too, including data
    // originating from a legacy remote. Shared data never belongs on Drive.
    Object.assign(merged, await excludeSharedFromSyncData(merged, true));
    const needsApply = local.hasTimestampRepairs || !syncSnapshotsMatch(local, merged);
    const needsUpload = !syncSnapshotsMatch(remote, merged);
    logSyncOperation('info', 'Reconciled sync snapshots', {
        localCollections: local.tabsArray.length,
        remoteCollections: remote.tabsArray.length,
        mergedCollections: merged.tabsArray.length,
        needsApply,
        needsUpload
    });

    if ((needsApply || needsUpload) && !await createPreSyncBackup('before-reconciliation', local)) return false;

    let etag = remote.etag;
    if (needsUpload) {
        const latestRemote = await _readRemoteSyncDocument(token, fileId);
        if (latestRemote === false || !syncSnapshotsMatch(remote, latestRemote)) {
            logSyncOperation('info', 'Remote changed during reconciliation; retry with a fresh snapshot');
            return false;
        }
        etag = latestRemote.etag;
    }
    const latestLocal = await prepareSyncDataForUpload(null, false, true);
    if (!syncSnapshotsMatch(local, latestLocal)) {
        logSyncOperation('info', 'Local changed during reconciliation; retry with a fresh snapshot');
        return false;
    }
    if (needsApply && await migrateIncomingSyncData(merged, latestLocal.localStorageSnapshot) === false) return false;

    if (needsUpload) {
        merged.timestamp = Math.max(Date.now(), local.timestamp, remote.timestamp) + 1;
        return await uploadPreparedSyncData(token, merged, { fileId, etag }) !== false;
    }
    // Download-only and no-op syncs adopt the remote timestamp rather than
    // publishing a new one. This makes repeated two-device syncs converge.
    const finalLocal = await prepareSyncDataForUpload(null, false, true);
    const currentFile = await browser.storage.sync.get('syncFileId');
    if (currentFile.syncFileId !== fileId || !syncSnapshotsMatch(finalLocal, merged)) return false;
    await browser.storage.local.set({ localTimestamp: remote.timestamp, lastSyncTimestamp: remote.timestamp });
    await markSuccessfulSyncCompletion();
    return true;
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

        // Equal envelope timestamps are not proof of equal contents: offline edits
        // and earlier restores can have stale timestamps. Compare entities below.
        return await reconcileRemoteSyncData(token, syncFileId);

    } catch (error) {
        logSyncOperation('error', 'Exception in syncData', { error: error.message });
        return false;
    } finally {
        await releaseSyncLock(operation);
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
        
        
        // Full recovery copies must remain restorable regardless of their size.
        // Retention/size trimming happens when a new complete backup is saved.

        // Clean up oversized autoBackups
        if (autoBackupSize > 1.5 * 1024 * 1024) { // > 1.5MB
            const cleanedAutoBackups = autoBackups.slice(0, 2); // Keep only 2 most recent
            await browser.storage.local.set({ autoBackups: cleanedAutoBackups });
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

    // Only the emitted 4.0 contract is supported, never parseFloat prefixes or
    // speculative future versions. 3.6 wrote exactly {timestamp, tabsArray}.
    const legacy = !Object.prototype.hasOwnProperty.call(data, 'syncVersion') &&
        Object.keys(data).every(key => key === 'timestamp' || key === 'tabsArray');
    const current = data.syncVersion === '4.0' || data.syncVersion === 4;
    if ((legacy || current) && validateCollectionData(data).valid) {
        return { version: legacy ? '3.6-envelope' : data.syncVersion, legacy, valid: true };
    }
    return { version: 'unknown', valid: false };
};

// Internal provenance survives the reader -> direct-load path without accepting
// a customer-supplied marker. Reconciliation already merges all snapshots.
const LEGACY_SYNC_ENVELOPE = Symbol('legacy-sync-envelope');
const decodeIncomingSyncData = async (data) => {
    const detection = detectSyncDataVersion(data);
    if (!detection.valid) return false;
    const snapshot = normalizeSyncSnapshot({
        ...data,
        syncVersion: SYNC_VERSION,
        // Historical collections have no modification clock. A later envelope
        // save does not prove each collection changed. Keep the known creation
        // baseline (or 0 = unknown) so unrelated saves cannot defeat known local
        // edits/tombstones. Never promote every entity to the envelope/now time.
        tabsArray: detection.legacy ? data.tabsArray.map(collection => ({
            ...collection,
            lastUpdated: Number.isFinite(collection.lastUpdated)
                ? collection.lastUpdated
                : Number.isFinite(collection.createdOn) ? collection.createdOn : 0
        })) : data.tabsArray,
        foldersArray: data.foldersArray === undefined ? await loadAllFoldersBG() : data.foldersArray
    }, data.timestamp);
    if (detection.legacy || data[LEGACY_SYNC_ENVELOPE]) {
        Object.defineProperty(snapshot, LEGACY_SYNC_ENVELOPE, { value: true });
    }
    return snapshot;
};

const migrateIncomingSyncData = async (data, expectedStorage) => {
    try {
        let normalizedSyncData = await decodeIncomingSyncData(data);
        if (normalizedSyncData === false) return false;
        if (normalizedSyncData[LEGACY_SYNC_ENVELOPE]) {
            // A historical document cannot describe deletions or folders. Even a
            // direct/forced load must preserve independent local edits and sets.
            const local = await prepareSyncDataForUpload(null, false, true);
            normalizedSyncData = mergeSyncSnapshots({
                localSnapshot: local,
                remoteSnapshot: normalizedSyncData,
                disableImplicitLocalDeletions: true
            });
            if (!await createPreSyncBackup('before-legacy-migration', local)) return false;
            expectedStorage = expectedStorage || local.localStorageSnapshot;
        }

        logSyncOperation('info', 'Applying normalized 4.0 sync data', {
            collections: normalizedSyncData.tabsArray.length,
            folders: normalizedSyncData.foldersArray.length
        });

        const applyResult = await applySyncSnapshotAtomically({
            storageArea: browser.storage.local,
            syncData: normalizedSyncData,
            expectedStorage
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

// Task 9: shared folders/collections (Task 8) are owned by the Cloudflare Worker, never
// by Google Drive. This is the single chokepoint every upload path funnels through
// (full-sync, incremental, and _createNewSyncFile all call prepareSyncDataForUpload), so
// filtering here guarantees shared data can never leave in a sync payload. Lazily
// required (not at module top-level) because chrome/shared-folders.js requires this very
// module back (for getAuthToken) - a top-level require here would create a load-order
// cycle both in the classic-script (importScripts) world and in Jest/CommonJS.
const excludeSharedFromSyncData = async ({ tabsArray = [], foldersArray = [], deletedCollections = [], deletedFolders = [] }, strict = false) => {
    /* istanbul ignore next */
    const sharedFoldersHelpers = typeof require === 'function'
        ? require('./shared-folders.js')
        : globalThis.TaboxSharedFolders;
    const partitionSharedUids = sharedFoldersHelpers && sharedFoldersHelpers.partitionSharedUids;
    if (typeof partitionSharedUids !== 'function') {
        if (strict) throw new Error('Shared-data exclusion unavailable; sync aborted');
        return { tabsArray, foldersArray, deletedCollections, deletedFolders };
    }

    const { sharedFolderUids, sharedCollectionUids } = partitionSharedUids(foldersArray, tabsArray);
    const { shared_sync_state: sharedSyncState = {} } = await browser.storage.local.get('shared_sync_state');
    const everSharedUids = new Set(Object.values(sharedSyncState).flatMap((state) => state.knownUids || []));

    return {
        tabsArray: tabsArray.filter((collection) => !sharedCollectionUids.has(collection.uid)),
        foldersArray: foldersArray.filter((folder) => !sharedFolderUids.has(folder.uid)),
        deletedCollections: deletedCollections.filter((tombstone) =>
            !sharedCollectionUids.has(tombstone.uid) && !everSharedUids.has(tombstone.uid)),
        deletedFolders: deletedFolders.filter((tombstone) =>
            !sharedFolderUids.has(tombstone.uid) && !(tombstone.uid in sharedSyncState)),
    };
};

// Enhanced data preparation for upload with version info.
// Sync still emits full 4.0 snapshots by default; incremental sync remains off until the
// wire contract is upgraded end-to-end for partial updates.
const prepareSyncDataForUpload = async (collections, useIncrementalSync = false, strict = false) => {
    try {
        let tabsArray;
        let foldersArray;
        let storageSnapshot;

        if (strict) {
            storageSnapshot = await browser.storage.local.get(null);
            const readIndexed = (indexKey, prefix, legacy = []) => {
                const index = storageSnapshot[indexKey];
                if (index === undefined) return legacy;
                if (!index || typeof index !== 'object' || Array.isArray(index)) {
                    throw new Error(`Invalid ${indexKey}; sync aborted`);
                }
                return Object.keys(index).map(uid => {
                    const item = storageSnapshot[`${prefix}${uid}`];
                    if (!item || item.uid !== uid || (prefix === STORAGE_KEYS.COLLECTION_PREFIX && !Array.isArray(item.tabs))) {
                        throw new Error(`Incomplete ${indexKey}; sync aborted`);
                    }
                    // Older saves stamped the index but then overwrote the record's
                    // timestamp with the incoming stale value. The index retains
                    // evidence of that real local edit; never replace it with now.
                    const indexedTimestamp = index[uid]?.lastUpdated;
                    const needsTimestampRepair = Number.isFinite(indexedTimestamp)
                        && indexedTimestamp > (item.lastUpdated ?? item.createdOn ?? 0);
                    return {
                        ...item,
                        order: item.order ?? index[uid]?.order,
                        ...(needsTimestampRepair ? { lastUpdated: indexedTimestamp } : {})
                    };
                });
            };
            tabsArray = readIndexed(STORAGE_KEYS.COLLECTIONS_INDEX, STORAGE_KEYS.COLLECTION_PREFIX, storageSnapshot.tabsArray || []);
            foldersArray = readIndexed(STORAGE_KEYS.FOLDERS_INDEX, STORAGE_KEYS.FOLDER_PREFIX);
        } else if (collections) {
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
                const filteredIncremental = await excludeSharedFromSyncData({
                    tabsArray: normalizedTabsArray,
                    foldersArray
                });

                // Mark this as incremental sync data
                const syncData = {
                    timestamp: Date.now(),
                    tabsArray: filteredIncremental.tabsArray,
                    foldersArray: filteredIncremental.foldersArray,
                    syncVersion: SYNC_VERSION,
                    storageVersion: 3,
                    extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime) ?
                        chrome.runtime.getManifest().version : '4.0',
                    isIncrementalSync: true,
                    lastSyncTimestamp: lastSyncTimestamp,
                    changedCollectionCount: filteredIncremental.tabsArray.length,
                    changedFolderCount: filteredIncremental.foldersArray.length
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
        const deletedCollectionTombstones = strict ? (storageSnapshot[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES] || {}) : await loadDeletedCollectionTombstonesBG();
        const deletedCollections = Object.entries(deletedCollectionTombstones).map(([uid, lastUpdated]) => ({
            uid,
            lastUpdated
        }));
        const deletedFolderTombstones = strict ? (storageSnapshot[STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES] || {}) : await loadDeletedFolderTombstonesBG();
        const deletedFolders = Object.entries(deletedFolderTombstones).map(([uid, lastUpdated]) => ({
            uid,
            lastUpdated
        }));

        const filteredFullSync = await excludeSharedFromSyncData({
            tabsArray: normalizedTabsArray,
            foldersArray,
            deletedCollections,
            deletedFolders
        }, strict);

        // v4.0 enhanced sync format with version detection and folders support
        const syncData = {
            timestamp: strict ? (storageSnapshot.localTimestamp || 0) : Date.now(),
            tabsArray: filteredFullSync.tabsArray,
            foldersArray: filteredFullSync.foldersArray,
            deletedCollections: filteredFullSync.deletedCollections,
            deletedFolders: filteredFullSync.deletedFolders,
            syncVersion: SYNC_VERSION,
            storageVersion: 3,
            extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime) ?
                chrome.runtime.getManifest().version : '4.0',
            isIncrementalSync: false
        };

        console.log('📤 prepareSyncDataForUpload: Preparing sync data with', filteredFullSync.tabsArray.length, 'collections and', filteredFullSync.foldersArray.length, 'folders');
        console.log('📤 prepareSyncDataForUpload: Folder order:', filteredFullSync.foldersArray.map(f => ({ name: f.name, order: f.order })));
        console.log('📤 prepareSyncDataForUpload: Collection order:', filteredFullSync.tabsArray.map(c => ({ name: c.name, order: c.order, parentId: c.parentId })));

        if (strict) {
            Object.defineProperty(syncData, 'localStorageSnapshot', { value: storageSnapshot });
            // Persist repairs through the existing guarded apply. Excluded shared
            // records are deliberately ignored, so they cannot trigger repeat applies.
            const needsRepair = (item, prefix) => {
                const stored = storageSnapshot[`${prefix}${item.uid}`];
                return stored && Number.isFinite(item.lastUpdated)
                    && item.lastUpdated > (stored.lastUpdated ?? stored.createdOn ?? 0);
            };
            Object.defineProperty(syncData, 'hasTimestampRepairs', { value:
                filteredFullSync.tabsArray.some(item => needsRepair(item, STORAGE_KEYS.COLLECTION_PREFIX))
                || filteredFullSync.foldersArray.some(item => needsRepair(item, STORAGE_KEYS.FOLDER_PREFIX))
            });
        }
        return syncData;

    } catch (error) {
        if (strict) throw error;
        console.error('❌ Error preparing sync data:', error);
        // Fallback to legacy format for compatibility. Still keep shared collections out
        // of this last-resort payload; if the filter itself throws, fall through with the
        // unfiltered legacy data rather than letting an already-failing path throw again.
        const fallbackTabsArray = (collections || []).map((collection) => normalizeCollectionRecordBG(collection));
        let safeTabsArray = fallbackTabsArray;
        try {
            safeTabsArray = (await excludeSharedFromSyncData({ tabsArray: fallbackTabsArray, foldersArray: [] })).tabsArray;
        } catch {
            // best effort only - see comment above
        }
        return {
            timestamp: Date.now(),
            tabsArray: safeTabsArray,
            foldersArray: [],
            syncVersion: SYNC_VERSION,
            storageVersion: 3,
            isIncrementalSync: false
        };
    }
};

const backgroundUtilsApi = {
    STORAGE_KEYS,
    SYNC_VERSION,
    unwrapDeferredUrl,
    normalizeDeferredTab,
    isDeferredLoadingUrl,
    loadCollectionsIndexBG,
    loadSingleCollectionBG,
    saveSingleCollectionBG,
    markCollectionOpenedBG,
    loadAllCollectionsBG,
    loadLooseCollectionSummariesBG,
    loadFoldersIndexBG,
    loadSingleFolderBG,
    saveSingleFolderBG,
    loadAllFoldersBG,
    deleteSingleFolderBG,
    handleRequest,
    logSyncOperation,
    validateCollectionData,
    detectSyncDataVersion,
    migrateIncomingSyncData,
    prepareSyncDataForUpload,
    getNewAccessToken,
    getTokens,
    getAuthRedirectConfig,
    base64UrlEncodeJson,
    base64UrlDecodeJson,
    validateToken,
    getAuthToken,
    getAuthTokenForAI,
    createAuthEndpoint,
    hasIdentityFlow,
    startTabAuthFlow,
    readTabAuthCode,
    TAB_AUTH_PENDING_KEY,
    getGoogleUser,
    getOrCreateSyncFile,
    updateRemote,
    updateLocalDataFromServer,
    syncData,
    createPreSyncBackup,
    recoverFromBackup,
    updateCollection,
    updateCollectionsUids,
    createNewSyncFileAndBackup,
    SMART_ORGANIZE_UNDO_KEY,
    applySmartOrganizePlan,
    undoSmartOrganize,
    readWindowForAI,
    CONTEXT_MENU_DEBOUNCE_MS,
    buildContextMenuModel,
    resolveContextMenuClick,
    handleContextMenuClickBG,
    handleContextMenuCreation,
    handleMenuStorageChanged,
    applyChromeGroupSettings,
};

if (typeof globalThis !== 'undefined') {
    globalThis.TaboxBackgroundUtils = backgroundUtilsApi;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = backgroundUtilsApi;
}
