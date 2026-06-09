import React, { useEffect, useMemo, useRef, useState, useEffectEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue } from 'jotai';
import {
    DndContext,
    DragOverlay,
    MeasuringStrategy,
    PointerSensor,
    closestCenter,
    pointerWithin,
    rectIntersection,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AiOutlineFolderAdd } from 'react-icons/ai';
import { MdSelectAll, MdTab, MdWindow } from 'react-icons/md';
import { browser } from '../static/globals';
import { UNDO_TIME } from './constants';
import { dragSessionState } from './atoms/animationsState';
import { showUndoToast } from './toastHelpers';
import { openCollectionTabs } from './useCollectionOperations';
import DropGap from './DropGap';
import GroupContainer from './GroupContainer';
import SortableGroupContainer from './SortableGroupContainer';
import SortableTabRow from './SortableTabRow';
import TabRow from './TabRow';
import { getCurrentTabsAndGroups } from './utils';
import { dndPointerSensorOptions } from './utils/dndShared';
import {
    applyCollectionDropIntent,
    buildCollectionDragModel,
    collectionDropTargetPositions,
    collectionDropTargetSides,
    collectionDropTargetTypes,
    createCollectionDropTargetId,
    isCollectionDropTargetEnabled,
    resolveCollectionPointerDropTarget,
    resolveCollectionDropIntent,
    shouldIgnoreDroppableContainerForSession,
} from './utils/collectionDragUtils';

const getDropZoneId = (collectionUid, target) => `collection-drop:${collectionUid}:${createCollectionDropTargetId(target)}`;

function CollectionEdgeDropZone({
    collectionUid,
    target,
    label,
    disabled = false,
}) {
    const { isOver, setNodeRef } = useDroppable({
        id: getDropZoneId(collectionUid, target),
        disabled,
        data: {
            dropTarget: target,
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={`collection-edge-drop-zone ${isOver ? 'is-over' : ''}`}
            aria-hidden="true"
        >
            {isOver ? <span className="collection-edge-drop-zone-label">{label}</span> : null}
        </div>
    );
}

function ExpandedCollectionData(props) {
    const [isHighlighted, setIsHighlighted] = useState(false);
    const [expandedGroupUids, setExpandedGroupUids] = useState(new Set());
    const [optimisticCollection, setOptimisticCollection] = useState(null);
    const [activeOverlay, setActiveOverlay] = useState(null);
    const [activeDropTargetId, setActiveDropTargetId] = useState(null);
    const [dragSession, setDragSession] = useAtom(dragSessionState);
    const dragSessionRef = useRef(dragSession);
    const activeResolvedDropTargetRef = useRef(null);
    const dragPointerRef = useRef(null);

    dragSessionRef.current = dragSession;

    useEffect(() => {
        setOptimisticCollection(null);
        setActiveDropTargetId(null);
        activeResolvedDropTargetRef.current = null;
        dragPointerRef.current = null;
    }, [props.collection]);

    const sensors = useSensors(
        useSensor(PointerSensor, dndPointerSensorOptions),
    );

    const measuring = {
        droppable: {
            strategy: MeasuringStrategy.Always,
        },
        dragOverlay: {
            strategy: MeasuringStrategy.Always,
        },
    };

    const checkHighlighted = useEffectEvent(async () => {
        const highlightedTabs = await browser.tabs.query({ highlighted: true, currentWindow: true });
        setIsHighlighted(highlightedTabs.length > 1);
    });

    useEffect(() => {
        checkHighlighted();
    }, [checkHighlighted]);

    const baseCollection = optimisticCollection || props.collection;
    const dragModel = useMemo(
        () => buildCollectionDragModel(baseCollection, props.search),
        [baseCollection, props.search],
    );
    const isLocalDrag = dragSession?.sourceCollectionUid === props.collection.uid;
    const showForeignCollectionHover = dragSession
        && dragSession.sourceCollectionUid !== props.collection.uid
        && dragSession.overCollectionUid === props.collection.uid;

    const groupFromId = (_id, groups = props.collection.chromeGroups) => groups.find((group) => group.uid === _id);

    const updateGroupAttribute = (group, attr, value) => {
        const currentCollection = { ...props.collection };
        const groupIndex = currentCollection.chromeGroups.findIndex((item) => item.uid === group.uid);

        if (groupIndex === -1) {
            return;
        }

        const chromeGroups = [...currentCollection.chromeGroups];
        chromeGroups[groupIndex] = {
            ...chromeGroups[groupIndex],
            [attr]: value,
        };

        currentCollection.chromeGroups = chromeGroups;
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true);
    };

    const handleSaveGroupColor = async (color, group) => {
        if (!group) {
            return;
        }

        updateGroupAttribute(group, 'color', color || 'blue');
    };

    const saveGroupName = (title, group) => updateGroupAttribute(group, 'title', title);

    const handleDeleteGroup = (groupUid) => {
        const currentCollection = { ...props.collection };
        currentCollection.tabs = [...currentCollection.tabs].filter((tab) => tab.groupUid !== groupUid);
        currentCollection.chromeGroups = [...currentCollection.chromeGroups].filter((group) => group.uid !== groupUid);
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true);
        setExpandedGroupUids((prev) => {
            const next = new Set(prev);
            next.delete(groupUid);
            return next;
        });
    };

    const handleOpenGroupTabs = async (group) => {
        if (!group) {
            return;
        }

        const groupTabs = props.collection.tabs.filter((tab) => tab.groupUid === group.uid);
        if (groupTabs.length === 0) {
            return;
        }

        await openCollectionTabs({
            collectionToOpen: {
                ...props.collection,
                tabs: groupTabs,
                chromeGroups: [group],
            },
            updateCollection: props.updateCollection,
            openedCollectionToTrack: props.collection,
            trackOpenedWindow: false,
        });
    };

    const handleToggleGroupExpanded = (groupUid, isExpanded) => {
        setExpandedGroupUids((prev) => {
            const next = new Set(prev);
            if (isExpanded) {
                next.add(groupUid);
            } else {
                next.delete(groupUid);
            }
            return next;
        });
    };

    const groupsAreSimilar = (group1, group2) => group1 && group2 && group1.name === group2.name && group1.color === group2.color;

    const groupExistsInCollection = (group) => (group ? props.collection.chromeGroups.findIndex((item) => groupsAreSimilar(item, group)) > -1 : false);

    const updateCollectionTabs = async (onlyHighlighted) => {
        const { chkColEditIgnoreDuplicateTabs } = await browser.storage.local.get('chkColEditIgnoreDuplicateTabs');
        const { chkColEditIgnoreDuplicateGroups } = await browser.storage.local.get('chkColEditIgnoreDuplicateGroups');
        const { loadAllCollections } = await import('./utils/storageUtils');
        const previousCollections = await loadAllCollections();
        const currentCollection = { ...props.collection };
        const newCollection = await getCurrentTabsAndGroups('', onlyHighlighted);
        let newCollectionTabs = [...newCollection.tabs];
        let newCollectionGroups = [...newCollection.chromeGroups];

        if (chkColEditIgnoreDuplicateTabs) {
            newCollectionTabs = newCollectionTabs.filter((tab) => currentCollection.tabs.findIndex((item) => item.url === tab.url) === -1);
        }

        let updatedTabs = [...currentCollection.tabs];
        let totalTabsAdded = updatedTabs.length;

        if (chkColEditIgnoreDuplicateGroups) {
            for (let index = 0; index < newCollectionTabs.length; index += 1) {
                const tab = { ...newCollectionTabs[index] };

                if ('groupUid' in tab) {
                    const group = groupFromId(tab.groupUid, newCollectionGroups);
                    if (group && groupExistsInCollection(group)) {
                        tab.groupUid = currentCollection.chromeGroups.find((item) => groupsAreSimilar(item, group)).uid;
                        const insertIndex = updatedTabs.findIndex((item) => ('groupUid' in item) && groupsAreSimilar(groupFromId(item.groupUid), group));
                        const count = updatedTabs.filter((item) => ('groupUid' in item) && groupsAreSimilar(groupFromId(item.groupUid), group)).length;
                        updatedTabs.splice(insertIndex + count, 0, tab);
                    }
                }
            }

            newCollectionTabs = newCollectionTabs.filter((tab) => !('groupUid' in tab) || !groupExistsInCollection(groupFromId(tab.groupUid, newCollectionGroups)));
            newCollectionGroups = newCollectionGroups.filter((group) => !groupExistsInCollection(group));
        }

        currentCollection.tabs = [...updatedTabs, ...newCollectionTabs];
        totalTabsAdded = currentCollection.tabs.length - totalTabsAdded;
        currentCollection.chromeGroups = [...currentCollection.chromeGroups, ...newCollectionGroups];
        currentCollection.lastUpdated = Date.now();
        props.updateCollection(currentCollection, true);
        showUndoToast(
            <AiOutlineFolderAdd size="32px" />,
            `${totalTabsAdded} ${totalTabsAdded === 1 ? 'tab' : 'tabs'} added to collection.`,
            props.collection.name,
            async () => {
                await props.updateRemoteData(previousCollections);
            },
            UNDO_TIME,
        );
    };

    const handleAddSelectedTabs = async () => {
        await updateCollectionTabs(true);
    };

    const handleAddAllTabs = async () => {
        await updateCollectionTabs(false);
    };

    const handleDragStart = (event) => {
        setActiveDropTargetId(null);
        activeResolvedDropTargetRef.current = null;
        const itemType = event.active?.data?.current?.itemType;
        const pointer = event.activatorEvent
            ? {
                x: event.activatorEvent.clientX,
                y: event.activatorEvent.clientY,
            }
            : null;
        dragPointerRef.current = pointer;

        if (itemType === 'tab') {
            const tab = dragModel.tabsByUid.get(event.active.id);
            if (!tab || tab.pinned) {
                return;
            }

            setActiveOverlay({
                kind: 'tab',
                tab,
            });
            const session = {
                kind: 'tab',
                itemId: tab.uid,
                sourceCollectionUid: props.collection.uid,
                snapshot: { tab },
                pointer,
                overCollectionUid: props.collection.uid,
            };
            // Update ref immediately so collision detection can access
            // the session before the next React render cycle.
            dragSessionRef.current = session;
            setDragSession(session);
            return;
        }

        if (itemType === 'group') {
            const group = dragModel.groupsByUid.get(event.active.id);
            if (!group) {
                return;
            }

            const tabs = dragModel.tabs.filter((tab) => tab.groupUid === group.uid);
            setActiveOverlay({
                kind: 'group',
                group,
                tabs,
            });
            const session = {
                kind: 'group',
                itemId: group.uid,
                sourceCollectionUid: props.collection.uid,
                snapshot: {
                    group,
                    tabs,
                },
                pointer,
                overCollectionUid: props.collection.uid,
            };
            // Update ref immediately so collision detection can access
            // the session before the next React render cycle.
            dragSessionRef.current = session;
            setDragSession(session);
        }
    };

    const handleDragMove = (event) => {
        const currentSession = dragSessionRef.current;
        if (!currentSession?.pointer || !event?.delta) {
            return;
        }

        dragPointerRef.current = {
            x: currentSession.pointer.x + event.delta.x,
            y: currentSession.pointer.y + event.delta.y,
        };
    };

    const handleDragOver = (event) => {
        const currentSession = dragSessionRef.current;

        if (!currentSession || currentSession.sourceCollectionUid !== props.collection.uid) {
            return;
        }

        let overTarget = event.over?.data?.current?.dropTarget || null;

        if (!overTarget && event.over?.data?.current?.itemType === 'tab') {
            overTarget = {
                type: collectionDropTargetTypes.TAB_ROW,
                tabId: event.over.data.current.tabId,
            };
        }

        if (!overTarget) {
            activeResolvedDropTargetRef.current = null;
            setActiveDropTargetId(null);
            return;
        }

        const pointerY = dragPointerRef.current?.y;
        const overRect = event.over?.rect || null;
        const resolvedTarget = resolveCollectionPointerDropTarget(
            dragModel,
            currentSession,
            overTarget,
            pointerY,
            overRect,
            activeDropTargetId,
        );

        if (!resolvedTarget || !isCollectionDropTargetEnabled(dragModel, currentSession, resolvedTarget)) {
            activeResolvedDropTargetRef.current = null;
            setActiveDropTargetId(null);
            return;
        }

        const nextTargetId = createCollectionDropTargetId(resolvedTarget);
        if (!nextTargetId) {
            activeResolvedDropTargetRef.current = null;
            setActiveDropTargetId(null);
            return;
        }

        activeResolvedDropTargetRef.current = resolvedTarget;
        setActiveDropTargetId((previousTargetId) => (
            previousTargetId === nextTargetId ? previousTargetId : nextTargetId
        ));
    };

    const handleDragEnd = (event) => {
        const currentSession = dragSessionRef.current;
        const currentPointerY = dragPointerRef.current?.y;
        setActiveOverlay(null);
        setActiveDropTargetId(null);

        if (!currentSession || currentSession.sourceCollectionUid !== props.collection.uid) {
            return;
        }

        const isCrossCollectionDrop = currentSession.overCollectionUid
            && currentSession.overCollectionUid !== props.collection.uid;

        // For cross-collection drops, let useCollectionItemCrossDrag handle
        // the transfer via its own mouseup listener.
        if (isCrossCollectionDrop) {
            return;
        }

        if (!event.over) {
            setDragSession(null);
            return;
        }

        let fallbackOverTarget = event.over.data?.current?.dropTarget || null;

        if (!fallbackOverTarget && event.over.data?.current?.itemType === 'tab') {
            const overTabId = event.over.data.current.tabId;

            if (currentSession.kind === 'tab') {
                // Tab-on-tab: determine before/after from sortable index positions
                const activeTabId = event.active.data?.current?.tabId;
                if (overTabId && activeTabId && overTabId !== activeTabId) {
                    const oldIndex = sortableTabIds.indexOf(activeTabId);
                    const newIndex = sortableTabIds.indexOf(overTabId);
                    const side = newIndex > oldIndex
                        ? collectionDropTargetSides.AFTER
                        : collectionDropTargetSides.BEFORE;
                    fallbackOverTarget = {
                        type: collectionDropTargetTypes.TAB_EDGE,
                        tabId: overTabId,
                        side,
                    };
                }
            } else if (currentSession.kind === 'group') {
                // Group-on-tab: determine before/after from pointer Y vs tab midpoint
                const overTab = dragModel.tabsByUid.get(overTabId);
                if (overTab) {
                    const pointerY = event.activatorEvent?.clientY != null
                        ? event.activatorEvent.clientY + (event.delta?.y || 0)
                        : null;
                    const overRect = event.over.rect;
                    const midY = overRect ? overRect.top + overRect.height / 2 : null;
                    const side = (pointerY !== null && midY !== null && pointerY < midY)
                        ? collectionDropTargetSides.BEFORE
                        : collectionDropTargetSides.AFTER;

                    if (overTab.groupUid) {
                        fallbackOverTarget = {
                            type: collectionDropTargetTypes.GROUP_EDGE,
                            groupUid: overTab.groupUid,
                            side,
                        };
                    } else {
                        fallbackOverTarget = {
                            type: collectionDropTargetTypes.TAB_EDGE,
                            tabId: overTabId,
                            side,
                        };
                    }
                }
            }
        }

        const overRect = event.over?.rect || null;
        const overTarget = activeResolvedDropTargetRef.current || resolveCollectionPointerDropTarget(
            dragModel,
            currentSession,
            fallbackOverTarget,
            currentPointerY,
            overRect,
            activeDropTargetId,
        );
        activeResolvedDropTargetRef.current = null;
        dragPointerRef.current = null;

        if (!overTarget) {
            if (!isCrossCollectionDrop) {
                setDragSession(null);
            }
            return;
        }

        const intent = resolveCollectionDropIntent(dragModel, currentSession, overTarget);
        if (!intent) {
            setDragSession(null);
            return;
        }

        const updatedCollection = applyCollectionDropIntent(baseCollection, intent);
        setDragSession(null);

        if (updatedCollection === baseCollection) {
            return;
        }

        setOptimisticCollection(updatedCollection);
        props.updateCollection(updatedCollection, false);
    };

    const handleDragCancel = () => {
        setActiveOverlay(null);
        setActiveDropTargetId(null);
        activeResolvedDropTargetRef.current = null;
        dragPointerRef.current = null;
        setDragSession(null);
    };

    const collisionDetection = (args) => {
        const currentSession = dragSessionRef.current;
        const rawEnabledDroppableContainers = args.droppableContainers?.getEnabled
            ? args.droppableContainers.getEnabled()
            : args.droppableContainers;
        const enabledDroppableContainers = Array.isArray(rawEnabledDroppableContainers)
            ? rawEnabledDroppableContainers.filter((container) => {
                const data = container.data?.current;
                return !shouldIgnoreDroppableContainerForSession(currentSession, data);
            })
            : rawEnabledDroppableContainers;

        if (Array.isArray(enabledDroppableContainers)) {
            const tabRowContainers = enabledDroppableContainers.filter((container) => {
                const data = container.data?.current;
                return data?.itemType === 'tab' || data?.dropTarget?.type === collectionDropTargetTypes.TAB_ROW;
            });
            const nonTabRowContainers = enabledDroppableContainers.filter((container) => {
                const data = container.data?.current;
                return data?.itemType !== 'tab' && data?.dropTarget?.type !== collectionDropTargetTypes.TAB_ROW;
            });

            if ((currentSession?.kind === 'tab' || currentSession?.kind === 'group') && args.pointerCoordinates) {
                const tabRowPointerCollisions = pointerWithin({
                    ...args,
                    droppableContainers: tabRowContainers,
                });

                if (tabRowPointerCollisions.length > 0) {
                    return tabRowPointerCollisions;
                }
            }

            const nonTabPointerCollisions = pointerWithin({
                ...args,
                droppableContainers: nonTabRowContainers,
            });

            if (nonTabPointerCollisions.length > 0) {
                return nonTabPointerCollisions;
            }
        }

        const pointerCollisions = pointerWithin({
            ...args,
            droppableContainers: enabledDroppableContainers,
        });
        if (pointerCollisions.length > 0) {
            return pointerCollisions;
        }

        const rectCollisions = rectIntersection({
            ...args,
            droppableContainers: enabledDroppableContainers,
        });
        if (rectCollisions.length > 0) {
            return rectCollisions;
        }

        return closestCenter({
            ...args,
            droppableContainers: enabledDroppableContainers,
        });
    };

    const sortableTabIds = useMemo(() => {
        const ids = [];
        for (const item of dragModel.visibleTopLevelItems) {
            if (item.type === 'group') {
                for (const tab of item.tabs) {
                    ids.push(tab.uid);
                }
            } else if (item.type === 'tab') {
                ids.push(item.tab.uid);
            }
        }
        return ids;
    }, [dragModel.visibleTopLevelItems]);

    const emptySearchState = props.search && props.search.trim() && dragModel.visibleTabs.length === 0;
    const startTarget = {
        type: collectionDropTargetTypes.COLLECTION_EDGE,
        position: collectionDropTargetPositions.START,
    };
    const endTarget = {
        type: collectionDropTargetTypes.COLLECTION_EDGE,
        position: collectionDropTargetPositions.END,
    };
    const startDropEnabled = isLocalDrag && isCollectionDropTargetEnabled(dragModel, dragSession, startTarget);
    const endDropEnabled = isLocalDrag && isCollectionDropTargetEnabled(dragModel, dragSession, endTarget);

    useEffect(() => {
        if (!dragSession || dragSession.overCollectionUid !== props.collection.uid) {
            setActiveDropTargetId(null);
        }
    }, [dragSession, props.collection.uid]);

    const renderGroupGap = (groupUid, side) => {
        const target = {
            type: collectionDropTargetTypes.GROUP_EDGE,
            groupUid,
            side,
        };
        const disabled = !isLocalDrag || dragSession?.kind !== 'group' || dragSession?.itemId === groupUid;
        return (
            <DropGap
                key={`group-gap-${groupUid}-${side}`}
                dropTarget={target}
                disabled={disabled}
                variant="group"
                activeOverride={activeDropTargetId === createCollectionDropTargetId(target)}
            />
        );
    };

    // Render DropGap elements around ungrouped tabs during group drags.
    // Groups already have DropGaps; ungrouped tabs need explicit droppable
    // zones so that groups can be dropped between them.
    const renderTabGap = (tabUid, side) => {
        const target = {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: tabUid,
            side,
        };
        const disabled = !isLocalDrag
            || dragSession?.kind !== 'group'
            || !isCollectionDropTargetEnabled(dragModel, dragSession, target);
        return (
            <DropGap
                key={`tab-gap-${tabUid}-${side}`}
                dropTarget={target}
                disabled={disabled}
                variant="group"
                activeOverride={activeDropTargetId === createCollectionDropTargetId(target)}
            />
        );
    };

    return (
        <div
            className={`expanded-content ${showForeignCollectionHover ? 'collection-detail-drop-hover' : ''}`}
            data-collection-uid={props.collection.uid}
            data-collection-drop-zone="true"
        >
            <div className="tab-actions-toolbar" onClick={(event) => event.stopPropagation()}>
                <div className="toolbar-section">
                    <div className="toolbar-buttons">
                        <button
                            className="modern-action-button primary"
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content={`Add ${isHighlighted ? 'selected tabs' : 'the current tab'} to this collection`}
                            data-place="bottom"
                            data-tooltip-class-name="small-tooltip"
                            onClick={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                handleAddSelectedTabs();
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
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
                            data-tooltip-id="main-tooltip"
                            data-tooltip-content="Add all tabs from this window to this collection"
                            data-place="bottom"
                            data-tooltip-class-name="small-tooltip"
                            onClick={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                handleAddAllTabs();
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
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
                collisionDetection={collisionDetection}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
                measuring={measuring}
            >
                {props.search && props.search.trim() && dragModel.visibleTabs.length > 0 ? (
                    <div className="search-results-indicator" onClick={(event) => event.stopPropagation()}>
                        <span className="search-results-text">
                            Showing {dragModel.visibleTabs.length} of {baseCollection.tabs.length} tab{dragModel.visibleTabs.length !== 1 ? 's' : ''} matching "{props.search}"
                        </span>
                    </div>
                ) : null}

                <div className="tabs-section">
                    <CollectionEdgeDropZone
                        collectionUid={props.collection.uid}
                        target={startTarget}
                        label="Drop at start"
                        disabled={!startDropEnabled}
                    />

                    <SortableContext items={sortableTabIds} strategy={verticalListSortingStrategy}>
                    {dragModel.visibleTopLevelItems.length > 0 ? dragModel.visibleTopLevelItems.map((item, index) => {
                        if (item.type === 'group') {
                            // Hide surrounding DropGaps for the group being dragged
                            // so that no stale spacing remains in its original location.
                            const isDraggedGroup = isLocalDrag
                                && dragSession?.kind === 'group'
                                && dragSession?.itemId === item.groupUid;
                            const showBeforeGap = index === 0 && !isDraggedGroup;
                            const showAfterGap = !isDraggedGroup;

                            return (
                                <React.Fragment key={`group-${item.groupUid}`}>
                                    {showBeforeGap ? renderGroupGap(item.groupUid, collectionDropTargetSides.BEFORE) : null}
                                    <SortableGroupContainer
                                        group={item.group}
                                        tabs={item.tabs}
                                        collection={baseCollection}
                                        onSaveGroupColor={handleSaveGroupColor}
                                        onSaveGroupName={saveGroupName}
                                        onDeleteGroup={handleDeleteGroup}
                                        onOpenGroupTabs={handleOpenGroupTabs}
                                        isExpanded={expandedGroupUids.has(item.groupUid)}
                                        onToggleExpanded={handleToggleGroupExpanded}
                                        disableDrag={false}
                                        dragSession={isLocalDrag ? dragSession : null}
                                    >
                                        {item.tabs.map((tab) => (
                                            <SortableTabRow
                                                key={`tab-${tab.uid}`}
                                                tab={tab}
                                                updateCollection={props.updateCollection}
                                                collection={baseCollection}
                                                group={item.group}
                                                disableDrag={tab.pinned}
                                                search={props.search}
                                            />
                                        ))}
                                    </SortableGroupContainer>
                                    {showAfterGap ? renderGroupGap(item.groupUid, collectionDropTargetSides.AFTER) : null}
                                </React.Fragment>
                            );
                        }

                        const showBeforeGap = index === 0;

                        return (
                            <React.Fragment key={`ungrouped-tab-${item.tab.uid}`}>
                                {showBeforeGap ? renderTabGap(item.tab.uid, collectionDropTargetSides.BEFORE) : null}
                                <div className="ungrouped-tab-wrapper">
                                    <SortableTabRow
                                        tab={item.tab}
                                        updateCollection={props.updateCollection}
                                        collection={baseCollection}
                                        group={null}
                                        disableDrag={item.tab.pinned}
                                        search={props.search}
                                    />
                                </div>
                                {renderTabGap(item.tab.uid, collectionDropTargetSides.AFTER)}
                            </React.Fragment>
                        );
                    }) : (
                        emptySearchState ? (
                            <div className="no-matching-tabs-message" onClick={(event) => event.stopPropagation()}>
                                <p>No tabs match "{props.search}" in this collection.</p>
                            </div>
                        ) : null
                    )}
                    </SortableContext>

                    <CollectionEdgeDropZone
                        collectionUid={props.collection.uid}
                        target={endTarget}
                        label="Drop at end"
                        disabled={!endDropEnabled}
                    />
                </div>

                {createPortal(
                    <DragOverlay adjustScale={false} dropAnimation={null}>
                        {activeOverlay?.kind === 'group' ? (
                            <div
                                style={{
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    cursor: 'grabbing',
                                    zIndex: 999999,
                                    width: '400px',
                                }}
                            >
                                <GroupContainer
                                    group={activeOverlay.group}
                                    tabs={activeOverlay.tabs}
                                    onSaveGroupColor={() => {}}
                                    onSaveGroupName={() => {}}
                                    onDeleteGroup={() => {}}
                                    onOpenGroupTabs={() => {}}
                                    isExpanded={false}
                                    isDragging
                                />
                            </div>
                        ) : activeOverlay?.kind === 'tab' ? (
                            <div
                                style={{
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    cursor: 'grabbing',
                                    zIndex: 999999,
                                }}
                            >
                                <TabRow
                                    tab={activeOverlay.tab}
                                    updateCollection={props.updateCollection}
                                    collection={baseCollection}
                                    group={groupFromId(activeOverlay.tab.groupUid, baseCollection.chromeGroups)}
                                    isDragging
                                />
                            </div>
                        ) : null}
                    </DragOverlay>,
                    document.body,
                )}
            </DndContext>
        </div>
    );
}

export default ExpandedCollectionData;
