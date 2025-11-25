/**
 * Folder Operations Service
 * Provides CRUD operations for folders and collection-folder relationships
 */

import { showUndoToast, showSuccessToast } from '../toastHelpers';
import { UNDO_TIME } from '../constants';
import { FaTrash } from 'react-icons/fa';
import { browser } from '../../static/globals';
import TaboxFolder from '../model/TaboxFolder';
import { 
    saveSingleFolder, 
    loadSingleFolder, 
    deleteSingleFolder, 
    loadAllFolders, 
    updateFolderCollectionCount,
    saveSingleCollection,
    loadSingleCollection,
    deleteSingleCollection,
    loadCollectionsIndex,
    loadAllCollections
} from './storageUtils';

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

        const folder = new TaboxFolder(name.trim(), color, null, null, collapsed);
        const success = await saveSingleFolder(folder, true); // Force timestamp update for new folders

        if (success) {
            // Trigger sync for folder creation
            await browser.storage.local.set({ localTimestamp: Date.now() });
            await browser.runtime.sendMessage({ type: 'addCollection' }); // Reuse existing sync trigger
            
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
            // Trigger sync for folder update
            await browser.storage.local.set({ localTimestamp: Date.now() });
            await browser.runtime.sendMessage({ type: 'addCollection' }); // Reuse existing sync trigger
            
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
 * Delete a folder (only if empty)
 * @param {string} folderId - Folder UID to delete
 * @param {boolean} force - Force delete even if not empty (moves collections to root)
 * @param {boolean} deleteCollections - If true, delete collections instead of moving to root
 * @returns {Promise<{success: boolean, collectionsMovedToRoot?: number, collectionsDeleted?: number}>} Result
 */
export const deleteFolder = async (folderId, force = false, deleteCollections = false) => {
    try {
        if (!folderId) {
            throw new Error('Folder ID is required');
        }

        // Check if folder has collections
        const collectionsIndex = await loadCollectionsIndex();
        const collectionsInFolder = Object.entries(collectionsIndex)
            .filter(([uid, meta]) => meta.parentId === folderId)
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
                for (const collectionMeta of collectionsInFolder) {
                    if (!collectionMeta.uid) {
                        console.error('⚠️ Skipping collection with undefined UID:', collectionMeta);
                        continue;
                    }
                    
                    const success = await deleteSingleCollection(collectionMeta.uid);
                    if (success) {
                        collectionsDeleted++;
                    } else {
                        console.warn(`⚠️ Failed to delete collection ${collectionMeta.uid}`);
                    }
                }
            } else {
                for (const collectionMeta of collectionsInFolder) {
                    if (!collectionMeta.uid) {
                        console.error('⚠️ Skipping collection with undefined UID:', collectionMeta);
                        continue;
                    }
                    
                    const collection = await loadSingleCollection(collectionMeta.uid);
                    if (collection) {
                        collection.parentId = null;
                        await saveSingleCollection(collection, true);
                        collectionsMovedToRoot++;
                    } else {
                        console.warn(`⚠️ Collection ${collectionMeta.uid} not found in storage, skipping`);
                    }
                }
            }
        }

        const success = await deleteSingleFolder(folderId);

        if (success) {
            // Trigger sync for folder deletion
            await browser.storage.local.set({ localTimestamp: Date.now() });
            await browser.runtime.sendMessage({ type: 'addCollection' }); // Reuse existing sync trigger
            
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
 * Check if a folder is empty (auto-delete if needed)
 * @param {string} folderId - Folder UID to check
 * @returns {Promise<boolean>} True if folder was auto-deleted
 */
export const checkAndAutoDeleteEmptyFolder = async (folderId) => {
    try {
        if (!folderId) return false;

        const collectionsIndex = await loadCollectionsIndex();
        const collectionsInFolder = Object.values(collectionsIndex).filter(c => c.parentId === folderId);

        if (collectionsInFolder.length === 0) {
            const result = await deleteFolder(folderId, false);
            return result.success;
        }

        return false;
    } catch (error) {
        console.error('Error checking empty folder:', error);
        return false;
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

            // Trigger sync for collection movement
            await browser.storage.local.set({ localTimestamp: Date.now() });
            await browser.runtime.sendMessage({ type: 'addCollection' }); // Reuse existing sync trigger

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

        collection.parentId = null;
        collection.lastUpdated = Date.now();

        const success = await saveSingleCollection(collection, true);

        if (success) {
            // Update old folder collection count
            await updateFolderCollectionCount(oldParentId);
            
            // Note: Empty folders are kept and can receive new collections via drag-and-drop

            // Trigger sync for collection removal from folder
            await browser.storage.local.set({ localTimestamp: Date.now() });
            await browser.runtime.sendMessage({ type: 'addCollection' }); // Reuse existing sync trigger

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
    try {
        if (!folderId || !newName || newName.trim() === '') {
            throw new Error('Folder ID and name are required');
        }

        const folder = await loadSingleFolder(folderId);
        if (!folder) {
            throw new Error(`Folder ${folderId} not found`);
        }

        folder.name = newName.trim();
        folder.lastUpdated = Date.now();

        return await updateFolder(folder, true);
    } catch (error) {
        console.error('Error updating folder name:', error);
        return false;
    }
};

/**
 * Update folder color
 * @param {string} folderId - Folder UID
 * @param {string} newColor - New folder color
 * @returns {Promise<boolean>} Success status
 */
export const updateFolderColor = async (folderId, newColor) => {
    try {
        if (!folderId || !newColor) {
            throw new Error('Folder ID and color are required');
        }

        const folder = await loadSingleFolder(folderId);
        if (!folder) {
            throw new Error(`Folder ${folderId} not found`);
        }

        folder.color = newColor;
        folder.lastUpdated = Date.now();

        return await updateFolder(folder, true);
    } catch (error) {
        console.error('Error updating folder color:', error);
        return false;
    }
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

    const handleDeleteFolder = async (force = false, deleteCollections = false) => {
        try {
            // Load current state for undo
            const allFolders = await loadAllFolders();
            const allCollections = await loadAllCollections();

            const result = await deleteFolder(folder.uid, force, deleteCollections);

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

                // Show success message with undo option (only if collections weren't deleted)
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

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Get folder hierarchy statistics
 * @returns {Promise<object>} Folder and collection statistics
 */
export const getFolderStats = async () => {
    try {
        const folders = await loadAllFolders();
        const collectionsIndex = await loadCollectionsIndex();
        
        const totalFolders = folders.length;
        const totalCollections = Object.keys(collectionsIndex).length;
        const collectionsInFolders = Object.values(collectionsIndex).filter(c => c.parentId).length;
        const rootCollections = totalCollections - collectionsInFolders;

        return {
            totalFolders,
            totalCollections,
            collectionsInFolders,
            rootCollections,
            folders: folders.map(folder => ({
                uid: folder.uid,
                name: folder.name,
                collectionCount: folder.collectionCount || 0,
                collapsed: folder.collapsed
            }))
        };
    } catch (error) {
        console.error('Error getting folder stats:', error);
        return {
            totalFolders: 0,
            totalCollections: 0,
            collectionsInFolders: 0,
            rootCollections: 0,
            folders: []
        };
    }
}; 