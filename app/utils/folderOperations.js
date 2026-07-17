/**
 * Folder Operations Service
 * Provides CRUD operations for folders and collection-folder relationships
 */

import { showUndoToast, showSuccessToast } from '../toastHelpers';
import { UNDO_TIME } from '../constants';
import { FaTrash } from 'react-icons/fa';
import TaboxFolder from '../model/TaboxFolder';
import TaboxCollection from '../model/TaboxCollection';
import { generateCopyName, applyUid } from '../utils';
import { 
    saveSingleFolder, 
    loadSingleFolder, 
    deleteSingleFolder, 
    loadAllFolders, 
    updateFoldersOrder,
    updateFolderCollectionCount,
    saveSingleCollection,
    loadSingleCollection,
    batchDeleteCollections,
    batchUpdateCollections,
    loadCollectionsIndex,
    loadAllCollections
} from './storageUtils';
import { triggerBackgroundSync } from './sharedSync';
import { useTrackedSync } from '../useTrackedSync';
import { canEditFolder, isSharedFolder } from './sharedFolderUtils';
import { browser } from '../../static/globals';

// ========================================
// FOLDER CRUD OPERATIONS
// ========================================

/**
 * Create a new folder
 * @param {string} name - Folder name
 * @param {string} color - Folder color (optional)
 * @returns {Promise<TaboxFolder|null>} Created folder or null if failed
 */
export const createFolder = async (name, color = null, collapsed = false) => {
    try {
        if (!name || name.trim() === '') {
            throw new Error('Folder name is required');
        }

        const existingFolders = await loadAllFolders({
            metadataOnly: false,
            sortBy: 'order',
            sortOrder: 'asc',
        });
        const folder = new TaboxFolder(name.trim(), color, null, null, collapsed);
        folder.order = 0;
        const success = await saveSingleFolder(folder, true); // Force timestamp update for new folders

        if (success) {
            const reorderedFolders = [folder, ...existingFolders];
            const orderSaved = await updateFoldersOrder(reorderedFolders);
            if (!orderSaved) {
                console.warn(`⚠️ Failed to persist folder order for new folder: ${name}`);
            }

            // Ensure storage is committed before triggering sync
            await new Promise(resolve => setTimeout(resolve, 100));
            await triggerBackgroundSync();
            
            return folder;
        } else {
            console.error(`❌ Failed to create folder: ${name}`);
            return null;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        return null;
    }
};

/**
 * Update an existing folder
 * @param {object} folder - Updated folder object
 * @param {boolean} forceUpdateTimestamp - Whether to update lastUpdated timestamp
 * @returns {Promise<boolean>} Success status
 */
export const updateFolder = async (folder, forceUpdateTimestamp = false) => {
    try {
        if (!folder || !folder.uid) {
            throw new Error('Folder object with UID is required');
        }

        const success = await saveSingleFolder(folder, forceUpdateTimestamp);

        if (success) {
            // Ensure storage is committed before triggering sync
            await new Promise(resolve => setTimeout(resolve, 100));
            await triggerBackgroundSync();
            
            return true;
        } else {
            console.error(`❌ Failed to update folder: ${folder.name}`);
            return false;
        }
    } catch (error) {
        console.error('Error updating folder:', error);
        return false;
    }
};

/**
 * Update folder details with a single persisted write.
 * Useful for edit flows that can change more than one field at once.
 * @param {string} folderId - Folder UID
 * @param {{name?: string, color?: string}} updates - Folder fields to update
 * @returns {Promise<boolean>} Success status
 */
export const updateFolderDetails = async (folderId, updates = {}) => {
    try {
        if (!folderId) {
            throw new Error('Folder ID is required');
        }

        const folder = await loadSingleFolder(folderId);
        if (!folder) {
            throw new Error(`Folder ${folderId} not found`);
        }

        // Permission guard: read-only shared folders cannot be renamed/recolored.
        if (!canEditFolder(folder)) {
            return false;
        }

        const nextName = updates.name !== undefined ? updates.name.trim() : folder.name;
        const nextColor = updates.color !== undefined ? updates.color : folder.color;

        if (!nextName) {
            throw new Error('Folder name is required');
        }

        const hasNameChange = nextName !== folder.name;
        const hasColorChange = nextColor !== folder.color;

        if (!hasNameChange && !hasColorChange) {
            return true;
        }

        folder.name = nextName;
        folder.color = nextColor;
        folder.lastUpdated = Date.now();

        const success = await updateFolder(folder, true);

        // I1 review fix: rename/recolor was only ever saved locally — a shared
        // folder's edit silently reverted on the next pull (applyDeltaLocally
        // always refreshes folder meta FROM the server, which never learned
        // about this local edit). Push it to the server too, for any shared
        // folder this device can edit (canEditFolder above already blocked
        // read-only access, so reaching here means owner/write). Fire-and-forget:
        // never block the UI on the network round-trip; a failure self-heals
        // by reverting on the next pull (acceptable per design).
        if (success && isSharedFolder(folder)) {
            browser.runtime.sendMessage({
                type: 'sharedUpdateFolderMeta',
                folderId: folder.uid,
                name: nextName,
                color: nextColor,
            }).catch(() => {});
        }

        return success;
    } catch (error) {
        console.error('Error updating folder details:', error);
        return false;
    }
};

/**
 * Delete a folder (only if empty)
 * @param {string} folderId - Folder UID to delete
 * @param {boolean} force - Force delete even if not empty (moves collections to root)
 * @param {boolean} deleteCollections - If true, delete collections instead of moving to root
 * @returns {Promise<{success: boolean, collectionsMovedToRoot?: number, collectionsDeleted?: number}>} Result
 */
export const deleteFolder = async (folderId, force = false, deleteCollections = false, { skipSync = false } = {}) => {
    try {
        if (!folderId) {
            throw new Error('Folder ID is required');
        }

        // Permission guard: a folder carrying a live `shared` marker can never be
        // plain-deleted here, regardless of role - including the owner. Members
        // must use "Leave Shared Folder" and owners must "Stop Sharing" first;
        // the popup UI already hides plain Delete for every shared folder via
        // buildFolderMenuItems, so this enforces the same rule at the data layer
        // (which every caller - popup, full-page, command palette - goes through).
        const folder = await loadSingleFolder(folderId);
        if (isSharedFolder(folder)) {
            return { blocked: true };
        }

        // Check if folder has collections
        const collectionsIndex = await loadCollectionsIndex();
        const collectionsInFolder = Object.entries(collectionsIndex)
            .filter(([, meta]) => meta.parentId === folderId)
            .map(([uid, meta]) => ({ uid, ...meta }));

        if (collectionsInFolder.length > 0 && !force) {
            console.warn(`⚠️ Cannot delete folder ${folderId}: contains ${collectionsInFolder.length} collections`);
            return { success: false, reason: 'Folder is not empty' };
        }

        let collectionsMovedToRoot = 0;
        let collectionsDeleted = 0;

        // If forcing delete, either delete collections or move them to root
        if (collectionsInFolder.length > 0 && force) {
            if (deleteCollections) {
                const validMetas = collectionsInFolder.filter(m => {
                    if (!m.uid) { console.error('⚠️ Skipping collection with undefined UID:', m); return false; }
                    return true;
                });
                // Delete in a single atomic index pass. Running deleteSingleCollection
                // concurrently races on the shared collections_index (lost update),
                // leaving stale index entries for already-removed storage keys.
                const ok = await batchDeleteCollections(validMetas.map(m => m.uid));
                collectionsDeleted = ok ? validMetas.length : 0;
                if (!ok) console.warn(`⚠️ Failed to delete collections for folder ${folderId}`);
            } else {
                const validMetas = collectionsInFolder.filter(m => {
                    if (!m.uid) { console.error('⚠️ Skipping collection with undefined UID:', m); return false; }
                    return true;
                });
                const loaded = await Promise.all(validMetas.map(m => loadSingleCollection(m.uid)));
                const collectionsToMove = loaded
                    .filter((collection, i) => {
                        if (!collection) { console.warn(`⚠️ Collection ${validMetas[i].uid} not found in storage, skipping`); return false; }
                        return true;
                    })
                    .map(collection => {
                        collection.parentId = null;
                        return collection;
                    });
                // Move in a single atomic index pass to avoid racing on collections_index.
                const ok = await batchUpdateCollections(collectionsToMove);
                collectionsMovedToRoot = ok ? collectionsToMove.length : 0;
                if (!ok) console.warn(`⚠️ Failed to move collections to root for folder ${folderId}`);
            }
        }

        const success = await deleteSingleFolder(folderId);

        if (success) {
            // By default, await the sync so the deletion reliably reaches the remote
            // before the popup can tear down (Manifest V3 service worker lifecycle);
            // an un-awaited call returns before the updateRemote round-trip dispatches.
            // Callers that want to show their toast immediately and reflect a
            // "Syncing..." indicator pass skipSync and drive the sync themselves.
            if (!skipSync) {
                await triggerBackgroundSync();
            }

            return { success: true, collectionsMovedToRoot, collectionsDeleted };
        } else {
            console.error(`❌ Failed to delete folder: ${folderId}`);
            return { success: false };
        }
    } catch (error) {
        console.error('Error deleting folder:', error);
        console.error('Error details:', {
            folderId,
            force,
            errorMessage: error.message,
            errorStack: error.stack
        });
        return { success: false, error: error.message };
    }
};

/**
 * Duplicate a folder (including all collections inside it)
 * @param {string} folderId - Folder UID to duplicate
 * @returns {Promise<{success: boolean, newFolder?: TaboxFolder, duplicatedCollections?: number}>} Result
 */
export const duplicateFolder = async (folderId) => {
    try {
        if (!folderId) {
            throw new Error('Folder ID is required');
        }

        // Load the folder to duplicate
        const originalFolder = await loadSingleFolder(folderId);
        if (!originalFolder) {
            throw new Error(`Folder ${folderId} not found`);
        }

        // Load all folders to generate unique name
        const allFolders = await loadAllFolders();
        
        // Generate unique copy name using the same convention as collections
        const newName = generateCopyName(originalFolder.name, allFolders);

        // Create new folder with same properties but new UID and name
        const newFolder = new TaboxFolder(
            newName,
            originalFolder.color,
            null, // createdAt - will be set to now
            null, // lastUpdated - will be set to now
            true // collapsed - keep collapsed after duplication
        );

        // Save the new folder
        const folderSaved = await saveSingleFolder(newFolder, true);
        if (!folderSaved) {
            throw new Error('Failed to save duplicated folder');
        }

        // Get all collections in the original folder
        const collectionsInFolder = await getFolderCollections(folderId);
        let duplicatedCollections = 0;

        // Duplicate each collection into the new folder
        if (collectionsInFolder.length > 0) {
            // Load all collections to generate unique names
            const allCollections = await loadAllCollections();

            for (const collection of collectionsInFolder) {
                try {
                    const collectionNewName = generateCopyName(collection.name, allCollections);
                    const clonedTabs = JSON.parse(JSON.stringify(collection.tabs || []));
                    const clonedGroups = JSON.parse(JSON.stringify(collection.chromeGroups || []));
                    let duplicateCollection = new TaboxCollection(
                        collectionNewName,
                        clonedTabs,
                        clonedGroups,
                        collection.color,
                        null,
                        collection.window,
                        null,
                        null
                    );
                    duplicateCollection = applyUid(duplicateCollection);
                    duplicateCollection.parentId = newFolder.uid;
                    await saveSingleCollection(duplicateCollection, true);
                    allCollections.push(duplicateCollection);
                    duplicatedCollections++;
                } catch (collectionError) {
                    console.error(`Error duplicating collection ${collection.name}:`, collectionError);
                }
            }
        }

        // Update folder collection count
        await updateFolderCollectionCount(newFolder.uid);

        // Await the sync so the duplicate reliably reaches the remote before the
        // operation resolves (and before the popup can tear down). Matches the
        // awaited sync in createFolder/updateFolder.
        await triggerBackgroundSync();

        return {
            success: true,
            newFolder,
            duplicatedCollections
        };
    } catch (error) {
        console.error('Error duplicating folder:', error);
        return { success: false, error: error.message };
    }
};

// ========================================
// COLLECTION-FOLDER RELATIONSHIP OPERATIONS
// ========================================

/**
 * Move a collection into a folder
 * @param {string} collectionId - Collection UID
 * @param {string} folderId - Target folder UID
 * @returns {Promise<boolean>} Success status
 */
export const moveCollectionToFolder = async (collectionId, folderId) => {
    try {
        if (!collectionId || !folderId) {
            throw new Error('Collection ID and Folder ID are required');
        }

        // Verify folder exists
        const folder = await loadSingleFolder(folderId);
        if (!folder) {
            throw new Error(`Folder ${folderId} not found`);
        }

        // Load and update collection
        const collection = await loadSingleCollection(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const oldParentId = collection.parentId;

        // Permission guard: block moves touching a read-only shared folder
        // (either end) without writing anything.
        const sourceFolder = oldParentId ? await loadSingleFolder(oldParentId) : null;
        if (!canEditFolder(folder) || !canEditFolder(sourceFolder)) {
            return { blocked: true };
        }

        collection.parentId = folderId;
        collection.lastUpdated = Date.now();

        const success = await saveSingleCollection(collection, true);

        if (success) {
            // Update folder collection counts
            await updateFolderCollectionCount(folderId);
            
            // Update old parent folder count if exists
            if (oldParentId) {
                await updateFolderCollectionCount(oldParentId);
                // Note: Empty folders are kept and can receive new collections via drag-and-drop
            }

            // Ensure storage is committed before triggering sync
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Trigger sync for collection movement
            await triggerBackgroundSync();

            return true;
        } else {
            console.error(`❌ Failed to move collection ${collectionId} to folder ${folderId}`);
            return false;
        }
    } catch (error) {
        console.error('Error moving collection to folder:', error);
        return false;
    }
};

/**
 * Remove a collection from its folder (move to root)
 * @param {string} collectionId - Collection UID
 * @returns {Promise<boolean>} Success status
 */
export const removeCollectionFromFolder = async (collectionId) => {
    try {
        if (!collectionId) {
            throw new Error('Collection ID is required');
        }

        // Load and update collection
        const collection = await loadSingleCollection(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const oldParentId = collection.parentId;
        if (!oldParentId) {
            return true;
        }

        // Permission guard: removing a collection from its folder edits that
        // folder's contents, so a read-only shared source folder blocks it too -
        // mirrors moveCollectionToFolder's internal check.
        const sourceFolder = await loadSingleFolder(oldParentId);
        if (!canEditFolder(sourceFolder)) {
            return { blocked: true };
        }

        collection.parentId = null;
        collection.lastUpdated = Date.now();

        const success = await saveSingleCollection(collection, true);

        if (success) {
            // Update old folder collection count
            await updateFolderCollectionCount(oldParentId);
            
            // Note: Empty folders are kept and can receive new collections via drag-and-drop

            // Ensure storage is committed before triggering sync
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Trigger sync for collection removal from folder
            await triggerBackgroundSync();

            return true;
        } else {
            console.error(`❌ Failed to remove collection ${collectionId} from folder`);
            return false;
        }
    } catch (error) {
        console.error('Error removing collection from folder:', error);
        return false;
    }
};

/**
 * Get all collections in a folder
 * @param {string} folderId - Folder UID
 * @returns {Promise<array>} Collections in the folder
 */
export const getFolderCollections = async (folderId) => {
    try {
        if (!folderId) return [];

        const collectionsIndex = await loadCollectionsIndex();
        const collectionUids = Object.keys(collectionsIndex).filter(uid => 
            collectionsIndex[uid].parentId === folderId
        );

        if (collectionUids.length === 0) return [];

        // Load full collection data
        const collections = await loadAllCollections({ 
            metadataOnly: false 
        });

        return collections.filter(collection => collection.parentId === folderId);
    } catch (error) {
        console.error('Error getting folder collections:', error);
        return [];
    }
};

// ========================================
// FOLDER STATE OPERATIONS
// ========================================

/**
 * Toggle folder collapsed state
 * @param {string} folderId - Folder UID
 * @returns {Promise<boolean>} New collapsed state (true if collapsed, false if expanded)
 */
export const toggleFolderCollapsed = async (folderId) => {
    try {
        if (!folderId) {
            throw new Error('Folder ID is required');
        }

        const folder = await loadSingleFolder(folderId);
        if (!folder) {
            throw new Error(`Folder ${folderId} not found`);
        }

        folder.collapsed = !folder.collapsed;
        // Don't update lastUpdated for simple UI state changes

        const success = await saveSingleFolder(folder, false, true); // Suppress logging for UI state changes

        if (success) {
            // Don't log simple UI state changes - too verbose
            return folder.collapsed;
        } else {
            console.error(`❌ Failed to toggle folder ${folderId} collapsed state`);
            return !folder.collapsed; // Return original state
        }
    } catch (error) {
        console.error('Error toggling folder collapsed state:', error);
        return false;
    }
};

/**
 * Update folder name
 * @param {string} folderId - Folder UID
 * @param {string} newName - New folder name
 * @returns {Promise<boolean>} Success status
 */
export const updateFolderName = async (folderId, newName) => {
    return updateFolderDetails(folderId, { name: newName });
};

/**
 * Update folder color
 * @param {string} folderId - Folder UID
 * @param {string} newColor - New folder color
 * @returns {Promise<boolean>} Success status
 */
export const updateFolderColor = async (folderId, newColor) => {
    return updateFolderDetails(folderId, { color: newColor });
};

// ========================================
// REACT HOOK FOR UI COMPONENTS
// ========================================

/**
 * React hook for folder operations in UI components
 * @param {object} options - Hook options
 * @returns {object} Folder operation functions and state
 */
export function useFolderOperations({
    folder,
    updateRemoteData,
    onFolderUpdate,
    onFolderDelete
}) {
    const runTrackedSync = useTrackedSync();

    const handleDeleteFolder = async (force = false, deleteCollections = false) => {
        try {
            // Load current state for undo
            const allFolders = await loadAllFolders();
            const allCollections = await loadAllCollections();

            // Perform the local deletion only; we drive the sync ourselves below so
            // the success toast can appear immediately (the sync takes a few seconds).
            const result = await deleteFolder(folder.uid, force, deleteCollections, { skipSync: true });

            if (result.success) {
                // Notify parent component
                if (onFolderDelete) {
                    onFolderDelete(folder.uid, result.collectionsMovedToRoot || 0);
                }

                // Create message based on what happened
                const actionMessage = result.collectionsDeleted > 0
                    ? ` (${result.collectionsDeleted} collections deleted)`
                    : result.collectionsMovedToRoot > 0
                        ? ` (${result.collectionsMovedToRoot} collections moved to root)`
                        : '';

                // Show the toast immediately, before the sync round-trip.
                if (!deleteCollections || result.collectionsDeleted === 0) {
                    showUndoToast(
                        <FaTrash />,
                        `Folder deleted successfully${actionMessage}`,
                        folder.name,
                        async () => {
                            // Undo by restoring previous folders and collections
                            // Save all folders
                            for (const f of allFolders) {
                                await saveSingleFolder(f);
                            }
                            // Save all collections
                            for (const c of allCollections) {
                                await saveSingleCollection(c);
                            }
                            // Trigger data refresh
                            await updateRemoteData(allCollections);
                        },
                        UNDO_TIME
                    );
                } else {
                    // Simple success message when collections were deleted (no undo possible)
                    showSuccessToast(`Folder and ${result.collectionsDeleted} collections deleted successfully`);
                }

                // Now sync to remote while showing the "Syncing..." indicator. Awaiting
                // keeps the popup/service worker alive until the deletion reaches Drive.
                await runTrackedSync();

                return true;
            } else {
                console.error('Failed to delete folder:', result.reason);
                return false;
            }
        } catch (error) {
            console.error('Error in handleDeleteFolder:', error);
            return false;
        }
    };

    const handleUpdateFolderName = async (newName) => {
        try {
            const success = await updateFolderName(folder.uid, newName);
            
            // Name changes need to update the folder object for UI consistency
            if (success && onFolderUpdate) {
                const updatedFolder = await loadSingleFolder(folder.uid);
                onFolderUpdate(updatedFolder);
            }

            return success;
        } catch (error) {
            console.error('Error in handleUpdateFolderName:', error);
            return false;
        }
    };

    const handleUpdateFolderColor = async (newColor) => {
        try {
            const success = await updateFolderColor(folder.uid, newColor);
            
            // Color changes need to update the folder object for UI to reflect the change
            if (success && onFolderUpdate) {
                const updatedFolder = await loadSingleFolder(folder.uid);
                onFolderUpdate(updatedFolder);
            }

            return success;
        } catch (error) {
            console.error('Error in handleUpdateFolderColor:', error);
            return false;
        }
    };

    const handleToggleCollapsed = async () => {
        try {
            const newCollapsedState = await toggleFolderCollapsed(folder.uid);
            
            // For collapse/expand operations, we don't need to reload all data
            // Just update the local folder state - the parent will handle UI updates
            // if (onFolderUpdate) {
            //     const updatedFolder = await loadSingleFolder(folder.uid);
            //     onFolderUpdate(updatedFolder);
            // }

            return newCollapsedState;
        } catch (error) {
            console.error('Error in handleToggleCollapsed:', error);
            return folder.collapsed;
        }
    };

    return {
        handleDeleteFolder,
        handleUpdateFolderName,
        handleUpdateFolderColor,
        handleToggleCollapsed
    };
} 
