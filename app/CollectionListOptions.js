import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { settingsDataState } from './atoms/globalAppSettingsState';
import { highlightedCollectionUidState } from './atoms/animationsState';
import './CollectionListOptions.css';
import { PiGridNineFill } from "react-icons/pi";
import { browser } from '../static/globals';
import Select, { components } from 'react-select';
import { 
    MdAccessTime,
    MdArrowUpward,
    MdArrowDownward,
    MdPalette,
    MdOpenInNew,
    MdHistory,
    MdSortByAlpha,
    MdViewList,
    MdCreateNewFolder,
} from 'react-icons/md';
import { TbFileImport } from 'react-icons/tb';
import Modal from 'react-modal';
import { CollectionFilter } from './CollectionFilter';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { Tooltip } from 'react-tooltip';
import { loadBrowserSessions, subscribeToBrowserSessions } from './utils/browserSessions';


// Lazy load rarely-used modals for better performance
const SessionsModal = lazy(() => import('./SessionsModal').then(module => ({ default: module.SessionsModal })));
const CreateFolderModal = lazy(() => import('./CreateFolderModal'));


const sortOptions = [
    { value: 'DATE', label: 'Date', icon: MdAccessTime },
    { value: 'NAME', label: 'Name', icon: MdSortByAlpha },
    { value: 'COLOR', label: 'Color', icon: MdPalette }
];

function SortOption(props) {
    const { icon: Icon } = props.data;

    return (
        <components.Option {...props}>
            <div className="toolbar-select-option">
                <Icon size={16} />
                <span>{props.label}</span>
            </div>
        </components.Option>
    );
}

function SortSingleValue(props) {
    const { icon: Icon } = props.data;

    return (
        <components.SingleValue {...props}>
            <div className="toolbar-select-single-value">
                <Icon size={16} />
                <span>{props.data.label}</span>
            </div>
        </components.SingleValue>
    );
}

export function CollectionListOptions(props) {
    const settingsData = useAtomValue(settingsDataState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);
    const [sortType, setSortType] = useState('DATE');
    const [sortAscending, setSortAscending] = useState(true);
    const [openInNewWindow, setOpenInNewWindow] = useState(false);
    const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
    const [sessionList, setSessionList] = useState([]);
    const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'
    const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
    const isMountedRef = useRef(true);
    const fileInputRef = useRef(null);
    const menuPortalTarget = typeof document !== 'undefined' ? document.body : null;

    useEffect(() => {
        const loadData = async () => {
            try {
                // Load saved preferences - use props.selected if available, otherwise load from storage
                const selectedValue = props.selected || await browser.storage.local.get('currentSortValue').then(result => result.currentSortValue);
                const { chkOpenNewWindow, collectionViewMode, currentSortAscending } = await browser.storage.local.get(['chkOpenNewWindow', 'collectionViewMode', 'currentSortAscending']);
                
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    if (selectedValue) {
                        setSortType(selectedValue);
                    }
                    // Load ascending/descending preference
                    // Handle both boolean and string values (for backward compatibility)
                    if (currentSortAscending !== undefined) {
                        // Convert string "true"/"false" to boolean if needed
                        const sortAscendingValue = typeof currentSortAscending === 'string' 
                            ? currentSortAscending === 'true' 
                            : currentSortAscending;
                        setSortAscending(sortAscendingValue);
                    } else {
                        // Default to ascending if not set
                        setSortAscending(true);
                    }
                    setOpenInNewWindow(chkOpenNewWindow || false);
                    const loadedViewMode = collectionViewMode || 'list';
                    setViewMode(loadedViewMode);
                    // Sync with parent component
                    if (props.onViewModeChange) {
                        props.onViewModeChange(loadedViewMode);
                    }
                }

                const sessions = await loadBrowserSessions();
                
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    setSessionList(sessions);
                }
            } catch (error) {
                console.error('Error loading CollectionListOptions data:', error);
            }
        };

        loadData();

        const unsubscribe = subscribeToBrowserSessions(async () => {
            const sessions = await loadBrowserSessions();
            if (isMountedRef.current) {
                setSessionList(sessions);
            }
        });

        return () => {
            isMountedRef.current = false;
            unsubscribe();
        };
    }, []);

    const handleSort = async (sortBy, ascending = sortAscending) => {
        if (!settingsData || settingsData.length === 0) return;
        
        // CRITICAL: Load ALL collections from storage to ensure we clear order from all of them
        // This includes collections in folders, not just root-level collections
        const { loadAllCollections, batchUpdateCollections } = await import('./utils/storageUtils');
        
        // Map sort type to storage field name
        const sortFieldMap = {
            'DATE': 'lastUpdated',
            'NAME': 'name',
            'COLOR': 'color'
        };
        const sortByField = sortFieldMap[sortBy] || 'lastUpdated';
        const sortOrder = ascending ? 'asc' : 'desc';
        
        // Load all collections WITHOUT sort params first to get them all (order might affect sorting)
        const allCollectionsFromStorage = await loadAllCollections({ 
            metadataOnly: false,
            sortBy: sortByField,
            sortOrder: sortOrder
        });
        
        // Set order to null for ALL collections (including those in folders)
        // This explicitly signals to batchUpdateCollections to clear the order field
        // which allows user-selected sorting to take precedence over manual drag-and-drop ordering
        const allCollectionsWithClearedOrder = allCollectionsFromStorage.map(collection => ({
            ...collection,
            order: null  // Explicitly set to null to clear manual ordering
        }));
        
        // Save ALL collections with order=null to storage (will remove order field from index and collection data)
        await batchUpdateCollections(allCollectionsWithClearedOrder);
        
        // Reload collections with the sort preferences to ensure they're in the correct order
        // This ensures that after clearing order fields, collections are sorted by the user's preference
        const reloadedCollections = await loadAllCollections({
            metadataOnly: false,
            sortBy: sortByField,
            sortOrder: sortOrder
        });
        
        // Update UI with reloaded collections (they should already be sorted correctly)
        const cleanedData = reloadedCollections.map((collection) => {
            const rest = { ...collection };
            delete rest.order;
            return rest;
        });
        await props.updateRemoteData(cleanedData);
        
        // Save both sort type AND direction
        await browser.storage.local.set({ currentSortValue: sortBy, currentSortAscending: ascending });
    };

    const handleSortTypeChange = async (selectedOption) => {
        if (!isMountedRef.current) return;
        const newSortType = selectedOption.value;
        setSortType(newSortType);
        await handleSort(newSortType, sortAscending);
    };

    const toggleSortDirection = async () => {
        if (!isMountedRef.current) return;
        const newDirection = !sortAscending;
        setSortAscending(newDirection);
        await handleSort(sortType, newDirection);
    };

    const toggleNewWindow = async () => {
        if (!isMountedRef.current) return;
        const newValue = !openInNewWindow;
        setOpenInNewWindow(newValue);
        await browser.storage.local.set({ chkOpenNewWindow: newValue });
    };

    const toggleViewMode = async () => {
        if (!isMountedRef.current) return;
        const newViewMode = viewMode === 'list' ? 'grid' : 'list';
        setViewMode(newViewMode);
        await browser.storage.local.set({ collectionViewMode: newViewMode });
        // Call the parent function to update the view
        if (props.onViewModeChange) {
            props.onViewModeChange(newViewMode);
        }
    };

    const handleRestoreSession = () => {
        if (!isMountedRef.current) return;
        setIsSessionModalOpen(true);
    };

    const closeSessionModal = () => {
        if (!isMountedRef.current) return;
        setIsSessionModalOpen(false);
    };

    const handleFiltersChange = (filters) => {
        if (!isMountedRef.current) return;
        // Pass filters to parent component
        if (props.onFiltersChange) {
            props.onFiltersChange(filters);
        }
    };

    useEffect(() => {
        const openFolder = () => setIsFolderModalOpen(true);
        const openImport = () => fileInputRef.current?.click();
        const openSession = () => { if (sessionList.length > 0) setIsSessionModalOpen(true); };
        window.addEventListener('tabox:open-create-folder', openFolder);
        window.addEventListener('tabox:open-import', openImport);
        window.addEventListener('tabox:open-restore-session', openSession);
        return () => {
            window.removeEventListener('tabox:open-create-folder', openFolder);
            window.removeEventListener('tabox:open-import', openImport);
            window.removeEventListener('tabox:open-restore-session', openSession);
        };
    }, [sessionList]);

    const handleCreateFolder = () => {
        setIsFolderModalOpen(true);
    };

    const handleFolderModalClose = () => {
        setIsFolderModalOpen(false);
    };

    const handleFolderSave = async (name, color) => {
        if (props.addFolder) {
            await props.addFolder(name, color);
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelection = async (event) => {
        const file = event.target.files[0];
        if (!event.target.value.endsWith('.txt')) {
            showErrorToast('Invalid file: Please select a .txt file');
            event.target.value = '';
            return;
        }
        
        let reader = new FileReader();
        reader.onload = async function () {
            const result = reader.result;
            
            // More flexible JSON validation
            const trimmedResult = result.trim();
            if (!trimmedResult.startsWith('{') && !trimmedResult.startsWith('[')) {
                showErrorToast('Invalid File: File does not contain valid JSON data');
                event.target.value = '';
                return;
            }
            
            try {
                let parsed = JSON.parse(trimmedResult);
                // Clear file input immediately (fast operation)
                event.target.value = '';
                
                // Delegate import to background script to survive popup close
                // This fixes the bug where imports fail unless Inspect Popup is open
                console.log('[Import UI] Sending import request to background');
                let importResult;
                try {
                    importResult = await browser.runtime.sendMessage({
                        type: 'importData',
                        data: parsed
                    });
                    console.log('[Import UI] Received response:', importResult);
                } catch (msgError) {
                    console.error('[Import UI] Message sending failed:', msgError);
                    showErrorToast('Import failed: Could not communicate with background service - ' + (msgError?.message || 'Unknown error'));
                    return;
                }
                
                if (importResult && importResult.success) {
                    // Refresh UI after successful import
                    if (props.onDataUpdate) {
                        await props.onDataUpdate();
                    } else if (props.updateRemoteData) {
                        const { loadAllCollections } = await import('./utils/storageUtils');
                        const updatedCollections = await loadAllCollections();
                        await props.updateRemoteData(updatedCollections);
                    }
                    
                    // Highlight first imported collection
                    if (importResult.firstCollectionUid) {
                        setHighlightedCollectionUid(importResult.firstCollectionUid);
                    }
                    
                    showSuccessToast(importResult.message);
                } else {
                    const errorMsg = importResult?.error || 'Unknown error during import';
                    console.error('[Import UI] Import failed:', errorMsg, 'Full result:', importResult);
                    showErrorToast('Import failed: ' + errorMsg);
                }
            }
            catch (error) {
                console.error('[Import UI] Parse error:', error);
                showErrorToast('Invalid File: Unable to parse JSON - ' + error.message);
                event.target.value = '';
                return;
            }
        }
        reader.readAsText(file);
    };

    const ICON_SIZE = 18; // Reduced from 24 to match smaller buttons

    return (
        <>
            <div className="collections-toolbar-wrapper">
                <div className="collections-toolbar fp-toolbar">
                    <CollectionFilter onFiltersChange={handleFiltersChange} />

                    <div className="fp-toolbar-divider" />

                    <div className="fp-toolbar-group">
                        <div id="toolbar-sort-select" className="toolbar-select-shell">
                            <Select
                                className="toolbar-select"
                                classNamePrefix="toolbar-select"
                                value={sortOptions.find((option) => option.value === sortType)}
                                onChange={handleSortTypeChange}
                                options={sortOptions}
                                isSearchable={false}
                                isClearable={false}
                                components={{
                                    Option: SortOption,
                                    SingleValue: SortSingleValue,
                                }}
                                aria-label="Sort collections"
                                menuPortalTarget={menuPortalTarget}
                                menuPosition="fixed"
                                styles={{
                                    menuPortal: (base) => ({
                                        ...base,
                                        zIndex: 1000001,
                                    }),
                                }}
                            />
                        </div>
                        <button
                            type="button"
                            id="toolbar-sort-direction"
                            className="fp-toolbar-btn"
                            onClick={toggleSortDirection}
                        >
                            {/* Inverted: Up arrow for descending (higher values first), Down arrow for ascending (lower values first) */}
                            {sortAscending ? <MdArrowDownward size={ICON_SIZE} /> : <MdArrowUpward size={ICON_SIZE} />}
                        </button>
                    </div>

                    <div className="fp-toolbar-divider" />

                    <div className="fp-toolbar-group">
                        <button
                            type="button"
                            id="toolbar-open-new-window"
                            className={`fp-toolbar-btn ${openInNewWindow ? 'active' : ''}`}
                            onClick={toggleNewWindow}
                        >
                            <MdOpenInNew size={ICON_SIZE} />
                        </button>
                        <button
                            type="button"
                            id="toolbar-create-folder"
                            className="fp-toolbar-btn"
                            onClick={handleCreateFolder}
                        >
                            <MdCreateNewFolder size={ICON_SIZE} />
                        </button>
                        <button
                            type="button"
                            id="toolbar-view-mode"
                            className="fp-toolbar-btn"
                            onClick={toggleViewMode}
                        >
                            {viewMode === 'list' ? <PiGridNineFill size={ICON_SIZE} /> : <MdViewList size={ICON_SIZE} />}
                        </button>
                        <span id="toolbar-restore-session">
                            <button
                                type="button"
                                className="fp-toolbar-btn"
                                onClick={handleRestoreSession}
                                disabled={sessionList.length === 0}
                                style={{ pointerEvents: sessionList.length === 0 ? 'none' : 'auto' }}
                            >
                                <MdHistory size={ICON_SIZE} />
                            </button>
                        </span>
                        <button
                            type="button"
                            id="toolbar-import"
                            className="fp-toolbar-btn"
                            onClick={handleImportClick}
                            aria-label="Import collections from file"
                        >
                            <TbFileImport size={ICON_SIZE} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Hidden file input for import functionality */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileSelection}
                style={{ display: 'none' }}
            />

            <Modal
                isOpen={isSessionModalOpen}
                onRequestClose={closeSessionModal}
                contentLabel="Sessions Modal"
                className="modal-content"
                overlayClassName="modal-overlay"
                ariaHideApp={false}
            >
                <Suspense fallback={<div style={{padding: '20px', textAlign: 'center'}}>Loading...</div>}>
                    <SessionsModal
                        isOpen={isSessionModalOpen}
                        sessions={sessionList}
                        addCollection={props.addCollection}
                        onClose={closeSessionModal}
                    />
                </Suspense>
            </Modal>

            <Suspense fallback={null}>
                <CreateFolderModal
                    isOpen={isFolderModalOpen}
                    onClose={handleFolderModalClose}
                    onSave={handleFolderSave}
                />
            </Suspense>
            <Tooltip
                anchorSelect="#toolbar-sort-direction"
                content={sortAscending ? "Ascending (A→Z, Oldest→Newest)" : "Descending (Z→A, Newest→Oldest)"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-sort-select .toolbar-select__control"
                content="Choose how collections are sorted"
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-open-new-window"
                content={openInNewWindow ? "Open collections in new window" : "Open collections in current window"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-create-folder"
                content="Create new folder"
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-view-mode"
                content={viewMode === 'list' ? "Switch to grid view" : "Switch to list view"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-restore-session, #toolbar-restore-session button"
                content={sessionList.length === 0 ? "No recently closed items available" : "Restore recently closed item"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-import"
                content="Import collections or folders"
                className="small-tooltip"
                place="bottom"
            />
        </>
    );
}
