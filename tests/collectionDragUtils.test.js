import {
    applyCollectionDropIntent,
    applyCrossCollectionTransfer,
    buildCollectionDragModel,
    collectionDropTargetPositions,
    collectionDropTargetSides,
    collectionDropTargetTypes,
    isCollectionDropTargetEnabled,
    resolveCollectionPointerDropTarget,
    resolveCollectionDropIntent,
    shouldIgnoreDroppableContainerForSession,
} from '../app/utils/collectionDragUtils';

const makeGroup = (uid, id, title = uid) => ({
    uid,
    id,
    title,
    color: 'blue',
});

const makeTab = (uid, overrides = {}) => ({
    uid,
    title: `Tab ${uid}`,
    url: `https://${uid}.example.com`,
    groupId: -1,
    ...overrides,
});

describe('collectionDragUtils', () => {
    test('resolves a tab row target to before or after based on the pointer half', () => {
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a'),
                makeTab('tab-b'),
                makeTab('tab-c'),
            ],
            chromeGroups: [],
        };
        const model = buildCollectionDragModel(collection);

        expect(resolveCollectionPointerDropTarget(
            model,
            { kind: 'tab', itemId: 'tab-c' },
            { type: collectionDropTargetTypes.TAB_ROW, tabId: 'tab-b' },
            105,
            { top: 100, height: 40 },
            null,
        )).toEqual({
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-b',
            side: collectionDropTargetSides.BEFORE,
        });

        expect(resolveCollectionPointerDropTarget(
            model,
            { kind: 'tab', itemId: 'tab-a' },
            { type: collectionDropTargetTypes.TAB_ROW, tabId: 'tab-b' },
            135,
            { top: 100, height: 40 },
            null,
        )).toEqual({
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-b',
            side: collectionDropTargetSides.AFTER,
        });
    });

    test('falls back to the valid side when one half of a tab row would be a no-op', () => {
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a'),
                makeTab('tab-b'),
            ],
            chromeGroups: [],
        };
        const model = buildCollectionDragModel(collection);

        expect(resolveCollectionPointerDropTarget(
            model,
            { kind: 'tab', itemId: 'tab-a' },
            { type: collectionDropTargetTypes.TAB_ROW, tabId: 'tab-b' },
            105,
            { top: 100, height: 40 },
            null,
        )).toEqual({
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-b',
            side: collectionDropTargetSides.AFTER,
        });
    });

    test('moves an ungrouped tab into a group by appending to the group', () => {
        const group = makeGroup('group-1', 1, 'Work');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a'),
                makeTab('tab-b', { groupUid: group.uid, groupId: group.id }),
                makeTab('tab-c', { groupUid: group.uid, groupId: group.id }),
            ],
            chromeGroups: [group],
        };

        const model = buildCollectionDragModel(collection);
        const intent = resolveCollectionDropIntent(model, { kind: 'tab', itemId: 'tab-a' }, {
            type: collectionDropTargetTypes.GROUP_APPEND,
            groupUid: group.uid,
            surface: 'body',
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-b', 'tab-c', 'tab-a']);
        expect(nextCollection.tabs[2].groupUid).toBe(group.uid);
    });

    test('moves a grouped tab out to the root end', () => {
        const group = makeGroup('group-1', 1, 'Work');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-b', { groupUid: group.uid, groupId: group.id }),
                makeTab('tab-c', { groupUid: group.uid, groupId: group.id }),
                makeTab('tab-z'),
            ],
            chromeGroups: [group],
        };

        const model = buildCollectionDragModel(collection);
        const intent = resolveCollectionDropIntent(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.COLLECTION_EDGE,
            position: collectionDropTargetPositions.END,
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-c', 'tab-z', 'tab-b']);
        expect(nextCollection.tabs[2].groupUid).toBeUndefined();
        expect(nextCollection.tabs[2].groupId).toBe(-1);
    });

    test('moves a tab between groups relative to a target tab', () => {
        const groupOne = makeGroup('group-1', 1, 'Work');
        const groupTwo = makeGroup('group-2', 2, 'Read');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-b', { groupUid: groupOne.uid, groupId: groupOne.id }),
                makeTab('tab-c', { groupUid: groupOne.uid, groupId: groupOne.id }),
                makeTab('tab-d', { groupUid: groupTwo.uid, groupId: groupTwo.id }),
                makeTab('tab-e', { groupUid: groupTwo.uid, groupId: groupTwo.id }),
            ],
            chromeGroups: [groupOne, groupTwo],
        };

        const model = buildCollectionDragModel(collection);
        const intent = resolveCollectionDropIntent(model, { kind: 'tab', itemId: 'tab-c' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-d',
            side: collectionDropTargetSides.BEFORE,
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-b', 'tab-c', 'tab-d', 'tab-e']);
        expect(nextCollection.tabs[1].groupUid).toBe(groupTwo.uid);
        expect(nextCollection.chromeGroups.map((group) => group.uid)).toEqual([groupOne.uid, groupTwo.uid]);
    });

    test('removes the original group when its last tab leaves', () => {
        const group = makeGroup('group-1', 1, 'Solo');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-b', { groupUid: group.uid, groupId: group.id }),
                makeTab('tab-z'),
            ],
            chromeGroups: [group],
        };

        const model = buildCollectionDragModel(collection);
        const intent = resolveCollectionDropIntent(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.COLLECTION_EDGE,
            position: collectionDropTargetPositions.END,
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-z', 'tab-b']);
        expect(nextCollection.chromeGroups).toHaveLength(0);
    });

    test('reorders a group relative to another group', () => {
        const groupOne = makeGroup('group-1', 1, 'One');
        const groupTwo = makeGroup('group-2', 2, 'Two');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a', { groupUid: groupOne.uid, groupId: groupOne.id }),
                makeTab('tab-b', { groupUid: groupOne.uid, groupId: groupOne.id }),
                makeTab('tab-z'),
                makeTab('tab-c', { groupUid: groupTwo.uid, groupId: groupTwo.id }),
            ],
            chromeGroups: [groupOne, groupTwo],
        };

        const model = buildCollectionDragModel(collection);
        const intent = resolveCollectionDropIntent(model, { kind: 'group', itemId: groupOne.uid }, {
            type: collectionDropTargetTypes.GROUP_EDGE,
            groupUid: groupTwo.uid,
            side: collectionDropTargetSides.AFTER,
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-z', 'tab-c', 'tab-a', 'tab-b']);
        expect(nextCollection.chromeGroups.map((group) => group.uid)).toEqual([groupTwo.uid, groupOne.uid]);
    });

    test('reorders a group relative to an ungrouped tab anchor', () => {
        const groupOne = makeGroup('group-1', 1, 'One');
        const groupTwo = makeGroup('group-2', 2, 'Two');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a', { groupUid: groupOne.uid, groupId: groupOne.id }),
                makeTab('tab-z'),
                makeTab('tab-c', { groupUid: groupTwo.uid, groupId: groupTwo.id }),
            ],
            chromeGroups: [groupOne, groupTwo],
        };

        const model = buildCollectionDragModel(collection);
        const intent = resolveCollectionDropIntent(model, { kind: 'group', itemId: groupTwo.uid }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-z',
            side: collectionDropTargetSides.BEFORE,
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-a', 'tab-c', 'tab-z']);
        expect(nextCollection.chromeGroups.map((group) => group.uid)).toEqual([groupOne.uid, groupTwo.uid]);
    });

    test('uses visible tab anchors against the full order when search is active', () => {
        const group = makeGroup('group-1', 1, 'Work');
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('hidden-before', { title: 'Hidden before', groupUid: group.uid, groupId: group.id }),
                makeTab('match-tab', { title: 'Visible match', groupUid: group.uid, groupId: group.id }),
                makeTab('ungrouped-tab', { title: 'Loose tab' }),
            ],
            chromeGroups: [group],
        };

        const model = buildCollectionDragModel(collection, 'Visible');
        const intent = resolveCollectionDropIntent(model, { kind: 'tab', itemId: 'ungrouped-tab' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'match-tab',
            side: collectionDropTargetSides.BEFORE,
        });
        const nextCollection = applyCollectionDropIntent(collection, intent);

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['hidden-before', 'ungrouped-tab', 'match-tab']);
        expect(nextCollection.tabs[1].groupUid).toBe(group.uid);
    });

    test('clamps tab moves to the first unpinned slot', () => {
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('pinned-tab', { pinned: true }),
                makeTab('tab-a'),
                makeTab('tab-b'),
            ],
            chromeGroups: [],
        };

        const nextCollection = applyCollectionDropIntent(collection, {
            kind: 'move-tab',
            tabId: 'tab-b',
            insertIndex: 0,
            groupUid: null,
        });

        expect(nextCollection.tabs.map((tab) => tab.uid)).toEqual(['pinned-tab', 'tab-b', 'tab-a']);
    });

    test('does not enable a tab target that resolves to the dragged tab source slot', () => {
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a'),
                makeTab('tab-b'),
                makeTab('tab-c'),
            ],
            chromeGroups: [],
        };

        const model = buildCollectionDragModel(collection);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-a' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-b',
            side: collectionDropTargetSides.BEFORE,
        })).toBe(false);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-a',
            side: collectionDropTargetSides.AFTER,
        })).toBe(false);
    });

    test('does not enable start or end collection edges when they are no-op tab moves', () => {
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('tab-a'),
                makeTab('tab-b'),
            ],
            chromeGroups: [],
        };

        const model = buildCollectionDragModel(collection);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-a' }, {
            type: collectionDropTargetTypes.COLLECTION_EDGE,
            position: collectionDropTargetPositions.START,
        })).toBe(false);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.COLLECTION_EDGE,
            position: collectionDropTargetPositions.END,
        })).toBe(false);
    });

    test('does not enable tab drop targets above or between pinned tabs', () => {
        const collection = {
            uid: 'collection-1',
            tabs: [
                makeTab('pinned-a', { pinned: true }),
                makeTab('pinned-b', { pinned: true }),
                makeTab('tab-a'),
                makeTab('tab-b'),
            ],
            chromeGroups: [],
        };

        const model = buildCollectionDragModel(collection);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.COLLECTION_EDGE,
            position: collectionDropTargetPositions.START,
        })).toBe(false);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'pinned-a',
            side: collectionDropTargetSides.BEFORE,
        })).toBe(false);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'pinned-a',
            side: collectionDropTargetSides.AFTER,
        })).toBe(false);

        expect(isCollectionDropTargetEnabled(model, { kind: 'tab', itemId: 'tab-b' }, {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'pinned-b',
            side: collectionDropTargetSides.AFTER,
        })).toBe(true);
    });

    test('ignores pinned tab droppables during a tab drag collision pass', () => {
        expect(shouldIgnoreDroppableContainerForSession(
            { kind: 'tab', itemId: 'tab-b' },
            { itemType: 'tab', tabId: 'pinned-a', pinned: true },
        )).toBe(true);

        expect(shouldIgnoreDroppableContainerForSession(
            { kind: 'tab', itemId: 'tab-b' },
            { itemType: 'tab', tabId: 'tab-a', pinned: false },
        )).toBe(false);

        expect(shouldIgnoreDroppableContainerForSession(
            { kind: 'group', itemId: 'group-a' },
            { itemType: 'tab', tabId: 'pinned-a', pinned: true },
        )).toBe(false);
    });

    test('moves a single tab across collections and clears its group', () => {
        const group = makeGroup('group-1', 1, 'Work');
        const sourceCollection = {
            uid: 'source',
            tabs: [
                makeTab('tab-a', { groupUid: group.uid, groupId: group.id }),
            ],
            chromeGroups: [group],
        };
        const targetCollection = {
            uid: 'target',
            tabs: [makeTab('tab-z')],
            chromeGroups: [],
        };

        const result = applyCrossCollectionTransfer(sourceCollection, targetCollection, {
            kind: 'tab',
            itemId: 'tab-a',
            snapshot: {
                tab: sourceCollection.tabs[0],
            },
        });

        expect(result.sourceCollection.tabs).toHaveLength(0);
        expect(result.sourceCollection.chromeGroups).toHaveLength(0);
        expect(result.targetCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-z', 'tab-a']);
        expect(result.targetCollection.tabs[1].groupUid).toBeUndefined();
        expect(result.targetCollection.tabs[1].groupId).toBe(-1);
    });

    test('moves a whole group across collections and preserves the group', () => {
        const group = makeGroup('group-1', 1, 'Work');
        const sourceCollection = {
            uid: 'source',
            tabs: [
                makeTab('tab-a', { groupUid: group.uid, groupId: group.id }),
                makeTab('tab-b', { groupUid: group.uid, groupId: group.id }),
            ],
            chromeGroups: [group],
        };
        const targetCollection = {
            uid: 'target',
            tabs: [makeTab('tab-z')],
            chromeGroups: [],
        };

        const result = applyCrossCollectionTransfer(sourceCollection, targetCollection, {
            kind: 'group',
            itemId: group.uid,
            snapshot: {
                group,
                tabs: sourceCollection.tabs,
            },
        });

        expect(result.sourceCollection.tabs).toHaveLength(0);
        expect(result.sourceCollection.chromeGroups).toHaveLength(0);
        expect(result.targetCollection.chromeGroups.map((item) => item.uid)).toEqual([group.uid]);
        expect(result.targetCollection.tabs.map((tab) => tab.uid)).toEqual(['tab-z', 'tab-a', 'tab-b']);
        expect(result.targetCollection.tabs[1].groupUid).toBe(group.uid);
        expect(result.targetCollection.tabs[2].groupUid).toBe(group.uid);
    });
});
