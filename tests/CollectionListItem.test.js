/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionListItem from '../app/CollectionListItem';
import { dragSessionState } from '../app/atoms/animationsState';
import { renderWithProviders } from './helpers/renderWithProviders';

let mockCollectionHandlers;
const mockUseCollectionOperations = jest.fn(() => mockCollectionHandlers);
const mockStorageGet = jest.fn();
const mockTabsCreate = jest.fn();

jest.mock('../app/useCollectionOperations', () => ({
    useCollectionOperations: (...args) => mockUseCollectionOperations(...args),
}));

jest.mock('../app/ContextMenu', () => function MockContextMenu({ menuItems, tooltip, onOpenChange }) {
    return (
        <>
            <button type="button" data-testid="context-menu-open" onClick={() => onOpenChange?.(true)}>
                {`${tooltip}:${menuItems.length}`}
            </button>
            <button type="button" data-testid="context-menu-close" onClick={() => onOpenChange?.(false)}>
                Close Menu
            </button>
        </>
    );
});

jest.mock('../app/ColorPicker', () => function MockColorPicker({ action, onOpenChange }) {
    return (
        <>
            <button type="button" data-testid="color-picker-open" onClick={() => onOpenChange?.(true)}>
                Open Color Picker
            </button>
            <button type="button" data-testid="color-picker-select" onClick={() => action('orange')}>
                Pick Color
            </button>
            <button type="button" data-testid="color-picker-close" onClick={() => onOpenChange?.(false)}>
                Close Color Picker
            </button>
        </>
    );
});

jest.mock('../app/DroppableCollection', () => function MockDroppableCollection({ children }) {
    return <>{children}</>;
});

jest.mock('../app/utils/contextMenuItems', () => ({
    createCollectionMenuItems: jest.fn(() => [{ label: 'Duplicate' }, { label: 'Delete' }]),
}));

jest.mock('../static/globals', () => ({
    browser: {
        storage: {
            local: {
                get: (...args) => mockStorageGet(...args),
            },
        },
        tabs: {
            create: (...args) => mockTabsCreate(...args),
        },
    },
}));

jest.mock('javascript-time-ago', () => {
    return jest.fn().mockImplementation(() => ({
        format: jest.fn(() => 'Recently'),
    }));
});

describe('CollectionListItem', () => {
    const baseCollection = {
        uid: 'collection-1',
        name: 'OpenAI Docs',
        color: 'blue',
        lastUpdated: Date.now() - 1000,
        createdOn: Date.now() - 5000,
        tabs: [
            {
                uid: 'tab-1',
                title: 'OpenAI Search',
                url: 'https://openai.com/search',
                favIconUrl: 'https://openai.com/favicon.ico',
            },
            {
                uid: 'tab-2',
                title: 'OpenAI API',
                url: 'https://openai.com/api',
                favIconUrl: 'https://openai.com/favicon.ico',
            },
            {
                uid: 'tab-3',
                title: 'OpenAI Platform',
                url: 'https://platform.openai.com',
                favIconUrl: 'https://openai.com/favicon.ico',
            },
            {
                uid: 'tab-4',
                title: 'OpenAI Help',
                url: 'https://help.openai.com',
                favIconUrl: 'https://openai.com/favicon.ico',
            },
        ],
        chromeGroups: [{ id: 'group-1' }],
    };

    const renderItem = (overrideProps = {}, atomValues = []) => renderWithProviders(
        <CollectionListItem
            collection={baseCollection}
            index={0}
            removeCollection={jest.fn()}
            updateCollection={jest.fn()}
            updateRemoteData={jest.fn()}
            addCollection={jest.fn()}
            onDataUpdate={jest.fn()}
            dragHandleProps={{ attributes: {}, listeners: {} }}
            {...overrideProps}
        />,
        {
            withSuspense: false,
            atomValues,
        },
    );

    beforeEach(() => {
        mockCollectionHandlers = {
            _handleDelete: jest.fn(),
            _handleDuplicate: jest.fn(),
            _exportCollectionToFile: jest.fn(),
            _handleUpdate: jest.fn(),
            _handleOpenTabs: jest.fn(),
            _handleFocusWindow: jest.fn(),
            _handleStopTracking: jest.fn(),
        };

        mockUseCollectionOperations.mockClear();
        mockStorageGet.mockImplementation(async (key) => {
            if (key === 'chkEnableAutoUpdate') {
                return { chkEnableAutoUpdate: false };
            }

            if (key === 'collectionsToTrack') {
                return { collectionsToTrack: [] };
            }

            return {};
        });
        mockTabsCreate.mockReset();
    });

    test('opens the detail panel from the row while keeping action buttons separate', async () => {
        const onSelect = jest.fn();
        const updateCollection = jest.fn();

        const { container } = renderItem({
            onSelect,
            updateCollection,
            search: 'OpenAI',
        });

        expect(screen.getByText('4 matching tabs')).toBeInTheDocument();
        expect(container.querySelector('.search-match-text')).toHaveTextContent('OpenAI');

        fireEvent.click(container.querySelector('.collection-list-item'));
        expect(onSelect).toHaveBeenCalledWith(baseCollection);

        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        expect(mockCollectionHandlers._handleOpenTabs).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('color-picker-select'));
        expect(updateCollection).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-1',
            color: 'orange',
        }), true);
    });

    test('keeps the row active while the inline context menu is open', () => {
        const { container } = renderItem();
        const row = container.querySelector('.collection-list-item');

        expect(row).not.toHaveClass('collection-item-interaction-active');

        fireEvent.click(screen.getByTestId('context-menu-open'));
        expect(row).toHaveClass('collection-item-interaction-active');

        fireEvent.click(screen.getByTestId('context-menu-close'));
        expect(row).not.toHaveClass('collection-item-interaction-active');
    });

    test('keeps the row active while the color picker is open', () => {
        const { container } = renderItem();
        const row = container.querySelector('.collection-list-item');

        expect(row).not.toHaveClass('collection-item-interaction-active');

        fireEvent.click(screen.getByTestId('color-picker-open'));
        expect(row).toHaveClass('collection-item-interaction-active');

        fireEvent.click(screen.getByTestId('color-picker-close'));
        expect(row).not.toHaveClass('collection-item-interaction-active');
    });

    test('switches the primary action to focus mode for tracked collections', async () => {
        mockStorageGet.mockImplementation(async (key) => {
            if (key === 'chkEnableAutoUpdate') {
                return { chkEnableAutoUpdate: true };
            }

            if (key === 'collectionsToTrack') {
                return { collectionsToTrack: [{ collectionUid: 'collection-1' }] };
            }

            return {};
        });

        renderItem();

        const focusButton = await screen.findByRole('button', { name: 'Focus' });
        fireEvent.click(focusButton);

        expect(mockCollectionHandlers._handleFocusWindow).toHaveBeenCalledTimes(1);
    });

    test('suppresses row selection during cross-collection drags and expands matching tabs inline', async () => {
        const onSelect = jest.fn();
        const { container } = renderItem(
            {
                onSelect,
                search: 'OpenAI',
            },
            [[dragSessionState, { kind: 'tab', itemId: 'tab-1', sourceCollectionUid: 'other-collection' }]],
        );

        fireEvent.click(container.querySelector('.collection-list-item'));
        expect(onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('+ 1 more matching tab...'));
        expect(screen.getByText('Show less')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('link')[0]);

        expect(mockTabsCreate).toHaveBeenCalledWith({
            url: 'https://openai.com/search',
            active: true,
        });
    });
});
