import React from 'react';
import { FaTrash, FaRegCheckCircle } from 'react-icons/fa';
import { downloadTextFile, getCurrentTabsAndGroups, generateCopyName, applyUid } from './utils';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { UNDO_TIME } from './constants';
import { browser } from '../static/globals';
import TaboxCollection from './model/TaboxCollection';
import { loadAllCollections, deleteSingleCollection, updateFolderCollectionCount } from './utils/storageUtils';

export function useCollectionOperations({
    collection,
    removeCollection,
    updateCollection,
    updateRemoteData,
    setIsAutoUpdate,
    setExpanded,
    index,
    isExpanded,
    setDeletingCollectionUids,
    addCollection,
    onDataUpdate
}) {
    const [openUpdateSnackbar, closeUpdateSnackbar] = useSnackbar({ 
        style: SnackbarStyle.SUCCESS, 
        closeStyle: { display: 'none' } 
    });
    const [openDeleteSnackbar, closeDeleteSnackbar] = useSnackbar({ 
        style: SnackbarStyle.SUCCESS, 
        closeStyle: { display: 'none' } 
    });

    const _handleDelete = async () => {
        // 🚀 NEW: Load current collections from NEW STORAGE for undo
        const previousCollections = await loadAllCollections();
        
        // Store parentId before deletion for folder count update
        const parentFolderId = collection.parentId;
        
        // Add to deleting set to trigger animation
        if (setDeletingCollectionUids) {
            setDeletingCollectionUids(prev => new Set([...prev, collection.uid]));
        }
        
        // Wait for animation to complete before actually deleting
        setTimeout(async () => {
            await _handleStopTracking();
            
            // Delete from new storage system first
            await deleteSingleCollection(collection.uid);
            
            const newList = removeCollection(collection.uid);
            await updateRemoteData(newList);
            
            // Update folder collection count if collection was in a folder
            if (parentFolderId) {
                await updateFolderCollectionCount(parentFolderId);
                
                // Force refresh data to update UI
                if (onDataUpdate) {
                    await onDataUpdate();
                }
            }
            
            // Remove from deleting set after deletion is complete
            if (setDeletingCollectionUids) {
                setDeletingCollectionUids(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(collection.uid);
                    return newSet;
                });
            }
        }, 400); // Animation duration (was 600ms, now 400ms)

        // Show undo snackbar
        openDeleteSnackbar(
            <SnackBarWithUndo
                icon={<FaTrash />}
                message={`Collection deleted successfully`}
                collectionName={collection.name}
                updateRemoteData={updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeDeleteSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
    };

    const _handleDuplicate = async () => {
        if (!addCollection) {
            console.error('addCollection prop is not available');
            return;
        }

        try {
            // Load all collections to generate unique name
            const allCollections = await loadAllCollections();
            
            // Generate unique copy name
            const newName = generateCopyName(collection.name, allCollections);
            
            // Deep clone tabs and chromeGroups to avoid read-only property errors
            const clonedTabs = JSON.parse(JSON.stringify(collection.tabs || []));
            const clonedGroups = JSON.parse(JSON.stringify(collection.chromeGroups || []));
            
            // Create new collection with same data but new UID and name
            let duplicateCollection = new TaboxCollection(
                newName,
                clonedTabs,
                clonedGroups,
                collection.color,
                null, // createdOn - will be set to now
                collection.window,
                null, // lastUpdated - will be set to now
                null  // lastOpened - null for new duplicate
            );
            
            // Apply unique IDs to tabs and groups
            duplicateCollection = applyUid(duplicateCollection);
            
            // If original collection is in a folder, put duplicate in same folder
            if (collection.parentId) {
                duplicateCollection.parentId = collection.parentId;
            }
            
            // Add the duplicate collection
            await addCollection(duplicateCollection);
            
            // Update folder collection count if collection is in a folder
            if (collection.parentId) {
                await updateFolderCollectionCount(collection.parentId);
            }
            
            // Force refresh data to update UI (similar to AddNewTextbox pattern)
            if (onDataUpdate) {
                await onDataUpdate();
            }
        } catch (error) {
            console.error('Error duplicating collection:', error);
        }
    };

    const _exportCollectionToFile = () => {
        downloadTextFile(JSON.stringify(collection), collection.name);
    };

    const _handleUpdate = async () => {
        // 🚀 NEW: Load current collections from NEW STORAGE for undo
        const previousCollections = await loadAllCollections();
        
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        const { chkManualUpdateLinkCollection } = await browser.storage.local.get('chkManualUpdateLinkCollection');
        
        if (chkEnableAutoUpdate && chkManualUpdateLinkCollection) {
            let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack') || [];
            const activeWindowId = collectionsToTrack.find(c => c.collectionUid === collection.uid)?.windowId;
            if (!activeWindowId) {
                let currentWindowId;
                try {
                    currentWindowId = (await browser.windows.get(browser.windows.WINDOW_ID_CURRENT)).id;
                } catch (error) {
                    console.log('Failed to get current window for tracking:', error.message);
                    return; // Exit early if we can't get the current window
                }

                const trackObj = {
                    collectionUid: collection.uid,
                    windowId: currentWindowId
                }
                collectionsToTrack.push(trackObj);
                await browser.storage.local.set({ collectionsToTrack: collectionsToTrack });
                if (setIsAutoUpdate) setIsAutoUpdate(true);
            }
        }
        
        let newItem = await getCurrentTabsAndGroups(collection.name);
        newItem.color = collection.color;
        newItem.uid = collection.uid;
        newItem.createdOn = collection.createdOn; // Preserve original creation time
        newItem.lastUpdated = Date.now(); // Set current time as last updated
        await updateCollection(newItem, true); // Pass true for manual update to trigger lightning effect
        
        openUpdateSnackbar(
            <SnackBarWithUndo
                icon={<FaRegCheckCircle />}
                message={`Collection updated ${chkEnableAutoUpdate && chkManualUpdateLinkCollection ? 'and linked to window' : ''} successfully`}
                collectionName={collection.name}
                updateRemoteData={updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeUpdateSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
    };

    const _handleOpenTabs = async () => {
        if (isExpanded) return;
        if (await _isAutoUpdate()) {
            await _handleFocusWindow();
            return;
        }
        
        const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');
        let window;
        if (chkOpenNewWindow) {
            let windowCreationObject = { focused: true };

            if (collection.window) {
                try {
                    const displays = await browser.system.display.getInfo();
                    const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
                    
                    let targetBounds = {
                        top: Math.round(collection.window.top),
                        left: Math.round(collection.window.left),
                        width: Math.round(collection.window.width),
                        height: Math.round(collection.window.height)
                    };

                    const isPositionValid = displays.some(display => {
                        const d = display.bounds;
                        const intersection = {
                            top: Math.max(d.top, targetBounds.top),
                            left: Math.max(d.left, targetBounds.left),
                            bottom: Math.min(d.top + d.height, targetBounds.top + targetBounds.height),
                            right: Math.min(d.left + d.width, targetBounds.left + targetBounds.width)
                        };

                        const intersectWidth = intersection.right - intersection.left;
                        const intersectHeight = intersection.bottom - intersection.top;

                        if (intersectWidth <= 0 || intersectHeight <= 0) return false;

                        const intersectArea = intersectWidth * intersectHeight;
                        const windowArea = targetBounds.width * targetBounds.height;
                        const visiblePercentage = windowArea > 0 ? (intersectArea / windowArea) : 0;
                        
                        return visiblePercentage >= 0.5;
                    });

                    if (isPositionValid) {
                        windowCreationObject = { ...windowCreationObject, ...targetBounds };
                    } else {
                        windowCreationObject.width = targetBounds.width;
                        windowCreationObject.height = targetBounds.height;
                    }
                } catch (error) {
                    console.error('Error validating window position:', error);
                    windowCreationObject.width = collection.window.width;
                    windowCreationObject.height = collection.window.height;
                }
            }
            window = await browser.windows.create(windowCreationObject);
            window.tabs = await browser.tabs.query({ windowId: window.id });
        } else {
            window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
        }
        
        const msg = {
            type: 'openTabs',
            collection: collection,
            window: window
        };
        await browser.runtime.sendMessage(msg);
        
        // Track that this collection was opened
        const updatedCollection = {
            ...collection,
            lastOpened: Date.now()
        };
        await updateCollection(updatedCollection); // No lightning effect for open tracking
    };

    const _handleExpand = () => {
        if (setExpanded) {
            setExpanded(!isExpanded);
        }
    };

    const _handleFocusWindow = async () => {
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack') || [];
        const activeWindowId = collectionsToTrack.find(c => c.collectionUid === collection.uid)?.windowId;
        if (!activeWindowId) return;
        
        const msg = {
            type: 'focusWindow',
            windowId: activeWindowId
        };
        browser.runtime.sendMessage(msg);
        
        // Track that this collection was opened (auto-focus counts as opened)
        const updatedCollection = {
            ...collection,
            lastOpened: Date.now()
        };
        await updateCollection(updatedCollection); // No lightning effect for auto-focus tracking
    };

    const _handleStopTracking = async () => {
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        if (setIsAutoUpdate) setIsAutoUpdate(false);
        if (!collectionsToTrack || collectionsToTrack == {}) return;
        const activeCollections = collectionsToTrack.map(c => c.collectionUid);
        const collectionIsActive = activeCollections.includes(collection.uid);
        if (!collectionIsActive) return;
        const newCollectionsToTrack = collectionsToTrack.filter(c => c.collectionUid !== collection.uid);
        await browser.storage.local.set({ collectionsToTrack: newCollectionsToTrack });
    };

    const _isAutoUpdate = async () => {
        let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        collectionsToTrack = collectionsToTrack || [];
        return collectionsToTrack.some(c => c.collectionUid === collection.uid);
    };

    return {
        _handleDelete,
        _handleDuplicate,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleExpand,
        _handleFocusWindow,
        _handleStopTracking,
        _isAutoUpdate
    };
} 