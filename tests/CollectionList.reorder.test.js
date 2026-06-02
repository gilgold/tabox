import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import CollectionList from '../app/CollectionList';
import { persistCollectionLayoutChanges } from '../app/utils/sharedCollectionSync';

let latestDragEndHandler = null;
let latestCollisionDetectionHandler = null;
const mockClosestCorners = jest.fn(() => []);
const mockPointerWithin = jest.fn(() => []);

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, collisionDetection, onDragEnd }) => {
        latestCollisionDetectionHandler = collisionDetection;
        latestDragEndHandler = onDragEnd;
        return <div data-testid="collection-dnd-context">{children}</div>;
    },
    PointerSensor: function PointerSensor() {},
    DragOverlay: ({ children }) => <>{children}</>,
    MeasuringStrategy: { Always: 'Always' },
    closestCenter: jest.fn(),
    closestCorners: (...args) => mockClosestCorners(...args),
    pointerWithin: (...args) => mockPointerWithin(...args),
    rectIntersection: jest.fn(() => []),
    useSensor: jest.fn(() => ({})),
    useSensors: jest.fn((...sensors) => sensors),
}));

jest.mock('@dnd-kit/sortable', () => ({
    arrayMove: (items, fromIndex, toIndex) => {
        const nextItems = [...items];
        const [movedItem] = nextItems.splice(fromIndex, 1);
        nextItems.splice(toIndex, 0, movedItem);
        return nextItems;
    },
    SortableContext: ({ children }) => <>{children}</>,
    verticalListSortingStrategy: jest.fn(),
    rectSortingStrategy: jest.fn(),
}));

jest.mock('../app/CollapsableSection', () => function MockCollapsableSection({ children, sectionTitle }) {
    return (
        <section>
            <h2>{sectionTitle}</h2>
            {children}
        </section>
    );
});

jest.mock('../app/SortableCollectionItem', () => function MockSortableCollectionItem({ collection }) {
    return <div>{collection.name}</div>;
});

jest.mock('../app/SortableCollectionTile', () => function MockSortableCollectionTile({ collection }) {
    return <div>{collection.name}</div>;
});

jest.mock('../app/CollectionTile', () => function MockCollectionTile({ collection }) {
    return <div>{collection?.name}</div>;
});

jest.mock('../app/SortableFolderContainer', () => function MockSortableFolderContainer({ children }) {
    return <div>{children}</div>;
});

jest.mock('../app/FolderContainer', () => function MockFolderContainer() {
    return null;
});

jest.mock('../app/CollectionDetailPanel', () => function MockCollectionDetailPanel() {
    return null;
});

jest.mock('../app/useCollectionItemCrossDrag', () => jest.fn());

jest.mock('../app/utils/folderOperations', () => ({
    moveCollectionToFolder: jest.fn(),
    removeCollectionFromFolder: jest.fn(),
}));

jest.mock('../app/utils/sharedCollectionSync', () => ({
    persistCollectionLayoutChanges: jest.fn(async () => true),
}));

describe('CollectionList popup reorder', () => {
    beforeEach(() => {
        latestDragEndHandler = null;
        latestCollisionDetectionHandler = null;
        mockClosestCorners.mockReset();
        mockClosestCorners.mockReturnValue([]);
        mockPointerWithin.mockReset();
        mockPointerWithin.mockReturnValue([]);
        jest.clearAllMocks();
    });

    test('routes popup collection drag reorder through the shared layout persistence flow', async () => {
        const updateRemoteData = jest.fn(async () => true);

        render(
            <Provider>
                <CollectionList
                    collections={[
                        { uid: 'collection-1', name: 'Collection One', parentId: null, order: 0, lastUpdated: 10 },
                        { uid: 'collection-2', name: 'Collection Two', parentId: null, order: 1, lastUpdated: 20 },
                    ]}
                    folders={[]}
                    viewMode="list"
                    updateRemoteData={updateRemoteData}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        expect(screen.getByText('Collection One')).toBeInTheDocument();
        expect(latestDragEndHandler).toEqual(expect.any(Function));

        await act(async () => {
            await latestDragEndHandler({
                active: { id: 'collection-1' },
                over: { id: 'collection-2' },
            });
        });

        expect(persistCollectionLayoutChanges).toHaveBeenCalledWith(expect.objectContaining({
            nextCollections: [
                expect.objectContaining({ uid: 'collection-2' }),
                expect.objectContaining({ uid: 'collection-1' }),
            ],
            affectedParentIds: [null],
            updateRemoteData,
        }));
    });

    test('targets folder sibling collections when dragging through gaps inside an expanded folder', () => {
        render(
            <Provider>
                <CollectionList
                    collections={[
                        { uid: 'collection-1', name: 'Collection One', parentId: 'folder-1', order: 0, lastUpdated: 10 },
                        { uid: 'collection-2', name: 'Collection Two', parentId: 'folder-1', order: 1, lastUpdated: 20 },
                    ]}
                    folders={[{ uid: 'folder-1', name: 'Research', collapsed: false }]}
                    viewMode="list"
                    updateRemoteData={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        mockPointerWithin.mockReturnValue([
            { id: 'folder-content-folder-1', data: { current: { type: 'folder' } } },
        ]);
        mockClosestCorners.mockReturnValue([
            { id: 'folder-content-folder-1', data: { current: { type: 'folder' } } },
            { id: 'collection-2' },
        ]);

        expect(latestCollisionDetectionHandler).toEqual(expect.any(Function));

        const collisions = latestCollisionDetectionHandler({
            active: {
                id: 'collection-1',
                data: { current: { itemType: 'collection' } },
            },
        });

        expect(collisions).toEqual([
            expect.objectContaining({ id: 'collection-2' }),
        ]);
    });

    test('persists popup in-folder collection reorders with reindexed sibling order', async () => {
        const updateRemoteData = jest.fn(async () => true);

        render(
            <Provider>
                <CollectionList
                    collections={[
                        { uid: 'root-collection', name: 'Root Collection', parentId: null, order: 0, lastUpdated: 5 },
                        { uid: 'collection-1', name: 'Collection One', parentId: 'folder-1', order: 0, lastUpdated: 10 },
                        { uid: 'collection-2', name: 'Collection Two', parentId: 'folder-1', order: 1, lastUpdated: 20 },
                    ]}
                    folders={[{ uid: 'folder-1', name: 'Research', collapsed: false }]}
                    viewMode="list"
                    updateRemoteData={updateRemoteData}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        expect(latestDragEndHandler).toEqual(expect.any(Function));

        await act(async () => {
            await latestDragEndHandler({
                active: { id: 'collection-1' },
                over: { id: 'collection-2' },
            });
        });

        expect(persistCollectionLayoutChanges).toHaveBeenCalledWith(expect.objectContaining({
            nextCollections: [
                expect.objectContaining({ uid: 'root-collection', parentId: null, order: 0 }),
                expect.objectContaining({ uid: 'collection-2', parentId: 'folder-1', order: 0 }),
                expect.objectContaining({ uid: 'collection-1', parentId: 'folder-1', order: 1 }),
            ],
            affectedParentIds: ['folder-1'],
            updateRemoteData,
        }));
    });
});
