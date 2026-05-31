import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPContentArea from '../app/fullpage/FPContentArea';
import { sidebarNavigationState } from '../app/atoms/fullpageState';
import { searchState } from '../app/atoms/globalAppSettingsState';
import { persistCollectionLayoutChanges } from '../app/utils/sharedCollectionSync';

let latestDragStartHandler = null;
let latestDragOverHandler = null;
let latestDragEndHandler = null;
const mockUseSortable = jest.fn();

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, onDragStart, onDragOver, onDragEnd }) => {
        latestDragStartHandler = onDragStart;
        latestDragOverHandler = onDragOver;
        latestDragEndHandler = onDragEnd;
        return <div data-testid="fp-dnd-context">{children}</div>;
    },
    PointerSensor: function PointerSensor() {},
    DragOverlay: ({ children }) => <>{children}</>,
    MeasuringStrategy: { Always: 'Always' },
    closestCorners: jest.fn(() => []),
    pointerWithin: jest.fn(() => []),
    useSensor: jest.fn(() => ({})),
    useSensors: jest.fn((...sensors) => sensors),
    useDroppable: jest.fn(() => ({
        isOver: false,
        setNodeRef: jest.fn(),
    })),
}));

jest.mock('@dnd-kit/sortable', () => ({
    arrayMove: (items, fromIndex, toIndex) => {
        const nextItems = [...items];
        const [movedItem] = nextItems.splice(fromIndex, 1);
        nextItems.splice(toIndex, 0, movedItem);
        return nextItems;
    },
    SortableContext: ({ children }) => <>{children}</>,
    rectSortingStrategy: jest.fn(),
    verticalListSortingStrategy: jest.fn(),
    useSortable: (...args) => mockUseSortable(...args),
}));

mockUseSortable.mockImplementation(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Transform: {
            toString: jest.fn(() => ''),
        },
    },
}));

jest.mock('../app/fullpage/FPCollectionCard', () => function MockFPCollectionCard({ collection }) {
    return <div>{collection.name}</div>;
});

jest.mock('../app/fullpage/FPCurrentWindowCard', () => function MockFPCurrentWindowCard() {
    return null;
});

jest.mock('../app/fullpage/FPSessionCard', () => function MockFPSessionCard() {
    return null;
});

jest.mock('../app/fullpage/FPSingleTabSessionRow', () => function MockFPSingleTabSessionRow() {
    return null;
});

jest.mock('../app/fullpage/FPEmptyState', () => function MockFPEmptyState() {
    return null;
});

jest.mock('../app/ColorPicker', () => function MockColorPicker() {
    return null;
});

jest.mock('../app/fullpage/SaveCollectionModal', () => function MockSaveCollectionModal() {
    return null;
});

jest.mock('../app/fullpage/BulkMoveCollectionsModal', () => function MockBulkMoveCollectionsModal() {
    return null;
});

jest.mock('../app/fullpage/BulkDeleteCollectionsModal', () => function MockBulkDeleteCollectionsModal() {
    return null;
});

jest.mock('../app/fullpage/LegacyImportPreviewModal', () => function MockLegacyImportPreviewModal() {
    return null;
});

jest.mock('../app/CreateFolderModal', () => function MockCreateFolderModal() {
    return null;
});

jest.mock('../app/FolderDeleteConfirmModal', () => function MockFolderDeleteConfirmModal() {
    return null;
});

jest.mock('../app/useCollectionItemCrossDrag', () => jest.fn());

jest.mock('../app/utils/storageUtils', () => ({
    updateFolderCollectionCount: jest.fn(async () => true),
    loadAllCollections: jest.fn(async () => []),
    batchDeleteCollections: jest.fn(async () => true),
}));

jest.mock('../app/utils/folderOperations', () => ({
    duplicateFolder: jest.fn(async () => ({ success: true, duplicatedCollections: 0 })),
    deleteFolder: jest.fn(async () => ({ success: true, collectionsDeleted: 0, collectionsMovedToRoot: 0 })),
    updateFolderDetails: jest.fn(async () => true),
}));

jest.mock('../app/utils/sharedCollectionSync', () => ({
    persistCollectionLayoutChanges: jest.fn(async () => true),
}));

const baseProps = {
    collections: [],
    currentWindows: [],
    sessionList: [],
    folders: [],
    updateCollection: jest.fn(),
    removeCollection: jest.fn(),
    addCollection: jest.fn(),
    addFolder: jest.fn(),
    updateRemoteData: jest.fn(),
    onDataUpdate: jest.fn(),
    hasActiveFilters: false,
    filters: { recentlyOpenedActual: false, color: null },
    trackedCollectionUids: new Set(),
    onViewModeChange: jest.fn(),
    onFiltersChange: jest.fn(),
    onFolderStateChange: jest.fn(),
    onSelectCurrentWindow: jest.fn(),
    onFocusCurrentWindow: jest.fn(),
    onSaveCurrentWindow: jest.fn(),
    onCloseCurrentWindow: jest.fn(),
    onSelectSession: jest.fn(),
};

const renderWithNavigation = (ui, navigation, search = '') => {
    const store = createStore();
    store.set(sidebarNavigationState, navigation);
    store.set(searchState, search);

    return render(<Provider store={store}>{ui}</Provider>);
};

const buildDragEvent = ({ activeId, overId, parentId, clientX = 20, clientY = 20, deltaX = 80, deltaY = 40 }) => ({
    active: {
        id: activeId,
        rect: {
            current: {
                initial: { width: 180, height: 100 },
            },
        },
    },
    over: overId ? {
        id: overId,
        data: {
            current: {
                dragType: 'collection-card',
                collectionId: overId,
                parentId,
            },
        },
    } : null,
    activatorEvent: {
        clientX,
        clientY,
    },
    delta: {
        x: deltaX,
        y: deltaY,
    },
});

describe('FPContentArea same-parent reorder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        latestDragStartHandler = null;
        latestDragOverHandler = null;
        latestDragEndHandler = null;
        mockUseSortable.mockClear();
mockUseSortable.mockImplementation(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
}));
        window.matchMedia = jest.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        }));
        window.requestAnimationFrame = jest.fn((callback) => setTimeout(() => callback(Date.now()), 0));
        window.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));
        window.CSS = { escape: (value) => value };
        HTMLElement.prototype.scrollIntoView = jest.fn();
        browser.storage.local.get.mockImplementation(async (keys) => {
            const values = {
                currentSortValue: 'DATE',
                currentSortAscending: true,
                fpViewMode: 'grid',
                chkOpenNewWindow: false,
                sessions: [],
            };

            if (Array.isArray(keys)) {
                return keys.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {});
            }

            if (typeof keys === 'string') {
                return { [keys]: values[keys] };
            }

            return values;
        });
    });

    test.each([
        {
            label: 'specific folder',
            navigation: 'folder-a',
            folders: [{ uid: 'folder-a', name: 'Folder A', color: 'blue', collapsed: false }],
            collections: [
                { uid: 'collection-2', name: 'Collection Two', parentId: 'folder-a', order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
                { uid: 'collection-1', name: 'Collection One', parentId: 'folder-a', order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
            ],
        },
        {
            label: 'root view',
            navigation: 'unorganized',
            folders: [{ uid: 'folder-a', name: 'Folder A', color: 'blue', collapsed: false }],
            collections: [
                { uid: 'collection-2', name: 'Collection Two', parentId: null, order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
                { uid: 'collection-1', name: 'Collection One', parentId: null, order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
            ],
        },
    ])('renders collections by sibling order in full-page $label', ({
        navigation,
        folders,
        collections,
    }) => {
        renderWithNavigation(
            <FPContentArea
                {...baseProps}
                folders={folders}
                collections={collections}
            />,
            navigation,
        );

        const first = screen.getByText('Collection One');
        const second = screen.getByText('Collection Two');

        expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('disables sortable collection dragging while search results are shown', () => {
        renderWithNavigation(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'collection-1', name: 'Collection One', parentId: null, order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
                    { uid: 'collection-2', name: 'Collection Two', parentId: null, order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
                ]}
            />,
            'all',
            'Collection',
        );

        expect(mockUseSortable).toHaveBeenCalledWith(expect.objectContaining({
            id: 'collection-1',
            disabled: true,
        }));
        expect(mockUseSortable).toHaveBeenCalledWith(expect.objectContaining({
            id: 'collection-2',
            disabled: true,
        }));
    });

    test.each([
        {
            label: 'within the same folder',
            navigation: 'folder-a',
            folders: [{ uid: 'folder-a', name: 'Folder A', color: 'blue', collapsed: false }],
            collections: [
                { uid: 'collection-1', name: 'Collection One', parentId: 'folder-a', order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
                { uid: 'collection-2', name: 'Collection Two', parentId: 'folder-a', order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
            ],
            targetParentId: 'folder-a',
        },
        {
            label: 'within root',
            navigation: 'unorganized',
            folders: [{ uid: 'folder-a', name: 'Folder A', color: 'blue', collapsed: false }],
            collections: [
                { uid: 'collection-1', name: 'Collection One', parentId: null, order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
                { uid: 'collection-2', name: 'Collection Two', parentId: null, order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
            ],
            targetParentId: null,
        },
    ])('keeps the last valid hover target when drag end briefly reports the dragged card $label', async ({
        navigation,
        folders,
        collections,
        targetParentId,
    }) => {
        renderWithNavigation(
            <FPContentArea
                {...baseProps}
                folders={folders}
                collections={collections}
            />,
            navigation,
        );

        expect(latestDragStartHandler).toEqual(expect.any(Function));
        expect(latestDragOverHandler).toEqual(expect.any(Function));
        expect(latestDragEndHandler).toEqual(expect.any(Function));

        await act(async () => {
            latestDragStartHandler(buildDragEvent({ activeId: 'collection-1' }));
        });

        await act(async () => {
            latestDragOverHandler(buildDragEvent({
                activeId: 'collection-1',
                overId: 'collection-2',
                parentId: targetParentId,
            }));
        });

        await act(async () => {
            latestDragOverHandler(buildDragEvent({
                activeId: 'collection-1',
                overId: 'collection-1',
                parentId: targetParentId,
            }));
        });

        await act(async () => {
            await latestDragEndHandler(buildDragEvent({
                activeId: 'collection-1',
                overId: 'collection-1',
                parentId: targetParentId,
            }));
        });

        expect(persistCollectionLayoutChanges).toHaveBeenCalledWith(expect.objectContaining({
            nextCollections: expect.arrayContaining([
                expect.objectContaining({ uid: 'collection-2', order: 0 }),
                expect.objectContaining({ uid: 'collection-1', order: 1 }),
            ]),
            affectedParentIds: [targetParentId],
        }));
    });

    test.each([
        {
            label: 'within the same folder',
            navigation: 'folder-a',
            folders: [{ uid: 'folder-a', name: 'Folder A', color: 'blue', collapsed: false }],
            collections: [
                { uid: 'collection-1', name: 'Collection One', parentId: 'folder-a', order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
                { uid: 'collection-2', name: 'Collection Two', parentId: 'folder-a', order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
            ],
            targetParentId: 'folder-a',
        },
        {
            label: 'within root',
            navigation: 'unorganized',
            folders: [{ uid: 'folder-a', name: 'Folder A', color: 'blue', collapsed: false }],
            collections: [
                { uid: 'collection-1', name: 'Collection One', parentId: null, order: 0, lastUpdated: 10, tabs: [], chromeGroups: [] },
                { uid: 'collection-2', name: 'Collection Two', parentId: null, order: 1, lastUpdated: 20, tabs: [], chromeGroups: [] },
            ],
            targetParentId: null,
        },
    ])('keeps the last valid hover target when the full-page drag hover briefly becomes empty $label', async ({
        navigation,
        folders,
        collections,
        targetParentId,
    }) => {
        renderWithNavigation(
            <FPContentArea
                {...baseProps}
                folders={folders}
                collections={collections}
            />,
            navigation,
        );

        await act(async () => {
            latestDragStartHandler(buildDragEvent({ activeId: 'collection-1' }));
        });

        await act(async () => {
            latestDragOverHandler(buildDragEvent({
                activeId: 'collection-1',
                overId: 'collection-2',
                parentId: targetParentId,
            }));
        });

        await act(async () => {
            latestDragOverHandler(buildDragEvent({
                activeId: 'collection-1',
                overId: null,
                parentId: targetParentId,
            }));
        });

        await act(async () => {
            await latestDragEndHandler(buildDragEvent({
                activeId: 'collection-1',
                overId: null,
                parentId: targetParentId,
            }));
        });

        expect(persistCollectionLayoutChanges).toHaveBeenCalledWith(expect.objectContaining({
            nextCollections: expect.arrayContaining([
                expect.objectContaining({ uid: 'collection-2', order: 0 }),
                expect.objectContaining({ uid: 'collection-1', order: 1 }),
            ]),
            affectedParentIds: [targetParentId],
        }));
    });
});
