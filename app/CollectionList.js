import React, { useState, useEffect, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import './CollectionList.css';
import { themeState, searchState } from './atoms/globalAppSettingsState';
import ReactTooltip from 'react-tooltip';
import { BsSearch } from 'react-icons/bs';
import { browser } from '../static/globals';
import CollapsableSection from './CollapsableSection';
import {
    DndContext,
    closestCenter,
    closestCorners,
    pointerWithin,
    rectIntersection,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    MeasuringStrategy,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import SortableCollectionItem from './SortableCollectionItem';
import CollectionTile from './CollectionTile';
import SortableCollectionTile from './SortableCollectionTile';
// Folder imports
import FolderContainer from './FolderContainer';
import SortableFolderContainer from './SortableFolderContainer';
import { 
    moveCollectionToFolder, 
    removeCollectionFromFolder
} from './utils/folderOperations';

function SearchTitle({ searchTerm }) {
    return <h2 className="search-title"><BsSearch size="14" /> &nbsp;Showing results for: <strong>{searchTerm}</strong></h2>
}

function NoCollections() {
    const themeMode = useRecoilValue(themeState);
    const search = useRecoilValue(searchState);

    return !search ? <div className="no-collections-container">
        <p id='nothing_message'>You don&apos;t have any collections!<br />
            <img className='no_contant_image' src={themeMode === 'dark' ? 'images/desert-night.png' : 'images/desert.png'} alt='desert scene' /><br />
            Add the current tabs or import a collection from file.</p>
    </div> : <div className="no-collections-container">
        <p id='nothing_message'>There are no collections that match your search.<br />
        </p>
    </div>
}

function CollectionList({
    collections = [],
    folders = [],
    hasActiveFilters = false,
    lightningEffectUid,
    lightningEffectFolderUid,
    triggerFolderLightningEffect,
    addCollection,
    ...props
}) {
    const search = useRecoilValue(searchState);
    const [disableDrag, setDisableDrag] = useState(false);
    const [activeCollection, setActiveCollection] = useState(null);
    const [activeFolder, setActiveFolder] = useState(null);
    
    // Create unified items array with folders and root-level collections only
    const allItems = useMemo(() => {
        const items = [];
        
        // Add folders first (they appear at the top)
        folders.forEach(folder => {
            // Get collections in this folder from the already-filtered collections array
            const folderCollections = collections.filter(c => c.parentId === folder.uid);
            
            // Only show folders that have collections matching the current filter criteria
            // Empty folders should only be visible when no filtering is applied
            const shouldShowFolder = folderCollections.length > 0 || !hasActiveFilters;
            
            if (shouldShowFolder) {
                items.push({
                    ...folder,
                    itemType: 'folder'
                });
            }
        });
        
        // Add root-level collections (no parentId)
        const rootCollections = collections.filter(c => !c.parentId);
        rootCollections.forEach(collection => {
            items.push({
                ...collection,
                itemType: 'collection',
                isInFolder: false
            });
        });
        
        return items;
    }, [collections, folders, hasActiveFilters]);

    // Create a helper function to get collections for a specific folder
    const getCollectionsForFolder = (folderId) => {
        return collections.filter(c => c.parentId === folderId);
    };

    // Create sortable items array with all draggable elements
    // Note: We rely on collision detection to prevent improper sorting, not exclusion from this array
    const sortableItems = useMemo(() => {
        const items = [];
        
        // Add all folder UIDs for dragging folders
        folders.forEach(folder => {
            items.push(folder.uid);
        });
        
        // Add all collection UIDs (both root-level and in folders)
        collections.forEach(collection => {
            items.push(collection.uid);
        });
        

        
        return items;
    }, [collections, folders]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // Reduce distance for easier drag start
            },
        }),
    );

    // Custom collision detection for better drop indicators between mixed item types
    const customCollisionDetection = (args) => {
        const { active } = args;
        
        // Check if we're dragging a collection
        const isDraggingCollection = active?.data?.current?.itemType === 'collection' || 
                                   collections.some(c => c.uid === active?.id);
        
        if (isDraggingCollection) {
            // When dragging collections, use normal pointer detection first
            const pointerCollisions = pointerWithin(args);
            
            // Get dragged collection info for collision logic
            const draggedCollection = collections.find(c => c.uid === active.id);
            
            // Check if dragging within the same folder
            const isDraggingWithinSameFolder = !!draggedCollection?.parentId;
            
            if (isDraggingWithinSameFolder) {
                // When dragging within a folder, we want to reorder.
                // Prioritize collection targets and ignore folder-level drop zones.
                const collectionTargets = pointerCollisions.filter(collision => {
                    const isCollection = collections.some(c => c.uid === collision.id);
                    const isOwnParent = collision.id === `folder-content-${draggedCollection.parentId}`;
                    return isCollection && !isOwnParent;
                });
                
                if (collectionTargets.length > 0) {
                    return collectionTargets;
                }
            } else {
                // When dragging from the root, we might be dropping into a folder.
                // Prioritize folder drop zones.
                const folderDropZones = pointerCollisions.filter(collision => {
                    const data = collision.data?.current;
                    return data?.type === 'folder' || 
                           collision.id.startsWith('folder-') || 
                           collision.id.startsWith('folder-content-');
                });
                
                if (folderDropZones.length > 0) {
                    return folderDropZones;
                }
            }
            
            // Fallback for general collection sorting (e.g., root-level reordering)
            const validCollisionTargets = pointerCollisions.filter(collision => {
                const isFolderContainer = folders.some(f => f.uid === collision.id);
                const isCollection = collections.some(c => c.uid === collision.id);
                return isCollection && !isFolderContainer;
            });
            
            if (validCollisionTargets.length > 0) {
                return validCollisionTargets;
            }
            
            // Final fallback to closest corners
            return closestCorners(args);
        }
        
        // Check if we're dragging a folder
        const isDraggingFolder = active?.data?.current?.itemType === 'folder' || 
                                folders.some(f => f.uid === active?.id);
        
        if (isDraggingFolder) {
            // For folder dragging, prioritize closestCorners for better positioning between folders
            const closestCornersResult = closestCorners(args);
            const pointerCollisions = pointerWithin(args);
            
            // Filter out invalid targets (collections)
            const validTargets = [...closestCornersResult, ...pointerCollisions].filter(collision => {
                // Exclude collections as targets for folders
                const isCollection = collections.some(c => c.uid === collision.id);
                if (isCollection) {
                    return false;
                }
                
                // Allow folder-to-folder drops and general sortable areas
                const isFolder = folders.some(f => f.uid === collision.id);
                const isFolderDropZone = collision.id.startsWith('folder-') || 
                                       collision.id.startsWith('folder-content-');
                const isSortableArea = !collision.id.startsWith('collection-');
                
                return isFolder || isFolderDropZone || isSortableArea;
            });
            
            // Remove duplicates and return
            const uniqueTargets = validTargets.filter((target, index, self) => 
                index === self.findIndex(t => t.id === target.id)
            );
            
            return uniqueTargets.length > 0 ? uniqueTargets : closestCorners(args);
        }
        
        // Default behavior for other types of dragging
        const pointerCollisions = pointerWithin(args);
        if (pointerCollisions.length > 0) {
            return pointerCollisions;
        }
        
        // Fallback to closestCorners for better mixed-type detection
        return closestCorners(args);
    };

    // Enhanced measuring configuration for better drop indicators
    const measuring = {
        droppable: {
            strategy: MeasuringStrategy.Always,
        },
        dragOverlay: {
            strategy: MeasuringStrategy.Always,
        },
    };

    // Debug sortable items if needed
    useEffect(() => {
        // Temporarily enable debug mode for drop zone testing
        window.DEBUG_FOLDER_DRAG = false; // Set to true to enable debugging
        
        if (window.DEBUG_FOLDER_DRAG) {
            console.log('🔧 Sortable items updated:', {
                count: sortableItems.length,
                items: sortableItems.slice(0, 3), // First 3 items
                allItemsCount: allItems.length,
                foldersCount: folders.length
            });
        }
    }, [sortableItems, allItems, folders]);

    useEffect(() => {
        // ReactTooltip needs rebuild when collections list changes to detect new tooltips
        ReactTooltip.rebuild();
    }, [collections]);

    useEffect(() => {
        setDisableDrag(search !== undefined && search !== '');
    }, [search]);

    const handleDragStart = (event) => {
        
        
        // Preserve scroll position during drag start in case of layout shifts
        const scrollContainer = document.querySelector('.settings_body');
        if (scrollContainer) {
            const currentScrollTop = scrollContainer.scrollTop;
            setTimeout(() => {
                scrollContainer.scrollTop = currentScrollTop;
            }, 10);
        }
        
        // First check if it's in allItems (folders and root collections)
        const activeItem = allItems.find((item) => item.uid === event.active.id);
        
        if (activeItem?.itemType === 'collection') {
            setActiveCollection(activeItem);
            setActiveFolder(null);
        } else if (activeItem?.itemType === 'folder') {
            setActiveFolder(activeItem);
            setActiveCollection(null);
        } else {
            // Check if it's a collection inside a folder
            const activeCollection = collections.find((collection) => collection.uid === event.active.id);
            if (activeCollection) {
                setActiveCollection({
                    ...activeCollection,
                    itemType: 'collection',
                    isInFolder: !!activeCollection.parentId
                });
                setActiveFolder(null);
            }
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;

        // Enhanced debugging for drop detection
        console.log('🎯 handleDragEnd called:', {
            activeId: active?.id,
            overId: over?.id,
            overData: over?.data?.current,
            overDataType: over?.data?.current?.type,
            overDataFolder: over?.data?.current?.folder?.name
        });

        // Preserve scroll position before any data updates
        const scrollContainer = document.querySelector('.settings_body');
        const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        
        const restoreScrollPosition = () => {
            if (scrollContainer) {
                setTimeout(() => {
                    scrollContainer.scrollTop = currentScrollTop;
                }, 10); // Small delay to ensure DOM updates are complete
            }
        };

        if (!over || active.id === over.id) {
            console.log('❌ No valid drop target');
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        let draggedItem = allItems.find(item => item.uid === active.id);
        let targetItem = allItems.find(item => item.uid === over.id);
        
        console.log('🎯 Initial drag detection:', {
            activeId: active.id,
            overId: over.id,
            draggedItemFound: !!draggedItem,
            targetItemFound: !!targetItem
        });
        
        // If not found in allItems, check collections (for collections inside folders)
        if (!draggedItem) {
            const collection = collections.find(c => c.uid === active.id);
            if (collection) {
                draggedItem = {
                    ...collection,
                    itemType: 'collection',
                    isInFolder: !!collection.parentId
                };
            }
        }
        
        if (!targetItem) {
            // Check if it's a folder drop target from DroppableFolderHeader
            if (over.data.current?.type === 'folder') {
                const folder = over.data.current.folder;
                targetItem = {
                    ...folder,
                    itemType: 'folder'
                };
            } else {
                // Check collections
                const collection = collections.find(c => c.uid === over.id);
                if (collection) {
                    targetItem = {
                        ...collection,
                        itemType: 'collection',
                        isInFolder: !!collection.parentId
                    };
                    console.log('🎯 Found target collection:', {
                        name: collection.name,
                        parentId: collection.parentId,
                        isInFolder: !!collection.parentId
                    });
                }
            }
        }



        if (!draggedItem || !targetItem) {
            console.log('🚫 Missing drag items:', { 
                draggedItem: draggedItem ? `${draggedItem.itemType}: ${draggedItem.name}` : 'null',
                targetItem: targetItem ? `${targetItem.itemType}: ${targetItem.name}` : 'null',
                activeId: active?.id,
                overId: over?.id
            });
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        console.log('🎯 Drag detected:', {
            dragged: `${draggedItem.itemType}: ${draggedItem.name} (parentId: ${draggedItem.parentId})`,
            target: `${targetItem.itemType}: ${targetItem.name} (parentId: ${targetItem.parentId})`
        });

        // Prevent folder movement when dragging collections within the same folder
        if (draggedItem.itemType === 'collection' && 
            targetItem.itemType === 'folder' && 
            draggedItem.parentId === targetItem.uid) {
            console.log('🚫 Preventing folder self-targeting during internal collection drag');
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        // Prevent folders from being dragged to collection areas
        if (draggedItem.itemType === 'folder' && targetItem.itemType === 'collection') {
            console.log('🚫 Preventing folder from being dropped on collection');
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        // Handle different drag scenarios
        if (draggedItem.itemType === 'collection' && targetItem.itemType === 'folder') {
            // Collection dropped on folder
            
            const success = await moveCollectionToFolder(draggedItem.uid, targetItem.uid);
            
            if (success && props.onDataUpdate) {
                props.onDataUpdate(); // Trigger refresh of collections and folders
                restoreScrollPosition(); // Maintain scroll position after refresh
                // Trigger lightning effect on the target folder
                if (triggerFolderLightningEffect) {
                    triggerFolderLightningEffect(targetItem.uid);
                }
            }
            
        } else if (draggedItem.itemType === 'collection' && targetItem.itemType === 'collection') {
            // Collection reordering - strict validation to prevent mixing with folders
            
            // Safety check: prevent collections from being sorted into the folder area
            // Only check this for root-level collections being sorted among root-level collections
            if (!draggedItem.parentId && !targetItem.parentId) {
                const targetIndexInAllItems = allItems.findIndex(item => item.uid === targetItem.uid);
                const folderCount = allItems.filter(item => item.itemType === 'folder').length;
                
                // Target must be in the collections section (after folders)
                const targetInCollectionsSection = targetIndexInAllItems !== -1 && targetIndexInAllItems >= folderCount;
                
                if (!targetInCollectionsSection) {
                    console.log(`❌ Prevented collection from being sorted into folder area`);
                    return;
                }
            }
            
            // Only proceed with collection reordering if both are root collections
            // If dragged item is from a folder, skip to folder-to-root logic
            if (!draggedItem.parentId && !targetItem.parentId) {
                // Both at root level - allow reordering within root collections only
                
                // Find the subset of collections to reorder (root-level only)
                const rootCollections = collections.filter(c => !c.parentId);
                
                const oldIndex = rootCollections.findIndex(c => c.uid === draggedItem.uid);
                const newIndex = rootCollections.findIndex(c => c.uid === targetItem.uid);
                
                if (oldIndex !== -1 && newIndex !== -1) {
                    const reorderedRootCollections = arrayMove(rootCollections, oldIndex, newIndex);
                    
                    // Rebuild the complete collections array with new order
                    const folderCollections = collections.filter(c => c.parentId);
                    
                    const newCollections = [...folderCollections, ...reorderedRootCollections];
                    props.updateRemoteData(newCollections);
                    restoreScrollPosition(); // Maintain scroll position after reorder
                }
            } else if (draggedItem.parentId && targetItem.parentId && draggedItem.parentId === targetItem.parentId) {
                // Both in same folder - allow reordering within folder

                
                const folderCollections = collections.filter(c => c.parentId === draggedItem.parentId);
                const oldIndex = folderCollections.findIndex(c => c.uid === draggedItem.uid);
                const newIndex = folderCollections.findIndex(c => c.uid === targetItem.uid);
            
                
                if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                    const reorderedFolderCollections = arrayMove(folderCollections, oldIndex, newIndex);

                    
                    // Rebuild the complete collections array with new order
                    const otherCollections = collections.filter(c => 
                        !folderCollections.some(fc => fc.uid === c.uid)
                    );
                    
                    const newCollections = [...otherCollections, ...reorderedFolderCollections];
                    props.updateRemoteData(newCollections);
                    restoreScrollPosition(); // Maintain scroll position after reorder
                } else {
                    console.log(`❌ Skipping reorder - invalid indices or same position:`, {
                        oldIndex,
                        newIndex,
                        draggedName: draggedItem.name,
                        targetName: targetItem.name
                    });
                }
            } else if (!draggedItem.parentId && targetItem.parentId) {
                // Moving root collection to a folder

                await moveCollectionToFolder(draggedItem.uid, targetItem.parentId);
                
                if (props.onDataUpdate) {
                    props.onDataUpdate();
                    restoreScrollPosition(); // Maintain scroll position after move
                }
            } else if (draggedItem.parentId && !targetItem.parentId) {
                // Moving folder collection to root with proper positioning
                
                try {
                    // Step 1: Remove from folder first to update storage
                    await removeCollectionFromFolder(draggedItem.uid);
                    
                    // Step 2: Create updated collections array with proper positioning
                    let updatedCollections = [...collections];
                    
                    // Find and update the moved collection's parentId
                    const movedCollectionIndex = updatedCollections.findIndex(c => c.uid === draggedItem.uid);
                    if (movedCollectionIndex !== -1) {
                        updatedCollections[movedCollectionIndex] = {
                            ...updatedCollections[movedCollectionIndex],
                            parentId: null,
                            lastUpdated: Date.now()
                        };
                    }
                    
                    // Step 3: Arrange collections with proper positioning
                    const folderCollections = updatedCollections.filter(c => c.parentId);
                    const rootCollections = updatedCollections.filter(c => !c.parentId);
                    
                    // Find the target position in root collections
                    const targetRootIndex = rootCollections.findIndex(c => c.uid === targetItem.uid);
                    const movedRootIndex = rootCollections.findIndex(c => c.uid === draggedItem.uid);
                    
                    if (targetRootIndex !== -1 && movedRootIndex !== -1) {
                        // Position the moved collection near the target
                        const reorderedRootCollections = arrayMove(rootCollections, movedRootIndex, targetRootIndex);
                        
                        // Combine all collections
                        const finalCollections = [...folderCollections, ...reorderedRootCollections];
                        
                        // Update UI immediately with positioned collections
                        props.updateRemoteData(finalCollections);
                        restoreScrollPosition(); // Maintain scroll position after move
                        
    
                    } else {
                        // Fallback to refresh if positioning fails
                        if (props.onDataUpdate) {
                            props.onDataUpdate();
                            restoreScrollPosition();
                        }
                    }
                } catch (error) {
                    console.error('Error moving collection from folder to root with positioning:', error);
                    // Fallback to basic move
                    if (props.onDataUpdate) {
                        props.onDataUpdate();
                        restoreScrollPosition();
                    }
                }
            } else if (draggedItem.parentId && targetItem.parentId && draggedItem.parentId !== targetItem.parentId) {
                // Moving collection from one folder to another folder (dropped on collection in target folder)
                console.log(`🔄 Moving collection from folder ${draggedItem.parentId} to folder ${targetItem.parentId}`);
                console.log('🔄 Folder-to-folder move details:', {
                    draggedCollection: draggedItem.name,
                    targetCollection: targetItem.name,
                    fromFolder: draggedItem.parentId,
                    toFolder: targetItem.parentId
                });
                
                try {
                    const success = await moveCollectionToFolder(draggedItem.uid, targetItem.parentId);
                    console.log('🔄 Move result:', success);
                    
                    if (props.onDataUpdate) {
                        props.onDataUpdate();
                        restoreScrollPosition(); // Maintain scroll position after move
                        // Trigger lightning effect on the target folder
                        if (triggerFolderLightningEffect) {
                            triggerFolderLightningEffect(targetItem.parentId);
                        }
                    }
                } catch (error) {
                    console.error('Error moving collection between folders:', error);
                }
            } else {
                // Prevent other invalid cross-folder movements
                console.log(`❌ Prevented invalid collection sorting between different contexts:`, {
                    draggedParentId: draggedItem.parentId,
                    targetParentId: targetItem.parentId,
                    draggedType: draggedItem.itemType,
                    targetType: targetItem.itemType
                });
            }
            
        } else if (draggedItem.itemType === 'folder' && targetItem.itemType === 'folder') {
            // Folder reordering - reorder the folders array
            
            const oldIndex = folders.findIndex(f => f.uid === draggedItem.uid);
            const newIndex = folders.findIndex(f => f.uid === targetItem.uid);
            
            if (oldIndex !== -1 && newIndex !== -1) {
                const newFolders = arrayMove(folders, oldIndex, newIndex);
                
                if (props.updateFolders) {
                    await props.updateFolders(newFolders);
                    restoreScrollPosition(); // Maintain scroll position after folder reorder
    
                } else {
                    console.log('❌ updateFolders prop not available');
                }
            } else {
                console.log('❌ Invalid folder indices:', { oldIndex, newIndex });
            }
        }

        setActiveCollection(null);
        setActiveFolder(null);
        
        // Final scroll position restoration as a safety net
        // This covers any edge cases where scroll might jump
        setTimeout(() => {
            if (scrollContainer) {
                scrollContainer.scrollTop = currentScrollTop;
            }
        }, 50);
    };

    // Use a stable key for DnD contexts only
    const dndKey = useMemo(() => {
        return `${disableDrag.toString()}-${props.viewMode}`;
    }, [disableDrag, props.viewMode]);

    // Check if there are any collections or folders available (regardless of collapse state)
    const hasAnyContent = collections.length > 0 || folders.length > 0;

    return (
        <section className={`collection-list-container settings_body ${props.viewMode === 'grid' ? 'grid-view' : 'list-view'}`} key={props.key}>
            {search ? <SearchTitle searchTerm={search} /> : null}
            {hasAnyContent ? (
                <DndContext
                    key={`dnd-context-${dndKey}`}
                    sensors={sensors}
                    collisionDetection={customCollisionDetection}
                    measuring={measuring}
                    onDragEnd={handleDragEnd}
                    onDragStart={handleDragStart}
                >
                    <SortableContext
                        key={`sortable-context-${dndKey}`}
                        items={sortableItems}
                        strategy={props.viewMode === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
                    >
                        <div className={props.viewMode === 'grid' ? 'collection-grid' : 'collection-list'}>
                            {/* Folders Section */}
                            {(() => {
                                // Filter folders to only show those with matching collections or when no filtering is applied
                                const visibleFolders = folders.filter(folder => {
                                    const folderCollections = collections.filter(c => c.parentId === folder.uid);
                                    return folderCollections.length > 0 || !hasActiveFilters;
                                });
                                
                                // Only render the section if there are visible folders
                                return visibleFolders.length > 0 && (
                                    <CollapsableSection
                                        sectionKey="foldersCollapsed"
                                        sectionTitle="Folders"
                                        count={visibleFolders.length}
                                        expandTooltip="Expand folders section"
                                        collapseTooltip="Collapse folders section"
                                    >
                                        {visibleFolders.map((folder) => {
                                            const folderCollections = getCollectionsForFolder(folder.uid);
                                            
                                            return (
                                                <SortableFolderContainer
                                                    key={folder.uid}
                                                    id={folder.uid}
                                                    folder={folder}
                                                    disableDrag={disableDrag}
                                                    index={-1}
                                                    activeId={activeFolder?.uid}
                                                    onFolderUpdate={props.onDataUpdate}
                                                    onFolderDelete={props.onDataUpdate}
                                                    updateRemoteData={props.updateRemoteData}
                                                    viewMode={props.viewMode}
                                                    lightningEffect={lightningEffectFolderUid === folder.uid}
                                                >
                                                    {/* Render collections within this folder */}
                                                    {folderCollections.map((collection) => 
                                                        props.viewMode === 'grid' ? (
                                                            <SortableCollectionTile
                                                                key={collection.uid}
                                                                id={collection.uid}
                                                                updateRemoteData={props.updateRemoteData}
                                                                disableDrag={disableDrag}
                                                                index={-1}
                                                                activeId={activeCollection?.uid}
                                                                updateCollection={props.updateCollection}
                                                                removeCollection={props.removeCollection}
                                                                addCollection={addCollection}
                                                                onDataUpdate={props.onDataUpdate}
                                                                collection={collection}
                                                                lightningEffect={lightningEffectUid === collection.uid}
                                                                isInFolder={true}
                                                            />
                                                        ) : (
                                                            <SortableCollectionItem
                                                                key={collection.uid}
                                                                id={collection.uid}
                                                                updateRemoteData={props.updateRemoteData}
                                                                expanded={false}
                                                                disableDrag={disableDrag}
                                                                index={-1}
                                                                activeId={activeCollection?.uid}
                                                                updateCollection={props.updateCollection}
                                                                removeCollection={props.removeCollection}
                                                                addCollection={addCollection}
                                                                onDataUpdate={props.onDataUpdate}
                                                                collection={collection}
                                                                lightningEffect={lightningEffectUid === collection.uid}
                                                                isInFolder={true}
                                                            />
                                                        )
                                                    )}
                                                </SortableFolderContainer>
                                            );
                                        })}
                                    </CollapsableSection>
                                );
                            })()}
                            
                            {/* Collections Section */}
                            {collections.filter(c => !c.parentId).length > 0 && (
                                <CollapsableSection
                                    sectionKey="collectionsCollapsed"
                                    sectionTitle="Collections"
                                    count={collections.filter(c => !c.parentId).length}
                                    expandTooltip="Expand collections section"
                                    collapseTooltip="Collapse collections section"
                                >
                                    {collections
                                        .filter(c => !c.parentId)
                                        .map((collection, index) => 
                                            props.viewMode === 'grid' ? (
                                                <SortableCollectionTile
                                                    key={collection.uid}
                                                    id={collection.uid}
                                                    updateRemoteData={props.updateRemoteData}
                                                    disableDrag={disableDrag}
                                                    index={index}
                                                    activeId={activeCollection?.uid}
                                                    updateCollection={props.updateCollection}
                                                    removeCollection={props.removeCollection}
                                                    addCollection={addCollection}
                                                    onDataUpdate={props.onDataUpdate}
                                                    collection={collection}
                                                    lightningEffect={lightningEffectUid === collection.uid}
                                                    isInFolder={false}
                                                />
                                            ) : (
                                                <SortableCollectionItem
                                                    key={collection.uid}
                                                    id={collection.uid}
                                                    updateRemoteData={props.updateRemoteData}
                                                    expanded={false}
                                                    disableDrag={disableDrag}
                                                    index={index}
                                                    activeId={activeCollection?.uid}
                                                    updateCollection={props.updateCollection}
                                                    removeCollection={props.removeCollection}
                                                    addCollection={addCollection}
                                                    onDataUpdate={props.onDataUpdate}
                                                    collection={collection}
                                                    lightningEffect={lightningEffectUid === collection.uid}
                                                    isInFolder={false}
                                                />
                                            )
                                        )
                                    }
                                </CollapsableSection>
                            )}
                        </div>
                    </SortableContext>
                    <DragOverlay>
                        {activeCollection ? (
                            props.viewMode === 'grid' ? (
                                <CollectionTile
                                    key={activeCollection.uid}
                                    updateRemoteData={props.updateRemoteData}
                                    index={-1}
                                    activeId={activeCollection.uid}
                                    updateCollection={props.updateCollection}
                                    removeCollection={props.removeCollection}
                                    collection={activeCollection}
                                />
                            ) : (
                                <SortableCollectionItem
                                    key={activeCollection.uid}
                                    id={activeCollection.uid}
                                    updateRemoteData={props.updateRemoteData}
                                    expanded={false}
                                    disableDrag={disableDrag}
                                    index={-1}
                                    activeId={activeCollection.uid}
                                    updateCollection={props.updateCollection}
                                    removeCollection={props.removeCollection}
                                    collection={activeCollection}
                                />
                            )
                        ) : activeFolder ? (
                            <FolderContainer
                                key={activeFolder.uid}
                                folder={{...activeFolder, collapsed: true}}
                                updateRemoteData={props.updateRemoteData}
                                onFolderUpdate={() => {}}
                                onFolderDelete={() => {}}
                                isDragging={true}
                            />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            ) : (
                <div className={props.viewMode === 'grid' ? 'collection-grid' : 'collection-list'}>
                    <NoCollections />
                </div>
            )}
        </section>);
}

export default CollectionList;