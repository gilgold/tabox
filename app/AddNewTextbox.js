import React, { useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import './AddNewTextbox.css';
import { searchState } from './atoms/globalAppSettingsState';
import { highlightedCollectionUidState } from './atoms/animationsState';
import { getCurrentTabsAndGroups, getAllWindowsTabsAndGroups } from './utils';
import { browser } from '../static/globals';
import { triggerBackgroundSync } from './utils/sharedSync';
import { showErrorToast } from './toastHelpers';
import { IoClose } from 'react-icons/io5';
import { HiOutlineDesktopComputer, HiCollection } from 'react-icons/hi';
import AiSuggestNameButton from './AiSuggestNameButton';
import { isSingleWindowBrowser } from './utils/platform';
import SingleWindowTabsNote from './SingleWindowTabsNote';
import { suggestCollectionName } from './ai/tasks/suggestCollectionName';
import { suggestFolderName } from './ai/tasks/suggestFolderName';
import { canEditFolder, isSharedFolder } from './utils/sharedFolderUtils';
import { getColorValue } from './utils/colorMigration';
import { useTrackedSync } from './useTrackedSync';
import { loadSingleFolder } from './utils/storageUtils';

function SaveHighlightedOnlyLabel({ saveMode, windowCount }) {
    const [totalHighlighted, setTotalHighlighted] = useState(0);

    useEffect(() => {
        const fetchHighlightedCount = async () => {
            if (isSingleWindowBrowser()) return; // no multi-select on Firefox for Android
            const windowId = await browser.windows.WINDOW_ID_CURRENT;
            const total = (await browser.tabs.query({ highlighted: true, windowId: windowId })).length;
            setTotalHighlighted(total);
        };
        
        fetchHighlightedCount();
    }, [])

    // Show for "all" mode or when highlighted tabs > 1 in "current" mode
    const shouldShow = saveMode === 'all' || totalHighlighted > 1;
    
    if (!shouldShow) return null;

    if (saveMode === 'all') {
        return (
            <span className="highlighted_note">
                <span className="highlighter">{windowCount} windows</span>
            </span>
        );
    }

    return (
        <span className="highlighted_note">
            <span className="highlighter">{totalHighlighted} selected</span> tabs
        </span>
    );
}

function WindowChoiceToggle({ saveMode, setSaveMode, windowCount, disabled = false }) {
    const isDisabled = disabled || windowCount <= 1;

    const handleCurrentClick = () => {
        if (!isDisabled) {
            setSaveMode('current');
        }
    };

    const handleAllClick = () => {
        if (!isDisabled) {
            setSaveMode('all');
        }
    };

    return (
        <div data-tooltip-class-name="small-tooltip" data-tooltip-id="main-tooltip" data-tooltip-content={isDisabled ? "Only available when multiple Chrome windows are open" : ""} className={`window-choice-toggle ${isDisabled ? 'disabled' : ''} ${saveMode === 'current' ? 'current-active' : 'all-active'}`}>
            <button 
                type="button"
                className={`mode-toggle-btn ${saveMode === 'current' ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={handleCurrentClick}
                disabled={isDisabled}
                aria-label="Save current window as collection"
                data-tooltip-id="main-tooltip" data-tooltip-content={isDisabled ? "Only one window open" : "Save current window as collection"}
                data-tooltip-class-name="small-tooltip"
            >
                <HiOutlineDesktopComputer />
            </button>
            <button 
                type="button"
                className={`mode-toggle-btn ${saveMode === 'all' ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={handleAllClick}
                disabled={isDisabled}
                aria-label="Save all windows as folder"
                data-tooltip-id="main-tooltip" data-tooltip-content={isDisabled ? "Only one window open" : "Save all windows as folder"}
                data-tooltip-class-name="small-tooltip"
            >
                <HiCollection />
            </button>
        </div>
    );
}

const useFocus = () => {
    const htmlElRef = useRef(null)
    const setFocus = () => { htmlElRef.current && htmlElRef.current.focus() }

    return [htmlElRef, setFocus]
}

function AddNewTextbox({ addCollection, addFolder, onDataUpdate, folders = [] }) {

    const [collectionName, setName] = useState("");
    const [disabled, setDisabled] = useState(false);
    const [inputRef, setInputFocus] = useFocus();
    const setSearch = useSetAtom(searchState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const [hideClear, setHideClear] = useState(true);
    const [saveMode, setSaveMode] = useState('current'); // 'current' or 'all'
    const [windowCount, setWindowCount] = useState(1);
    const [aiBusy, setAiBusy] = useState(false);
    const [destinationId, setDestinationId] = useState('');
    const savingRef = useRef(false);
    const writableFolders = folders.filter(canEditFolder);
    const destination = writableFolders.find(folder => folder.uid === destinationId);
    const destinationUnavailable = Boolean(destinationId && !destination);
    const trackedSync = useTrackedSync();

    useEffect(() => {
        setInputFocus();
        // Check how many windows are open
        checkWindowCount();
    }, [])

    useEffect(() => {
        if (collectionName === "") {
            setHideClear(true);
        } else {
            setHideClear(false);
        }
    }, [collectionName]);

    const checkWindowCount = async () => {
        try {
            const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
            setWindowCount(windows.length);
            
            // If only one window, always use current mode
            if (windows.length <= 1) {
                setSaveMode('current');
            }
        } catch (error) {
            console.error('Failed to get window count:', error);
            setWindowCount(1);
        }
    };

    const scrollToCollectionsAndHighlight = (collectionUid) => {
        // Clear any existing highlight first to prevent double highlighting
        setHighlightedCollectionUid(null);
        
        // Wait for UI to update, then scroll to collections section and highlight
        setTimeout(() => {
            // Find the collections section header to scroll to
            const allSectionTitles = document.querySelectorAll('.section-header .section-title');
            const collectionsHeader = Array.from(allSectionTitles).find(el => el.textContent.trim() === 'Collections');
            const scrollContainer = document.querySelector('.settings_body');
            const firstCollection = document.querySelector('.setting_row, .collection-tile');
            
            if (collectionsHeader && scrollContainer) {
                // Scroll to the collections section header (center it in viewport for better visibility)
                collectionsHeader.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
                
                // Wait for scroll animation to complete before highlighting
                setTimeout(() => {
                    setHighlightedCollectionUid(collectionUid);
                    
                    // Clear highlight after a few seconds
                    setTimeout(() => {
                        setHighlightedCollectionUid(null);
                    }, 3000);
                }, 600); // Wait for smooth scroll to finish
                
            } else if (firstCollection && scrollContainer) {
                // Scroll to the first collection if no header found
                firstCollection.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
                
                setTimeout(() => {
                    setHighlightedCollectionUid(collectionUid);
                    
                    setTimeout(() => {
                        setHighlightedCollectionUid(null);
                    }, 3000);
                }, 600);
                
            } else if (scrollContainer) {
                // Fallback: scroll to top if collections header not found (no folders exist)
                scrollContainer.scrollTop = 0;
                
                // Highlight after a brief delay even without scroll animation
                setTimeout(() => {
                    setHighlightedCollectionUid(collectionUid);
                    
                    setTimeout(() => {
                        setHighlightedCollectionUid(null);
                    }, 3000);
                }, 300); // Slightly longer delay to ensure UI is settled
            }
        }, 50);
    };

    const resetSavedForm = () => {
        setSearch('');
        setName('');
        setDestinationId('');
    };

    const handleSave = async () => {
        if (savingRef.current) return;
        if (collectionName.trim() === '') {
            showErrorToast('Please enter a name for the collection');
            return;
        }
        
        if (saveMode === 'current' && destinationUnavailable) {
            showErrorToast('The destination folder is no longer available or writable. Choose another destination.');
            return;
        }

        savingRef.current = true;
        setDisabled(true);
        
        try {
            if (saveMode === 'all' && windowCount > 1) {
                // Save all windows as a folder with collections
                const { folder, collections } = await getAllWindowsTabsAndGroups(collectionName);
                
                // First create the folder with collapsed state
                const createdFolder = await addFolder(folder.name, folder.color, folder.collapsed);
                if (!createdFolder) {
                    throw new Error('Failed to create folder');
                }
                
                // Then add all collections to the folder (skip context menu updates and state updates to prevent race conditions)
                const addedCollections = [];
                const failedCollections = [];
                for (const collection of collections) {
                    collection.parentId = createdFolder.uid;
                    const success = await addCollection(collection, true, true); // Skip context menu update and state update
                    if (success) {
                        addedCollections.push(collection);
                    } else {
                        failedCollections.push(collection);
                        console.error(`Failed to add collection "${collection.name}" to folder`);
                    }
                }
                
                // Report if any collections failed to save
                if (failedCollections.length > 0) {
                    console.error(`Failed to save ${failedCollections.length} out of ${collections.length} collections to folder`);
                }
                
                // Update folder collection count after all collections are added
                const { updateFolderCollectionCount } = await import('./utils/storageUtils');
                await updateFolderCollectionCount(createdFolder.uid);
                
                // Trigger context menu update once after all collections are added
                await browser.runtime.sendMessage({ type: 'addCollection' });
                
                await triggerBackgroundSync();
                
                // Force refresh data to update UI
                if (onDataUpdate) {
                    await onDataUpdate();
                }
                
                // Scroll to top and highlight first collection in the folder
                if (addedCollections.length > 0) {
                    scrollToCollectionsAndHighlight(addedCollections[0].uid);
                    // Show success toast
                    const { showSuccessToast } = await import('./toastHelpers');
                    showSuccessToast(`Folder created with ${addedCollections.length} collection${addedCollections.length > 1 ? 's' : ''}`);
                }
                resetSavedForm();
            } else {
                // Save current window as collection (existing behavior)
                const newItem = await getCurrentTabsAndGroups(collectionName);
                if (destinationId) newItem.parentId = destinationId;
                const success = await addCollection(newItem, false, true); // Skip state update to prevent immediate highlight
                if (!success) throw new Error('Failed to save collection');
                
                // Force refresh data to update UI
                if (onDataUpdate) {
                    await onDataUpdate();
                }
                
                // Scroll to top and highlight the new collection
                scrollToCollectionsAndHighlight(newItem.uid);
                
                // Show success toast
                const { showSuccessToast } = await import('./toastHelpers');
                showSuccessToast(`Collection "${collectionName}" created successfully`);
                resetSavedForm();
                // Sharing may have changed while tabs were being captured.
                // App routes the shared upload; only personal saves need Drive.
                const savedDestination = destinationId ? await loadSingleFolder(destinationId) : null;
                if (destinationId && !savedDestination) {
                    showErrorToast('Collection saved locally, but its destination could not be checked for sync. Refresh and try syncing again.');
                } else if (!isSharedFolder(savedDestination)) {
                    try {
                        await trackedSync({ updateLocalTimestamp: false });
                    } catch (error) {
                        showErrorToast(`Collection saved locally, but sync failed: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error saving:', error);
            showErrorToast(`Failed to save: ${error.message}`);
        }
        
        savingRef.current = false;
        setDisabled(false);
    }

    const _handleKeyDown = async (e) => {
        if (e.key === 'Enter') {
            await handleSave();
        }
    }

    const _handleInputChange = (e) => {
        setSearch(e.target.value.trim() !== '' ? e.target.value : null);
        setName(e.target.value);
    }

    const handleClear = () => {
        setSearch('');
        setName('');
        setInputFocus();
    }

    const suggestName = async () => {
        if (saveMode === 'all' && windowCount > 1) {
            const { collections } = await getAllWindowsTabsAndGroups('');
            return suggestFolderName({ collections });
        }
        const collection = await getCurrentTabsAndGroups('');
        return suggestCollectionName(collection);
    };

    return <section className='add-collections-wrapper'>
        <div className="left-controls-group">
            <div className={`add-collection-group${aiBusy ? ' ai-name-processing' : ''}`}>
                <input
                    type="text"
                    maxLength="50"
                    placeholder=" "
                    name="new_setting_title"
                    id="new_setting_title"
                    onKeyDown={async e => await _handleKeyDown(e)}
                    onChange={_handleInputChange}
                    ref={inputRef}
                    disabled={disabled}
                    value={collectionName} />
                <label className="textbox_label">Search or Add collections</label>
                <AiSuggestNameButton
                    suggest={suggestName}
                    onSuggested={(suggestedName) => {
                        setName(suggestedName);
                        setSearch(suggestedName);
                    }}
                    onBusyChange={setAiBusy}
                    disabled={disabled}
                />
                <button
                    className="clear-button"
                    style={{ opacity: hideClear ? '0' : '1' }}
                    disabled={hideClear || disabled}
                    onClick={handleClear}>
                    <IoClose size="16px" />
                </button>
            </div>
            
            <div className="add-button-container">
                <button
                    id="add_new_setting"
                    disabled={disabled}
                    className="add-new-collection-btn"
                    onClick={handleSave}
                >
                    <span>
                        {saveMode === 'all' && windowCount > 1 ? 'Add Folder' : 'Add Collection'}
                    </span>
                </button>
            </div>
            
            <SingleWindowTabsNote />
            {!isSingleWindowBrowser() && (
                <div className="window-toggle-container">
                    <WindowChoiceToggle 
                        saveMode={saveMode} 
                        setSaveMode={setSaveMode} 
                        windowCount={windowCount}
                        disabled={disabled}
                    />
                    <SaveHighlightedOnlyLabel saveMode={saveMode} windowCount={windowCount} />
                </div>
            )}
        </div>
        {saveMode === 'current' && (writableFolders.length > 0 || destinationId) && (
            <div className="quick-save-destination">
                <label htmlFor="quick-save-folder">Save To</label>
                <div className="quick-save-folder-wrapper">
                    {destination && (
                        <span className="quick-save-folder-dot" aria-hidden="true" style={{
                            backgroundColor: destination.color && destination.color !== 'default'
                                ? getColorValue(destination.color) : 'var(--primary-color)',
                        }} />
                    )}
                    <select
                        id="quick-save-folder"
                        value={destinationId}
                        onChange={event => setDestinationId(event.target.value)}
                        disabled={disabled}
                        className={destination ? 'has-folder-dot' : ''}
                    >
                        <option value="">Root level (no folder)</option>
                        {destinationUnavailable && <option value={destinationId} disabled>Destination unavailable — choose another folder</option>}
                        {writableFolders.map(folder => <option key={folder.uid} value={folder.uid}>{folder.name}</option>)}
                    </select>
                </div>
            </div>
        )}
    </section>;
}

export default AddNewTextbox;
