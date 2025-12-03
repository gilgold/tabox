import React, { useEffect, useState, useMemo, useEffectEvent } from 'react';
import { createPortal } from 'react-dom';
import { showUndoToast } from './toastHelpers';
import { getCurrentTabsAndGroups } from './utils';
import { browser } from '../static/globals';
import SortableTabRow from './SortableTabRow';
import TabRow from './TabRow';
import GroupContainer from './GroupContainer';
import SortableGroupContainer from './SortableGroupContainer';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { AiOutlineFolderAdd } from 'react-icons/ai';
import { MdTab, MdSelectAll, MdWindow } from 'react-icons/md';
import { UNDO_TIME } from './constants';
import { useSetAtom, useAtomValue } from 'jotai';
import { draggingTabState, draggingGroupState } from './atoms/animationsState';
import {
    DndContext,
    closestCenter,
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
} from '@dnd-kit/sortable';


function ExpandedCollectionData(props) {
    const [isHighlighted, setIsHighlighted] = useState(false);
    const [activeTab, setActiveTab] = useState(null);
    const [activeGroup, setActiveGroup] = useState(null);
    const setDraggingTab = useSetAtom(draggingTabState);
    const draggingTab = useAtomValue(draggingTabState);
    const setDraggingGroup = useSetAtom(draggingGroupState);
    const draggingGroup = useAtomValue(draggingGroupState);
    
    // Track which groups are expanded (by default, all groups start collapsed)
    const [expandedGroupUids, setExpandedGroupUids] = useState(new Set());


    // Set up drag and drop sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // Reduced distance for more responsive drag
            },
        })
    );

    // Enhanced measuring configuration for better drag overlay positioning
    const measuring = {
        droppable: {
            strategy: MeasuringStrategy.Always,
        },
        dragOverlay: {
            strategy: MeasuringStrategy.Always,
        },
    };

    // Use Effect Event for checking highlighted tabs
    const checkHighlighted = useEffectEvent(async () => {
        setIsHighlighted((await browser.tabs.query({ highlighted: true, currentWindow: true })).length > 1);
    });

    useEffect(() => {
        checkHighlighted();
    }, [])

    const groupFromId = (_id, groups = props.collection.chromeGroups) => {
        const group = groups.find(el => el.uid === _id);
        if (_id && !group) {
            console.warn('⚠️ Group not found for ID:', _id, 'Available groups:', groups.map(g => ({ uid: g.uid, title: g.title })));
        }
        return group;
    }

    const _updateGroupAttribute = (group, attr, val) => {
        let currentCollection = { ...props.collection };
        const grpIndex = currentCollection.chromeGroups.findIndex(el => el.uid === group.uid);
        let chromeGroups = [...currentCollection.chromeGroups];
        let chromeGrp = { ...chromeGroups[grpIndex] }
        chromeGrp[attr] = val;
        chromeGroups[grpIndex] = chromeGrp;
        currentCollection.chromeGroups = chromeGroups;
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true); // Manual group attribute change - trigger lightning effect
    }

    const handleSaveGroupColor = async (color, group) => {
        // Handle color name properly - color parameter is the color name from ColorPicker
        const colorToSave = color || 'blue'; // Fallback to blue if no color provided

        
        if (!group) {
            console.error('❌ No group provided to handleSaveGroupColor');
            return;
        }
        
        try {
            _updateGroupAttribute(group, 'color', colorToSave);

        } catch (error) {
            console.error('❌ Error saving group color:', error);
        }
    };
    const saveGroupName = (title, group) => _updateGroupAttribute(group, 'title', title);

    const _handleDeleteGroup = (groupUid) => {
        let currentCollection = { ...props.collection };
        currentCollection.tabs = [...currentCollection.tabs].filter(el => el.groupUid !== groupUid);
        currentCollection.chromeGroups = [...currentCollection.chromeGroups].filter(cg => cg.uid !== groupUid);
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true); // Manual group deletion - trigger lightning effect
        // Also remove from expanded groups if it was expanded
        setExpandedGroupUids(prev => {
            const newSet = new Set(prev);
            newSet.delete(groupUid);
            return newSet;
        });
    }
    
    const handleToggleGroupExpanded = (groupUid, isExpanded) => {
        setExpandedGroupUids(prev => {
            const newSet = new Set(prev);
            if (isExpanded) {
                newSet.add(groupUid);
            } else {
                newSet.delete(groupUid);
            }
            return newSet;
        });
    };

    // Track mouse position during drag for cross-context drop detection (tabs)
    useEffect(() => {
        if (!draggingTab) return;
        
        const handleMouseMove = (e) => {
            if (draggingTab) {
                setDraggingTab({
                    ...draggingTab,
                    lastMouseX: e.clientX,
                    lastMouseY: e.clientY
                });
            }
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
        };
    }, [draggingTab, setDraggingTab]);

    // Track mouse position during drag for cross-context drop detection (groups)
    useEffect(() => {
        if (!draggingGroup) return;
        
        const handleMouseMove = (e) => {
            if (draggingGroup) {
                setDraggingGroup({
                    ...draggingGroup,
                    lastMouseX: e.clientX,
                    lastMouseY: e.clientY
                });
            }
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
        };
    }, [draggingGroup, setDraggingGroup]);

    // Drag and Drop Handlers
    const handleDragStart = (event) => {
        // Check if dragging a tab
        const tab = props.collection.tabs.find((item) => item.uid === event.active.id);
        if (tab) {
            setActiveTab(tab);
            // Track tab drag globally for cross-collection drag and drop
            setDraggingTab({
                tab: tab,
                sourceCollection: props.collection,
                lastMouseX: 0,
                lastMouseY: 0
            });
            return;
        }

        // Check if dragging a group
        const group = props.collection.chromeGroups.find((g) => g.uid === event.active.id);
        if (group) {
            const groupTabs = props.collection.tabs.filter(t => t.groupUid === group.uid);
            setActiveGroup({ group, tabs: groupTabs });
            // Track group drag globally for cross-collection drag and drop
            setDraggingGroup({
                group: group,
                tabs: groupTabs,
                sourceCollection: props.collection,
                lastMouseX: 0,
                lastMouseY: 0
            });
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        
        // Check if dragging a group
        const draggedGroup = props.collection.chromeGroups.find((g) => g.uid === active.id);
        if (draggedGroup) {
            // Group drag - handle separately
            setActiveGroup(null);
            // Don't clear draggingGroup here - let CollectionList handle it after processing the drop
            
            if (!over || active.id === over.id) {
                // If not dropped on anything, clear the drag state
                if (!draggingGroup || draggingGroup.sourceCollection.uid !== props.collection.uid) {
                    setDraggingGroup(null);
                }
                return;
            }

            // Handle group reordering within collection
            // Prevent dropping groups on group headers (groups cannot be nested)
            // But allow dropping on group containers for reordering
            
            // First check if dropped on a group header (DroppableGroupHeader) - prevent nesting
            if (over.id && over.id.startsWith('group-')) {
                // Dropped on a group header (DroppableGroupHeader) - prevent this (groups cannot be nested)
                setDraggingGroup(null);
                return;
            }
            
            // Check if dropped on another group container (for reordering)
            // Use over.data.current first as it's more reliable than over.id
            let targetGroup = null;
            if (over.data?.current?.type === 'group' && over.data.current.group) {
                // Dropped directly on group container
                targetGroup = over.data.current.group;
            } else {
                // Fallback: check by uid match
                targetGroup = props.collection.chromeGroups.find(g => g.uid === over.id);
            }
            
            if (targetGroup && targetGroup.uid !== draggedGroup.uid) {
                if (moveGroupRelativeToGroup(draggedGroup.uid, targetGroup.uid)) {
                    return;
                }
            }
            
            // Check if dropped on a tab - insert group before/after that tab's group or before ungrouped tab
            // Use over.data.current first as it's more reliable
            let targetTab = null;
            if (over.data?.current?.type === 'tab' && over.data.current.tab) {
                // Dropped directly on tab
                targetTab = over.data.current.tab;
            } else {
                // Fallback: check by uid match
                targetTab = props.collection.tabs.find(t => t.uid === over.id);
            }
            
            if (targetTab) {
                if (targetTab.groupUid) {
                    if (targetTab.groupUid === draggedGroup.uid) {
                        setDraggingGroup(null);
                        return;
                    }

                    if (moveGroupRelativeToGroup(draggedGroup.uid, targetTab.groupUid)) {
                        return;
                    }
                } else {
                    if (moveGroupRelativeToUngroupedTab(draggedGroup.uid, targetTab.uid)) {
                        return;
                    }
                }
            }
            
            // If no explicit target, snap group to end to avoid jumping to top
            moveGroupToEnd(draggedGroup.uid);
            return;
        }
        
        // Check if tab was dropped on a collection (cross-collection drop)
        // Since tabs are in a different DndContext, we need to manually detect this
        // The drop detection will be handled by a global mouseup listener in CollectionList
        // We just need to keep the draggingTab state until the drop is processed
        
        setActiveTab(null); // Clear active tab state
        // Don't clear draggingTab here - let CollectionList handle it after processing the drop
        
        if (!over || active.id === over.id) {
            // If not dropped on anything, clear the drag state
            if (!draggingTab || draggingTab.sourceCollection.uid !== props.collection.uid) {
                setDraggingTab(null);
            }
            return;
        }

        let currentCollection = { ...props.collection };
        let newTabs = [...currentCollection.tabs];
        const draggedTab = newTabs.find(tab => tab.uid === active.id);
        
        if (!draggedTab) {
            return;
        }

        // Rule 1: Prevent moving pinned tabs
        if (draggedTab.pinned) {
            
            return;
        }

        const originalGroupUid = draggedTab.groupUid;
        
        // Helper function to get the index of the first non-pinned tab
        const getFirstNonPinnedIndex = (tabs) => {
            for (let i = 0; i < tabs.length; i++) {
                if (!tabs[i].pinned) {
                    return i;
                }
            }
            return tabs.length; // All tabs are pinned
        };

        // Handle different drop targets
        if (over.data.current?.type === 'group') {
            // Dropping into a group
            const targetGroup = over.data.current.group;
            const activeTabIndex = newTabs.findIndex(tab => tab.uid === active.id);
            
            
            
            // FIRST: Find the position to insert the tab (BEFORE removing it from array)
            let insertIndex = newTabs.length;
            for (let i = newTabs.length - 1; i >= 0; i--) {
                if (newTabs[i].groupUid === targetGroup.uid) {
                    insertIndex = i + 1;
                    break;
                }
            }
            
            // Rule 2: Ensure insertion respects pinned tabs
            const firstNonPinnedIndex = getFirstNonPinnedIndex(newTabs);
            insertIndex = Math.max(insertIndex, firstNonPinnedIndex);
            
            
            
            // Adjust insertion index if we're removing from before the insertion point
            if (activeTabIndex < insertIndex) {
                insertIndex -= 1; // Account for the removal shifting indices down
            }
            
            // THEN: Remove tab from current position and create a copy with updated group
            const originalTab = newTabs.splice(activeTabIndex, 1)[0];
            const tabToMove = { 
                ...originalTab, 
                groupUid: targetGroup.uid,
                groupId: targetGroup.id || targetGroup.uid // Use id or fallback to uid for compatibility
            };
            
            
            
            // Insert tab at new position
            newTabs.splice(insertIndex, 0, tabToMove);
            
        } else if (over.data.current?.type === 'ungrouped') {
            // Removing from group (ungrouping)
            
            const activeTabIndex = newTabs.findIndex(tab => tab.uid === active.id);
            const tabToMove = { ...newTabs[activeTabIndex] };
            delete tabToMove.groupUid;
            delete tabToMove.groupId; // Also remove groupId
            tabToMove.groupId = -1; // Set to -1 for ungrouped state
            newTabs[activeTabIndex] = tabToMove;

            
        } else if (over.data.current?.type === 'tab') {
            // Dropping onto another tab - could be reordering or adding to group

            const oldIndex = newTabs.findIndex((item) => item.uid === active.id);
            const newIndex = newTabs.findIndex((item) => item.uid === over.id);
            
            if (oldIndex !== -1 && newIndex !== -1) {
                const draggedTab = newTabs[oldIndex];
                const targetTab = newTabs[newIndex];
                
                // Check if we're dropping onto a tab in a different group
                if (targetTab.groupUid && draggedTab.groupUid !== targetTab.groupUid) {
 
                    
                    // Find the target group object
                    const targetGroup = groupFromId(targetTab.groupUid);
                    if (targetGroup) {
                        // This is essentially the same as dropping on group header
                        // Calculate where to insert (after the target tab)
                        let insertIndex = newIndex + 1;
                        
                        // Rule: Ensure insertion respects pinned tabs
                        const firstNonPinnedIndex = getFirstNonPinnedIndex(newTabs);
                        insertIndex = Math.max(insertIndex, firstNonPinnedIndex);
                        
                        // Adjust insertion index if we're removing from before the insertion point
                        if (oldIndex < insertIndex) {
                            insertIndex -= 1;
                        }
                        
                        // Remove tab from current position and update group
                        const originalTab = newTabs.splice(oldIndex, 1)[0];
                        const tabToMove = { 
                            ...originalTab, 
                            groupUid: targetGroup.uid,
                            groupId: targetGroup.id || targetGroup.uid
                        };
                        
 
                        
                        // Insert tab at new position
                        newTabs.splice(insertIndex, 0, tabToMove);
                    }
                } else {
                    // Normal tab reordering logic
                // Rule 2: Prevent dropping before pinned tabs
                const firstNonPinnedIndex = getFirstNonPinnedIndex(newTabs);
                const adjustedNewIndex = Math.max(newIndex, firstNonPinnedIndex);
                
                // Get the dragged tab info BEFORE moving
                const draggedTab = newTabs[oldIndex];
                
                // Calculate group boundaries BEFORE the move operation
                let isMovingWithinSameGroup = false;
                if (draggedTab.groupUid) {
                    const groupTabs = newTabs.filter(tab => tab.groupUid === draggedTab.groupUid);
                    const groupTabIndices = groupTabs.map(tab => newTabs.findIndex(t => t.uid === tab.uid));
                    const minGroupIndex = Math.min(...groupTabIndices);
                    const maxGroupIndex = Math.max(...groupTabIndices);
                    
                    // Check if the new position would be within the group's boundaries
                    // We need to account for the fact that we're removing one item from oldIndex
                    let adjustedTargetIndex = adjustedNewIndex;
                    if (oldIndex < adjustedNewIndex) {
                        adjustedTargetIndex = adjustedNewIndex - 1; // Account for removal from earlier position
                    }
                    
                    isMovingWithinSameGroup = adjustedTargetIndex >= minGroupIndex && adjustedTargetIndex <= maxGroupIndex;
                }
                
                // Perform the move
                newTabs = arrayMove(newTabs, oldIndex, adjustedNewIndex);
                
                // Rule 3: Enhanced ungrouping logic - only ungroup when truly moving outside group context
                const droppedTab = newTabs[adjustedNewIndex];
                const tabAbove = adjustedNewIndex > 0 ? newTabs[adjustedNewIndex - 1] : null;
                const tabBelow = adjustedNewIndex < newTabs.length - 1 ? newTabs[adjustedNewIndex + 1] : null;
                
                // Only ungroup if the tab is moved outside its group context
                if (droppedTab.groupUid && !isMovingWithinSameGroup) {
                    // Check if we should ungroup based on surrounding context
                    const shouldUngroup = 
                        // If tab above is ungrouped and tab below is also ungrouped (or doesn't exist)
                        (tabAbove && !tabAbove.groupUid && (!tabBelow || !tabBelow.groupUid)) ||
                        // If tab is at the beginning and the first tab above is ungrouped
                        (adjustedNewIndex === 0 || (tabAbove && !tabAbove.groupUid && 
                         (!tabBelow || tabBelow.groupUid !== droppedTab.groupUid)));
                    
                    if (shouldUngroup) {
 
                        const updatedTab = { ...droppedTab };
                        delete updatedTab.groupUid;
                        delete updatedTab.groupId;
                        updatedTab.groupId = -1;
                        newTabs[adjustedNewIndex] = updatedTab;
                    }
                } else if (droppedTab.groupUid) {
                    
                }
                }
            }
        }

        // Check if the original group is now empty and should be deleted
        let newChromeGroups = [...currentCollection.chromeGroups];
        if (originalGroupUid) {
            const tabsInOriginalGroup = newTabs.filter(tab => tab.groupUid === originalGroupUid);
            if (tabsInOriginalGroup.length === 0) {
                // Remove the empty group
                newChromeGroups = newChromeGroups.filter(group => group.uid !== originalGroupUid);
            }
        }

        // Update the collection
        currentCollection.tabs = newTabs;
        currentCollection.chromeGroups = newChromeGroups;
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, false); // Drag-and-drop operation - no lightning effect
        
        // Clear drag state after successful move within collection
        setDraggingTab(null);
    };

    // Helper function to escape regex special characters
    const escapeRegex = (string) => {
        return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    };

    // Filter tabs based on search term
    const filteredTabs = useMemo(() => {
        if (!props.search || !props.search.trim()) {
            // No search - return all tabs
            return props.collection.tabs;
        }
        
        const searchRegex = new RegExp(escapeRegex(props.search), 'i');
        return props.collection.tabs.filter(tab => 
            tab.title?.match(searchRegex) || 
            tab.url?.match(searchRegex)
        );
    }, [props.search, props.collection.tabs]);

    // Organize tabs for inline rendering (maintain original order, but only show filtered tabs)
    const organizedTabs = useMemo(() => {
        const result = [];
        const processedGroups = new Set();
        
        // Use filtered tabs when search is active, otherwise use all tabs
        const tabsToOrganize = (props.search && props.search.trim()) ? filteredTabs : props.collection.tabs;
        
        tabsToOrganize.forEach((tab, index) => {
            if (tab.groupUid && !processedGroups.has(tab.groupUid)) {
                // First occurrence of this group - collect all filtered tabs for this group
                const groupTabs = tabsToOrganize.filter(t => t.groupUid === tab.groupUid);
                const group = groupFromId(tab.groupUid);
                
                if (group && groupTabs.length > 0) {
                    result.push({
                        type: 'group',
                        groupUid: tab.groupUid,
                        group: group,
                        tabs: groupTabs
                    });
                    processedGroups.add(tab.groupUid);
                }
            } else if (!tab.groupUid) {
                // Ungrouped tab - add it individually
                result.push({
                    type: 'tab',
                    tab: tab
                });
            }
            // Skip tabs that are part of groups we've already processed
        });
        
        return result;
    }, [props.collection.tabs, props.collection.chromeGroups, filteredTabs, props.search]);

    // Get sortable items - includes groups, ungrouped tabs, AND tabs inside groups
    // Tabs inside groups need to be sortable for reordering within groups
    // But we'll use custom collision detection to ignore them when dragging groups
    const sortableItems = useMemo(() => {
        const items = [];
        
        // Add groups and ungrouped tabs from organizedTabs
        organizedTabs.forEach(item => {
            if (item.type === 'group') {
                items.push(item.groupUid);
                // Also add tabs inside this group so they're sortable
                item.tabs.forEach(tab => {
                    if (!tab.pinned) {
                        items.push(tab.uid);
                    }
                });
            } else if (item.type === 'tab' && !item.tab.pinned) {
                items.push(item.tab.uid);
            }
        });
        
        return items;
    }, [organizedTabs]);
    
    // Custom collision detection that filters tabs inside groups when dragging groups
    const customCollisionDetection = useMemo(() => {
        return (args) => {
            const { active } = args;
            
            // Check if we're dragging a group
            const isDraggingGroup = props.collection.chromeGroups.some(g => g.uid === active?.id);
            
            if (isDraggingGroup) {
                // When dragging a group, filter out tabs inside groups from collision detection
                // Only consider groups and ungrouped tabs
                const filteredArgs = {
                    ...args,
                    droppableContainers: args.droppableContainers.filter(container => {
                        const containerId = container.id;
                        // Keep groups
                        if (props.collection.chromeGroups.some(g => g.uid === containerId)) {
                            return true;
                        }
                        // Keep ungrouped tabs (tabs without groupUid)
                        const tab = props.collection.tabs.find(t => t.uid === containerId);
                        if (tab && !tab.groupUid) {
                            return true;
                        }
                        // Filter out tabs inside groups
                        return false;
                    })
                };
                return closestCenter(filteredArgs);
            }
            
            // For tab drags, use normal collision detection
            return closestCenter(args);
        };
    }, [props.collection.chromeGroups, props.collection.tabs]);

    // Helper utilities for managing the visual layout of groups and tabs
    const buildGroupTabLayout = () => {
        const layout = [];
        const groupMap = new Map();
        const groupTabsMap = new Map();
        const processedGroups = new Set();

        props.collection.chromeGroups.forEach(group => {
            groupMap.set(group.uid, group);
        });

        props.collection.tabs.forEach(tab => {
            if (tab.groupUid) {
                if (!groupTabsMap.has(tab.groupUid)) {
                    groupTabsMap.set(tab.groupUid, []);
                }
                groupTabsMap.get(tab.groupUid).push(tab);
            }
        });

        props.collection.tabs.forEach(tab => {
            if (tab.groupUid) {
                if (!processedGroups.has(tab.groupUid)) {
                    layout.push({
                        type: 'group',
                        groupUid: tab.groupUid,
                        group: groupMap.get(tab.groupUid) || null,
                        tabs: groupTabsMap.get(tab.groupUid) || []
                    });
                    processedGroups.add(tab.groupUid);
                }
            } else {
                layout.push({
                    type: 'tab',
                    tab
                });
            }
        });

        // Include groups with no current tabs
        props.collection.chromeGroups.forEach(group => {
            if (!processedGroups.has(group.uid)) {
                layout.push({
                    type: 'group',
                    groupUid: group.uid,
                    group,
                    tabs: groupTabsMap.get(group.uid) || []
                });
            }
        });

        return { layout, groupMap };
    };

    const commitLayoutChanges = (layout, groupMap) => {
        const newTabs = [];
        const newGroupOrder = [];

        layout.forEach(item => {
            if (item.type === 'group') {
                if (item.tabs && item.tabs.length) {
                    newTabs.push(...item.tabs);
                }
                const groupRef = groupMap.get(item.groupUid) || item.group;
                if (groupRef && !newGroupOrder.find(g => g.uid === groupRef.uid)) {
                    newGroupOrder.push(groupRef);
                }
            } else if (item.type === 'tab') {
                newTabs.push(item.tab);
            }
        });

        // Ensure all groups remain represented, even if they currently have no tabs
        props.collection.chromeGroups.forEach(group => {
            if (!newGroupOrder.find(g => g.uid === group.uid)) {
                newGroupOrder.push(group);
            }
        });

        const updatedCollection = {
            ...props.collection,
            chromeGroups: newGroupOrder,
            tabs: newTabs,
            lastUpdated: Date.now()
        };

        props.updateCollection(updatedCollection, false);
        setDraggingGroup(null);
    };

    const moveGroupRelativeToGroup = (draggedGroupUid, targetGroupUid) => {
        if (!targetGroupUid || draggedGroupUid === targetGroupUid) {
            return false;
        }

        const { layout, groupMap } = buildGroupTabLayout();
        const draggedLayoutIndex = layout.findIndex(item => item.type === 'group' && item.groupUid === draggedGroupUid);
        const targetLayoutIndex = layout.findIndex(item => item.type === 'group' && item.groupUid === targetGroupUid);

        if (draggedLayoutIndex === -1 || targetLayoutIndex === -1) {
            return false;
        }

        const isMovingDown = targetLayoutIndex > draggedLayoutIndex;
        const [removedEntry] = layout.splice(draggedLayoutIndex, 1);
        const targetIndexAfterRemoval = layout.findIndex(item => item.type === 'group' && item.groupUid === targetGroupUid);
        let insertIndex = targetIndexAfterRemoval === -1 ? layout.length : targetIndexAfterRemoval;

        if (isMovingDown) {
            insertIndex += 1;
        }

        layout.splice(insertIndex, 0, removedEntry);
        commitLayoutChanges(layout, groupMap);
        return true;
    };

    const moveGroupRelativeToUngroupedTab = (draggedGroupUid, targetTabUid) => {
        const { layout, groupMap } = buildGroupTabLayout();
        const draggedLayoutIndex = layout.findIndex(item => item.type === 'group' && item.groupUid === draggedGroupUid);
        const targetLayoutIndex = layout.findIndex(item => item.type === 'tab' && item.tab.uid === targetTabUid);

        if (draggedLayoutIndex === -1 || targetLayoutIndex === -1) {
            return false;
        }

        const isMovingDown = targetLayoutIndex > draggedLayoutIndex;
        const [removedEntry] = layout.splice(draggedLayoutIndex, 1);
        const targetIndexAfterRemoval = layout.findIndex(item => item.type === 'tab' && item.tab.uid === targetTabUid);

        if (targetIndexAfterRemoval === -1) {
            // Target tab disappeared unexpectedly; reinsert group at end to avoid loss
            layout.push(removedEntry);
            commitLayoutChanges(layout, groupMap);
            return false;
        }

        let insertIndex = targetIndexAfterRemoval;

        if (isMovingDown) {
            insertIndex = targetIndexAfterRemoval + 1;
        }

        layout.splice(insertIndex, 0, removedEntry);
        commitLayoutChanges(layout, groupMap);
        return true;
    };

    const moveGroupToEnd = (draggedGroupUid) => {
        const { layout, groupMap } = buildGroupTabLayout();
        const draggedLayoutIndex = layout.findIndex(item => item.type === 'group' && item.groupUid === draggedGroupUid);

        if (draggedLayoutIndex === -1) {
            return false;
        }

        const [removedEntry] = layout.splice(draggedLayoutIndex, 1);
        layout.push(removedEntry);
        commitLayoutChanges(layout, groupMap);
        return true;
    };

    const _groupsAreSimilar = (group1, group2) => {
        return group1 && group2 && group1.name === group2.name && group1.color === group2.color;
    }

    const groupExistsInCollection = (group) => {
        return group ? props.collection.chromeGroups.findIndex(el => _groupsAreSimilar(el, group)) > -1 : false;
    }

    const _updateCollectionTabs = async (onlyHighlighted) => {
        const { chkColEditIgnoreDuplicateTabs } = await browser.storage.local.get('chkColEditIgnoreDuplicateTabs');
        const { chkColEditIgnoreDuplicateGroups } = await browser.storage.local.get('chkColEditIgnoreDuplicateGroups');
        // 🚀 NEW: Load current collections from NEW STORAGE for undo
        const { loadAllCollections } = await import('./utils/storageUtils');
        const previousCollections = await loadAllCollections();
        let currentCollection = { ...props.collection };
        let newCollection = await getCurrentTabsAndGroups('', onlyHighlighted);
        let newCollectionTabs = [...newCollection.tabs];
        let newCollectionGroups = [...newCollection.chromeGroups];
        if (chkColEditIgnoreDuplicateTabs) {
            newCollectionTabs = newCollectionTabs.filter(tab => currentCollection.tabs.findIndex(el => el.url === tab.url) === -1);
        }
        let updatedTabs = [...currentCollection.tabs];
        let totalTabsAdded = updatedTabs.length;
        if (chkColEditIgnoreDuplicateGroups) {
            for (let index = 0; index < newCollectionTabs.length; index++) {
                let tab = { ...newCollectionTabs[index] };
                if ('groupUid' in tab) {
                    const group = groupFromId(tab.groupUid, newCollectionGroups);
                    if (group && groupExistsInCollection(group)) {
                        tab.groupUid = currentCollection.chromeGroups.find(el => _groupsAreSimilar(el, group)).uid;
                        const insertIndex = updatedTabs.findIndex(el => ('groupUid' in el) && _groupsAreSimilar(groupFromId(el.groupUid), group));
                        const count = updatedTabs.filter(el => ('groupUid' in el) && _groupsAreSimilar(groupFromId(el.groupUid), group)).length;
                        updatedTabs.splice(insertIndex + count, 0, tab);
                    }
                }
            }
            newCollectionTabs = newCollectionTabs.filter(tab => !('groupUid' in tab) || !groupExistsInCollection(groupFromId(tab.groupUid, newCollectionGroups)));
            newCollectionGroups = newCollectionGroups.filter(group => !groupExistsInCollection(group));
        }

        currentCollection.tabs = [...updatedTabs, ...newCollectionTabs];
        totalTabsAdded = currentCollection.tabs.length - totalTabsAdded;
        currentCollection.chromeGroups = [...currentCollection.chromeGroups, ...newCollectionGroups];
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true); // Manual collection tabs update - trigger lightning effect
        showUndoToast(
            <AiOutlineFolderAdd size="32px" />,
            `${totalTabsAdded} ${totalTabsAdded === 1 ? 'tab' : 'tabs'} added to collection.`,
            props.collection.name,
            async () => {
                // Undo by restoring previous collections
                await props.updateRemoteData(previousCollections);
            },
            UNDO_TIME
        );
    }

    const handleAddSelectedTabs = async () => {
        await _updateCollectionTabs(true);
    }

    const handleAddAllTabs = async () => {
        await _updateCollectionTabs(false);
    }

    return <div className={`expanded-content`}>
        {/* Modern Tab Actions Toolbar */}
        <div className="tab-actions-toolbar" onClick={(e) => e.stopPropagation()}>
            <div className="toolbar-section">
                <div className="toolbar-buttons">
                    <button
                        className="modern-action-button primary"
                        data-tooltip-id="main-tooltip" data-tooltip-content={`Add ${isHighlighted ? 'selected tabs' : 'the current tab'} to this collection`}
                        data-place="bottom"
                        data-tooltip-class-name="small-tooltip"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            e.preventDefault();
                            handleAddSelectedTabs(); 
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <div className="button-icon">
                            {isHighlighted ? <MdSelectAll size="14" /> : <MdTab size="14" />}
                        </div>
                        <span className="button-text">
                            {isHighlighted ? 'Add Selected Tabs' : 'Add Current Tab'}
                        </span>
                    </button>
                    
                    <button
                        className="modern-action-button secondary"
                        data-tooltip-id="main-tooltip" data-tooltip-content="Add all tabs from this window to this collection"
                        data-place="bottom"
                        data-tooltip-class-name="small-tooltip"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            e.preventDefault();
                            handleAddAllTabs(); 
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <div className="button-icon">
                            <MdWindow size="14" />
                        </div>
                        <span className="button-text">Add All Tabs</span>
                    </button>
                </div>
            </div>
        </div>
        
        <DndContext
            sensors={sensors}
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            measuring={measuring}
            modifiers={[]}
        >
            <SortableContext
                items={sortableItems}
                strategy={verticalListSortingStrategy}
            >

                
                {/* Search indicator message */}
                {props.search && props.search.trim() && filteredTabs.length > 0 ? (
                    <div className="search-results-indicator" onClick={(e) => e.stopPropagation()}>
                        <span className="search-results-text">
                            Showing {filteredTabs.length} of {props.collection.tabs.length} tab{filteredTabs.length !== 1 ? 's' : ''} matching "{props.search}"
                        </span>
                    </div>
                ) : null}
                
                {/* Tabs in Original Order */}
                <div className="tabs-section">
                    {organizedTabs.length > 0 ? organizedTabs.map((item, index) => {
                        if (item.type === 'group') {
                            return (
                                <SortableGroupContainer
                                    key={`sortable-group-container-${item.groupUid}`}
                                    group={item.group}
                                    tabs={item.tabs}
                                    collection={props.collection}
                                    onSaveGroupColor={handleSaveGroupColor}
                                    onSaveGroupName={saveGroupName}
                                    onDeleteGroup={_handleDeleteGroup}
                                    isExpanded={expandedGroupUids.has(item.groupUid)}
                                    onToggleExpanded={handleToggleGroupExpanded}
                                    disableDrag={false}
                                >
                                    {item.tabs.map(tab => 
                                        tab.pinned ? (
                                            // Pinned tabs are not sortable
                                            <div key={`pinned-tab-row-${tab.uid}-grouped`}>
                                                <TabRow
                                                    tab={tab}
                                                    updateCollection={props.updateCollection}
                                                    collection={props.collection}
                                                    group={item.group}
                                                    search={props.search}
                                                />
                                            </div>
                                        ) : (
                                            <SortableTabRow
                                                key={`sortable-tab-row-${tab.uid}-grouped`}
                                                tab={tab}
                                                updateCollection={props.updateCollection}
                                                collection={props.collection}
                                                group={item.group}
                                                disableDrag={false}
                                                search={props.search}
                                            />
                                        )
                                    )}
                                </SortableGroupContainer>
                            );
                        } else {
                            // Individual ungrouped tab
                            return item.tab.pinned ? (
                                // Pinned tabs are not sortable
                                <div key={`pinned-tab-${item.tab.uid}`} className="ungrouped-tab-wrapper">
                                    <TabRow
                                        tab={item.tab}
                                        updateCollection={props.updateCollection}
                                        collection={props.collection}
                                        group={null}
                                        search={props.search}
                                    />
                                </div>
                            ) : (
                                <div key={`ungrouped-tab-${item.tab.uid}`} className="ungrouped-tab-wrapper">
                                    <SortableTabRow
                                        key={`sortable-tab-row-${item.tab.uid}-ungrouped`}
                                        tab={item.tab}
                                        updateCollection={props.updateCollection}
                                        collection={props.collection}
                                        group={null}
                                        disableDrag={false}
                                        search={props.search}
                                    />
                                </div>
                            );
                        }
                    }) : (
                        props.search && props.search.trim() ? (
                            <div className="no-matching-tabs-message" onClick={(e) => e.stopPropagation()}>
                                <p>No tabs match "{props.search}" in this collection.</p>
                            </div>
                        ) : null
                    )}
                </div>
            </SortableContext>
            
            {createPortal(
                <DragOverlay 
                    adjustScale={false}
                    dropAnimation={null}
                >
                    {activeGroup ? (
                        <div style={{
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            cursor: 'grabbing',
                            zIndex: 999999,
                            width: '400px'
                        }}>
                            <GroupContainer
                                group={activeGroup.group}
                                tabs={activeGroup.tabs}
                                onSaveGroupColor={() => {}}
                                onSaveGroupName={() => {}}
                                onDeleteGroup={() => {}}
                                isExpanded={false}
                                isDragging={true}
                            />
                        </div>
                    ) : activeTab ? (
                        <div style={{
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            cursor: 'grabbing',
                            zIndex: 999999
                        }}>
                            <TabRow 
                                tab={activeTab}
                                updateCollection={props.updateCollection}
                                collection={props.collection}
                                group={groupFromId(activeTab.groupUid)}
                                isDragging={true}
                            />
                        </div>
                    ) : null}
                </DragOverlay>,
                document.body
            )}

        </DndContext>
    </div>
}

export default ExpandedCollectionData;