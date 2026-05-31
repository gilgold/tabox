const ROOT_SECTION_ID = 'root';
const ROOT_SECTION_TITLE = 'No Folder';

const isSingleCollectionImport = (value) => Boolean(value?.tabs && Array.isArray(value.tabs));

const buildPreviewCollection = (collection = {}, index, parentId = null) => ({
    previewId: `preview-${index}`,
    sourceIndex: index,
    sourceParentId: parentId,
    name: collection?.name || `Collection ${index + 1}`,
    color: collection?.color || null,
    tabCount: (collection?.tabs || []).length,
    groupCount: (collection?.chromeGroups || []).length,
    previewTabs: (collection?.tabs || []).slice(0, 8).map((tab) => ({
        title: tab?.title || tab?.url || 'Untitled Tab',
        url: tab?.url || '',
        favIconUrl: tab?.favIconUrl || '',
    })),
});

const buildRootSection = (collections = []) => ({
    id: ROOT_SECTION_ID,
    title: ROOT_SECTION_TITLE,
    kind: 'root',
    color: null,
    collections,
});

export const buildLegacyImportPreview = (parsedImportData) => {
    if (!parsedImportData) {
        throw new Error('Import data is required');
    }

    if (Array.isArray(parsedImportData)) {
        const collections = parsedImportData.map((collection, index) => buildPreviewCollection(collection, index));
        return {
            sourceType: 'array',
            parsedImportData,
            collections,
            sections: [buildRootSection(collections)],
        };
    }

    if (parsedImportData?.type === 'folder') {
        const collections = (parsedImportData.collections || []).map((collection, index) => (
            buildPreviewCollection(collection, index, parsedImportData.folder?.uid || null)
        ));
        return {
            sourceType: 'folder',
            parsedImportData,
            collections,
            sections: [
                {
                    id: `folder:${parsedImportData.folder?.uid || 'folder'}`,
                    title: parsedImportData.folder?.name || 'Folder',
                    kind: 'folder',
                    color: parsedImportData.folder?.color || null,
                    collections,
                },
            ],
        };
    }

    if (parsedImportData?.type === 'full_export') {
        const foldersById = new Map((parsedImportData.folders || []).map((folder) => [folder.uid, folder]));
        const collections = (parsedImportData.collections || []).map((collection, index) => (
            buildPreviewCollection(collection, index, collection?.parentId || null)
        ));
        const grouped = collections.reduce((accumulator, collection) => {
            const sectionId = collection.sourceParentId || ROOT_SECTION_ID;
            if (!accumulator.has(sectionId)) {
                const folder = sectionId === ROOT_SECTION_ID ? null : foldersById.get(sectionId);
                accumulator.set(sectionId, {
                    id: sectionId === ROOT_SECTION_ID ? ROOT_SECTION_ID : `folder:${sectionId}`,
                    title: folder?.name || ROOT_SECTION_TITLE,
                    kind: sectionId === ROOT_SECTION_ID ? 'root' : 'folder',
                    color: folder?.color || null,
                    collections: [],
                });
            }
            accumulator.get(sectionId).collections.push(collection);
            return accumulator;
        }, new Map());

        const sections = [];
        (parsedImportData.folders || []).forEach((folder) => {
            const section = grouped.get(folder.uid);
            if (section) {
                sections.push(section);
            }
        });
        if (grouped.has(ROOT_SECTION_ID)) {
            sections.push(grouped.get(ROOT_SECTION_ID));
        }

        return {
            sourceType: 'full_export',
            parsedImportData,
            collections,
            sections,
        };
    }

    if (isSingleCollectionImport(parsedImportData)) {
        const collection = buildPreviewCollection(parsedImportData, 0);
        return {
            sourceType: 'single_collection',
            parsedImportData,
            collections: [collection],
            sections: [buildRootSection([collection])],
        };
    }

    throw new Error('Unknown import format');
};

export const buildLegacyImportPayloadFromSelection = ({
    parsedImportData,
    selectedCollectionIds = [],
    allPreviewCollections = [],
} = {}) => {
    const selectedIndexSet = new Set(
        (allPreviewCollections || [])
            .filter((collection) => selectedCollectionIds.includes(collection.previewId))
            .map((collection) => collection.sourceIndex)
    );

    if (Array.isArray(parsedImportData)) {
        return parsedImportData.filter((_, index) => selectedIndexSet.has(index));
    }

    if (parsedImportData?.type === 'folder') {
        return {
            type: 'folder',
            folder: parsedImportData.folder,
            collections: (parsedImportData.collections || []).filter((_, index) => selectedIndexSet.has(index)),
        };
    }

    if (parsedImportData?.type === 'full_export') {
        const filteredCollections = (parsedImportData.collections || []).filter((_, index) => selectedIndexSet.has(index));
        const referencedFolderIds = new Set(filteredCollections.map((collection) => collection?.parentId).filter(Boolean));

        return {
            type: 'full_export',
            folders: (parsedImportData.folders || []).filter((folder) => referencedFolderIds.has(folder.uid)),
            collections: filteredCollections,
        };
    }

    if (isSingleCollectionImport(parsedImportData)) {
        return parsedImportData;
    }

    throw new Error('Unknown import format');
};
