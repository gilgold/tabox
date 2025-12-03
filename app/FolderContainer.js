import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { MdExpandMore, MdExpandLess, MdFolder, MdFolderOpen, MdDragIndicator, MdDelete, MdPlayArrow, MdContentCopy } from 'react-icons/md';
import { CiExport } from 'react-icons/ci';
import { FaStop } from 'react-icons/fa6';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import ColorPicker from './ColorPicker';
import ContextMenu from './ContextMenu';
import DroppableFolderHeader from './DroppableFolderHeader';
import DroppableFolderContent from './DroppableFolderContent';
import { useFolderOperations, duplicateFolder } from './utils/folderOperations';
import { loadCollectionsIndex } from './utils/storageUtils';
import { downloadTextFile } from './utils';
import { browser } from '../static/globals';
import { useDndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useAtomValue } from 'jotai';
import { trackingStateVersion } from './atoms/globalAppSettingsState';

// Lazy load rarely-used modal
const FolderDeleteConfirmModal = lazy(() => import('./FolderDeleteConfirmModal'));

function FolderContainer({ 
    folder,
    children,
    onFolderUpdate,
    onFolderStateChange,
    onFolderDelete,
    updateRemoteData,
    onDataUpdate,
    dragAttributes,
    dragListeners,
    isDragging = false,
    viewMode = 'list',
    lightningEffect = false
}) {
    const [localExpanded, setLocalExpanded] = useState(!folder.collapsed);
    const { active } = useDndContext(); // Get current drag state
    const isMountedRef = useRef(true);
    
    // Sync local state with folder prop changes
    useEffect(() => {
        if (isMountedRef.current) {
            setLocalExpanded(!folder.collapsed);
        }
    }, [folder.collapsed]);
    
    // State for delete confirmation modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [modalCollectionCount, setModalCollectionCount] = useState(0);
    
    // State for tracking indicator
    const [hasTrackedCollections, setHasTrackedCollections] = useState(false);
    
    // State for deletion animation
    const [isDeleting, setIsDeleting] = useState(false);
    
    // Check if folder contains auto-tracked collections (optimized to avoid repeated loading)
    useEffect(() => {
        let timeoutId;
        
        const checkTrackedCollections = async () => {
            try {
                // Get auto-tracking settings
                const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
                const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
                
                // Only update state if component is still mounted
                if (!isMountedRef.current) return;
                
                if (!chkEnableAutoUpdate || !collectionsToTrack || collectionsToTrack.length === 0) {
                    if (isMountedRef.current) {
                        setHasTrackedCollections(false);
                    }
                    return;
                }
                
                // Use collection index instead of loading all collection data
                const { loadCollectionsIndex } = await import('./utils/storageUtils');
                const collectionsIndex = await loadCollectionsIndex();
                
                // Only continue if component is still mounted
                if (!isMountedRef.current) return;
                
                // Find collections in this folder from index
                const collectionsInFolder = Object.entries(collectionsIndex)
                    .filter(([, meta]) => meta && meta.parentId === folder.uid)
                    .map(([uid]) => uid);
                
                // Check if any are being tracked
                const trackedUids = collectionsToTrack.map(c => c.collectionUid);
                const hasTracked = collectionsInFolder.some(uid => 
                    trackedUids.includes(uid)
                );
                
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    setHasTrackedCollections(hasTracked);
                }
            } catch (error) {
                console.error('Error checking tracked collections in folder:', error);
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    setHasTrackedCollections(false);
                }
            }
        };
        
        // Debounce to avoid excessive checking
        timeoutId = setTimeout(checkTrackedCollections, 100);
        
        return () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [folder.uid]); // Re-check when folder changes
    
    // PERFORMANCE FIX: Watch global tracking version instead of individual storage listener
    // This prevents having N storage listeners (one per folder)
    const trackingVersion = useAtomValue(trackingStateVersion);
    useEffect(() => {
        let isMounted = true;
        
        const recheckTrackedCollections = async () => {
                    try {
                        const { chkEnableAutoUpdate } = await browser.storage.local.get('chkEnableAutoUpdate');
                        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
                        
                if (!isMounted || !isMountedRef.current) return;
                        
                        if (!chkEnableAutoUpdate || !collectionsToTrack || collectionsToTrack.length === 0) {
                    if (isMounted && isMountedRef.current) {
                                setHasTrackedCollections(false);
                            }
                            return;
                        }
                        
                        const collectionsIndex = await loadCollectionsIndex();
                        
                if (!isMounted || !isMountedRef.current) return;
                        
                        const collectionsInFolder = Object.entries(collectionsIndex)
                            .filter(([, meta]) => meta && meta.parentId === folder.uid)
                            .map(([uid]) => uid);
                        
                        const trackedUids = collectionsToTrack.map(c => c.collectionUid);
                        const hasTracked = collectionsInFolder.some(uid => 
                            trackedUids.includes(uid)
                        );
                        
                if (isMounted && isMountedRef.current) {
                            setHasTrackedCollections(hasTracked);
                        }
                    } catch (error) {
                        console.error('Error checking tracked collections in folder:', error);
                if (isMounted && isMountedRef.current) {
                            setHasTrackedCollections(false);
                        }
                    }
                };
                
        recheckTrackedCollections();
        
        return () => {
            isMounted = false;
        };
    }, [trackingVersion, folder.uid]);

    // Tooltip v5 automatically handles tooltip updates
    
    // Cleanup function to mark component as unmounted
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);
    
    // Use the folder operations hook
    const {
        handleUpdateFolderName,
        handleUpdateFolderColor,
        handleToggleCollapsed,
        handleDeleteFolder
    } = useFolderOperations({
        folder,
        updateRemoteData,
        onFolderUpdate: onFolderUpdate || (() => {}),
        onFolderDelete: onFolderDelete || (() => {})
    });
    
    const toggleExpanded = async () => {
        const newCollapsed = await handleToggleCollapsed();
        if (isMountedRef.current) {
            setLocalExpanded(!newCollapsed);
            // Use lightweight state update for UI-only changes (collapsed state)
            // This prevents unnecessary reloads of all data
            if (onFolderStateChange) {
                const updatedFolder = { ...folder, collapsed: newCollapsed };
                onFolderStateChange(updatedFolder);
            }
        }
    };

    // Get folder color with fallback - recalculated on each render
    const getFolderColor = React.useCallback(() => {
        const currentColor = folder?.color;
        
        // Custom color list for folders (simpler than tab groups)
        const folderColorChart = {
            'blue': '#4facfe',
            'green': '#43e97b', 
            'purple': '#a855f7',
            'orange': '#fb923c',
            'red': '#ef4444',
            'yellow': '#eab308',
            'pink': '#ec4899',
            'teal': '#14b8a6',
            'gray': '#6b7280'
        };
        
        if (!currentColor) {
            return '#4facfe'; // Default folder color (blue)
        }
        
        // Handle color names from folderColorChart
        if (folderColorChart[currentColor]) {
            return folderColorChart[currentColor];
        }
        
        // Handle CSS variable colors
        if (currentColor.startsWith('var(--')) {
            return '#4facfe'; // Fallback for CSS variables
        }
        
        // Handle hex colors
        if (currentColor.startsWith('#')) {
            return currentColor;
        }
        
        // Fallback
        return '#4facfe';
    }, [folder?.color]);

    const collectionCount = folder?.collectionCount || 0;
    const folderColor = React.useMemo(() => getFolderColor(), [getFolderColor]);

    
    // Early return if folder is invalid
    if (!folder || !folder.uid) {
        console.error('FolderContainer: Invalid folder prop');
        return null;
    }

    // Styles
    const containerStyle = {
        margin: '1px 0', // Reduced folder spacing
        padding: '2px 5px', // Reduced folder padding
        borderRadius: '8px',
        background: 'var(--setting-row-bg-color)',
        border: '1px solid var(--folder-border-color, var(--setting-row-border-color))',
        width: '99%', // Match collection row width
        opacity: isDragging ? 0.6 : isDeleting ? 0 : 1,
        transform: isDragging ? 'scale(1.02)' : isDeleting ? 'translateX(-100px)' : 'translateX(0)',
        transition: isDeleting ? 'all 0.4s ease-out' : 'all 0.2s ease',
        boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
        boxSizing: 'border-box', // Ensure consistent box model
        pointerEvents: isDeleting ? 'none' : 'auto'
    };

    const headerStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0', // Adjusted since container now has padding
        cursor: 'pointer',
        borderRadius: '8px',
        transition: 'background-color 0.2s ease',
        minHeight: '40px' // Match collection row min-height
    };

    const titleSectionStyle = {
        display: 'flex',
        alignItems: 'center',
        flex: 1,
        gap: '12px'
    };

    // Disable drag when folder is expanded OR when something else is being dragged
    const somethingElseBeingDragged = active && active.id !== folder.uid;
    const dragDisabled = localExpanded || somethingElseBeingDragged;
    
    // Debug logging for drag conflicts
    if (somethingElseBeingDragged) {
        // Drag disabled when something else is being dragged
    }
    
    const dragHandleStyle = {
        display: 'flex',
        alignItems: 'center',
        color: dragDisabled ? 'var(--text-disabled-color)' : 'var(--text-secondary-color)',
        cursor: dragDisabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
        padding: '4px',
        marginRight: '8px',
        borderRadius: '4px',
        transition: 'all 0.2s ease',
        userSelect: 'none',
        touchAction: dragDisabled ? 'auto' : 'none',
        opacity: dragDisabled ? 0.5 : 1,
        width: '24px',
        height: '24px',
        justifyContent: 'center',
        flexShrink: 0
    };

    // Icon style that updates with folder color changes
    const iconStyle = React.useMemo(() => ({
        fontSize: '28px',
        color: folderColor,
        transition: 'color 0.2s ease'
    }), [folderColor]);

    const iconContainerStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '28px',
        width: '28px',
        flexShrink: 0,
        marginLeft: '-15px' // Reduce gap between drag handle and icon
    };

    const folderInfoStyle = {
        display: 'flex',
        flexDirection: 'column',
        flex: 1
    };

    const folderTitleStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '2px'
    };

    const folderStatsStyle = {
        fontSize: '12px',
        color: 'var(--text-secondary-color)',
        fontWeight: '400'
    };

    const actionsStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        opacity: 0.7,
        transition: 'opacity 0.2s ease'
    };

    const expandButtonStyle = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '34px',
        height: '34px',
        borderRadius: '4px',
        color: 'var(--text-secondary-color)',
        transition: 'all 0.2s ease',
        opacity: 0.7
    };



    const childrenContainerStyle = {
        padding: localExpanded ? '8px' : '0',
        maxHeight: localExpanded ? 'none' : '0',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        background: 'var(--section-bg-color)',
        borderRadius: '0 0 8px 8px'
    };

    // Custom color list for folders (simpler than tab groups)
    const folderColorChart = {
        'blue': '#4facfe',
        'green': '#43e97b', 
        'purple': '#a855f7',
        'orange': '#fb923c',
        'red': '#ef4444',
        'yellow': '#eab308',
        'pink': '#ec4899',
        'teal': '#14b8a6',
        'gray': '#6b7280'
    };

    const handleSaveFolderName = async (newName) => {
        return await handleUpdateFolderName(newName);
    };

    const handleSaveFolderColor = async (newColor) => {
        return await handleUpdateFolderColor(newColor);
    };

    // Animated deletion function
    const performAnimatedDeletion = async (force = false, deleteCollections = false) => {
        try {
            // Start deletion animation
            if (isMountedRef.current) {
                setIsDeleting(true);
            }
            
            // Wait for animation to complete
            await new Promise(resolve => setTimeout(resolve, 400));
            
            // Check if component is still mounted before proceeding
            if (!isMountedRef.current) return false;
            
            // Perform actual deletion
            const result = await handleDeleteFolder(force, deleteCollections);
            
            // Reset animation state (in case deletion failed)
            if (!result && isMountedRef.current) {
                setIsDeleting(false);
            }
            
            return result;
        } catch (error) {
            if (isMountedRef.current) {
                setIsDeleting(false);
            }
            throw error;
        }
    };

    const handleDeleteFolderClick = async () => {
        try {
            if (!folder || !folder.uid) {
                console.error('Invalid folder object for deletion');
                return false;
            }

            // Prevent multiple deletion attempts
            if (isDeleting) {
                return false;
            }

            // Check if folder has collections
            const collectionsIndex = await loadCollectionsIndex();
            const collectionsInFolder = Object.entries(collectionsIndex)
                .filter(([, meta]) => meta && meta.parentId === folder.uid);
            
            if (collectionsInFolder.length > 0) {
                // Show confirmation modal (only if component is still mounted)
                if (isMountedRef.current) {
                    setModalCollectionCount(collectionsInFolder.length);
                    setShowDeleteModal(true);
                }
                return false;
            } else {
                // Empty folder - delete with animation
                return await performAnimatedDeletion(false);
            }
        } catch (error) {
            console.error('Error in folder deletion check:', error);
            console.error('Error details:', {
                folderUid: folder?.uid,
                folderName: folder?.name,
                errorMessage: error.message
            });
            return false;
        }
    };

    const handleConfirmDelete = async (deleteCollections = false) => {
        if (isMountedRef.current) {
            setShowDeleteModal(false);
        }
        
        // Prevent multiple deletion attempts
        if (isDeleting) {
            return false;
        }
        
        // Wait for modal close animation to complete before starting deletion animation
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
            // Force delete with animation and the deleteCollections option
            const result = await performAnimatedDeletion(true, deleteCollections);
            
            if (!result) {
                console.error(`❌ Failed to delete folder ${folder.name}`);
            }
            
            return result;
        } catch (error) {
            console.error('Error confirming folder deletion:', error);
            console.error('Error details:', {
                folderUid: folder?.uid,
                folderName: folder?.name,
                collectionCount: modalCollectionCount,
                deleteCollections: deleteCollections,
                errorMessage: error.message
            });
            return false;
        }
    };

    const handleCancelDelete = () => {
        if (isMountedRef.current) {
            setShowDeleteModal(false);
        }
    };

    const handleExportFolder = async () => {
        try {
            // Get all collections in this folder with full data
            const { loadAllCollections } = await import('./utils/storageUtils');
            const allCollections = await loadAllCollections();
            const collectionsInFolder = allCollections.filter(collection => 
                collection.parentId === folder.uid
            );

            // Create export data with full folder and collection information
            const exportData = {
                type: 'folder',
                folder: {
                    uid: folder.uid,
                    name: folder.name,
                    color: folder.color,
                    collapsed: folder.collapsed,
                    createdAt: folder.createdAt,
                    lastUpdated: folder.lastUpdated,
                    collectionCount: collectionsInFolder.length
                },
                collections: collectionsInFolder,
                exportedAt: new Date().toISOString(),
                version: '2.0'
            };

            // Export as JSON file
            const fileName = `${folder.name || 'folder'}_export`;
            downloadTextFile(JSON.stringify(exportData, null, 2), fileName);
        } catch (error) {
            console.error('Error exporting folder:', error);
        }
    };

    const handlePlayFolder = async () => {
        try {
            const { getFolderCollections } = await import('./utils/folderOperations');
            const collectionsToOpen = await getFolderCollections(folder.uid);

            if (collectionsToOpen.length === 0) {
                return;
            }

            const openedCollections = [];
            const failedCollections = [];

            const displays = await browser.system.display.getInfo();
            const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];

            for (const collection of collectionsToOpen) {
                try {
                    let windowCreationObject = { focused: true };

                    if (collection.window) {
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
                            return (intersectArea / windowArea) >= 0.5;
                        });

                        if (isPositionValid) {
                            windowCreationObject = { ...windowCreationObject, ...targetBounds };
                        } else {
                            windowCreationObject.width = targetBounds.width;
                            windowCreationObject.height = targetBounds.height;
                        }
                    }
                    
                    const window = await browser.windows.create(windowCreationObject);
                    const msg = {
                        type: 'openTabs',
                        collection: collection,
                        window: window
                    };
                    await browser.runtime.sendMessage(msg);
                    
                    openedCollections.push({ ...collection, lastOpened: Date.now() });
                } catch (error) {
                    console.error(`❌ Failed to open collection ${collection.name}:`, error);
                    failedCollections.push(collection.name);
                }
            }

            if (openedCollections.length > 0) {
                try {
                    const { batchUpdateCollections } = await import('./utils/storageUtils');
                    await batchUpdateCollections(openedCollections);
                } catch (batchSaveError) {
                    console.error('Error batch saving collections:', batchSaveError);
                }
            }

        } catch (error) {
            console.error(`Error in handlePlayFolder for ${folder.name}:`, error);
        }
    };

    const handleStopTrackingFolder = async () => {
        try {
            // Get all collections in this folder
            const { getFolderCollections } = await import('./utils/folderOperations');
            const folderCollections = await getFolderCollections(folder.uid);
            
            if (folderCollections.length === 0) {
                return;
            }

            // Get currently tracked collections
            const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
            if (!collectionsToTrack || collectionsToTrack.length === 0) {
                return;
            }

            // Get UIDs of collections in this folder
            const folderCollectionUids = folderCollections.map(c => c.uid);
            
            // Filter out any tracked collections that are in this folder
            const updatedCollectionsToTrack = collectionsToTrack.filter(tracked => 
                !folderCollectionUids.includes(tracked.collectionUid)
            );

            // Save the updated tracking list
            await browser.storage.local.set({ collectionsToTrack: updatedCollectionsToTrack });
            
            console.log(`✅ Stopped auto-tracking for ${folderCollections.length} collection(s) in folder "${folder.name}"`);
        } catch (error) {
            console.error('Error stopping folder tracking:', error);
        }
    };

    const handleDuplicateFolder = async () => {
        try {
            const result = await duplicateFolder(folder.uid);
            
            if (result.success) {
                console.log(`✅ Duplicated folder "${folder.name}" as "${result.newFolder.name}" with ${result.duplicatedCollections} collection(s)`);
                
                // Refresh data to show the new folder
                if (onDataUpdate) {
                    await onDataUpdate();
                }
            } else {
                console.error('Failed to duplicate folder:', result.error);
            }
        } catch (error) {
            console.error('Error duplicating folder:', error);
        }
    };

    return (
        <>
            <div 
                style={containerStyle} 
                className={`folder-container ${viewMode === 'grid' ? 'folder-container-grid' : 'folder-container-list'} ${lightningEffect ? 'lightning-effect' : ''}`}
            >
            <DroppableFolderHeader folder={folder}>
                <div 
                    style={headerStyle} 
                    className="folder-header"
                    onClick={(e) => {
                        // Only toggle if not clicking on interactive elements
                        if (!e.target.closest('.autosave-wrapper') && 
                            !e.target.closest('.auto-save-textbox') && 
                            !e.target.closest('.color-picker') && 
                            !e.target.closest('.colorPickerWrapper') &&
                            !e.target.closest('.folder-actions') &&
                            !e.target.closest('.drag-handle')) {
                            e.stopPropagation();
                            toggleExpanded();
                        }
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--setting-row-hover-bg)';
                        e.currentTarget.querySelector('.folder-actions').style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.querySelector('.folder-actions').style.opacity = '0.7';
                    }}
                >
                <div style={titleSectionStyle}>
                    <div 
                        style={dragHandleStyle}
                        className="drag-handle"
                        {...(dragDisabled ? {} : dragAttributes)}
                        {...(dragDisabled ? {} : dragListeners)}
                        onMouseEnter={(e) => {
                            if (!dragDisabled) {
                                e.target.style.backgroundColor = 'var(--setting-row-hover-bg)';
                                e.target.style.color = 'var(--text-color)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!dragDisabled) {
                                e.target.style.backgroundColor = 'transparent';
                                e.target.style.color = 'var(--text-secondary-color)';
                            }
                        }}

                        title={
                            localExpanded ? "Collapse folder to enable dragging" : 
                            somethingElseBeingDragged ? "Another item is being dragged" :
                            "Drag to reorder folder"
                        }
                    >
                        <MdDragIndicator />
                    </div>
                    
                    <div style={iconContainerStyle}>
                        {localExpanded ? (
                            <MdFolderOpen style={iconStyle} />
                        ) : (
                            <MdFolder style={iconStyle} />
                        )}
                    </div>
                    
                    <div style={folderInfoStyle}>
                        <div style={folderTitleStyle}>
                            {localExpanded ? (
                                <AutoSaveTextbox
                                    initValue={folder.name || 'New Folder'}
                                    item={folder}
                                    action={handleSaveFolderName}
                                    className="folder-title-input"
                                    placeholder="Folder name..."
                                    maxLength={50}
                                />
                            ) : (
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    height: '28px',
                                    minWidth: '120px',
                                    maxWidth: '200px'
                                }}>
                                    <span style={{
                                        fontSize: '13px',
                                        fontWeight: '500',
                                        color: 'var(--text-color)',
                                        userSelect: 'none'
                                    }}>
                                        {folder.name || 'New Folder'}
                                    </span>
                                </div>
                            )}
                            <span style={folderStatsStyle}>
                                {collectionCount} collection{collectionCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div style={actionsStyle} className="folder-actions" onClick={(e) => e.stopPropagation()}>
                    <ColorPicker
                        colorList={folderColorChart}
                        tooltip="Choose a color for this folder"
                        currentColor={folder.color}
                        action={handleSaveFolderColor}
                        size="small"
                    />
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px',
                        flexShrink: 0 // Prevent container from shrinking
                    }}>
                        {hasTrackedCollections ? (
                            <div 
                                className="folder-tracking-indicator"
                                data-tooltip-id="main-tooltip" data-tooltip-content="This folder contains auto-updating collections"
                                data-tooltip-class-name="small-tooltip"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    background: 'linear-gradient(45deg, rgba(22, 152, 226, 0.9), rgba(139, 93, 255, 0.9), rgba(255, 140, 66, 0.9))',
                                    border: '1px solid rgba(139, 93, 255, 0.6)',
                                    position: 'relative',
                                    overflow: 'hidden',
                                    boxShadow: '0 0 12px rgba(139, 93, 255, 0.4), inset 0 0 8px rgba(255, 255, 255, 0.2)'
                                }}
                            >
                                <div className="folder-tracking-smoke"></div>
                            </div>
                        ) : (
                            <button
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '4px',
                                    color: 'var(--text-secondary-color)',
                                    transition: 'all 0.2s ease',
                                    opacity: 0.7
                                }}
                                onClick={handlePlayFolder}
                                data-tooltip-id="main-tooltip" data-tooltip-content={`Open ${collectionCount} collection${collectionCount !== 1 ? 's' : ''} in this folder`}
                                data-tooltip-class-name="small-tooltip"
                                onMouseEnter={(e) => {
                                    e.target.style.opacity = '1';
                                    e.target.style.backgroundColor = 'var(--setting-row-hover-bg)';
                                    e.target.style.color = 'var(--text-color)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.opacity = '0.7';
                                    e.target.style.backgroundColor = 'transparent';
                                    e.target.style.color = 'var(--text-secondary-color)';
                                }}
                                disabled={collectionCount === 0}
                            >
                                <MdPlayArrow size={16} />
                            </button>
                        )}
                    </div>
                    <ContextMenu
                        menuItems={[
                            {
                                id: 'export',
                                text: 'Export Folder',
                                icon: <CiExport size={16} />,
                                action: handleExportFolder,
                                className: '',
                                condition: true
                            },
                            {
                                id: 'duplicate',
                                text: 'Duplicate Folder',
                                icon: <MdContentCopy size={16} />,
                                action: handleDuplicateFolder,
                                className: '',
                                condition: true
                            },
                            {
                                id: 'stop-tracking-folder',
                                text: 'Stop Auto Tracking Folder',
                                icon: <FaStop size={16} />,
                                action: handleStopTrackingFolder,
                                className: '',
                                condition: hasTrackedCollections
                            },
                            {
                                id: 'delete',
                                text: 'Delete Folder',
                                icon: <MdDelete size={16} />,
                                action: handleDeleteFolderClick,
                                className: 'danger',
                                condition: true
                            }
                        ]}
                        tooltip="Folder options"
                    />
                    <button 
                        style={expandButtonStyle}
                        onClick={toggleExpanded}
                        title={localExpanded ? 'Collapse folder' : 'Expand folder'}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                    >
                        {localExpanded ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                    </button>
                </div>
                </div>
            </DroppableFolderHeader>
            
            {localExpanded && (
                <DroppableFolderContent folder={folder}>
                    {(() => {
                        const childrenArray = Array.isArray(children) ? children : (children ? [children] : []);
                        const items = childrenArray.map(child => child.props?.id).filter(Boolean);
                        
                        return (
                            <SortableContext
                                items={items}
                                strategy={verticalListSortingStrategy}
                            >
                                <div style={childrenContainerStyle} className="folder-collections-container">
                                    {childrenArray.length > 0 ? children : (
                                        <div className="folder-empty-placeholder">
                                            <span className="placeholder-text">
                                                Drop collections here to add them to this folder
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </SortableContext>
                        );
                    })()}
                </DroppableFolderContent>
            )}
        </div>
        
        <Suspense fallback={null}>
            <FolderDeleteConfirmModal
                isOpen={showDeleteModal}
                onClose={handleCancelDelete}
                onConfirm={handleConfirmDelete}
                folderName={folder?.name || 'Unknown Folder'}
                collectionCount={modalCollectionCount}
            />
        </Suspense>
        </>
    );
}

export default FolderContainer; 