import {
    applyCollectionDropOperation,
    collectionDropKinds,
    collectionDropSides,
    getAffectedCollectionParentIds,
    getCollectionTargetSide,
    normalizeCollectionParentId,
    resolveCollectionDropOperation,
    resolveCollectionDropTarget,
    sortCollectionsWithinParent,
} from '../app/utils/collectionSectionDragEngine';

describe('collectionSectionDragEngine', () => {
    const folders = [
        { uid: 'folder-a', name: 'Folder A' },
        { uid: 'folder-b', name: 'Folder B' },
    ];

    const collections = [
        { uid: 'root-a', name: 'Root A', parentId: null, order: 0, lastUpdated: 10 },
        { uid: 'root-b', name: 'Root B', parentId: null, order: 1, lastUpdated: 20 },
        { uid: 'folder-a-1', name: 'Folder A 1', parentId: 'folder-a', order: 0, lastUpdated: 30 },
        { uid: 'folder-a-2', name: 'Folder A 2', parentId: 'folder-a', order: 1, lastUpdated: 40 },
        { uid: 'folder-a-3', name: 'Folder A 3', parentId: 'folder-a', order: 2, lastUpdated: 45 },
        { uid: 'folder-b-1', name: 'Folder B 1', parentId: 'folder-b', order: 0, lastUpdated: 50 },
    ];

    test('normalizes unknown parents to root', () => {
        const folderUidSet = new Set(folders.map((folder) => folder.uid));

        expect(normalizeCollectionParentId({ parentId: 'folder-a' }, folderUidSet)).toBe('folder-a');
        expect(normalizeCollectionParentId({ parentId: 'missing-folder' }, folderUidSet)).toBeNull();
    });

    test('sorts siblings by explicit order within a parent', () => {
        const folderUidSet = new Set(folders.map((folder) => folder.uid));
        const siblings = sortCollectionsWithinParent({
            collections,
            folderUidSet,
            parentId: 'folder-a',
        });

        expect(siblings.map((collection) => collection.uid)).toEqual(['folder-a-1', 'folder-a-2', 'folder-a-3']);
    });

    test('resolves a same-parent collection reorder operation', () => {
        const operation = resolveCollectionDropOperation({
            collections,
            folders,
            activeId: 'folder-a-1',
            target: {
                kind: collectionDropKinds.collection,
                parentId: 'folder-a',
                collectionId: 'folder-a-2',
                side: collectionDropSides.after,
            },
        });

        expect(operation).toEqual(expect.objectContaining({
            kind: 'reorder',
            sourceParentId: 'folder-a',
            targetParentId: 'folder-a',
            insertIndex: 1,
        }));
    });

    test('resolves same-parent grid reorder using hovered tile index', () => {
        const operation = resolveCollectionDropOperation({
            collections,
            folders,
            activeId: 'folder-a-1',
            target: {
                kind: collectionDropKinds.collection,
                parentId: 'folder-a',
                collectionId: 'folder-a-3',
                side: collectionDropSides.before,
            },
            viewMode: 'grid',
        });

        expect(operation).toEqual(expect.objectContaining({
            kind: 'reorder',
            sourceParentId: 'folder-a',
            targetParentId: 'folder-a',
            insertIndex: 2,
        }));
    });

    test('resolves a cross-parent move to section start', () => {
        const operation = resolveCollectionDropOperation({
            collections,
            folders,
            activeId: 'root-b',
            target: {
                kind: collectionDropKinds.sectionStart,
                parentId: 'folder-b',
            },
        });

        expect(operation).toEqual(expect.objectContaining({
            kind: 'move',
            sourceParentId: null,
            targetParentId: 'folder-b',
            insertIndex: 0,
        }));
    });

    test('applies a cross-parent move and reindexes both parents', () => {
        const operation = resolveCollectionDropOperation({
            collections,
            folders,
            activeId: 'folder-a-2',
            target: {
                kind: collectionDropKinds.collection,
                parentId: null,
                collectionId: 'root-a',
                side: collectionDropSides.before,
            },
        });
        const nextCollections = applyCollectionDropOperation({
            collections,
            folders,
            operation,
        });

        expect(nextCollections.find((collection) => collection.uid === 'folder-a-2')).toEqual(
            expect.objectContaining({ parentId: null, order: 0 }),
        );
        expect(nextCollections.find((collection) => collection.uid === 'root-a')).toEqual(
            expect.objectContaining({ parentId: null, order: 1 }),
        );
        expect(nextCollections.find((collection) => collection.uid === 'folder-a-1')).toEqual(
            expect.objectContaining({ parentId: 'folder-a', order: 0 }),
        );
        expect(getAffectedCollectionParentIds(operation)).toEqual([ 'folder-a', null ]);
    });

    test('returns null for a no-op section-end drop on the same parent', () => {
        const operation = resolveCollectionDropOperation({
            collections,
            folders,
            activeId: 'root-b',
            target: {
                kind: collectionDropKinds.sectionEnd,
                parentId: null,
            },
        });

        expect(operation).toBeNull();
    });

    test('derives collection side from pointer position', () => {
        const rect = { left: 100, top: 200, width: 160, height: 80 };

        expect(getCollectionTargetSide({
            viewMode: 'list',
            point: { x: 150, y: 220 },
            rect,
        })).toBe(collectionDropSides.before);

        expect(getCollectionTargetSide({
            viewMode: 'grid',
            point: { x: 230, y: 255 },
            rect,
        })).toBe(collectionDropSides.after);
    });

    test('resolves droppable metadata into normalized targets', () => {
        const folderUidSet = new Set(folders.map((folder) => folder.uid));

        const collectionTarget = resolveCollectionDropTarget({
            over: {
                id: 'folder-a-1',
                data: { current: { dragType: 'collection-card', collectionId: 'folder-a-1', parentId: 'folder-a' } },
            },
            collections,
            folderUidSet,
        });

        expect(collectionTarget).toEqual({
            kind: collectionDropKinds.collection,
            collectionId: 'folder-a-1',
            parentId: 'folder-a',
        });

        const sectionTarget = resolveCollectionDropTarget({
            over: {
                id: 'section-start-folder-b',
                data: { current: { dragType: collectionDropKinds.sectionStart, parentId: 'folder-b' } },
            },
            collections,
            folderUidSet,
        });

        expect(sectionTarget).toEqual({
            kind: collectionDropKinds.sectionStart,
            parentId: 'folder-b',
        });
    });
});
