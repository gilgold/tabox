import {
    buildGroupedAllCollectionSections,
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
});
