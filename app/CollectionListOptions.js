import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { settingsDataState } from './atoms/globalAppSettingsState';
import { highlightedCollectionUidState } from './atoms/animationsState';
import './CollectionListOptions.css';
import { PiGridNineFill } from "react-icons/pi";
import { SortType } from './model/SortOptions';
import { browser } from '../static/globals';
import Select from 'react-select';
import { 
    MdSortByAlpha, 
    MdAccessTime, 
    MdPalette,
    MdArrowUpward,
    MdArrowDownward,
    MdOpenInNew,
    MdHistory,
    MdSort,
    MdViewList,
    MdCreateNewFolder,
} from 'react-icons/md';
import { TbFileImport } from 'react-icons/tb';
import Modal from 'react-modal';
import { CollectionFilter } from './CollectionFilter';
import { showSuccessToast, showErrorToast } from './toastHelpers';

import { applyUid } from './utils';

// Lazy load rarely-used modals for better performance
const SessionsModal = lazy(() => import('./SessionsModal').then(module => ({ default: module.SessionsModal })));
const CreateFolderModal = lazy(() => import('./CreateFolderModal'));


const sortOptions = [
    { value: 'DATE', label: 'Date', icon: MdAccessTime },
    { value: 'NAME', label: 'Name', icon: MdSortByAlpha },
    { value: 'COLOR', label: 'Color', icon: MdPalette }
];

// Custom Option component with icon
const CustomOption = (props) => {
    const { data, innerRef, innerProps } = props;
    const IconComponent = data.icon;
    
    return (
        <div ref={innerRef} {...innerProps} className="custom-select-option">
            <IconComponent className="option-icon" size={16} />
            <span className="option-label">{data.label}</span>
        </div>
    );
};

// Custom SingleValue component with icon
const CustomSingleValue = (props) => {
    const { data } = props;
    const IconComponent = data.icon;
    
    return (
        <div className="custom-select-single-value">
            <IconComponent className="option-icon" size={16} />
            <span className="option-label">{data.label}</span>
        </div>
    );
};

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

    // Custom styles for React Select - only for padding/height fixes
    const customStyles = {
        control: (provided) => ({
            ...provided,
            minHeight: '26px',
            height: '26px',
            border: '1px solid var(--text-color)',
            borderRadius: '6px',
            backgroundColor: 'var(--input-bg-color)',
            boxShadow: 'none',
            ':hover': {
                backgroundColor: 'var(--setting-row-hover-bg-color)',
                borderColor: 'var(--text-color)'
            },
        }),
        valueContainer: (provided) => ({
            ...provided,
            height: '24px',
            padding: '0 8px',
            display: 'flex',
            alignItems: 'center'
        }),
        indicatorSeparator: () => ({
            display: 'none'
        }),
        dropdownIndicator: (provided) => ({
            ...provided,
            color: 'var(--text-color)',
            padding: '2px 8px'
        })
    };

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

                // Load sessions for restore functionality
                let { sessions } = await browser.storage.local.get('sessions');
                sessions = sessions || [];
                
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    setSessionList(sessions);
                }
            } catch (error) {
                console.error('Error loading CollectionListOptions data:', error);
            }
        };

        loadData();

        // Cleanup function
        return () => {
            isMountedRef.current = false;
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
        const cleanedData = reloadedCollections.map(({ order, ...rest }) => rest);
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

    // Import functionality moved from ImportCollection component
    const generateUID = () => {
        return (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    };

    // Helper function to generate unique names with numbering
    const generateUniqueName = async (originalName, type = 'collection') => {
        const { loadAllCollections, loadAllFolders } = await import('./utils/storageUtils');
        
        let existingNames = [];
        if (type === 'collection') {
            const collections = await loadAllCollections();
            existingNames = collections.map(c => c.name);
        } else if (type === 'folder') {
            const folders = await loadAllFolders();
            existingNames = folders.map(f => f.name);
        }

        // If name doesn't exist, return it as-is
        if (!existingNames.includes(originalName)) {
            return originalName;
        }

        // Find the next available number
        let counter = 1;
        let newName = `${originalName} (${counter})`;
        
        while (existingNames.includes(newName)) {
            counter++;
            newName = `${originalName} (${counter})`;
        }
        
        return newName;
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
                await handleImportData(parsed);
                event.target.value = '';
            }
            catch (error) {
                console.error('Import error:', error);
                openSnackbar('Invalid File: Unable to parse JSON - ' + error.message, 4000);
                event.target.value = '';
                return;
            }
        }
        reader.readAsText(file);
    };

    const handleImportData = async (parsed) => {
        // Detect import type based on structure
        if (parsed.type === 'full_export') {
            await handleFullExportImport(parsed);
        } else if (parsed.type === 'folder') {
            await handleFolderImport(parsed);
        } else if (Array.isArray(parsed)) {
            await handleLegacyCollectionsImport(parsed);
        } else if (parsed.tabs && Array.isArray(parsed.tabs)) {
            await handleSingleCollectionImport(parsed);
        } else {
            throw new Error('Unknown import format');
        }
    };

    const handleFullExportImport = async (exportData) => {
        try {
            const { saveSingleFolder, saveSingleCollection } = await import('./utils/storageUtils');
            let importedCollections = [];
            let importedFolders = [];

            // Import folders first
            if (exportData.folders && exportData.folders.length > 0) {
                for (const folder of exportData.folders) {
                    // Generate new UID to avoid conflicts
                    const newFolderUid = generateUID();
                    const uniqueName = await generateUniqueName(folder.name, 'folder');
                    const importedFolder = {
                        ...folder,
                        uid: newFolderUid,
                        name: uniqueName,
                        lastUpdated: Date.now()
                    };
                    
                    await saveSingleFolder(importedFolder);
                    importedFolders.push(importedFolder);
                    
                    // Update collections that belong to this folder
                    if (exportData.collections) {
                        exportData.collections.forEach(collection => {
                            if (collection.parentId === folder.uid) {
                                collection.parentId = newFolderUid;
                            }
                        });
                    }
                }
            }

            // Import collections
            if (exportData.collections && exportData.collections.length > 0) {
                for (const collection of exportData.collections) {
                    // Generate new UID to avoid conflicts
                    const newCollectionUid = generateUID();
                    const uniqueName = await generateUniqueName(collection.name, 'collection');
                    let importedCollection = {
                        ...collection,
                        uid: newCollectionUid,
                        name: uniqueName,
                        createdOn: Date.now(),
                        lastUpdated: Date.now()
                    };

                    // Apply UIDs to tabs if needed
                    if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                        importedCollection = applyUid(importedCollection);
                    }

                    await saveSingleCollection(importedCollection);
                    importedCollections.push(importedCollection);
                }
            }

            // Update the UI by refreshing both collections and folders
            if (props.onDataUpdate) {
                await props.onDataUpdate();
            } else if (props.updateRemoteData) {
                const { loadAllCollections } = await import('./utils/storageUtils');
                const updatedCollections = await loadAllCollections();
                await props.updateRemoteData(updatedCollections);
            }

            // Highlight first imported collection
            if (importedCollections.length > 0) {
                setHighlightedCollectionUid(importedCollections[0].uid);
            }

            openSuccessSnackbar(`Successfully imported ${importedFolders.length} folders and ${importedCollections.length} collections`, 3000);
        } catch (error) {
            console.error('Error importing full export:', error);
            openSnackbar('Error importing data: ' + error.message, 4000);
        }
    };

    const handleFolderImport = async (folderData) => {
        try {
            const { saveSingleFolder, saveSingleCollection } = await import('./utils/storageUtils');
            
            // Import the folder with new UID
            const newFolderUid = generateUID();
            const uniqueFolderName = await generateUniqueName(folderData.folder.name, 'folder');
            const importedFolder = {
                ...folderData.folder,
                uid: newFolderUid,
                name: uniqueFolderName,
                lastUpdated: Date.now()
            };
            
            await saveSingleFolder(importedFolder);

            // Import collections in the folder
            let importedCollections = [];
            if (folderData.collections && folderData.collections.length > 0) {
                for (const collection of folderData.collections) {
                    const newCollectionUid = generateUID();
                    const uniqueCollectionName = await generateUniqueName(collection.name, 'collection');
                    let importedCollection = {
                        ...collection,
                        uid: newCollectionUid,
                        name: uniqueCollectionName,
                        parentId: newFolderUid,
                        createdOn: Date.now(),
                        lastUpdated: Date.now()
                    };

                    if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                        importedCollection = applyUid(importedCollection);
                    }

                    await saveSingleCollection(importedCollection);
                    importedCollections.push(importedCollection);
                }
            }

            // Update the UI - refresh both collections and folders
            if (props.onDataUpdate) {
                await props.onDataUpdate();
            } else if (props.updateRemoteData) {
                const { loadAllCollections } = await import('./utils/storageUtils');
                const updatedCollections = await loadAllCollections();
                await props.updateRemoteData(updatedCollections);
            }

            // Highlight first imported collection
            if (importedCollections.length > 0) {
                setHighlightedCollectionUid(importedCollections[0].uid);
            }

            openSuccessSnackbar(`Successfully imported folder "${importedFolder.name}" with ${importedCollections.length} collections`, 3000);
        } catch (error) {
            console.error('Error importing folder:', error);
            openSnackbar('Error importing folder: ' + error.message, 4000);
        }
    };

    const handleLegacyCollectionsImport = async (collections) => {
        try {
            // Legacy array of collections import - apply unique names
            const collectionsWithUniqueNames = [];
            for (const collection of collections) {
                const uniqueName = await generateUniqueName(collection.name, 'collection');
                collectionsWithUniqueNames.push({
                    ...collection,
                    name: uniqueName
                });
            }
            
            let newData = [...collectionsWithUniqueNames, ...settingsData];
            await props.updateRemoteData(newData);
            
            if (collectionsWithUniqueNames.length > 0) {
                setHighlightedCollectionUid(collectionsWithUniqueNames[0].uid);
            }
            
            openSuccessSnackbar(`Successfully imported ${collectionsWithUniqueNames.length} collections`, 3000);
        } catch (error) {
            console.error('Error importing legacy collections:', error);
            openSnackbar('Error importing collections: ' + error.message, 4000);
        }
    };

    const handleSingleCollectionImport = async (collection) => {
        try {
            // Legacy single collection import with unique name
            const uniqueName = await generateUniqueName(collection.name, 'collection');
            let newItem = {...collection, name: uniqueName};
            newItem['createdOn'] = Date.now();
            if (newItem && newItem.tabs.length > 0 && !('uid' in newItem.tabs[0])) {
                newItem = applyUid(newItem);
            }
            
            let newData = [newItem, ...settingsData];
            await props.updateRemoteData(newData);
            setHighlightedCollectionUid(newItem.uid);
            
            openSuccessSnackbar(`Successfully imported collection "${newItem.name}"`, 3000);
        } catch (error) {
            console.error('Error importing single collection:', error);
            openSnackbar('Error importing collection: ' + error.message, 4000);
        }
    };

    const ICON_SIZE = 18; // Reduced from 24 to match smaller buttons

    return (
        <>
            <div className="collections-toolbar">
                <div className="toolbar-left">
                    <div className="sort-controls">
                        <MdSort className="sort-icon" />
                        <Select
                            className="sort-type-select"
                            classNamePrefix="react-select"
                            value={sortOptions.find(option => option.value === sortType)}
                            onChange={handleSortTypeChange}
                            options={sortOptions}
                            styles={customStyles}
                            components={{ 
                                Option: CustomOption,
                                SingleValue: CustomSingleValue 
                            }}
                            isSearchable={false}
                            isClearable={false}
                            placeholder="Sort by..."
                        />
                        
                        <button
                            className="toolbar-button"
                            onClick={toggleSortDirection}
                            title={sortAscending ? "Ascending (A→Z, Oldest→Newest)" : "Descending (Z→A, Newest→Oldest)"}
                        >
                            {/* Inverted: Up arrow for descending (higher values first), Down arrow for ascending (lower values first) */}
                            {sortAscending ? <MdArrowDownward size={ICON_SIZE} /> : <MdArrowUpward size={ICON_SIZE} />}
                        </button>
                    </div>
                </div>

                <div className="toolbar-center">
                    <CollectionFilter onFiltersChange={handleFiltersChange} />
                </div>

                <div className="toolbar-right">
                    <button
                        className={`toolbar-toggle-button ${openInNewWindow ? 'active' : ''}`}
                        onClick={toggleNewWindow}
                        data-tooltip-id="main-tooltip" data-tooltip-content={openInNewWindow ? "Open collections in new window" : "Open collections in current window"}
                        data-tooltip-class-name="small-tooltip"
                    >
                        <MdOpenInNew size={ICON_SIZE} />
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={handleCreateFolder}
                        data-tooltip-id="main-tooltip" data-tooltip-content="Create new folder"
                        data-tooltip-class-name="small-tooltip"
                    >
                        <MdCreateNewFolder size={ICON_SIZE} />
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={toggleViewMode}
                        data-tooltip-id="main-tooltip" data-tooltip-content={viewMode === 'list' ? "Switch to grid view" : "Switch to list view"}
                        data-tooltip-class-name="small-tooltip"
                    >
                        {viewMode === 'list' ? <PiGridNineFill size={ICON_SIZE} /> : <MdViewList size={ICON_SIZE} />}
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={handleRestoreSession}
                        disabled={sessionList.length === 0}
                        data-tooltip-id="main-tooltip" data-tooltip-content="Restore previous session"
                        data-tooltip-class-name="small-tooltip"
                    >
                        <MdHistory size={ICON_SIZE} />
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={handleImportClick}
                        data-tooltip-id="main-tooltip" data-tooltip-content="Import collections or folders"
                        data-tooltip-class-name="small-tooltip"
                    >
                        <TbFileImport size={ICON_SIZE} />
                    </button>
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
        </>
    );
}
