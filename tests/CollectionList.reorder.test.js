import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import CollectionList from '../app/CollectionList';
import { persistCollectionLayoutChanges } from '../app/utils/sharedCollectionSync';

let latestDragEndHandler = null;

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, onDragEnd }) => {
        latestDragEndHandler = onDragEnd;
        return <div data-testid="collection-dnd-context">{children}</div>;
    },
    PointerSensor: function PointerSensor() {},
    DragOverlay: ({ children }) => <>{children}</>,
    MeasuringStrategy: { Always: 'Always' },
    closestCenter: jest.fn(),
    closestCorners: jest.fn(() => []),
    pointerWithin: jest.fn(() => []),
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
});
