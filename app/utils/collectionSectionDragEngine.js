import { arrayMove } from '@dnd-kit/sortable';
import { sortCollectionsForDisplay } from './storageUtils';

export const ROOT_LEVEL_SECTION_ID = '__root__';

export const collectionDropKinds = Object.freeze({
    collection: 'collection',
    sectionStart: 'section-start',
    sectionEnd: 'section-end',
    sectionEmpty: 'section-empty',
});

export const collectionDropSides = Object.freeze({
    before: 'before',
    after: 'after',
});

export const normalizeCollectionParentId = (collection, folderUidSet) => {
    const parentId = collection?.parentId || null;
    return parentId && folderUidSet.has(parentId) ? parentId : null;
};

const normalizeParentIdValue = (parentId, folderUidSet) => (
    parentId && folderUidSet.has(parentId) ? parentId : null
);

export const sortCollectionsWithinParent = ({
    collections = [],
    folderUidSet,
    parentId = null,
    sortBy = 'lastUpdated',
    sortOrder = 'desc',
}) => {
    const normalizedParentId = normalizeParentIdValue(parentId, folderUidSet);
    const siblingCollections = collections.filter(
        (collection) => normalizeCollectionParentId(collection, folderUidSet) === normalizedParentId,
    );
    const allHaveExplicitOrder = siblingCollections.every(
        (collection) => collection.order !== undefined && collection.order !== null,
    );

    if (allHaveExplicitOrder) {
        return [...siblingCollections].sort((a, b) => a.order - b.order);
    }

    return sortCollectionsForDisplay(siblingCollections, {
        sortBy,
        sortOrder,
        flatSort: true,
    });
};

const reindexCollections = (collections, parentId) => collections.map((collection, index) => ({
    ...collection,
    parentId,
    order: index,
}));

export const getCollectionTargetSide = ({ viewMode = 'grid', point, rect }) => {
    if (!point || !rect) {
        return collectionDropSides.before;
    }

    if (viewMode === 'list') {
        return point.y < rect.top + (rect.height / 2)
            ? collectionDropSides.before
            : collectionDropSides.after;
    }

    const verticalRatio = rect.height > 0 ? (point.y - rect.top) / rect.height : 0.5;
    const horizontalRatio = rect.width > 0 ? (point.x - rect.left) / rect.width : 0.5;

    if (verticalRatio <= 0.33) {
        return collectionDropSides.before;
    }

    if (verticalRatio >= 0.67) {
        return collectionDropSides.after;
    }

    return horizontalRatio < 0.5
        ? collectionDropSides.before
        : collectionDropSides.after;
};

export const resolveCollectionDropTarget = ({ over, collections = [], folderUidSet }) => {
    if (!over) {
        return null;
    }

    const overData = over.data?.current;
    const normalizedOverId = typeof over.id === 'string' && over.id.startsWith('collection-drop-')
        ? over.id.slice('collection-drop-'.length)
        : over.id;

    if (
        overData?.itemType === 'collection' ||
        overData?.dragType === 'collection-card' ||
        collections.some((collection) => collection.uid === normalizedOverId)
    ) {
        const collectionId = overData?.collectionId || normalizedOverId;
        const overCollection = collections.find((collection) => collection.uid === collectionId);

        if (!overCollection) {
            return null;
        }

        return {
            kind: collectionDropKinds.collection,
            collectionId,
            parentId: normalizeCollectionParentId(overCollection, folderUidSet),
        };
    }

    if (overData?.dragType === collectionDropKinds.sectionStart) {
        return {
            kind: collectionDropKinds.sectionStart,
            parentId: normalizeParentIdValue(overData.parentId, folderUidSet),
        };
    }

    if (overData?.dragType === collectionDropKinds.sectionEnd) {
        return {
            kind: collectionDropKinds.sectionEnd,
            parentId: normalizeParentIdValue(overData.parentId, folderUidSet),
        };
    }

    if (overData?.dragType === collectionDropKinds.sectionEmpty) {
        return {
            kind: collectionDropKinds.sectionEmpty,
            parentId: normalizeParentIdValue(overData.parentId, folderUidSet),
        };
    }

    return null;
};

export const resolveCollectionDropOperation = ({
    collections = [],
    folders = [],
    activeId,
    target,
    viewMode = 'list',
    sortBy = 'lastUpdated',
    sortOrder = 'desc',
}) => {
    if (!activeId || !target) {
        return null;
    }

    const folderUidSet = new Set(folders.map((folder) => folder.uid));
    const activeCollection = collections.find((collection) => collection.uid === activeId);

    if (!activeCollection) {
        return null;
    }

    const sourceParentId = normalizeCollectionParentId(activeCollection, folderUidSet);
    const sourceSiblings = sortCollectionsWithinParent({
        collections,
        folderUidSet,
        parentId: sourceParentId,
        sortBy,
        sortOrder,
    });
    const sourceIndex = sourceSiblings.findIndex((collection) => collection.uid === activeId);

    if (sourceIndex === -1) {
        return null;
    }

    let targetParentId = sourceParentId;
    let insertIndex = sourceSiblings.length;

    if (target.kind === collectionDropKinds.collection) {
        if (target.collectionId === activeId) {
            return null;
        }

        targetParentId = normalizeParentIdValue(target.parentId, folderUidSet);
        const targetSiblings = sortCollectionsWithinParent({
            collections,
            folderUidSet,
            parentId: targetParentId,
            sortBy,
            sortOrder,
        });
        const targetIndex = targetSiblings.findIndex((collection) => collection.uid === target.collectionId);

        if (targetIndex === -1) {
            return null;
        }

        if (targetParentId === sourceParentId && viewMode === 'grid') {
            // Grid reorder follows the hovered tile's index, matching the
            // sortable transform behavior the user sees while dragging.
            insertIndex = targetIndex;
        } else {
            insertIndex = targetIndex + (target.side === collectionDropSides.after ? 1 : 0);
        }
    } else if (target.kind === collectionDropKinds.sectionStart || target.kind === collectionDropKinds.sectionEmpty) {
        targetParentId = normalizeParentIdValue(target.parentId, folderUidSet);
        insertIndex = 0;
    } else if (target.kind === collectionDropKinds.sectionEnd) {
        targetParentId = normalizeParentIdValue(target.parentId, folderUidSet);
        insertIndex = sortCollectionsWithinParent({
            collections,
            folderUidSet,
            parentId: targetParentId,
            sortBy,
            sortOrder,
        }).length;
    } else {
        return null;
    }

    if (targetParentId === sourceParentId) {
        const adjustedIndex = viewMode === 'grid' && target.kind === collectionDropKinds.collection
            ? insertIndex
            : insertIndex > sourceIndex
            ? insertIndex - 1
            : insertIndex;
        const clampedIndex = Math.max(0, Math.min(adjustedIndex, sourceSiblings.length - 1));

        if (clampedIndex === sourceIndex) {
            return null;
        }

        return {
            kind: 'reorder',
            activeId,
            sourceParentId,
            targetParentId,
            insertIndex: clampedIndex,
        };
    }

    const targetSiblings = sortCollectionsWithinParent({
        collections,
        folderUidSet,
        parentId: targetParentId,
        sortBy,
        sortOrder,
    });

    return {
        kind: 'move',
        activeId,
        sourceParentId,
        targetParentId,
        insertIndex: Math.max(0, Math.min(insertIndex, targetSiblings.length)),
    };
};

export const applyCollectionDropOperation = ({
    collections = [],
    folders = [],
    operation,
    sortBy = 'lastUpdated',
    sortOrder = 'desc',
}) => {
    if (!operation) {
        return null;
    }

    const folderUidSet = new Set(folders.map((folder) => folder.uid));
    const activeCollection = collections.find((collection) => collection.uid === operation.activeId);

    if (!activeCollection) {
        return null;
    }

    if (operation.kind === 'reorder') {
        const siblings = sortCollectionsWithinParent({
            collections,
            folderUidSet,
            parentId: operation.sourceParentId,
            sortBy,
            sortOrder,
        });
        const fromIndex = siblings.findIndex((collection) => collection.uid === operation.activeId);

        if (fromIndex === -1 || fromIndex === operation.insertIndex) {
            return null;
        }

        const reorderedSiblings = reindexCollections(
            arrayMove(siblings, fromIndex, operation.insertIndex),
            operation.sourceParentId,
        );
        const updatesByUid = new Map(reorderedSiblings.map((collection) => [collection.uid, collection]));

        return collections.map((collection) => updatesByUid.get(collection.uid) || collection);
    }

    if (operation.kind === 'move') {
        const sourceParentId = normalizeParentIdValue(operation.sourceParentId, folderUidSet);
        const targetParentId = normalizeParentIdValue(operation.targetParentId, folderUidSet);
        const sourceSiblings = sortCollectionsWithinParent({
            collections,
            folderUidSet,
            parentId: sourceParentId,
            sortBy,
            sortOrder,
        }).filter((collection) => collection.uid !== operation.activeId);
        const targetSiblings = sortCollectionsWithinParent({
            collections,
            folderUidSet,
            parentId: targetParentId,
            sortBy,
            sortOrder,
        }).filter((collection) => collection.uid !== operation.activeId);
        const nextTargetSiblings = [...targetSiblings];

        nextTargetSiblings.splice(operation.insertIndex, 0, {
            ...activeCollection,
            parentId: targetParentId,
        });

        const updates = [
            ...reindexCollections(sourceSiblings, sourceParentId),
            ...reindexCollections(nextTargetSiblings, targetParentId),
        ];
        const updatesByUid = new Map(updates.map((collection) => [collection.uid, collection]));

        return collections.map((collection) => updatesByUid.get(collection.uid) || collection);
    }

    return null;
};

export const getAffectedCollectionParentIds = (operation) => {
    if (!operation) {
        return [];
    }

    return [...new Set([operation.sourceParentId ?? null, operation.targetParentId ?? null])];
};
