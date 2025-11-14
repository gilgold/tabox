/**
 * Advanced Storage Utilities for Tabox Collections
 * Implements collections index and lazy loading for improved performance
 */

import { browser } from '../../static/globals';
import { STORAGE_KEYS, CURRENT_STORAGE_VERSION, generateUid } from './sharedConstants';

// Re-export for backward compatibility
export { STORAGE_KEYS, CURRENT_STORAGE_VERSION };

/**
 * Collection Index Structure:
 * {
 *   [uid]: {
 *     name: string,
 *     type: 'collection',
 *     tabCount: number,
 *     lastUpdated: timestamp,
 *     lastOpened: timestamp | null,
 *     createdOn: timestamp,
 *     color: string,
 *     size: number (estimated storage size),
 *     parentId: string | null (links to folder uid)
 *   }
 * }
 */

/**
 * Folder Index Structure:
 * {
 *   [uid]: {
 *     name: string,
 *     type: 'folder',
 *     color: string,
 *     collapsed: boolean,
 *     collectionCount: number (computed from collections with this parentId),
 *     lastUpdated: timestamp,
 *     createdOn: timestamp,
 *     size: number (estimated storage size)
 *   }
 * }
 */

// ========================================
// LEGACY STORAGE FUNCTIONS (Compatibility)
// ========================================

/**
 * Safe storage getter with error handling (Legacy)
 * @param {string|string[]} keys - Storage keys to retrieve
 * @returns {Promise<object>} Storage data
 */
export const safeStorageGet = async (keys) => {
    try {
        if (!browser || !browser.storage) {
            throw new Error('Browser storage API not available');
        }
        
        const result = await browser.storage.local.get(keys);
        return result;
    } catch (error) {
        console.error('Storage get error:', error);
        return {};
    }
};

/**
 * Safe storage setter with validation (Legacy)
 * @param {object} data - Data to store
 * @returns {Promise<boolean>} Success status
 */
export const safeStorageSet = async (data) => {
    try {
        if (!browser || !browser.storage) {
            throw new Error('Browser storage API not available');
        }
        
        // Validate data before storing
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid data for storage');
        }
        
        // Check data size (Chrome has ~10MB limit)
        const dataSize = JSON.stringify(data).length;
        const dataSizeMB = dataSize / (1024 * 1024);
        
        if (dataSize > 2 * 1024 * 1024) { // 2MB warning threshold
            console.warn(`⚠️ Large data size being stored: ${dataSizeMB.toFixed(2)}MB (${dataSize} bytes)`);
        }
        
        await browser.storage.local.set(data);
        return true;
    } catch (error) {
        console.error('Storage set error:', error);
        return false;
    }
};

/**
 * Safe storage removal (Legacy)
 * @param {string|string[]} keys - Keys to remove
 * @returns {Promise<boolean>} Success status
 */
export const safeStorageRemove = async (keys) => {
    try {
        if (!browser || !browser.storage) {
            throw new Error('Browser storage API not available');
        }
        
        await browser.storage.local.remove(keys);
        return true;
    } catch (error) {
        console.error('Storage remove error:', error);
        return false;
    }
};

/**
 * Get all storage data safely (Legacy)
 * @returns {Promise<object>} All storage data
 */
export const getAllStorageData = async () => {
    try {
        if (!browser || !browser.storage) {
            throw new Error('Browser storage API not available');
        }
        
        const allData = await browser.storage.local.get(null);
        return allData;
    } catch (error) {
        console.error('Error getting all storage data:', error);
        return {};
    }
};

/**
 * Create atomic storage transaction (Legacy)
 * @param {Function} transaction - Function that performs storage operations
 * @returns {Promise<boolean>} Success status
 */
export const atomicStorageTransaction = async (transaction) => {
    try {
        if (!browser || !browser.storage) {
            throw new Error('Browser storage API not available');
        }
        
        // For large storage, create minimal backup
        const fullData = await getAllStorageData();
        const preTransactionData = {
            tabsArray: fullData.tabsArray || [],
            localTimestamp: fullData.localTimestamp || Date.now(),
            atomicBackupTimestamp: Date.now()
        };
        
        try {
            // Execute transaction
            await transaction();
            return true;
        } catch (transactionError) {
            // Rollback on failure
            console.error('Transaction failed, rolling back:', transactionError);
            
            if (preTransactionData) {
                await browser.storage.local.clear();
                await browser.storage.local.set(preTransactionData);
            }
            
            return false;
        }
    } catch (error) {
        console.error('Atomic transaction error:', error);
        return false;
    }
};

/**
 * Calculate storage usage (Legacy)
 * @returns {Promise<object>} Storage statistics
 */
export const getStorageStats = async () => {
    try {
        const data = await getAllStorageData();
        const dataString = JSON.stringify(data);
        
        return {
            totalSize: dataString.length,
            totalSizeMB: (dataString.length / (1024 * 1024)).toFixed(2),
            itemCount: Object.keys(data).length,
            largestItem: Object.keys(data).reduce((largest, key) => {
                const size = JSON.stringify(data[key]).length;
                return size > largest.size ? { key, size } : largest;
            }, { key: '', size: 0 })
        };
    } catch (error) {
        console.error('Error calculating storage stats:', error);
        return { totalSize: 0, totalSizeMB: '0', itemCount: 0, largestItem: { key: '', size: 0 } };
    }
};

// ========================================
// NEW INDEXED STORAGE SYSTEM
// ========================================

/**
 * Load collections index (fast metadata access)
 */
export const loadCollectionsIndex = async () => {
    try {
        const { [STORAGE_KEYS.COLLECTIONS_INDEX]: index } = await browser.storage.local.get(STORAGE_KEYS.COLLECTIONS_INDEX);
        return index || {};
    } catch (error) {
        console.error('Failed to load collections index:', error);
        return {};
    }
};

/**
 * Load a single collection by UID (lazy loading)
 */
export const loadSingleCollection = async (uid) => {
    try {
        const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
        const { [key]: collection } = await browser.storage.local.get(key);
        
        if (!collection) {
            console.warn(`Collection ${uid} not found in storage`);
            return null;
        }
        
        return collection;
    } catch (error) {
        console.error(`Failed to load collection ${uid}:`, error);
        return null;
    }
};

/**
 * Load multiple collections efficiently
 */
export const loadMultipleCollections = async (uids) => {
    try {
        if (!uids || uids.length === 0) return {};
        
        const keys = uids.map(uid => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
        const results = await browser.storage.local.get(keys);
        
        // Convert back to uid-keyed object
        const collections = {};
        uids.forEach(uid => {
            const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            if (results[key]) {
                collections[uid] = results[key];
            }
        });
        
        return collections;
    } catch (error) {
        console.error('Failed to load multiple collections:', error);
        return {};
    }
};

/**
 * Save a single collection with index update
 */
export const saveSingleCollection = async (collection, forceUpdateTimestamp = false) => {
    try {
        if (!collection.uid) {
            throw new Error('Collection must have a UID');
        }
        
        const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
        const now = Date.now();
        
        // Only update lastUpdated if explicitly requested or if it's missing
        const lastUpdated = forceUpdateTimestamp ? now : (collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : now);
        
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
                // Store any other collection properties
                ...collection
            }
        });
        
        // Update index
        const index = await loadCollectionsIndex();
        const collectionSize = JSON.stringify(collection).length;
        
        index[collection.uid] = {
            name: collection.name,
            type: 'collection',
            tabCount: collection.tabs ? collection.tabs.length : 0,
            lastUpdated: lastUpdated,
            lastOpened: collection.lastOpened || null,
            createdOn: collection.createdOn || now,
            color: collection.color || 'default',
            size: collectionSize,
            parentId: collection.parentId || null
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index
        });
        
        return true;
        
    } catch (error) {
        console.error('Failed to save collection:', error);
        return false;
    }
};

/**
 * Delete a collection and update index
 */
export const deleteSingleCollection = async (uid) => {
    try {
        const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
        
        // Remove collection data
        await browser.storage.local.remove(collectionKey);
        
        // Update index
        const index = await loadCollectionsIndex();
        delete index[uid];
        
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index
        });
        
        return true;
        
    } catch (error) {
        console.error(`Failed to delete collection ${uid}:`, error);
        return false;
    }
};

/**
 * Migrate legacy tabsArray to new indexed structure
 */
export const migrateLegacyStorage = async () => {
    try {
        // Check current state
        const storageData = await browser.storage.local.get([
            STORAGE_KEYS.STORAGE_VERSION,
            STORAGE_KEYS.COLLECTIONS_INDEX,
            STORAGE_KEYS.LEGACY_TABS_ARRAY
        ]);
        
        const version = storageData[STORAGE_KEYS.STORAGE_VERSION];
        const existingIndex = storageData[STORAGE_KEYS.COLLECTIONS_INDEX];
        const tabsArray = storageData[STORAGE_KEYS.LEGACY_TABS_ARRAY];
        
        // If version is current AND index exists, we're done
        if (version >= CURRENT_STORAGE_VERSION && existingIndex && Object.keys(existingIndex).length > 0) {
            return { success: true, migrated: false };
        }
        
        // If version is current but no index exists, and no legacy data, initialize empty
        if (version >= CURRENT_STORAGE_VERSION && (!tabsArray || tabsArray.length === 0)) {
            // Preserve any existing folders that might have been synced
            const existingFoldersData = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
            const existingFoldersIndex = existingFoldersData[STORAGE_KEYS.FOLDERS_INDEX] || {};
            
            await browser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: {},
                [STORAGE_KEYS.FOLDERS_INDEX]: existingFoldersIndex,
                [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION
            });
            return { success: true, migrated: false };
        }
        
        // Load legacy data for migration
        if (!tabsArray || tabsArray.length === 0) {
            // Preserve any existing folders that might have been synced
            const existingFoldersData = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
            const existingFoldersIndex = existingFoldersData[STORAGE_KEYS.FOLDERS_INDEX] || {};
            
            await browser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: {},
                [STORAGE_KEYS.FOLDERS_INDEX]: existingFoldersIndex,
                [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION
            });
            return { success: true, migrated: false };
        }
        
        const index = {};
        const savePromises = [];
        
        // Process each collection
        for (const collection of tabsArray) {
            if (!collection.uid) {
                console.warn('Skipping collection without UID:', collection);
                continue;
            }
            
            // Ensure collection has required properties
            const normalizedCollection = {
                ...collection,
                uid: collection.uid,
                name: collection.name || 'Untitled Collection',
                tabs: collection.tabs || [],
                createdOn: collection.createdOn || Date.now(),
                lastUpdated: collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : Date.now(),
                lastOpened: collection.lastOpened || null, // Default to null for legacy collections
                color: collection.color || 'default'
            };
            
            // Save individual collection
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
            savePromises.push(
                browser.storage.local.set({
                    [collectionKey]: normalizedCollection
                })
            );
            
            // Add to index
            const collectionSize = JSON.stringify(normalizedCollection).length;
            index[collection.uid] = {
                name: normalizedCollection.name,
                type: 'collection',
                tabCount: normalizedCollection.tabs.length,
                lastUpdated: normalizedCollection.lastUpdated,
                lastOpened: normalizedCollection.lastOpened,
                createdOn: normalizedCollection.createdOn,
                color: normalizedCollection.color,
                size: collectionSize,
                parentId: null
            };
        }
        
        // Save all collections in parallel
        await Promise.all(savePromises);
        
        // Preserve any existing folders that might have been synced from Google Drive
        const existingFoldersData = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
        const existingFoldersIndex = existingFoldersData[STORAGE_KEYS.FOLDERS_INDEX] || {};
        
        // Save indices and update version (preserve folders that might already exist from sync)
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index,
            [STORAGE_KEYS.FOLDERS_INDEX]: existingFoldersIndex,  // Preserve existing folders instead of wiping them
            [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION
        });
        
        // Keep legacy data for safety (can be cleaned up later)
        // We don't remove tabsArray immediately in case rollback is needed
        
        return { 
            success: true, 
            migrated: true, 
            count: Object.keys(index).length 
        };
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Load all collections using the new system (with backward compatibility)
 */
export const loadAllCollections = async (options = {}) => {
    try {
        const { 
            metadataOnly = false, 
            limit = null,
            sortBy = 'lastUpdated',
            sortOrder = 'desc'
        } = options;
        
        // Try new storage first
        const index = await loadCollectionsIndex();
        
        if (Object.keys(index).length === 0) {
            // No index found, try legacy storage
            const { [STORAGE_KEYS.LEGACY_TABS_ARRAY]: tabsArray } = await browser.storage.local.get(STORAGE_KEYS.LEGACY_TABS_ARRAY);
            
            if (tabsArray && tabsArray.length > 0) {
                await migrateLegacyStorage();
                // Reload index after migration
                return await loadAllCollections(options);
            }
            
            // No data at all
            return [];
        }
        
        // Sort collections by metadata
        const sortedUids = Object.keys(index).sort((a, b) => {
            const aVal = index[a][sortBy];
            const bVal = index[b][sortBy];
            
            if (sortOrder === 'desc') {
                return bVal - aVal;
            } else {
                return aVal - bVal;
            }
        });
        
        // Apply limit if specified
        const uidsToLoad = limit ? sortedUids.slice(0, limit) : sortedUids;
        
        if (metadataOnly) {
            // Return only metadata from index
            return uidsToLoad.map(uid => ({
                uid,
                ...index[uid]
            }));
        }
        
        // Load full collection data
        const collections = await loadMultipleCollections(uidsToLoad);
        
        // Combine with metadata and return in sorted order
        return uidsToLoad.map(uid => {
            const collection = collections[uid];
            if (!collection) {
                console.warn(`Collection ${uid} found in index but not in storage`);
                return null;
            }
            return collection;
        }).filter(Boolean);
        
    } catch (error) {
        console.error('Failed to load all collections:', error);
        return [];
    }
};

/**
 * Get enhanced storage statistics (New system with collections index)
 */
export const getNewStorageStats = async () => {
    try {
        const index = await loadCollectionsIndex();
        const legacyDataResult = await browser.storage.local.get(STORAGE_KEYS.LEGACY_TABS_ARRAY);
        const legacyData = legacyDataResult[STORAGE_KEYS.LEGACY_TABS_ARRAY];
        const versionResult = await browser.storage.local.get(STORAGE_KEYS.STORAGE_VERSION);
        
        const indexKeys = Object.keys(index || {});
        const indexValues = Object.values(index || {});
        
        const stats = {
            collections: indexKeys.length,
            totalSize: indexValues.reduce((sum, meta) => sum + (meta?.size || 0), 0),
            totalTabs: indexValues.reduce((sum, meta) => sum + (meta?.tabCount || 0), 0),
            hasLegacyData: Boolean(legacyData),
            legacySize: legacyData ? JSON.stringify(legacyData).length : 0,
            storageVersion: versionResult[STORAGE_KEYS.STORAGE_VERSION] || 1
        };
        
        // Only debug log if values are unexpected
        if (stats.collections === 0 && globalThis.DEBUG_STORAGE) {
            console.log('🔍 Debug - Index:', index);
            console.log('🔍 Debug - Legacy data found:', Boolean(legacyData));
            console.log('🔍 Debug - Version result:', versionResult);
        }
        
        return stats;
    } catch (error) {
        console.error('Failed to get storage stats:', error);
        
        // Return fallback stats instead of null
        return {
            collections: 0,
            totalSize: 0,
            totalTabs: 0,
            hasLegacyData: false,
            legacySize: 0,
            storageVersion: 1,
            error: error.message
        };
    }
};

/**
 * Batch operations for multiple collections
 */
export const batchUpdateCollections = async (collections) => {
    try {
        // Input validation
        if (!collections) {
            console.warn('🚨 batchUpdateCollections: collections is null/undefined');
            return false;
        }
        
        if (!Array.isArray(collections)) {
            console.error('🚨 batchUpdateCollections: collections is not an array:', typeof collections, collections);
            return false;
        }
        

        
        const updates = {};
        const index = await loadCollectionsIndex();
        const now = Date.now();
        
        // Prepare all updates
        collections.forEach(collection => {
            if (!collection.uid) return;
            
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
            const collectionSize = JSON.stringify(collection).length;
            
            // Add to batch update - preserve existing lastUpdated and lastOpened timestamps
            updates[collectionKey] = {
                ...collection,
                lastUpdated: collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : now,
                lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null
            };
            
            // Update index - preserve existing lastUpdated and lastOpened timestamps
            index[collection.uid] = {
                name: collection.name,
                type: 'collection',
                tabCount: collection.tabs ? collection.tabs.length : 0,
                lastUpdated: collection.lastUpdated !== null && collection.lastUpdated !== undefined ? collection.lastUpdated : now,
                lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null,
                createdOn: collection.createdOn || now,
                color: collection.color || 'default',
                size: collectionSize,
                parentId: collection.parentId || null
            };
        });
        
        // Add index to batch update
        updates[STORAGE_KEYS.COLLECTIONS_INDEX] = index;
        
        // Execute batch update
        await browser.storage.local.set(updates);
        

        return true;
        
    } catch (error) {
        console.error('Batch update failed:', error);
        return false;
    }
};

// ========================================
// FOLDER STORAGE FUNCTIONS
// ========================================

/**
 * Load folders index
 */
export const loadFoldersIndex = async () => {
    try {
        const { [STORAGE_KEYS.FOLDERS_INDEX]: index } = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
        return index || {};
    } catch (error) {
        console.error('Failed to load folders index:', error);
        return {};
    }
};

/**
 * Save a single folder with index update
 */
export const saveSingleFolder = async (folder, forceUpdateTimestamp = false, suppressLogging = false) => {
    try {
        if (!folder.uid) {
            throw new Error('Folder must have a UID');
        }
        
        const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${folder.uid}`;
        const now = Date.now();
        
        // Only update lastUpdated if explicitly requested or if it's missing
        const lastUpdated = forceUpdateTimestamp ? now : (folder.lastUpdated !== null && folder.lastUpdated !== undefined ? folder.lastUpdated : now);
        
        // Calculate collection count from collections index
        const collectionsIndex = await loadCollectionsIndex();
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
        const foldersIndex = await loadFoldersIndex();
        const folderSize = JSON.stringify(folder).length;
        
        foldersIndex[folder.uid] = {
            name: folder.name,
            type: 'folder',
            color: folder.color || 'var(--folder-default-color)',
            collapsed: folder.collapsed !== undefined ? folder.collapsed : false,
            collectionCount: collectionCount,
            lastUpdated: lastUpdated,
            createdOn: folder.createdOn || now,
            order: folder.order !== undefined ? folder.order : Object.keys(foldersIndex).length, // Maintain sort order
            size: folderSize
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
        });
        
        return true;
        
    } catch (error) {
        console.error('Failed to save folder:', error);
        return false;
    }
};

/**
 * Load a single folder by UID
 */
export const loadSingleFolder = async (uid) => {
    try {
        const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`;
        const { [folderKey]: folder } = await browser.storage.local.get(folderKey);
        return folder || null;
    } catch (error) {
        console.error(`Failed to load folder ${uid}:`, error);
        return null;
    }
};

/**
 * Load multiple folders by UIDs
 */
export const loadMultipleFolders = async (uids) => {
    try {
        if (!uids || uids.length === 0) {
            return {};
        }

        const keys = uids.map(uid => `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`);
        const results = await browser.storage.local.get(keys);
        
        const folders = {};
        uids.forEach(uid => {
            const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`;
            if (results[folderKey]) {
                folders[uid] = results[folderKey];
            }
        });
        
        return folders;
    } catch (error) {
        console.error('Failed to load multiple folders:', error);
        return {};
    }
};

/**
 * Load all folders using the index system
 */
export const loadAllFolders = async (options = {}) => {
    try {
        const { 
            metadataOnly = false, 
            sortBy = 'lastUpdated',
            sortOrder = 'desc'
        } = options;
        
        // Load folders index
        const index = await loadFoldersIndex();
        
        if (Object.keys(index).length === 0) {
            return [];
        }
        
        // Sort folders by metadata, prioritizing 'order' field if available
        const sortedUids = Object.keys(index).sort((a, b) => {
            // If sorting by order or if order field exists, use order field
            if (sortBy === 'order' || (index[a].order !== undefined && index[b].order !== undefined)) {
                const aOrder = index[a].order !== undefined ? index[a].order : 999999;
                const bOrder = index[b].order !== undefined ? index[b].order : 999999;
                return aOrder - bOrder; // Always ascending for order
            }
            
            // Otherwise use the requested sort field
            const aVal = index[a][sortBy];
            const bVal = index[b][sortBy];
            
            if (sortOrder === 'desc') {
                return bVal - aVal;
            } else {
                return aVal - bVal;
            }
        });
        
        if (metadataOnly) {
            // Return only metadata from index
            return sortedUids.map(uid => ({
                uid,
                ...index[uid]
            }));
        }
        
        // Load full folder data
        const folders = await loadMultipleFolders(sortedUids);
        
        // Combine with metadata and return in sorted order
        return sortedUids.map(uid => ({
            uid,
            ...folders[uid]
        })).filter(folder => folder.uid); // Filter out any failed loads
        
    } catch (error) {
        console.error('Failed to load all folders:', error);
        return [];
    }
};

/**
 * Delete a folder and update index
 */
export const deleteSingleFolder = async (uid) => {
    try {
        const folderKey = `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`;
        
        // Remove from storage
        await browser.storage.local.remove(folderKey);
        
        // Update index
        const foldersIndex = await loadFoldersIndex();
        delete foldersIndex[uid];
        
        await browser.storage.local.set({
            [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
        });
        
        console.log(`Deleted folder ${uid}`);
        return true;
        
    } catch (error) {
        console.error(`Failed to delete folder ${uid}:`, error);
        return false;
    }
};

/**
 * Update collection count for a folder
 */
export const updateFolderCollectionCount = async (folderId) => {
    try {
        const folder = await loadSingleFolder(folderId);
        if (!folder) return false;
        
        // Calculate new collection count
        const collectionsIndex = await loadCollectionsIndex();
        const collectionCount = Object.values(collectionsIndex).filter(c => c.parentId === folderId).length;
        
        // Update folder with new count
        folder.collectionCount = collectionCount;
        folder.lastUpdated = Date.now();
        
        return await saveSingleFolder(folder);
        
    } catch (error) {
        console.error(`Failed to update collection count for folder ${folderId}:`, error);
        return false;
    }
};

/**
 * Update folder order for a list of folders
 */
export const updateFoldersOrder = async (folders) => {
    try {
        const foldersIndex = await loadFoldersIndex();
        
        // Update order for each folder in the index
        folders.forEach((folder, index) => {
            if (foldersIndex[folder.uid]) {
                foldersIndex[folder.uid].order = index;
                foldersIndex[folder.uid].lastUpdated = Date.now();
            }
        });
        
        // Save updated index
        await browser.storage.local.set({
            [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
        });
        
        // Also update the individual folder records
        const updatePromises = folders.map(async (folder, index) => {
            const fullFolder = await loadSingleFolder(folder.uid);
            if (fullFolder) {
                fullFolder.order = index;
                fullFolder.lastUpdated = Date.now();
                await saveSingleFolder(fullFolder, false); // Don't force timestamp since we're setting it
            }
        });
        
        await Promise.all(updatePromises);
        
        return true;
        
    } catch (error) {
        console.error('Failed to update folder order:', error);
        return false;
    }
}; 