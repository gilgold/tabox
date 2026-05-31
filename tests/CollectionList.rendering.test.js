/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionList from '../app/CollectionList';
import { searchState, themeState } from '../app/atoms/globalAppSettingsState';
import { sidebarNavigationState } from '../app/atoms/fullpageState';
import { renderWithProviders } from './helpers/renderWithProviders';

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }) => <div data-testid="collection-dnd-context">{children}</div>,
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

jest.mock('../app/CollapsableSection', () => function MockCollapsableSection({ children, sectionTitle, count }) {
    return (
        <section>
            <h2>{`${sectionTitle} (${count})`}</h2>
            {children}
        </section>
    );
});

jest.mock('../app/SortableCollectionItem', () => function MockSortableCollectionItem({ collection, onSelect }) {
    return (
        <button type="button" onClick={() => onSelect?.(collection)}>
            {collection.name}
        </button>
    );
});

jest.mock('../app/SortableCollectionTile', () => function MockSortableCollectionTile({ collection, onSelect, folderName }) {
    return (
        <button type="button" onClick={() => onSelect?.(collection)}>
            {folderName ? `${collection.name} in ${folderName}` : collection.name}
        </button>
    );
});

jest.mock('../app/CollectionTile', () => function MockCollectionTile({ collection }) {
    return <div>{collection?.name}</div>;
});

jest.mock('../app/SortableFolderContainer', () => function MockSortableFolderContainer({ folder, children }) {
    return (
        <div>
            <strong>{folder.name}</strong>
            {children}
        </div>
    );
});

jest.mock('../app/FolderContainer', () => function MockFolderContainer({ folder }) {
    return <div>{folder.name}</div>;
});

jest.mock('../app/CollectionDetailPanel', () => function MockCollectionDetailPanel({ collection, renderInline }) {
    return <div>{`detail:${collection.name}:${renderInline ? 'inline' : 'overlay'}`}</div>;
});

jest.mock('../app/useCollectionItemCrossDrag', () => jest.fn());

jest.mock('../app/utils/folderOperations', () => ({
    moveCollectionToFolder: jest.fn(),
    removeCollectionFromFolder: jest.fn(),
}));

jest.mock('../app/utils/sharedCollectionSync', () => ({
    persistCollectionLayoutChanges: jest.fn(async () => true),
}));

describe('CollectionList rendering', () => {
    const collections = [
        {
            uid: 'collection-root',
            name: 'Root Guide',
            parentId: null,
            lastUpdated: 10,
            lastOpened: Date.now(),
            tabs: [{ title: 'Guide Tab', url: 'https://example.com/root' }],
        },
        {
            uid: 'collection-folder',
            name: 'Folder Guide',
            parentId: 'folder-1',
            lastUpdated: 20,
            lastOpened: Date.now() - (5 * 60 * 60 * 1000),
            tabs: [{ title: 'Guide Match', url: 'https://example.com/folder' }],
        },
        {
            uid: 'collection-orphan',
            name: 'Orphan Item',
            parentId: 'missing-folder',
            lastUpdated: 30,
            tabs: [{ title: 'Other Tab', url: 'https://example.com/orphan' }],
        },
    ];

    const folders = [
        { uid: 'folder-1', name: 'Research Folder' },
        { uid: 'folder-2', name: 'Empty Folder' },
    ];

    const renderCollectionList = (overrideProps = {}, atomValues = []) => renderWithProviders(
        <CollectionList
            collections={collections}
            folders={folders}
            viewMode="list"
            updateRemoteData={jest.fn()}
            updateCollection={jest.fn()}
            removeCollection={jest.fn()}
            addCollection={jest.fn()}
            onDataUpdate={jest.fn()}
            folderNameMap={{ 'folder-1': 'Research Folder' }}
            {...overrideProps}
        />,
        {
            withSuspense: false,
            atomValues,
        },
    );

    test('shows the empty state when there are no collections and no search', () => {
        renderWithProviders(
            <CollectionList
                collections={[]}
                folders={[]}
                viewMode="list"
                updateRemoteData={jest.fn()}
                updateCollection={jest.fn()}
                removeCollection={jest.fn()}
                addCollection={jest.fn()}
                onDataUpdate={jest.fn()}
            />,
            {
                withSuspense: false,
                atomValues: [[themeState, 'light'], [searchState, null]],
            },
        );

        expect(screen.getByText(/You don't have any collections/i)).toBeInTheDocument();
    });

    test('flattens matching collections into a search results section', () => {
        renderCollectionList(
            {
                viewMode: 'grid',
                isFullPage: true,
                collections: collections.filter((collection) => (
                    collection.uid === 'collection-root' || collection.uid === 'collection-folder'
                )),
            },
            [[searchState, 'Guide'], [sidebarNavigationState, 'all']],
        );

        expect(screen.getByText('Search Results (2)')).toBeInTheDocument();
        expect(screen.getByText('Root Guide')).toBeInTheDocument();
        expect(screen.getByText('Folder Guide in Research Folder')).toBeInTheDocument();
        expect(screen.queryByText('Folders (1)')).not.toBeInTheDocument();
    });

    test('shows folders and root collections separately while hiding empty folders during filtered views', () => {
        renderCollectionList(
            {
                hasActiveFilters: true,
            },
            [[searchState, null]],
        );

        expect(screen.getByText('Folders (1)')).toBeInTheDocument();
        expect(screen.getByText('Collections (2)')).toBeInTheDocument();
        expect(screen.getByText('Research Folder')).toBeInTheDocument();
        expect(screen.queryByText('Empty Folder')).not.toBeInTheDocument();
        expect(screen.getByText('Root Guide')).toBeInTheDocument();
        expect(screen.getByText('Orphan Item')).toBeInTheDocument();
    });

    test('filters the full-page list to recently opened collections', () => {
        renderCollectionList(
            {
                isFullPage: true,
            },
            [[sidebarNavigationState, 'recent']],
        );

        expect(screen.getByText('Collections (1)')).toBeInTheDocument();
        expect(screen.getByText('Root Guide')).toBeInTheDocument();
        expect(screen.queryByText('Folder Guide')).not.toBeInTheDocument();
    });

    test('opens the collection detail panel inline in full-page mode', () => {
        renderCollectionList({
            isFullPage: true,
        });

        fireEvent.click(screen.getByText('Root Guide'));

        expect(screen.getByText('detail:Root Guide:inline')).toBeInTheDocument();
    });
});
