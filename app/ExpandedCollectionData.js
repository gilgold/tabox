import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { getCurrentTabsAndGroups } from './utils';
import { browser } from '../static/globals';
import SortableTabRow from './SortableTabRow';
import TabRow from './TabRow';
import GroupContainer from './GroupContainer';
import { SnackBarWithUndo } from './SnackBarWithUndo';
import { AiOutlineFolderAdd } from 'react-icons/ai';
import { MdTab, MdSelectAll, MdWindow } from 'react-icons/md';
import { UNDO_TIME } from './constants';
import {
    DndContext,
    closestCenter,
    closestCorners,
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
    const [openSnackbar, closeSnackbar] = useSnackbar({ style: SnackbarStyle.SUCCESS, closeStyle: { display: 'none' } });
    const [isHighlighted, setIsHighlighted] = useState(false);
    const [activeTab, setActiveTab] = useState(null);


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

    useEffect(async () => {
        setIsHighlighted((await browser.tabs.query({ highlighted: true, currentWindow: true })).length > 1);
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
    }

    // Drag and Drop Handlers
    const handleDragStart = (event) => {
        const tab = props.collection.tabs.find((item) => item.uid === event.active.id);

        setActiveTab(tab);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        
        setActiveTab(null); // Clear active tab state
        
        if (!over || active.id === over.id) {
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
                
                if (adjustedNewIndex !== newIndex) {
                    console.log('📌 Adjusted drop position to respect pinned tabs:', newIndex, '→', adjustedNewIndex);
                }
                
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
                    console.log('📍 Group boundary check:', {
                        groupUid: draggedTab.groupUid,
                        minGroupIndex,
                        maxGroupIndex,
                        adjustedTargetIndex,
                        isMovingWithinSameGroup
                    });
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
                console.log('🗑️ Deleted empty group:', originalGroupUid);
            }
        }

        // Update the collection
        currentCollection.tabs = newTabs;
        currentCollection.chromeGroups = newChromeGroups;
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, false); // Drag-and-drop operation - no lightning effect
    };

    // Get tab IDs for sortable context
    const tabIds = useMemo(() => {
        return props.collection.tabs.map(tab => tab.uid);
    }, [props.collection.tabs]);

    // Organize tabs for inline rendering (maintain original order)
    const organizedTabs = useMemo(() => {
        const result = [];
        const processedGroups = new Set();
        
        props.collection.tabs.forEach((tab, index) => {
            if (tab.groupUid && !processedGroups.has(tab.groupUid)) {
                // First occurrence of this group - collect all tabs for this group
                const groupTabs = props.collection.tabs.filter(t => t.groupUid === tab.groupUid);
                const group = groupFromId(tab.groupUid);
                
                if (group) {
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
    }, [props.collection.tabs, props.collection.chromeGroups]);

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
        openSnackbar(
            <SnackBarWithUndo
                icon={<AiOutlineFolderAdd size="32px" />}
                message={`${totalTabsAdded} ${totalTabsAdded === 1 ? 'tab' : 'tabs'} added to collection.`}
                collectionName={props.collection.name}
                updateRemoteData={props.updateRemoteData}
                collections={previousCollections}
                closeSnackbar={closeSnackbar}
                undoBackgroundColor={SnackbarStyle.SUCCESS.backgroundColor}
                duration={UNDO_TIME}
            />, UNDO_TIME * 1000);
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
                        data-tip={`Add ${isHighlighted ? 'selected tabs' : 'the current tab'} to this collection`}
                        data-place="bottom"
                        data-class="small-tooltip"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            e.preventDefault();
                            handleAddSelectedTabs(); 
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <div className="button-icon">
                            {isHighlighted ? <MdSelectAll size="16" /> : <MdTab size="16" />}
                        </div>
                        <span className="button-text">
                            {isHighlighted ? 'Add Selected Tabs' : 'Add Current Tab'}
                        </span>
                    </button>
                    
                    <button
                        className="modern-action-button secondary"
                        data-tip="Add all tabs from this window to this collection"
                        data-place="bottom"
                        data-class="small-tooltip"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            e.preventDefault();
                            handleAddAllTabs(); 
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <div className="button-icon">
                            <MdWindow size="16" />
                        </div>
                        <span className="button-text">Add All Tabs</span>
                    </button>
                </div>
            </div>
        </div>
        
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            measuring={measuring}
            modifiers={[]}
        >
            <SortableContext
                items={tabIds}
                strategy={verticalListSortingStrategy}
            >

                
                {/* Tabs in Original Order */}
                <div className="tabs-section">
                    {organizedTabs.map((item, index) => {
                        if (item.type === 'group') {
                            return (
                                <GroupContainer
                                    key={`group-container-${item.groupUid}`}
                                    group={item.group}
                                    tabs={item.tabs}
                                    onSaveGroupColor={handleSaveGroupColor}
                                    onSaveGroupName={saveGroupName}
                                    onDeleteGroup={_handleDeleteGroup}
                                    isExpanded={true}
                                >
                                    {item.tabs.map(tab => (
                                        <SortableTabRow
                                            key={`sortable-tab-row-${tab.uid}-grouped`}
                                            tab={tab}
                                            updateCollection={props.updateCollection}
                                            collection={props.collection}
                                            group={item.group}
                                            disableDrag={tab.pinned}
                                        />
                                    ))}
                                </GroupContainer>
                            );
                        } else {
                            // Individual ungrouped tab
                            return (
                                <div key={`ungrouped-tab-${item.tab.uid}`} className="ungrouped-tab-wrapper">
                                    <SortableTabRow
                                        key={`sortable-tab-row-${item.tab.uid}-ungrouped`}
                                        tab={item.tab}
                                        updateCollection={props.updateCollection}
                                        collection={props.collection}
                                        group={null}
                                        disableDrag={item.tab.pinned}
                                    />
                                </div>
                            );
                        }
                    })}
                </div>
            </SortableContext>
            
            {createPortal(
                <DragOverlay 
                    adjustScale={false}
                    dropAnimation={null}
                >
                    {activeTab ? (
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