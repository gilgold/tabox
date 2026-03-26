import {
    buildGroupedAllCollectionSections,
    isGroupedSectionDropId,
    moveCollectionBetweenParents,
    reorderCollectionsWithinParent,
    resolveGroupedDropId,
    ROOT_LEVEL_SECTION_ID,
} from '../app/fullpage/fpCollectionSections';

describe('fpCollectionSections', () => {
    const folders = [
        { uid: 'folder-a', name: 'Folder A', collapsed: false, order: 0 },
        { uid: 'folder-b', name: 'Folder B', collapsed: true, order: 1 },
    ];

    test('builds grouped sections in folder order and keeps root level last', () => {
        const collections = [
            { uid: 'root-1', name: 'Root', parentId: null, order: 0, lastUpdated: 10 },
            { uid: 'in-b', name: 'In B', parentId: 'folder-b', order: 0, lastUpdated: 20 },
            { uid: 'in-a', name: 'In A', parentId: 'folder-a', order: 0, lastUpdated: 30 },
        ];

        const sections = buildGroupedAllCollectionSections({
            collections,
            folders,
            sortBy: 'lastUpdated',
            sortOrder: 'asc',
        });

        expect(sections.map(section => section.id)).toEqual(['folder-a', 'folder-b', ROOT_LEVEL_SECTION_ID]);
        expect(sections[0].collections.map(collection => collection.uid)).toEqual(['in-a']);
        expect(sections[1].collapsed).toBe(true);
        expect(sections[2].title).toBe('Root Level');
        expect(sections[2].collections.map(collection => collection.uid)).toEqual(['root-1']);
    });

    test('keeps empty folders visible in grouped all collections view', () => {
        const sections = buildGroupedAllCollectionSections({
            collections: [],
            folders,
            sortBy: 'lastUpdated',
            sortOrder: 'asc',
        });

        expect(sections[0].count).toBe(0);
        expect(sections[1].count).toBe(0);
        expect(sections[2].id).toBe(ROOT_LEVEL_SECTION_ID);
    });

    test('renders section collections by sibling order even when the global array order differs', () => {
        const collections = [
            { uid: 'folder-a-2', name: 'Folder A 2', parentId: 'folder-a', order: 1, lastUpdated: 10 },
            { uid: 'root-1', name: 'Root 1', parentId: null, order: 0, lastUpdated: 20 },
            { uid: 'folder-a-1', name: 'Folder A 1', parentId: 'folder-a', order: 0, lastUpdated: 30 },
            { uid: 'root-2', name: 'Root 2', parentId: null, order: 1, lastUpdated: 40 },
        ];

        const sections = buildGroupedAllCollectionSections({
            collections,
            folders,
            sortBy: 'lastUpdated',
            sortOrder: 'asc',
        });

        expect(sections[0].collections.map(collection => collection.uid)).toEqual(['folder-a-1', 'folder-a-2']);
        expect(sections[2].collections.map(collection => collection.uid)).toEqual(['root-1', 'root-2']);
    });

    test('reorders only siblings within the same parent', () => {
        const collections = [
            { uid: 'root-b', name: 'Root B', parentId: null, order: 1, lastUpdated: 20 },
            { uid: 'root-a', name: 'Root A', parentId: null, order: 0, lastUpdated: 10 },
            { uid: 'folder-a-1', name: 'Folder A 1', parentId: 'folder-a', order: 0, lastUpdated: 30 },
        ];

        const nextCollections = reorderCollectionsWithinParent({
            collections,
            folders,
            parentId: null,
            activeId: 'root-a',
            overId: 'root-b',
        });

        expect(nextCollections.find(collection => collection.uid === 'root-a').order).toBe(1);
        expect(nextCollections.find(collection => collection.uid === 'root-b').order).toBe(0);
        expect(nextCollections.find(collection => collection.uid === 'folder-a-1').order).toBe(0);
        expect(nextCollections.find(collection => collection.uid === 'folder-a-1').parentId).toBe('folder-a');
    });

    test('moves a collection between folder and root while reindexing both parents', () => {
        const collections = [
            { uid: 'folder-a-2', name: 'Folder A 2', parentId: 'folder-a', order: 1, lastUpdated: 30 },
            { uid: 'root-a', name: 'Root A', parentId: null, order: 0, lastUpdated: 10 },
            { uid: 'folder-a-1', name: 'Folder A 1', parentId: 'folder-a', order: 0, lastUpdated: 20 },
        ];

        const movedToRoot = moveCollectionBetweenParents({
            collections,
            folders,
            collectionId: 'folder-a-2',
            targetParentId: null,
            targetIndex: 1,
        });

        expect(movedToRoot.find(collection => collection.uid === 'folder-a-2')).toEqual(
            expect.objectContaining({ parentId: null, order: 1 }),
        );
        expect(movedToRoot.find(collection => collection.uid === 'folder-a-1')).toEqual(
            expect.objectContaining({ parentId: 'folder-a', order: 0 }),
        );

        const movedToFolder = moveCollectionBetweenParents({
            collections: movedToRoot,
            folders,
            collectionId: 'root-a',
            targetParentId: 'folder-b',
            targetIndex: 0,
        });

        expect(movedToFolder.find(collection => collection.uid === 'root-a')).toEqual(
            expect.objectContaining({ parentId: 'folder-b', order: 0 }),
        );
        expect(movedToFolder.find(collection => collection.uid === 'folder-a-2')).toEqual(
            expect.objectContaining({ parentId: null, order: 0 }),
        );
    });

    test('prefers sortable collection targets over section fallback when resolving grouped drops', () => {
        const resolvedDropId = resolveGroupedDropId({
            rawOverId: 'root-b',
            lastOverId: 'append-folder-a',
            pointerTarget: { type: 'section', parentId: 'folder-a' },
            collectionIds: ['root-a', 'root-b', 'folder-a-1'],
            activeId: 'root-a',
        });

        expect(resolvedDropId).toBe('root-b');
    });

    test('uses the last meaningful grouped over target when drag end reports the active item', () => {
        const resolvedDropId = resolveGroupedDropId({
            rawOverId: 'root-a',
            lastOverId: 'root-b',
            pointerTarget: { type: 'append', parentId: 'folder-a' },
            collectionIds: ['root-a', 'root-b', 'folder-a-1'],
            activeId: 'root-a',
        });

        expect(resolvedDropId).toBe('root-b');
    });

    test('falls back to section drop ids when no collection target is available', () => {
        expect(isGroupedSectionDropId(`section-${ROOT_LEVEL_SECTION_ID}`)).toBe(true);

        const resolvedDropId = resolveGroupedDropId({
            rawOverId: null,
            lastOverId: null,
            pointerTarget: { type: 'section', parentId: 'folder-b' },
            collectionIds: ['root-a', 'root-b'],
            activeId: 'root-a',
        });

        expect(resolvedDropId).toBe('section-folder-b');
    });
});
