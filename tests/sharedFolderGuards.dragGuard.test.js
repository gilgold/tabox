/**
 * Fix-round test for gap 2 in task-13-report.md ("Known scope gaps" #2):
 * dragging a collection OUT of a read-only shared folder to root (the 4th,
 * previously-unguarded branch of CollectionList's handleDragEnd) removes it
 * from the shared folder's contents — that IS an edit of the folder and must
 * be blocked for read-only members.
 *
 * Structured like tests/CollectionList.reorder.test.js (see that file for
 * the mocking pattern this borrows).
 */

/** @jest-environment jsdom */
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CollectionList from '../app/CollectionList';
import { noPermissionOpenState } from '../app/atoms/sharedFoldersState';

let latestDragEndHandler = null;
const mockClosestCorners = jest.fn(() => []);
const mockPointerWithin = jest.fn(() => []);

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, onDragEnd }) => {
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

const { removeCollectionFromFolder } = require('../app/utils/folderOperations');

const READ_ONLY_FOLDER = { uid: 'folder-1', name: 'Research', shared: { folderId: 'folder-1', role: 'read' } };
const WRITABLE_FOLDER = { uid: 'folder-1', name: 'Research', shared: { folderId: 'folder-1', role: 'write' } };

describe('CollectionList blocks dragging a collection out of a read-only shared folder to root', () => {
    beforeEach(() => {
        latestDragEndHandler = null;
        mockClosestCorners.mockReset();
        mockClosestCorners.mockReturnValue([]);
        mockPointerWithin.mockReset();
        mockPointerWithin.mockReturnValue([]);
        jest.clearAllMocks();
    });

    test('blocks the drop, opens the no-permission modal, and never touches storage when the source folder is read-only shared', async () => {
        const updateRemoteData = jest.fn(async () => true);
        const onDataUpdate = jest.fn();
        const store = createStore();

        render(
            <Provider store={store}>
                <CollectionList
                    collections={[
                        { uid: 'collection-1', name: 'Shared Child', parentId: 'folder-1', order: 0, lastUpdated: 10 },
                        { uid: 'root-collection', name: 'Root Target', parentId: null, order: 0, lastUpdated: 5 },
                    ]}
                    folders={[READ_ONLY_FOLDER]}
                    viewMode="list"
                    updateRemoteData={updateRemoteData}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    onDataUpdate={onDataUpdate}
                />
            </Provider>,
        );

        expect(latestDragEndHandler).toEqual(expect.any(Function));

        await act(async () => {
            await latestDragEndHandler({
                active: { id: 'collection-1' },
                over: { id: 'root-collection' },
            });
        });

        expect(removeCollectionFromFolder).not.toHaveBeenCalled();
        expect(updateRemoteData).not.toHaveBeenCalled();
        expect(onDataUpdate).not.toHaveBeenCalled();
        expect(store.get(noPermissionOpenState)).toBe(true);
    });

    test('allows the drop when the source folder is writable', async () => {
        removeCollectionFromFolder.mockResolvedValue(true);
        const updateRemoteData = jest.fn(async () => true);
        const store = createStore();

        render(
            <Provider store={store}>
                <CollectionList
                    collections={[
                        { uid: 'collection-1', name: 'Writable Child', parentId: 'folder-1', order: 0, lastUpdated: 10 },
                        { uid: 'root-collection', name: 'Root Target', parentId: null, order: 0, lastUpdated: 5 },
                    ]}
                    folders={[WRITABLE_FOLDER]}
                    viewMode="list"
                    updateRemoteData={updateRemoteData}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        await act(async () => {
            await latestDragEndHandler({
                active: { id: 'collection-1' },
                over: { id: 'root-collection' },
            });
        });

        expect(removeCollectionFromFolder).toHaveBeenCalledWith('collection-1');
        expect(store.get(noPermissionOpenState)).toBe(false);
    });
});
