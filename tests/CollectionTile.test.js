/** @jest-environment jsdom */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionTile from '../app/CollectionTile';
import { aiProcessingUidsState, aiProcessingCurrentUidState } from '../app/atoms/aiState';
import { renderWithProviders } from './helpers/renderWithProviders';

let mockCollectionHandlers;
const mockUseCollectionOperations = jest.fn(() => mockCollectionHandlers);
const mockStorageGet = jest.fn();
const mockTabsCreate = jest.fn();

jest.mock('../app/useCollectionOperations', () => ({
    useCollectionOperations: (...args) => mockUseCollectionOperations(...args),
}));

jest.mock('../app/ContextMenu', () => function MockContextMenu({ menuItems, tooltip }) {
    return <button type="button" data-testid="context-menu">{`${tooltip}:${menuItems.length}`}</button>;
});

jest.mock('../app/ColorPicker', () => function MockColorPicker({ action }) {
    return (
        <button type="button" data-testid="color-picker" onClick={() => action('green')}>
            Pick Color
        </button>
    );
});

jest.mock('../app/DroppableCollection', () => function MockDroppableCollection({ children }) {
    return <>{children}</>;
});

jest.mock('../app/utils/contextMenuItems', () => ({
    createCollectionMenuItems: jest.fn(() => [{ label: 'Duplicate' }, { label: 'Delete' }]),
}));

jest.mock('../app/utils/colorMigration', () => ({
    getColorValue: jest.fn(() => '#112233'),
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

describe('CollectionTile', () => {
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
        ],
        chromeGroups: [{ id: 'group-1' }],
    };

    const renderTile = (overrideProps = {}, atomValues = []) => renderWithProviders(
        <CollectionTile
            collection={baseCollection}
            index={0}
            removeCollection={jest.fn()}
            updateCollection={jest.fn()}
            updateRemoteData={jest.fn()}
            addCollection={jest.fn()}
            onDataUpdate={jest.fn()}
            dragAttributes={{}}
            dragListeners={{}}
            {...overrideProps}
        />,
        { withSuspense: false, atomValues },
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
            _handleToggleFavorite: jest.fn(),
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

    test('opens the detail panel from the tile while keeping action buttons separate', async () => {
        const onSelect = jest.fn();
        const { container } = renderTile({
            onSelect,
            search: 'Open',
            folderName: 'Research',
        });

        expect(screen.getByText('Research')).toBeInTheDocument();
        expect(screen.getByText('1 tab match')).toBeInTheDocument();
        expect(container.querySelector('.search-match-text')).toHaveTextContent('Open');
        expect(container.querySelector('.tile-hover-menu')).toBeInTheDocument();
        expect(container.querySelector('.tile-hover-menu [data-testid="color-picker"]')).toBeInTheDocument();
        expect(container.querySelector('.tile-color-picker')).not.toBeInTheDocument();

        fireEvent.click(container.querySelector('.collection-tile'));
        expect(onSelect).toHaveBeenCalledWith(baseCollection);

        fireEvent.click(container.querySelector('.play-button'));
        expect(mockCollectionHandlers._handleOpenTabs).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledTimes(1);

        fireEvent.click(container.querySelector('.delete-button'));
        expect(mockCollectionHandlers._handleDelete).toHaveBeenCalledTimes(1);
    });

    test('shows tracked, recent, and incognito states while allowing color changes', async () => {
        const updateCollection = jest.fn();
        const recentIncognitoCollection = {
            ...baseCollection,
            tabs: [],
            savedFromIncognito: true,
            lastOpened: Date.now(),
        };

        mockStorageGet.mockImplementation(async (key) => {
            if (key === 'chkEnableAutoUpdate') {
                return { chkEnableAutoUpdate: true };
            }

            if (key === 'collectionsToTrack') {
                return { collectionsToTrack: [{ collectionUid: 'collection-1' }] };
            }

            return {};
        });

        const { container } = renderTile({
            collection: recentIncognitoCollection,
            updateCollection,
        });

        await waitFor(() => {
            expect(container.querySelector('.collection-tile')).toHaveClass('active-auto-tracking');
        });

        expect(screen.getByText('No tabs')).toBeInTheDocument();
        expect(container.querySelector('.incognito-indicator')).toBeInTheDocument();
        expect(container.querySelector('.recently-opened-indicator')).toBeInTheDocument();
        expect(container.querySelector('.collection-tile')).toHaveStyle('border-color: #112233');

        fireEvent.click(screen.getByTestId('color-picker'));

        expect(updateCollection).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-1',
            color: 'green',
        }), true);
    });

    describe('AI processing overlay', () => {
        it('renders overlay when uid is in aiProcessingUidsState', () => {
            const { container } = renderTile({}, [
                [aiProcessingUidsState, ['collection-1']],
            ]);
            const overlay = container.querySelector('.ai-processing-overlay');
            expect(overlay).toBeInTheDocument();
            expect(overlay).not.toHaveClass('ai-processing-overlay--current');
        });

        it('renders overlay with --current modifier when uid matches aiProcessingCurrentUidState', () => {
            const { container } = renderTile({}, [
                [aiProcessingUidsState, ['collection-1']],
                [aiProcessingCurrentUidState, 'collection-1'],
            ]);
            const overlay = container.querySelector('.ai-processing-overlay');
            expect(overlay).toBeInTheDocument();
            expect(overlay).toHaveClass('ai-processing-overlay--current');
        });

        it('renders no overlay when uid is not in the processing state', () => {
            const { container } = renderTile({}, [
                [aiProcessingUidsState, ['other-uid']],
                [aiProcessingCurrentUidState, 'other-uid'],
            ]);
            expect(container.querySelector('.ai-processing-overlay')).not.toBeInTheDocument();
        });
    });

    describe('favorite toggle', () => {
        it('renders an outline star and calls toggle on click', () => {
            renderTile();
            const starButton = screen.getByRole('button', { name: 'Add to favorites' });
            fireEvent.click(starButton);
            expect(mockCollectionHandlers._handleToggleFavorite).toHaveBeenCalledTimes(1);
        });

        it('renders a filled star for a favorited collection', () => {
            renderTile({ collection: { ...baseCollection, isFavorite: true } });
            expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument();
        });
    });
});
