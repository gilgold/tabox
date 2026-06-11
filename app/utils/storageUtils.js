/**
 * Advanced Storage Utilities for Tabox Collections
 * Implements collections index and lazy loading for improved performance
 */

import { browser } from '../../static/globals';
import { STORAGE_KEYS, CURRENT_STORAGE_VERSION } from './sharedConstants';
import { assessMigrationSupport40 } from './migrationSupport40';
import { withDataSafetyGuard } from './migrationSafety';

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
 * Restore storage to a pre-transaction snapshot WITHOUT clearing the storage area.
 *
 * `browser.storage.local.clear()` is intentionally avoided: it is not atomic with the
 * subsequent restore, so an interruption (the popup closing, the service worker being
 * killed, a quota error) between clear and set permanently destroys all data. Instead
 * we diff against the snapshot and touch only the keys that actually changed.
 *
 * Safety: an empty/failed snapshot ({} from a failed read) must never trigger a wipe,
 * so the "remove added keys" pass is skipped when the snapshot is empty.
 * @param {object} snapshot - Storage contents captured before the transaction
 * @returns {Promise<void>}
 */
const restoreStorageSnapshot = async (snapshot) => {
    if (!snapshot || Object.keys(snapshot).length === 0) {
        // Nothing trustworthy to restore from - do not risk deleting live data.
        return;
    }

    const current = await getAllStorageData();

    // Restore keys that the transaction modified or deleted.
    const restore = {};
    Object.keys(snapshot).forEach((key) => {
        if (JSON.stringify(current[key]) !== JSON.stringify(snapshot[key])) {
            restore[key] = snapshot[key];
        }
    });

    // Remove keys that the transaction added (present now, absent in the snapshot).
    const removeKeys = Object.keys(current).filter(
        (key) => !Object.prototype.hasOwnProperty.call(snapshot, key)
    );

    if (Object.keys(restore).length > 0) {
        await browser.storage.local.set(restore);
    }
    if (removeKeys.length > 0) {
        await browser.storage.local.remove(removeKeys);
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

            await restoreStorageSnapshot(fullSnapshot);

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

const loadDeletedFolderTombstones = async () => {
    try {
        const { [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: tombstones } = await browser.storage.local.get(STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES);
        return tombstones || {};
    } catch (error) {
        console.error('Failed to load deleted folder tombstones:', error);
        return {};
    }
};

const clearDeletedFolderTombstones = async (uids = []) => {
    if (!Array.isArray(uids) || uids.length === 0) {
        return;
    }

    const tombstones = await loadDeletedFolderTombstones();
    let changed = false;

    uids.forEach((uid) => {
        if (tombstones[uid]) {
            delete tombstones[uid];
            changed = true;
        }
    });

    if (changed) {
        await browser.storage.local.set({
            [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: tombstones
        });
    }
};

const markDeletedFolderTombstones = async (uids = [], deletedAt = Date.now()) => {
    if (!Array.isArray(uids) || uids.length === 0) {
        return;
    }

    const tombstones = await loadDeletedFolderTombstones();
    uids.forEach((uid) => {
        tombstones[uid] = deletedAt;
    });

    await browser.storage.local.set({
        [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: tombstones
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
            order: resolvedOrder,
            // collectionToSave is merged from the existing stored record, so a partial
            // update that omits isFavorite/favoriteOrder inherits them from storage
            isFavorite: collectionToSave.isFavorite === true,
            ...(collectionToSave.isFavorite === true && typeof collectionToSave.favoriteOrder === 'number'
                ? { favoriteOrder: collectionToSave.favoriteOrder }
                : {})
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
 * Decide whether IN-PLACE repair of indexed records is needed.
 *
 * IMPORTANT: this NEVER signals "rebuild from tabsArray". The indexed
 * collection_<uid> records are the source of truth; tabsArray is a frozen,
 * write-stale mirror and is never authoritative. We only report repair when an
 * indexed record is missing its backing data or required metadata fields.
 */
const checkIfMigrationNeedsRepair = async (existingIndex) => {
    try {
        if (!existingIndex || Object.keys(existingIndex).length === 0) {
            return false;
        }

        const uidsToCheck = Object.keys(existingIndex).slice(0, 3);
        for (const uid of uidsToCheck) {
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const result = await browser.storage.local.get(collectionKey);
            const collection = result[collectionKey];

            if (!collection || !Array.isArray(collection.tabs)) {
                return true;
            }

            const indexMeta = existingIndex[uid];
            const recordMissingMetadata = (
                collection.lastUpdated === undefined ||
                collection.lastOpened === undefined ||
                collection.order === undefined
            );
            const indexMissingMetadata = (
                indexMeta.lastUpdated === undefined ||
                indexMeta.lastOpened === undefined ||
                indexMeta.order === undefined
            );
            if (recordMissingMetadata || indexMissingMetadata) {
                return true;
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

        return false;
    } catch (error) {
        // If we cannot check, DO NOT assume rebuild. Returning false keeps live data
        // untouched (the data-safety guard is the backstop). Returning true here used
        // to trigger a destructive rebuild — that is exactly the #102 bug.
        console.error('Error checking migration repair needs:', error);
        return false;
    }
};

/**
 * Migrate / repair indexed storage. ADDITIVE ONLY.
 *
 * The indexed collection_<uid> records are the source of truth. The legacy
 * tabsArray is a frozen, write-stale mirror; it may only contribute collections
 * whose uid is entirely absent from the index AND not tombstoned. Existing
 * records are never overwritten or reverted — only missing metadata is repaired
 * in place. (See #102.)
 */
/** @private — always invoke via migrateLegacyStorage, which wraps this in withDataSafetyGuard. */
const migrateLegacyStorageUnsafe = async () => {
    try {
        const storageData = await browser.storage.local.get([
            STORAGE_KEYS.STORAGE_VERSION,
            STORAGE_KEYS.COLLECTIONS_INDEX,
            STORAGE_KEYS.LEGACY_TABS_ARRAY,
        ]);

        const version = storageData[STORAGE_KEYS.STORAGE_VERSION];
        const existingIndex = storageData[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tabsArray = storageData[STORAGE_KEYS.LEGACY_TABS_ARRAY];

        const supportAssessment = assessMigrationSupport40(await browser.storage.local.get(null));
        if (!supportAssessment.supported) {
            return { success: false, unsupportedPre40: true, error: 'Automatic migration is only supported for 4.0+ local data' };
        }

        const hasIndex = Object.keys(existingIndex).length > 0;
        const hasLegacyData = Array.isArray(tabsArray) && tabsArray.length > 0;

        // Fast path: only safe to skip when the index is healthy AND there is no
        // frozen tabsArray that could still contribute recoverable orphan collections.
        if (version >= CURRENT_STORAGE_VERSION && hasIndex && !hasLegacyData) {
            const needsRepair = await checkIfMigrationNeedsRepair(existingIndex);
            if (!needsRepair) {
                return { success: true, migrated: false };
            }
        }

        const tombstones = await loadDeletedCollectionTombstones();
        const folderTombstones = await loadDeletedFolderTombstones();

        const nextIndex = { ...existingIndex };
        const savePromises = [];
        let addedCount = 0;
        let repairedCount = 0;

        // Repair metadata IN PLACE on existing indexed records (never revert content).
        // Batch all existing records in ONE storage read; collect patches into a
        // single payload so we make at most one set call for the whole repair pass.
        const existingRecords = await loadMultipleCollections(Object.keys(existingIndex));
        const patchedPayload = {};
        for (const uid of Object.keys(existingIndex)) {
            const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const existing = existingRecords[uid];
            if (!existing) continue;

            const order = existing.order !== undefined ? existing.order : (existingIndex[uid].order !== undefined ? existingIndex[uid].order : 999999); // missing order → sort last (sentinel)
            const lastUpdated = existing.lastUpdated !== undefined && existing.lastUpdated !== null
                ? existing.lastUpdated
                : (existing.createdOn || Date.now());
            const lastOpened = existing.lastOpened !== undefined ? existing.lastOpened : null;

            const needsRecordPatch = existing.order === undefined || existing.lastUpdated === undefined || existing.lastOpened === undefined;
            if (needsRecordPatch) {
                patchedPayload[key] = { ...existing, order, lastUpdated, lastOpened };
                repairedCount++;
            }

            nextIndex[uid] = {
                ...existingIndex[uid],
                type: 'collection',
                tabCount: Array.isArray(existing.tabs) ? existing.tabs.length : (existingIndex[uid].tabCount || 0),
                order: existingIndex[uid].order !== undefined ? existingIndex[uid].order : order,
                lastUpdated: existingIndex[uid].lastUpdated !== undefined ? existingIndex[uid].lastUpdated : lastUpdated,
                lastOpened: existingIndex[uid].lastOpened !== undefined ? existingIndex[uid].lastOpened : lastOpened,
                parentId: existingIndex[uid].parentId !== undefined ? existingIndex[uid].parentId : (existing.parentId !== undefined ? existing.parentId : null),
            };
        }

        // ONE batched write for all coalesced metadata patches.
        if (Object.keys(patchedPayload).length > 0) {
            savePromises.push(browser.storage.local.set(patchedPayload));
        }

        // Add collections that exist ONLY in the frozen tabsArray, gated by tombstones.
        if (Array.isArray(tabsArray) && tabsArray.length > 0) {
            for (const [collectionIndex, collection] of tabsArray.entries()) {
                if (!collection || !collection.uid) continue;
                const uid = collection.uid;
                if (existingIndex[uid]) continue;        // live record wins — never overwrite/revert
                if (tombstones[uid]) continue;           // user deleted it — never resurrect

                const normalized = {
                    ...collection,
                    uid,
                    name: collection.name || 'Untitled Collection',
                    tabs: collection.tabs || [],
                    createdOn: collection.createdOn || Date.now(),
                    lastUpdated: collection.lastUpdated != null ? collection.lastUpdated : Date.now(),
                    lastOpened: collection.lastOpened != null ? collection.lastOpened : null,
                    color: collection.color || 'default',
                    parentId: collection.parentId !== undefined ? collection.parentId : null,
                    order: collection.order !== undefined ? collection.order : collectionIndex,
                };

                const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
                savePromises.push(browser.storage.local.set({ [key]: normalized }));
                nextIndex[uid] = {
                    name: normalized.name,
                    type: 'collection',
                    tabCount: normalized.tabs.length,
                    lastUpdated: normalized.lastUpdated,
                    lastOpened: normalized.lastOpened,
                    createdOn: normalized.createdOn,
                    color: normalized.color,
                    size: JSON.stringify(normalized).length,
                    parentId: normalized.parentId,
                    order: normalized.order,
                };
                addedCount++;
            }
        }

        // Folders: repair in place, never drop, skip tombstoned.
        const existingFoldersIndex = (await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX))[STORAGE_KEYS.FOLDERS_INDEX] || {};
        const folderUids = Object.keys(existingFoldersIndex).filter((uid) => !folderTombstones[uid]);
        const existingFolders = folderUids.length > 0 ? await loadMultipleFolders(folderUids) : {};
        const nextFoldersIndex = {};

        // Precompute collection counts per parent once (O(collections)) instead of
        // scanning nextIndex per folder (O(folders × collections)).
        const collectionCountByParent = {};
        Object.values(nextIndex).forEach((m) => {
            if (m.parentId != null) {
                collectionCountByParent[m.parentId] = (collectionCountByParent[m.parentId] || 0) + 1;
            }
        });

        folderUids.forEach((uid, folderIndex) => {
            const meta = existingFoldersIndex[uid] || {};
            const record = existingFolders[uid] || {};
            const createdOn = record.createdOn || meta.createdOn || Date.now();
            const lastUpdated = record.lastUpdated != null ? record.lastUpdated : (meta.lastUpdated != null ? meta.lastUpdated : createdOn);
            const order = record.order !== undefined ? record.order : (meta.order !== undefined ? meta.order : folderIndex);

            const normalizedFolder = {
                uid,
                name: record.name || meta.name || 'Untitled Folder',
                type: 'folder',
                color: record.color || meta.color || 'var(--folder-default-color)',
                collapsed: record.collapsed !== undefined ? record.collapsed : (meta.collapsed !== undefined ? meta.collapsed : false),
                createdOn,
                lastUpdated,
                order,
            };

            const recordNeedsPatch = record.lastUpdated === undefined || record.order === undefined || record.createdOn === undefined;
            if (recordNeedsPatch) {
                savePromises.push(browser.storage.local.set({ [`${STORAGE_KEYS.FOLDER_PREFIX}${uid}`]: normalizedFolder }));
            }

            nextFoldersIndex[uid] = {
                name: normalizedFolder.name,
                type: 'folder',
                color: normalizedFolder.color,
                collapsed: normalizedFolder.collapsed,
                collectionCount: collectionCountByParent[uid] || 0,
                lastUpdated: normalizedFolder.lastUpdated,
                createdOn: normalizedFolder.createdOn,
                order: normalizedFolder.order,
                size: JSON.stringify(normalizedFolder).length,
            };
        });

        await Promise.all(savePromises);
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: nextIndex,
            [STORAGE_KEYS.FOLDERS_INDEX]: nextFoldersIndex,
            [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION,
        });

        const migrated = addedCount > 0 || repairedCount > 0;
        const totalTabs = Object.values(nextIndex).reduce((sum, meta) => sum + (meta.tabCount || 0), 0);

        return { success: true, migrated, count: Object.keys(nextIndex).length, totalTabs };
    } catch (error) {
        console.error('❌ Migration failed:', error);
        return { success: false, error: error.message };
    }
};

export const migrateLegacyStorage = () =>
    withDataSafetyGuard('migrateLegacyStorage', migrateLegacyStorageUnsafe);

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
                    const collectionWithoutOrder = { ...normalizedCollection };
                    delete collectionWithoutOrder.order;
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

            // Favorite fields: prefer incoming values, fall back to the existing
            // index entry so stale in-memory objects can't silently un-favorite.
            // resolvedFavoriteOrder is only persisted when resolvedIsFavorite is true.
            const resolvedIsFavorite = collection.isFavorite !== undefined
                ? collection.isFavorite === true
                : existingIndexEntry.isFavorite === true;
            const resolvedFavoriteOrder = collection.favoriteOrder !== undefined
                ? collection.favoriteOrder
                : existingIndexEntry.favoriteOrder;

            collectionForStorage.isFavorite = resolvedIsFavorite;
            if (resolvedIsFavorite && typeof resolvedFavoriteOrder === 'number') {
                collectionForStorage.favoriteOrder = resolvedFavoriteOrder;
            } else {
                delete collectionForStorage.favoriteOrder;
            }

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
                parentId: collectionForStorage.parentId || null,
                isFavorite: resolvedIsFavorite,
                ...(resolvedIsFavorite && typeof resolvedFavoriteOrder === 'number'
                    ? { favoriteOrder: resolvedFavoriteOrder }
                    : {})
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
export const saveSingleFolder = async (folder, forceUpdateTimestamp = false) => {
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

        // A saved folder is live again - clear any stale deletion tombstone for it.
        await clearDeletedFolderTombstones([folder.uid]);

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
        const deletedAt = Date.now();

        // Remove from storage
        await browser.storage.local.remove(folderKey);

        // Update index
        const foldersIndex = await loadFoldersIndex();
        delete foldersIndex[uid];

        await browser.storage.local.set({
            [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex
        });

        // Record a tombstone so the deletion propagates to other devices, instead
        // of the folder being resurrected by the timestamp-based merge heuristic.
        await markDeletedFolderTombstones([uid], deletedAt);

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
 * Detect and repair index/storage inconsistencies for collections.
 *
 * Handles two classes of corruption that older code could produce:
 * - Ghost entries: index references a collection whose storage record is gone
 *   (e.g. a concurrent folder-delete that raced on the shared index and left
 *   dangling pointers - the "found in index but not in storage" warning). These
 *   are pruned from the index so they stop being requested on every load.
 * - Orphan collections: index entry has a parentId pointing at a non-existent
 *   folder (sync races, lost folder data). These are moved back to root level
 *   so they become visible again.
 *
 * Both fixes are local index/storage hygiene, applied in a single index write.
 *
 * @returns {Promise<{success: boolean, orphansFound: number, orphansRepaired: number, orphanUids: string[], ghostsPruned: number, ghostUids: string[]}>}
 */
export const repairOrphanCollections = async () => {
    const emptyResult = {
        success: true,
        orphansFound: 0,
        orphansRepaired: 0,
        orphanUids: [],
        ghostsPruned: 0,
        ghostUids: [],
    };

    try {
        // Load collections index and folders index
        const collectionsIndex = await loadCollectionsIndex();
        const foldersIndex = await loadFoldersIndex();

        const indexedUids = Object.keys(collectionsIndex);
        if (indexedUids.length === 0) {
            return emptyResult;
        }

        // Get set of valid folder UIDs
        const validFolderUids = new Set(Object.keys(foldersIndex));

        // Single read to find which indexed collections actually have storage records.
        // loadMultipleCollections omits any uid whose storage key is missing.
        const storedCollections = await loadMultipleCollections(indexedUids);

        // Ghost entries: in the index but with no backing storage record.
        const ghostUids = indexedUids.filter(uid => !storedCollections[uid]);

        // Orphan collections: backing record exists but parentId points nowhere.
        // (Ghosts are excluded - they're being pruned, not repaired.)
        const orphanUids = indexedUids.filter(uid => (
            storedCollections[uid] &&
            collectionsIndex[uid].parentId &&
            !validFolderUids.has(collectionsIndex[uid].parentId)
        ));

        if (ghostUids.length === 0 && orphanUids.length === 0) {
            return emptyResult;
        }

        let indexChanged = false;

        // Prune ghost index entries.
        if (ghostUids.length > 0) {
            console.warn(`⚠️ Pruning ${ghostUids.length} ghost index entr(ies) with no backing storage:`, ghostUids);
            ghostUids.forEach((uid) => {
                delete collectionsIndex[uid];
            });
            indexChanged = true;
        }

        // Repair each orphan collection (reset parentId to null in index + storage).
        let orphansRepaired = 0;
        if (orphanUids.length > 0) {
            console.warn(`⚠️ Found ${orphanUids.length} orphan collection(s) with invalid parentId references:`, orphanUids);
            for (const uid of orphanUids) {
                try {
                    const collection = storedCollections[uid];
                    collection.parentId = null;
                    // Don't update lastUpdated - this is a repair operation, not a user edit
                    const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
                    await browser.storage.local.set({
                        [collectionKey]: collection
                    });
                    collectionsIndex[uid].parentId = null;
                    indexChanged = true;
                    orphansRepaired++;
                } catch (err) {
                    console.error(`Failed to repair orphan collection ${uid}:`, err);
                }
            }
        }

        // Save updated collections index once.
        if (indexChanged) {
            await browser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: collectionsIndex
            });
        }

        if (orphanUids.length > 0) {
            console.log(`✅ Repaired ${orphansRepaired}/${orphanUids.length} orphan collection(s)`);
        }
        if (ghostUids.length > 0) {
            console.log(`✅ Pruned ${ghostUids.length} ghost index entr(ies)`);
        }

        return {
            success: true,
            orphansFound: orphanUids.length,
            orphansRepaired,
            orphanUids,
            ghostsPruned: ghostUids.length,
            ghostUids,
        };

    } catch (error) {
        console.error('Failed to repair orphan collections:', error);
        return {
            ...emptyResult,
            success: false,
            error: error.message
        };
    }
};
