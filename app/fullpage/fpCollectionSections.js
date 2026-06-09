import { sortCollectionsForDisplay } from '../utils/storageUtils';
import {
    normalizeCollectionParentId,
    ROOT_LEVEL_SECTION_ID,
} from '../utils/collectionSectionDragEngine';

export { ROOT_LEVEL_SECTION_ID } from '../utils/collectionSectionDragEngine';

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
            collections.filter(collection => normalizeCollectionParentId(collection, folderUidSet) === folder.uid),
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
        collections.filter(collection => normalizeCollectionParentId(collection, folderUidSet) === null),
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
