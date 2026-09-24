import React from 'react';
import { useSetAtom } from 'jotai';
import { FaTrash, FaRegCheckCircle } from 'react-icons/fa';
import { downloadTextFile, getCurrentTabsAndGroups, generateCopyName, applyUid } from './utils';
import { showUndoToast, showInfoToast } from './toastHelpers';
import { UNDO_TIME } from './constants';
import { browser } from '../static/globals';
import TaboxCollection from './model/TaboxCollection';
import { loadAllCollections, deleteSingleCollection, updateFolderCollectionCount } from './utils/storageUtils';
import { getNextFavoriteOrder } from './utils/favoritesUtils';
import { noPermissionOpenState } from './atoms/sharedFoldersState';
import { canEditFolder, guardFolderEdit } from './utils/sharedFolderUtils';
import { getDisplayInfo } from './utils/displayInfo';

export const openCollectionTabs = async ({
    collectionToOpen,
    trackOpenedWindow = true
}) => {
    const { chkOpenNewWindow } = await browser.storage.local.get('chkOpenNewWindow');

    // Check if collection was saved from incognito
    const wasFromIncognito = collectionToOpen.savedFromIncognito === true;
    let incognitoAllowed = false;

    // If collection was from incognito, check if we can open in incognito
    if (wasFromIncognito && chkOpenNewWindow) {
        try {
            const incognitoCheck = await browser.runtime.sendMessage({ type: 'checkIncognitoAccess' });
            incognitoAllowed = incognitoCheck?.allowed === true;
        } catch (error) {
            console.warn('Could not check incognito access:', error);
        }
    }

    // New-window path: build the window-creation spec here (bounds clamping needs
    // getDisplayInfo, which falls back to the popup's window.screen on Firefox) but
    // send it to the background WITHOUT creating the window first. On Firefox,
    // focusing a brand-new window destroys the popup document immediately, so any
    // popup-side code after `windows.create()` - including the `sendMessage` call
    // itself - never ran, leaving a blank window. The background now creates the
    // window (including the incognito fallback, replicated in
    // chrome/background.js's `createOpenTabsWindow`) and opens the tabs atomically
    // in response to a single message sent before any window exists.
    let msg;
    if (chkOpenNewWindow) {
        let windowCreationObject = { focused: true };

        // Try to open in incognito if the collection was from incognito and we have permission
        if (wasFromIncognito && incognitoAllowed) {
            windowCreationObject.incognito = true;
        }

        if (collectionToOpen.window && !windowCreationObject.incognito) {
            // Window position only applies to normal windows
            try {
                const displays = await getDisplayInfo();

                let targetBounds = {
                    top: Math.round(collectionToOpen.window.top),
                    left: Math.round(collectionToOpen.window.left),
                    width: Math.round(collectionToOpen.window.width),
                    height: Math.round(collectionToOpen.window.height)
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
                windowCreationObject.width = collectionToOpen.window.width;
                windowCreationObject.height = collectionToOpen.window.height;
            }
        }

        msg = {
            type: 'openTabs',
            collection: collectionToOpen,
            createWindowSpec: windowCreationObject,
            newWindow: true,
            trackOpenedWindow
        };
    } else {
        const window = await browser.windows.getCurrent({ populate: true, windowTypes: ['normal'] });
        msg = {
            type: 'openTabs',
            collection: collectionToOpen,
            window,
            newWindow: false,
            trackOpenedWindow
        };
    }

    const result = await browser.runtime.sendMessage(msg);

    // Show feedback for incognito-related scenarios
    if (result && typeof result === 'object') {
        if (result.wasFromIncognito && !result.restoredToIncognito && !result.isIncognitoWindow) {
            // Collection was from incognito but opened in normal window
            showInfoToast(
                `Opened in normal window (saved from incognito${!incognitoAllowed ? ' - enable "Allow in incognito" to restore to incognito' : ''})`,
                4000
            );
        }
        if (result.skippedForIncognito > 0) {
            showInfoToast(
                `${result.skippedForIncognito} tab(s) skipped - not allowed in incognito`,
                4000
            );
        }
        // skippedForFileAccess is intentionally NOT toasted here: opening the
        // collection shifts focus to the opened tabs/window, tearing this popup
        // down before a toast could render. The background persists
        // fileAccessNoticePending instead, and App.js's
        // initFileAccessNoticeWatcher surfaces it in whichever view can
        // actually display it (live in full-page, next open for the popup).
    }

    // `lastOpened` is intentionally NOT stamped here anymore. The background
    // `openTabs` handler (chrome/background.js) already persists it
    // authoritatively for every path - including this one - via
    // `markCollectionOpenedBG`, which runs (and resolves, since `result` above
    // awaited it) before this line. Stamping it again here was always
    // redundant on Chrome and, on Firefox, this code never even ran for the
    // new-window path (the popup document is destroyed the instant the new
    // window takes focus) - which was the root cause of this bug for the
    // window itself and would have silently dropped `lastOpened` too. The
    // popup UI picks the change up via its `browser.storage.onChanged`
    // listener (see app/App.js), same as any other background-driven write.

    return result;
};

export function useCollectionOperations({
    collection,
    updateCollection,
    updateRemoteData,
    setIsAutoUpdate,
    setExpanded,
    isExpanded,
    setDeletingCollectionUids,
    addCollection,
    onDataUpdate,
    folders = []
}) {
    const setNoPermissionOpen = useSetAtom(noPermissionOpenState);

    // Undo restores collections by uid; skip any whose parent folder is now a
    // read-only share so an undo can't bypass the permission guard.
    const filterRestorableCollections = (collectionsToRestore) => (
        collectionsToRestore.filter((c) => canEditFolder(folders.find((f) => f.uid === c.parentId)))
    );

    const _handleDelete = async () => {
        const parentFolder = folders.find((f) => f.uid === collection.parentId);
        if (!guardFolderEdit(parentFolder, () => setNoPermissionOpen(true))) return;

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
            
            // IMPORTANT: Load fresh data from storage instead of using stale React state
            // This fixes a bug where rapid deletions would restore previously deleted items
            // because the setTimeout callback had a stale closure of removeCollection/settingsData
            const freshCollections = await loadAllCollections();
            await updateRemoteData(freshCollections);
            
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

        // Show undo toast
        showUndoToast(
            <FaTrash />,
            'Collection deleted successfully',
            collection.name,
            async () => {
                // Undo delete by restoring previous collections, skipping any
                // that now live in a read-only shared folder.
                await updateRemoteData(filterRestorableCollections(previousCollections));
                if (onDataUpdate) {
                    await onDataUpdate();
                }
            },
            UNDO_TIME
        );
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
                null // lastOpened - null for new duplicate
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

    const _handleToggleFavorite = async () => {
        if (collection.isFavorite === true) {
            await updateCollection({ ...collection, isFavorite: false, favoriteOrder: null });
        } else {
            const favoriteOrder = await getNextFavoriteOrder();
            await updateCollection({ ...collection, isFavorite: true, favoriteOrder });
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
                } catch {
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
        newItem.parentId = collection.parentId; // Preserve folder assignment (fixes eject bug)
        await updateCollection(newItem, true); // Pass true for manual update to trigger lightning effect
        
        showUndoToast(
            <FaRegCheckCircle />,
            `Collection updated ${chkEnableAutoUpdate && chkManualUpdateLinkCollection ? 'and linked to window' : ''} successfully`,
            collection.name,
            async () => {
                // Undo update by restoring previous collections, skipping any
                // that now live in a read-only shared folder.
                await updateRemoteData(filterRestorableCollections(previousCollections));
                if (onDataUpdate) {
                    await onDataUpdate();
                }
            },
            UNDO_TIME
        );
    };

    const _handleOpenTabs = async () => {
        if (await _isAutoUpdate()) {
            await _handleFocusWindow();
            return;
        }

        await openCollectionTabs({
            collectionToOpen: collection
        });
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

        // A tracking entry can go stale: the tracked window may be gone, or may no
        // longer contain any of the collection's tabs (e.g. the collection was opened
        // into the current window and its tabs were closed one by one — windows.onRemoved
        // never fires, so the entry lingers and "Open" would silently focus forever;
        // issue #90/#99). Verify before focusing; if stale, drop the entry and open.
        const stillOpenInWindow = await (async () => {
            try {
                const win = await browser.windows.get(activeWindowId, { populate: true });
                const collectionUrls = (collection.tabs || []).map(t => t.url).filter(Boolean);
                return (win.tabs || []).some(t =>
                    collectionUrls.some(u => t.url === u || (t.url && t.url.includes(encodeURIComponent(u)))));
            } catch {
                return false; // window no longer exists
            }
        })();
        if (!stillOpenInWindow) {
            await _handleStopTracking();
            await openCollectionTabs({ collectionToOpen: collection });
            return;
        }

        const msg = {
            type: 'focusWindow',
            windowId: activeWindowId
        };
        browser.runtime.sendMessage(msg);
        
        // Track that this collection was opened (auto-focus counts as opened).
        // Opening is never blocked by folder permissions, so skip the guard.
        const updatedCollection = {
            ...collection,
            lastOpened: Date.now(),
            __skipFolderGuard: true
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
        // Must mirror the row UI's loadAutoUpdateStatus (CollectionListItem.js): a
        // collection only behaves as auto-tracked when the auto-update setting is ON.
        // Every open registers a collectionsToTrack entry (trackOpenedWindow defaults
        // to true), so checking membership alone made _handleOpenTabs reroute every
        // second "Open" click to a window-focus no-op while the button still said
        // "Open" (issue #90/#99).
        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
        if (!chkEnableAutoUpdate) return false;
        let { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        collectionsToTrack = collectionsToTrack || [];
        return collectionsToTrack.some(c => c.collectionUid === collection.uid);
    };

    return {
        _handleDelete,
        _handleDuplicate,
        _handleToggleFavorite,
        _exportCollectionToFile,
        _handleUpdate,
        _handleOpenTabs,
        _handleExpand,
        _handleFocusWindow,
        _handleStopTracking,
        _isAutoUpdate
    };
} 
