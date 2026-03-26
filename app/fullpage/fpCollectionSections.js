import { arrayMove } from '@dnd-kit/sortable';
import { sortCollectionsForDisplay } from '../utils/storageUtils';

export const ROOT_LEVEL_SECTION_ID = '__root__';

const isCollectionIdTarget = (id, collectionIdSet) => {
    return typeof id === 'string' && collectionIdSet.has(id);
};

export const isGroupedSectionDropId = (id) => {
    return typeof id === 'string' && (
        id === ROOT_LEVEL_SECTION_ID ||
        id.startsWith('section-') ||
        id.startsWith('append-') ||
        id.startsWith('content-')
    );
};

const pointerTargetToDropId = (pointerTarget) => {
    if (!pointerTarget) {
        return null;
    }

    if (pointerTarget.type === 'collection') {
        return pointerTarget.id;
    }

    if (pointerTarget.type === 'section') {
        return `section-${pointerTarget.parentId}`;
    }

    if (pointerTarget.type === 'append') {
        return `append-${pointerTarget.parentId}`;
    }

    return null;
};

export const resolveGroupedDropId = ({
    rawOverId,
    lastOverId,
    pointerTarget,
    collectionIds = [],
    activeId,
}) => {
    const collectionIdSet = collectionIds instanceof Set ? collectionIds : new Set(collectionIds);
    const pointerDropId = pointerTargetToDropId(pointerTarget);

    const collectionCandidates = [
        rawOverId,
        lastOverId,
        pointerDropId,
    ].filter(candidate => (
        isCollectionIdTarget(candidate, collectionIdSet) &&
        candidate !== activeId
    ));

    if (collectionCandidates.length > 0) {
        return collectionCandidates[0];
    }

    const sectionCandidates = [
        rawOverId,
        lastOverId,
        pointerDropId,
    ].filter(candidate => isGroupedSectionDropId(candidate));

    return sectionCandidates[0] || null;
};

export const normalizeParentId = (collection, folderUidSet) => {
    const parentId = collection?.parentId || null;
    return parentId && folderUidSet.has(parentId) ? parentId : null;
};

const sortSectionCollections = (collections, sortBy, sortOrder) => {
    const allHaveExplicitOrder = collections.every(collection => collection.order !== undefined && collection.order !== null);

    if (allHaveExplicitOrder) {
        return [...collections].sort((a, b) => a.order - b.order);
    }

    return sortCollectionsForDisplay(collections, {
        sortBy,
        sortOrder,
        flatSort: true,
    });
};

export const buildGroupedAllCollectionSections = ({
    collections = [],
    folders = [],
    sortBy = 'lastUpdated',
    sortOrder = 'asc',
}) => {
    const folderUidSet = new Set(folders.map(folder => folder.uid));

    const sections = folders.map(folder => {
        const folderCollections = sortSectionCollections(
            collections.filter(collection => normalizeParentId(collection, folderUidSet) === folder.uid),
            sortBy,
            sortOrder,
        );

        return {
            id: folder.uid,
            kind: 'folder',
            title: folder.name,
            color: folder.color,
            collapsed: !!folder.collapsed,
            folder,
            collections: folderCollections,
            count: folderCollections.length,
        };
    });

    const rootCollections = sortSectionCollections(
        collections.filter(collection => normalizeParentId(collection, folderUidSet) === null),
        sortBy,
        sortOrder,
    );

    sections.push({
        id: ROOT_LEVEL_SECTION_ID,
        kind: 'root',
        title: 'Root Level',
        collapsed: false,
        collections: rootCollections,
        count: rootCollections.length,
    });

    return sections;
};

const reindexCollections = (collections, parentId) => {
    return collections.map((collection, index) => ({
        ...collection,
        parentId,
        order: index,
    }));
};

export const reorderCollectionsWithinParent = ({
    collections = [],
    folders = [],
    parentId = null,
    activeId,
    overId,
}) => {
    const folderUidSet = new Set(folders.map(folder => folder.uid));
    const normalizedParentId = parentId && folderUidSet.has(parentId) ? parentId : null;
    const siblingCollections = sortSectionCollections(
        collections.filter(collection => normalizeParentId(collection, folderUidSet) === normalizedParentId),
        'lastUpdated',
        'desc',
    );

    const oldIndex = siblingCollections.findIndex(collection => collection.uid === activeId);
    const newIndex = siblingCollections.findIndex(collection => collection.uid === overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return null;
    }

    const reorderedCollections = reindexCollections(
        arrayMove(siblingCollections, oldIndex, newIndex),
        normalizedParentId,
    );

    const updatedCollectionsByUid = new Map(
        reorderedCollections.map(collection => [collection.uid, collection]),
    );

    return collections.map(collection => updatedCollectionsByUid.get(collection.uid) || collection);
};

export const moveCollectionBetweenParents = ({
    collections = [],
    folders = [],
    collectionId,
    targetParentId = null,
    targetIndex = null,
}) => {
    const folderUidSet = new Set(folders.map(folder => folder.uid));
    const normalizedTargetParentId = targetParentId && folderUidSet.has(targetParentId)
        ? targetParentId
        : null;

    const sourceCollection = collections.find(collection => collection.uid === collectionId);
    if (!sourceCollection) {
        return null;
    }

    const normalizedSourceParentId = normalizeParentId(sourceCollection, folderUidSet);

    const sourceSiblings = sortSectionCollections(
        collections.filter(
            collection =>
                collection.uid !== collectionId &&
                normalizeParentId(collection, folderUidSet) === normalizedSourceParentId,
        ),
        'lastUpdated',
        'desc',
    );

    const targetSiblingsBase = normalizedSourceParentId === normalizedTargetParentId
        ? sourceSiblings
        : sortSectionCollections(
            collections.filter(
                collection =>
                    collection.uid !== collectionId &&
                    normalizeParentId(collection, folderUidSet) === normalizedTargetParentId,
            ),
            'lastUpdated',
            'desc',
        );

    const insertionIndex = targetIndex === null
        ? targetSiblingsBase.length
        : Math.max(0, Math.min(targetIndex, targetSiblingsBase.length));

    const movedCollection = {
        ...sourceCollection,
        parentId: normalizedTargetParentId,
    };

    const nextTargetSiblings = [...targetSiblingsBase];
    nextTargetSiblings.splice(insertionIndex, 0, movedCollection);

    const updatedCollections = [
        ...reindexCollections(sourceSiblings, normalizedSourceParentId),
        ...reindexCollections(nextTargetSiblings, normalizedTargetParentId),
    ];

    const updatedCollectionsByUid = new Map(
        updatedCollections.map(collection => [collection.uid, collection]),
    );

    return collections.map(collection => updatedCollectionsByUid.get(collection.uid) || collection);
};

export const getSectionDropTarget = ({
    activeCollection,
    overId,
    collections = [],
    folders = [],
}) => {
    if (!activeCollection || !overId) {
        return null;
    }

    const folderUidSet = new Set(folders.map(folder => folder.uid));
    const normalizedActiveParentId = normalizeParentId(activeCollection, folderUidSet);

    if (overId === ROOT_LEVEL_SECTION_ID || overId === `section-${ROOT_LEVEL_SECTION_ID}`) {
        return {
            type: 'section',
            targetParentId: null,
            activeParentId: normalizedActiveParentId,
            targetIndex: null,
        };
    }

    if (typeof overId === 'string' && overId.startsWith('section-')) {
        const sectionId = overId.slice('section-'.length);
        const targetParentId = sectionId === ROOT_LEVEL_SECTION_ID ? null : sectionId;

        return {
            type: 'section',
            targetParentId: folderUidSet.has(targetParentId) ? targetParentId : null,
            activeParentId: normalizedActiveParentId,
            targetIndex: null,
        };
    }

    const overCollection = collections.find(collection => collection.uid === overId);
    if (!overCollection) {
        return null;
    }

    const normalizedTargetParentId = normalizeParentId(overCollection, folderUidSet);
    const targetSiblings = sortSectionCollections(
        collections.filter(collection => normalizeParentId(collection, folderUidSet) === normalizedTargetParentId),
        'lastUpdated',
        'desc',
    );
    const targetIndex = targetSiblings.findIndex(collection => collection.uid === overId);

    return {
        type: 'collection',
        targetParentId: normalizedTargetParentId,
        activeParentId: normalizedActiveParentId,
        targetIndex: targetIndex === -1 ? null : targetIndex,
    };
};
