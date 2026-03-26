import { updateCollectionsOrder, updateFolderCollectionCount } from './storageUtils';
import { normalizeCollectionParentId } from './collectionSectionDragEngine';

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
        const siblingCollections = nextCollections
            .filter((collection) => normalizeCollectionParentId(collection, folderUidSet) === parentId);

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
