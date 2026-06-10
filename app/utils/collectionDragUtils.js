const DROP_TARGET_TYPE = Object.freeze({
    COLLECTION_EDGE: 'collection-edge',
    TAB_ROW: 'tab-row',
    TAB_EDGE: 'tab-edge',
    GROUP_EDGE: 'group-edge',
    GROUP_APPEND: 'group-append',
});

const DROP_TARGET_SIDE = Object.freeze({
    BEFORE: 'before',
    AFTER: 'after',
});

const DROP_TARGET_POSITION = Object.freeze({
    START: 'start',
    END: 'end',
});

const normalizeTabs = (collection) => Array.isArray(collection?.tabs) ? collection.tabs : [];
const normalizeGroups = (collection) => Array.isArray(collection?.chromeGroups) ? collection.chromeGroups : [];

const escapeRegex = (value) => value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

const buildGroupTabsMap = (tabs) => {
    const groupTabsMap = new Map();

    tabs.forEach((tab) => {
        if (!tab.groupUid) {
            return;
        }

        if (!groupTabsMap.has(tab.groupUid)) {
            groupTabsMap.set(tab.groupUid, []);
        }

        groupTabsMap.get(tab.groupUid).push(tab);
    });

    return groupTabsMap;
};

const buildTopLevelItems = (tabs, groups, includeEmptyGroups = false) => {
    const topLevelItems = [];
    const groupTabsMap = buildGroupTabsMap(tabs);
    const groupMap = new Map(groups.map((group) => [group.uid, group]));
    const processedGroups = new Set();

    tabs.forEach((tab) => {
        if (tab.groupUid) {
            if (processedGroups.has(tab.groupUid)) {
                return;
            }

            const group = groupMap.get(tab.groupUid);
            const groupTabs = groupTabsMap.get(tab.groupUid) || [];

            if (!group || groupTabs.length === 0) {
                return;
            }

            topLevelItems.push({
                type: 'group',
                groupUid: tab.groupUid,
                group,
                tabs: groupTabs,
            });
            processedGroups.add(tab.groupUid);
            return;
        }

        topLevelItems.push({
            type: 'tab',
            tab,
        });
    });

    if (includeEmptyGroups) {
        groups.forEach((group) => {
            if (processedGroups.has(group.uid)) {
                return;
            }

            topLevelItems.push({
                type: 'group',
                groupUid: group.uid,
                group,
                tabs: groupTabsMap.get(group.uid) || [],
            });
        });
    }

    return topLevelItems;
};

const getFirstMovableIndex = (tabs) => {
    for (let index = 0; index < tabs.length; index += 1) {
        if (!tabs[index].pinned) {
            return index;
        }
    }

    return tabs.length;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const withUngroupedTab = (tab) => {
    const updatedTab = { ...tab };
    delete updatedTab.groupUid;
    delete updatedTab.groupId;
    updatedTab.groupId = -1;
    return updatedTab;
};

const withGroupedTab = (tab, group) => ({
    ...tab,
    groupUid: group.uid,
    groupId: group.id || group.uid,
});

export const collectionDropTargetTypes = DROP_TARGET_TYPE;
export const collectionDropTargetSides = DROP_TARGET_SIDE;
export const collectionDropTargetPositions = DROP_TARGET_POSITION;

export function createCollectionDropTargetId(target) {
    if (!target?.type) {
        return null;
    }

    if (target.type === DROP_TARGET_TYPE.COLLECTION_EDGE) {
        return `${DROP_TARGET_TYPE.COLLECTION_EDGE}:${target.position}`;
    }

    if (target.type === DROP_TARGET_TYPE.TAB_ROW) {
        return `${DROP_TARGET_TYPE.TAB_ROW}:${target.tabId}`;
    }

    if (target.type === DROP_TARGET_TYPE.TAB_EDGE) {
        return `${DROP_TARGET_TYPE.TAB_EDGE}:${target.tabId}:${target.side}`;
    }

    if (target.type === DROP_TARGET_TYPE.GROUP_EDGE) {
        return `${DROP_TARGET_TYPE.GROUP_EDGE}:${target.groupUid}:${target.side}`;
    }

    if (target.type === DROP_TARGET_TYPE.GROUP_APPEND) {
        return `${DROP_TARGET_TYPE.GROUP_APPEND}:${target.groupUid}:${target.surface || 'body'}`;
    }

    return null;
}

export function parseCollectionDropTargetId(id) {
    if (typeof id !== 'string') {
        return null;
    }

    const parts = id.split(':');
    const [type, value, detail] = parts;

    if (type === DROP_TARGET_TYPE.COLLECTION_EDGE && value) {
        return {
            type,
            position: value,
        };
    }

    if (type === DROP_TARGET_TYPE.TAB_ROW && value) {
        return {
            type,
            tabId: value,
        };
    }

    if (type === DROP_TARGET_TYPE.TAB_EDGE && value && detail) {
        return {
            type,
            tabId: value,
            side: detail,
        };
    }

    if (type === DROP_TARGET_TYPE.GROUP_EDGE && value && detail) {
        return {
            type,
            groupUid: value,
            side: detail,
        };
    }

    if (type === DROP_TARGET_TYPE.GROUP_APPEND && value) {
        return {
            type,
            groupUid: value,
            surface: detail || 'body',
        };
    }

    return null;
}

export function buildCollectionDragModel(collection, search = '') {
    const tabs = normalizeTabs(collection);
    const groups = normalizeGroups(collection);
    const tabsByUid = new Map(tabs.map((tab) => [tab.uid, tab]));
    const groupsByUid = new Map(groups.map((group) => [group.uid, group]));
    const searchTerm = search?.trim() || '';
    const searchRegex = searchTerm ? new RegExp(escapeRegex(searchTerm), 'i') : null;
    const visibleTabs = searchRegex
        ? tabs.filter((tab) => tab.title?.match(searchRegex) || tab.url?.match(searchRegex))
        : tabs;
    const visibleTabUids = new Set(visibleTabs.map((tab) => tab.uid));
    const fullTopLevelItems = buildTopLevelItems(tabs, groups, true);
    const visibleTopLevelItems = searchRegex
        ? buildTopLevelItems(visibleTabs, groups, false)
        : buildTopLevelItems(tabs, groups, false);
    const fullTopLevelIndexByGroupUid = new Map();
    const fullTopLevelIndexByTabUid = new Map();

    fullTopLevelItems.forEach((item, index) => {
        if (item.type === 'group') {
            fullTopLevelIndexByGroupUid.set(item.groupUid, index);
            item.tabs.forEach((tab) => fullTopLevelIndexByTabUid.set(tab.uid, index));
            return;
        }

        fullTopLevelIndexByTabUid.set(item.tab.uid, index);
    });

    // Index of the first top-level item that is NOT a pinned tab.
    // Groups and unpinned tabs must not be placed before this index.
    let firstNonPinnedTopLevelIndex = 0;
    for (let i = 0; i < fullTopLevelItems.length; i += 1) {
        const item = fullTopLevelItems[i];
        if (item.type === 'tab' && item.tab.pinned) {
            firstNonPinnedTopLevelIndex = i + 1;
        } else {
            break;
        }
    }

    return {
        collection,
        tabs,
        groups,
        tabsByUid,
        groupsByUid,
        visibleTabs,
        visibleTabUids,
        fullTopLevelItems,
        visibleTopLevelItems,
        fullTopLevelIndexByGroupUid,
        fullTopLevelIndexByTabUid,
        firstMovableIndex: getFirstMovableIndex(tabs),
        firstNonPinnedTopLevelIndex,
        search: searchTerm,
    };
}

export function resolveCollectionDropIntent(model, session, target) {
    if (!model || !session || !target) {
        return null;
    }

    if (session.kind === 'tab') {
        const tab = model.tabsByUid.get(session.itemId);
        if (!tab || tab.pinned) {
            return null;
        }

        if (target.type === DROP_TARGET_TYPE.COLLECTION_EDGE) {
            if (target.position === DROP_TARGET_POSITION.START && model.firstMovableIndex > 0) {
                return null;
            }

            return {
                kind: 'move-tab',
                tabId: session.itemId,
                insertIndex: target.position === DROP_TARGET_POSITION.START ? 0 : model.tabs.length,
                groupUid: null,
            };
        }

        if (target.type === DROP_TARGET_TYPE.TAB_EDGE) {
            const anchorTab = model.tabsByUid.get(target.tabId);
            if (!anchorTab) {
                return null;
            }

            const anchorIndex = model.tabs.findIndex((item) => item.uid === anchorTab.uid);
            if (anchorIndex === -1) {
                return null;
            }

            const insertIndex = anchorIndex + (target.side === DROP_TARGET_SIDE.AFTER ? 1 : 0);
            if (insertIndex < model.firstMovableIndex) {
                return null;
            }

            return {
                kind: 'move-tab',
                tabId: session.itemId,
                insertIndex,
                groupUid: anchorTab.groupUid || null,
            };
        }

        if (target.type === DROP_TARGET_TYPE.GROUP_EDGE) {
            const groupTabs = model.tabs.filter((tabItem) => tabItem.groupUid === target.groupUid);
            if (groupTabs.length === 0) {
                return null;
            }

            const anchorTab = target.side === DROP_TARGET_SIDE.BEFORE ? groupTabs[0] : groupTabs[groupTabs.length - 1];
            const anchorIndex = model.tabs.findIndex((tabItem) => tabItem.uid === anchorTab.uid);
            if (anchorIndex === -1) {
                return null;
            }

            const insertIndex = anchorIndex + (target.side === DROP_TARGET_SIDE.AFTER ? 1 : 0);
            if (insertIndex < model.firstMovableIndex) {
                return null;
            }

            return {
                kind: 'move-tab',
                tabId: session.itemId,
                insertIndex,
                groupUid: null,
            };
        }

        if (target.type === DROP_TARGET_TYPE.GROUP_APPEND) {
            const group = model.groupsByUid.get(target.groupUid);
            if (!group) {
                return null;
            }

            const groupTabs = model.tabs.filter((tabItem) => tabItem.groupUid === target.groupUid);
            const insertIndex = groupTabs.length === 0
                ? model.tabs.length
                : model.tabs.findIndex((tabItem) => tabItem.uid === groupTabs[groupTabs.length - 1].uid) + 1;

            return {
                kind: 'move-tab',
                tabId: session.itemId,
                insertIndex,
                groupUid: target.groupUid,
            };
        }

        return null;
    }

    if (session.kind === 'group') {
        const group = model.groupsByUid.get(session.itemId);
        if (!group) {
            return null;
        }

        const minIndex = model.firstNonPinnedTopLevelIndex;

        if (target.type === DROP_TARGET_TYPE.COLLECTION_EDGE) {
            return {
                kind: 'move-group',
                groupUid: session.itemId,
                insertTopLevelIndex: target.position === DROP_TARGET_POSITION.START
                    ? minIndex
                    : model.fullTopLevelItems.length,
            };
        }

        if (target.type === DROP_TARGET_TYPE.GROUP_EDGE) {
            const topLevelIndex = model.fullTopLevelIndexByGroupUid.get(target.groupUid);
            if (topLevelIndex === undefined) {
                return null;
            }

            const insertTopLevelIndex = topLevelIndex + (target.side === DROP_TARGET_SIDE.AFTER ? 1 : 0);
            if (insertTopLevelIndex < minIndex) {
                return null;
            }

            return {
                kind: 'move-group',
                groupUid: session.itemId,
                insertTopLevelIndex,
            };
        }

        if (target.type === DROP_TARGET_TYPE.TAB_EDGE) {
            const anchorTab = model.tabsByUid.get(target.tabId);
            if (!anchorTab || anchorTab.groupUid) {
                return null;
            }

            const topLevelIndex = model.fullTopLevelIndexByTabUid.get(anchorTab.uid);
            if (topLevelIndex === undefined) {
                return null;
            }

            const insertTopLevelIndex = topLevelIndex + (target.side === DROP_TARGET_SIDE.AFTER ? 1 : 0);
            if (insertTopLevelIndex < minIndex) {
                return null;
            }

            return {
                kind: 'move-group',
                groupUid: session.itemId,
                insertTopLevelIndex,
            };
        }
    }

    return null;
}

export function resolveCollectionPointerDropTarget(model, session, target, pointerY, rowRect, activeTargetId = null) {
    if (!target) {
        return null;
    }

    if (target.type !== DROP_TARGET_TYPE.TAB_ROW) {
        return target;
    }

    const beforeTarget = {
        type: DROP_TARGET_TYPE.TAB_EDGE,
        tabId: target.tabId,
        side: DROP_TARGET_SIDE.BEFORE,
    };
    const afterTarget = {
        type: DROP_TARGET_TYPE.TAB_EDGE,
        tabId: target.tabId,
        side: DROP_TARGET_SIDE.AFTER,
    };
    const beforeEnabled = isCollectionDropTargetEnabled(model, session, beforeTarget);
    const afterEnabled = isCollectionDropTargetEnabled(model, session, afterTarget);

    if (!beforeEnabled && !afterEnabled) {
        return null;
    }

    let preferredSide = null;

    // Tab-over-tab drags follow sortable-swap semantics: dnd-kit's sortable
    // translation already shows the dragged row taking the hovered row's
    // place as soon as it becomes the `over` target, so the drop side is the
    // direction of travel — AFTER when dragging down, BEFORE when dragging
    // up — independent of which half of the row the pointer is in.  Pointer
    // halves would contradict what the list is visually previewing.
    if (session?.kind === 'tab' && session.itemId && session.itemId !== target.tabId) {
        const draggedIndex = model.tabs.findIndex((tab) => tab.uid === session.itemId);
        const targetIndex = model.tabs.findIndex((tab) => tab.uid === target.tabId);

        if (draggedIndex !== -1 && targetIndex !== -1) {
            preferredSide = draggedIndex < targetIndex ? DROP_TARGET_SIDE.AFTER : DROP_TARGET_SIDE.BEFORE;
        }
    }

    if (preferredSide === null) {
        preferredSide = DROP_TARGET_SIDE.AFTER;
        if (typeof pointerY === 'number' && rowRect && typeof rowRect.top === 'number' && typeof rowRect.height === 'number') {
            const midpoint = rowRect.top + (rowRect.height / 2);
            const deadZone = Math.max(4, Math.min(Math.round(rowRect.height * 0.12), 10));
            const currentSide = activeTargetId === createCollectionDropTargetId(beforeTarget)
                ? DROP_TARGET_SIDE.BEFORE
                : activeTargetId === createCollectionDropTargetId(afterTarget)
                    ? DROP_TARGET_SIDE.AFTER
                    : null;

            if (currentSide && Math.abs(pointerY - midpoint) <= deadZone) {
                preferredSide = currentSide;
            } else {
                preferredSide = pointerY < midpoint ? DROP_TARGET_SIDE.BEFORE : DROP_TARGET_SIDE.AFTER;
            }
        } else if (activeTargetId === createCollectionDropTargetId(beforeTarget)) {
            preferredSide = DROP_TARGET_SIDE.BEFORE;
        }
    }

    if (preferredSide === DROP_TARGET_SIDE.BEFORE) {
        if (beforeEnabled) {
            return beforeTarget;
        }
        return afterEnabled ? afterTarget : null;
    }

    if (afterEnabled) {
        return afterTarget;
    }

    return beforeEnabled ? beforeTarget : null;
}

export function shouldIgnoreDroppableContainerForSession(session, droppableData) {
    if (!session || !droppableData) {
        return false;
    }

    return session.kind === 'tab'
        && droppableData.itemType === 'tab'
        && !!droppableData.pinned;
}

function wouldTabMoveChangeCollection(model, intent) {
    if (!model || !intent?.tabId) {
        return false;
    }

    const tab = model.tabsByUid.get(intent.tabId);
    if (!tab || tab.pinned) {
        return false;
    }

    const oldIndex = model.tabs.findIndex((item) => item.uid === intent.tabId);
    if (oldIndex === -1) {
        return false;
    }

    let insertIndex = clamp(intent.insertIndex, 0, model.tabs.length);
    insertIndex = Math.max(insertIndex, model.firstMovableIndex);

    const finalIndex = oldIndex < insertIndex ? insertIndex - 1 : insertIndex;
    const originalGroupUid = tab.groupUid || null;
    const nextGroupUid = intent.groupUid || null;

    return finalIndex !== oldIndex || originalGroupUid !== nextGroupUid;
}

function wouldGroupMoveChangeCollection(model, intent) {
    if (!model || !intent?.groupUid) {
        return false;
    }

    const draggedIndex = model.fullTopLevelItems.findIndex(
        (item) => item.type === 'group' && item.groupUid === intent.groupUid,
    );

    if (draggedIndex === -1) {
        return false;
    }

    let insertIndex = clamp(intent.insertTopLevelIndex, 0, model.fullTopLevelItems.length);
    if (draggedIndex < insertIndex) {
        insertIndex -= 1;
    }

    return draggedIndex !== insertIndex;
}

export function isCollectionDropTargetEnabled(model, session, target) {
    const intent = resolveCollectionDropIntent(model, session, target);

    if (!intent) {
        return false;
    }

    if (intent.kind === 'move-tab') {
        return wouldTabMoveChangeCollection(model, intent);
    }

    if (intent.kind === 'move-group') {
        return wouldGroupMoveChangeCollection(model, intent);
    }

    return false;
}

const removeEmptyGroupIfNeeded = (groups, tabs, groupUid) => {
    if (!groupUid) {
        return groups;
    }

    const groupHasTabs = tabs.some((tab) => tab.groupUid === groupUid);
    return groupHasTabs ? groups : groups.filter((group) => group.uid !== groupUid);
};

const applyTabMove = (collection, intent) => {
    const tabs = [...normalizeTabs(collection)];
    const groups = normalizeGroups(collection);
    const oldIndex = tabs.findIndex((tab) => tab.uid === intent.tabId);

    if (oldIndex === -1 || tabs[oldIndex].pinned) {
        return collection;
    }

    const originalTab = tabs[oldIndex];
    const targetGroup = intent.groupUid ? groups.find((group) => group.uid === intent.groupUid) : null;
    if (intent.groupUid && !targetGroup) {
        return collection;
    }

    let insertIndex = clamp(intent.insertIndex, 0, tabs.length);
    insertIndex = Math.max(insertIndex, getFirstMovableIndex(tabs));

    const finalIndex = oldIndex < insertIndex ? insertIndex - 1 : insertIndex;
    const nextGroupUid = targetGroup ? targetGroup.uid : null;
    const originalGroupUid = originalTab.groupUid || null;

    if (finalIndex === oldIndex && originalGroupUid === nextGroupUid) {
        return collection;
    }

    const [removedTab] = tabs.splice(oldIndex, 1);
    const movedTab = targetGroup ? withGroupedTab(removedTab, targetGroup) : withUngroupedTab(removedTab);
    tabs.splice(finalIndex, 0, movedTab);

    const nextGroups = removeEmptyGroupIfNeeded(groups, tabs, originalGroupUid);

    return {
        ...collection,
        tabs,
        chromeGroups: nextGroups,
        lastUpdated: Date.now(),
    };
};

const applyGroupMove = (collection, intent) => {
    const tabs = normalizeTabs(collection);
    const groups = normalizeGroups(collection);
    const layout = buildTopLevelItems(tabs, groups, true);
    const draggedIndex = layout.findIndex((item) => item.type === 'group' && item.groupUid === intent.groupUid);

    if (draggedIndex === -1) {
        return collection;
    }

    let insertIndex = clamp(intent.insertTopLevelIndex, 0, layout.length);
    if (draggedIndex < insertIndex) {
        insertIndex -= 1;
    }

    if (draggedIndex === insertIndex) {
        return collection;
    }

    const [removedEntry] = layout.splice(draggedIndex, 1);
    layout.splice(insertIndex, 0, removedEntry);

    const nextTabs = [];
    const nextGroups = [];

    layout.forEach((item) => {
        if (item.type === 'group') {
            if (item.tabs?.length) {
                nextTabs.push(...item.tabs);
            }

            if (item.group && !nextGroups.find((group) => group.uid === item.group.uid)) {
                nextGroups.push(item.group);
            }
            return;
        }

        nextTabs.push(item.tab);
    });

    groups.forEach((group) => {
        if (!nextGroups.find((item) => item.uid === group.uid)) {
            nextGroups.push(group);
        }
    });

    return {
        ...collection,
        tabs: nextTabs,
        chromeGroups: nextGroups,
        lastUpdated: Date.now(),
    };
};

export function applyCollectionDropIntent(collection, intent) {
    if (!intent) {
        return collection;
    }

    if (intent.kind === 'move-tab') {
        return applyTabMove(collection, intent);
    }

    if (intent.kind === 'move-group') {
        return applyGroupMove(collection, intent);
    }

    return collection;
}

export function applyCrossCollectionTransfer(sourceCollection, targetCollection, session) {
    if (!sourceCollection || !targetCollection || !session || sourceCollection.uid === targetCollection.uid) {
        return null;
    }

    if (session.kind === 'tab') {
        const sourceTabs = normalizeTabs(sourceCollection);
        const sourceGroups = normalizeGroups(sourceCollection);
        const tab = session.snapshot?.tab || sourceTabs.find((item) => item.uid === session.itemId);

        if (!tab) {
            return null;
        }

        const nextSourceTabs = sourceTabs.filter((item) => item.uid !== tab.uid);
        const nextSourceGroups = removeEmptyGroupIfNeeded(sourceGroups, nextSourceTabs, tab.groupUid || null);
        const nextTargetTabs = [...normalizeTabs(targetCollection), withUngroupedTab(tab)];

        return {
            sourceCollection: {
                ...sourceCollection,
                tabs: nextSourceTabs,
                chromeGroups: nextSourceGroups,
                lastUpdated: Date.now(),
            },
            targetCollection: {
                ...targetCollection,
                tabs: nextTargetTabs,
                chromeGroups: normalizeGroups(targetCollection),
                lastUpdated: Date.now(),
            },
        };
    }

    if (session.kind === 'group') {
        const sourceTabs = normalizeTabs(sourceCollection);
        const sourceGroups = normalizeGroups(sourceCollection);
        const group = session.snapshot?.group || sourceGroups.find((item) => item.uid === session.itemId);
        const tabs = session.snapshot?.tabs || sourceTabs.filter((item) => item.groupUid === session.itemId);

        if (!group) {
            return null;
        }

        const nextSourceTabs = sourceTabs.filter((item) => item.groupUid !== group.uid);
        const nextSourceGroups = sourceGroups.filter((item) => item.uid !== group.uid);
        const nextTargetGroups = [...normalizeGroups(targetCollection), group];
        const nextTargetTabs = [
            ...normalizeTabs(targetCollection),
            ...tabs.map((tab) => withGroupedTab(tab, group)),
        ];

        return {
            sourceCollection: {
                ...sourceCollection,
                tabs: nextSourceTabs,
                chromeGroups: nextSourceGroups,
                lastUpdated: Date.now(),
            },
            targetCollection: {
                ...targetCollection,
                tabs: nextTargetTabs,
                chromeGroups: nextTargetGroups,
                lastUpdated: Date.now(),
            },
        };
    }

    return null;
}
