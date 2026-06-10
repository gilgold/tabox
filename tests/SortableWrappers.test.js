/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SortableCollectionItem from '../app/SortableCollectionItem';
import SortableCollectionTile from '../app/SortableCollectionTile';
import SortableFolderContainer from '../app/SortableFolderContainer';

const mockUseSortable = jest.fn();

jest.mock('@dnd-kit/sortable', () => ({
    useSortable: (...args) => mockUseSortable(...args),
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Transform: {
            toString: jest.fn(() => 'translate3d(10px, 20px, 0)'),
        },
    },
}));

jest.mock('../app/CollectionListItem', () => function MockCollectionListItem(props) {
    return <div data-testid="collection-item">{JSON.stringify(props.dragHandleProps)}</div>;
});

jest.mock('../app/CollectionTile', () => function MockCollectionTile(props) {
    return <div data-testid="collection-tile">{JSON.stringify({ activeId: props.activeId, dragAttributes: props.dragAttributes, dragListeners: props.dragListeners })}</div>;
});

jest.mock('../app/FolderContainer', () => function MockFolderContainer(props) {
    return <div data-testid="folder-container">{JSON.stringify({ isDragging: props.isDragging, viewMode: props.viewMode, dragAttributes: props.dragAttributes, dragListeners: props.dragListeners })}</div>;
});

describe('sortable wrappers', () => {
    beforeEach(() => {
        mockUseSortable.mockReset();
        mockUseSortable.mockReturnValue({
            attributes: { 'data-attr': 'value' },
            listeners: { onPointerDown: jest.fn() },
            setNodeRef: jest.fn(),
            transform: { x: 10, y: 20 },
            transition: 'transform 200ms ease',
            isDragging: true,
        });
    });

    test('wraps CollectionListItem with sortable drag props and dragging styles', () => {
        const { container } = render(
            <SortableCollectionItem
                id="collection-1"
                collection={{ uid: 'collection-1', name: 'Docs' }}
            />,
        );

        expect(mockUseSortable).toHaveBeenCalledWith(expect.objectContaining({
            id: 'collection-1',
            data: expect.objectContaining({
                itemType: 'collection',
                parentId: null,
            }),
        }));
        expect(screen.getByTestId('collection-item')).toHaveTextContent('data-attr');
        expect(container.firstChild).toHaveStyle('opacity: 0.35');
    });

    test('wraps CollectionTile with sortable drag props', () => {
        render(
            <SortableCollectionTile
                id="collection-1"
                collection={{ uid: 'collection-1', name: 'Docs' }}
                activeId="collection-1"
            />,
        );

        expect(screen.getByTestId('collection-tile')).toHaveTextContent('collection-1');
        expect(screen.getByTestId('collection-tile')).toHaveTextContent('data-attr');
    });

    test('wraps FolderContainer with sortable drag props and dragging state', () => {
        const { container } = render(
            <SortableFolderContainer
                id="folder-1"
                folder={{ uid: 'folder-1', name: 'Research' }}
                viewMode="grid"
            />,
        );

        expect(screen.getByTestId('folder-container')).toHaveTextContent('"isDragging":true');
        expect(screen.getByTestId('folder-container')).toHaveTextContent('"viewMode":"grid"');
        expect(container.firstChild).toHaveClass('sortable-folder-wrapper');
    });
});
