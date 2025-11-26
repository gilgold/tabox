import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import './CollectionList.css';
import { themeState, searchState } from './atoms/globalAppSettingsState';
import { draggingTabState, draggingGroupState } from './atoms/animationsState';
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
import { updateCollectionsOrder } from './utils/storageUtils';

const LIST_ROW_HEIGHT = 76;

function SearchTitle({ searchTerm }) {
    return <h2 className="search-title"><BsSearch size="14" /> &nbsp;Showing results for: <strong>{searchTerm}</strong></h2>
}

function NoCollections() {
    const themeMode = useAtomValue(themeState);
    const search = useAtomValue(searchState);

    return !search ? <div className="no-collections-container">
        <p id='nothing_message'>You don&apos;t have any collections!<br />
            <img className='no_contant_image' src={themeMode === 'dark' ? 'images/desert-night.png' : 'images/desert.png'} alt='desert scene' /><br />
            Add the current tabs or import a collection from file.</p>
    </div> : <div className="no-collections-container">
        <p id='nothing_message'>There are no collections that match your search.<br />
        </p>
    </div>
}

const areCollectionItemPropsEqual = (prev, next) => {
    return (
        prev.collection === next.collection &&
        prev.disableDrag === next.disableDrag &&
        prev.activeId === next.activeId &&
        prev.lightningEffect === next.lightningEffect &&
        prev.search === next.search &&
        prev.isInFolder === next.isInFolder &&
        prev.expanded === next.expanded
    );
};

const MemoizedSortableCollectionItem = React.memo((props) => (
    <SortableCollectionItem {...props} />
), areCollectionItemPropsEqual);

const areCollectionTilePropsEqual = (prev, next) => {
    return (
        prev.collection === next.collection &&
        prev.disableDrag === next.disableDrag &&
        prev.activeId === next.activeId &&
        prev.lightningEffect === next.lightningEffect &&
        prev.isInFolder === next.isInFolder &&
        prev.search === next.search
    );
};

const MemoizedSortableCollectionTile = React.memo((props) => (
    <SortableCollectionTile {...props} />
), areCollectionTilePropsEqual);

function CollectionList({
    collections = [],
    folders = [],
    hasActiveFilters = false,
    lightningEffectUid,
    lightningEffectFolderUid,
    triggerFolderLightningEffect,
    addCollection,
    onFolderStateChange,
    ...props
}) {
    const search = useAtomValue(searchState);
    const [disableDrag, setDisableDrag] = useState(false);
    const [activeCollection, setActiveCollection] = useState(null);
    const [activeFolder, setActiveFolder] = useState(null);
    const [draggingTab, setDraggingTab] = useAtom(draggingTabState);
    const [draggingGroup, setDraggingGroup] = useAtom(draggingGroupState);
    
    const listContainerRef = useRef(null);
    const rootCollectionsSectionRef = useRef(null);
    
    
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

    const rootCollections = useMemo(() => {
        return collections.filter(collection => !collection.parentId);
    }, [collections]);

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
                    const isFolderContainer = folders.some(f => f.uid === collision.id);
                    return isCollection && !isOwnParent && !isFolderContainer;
                });
                
                if (collectionTargets.length > 0) {
                    return collectionTargets;
                }
            } else {
                // When dragging from the root, prioritize collections first, then folder drop zones
                // This prevents folders from highlighting when dragging over collections
                
                // First, check if we're over a collection (prioritize collection-to-collection sorting)
                const collectionTargets = pointerCollisions.filter(collision => {
                    const isCollection = collections.some(c => c.uid === collision.id);
                    const isFolderContainer = folders.some(f => f.uid === collision.id);
                    const isFolderDropZone = collision.id.startsWith('folder-') || 
                                           collision.id.startsWith('folder-content-');
                    return isCollection && !isFolderContainer && !isFolderDropZone;
                });
                
                if (collectionTargets.length > 0) {
                    return collectionTargets;
                }
                
                // Only check for folder drop zones if we're NOT over a collection
                // Use pointerWithin only (not closestCorners) to prevent premature highlighting
                const folderDropZones = pointerCollisions.filter(collision => {
                    const data = collision.data?.current;
                    const isFolderDropZone = data?.type === 'folder' || 
                                           collision.id.startsWith('folder-') || 
                                           collision.id.startsWith('folder-content-');
                    // Explicitly exclude folder containers (folder UIDs) to prevent sorting
                    const isFolderContainer = folders.some(f => f.uid === collision.id);
                    // Also exclude collections - if we're over a collection, don't show folder drop zone
                    const isCollection = collections.some(c => c.uid === collision.id);
                    return isFolderDropZone && !isFolderContainer && !isCollection;
                });
                
                if (folderDropZones.length > 0) {
                    return folderDropZones;
                }
            }
            
            // Fallback for general collection sorting (e.g., root-level reordering)
            // CRITICAL: Explicitly exclude folder containers to prevent folder movement
            const validCollisionTargets = pointerCollisions.filter(collision => {
                const isFolderContainer = folders.some(f => f.uid === collision.id);
                const isCollection = collections.some(c => c.uid === collision.id);
                // Also exclude folder drop zones from sorting (they're handled above)
                const isFolderDropZone = collision.id.startsWith('folder-') || 
                                       collision.id.startsWith('folder-content-');
                return isCollection && !isFolderContainer && !isFolderDropZone;
            });
            
            if (validCollisionTargets.length > 0) {
                return validCollisionTargets;
            }
            
            // Final fallback to closest corners, but filter out folder containers
            const closestCornersResult = closestCorners(args);
            const filteredCorners = closestCornersResult.filter(collision => {
                const isFolderContainer = folders.some(f => f.uid === collision.id);
                return !isFolderContainer;
            });
            return filteredCorners.length > 0 ? filteredCorners : [];
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


    // Tooltip v5 automatically handles tooltip updates, no manual rebuild needed

    useEffect(() => {
        setDisableDrag(search !== undefined && search !== '');
    }, [search]);

    // Listen for tab and group drops on collections (cross-context drag and drop)
    useEffect(() => {
        if (!draggingTab && !draggingGroup) {
            return;
        }

        const handleMouseUp = async (e) => {
            // Check if we're dragging a group
            if (draggingGroup) {
                // Find the element under the mouse cursor
                const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
                if (!elementUnderMouse) {
                    setDraggingGroup(null);
                    return;
                }
                
                // Find the closest collection drop zone
                const dropZone = elementUnderMouse.closest('[data-collection-drop-zone]');
                if (!dropZone) {
                    // Not dropped on a collection, clear drag state
                    setDraggingGroup(null);
                    return;
                }
                
                const targetCollectionUid = dropZone.getAttribute('data-collection-uid');
                const targetCollection = collections.find(c => c.uid === targetCollectionUid);
                
                if (!targetCollection) {
                    setDraggingGroup(null);
                    return;
                }
                
                const { group, tabs, sourceCollection } = draggingGroup;
                
                // Don't move if dropping on the same collection
                if (sourceCollection.uid === targetCollection.uid) {
                    setDraggingGroup(null);
                    return;
                }
                
                try {
                    // Remove group and its tabs from source collection
                    const updatedSourceCollection = { ...sourceCollection };
                    updatedSourceCollection.tabs = updatedSourceCollection.tabs.filter(t => t.groupUid !== group.uid);
                    updatedSourceCollection.chromeGroups = updatedSourceCollection.chromeGroups.filter(g => g.uid !== group.uid);
                    updatedSourceCollection.lastUpdated = Date.now();
                    
                    // Add group and its tabs to target collection
                    const updatedTargetCollection = { ...targetCollection };
                    
                    // Add the group to target collection
                    updatedTargetCollection.chromeGroups = [...updatedTargetCollection.chromeGroups, group];
                    
                    // Add tabs to target collection (preserve groupUid)
                    const tabsWithGroup = tabs.map(tab => ({
                        ...tab,
                        groupUid: group.uid,
                        groupId: group.id || group.uid
                    }));
                    updatedTargetCollection.tabs = [...updatedTargetCollection.tabs, ...tabsWithGroup];
                    updatedTargetCollection.lastUpdated = Date.now();
                    
                    // Update both collections
                    const updatedCollections = collections.map(c => {
                        if (c.uid === sourceCollection.uid) {
                            return updatedSourceCollection;
                        }
                        if (c.uid === targetCollection.uid) {
                            return updatedTargetCollection;
                        }
                        return c;
                    });
                    
                    // Update remote data
                    props.updateRemoteData(updatedCollections);
                    
                    // Trigger sync
                    if (props.triggerSync) {
                        props.triggerSync();
                    }
                    
                    // Clear drag state
                    setDraggingGroup(null);
                    return;
                } catch (error) {
                    console.error('Error moving group between collections:', error);
                    setDraggingGroup(null);
                    return;
                }
            }
            
            // Check if we're dragging a tab
            if (!draggingTab) return;
            
            // Find the element under the mouse cursor
            const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
            if (!elementUnderMouse) {
                setDraggingTab(null);
                return;
            }
            
            // Find the closest collection drop zone
            const dropZone = elementUnderMouse.closest('[data-collection-drop-zone]');
            if (!dropZone) {
                // Not dropped on a collection, clear drag state
                setDraggingTab(null);
                return;
            }
            
            const targetCollectionUid = dropZone.getAttribute('data-collection-uid');
            const targetCollection = collections.find(c => c.uid === targetCollectionUid);
            
            if (!targetCollection) {
                setDraggingTab(null);
                return;
            }
            
            const { tab, sourceCollection } = draggingTab;
            
            // Don't move if dropping on the same collection
            if (sourceCollection.uid === targetCollection.uid) {
                setDraggingTab(null);
                return;
            }
            
            try {
                // Remove tab from source collection
                const updatedSourceCollection = { ...sourceCollection };
                updatedSourceCollection.tabs = updatedSourceCollection.tabs.filter(t => t.uid !== tab.uid);
                
                // Remove group if it becomes empty
                if (tab.groupUid) {
                    const tabsInGroup = updatedSourceCollection.tabs.filter(t => t.groupUid === tab.groupUid);
                    if (tabsInGroup.length === 0) {
                        updatedSourceCollection.chromeGroups = updatedSourceCollection.chromeGroups.filter(
                            g => g.uid !== tab.groupUid
                        );
                    }
                }
                updatedSourceCollection.lastUpdated = Date.now();
                
                // Add tab to target collection
                const updatedTargetCollection = { ...targetCollection };
                // Remove group info when moving to another collection (tabs lose their group context)
                const tabWithoutGroup = { ...tab };
                delete tabWithoutGroup.groupUid;
                tabWithoutGroup.groupId = -1;
                
                updatedTargetCollection.tabs = [...updatedTargetCollection.tabs, tabWithoutGroup];
                updatedTargetCollection.lastUpdated = Date.now();
                
                // Update both collections
                const updatedCollections = collections.map(c => {
                    if (c.uid === sourceCollection.uid) {
                        return updatedSourceCollection;
                    }
                    if (c.uid === targetCollection.uid) {
                        return updatedTargetCollection;
                    }
                    return c;
                });
                
                // Update remote data
                props.updateRemoteData(updatedCollections);
                
                // Trigger sync
                if (props.triggerSync) {
                    props.triggerSync();
                }
                
                // Clear drag state
                setDraggingTab(null);
            } catch (error) {
                console.error('Error moving tab between collections:', error);
                setDraggingTab(null);
            }
        };

        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingTab, draggingGroup, collections, props, setDraggingTab, setDraggingGroup]);

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
            setActiveCollection(null);
            setActiveFolder(null);
            setDraggingTab(null); // Clear tab drag state
            setDraggingGroup(null); // Clear group drag state
            return;
        }

        // Handle tab drop on collection (cross-collection drag and drop)
        if (draggingTab && over.data.current?.type === 'collection-drop') {
            const targetCollection = over.data.current.collection;
            const sourceCollection = draggingTab.sourceCollection;
            const tabToMove = draggingTab.tab;
            
            // Don't move if dropping on the same collection
            if (sourceCollection.uid === targetCollection.uid) {
                setDraggingTab(null);
                return;
            }
            
            try {
                // Remove tab from source collection
                const updatedSourceCollection = { ...sourceCollection };
                updatedSourceCollection.tabs = updatedSourceCollection.tabs.filter(t => t.uid !== tabToMove.uid);
                
                // Remove group if it becomes empty
                if (tabToMove.groupUid) {
                    const tabsInGroup = updatedSourceCollection.tabs.filter(t => t.groupUid === tabToMove.groupUid);
                    if (tabsInGroup.length === 0) {
                        updatedSourceCollection.chromeGroups = updatedSourceCollection.chromeGroups.filter(
                            g => g.uid !== tabToMove.groupUid
                        );
                    }
                }
                updatedSourceCollection.lastUpdated = Date.now();
                
                // Add tab to target collection
                const updatedTargetCollection = { ...targetCollection };
                // Remove group info when moving to another collection (tabs lose their group context)
                const tabWithoutGroup = { ...tabToMove };
                delete tabWithoutGroup.groupUid;
                tabWithoutGroup.groupId = -1;
                
                updatedTargetCollection.tabs = [...updatedTargetCollection.tabs, tabWithoutGroup];
                updatedTargetCollection.lastUpdated = Date.now();
                
                // Update both collections
                const updatedCollections = collections.map(c => {
                    if (c.uid === sourceCollection.uid) {
                        return updatedSourceCollection;
                    }
                    if (c.uid === targetCollection.uid) {
                        return updatedTargetCollection;
                    }
                    return c;
                });
                
                // Update remote data
                props.updateRemoteData(updatedCollections);
                
                // Trigger sync
                if (props.triggerSync) {
                    props.triggerSync();
                }
                
                // Trigger lightning effect on target collection
                if (props.lightningEffectUid !== undefined) {
                    // This would need to be handled by parent component
                }
                
                setDraggingTab(null);
                return;
            } catch (error) {
                console.error('Error moving tab between collections:', error);
                setDraggingTab(null);
                return;
            }
        }
        
        // Clear tab/group drag state if not a tab/group drop
        if (draggingTab) {
            setDraggingTab(null);
        }
        if (draggingGroup) {
            setDraggingGroup(null);
        }

        let draggedItem = allItems.find(item => item.uid === active.id);
        let targetItem = allItems.find(item => item.uid === over.id);
        
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
            // CRITICAL: Check collections FIRST before checking folder drop zones
            // This prevents collections from being moved to folders when dropped on other collections
            const collection = collections.find(c => c.uid === over.id);
            if (collection) {
                targetItem = {
                    ...collection,
                    itemType: 'collection',
                    isInFolder: !!collection.parentId
                };
            } else if (over.data.current?.type === 'folder') {
                // Only check for folder drop target if we didn't find a collection
                const folder = over.data.current.folder;
                targetItem = {
                    ...folder,
                    itemType: 'folder'
                };
            }
        }



        if (!draggedItem || !targetItem) {
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        // Prevent folder movement when dragging collections within the same folder
        if (draggedItem.itemType === 'collection' && 
            targetItem.itemType === 'folder' && 
            draggedItem.parentId === targetItem.uid) {
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        // Prevent folders from being dragged to collection areas
        if (draggedItem.itemType === 'folder' && targetItem.itemType === 'collection') {
            setActiveCollection(null);
            setActiveFolder(null);
            return;
        }

        // Handle different drag scenarios
        if (draggedItem.itemType === 'collection' && targetItem.itemType === 'folder') {
            // Collection dropped on folder
            // CRITICAL: Verify this is actually a folder drop zone, not a false positive
            // Check that over.id matches a folder drop zone pattern
            const isFolderDropZone = over.id.startsWith('folder-') || 
                                    over.id.startsWith('folder-content-') ||
                                    over.data.current?.type === 'folder';
            
            if (!isFolderDropZone) {
                setActiveCollection(null);
                setActiveFolder(null);
                return;
            }
            
            const success = await moveCollectionToFolder(draggedItem.uid, targetItem.uid);
            
            if (success) {
                if (props.onDataUpdate) {
                    props.onDataUpdate(); // Trigger refresh of collections and folders
                    restoreScrollPosition(); // Maintain scroll position after refresh
                }
                // Trigger sync to Google Drive
                if (props.triggerSync) {
                    props.triggerSync();
                }
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
                    
                    // Update order for root collections based on their new positions
                    await updateCollectionsOrder(reorderedRootCollections);
                    
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

                    // Update order for folder collections based on their new positions within the folder
                    await updateCollectionsOrder(reorderedFolderCollections);
                    
                    // Rebuild the complete collections array with new order
                    const otherCollections = collections.filter(c => 
                        !folderCollections.some(fc => fc.uid === c.uid)
                    );
                    
                    const newCollections = [...otherCollections, ...reorderedFolderCollections];
                    props.updateRemoteData(newCollections);
                    restoreScrollPosition(); // Maintain scroll position after reorder
                }
            } else if (!draggedItem.parentId && targetItem.parentId) {
                // Moving root collection to a folder

                await moveCollectionToFolder(draggedItem.uid, targetItem.parentId);
                
                if (props.onDataUpdate) {
                    props.onDataUpdate();
                    restoreScrollPosition(); // Maintain scroll position after move
                }
                // Trigger sync to Google Drive
                if (props.triggerSync) {
                    props.triggerSync();
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
                try {
                    const success = await moveCollectionToFolder(draggedItem.uid, targetItem.parentId);
                    
                    if (props.onDataUpdate) {
                        props.onDataUpdate();
                        restoreScrollPosition(); // Maintain scroll position after move
                    }
                    // Trigger sync to Google Drive
                    if (props.triggerSync) {
                        props.triggerSync();
                    }
                    // Trigger lightning effect on the target folder
                    if (triggerFolderLightningEffect) {
                        triggerFolderLightningEffect(targetItem.parentId);
                    }
                } catch (error) {
                    console.error('Error moving collection between folders:', error);
                }
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
                }
            }
        }

        setActiveCollection(null);
        setActiveFolder(null);
        setDraggingTab(null); // Ensure tab drag state is cleared
        setDraggingGroup(null); // Ensure group drag state is cleared
        
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
        <section ref={listContainerRef} className={`collection-list-container settings_body ${props.viewMode === 'grid' ? 'grid-view' : 'list-view'}`} key={props.key}>
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
                            {/* During search: show all matching collections in a flat list */}
                            {search && search.trim() ? (
                                // Search mode: show all matching collections (including those from folders) in a single list
                                collections.length > 0 && (
                                    <CollapsableSection
                                        sectionKey="searchResultsCollapsed"
                                        sectionTitle="Search Results"
                                        count={collections.length}
                                        expandTooltip="Expand search results"
                                        collapseTooltip="Collapse search results"
                                    >
                                        {collections.map((collection, index) => 
                                            props.viewMode === 'grid' ? (
                                                <MemoizedSortableCollectionTile
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
                                                    search={search}
                                                />
                                            ) : (
                                                <MemoizedSortableCollectionItem
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
                                                    search={search}
                                                />
                                            )
                                        )}
                                    </CollapsableSection>
                                )
                            ) : (
                                // Normal mode: show folders and root collections separately
                                <>
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
                                                            onFolderStateChange={onFolderStateChange}
                                                            onFolderDelete={props.onDataUpdate}
                                                            updateRemoteData={props.updateRemoteData}
                                                            onDataUpdate={props.onDataUpdate}
                                                            viewMode={props.viewMode}
                                                            lightningEffect={lightningEffectFolderUid === folder.uid}
                                                        >
                                                            {/* Render collections within this folder */}
                                                            {folderCollections.map((collection) => 
                                                                props.viewMode === 'grid' ? (
                                                                    <MemoizedSortableCollectionTile
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
                                                                        search={search}
                                                                    />
                                                                ) : (
                                                                    <MemoizedSortableCollectionItem
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
                                                                        search={search}
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
                                    {rootCollections.length > 0 && (
                                        <CollapsableSection
                                            sectionKey="collectionsCollapsed"
                                            sectionTitle="Collections"
                                            count={rootCollections.length}
                                            expandTooltip="Expand collections section"
                                            collapseTooltip="Collapse collections section"
                                        >
                                            <div ref={rootCollectionsSectionRef} className={props.viewMode === 'grid' ? 'collections-section-grid' : 'collections-section-list'}>
                                                {rootCollections.map((collection, index) => 
                                                    props.viewMode === 'grid' ? (
                                                        <MemoizedSortableCollectionTile
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
                                                            search={search}
                                                        />
                                                    ) : (
                                                        <MemoizedSortableCollectionItem
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
                                                            search={search}
                                                        />
                                                    )
                                                )}
                                            </div>
                                        </CollapsableSection>
                                    )}
                                </>
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