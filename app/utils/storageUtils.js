/**
 * Advanced Storage Utilities for Tabox Collections
 * Implements collections index and lazy loading for improved performance
 */

import { browser } from '../../static/globals';
import { STORAGE_KEYS, CURRENT_STORAGE_VERSION, generateUid } from './sharedConstants';
import { assessMigrationSupport40 } from './migrationSupport40';

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
        
        const fullSnapshot = await getAllStorageData();
        
        try {
            await transaction();
            return true;
        } catch (transactionError) {
            console.error('Transaction failed, rolling back:', transactionError);
            
            if (fullSnapshot) {
                await browser.storage.local.clear();
                await browser.storage.local.set(fullSnapshot);
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

export const sortCollectionsForDisplay = (collections = [], options = {}) => {
    const {
        sortBy = 'lastUpdated',
        sortOrder = 'desc',
        flatSort = false
    } = options;

    return [...collections].sort((a, b) => {
        if (!flatSort) {
            const aParentId = a?.parentId || null;
            const bParentId = b?.parentId || null;

            if (aParentId !== bParentId) {
                if (aParentId === null && bParentId !== null) return 1;
                if (aParentId !== null && bParentId === null) return -1;
                return aParentId.localeCompare(bParentId);
            }
        }

        const aHasOrder = a?.order !== undefined && a?.order !== null;
        const bHasOrder = b?.order !== undefined && b?.order !== null;

        if (aHasOrder && bHasOrder) {
            return a.order - b.order;
        }

        const aVal = a?.[sortBy];
        const bVal = b?.[sortBy];

        if (sortBy === 'name' || sortBy === 'color') {
            const aStr = (aVal || '').toString().toLowerCase();
            const bStr = (bVal || '').toString().toLowerCase();

            return sortOrder === 'desc'
                ? bStr.localeCompare(aStr)
                : aStr.localeCompare(bStr);
        }

        const aNum = aVal || 0;
        const bNum = bVal || 0;

        return sortOrder === 'desc'
            ? bNum - aNum
            : aNum - bNum;
    });
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

const loadDeletedCollectionTombstones = async () => {
    try {
        const { [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: tombstones } = await browser.storage.local.get(STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES);
        return tombstones || {};
    } catch (error) {
        console.error('Failed to load deleted collection tombstones:', error);
        return {};
    }
};

const clearDeletedCollectionTombstones = async (uids = []) => {
    if (!Array.isArray(uids) || uids.length === 0) {
        return;
    }

    const tombstones = await loadDeletedCollectionTombstones();
    let changed = false;

    uids.forEach((uid) => {
        if (tombstones[uid]) {
            delete tombstones[uid];
            changed = true;
        }
    });

    if (changed) {
        await browser.storage.local.set({
            [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: tombstones
        });
    }
};

const markDeletedCollectionTombstones = async (uids = [], deletedAt = Date.now()) => {
    if (!Array.isArray(uids) || uids.length === 0) {
        return;
    }

    const tombstones = await loadDeletedCollectionTombstones();
    uids.forEach((uid) => {
        tombstones[uid] = deletedAt;
    });

    await browser.storage.local.set({
        [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: tombstones
    });
};

/**
 * Save a single collection with index update
 */
export const saveSingleCollection = async (collection, forceUpdateTimestamp = false) => {
    try {
        if (!collection.uid) {
            throw new Error('Collection must have a UID');
        }
        
        const normalizedIncomingCollection = collection;
        const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${normalizedIncomingCollection.uid}`;
        const now = Date.now();
        
        // Only update lastUpdated if explicitly requested or if it's missing
        const lastUpdated = forceUpdateTimestamp
            ? now
            : (normalizedIncomingCollection.lastUpdated !== null && normalizedIncomingCollection.lastUpdated !== undefined
                ? normalizedIncomingCollection.lastUpdated
                : now);
        
        // Load index to determine existing metadata
        const index = await loadCollectionsIndex();
        const isExistingCollection = !!index[normalizedIncomingCollection.uid];
        const existingCollection = isExistingCollection
            ? await loadSingleCollection(normalizedIncomingCollection.uid)
            : null;
        const targetParentId = normalizedIncomingCollection.parentId !== undefined
            ? normalizedIncomingCollection.parentId || null
            : (existingCollection?.parentId !== undefined ? existingCollection.parentId : null);

        const tabsToSave = normalizedIncomingCollection.tabs !== undefined
            ? normalizedIncomingCollection.tabs
            : (existingCollection?.tabs || []);
        const groupsToSave = normalizedIncomingCollection.chromeGroups !== undefined
            ? normalizedIncomingCollection.chromeGroups
            : (existingCollection?.chromeGroups || []);
        
        let resolvedOrder;
        
        if (!isExistingCollection) {
            // For brand new collections, insert them at the top (order 0) and shift siblings down.
            const siblingEntries = [];
            for (const uid in index) {
                if (uid === normalizedIncomingCollection.uid) continue;
                if ((index[uid].parentId || null) === targetParentId) {
                    const normalizedOrder = index[uid].order !== undefined ? index[uid].order : Number.MAX_SAFE_INTEGER;
                    siblingEntries.push({
                        uid,
                        normalizedOrder
                    });
                }
            }
            
            // Sort siblings by their existing order (undefined orders go last)
            siblingEntries.sort((a, b) => a.normalizedOrder - b.normalizedOrder);
            
            if (siblingEntries.length > 0) {
                const siblingKeys = siblingEntries.map(entry => `${STORAGE_KEYS.COLLECTION_PREFIX}${entry.uid}`);
                const siblingData = await browser.storage.local.get(siblingKeys);
                const updatedRecords = {};
                
                siblingEntries.forEach((entry, indexPosition) => {
                    const newOrderValue = indexPosition + 1; // Start from 1 so new collection can take 0
                    index[entry.uid].order = newOrderValue;
                    const recordKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${entry.uid}`;
                    const record = siblingData[recordKey];
                    if (record) {
                        updatedRecords[recordKey] = {
                            ...record,
                            order: newOrderValue
                        };
                    }
                });
                
                if (Object.keys(updatedRecords).length > 0) {
                    await browser.storage.local.set(updatedRecords);
                }
            }
            
            resolvedOrder = 0;
        } else if (normalizedIncomingCollection.order !== undefined) {
            resolvedOrder = normalizedIncomingCollection.order;
        } else {
            resolvedOrder = index[normalizedIncomingCollection.uid]?.order;
        }
        
        if (resolvedOrder === undefined || resolvedOrder === null) {
            resolvedOrder = 999999;
        }
        
        const collectionToSave = {
            ...(existingCollection || {}),
            ...normalizedIncomingCollection,
            tabs: tabsToSave,
            chromeGroups: groupsToSave,
            parentId: targetParentId,
            order: resolvedOrder
        };
        
        // Save collection data
        await browser.storage.local.set({
            [collectionKey]: {
                uid: collectionToSave.uid,
                name: collectionToSave.name,
                tabs: collectionToSave.tabs,
                color: collectionToSave.color,
                createdOn: collectionToSave.createdOn || now,
                lastUpdated: lastUpdated,
                lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
                chromeGroups: collectionToSave.chromeGroups,
                // Store any other collection properties
                ...collectionToSave,
                order: resolvedOrder
            }
        });
        
        // Update index for the new/updated collection
        const collectionSize = JSON.stringify(collectionToSave).length;
        
        index[normalizedIncomingCollection.uid] = {
            name: collectionToSave.name,
            type: 'collection',
            tabCount: collectionToSave.tabs ? collectionToSave.tabs.length : 0,
            lastUpdated: lastUpdated,
            lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
            createdOn: collectionToSave.createdOn || now,
            color: collectionToSave.color || 'default',
            size: collectionSize,
            parentId: collectionToSave.parentId || null,
            order: resolvedOrder
        };
        
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index
        });

        await clearDeletedCollectionTombstones([normalizedIncomingCollection.uid]);
        
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
        const deletedAt = Date.now();
        
        // Remove collection data
        await browser.storage.local.remove(collectionKey);
        
        // Update index
        const index = await loadCollectionsIndex();
        delete index[uid];
        
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index
        });

        await markDeletedCollectionTombstones([uid], deletedAt);
        
        return true;
        
    } catch (error) {
        console.error(`Failed to delete collection ${uid}:`, error);
        return false;
    }
};

/**
 * Delete multiple collections and update the index in a single storage pass
 */
export const batchDeleteCollections = async (uids = []) => {
    try {
        if (!Array.isArray(uids)) {
            console.error('batchDeleteCollections expected an array of UIDs');
            return false;
        }

        const uniqueUids = [...new Set(uids.filter(Boolean))];
        if (uniqueUids.length === 0) {
            return true;
        }
        const deletedAt = Date.now();

        const collectionKeys = uniqueUids.map((uid) => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
        const index = await loadCollectionsIndex();

        uniqueUids.forEach((uid) => {
            delete index[uid];
        });

        await browser.storage.local.remove(collectionKeys);
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index,
        });

        await markDeletedCollectionTombstones(uniqueUids, deletedAt);

        return true;
    } catch (error) {
        console.error('Failed to batch delete collections:', error);
        return false;
    }
};

/**
 * Check if migration needs repair by validating that collections have their tabs data
 */
const checkIfMigrationNeedsRepair = async (existingIndex, tabsArray) => {
    try {
        // If no legacy data exists, we can't repair - assume migration is fine
        if (!tabsArray || tabsArray.length === 0) {
            return false;
        }
        
        // Check if legacy storage has more collections with tabs than the index reports
        const legacyCollectionsWithTabs = tabsArray.filter(c => c.tabs && c.tabs.length > 0);
        const indexCollectionsWithTabs = Object.values(existingIndex).filter(meta => meta.tabCount > 0);
        
        // If legacy has significantly more collections with tabs, we need to repair
        if (legacyCollectionsWithTabs.length > indexCollectionsWithTabs.length) {
            return true;
        }
        
        // Spot-check a few collections to ensure tabs are actually in storage
        const uidsToCheck = Object.keys(existingIndex).slice(0, 3);
        for (const uid of uidsToCheck) {
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const result = await browser.storage.local.get(collectionKey);
            const collection = result[collectionKey];
            
            // If collection exists in index but not in storage, or has no tabs array, we need repair
            if (!collection || !collection.tabs) {
                return true;
            }
            
            // If index says it should have tabs but storage has empty array, check legacy
            const indexMeta = existingIndex[uid];
            if (indexMeta.tabCount > 0 && collection.tabs.length === 0) {
                const legacyCollection = tabsArray.find(c => c.uid === uid);
                if (legacyCollection && legacyCollection.tabs && legacyCollection.tabs.length > 0) {
                    return true;
                }
            }

            const legacyCollection = tabsArray.find(c => c.uid === uid);
            if (legacyCollection) {
                const collectionMissingMetadata = (
                    collection.lastUpdated === undefined ||
                    collection.lastOpened === undefined ||
                    collection.order === undefined
                );
                const indexMissingMetadata = (
                    indexMeta.lastUpdated === undefined ||
                    indexMeta.lastOpened === undefined ||
                    indexMeta.order === undefined
                );
                const legacyMissingMetadata = (
                    legacyCollection.lastUpdated === undefined ||
                    legacyCollection.lastOpened === undefined ||
                    legacyCollection.order === undefined
                );

                if (collectionMissingMetadata || indexMissingMetadata || legacyMissingMetadata) {
                    return true;
                }
            }
        }

        const foldersIndex = await loadFoldersIndex();
        if (Object.keys(foldersIndex).length > 0) {
            const folders = await loadMultipleFolders(Object.keys(foldersIndex));

            for (const uid of Object.keys(foldersIndex)) {
                const folder = folders[uid];
                const folderMeta = foldersIndex[uid];

                if (!folder || folder.lastUpdated === undefined || folder.order === undefined) {
                    return true;
                }

                if (folderMeta.lastUpdated === undefined || folderMeta.order === undefined) {
                    return true;
                }
            }
        }
        
        // Migration appears valid
        return false;
        
    } catch (error) {
        console.error('Error checking migration repair needs:', error);
        // If we can't check, assume repair is needed to be safe
        return true;
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
        const supportAssessment = assessMigrationSupport40(await browser.storage.local.get(null));

        if (!supportAssessment.supported) {
            return {
                success: false,
                unsupportedPre40: true,
                error: 'Automatic migration is only supported for 4.0+ local data'
            };
        }
        
        // CRITICAL FIX: Validate that existing index has valid data with tabs
        if (version >= CURRENT_STORAGE_VERSION && existingIndex && Object.keys(existingIndex).length > 0) {
            // Check if we need to repair broken migration (missing tabs)
            const needsRepair = await checkIfMigrationNeedsRepair(existingIndex, tabsArray);
            
            if (needsRepair) {
                console.warn('⚠️ Detected incomplete migration - repairing data...');
                // Continue with re-migration below
            } else {
                // Migration is valid, we're done
                return { success: true, migrated: false };
            }
        }
        
        // No legacy data to migrate — preserve whatever indexed data already exists
        if (!tabsArray || tabsArray.length === 0) {
            const existingFoldersData = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
            const existingFoldersIndex = existingFoldersData[STORAGE_KEYS.FOLDERS_INDEX] || {};
            
            const setPayload = {
                [STORAGE_KEYS.FOLDERS_INDEX]: existingFoldersIndex,
                [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION
            };
            
            // Only write an empty collections_index if one doesn't already exist.
            // An existing index (even from a previous version) contains valid pointers
            // to collection_<uid> records that must not be wiped.
            if (!existingIndex || Object.keys(existingIndex).length === 0) {
                setPayload[STORAGE_KEYS.COLLECTIONS_INDEX] = {};
            }
            
            await browser.storage.local.set(setPayload);
            return { success: true, migrated: false };
        }
        
        // Check if this is a repair operation
        const isRepair = existingIndex && Object.keys(existingIndex).length > 0;
        
        if (isRepair) {
        } else {
        }
        
        const index = {};
        const savePromises = [];
        
        // Process each collection
        for (const [collectionIndex, collection] of tabsArray.entries()) {
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
                lastOpened: collection.lastOpened !== null && collection.lastOpened !== undefined ? collection.lastOpened : null,
                color: collection.color || 'default',
                parentId: collection.parentId !== undefined ? collection.parentId : null,
                order: collection.order !== undefined ? collection.order : collectionIndex
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
                parentId: normalizedCollection.parentId,
                order: normalizedCollection.order
            };
        }

        // Preserve any existing folders that might have been synced from Google Drive,
        // but normalize missing 4.0 metadata during migration repair.
        const existingFoldersData = await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX);
        const existingFoldersIndex = existingFoldersData[STORAGE_KEYS.FOLDERS_INDEX] || {};
        const existingFolderUids = Object.keys(existingFoldersIndex);
        const existingFolders = existingFolderUids.length > 0 ? await loadMultipleFolders(existingFolderUids) : {};
        const normalizedFoldersIndex = {};
        
        existingFolderUids.forEach((uid, folderIndex) => {
            const folderMeta = existingFoldersIndex[uid] || {};
            const folderRecord = existingFolders[uid] || {};
            const fallbackCreatedOn = folderRecord.createdOn || folderMeta.createdOn || Date.now();
            const fallbackLastUpdated = (
                folderRecord.lastUpdated !== null && folderRecord.lastUpdated !== undefined
                    ? folderRecord.lastUpdated
                    : (folderMeta.lastUpdated !== null && folderMeta.lastUpdated !== undefined
                        ? folderMeta.lastUpdated
                        : fallbackCreatedOn)
            );
            const normalizedFolder = {
                uid,
                name: folderRecord.name || folderMeta.name || 'Untitled Folder',
                type: 'folder',
                color: folderRecord.color || folderMeta.color || 'var(--folder-default-color)',
                collapsed: folderRecord.collapsed !== undefined ? folderRecord.collapsed : (folderMeta.collapsed !== undefined ? folderMeta.collapsed : false),
                createdOn: fallbackCreatedOn,
                lastUpdated: fallbackLastUpdated,
                order: folderRecord.order !== undefined ? folderRecord.order : (folderMeta.order !== undefined ? folderMeta.order : folderIndex)
            };

            savePromises.push(
                browser.storage.local.set({
                    [`${STORAGE_KEYS.FOLDER_PREFIX}${uid}`]: normalizedFolder
                })
            );

            normalizedFoldersIndex[uid] = {
                name: normalizedFolder.name,
                type: 'folder',
                color: normalizedFolder.color,
                collapsed: normalizedFolder.collapsed,
                collectionCount: Object.values(index).filter(meta => meta.parentId === uid).length,
                lastUpdated: normalizedFolder.lastUpdated,
                createdOn: normalizedFolder.createdOn,
                order: normalizedFolder.order,
                size: JSON.stringify(normalizedFolder).length
            };
        });

        // Save all collections and normalized folders in parallel
        await Promise.all(savePromises);
        
        // Save indices and update version (preserve folders that might already exist from sync)
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: index,
            [STORAGE_KEYS.FOLDERS_INDEX]: normalizedFoldersIndex,
            [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION
        });
        
        // Keep legacy data for safety (can be cleaned up later)
        // We don't remove tabsArray immediately in case rollback is needed
        
        const totalTabs = Object.values(index).reduce((sum, meta) => sum + meta.tabCount, 0);
        
        if (isRepair) {
        } else {
        }
        
        return { 
            success: true, 
            migrated: true,
            repaired: isRepair,
            count: Object.keys(index).length,
            totalTabs
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
            sortOrder = 'desc',
            flatSort = false
        } = options;
        
        // Try new storage first
        const index = await loadCollectionsIndex();
        
        if (Object.keys(index).length === 0) {
            // No index found, try legacy storage
            const { [STORAGE_KEYS.LEGACY_TABS_ARRAY]: tabsArray } = await browser.storage.local.get(STORAGE_KEYS.LEGACY_TABS_ARRAY);
            
            if (tabsArray && tabsArray.length > 0) {
                const migrationResult = await migrateLegacyStorage();
                if (migrationResult?.unsupportedPre40) {
                    return [];
                }
                // Reload index after migration
                return await loadAllCollections(options);
            }
            
            // No data at all
            return [];
        }
        
        const sortedMetadata = sortCollectionsForDisplay(
            Object.keys(index).map(uid => ({
                uid,
                ...index[uid]
            })),
            { sortBy, sortOrder, flatSort }
        );
        const sortedUids = sortedMetadata.map(collection => collection.uid);
        
        // Apply limit if specified
        const uidsToLoad = limit ? sortedUids.slice(0, limit) : sortedUids;
        
        if (metadataOnly) {
            return sortedMetadata.slice(0, uidsToLoad.length);
        }
        
        // Load full collection data
        const collections = await loadMultipleCollections(uidsToLoad);
        
        // Combine with metadata and return in sorted order
        // Ensure order field matches index: if index has order, use it; if index doesn't have order, remove it from collection
            return uidsToLoad.map(uid => {
                const collection = collections[uid];
                if (!collection) {
                    console.warn(`Collection ${uid} found in index but not in storage`);
                    return null;
                }
                const normalizedCollection = collection;
                // If index has order, use it; if index doesn't have order, explicitly remove it from collection
                if (index[uid]?.order !== undefined) {
                    return {
                        ...normalizedCollection,
                        order: index[uid].order
                    };
                } else {
                    // Index doesn't have order - remove it from collection data to ensure user sorting takes precedence
                    const { order, ...collectionWithoutOrder } = normalizedCollection;
                    return collectionWithoutOrder;
                }
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
        const updatedUids = [];
        
        // Identify collections with missing data (partial/metadata-only updates)
        // This prevents overwriting full collections with partial data during batch operations
        const incompleteCollections = collections.filter(c => (
            c.tabs === undefined || c.chromeGroups === undefined
        ));
        let existingData = {};
        
        if (incompleteCollections.length > 0) {
            const uids = incompleteCollections.map(c => c.uid).filter(Boolean);
            if (uids.length > 0) {
                existingData = await loadMultipleCollections(uids);
            }
        }
        
        // Prepare all updates
        collections.forEach(collection => {
            if (!collection.uid) return;
            
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;
            const existing = existingData[collection.uid] || {};
            const existingIndexEntry = index[collection.uid] || {};
            const mergedCollection = {
                ...existing,
                ...collection,
            };
            
            // Prepare collection data for storage - remove order field if it's null
            const collectionForStorage = { ...mergedCollection };
            if (collectionForStorage.order === null) {
                delete collectionForStorage.order;
            }
            
            // Preserve tabs and chromeGroups if missing in update
            const tabsToSave = collection.tabs !== undefined ? collection.tabs : (existing?.tabs || []);
            const groupsToSave = collection.chromeGroups !== undefined ? collection.chromeGroups : (existing?.chromeGroups || []);
            
            collectionForStorage.tabs = tabsToSave;
            collectionForStorage.chromeGroups = groupsToSave;

            const incomingLastUpdated = collectionForStorage.lastUpdated;
            const storedLastUpdated = existingIndexEntry.lastUpdated;
            const resolvedLastUpdated = (
                incomingLastUpdated !== null && incomingLastUpdated !== undefined
            )
                ? (
                    storedLastUpdated !== null && storedLastUpdated !== undefined
                        ? Math.max(incomingLastUpdated, storedLastUpdated)
                        : incomingLastUpdated
                )
                : (
                    storedLastUpdated !== null && storedLastUpdated !== undefined
                        ? storedLastUpdated
                        : now
                );
            
            // ALWAYS use index order as source of truth (index is updated by updateCollectionsOrder)
            // This ensures that even if in-memory collections have stale order values,
            // we use the correct order from the index which was just updated
            const indexOrder = index[collection.uid]?.order;
            if (indexOrder !== undefined && indexOrder !== null) {
                collectionForStorage.order = indexOrder;
            } else if (collectionForStorage.order === undefined) {
                // No order in index and none in collection - leave undefined
            }
            // If collection has order but index doesn't, keep collection's order
            
            const collectionSize = JSON.stringify(collectionForStorage).length;
            
            // Add to batch update - preserve existing lastUpdated and lastOpened timestamps
            updates[collectionKey] = {
                ...collectionForStorage,
                lastUpdated: resolvedLastUpdated,
                lastOpened: collectionForStorage.lastOpened !== null && collectionForStorage.lastOpened !== undefined ? collectionForStorage.lastOpened : null
            };
            
            // Update index - preserve existing lastUpdated and lastOpened timestamps
            const indexEntry = {
                name: collectionForStorage.name,
                type: 'collection',
                tabCount: collectionForStorage.tabs ? collectionForStorage.tabs.length : 0,
                lastUpdated: resolvedLastUpdated,
                lastOpened: collectionForStorage.lastOpened !== null && collectionForStorage.lastOpened !== undefined ? collectionForStorage.lastOpened : null,
                createdOn: collectionForStorage.createdOn || now,
                color: collectionForStorage.color || 'default',
                size: collectionSize,
                parentId: collectionForStorage.parentId || null
            };
            
            // Handle order field:
            // ALWAYS prefer existing index order as source of truth (updateCollectionsOrder updates the index)
            // This prevents stale in-memory order values from overwriting correct index values
            const existingIndexOrder = index[collection.uid]?.order;
            
            if (collection.order === null) {
                // Explicitly clearing order - don't add order to indexEntry
            } else if (existingIndexOrder !== undefined && existingIndexOrder !== null) {
                // Index has order - use it (source of truth)
                indexEntry.order = existingIndexOrder;
            } else if (collection.order !== undefined && collection.order !== null) {
                // Index doesn't have order but collection does - use collection's
                indexEntry.order = collection.order;
            }
            // If neither has order, don't add one (allows user sorting to take effect)
            
            // Update index entry - replacing the old entry with the new one
            // If order was null, the new entry won't have order, effectively removing it
            index[collection.uid] = indexEntry;
            updatedUids.push(collection.uid);
            
            // Explicitly delete order from index if it was set to null (safety check)
            if (collection.order === null && index[collection.uid].order !== undefined) {
                delete index[collection.uid].order;
            }
        });
        
        // Add index to batch update
        updates[STORAGE_KEYS.COLLECTIONS_INDEX] = index;
        
        // Execute batch update
        await browser.storage.local.set(updates);
        await clearDeletedCollectionTombstones(updatedUids);
        

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
        console.log('📁 [Popup] loadFoldersIndex: Found', Object.keys(index || {}).length, 'entries');
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
        
        console.log('📁 [Popup] loadAllFolders: Starting to load folders');
        
        // Load folders index
        const index = await loadFoldersIndex();
        
        if (Object.keys(index).length === 0) {
            console.log('📁 [Popup] loadAllFolders: No folders in index');
            return [];
        }

        const collectionsIndex = await loadCollectionsIndex();
        const collectionCountsByFolder = Object.values(collectionsIndex).reduce((counts, collectionMeta) => {
            const parentId = collectionMeta?.parentId;

            if (parentId) {
                counts[parentId] = (counts[parentId] || 0) + 1;
            }

            return counts;
        }, {});
        
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
                ...index[uid],
                collectionCount: collectionCountsByFolder[uid] || 0
            }));
        }
        
        // Load full folder data
        const folders = await loadMultipleFolders(sortedUids);
        
        // Combine with metadata and return in sorted order
        const result = sortedUids.map(uid => ({
            uid,
            ...folders[uid],
            collectionCount: collectionCountsByFolder[uid] || 0
        })).filter(folder => folder.uid); // Filter out any failed loads
        
        console.log('📁 [Popup] loadAllFolders: Returning', result.length, 'folders');
        return result;
        
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

/**
 * Update collection order for a list of collections
 * Similar to updateFoldersOrder but for collections
 */
export const updateCollectionsOrder = async (collections) => {
    try {
        const collectionsIndex = await loadCollectionsIndex();
        
        // Update order for each collection in the index
        collections.forEach((collection, index) => {
            if (collectionsIndex[collection.uid]) {
                collectionsIndex[collection.uid].order = index;
                collectionsIndex[collection.uid].lastUpdated = Date.now();
            }
        });
        
        // Save updated index
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: collectionsIndex
        });
        
        // Also update the individual collection records
        const updatePromises = collections.map(async (collection, index) => {
            const fullCollection = await loadSingleCollection(collection.uid);
            if (fullCollection) {
                fullCollection.order = index;
                fullCollection.lastUpdated = Date.now();
                await saveSingleCollection(fullCollection, false); // Don't force timestamp since we're setting it
            }
        });
        
        await Promise.all(updatePromises);
        
        return true;
        
    } catch (error) {
        console.error('Failed to update collection order:', error);
        return false;
    }
};

// ========================================
// ORPHAN COLLECTION REPAIR
// ========================================

/**
 * Detect and repair orphan collections
 * Orphan collections are those with a parentId that points to a non-existent folder.
 * This can happen due to:
 * - Sync race conditions (collections sync before folders)
 * - Folder deletion that didn't properly clean up parentId references
 * - Incomplete sync where folder data was lost
 * 
 * This function finds orphan collections and resets their parentId to null,
 * effectively moving them to the root level so they become visible again.
 * 
 * @returns {Promise<{success: boolean, orphansFound: number, orphansRepaired: number, orphanUids: string[]}>}
 */
export const repairOrphanCollections = async () => {
    try {
        // Load collections index and folders index
        const collectionsIndex = await loadCollectionsIndex();
        const foldersIndex = await loadFoldersIndex();
        
        // Get set of valid folder UIDs
        const validFolderUids = new Set(Object.keys(foldersIndex));
        
        // Find orphan collections (have parentId but folder doesn't exist)
        const orphanUids = [];
        for (const [uid, meta] of Object.entries(collectionsIndex)) {
            if (meta.parentId && !validFolderUids.has(meta.parentId)) {
                orphanUids.push(uid);
            }
        }
        
        if (orphanUids.length === 0) {
            return { 
                success: true, 
                orphansFound: 0, 
                orphansRepaired: 0, 
                orphanUids: [] 
            };
        }
        
        console.warn(`⚠️ Found ${orphanUids.length} orphan collection(s) with invalid parentId references:`, orphanUids);
        
        // Repair each orphan collection
        let orphansRepaired = 0;
        for (const uid of orphanUids) {
            try {
                // Update collection index
                collectionsIndex[uid].parentId = null;
                
                // Load and update the full collection record
                const collection = await loadSingleCollection(uid);
                if (collection) {
                    collection.parentId = null;
                    // Don't update lastUpdated - this is a repair operation, not a user edit
                    const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
                    await browser.storage.local.set({
                        [collectionKey]: collection
                    });
                    orphansRepaired++;
                }
            } catch (err) {
                console.error(`Failed to repair orphan collection ${uid}:`, err);
            }
        }
        
        // Save updated collections index
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: collectionsIndex
        });
        
        console.log(`✅ Repaired ${orphansRepaired}/${orphanUids.length} orphan collection(s)`);
        
        return { 
            success: true, 
            orphansFound: orphanUids.length, 
            orphansRepaired, 
            orphanUids 
        };
        
    } catch (error) {
        console.error('Failed to repair orphan collections:', error);
        return { 
            success: false, 
            orphansFound: 0, 
            orphansRepaired: 0, 
            orphanUids: [],
            error: error.message 
        };
    }
}; 
