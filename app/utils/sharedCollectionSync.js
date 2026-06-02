import { updateCollectionsOrder, updateFolderCollectionCount } from './storageUtils';
import { normalizeCollectionParentId } from './collectionSectionDragEngine';

const sortCollectionsForPersistence = (collections = []) => {
    return [...collections].sort((a, b) => {
        const aOrder = a?.order;
        const bOrder = b?.order;
        const aHasOrder = aOrder !== undefined && aOrder !== null;
        const bHasOrder = bOrder !== undefined && bOrder !== null;

        if (aHasOrder && bHasOrder) {
            return aOrder - bOrder;
        }

        if (aHasOrder) {
            return -1;
        }

        if (bHasOrder) {
            return 1;
        }

        return 0;
    });
};

export const persistCollectionLayoutChanges = async ({
    nextCollections = [],
    affectedParentIds = [],
    folderUidSet = new Set(),
    updateRemoteData,
    setOptimisticCollections,
}) => {
    const normalizedParents = [...new Set(
        affectedParentIds.map((parentId) => (parentId && folderUidSet.has(parentId) ? parentId : null)),
    )];

    for (const parentId of normalizedParents) {
        const siblingCollections = sortCollectionsForPersistence(
            nextCollections.filter((collection) => normalizeCollectionParentId(collection, folderUidSet) === parentId),
        );

        await updateCollectionsOrder(siblingCollections);
    }

    for (const folderId of normalizedParents.filter(Boolean)) {
        await updateFolderCollectionCount(folderId);
    }

    if (typeof setOptimisticCollections === 'function') {
        setOptimisticCollections(nextCollections);
    }

    await updateRemoteData(nextCollections);
};
