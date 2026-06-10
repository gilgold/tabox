import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import FPCollectionCard from '../app/fullpage/FPCollectionCard';

class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

global.ResizeObserver = MockResizeObserver;

jest.mock('javascript-time-ago', () => {
    return jest.fn().mockImplementation(() => ({
        format: jest.fn(() => 'Recently'),
    }));
});

jest.mock('../app/useCollectionOperations', () => ({
    useCollectionOperations: jest.fn(() => ({
        _handleDelete: jest.fn(),
        _handleDuplicate: jest.fn(),
        _exportCollectionToFile: jest.fn(),
        _handleUpdate: jest.fn(),
        _handleOpenTabs: jest.fn(),
        _handleFocusWindow: jest.fn(),
        _handleStopTracking: jest.fn(),
    })),
}));

jest.mock('../app/DroppableCollection', () => function MockDroppableCollection({ children, disabled = false }) {
    return (
        <div data-testid="droppable-collection" data-disabled={disabled ? 'true' : 'false'}>
            {children}
        </div>
    );
});

jest.mock('../app/ContextMenu', () => function MockContextMenu({ onOpenChange }) {
    return (
        <>
            <button type="button" onClick={() => onOpenChange?.(true)}>Open Menu</button>
            <button type="button" onClick={() => onOpenChange?.(false)}>Close Menu</button>
        </>
    );
});

jest.mock('../app/ColorPicker', () => function MockColorPicker({ onOpenChange }) {
    return (
        <>
            <button type="button" onClick={() => onOpenChange?.(true)}>Open Color Picker</button>
            <button type="button" onClick={() => onOpenChange?.(false)}>Close Color Picker</button>
        </>
    );
});

describe('FPCollectionCard keyboard navigation', () => {
    const baseCollection = {
        uid: 'collection-1',
        name: 'Collection One',
        tabs: [
            {
                uid: 'tab-1',
                title: 'OpenAI Docs',
                url: 'https://openai.com/docs',
                favIconUrl: 'https://openai.com/favicon.ico',
            },
        ],
        chromeGroups: [],
        createdOn: Date.now(),
        lastUpdated: Date.now(),
    };

    test('uses the card as the tab stop instead of nested controls', () => {
        const onSelect = jest.fn();

        render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={onSelect}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    search="openai"
                />
            </Provider>,
        );

        const card = screen.getByRole('button', { name: 'Open collection Collection One' });
        expect(card).toHaveAttribute('tabindex', '0');
        expect(card).toHaveClass('fp-card');

        expect(screen.getByText('Open').closest('button')).toHaveAttribute('tabindex', '-1');
        expect(screen.getByText('Update').closest('button')).toHaveAttribute('tabindex', '-1');
        expect(screen.getByText('Delete').closest('button')).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('link', { name: /OpenAI Docs/i })).toHaveAttribute('tabindex', '-1');
        expect(document.querySelector('.fp-card-actions')).toHaveClass('fp-card-hover-menu');
        expect(document.querySelector('.fp-card-menu-option')).toContainElement(screen.getByText('Open Menu'));
        expect(document.querySelector('.fp-card-color-picker')).toContainElement(screen.getByText('Open Color Picker'));
        expect(screen.getByText('Open').closest('button')).toHaveClass('fp-card-rail-open');
        expect(screen.getByText('Update').closest('button')).toHaveClass('fp-card-rail-update');
        expect(screen.getByText('Delete').closest('button')).toHaveClass('fp-card-rail-delete');

        fireEvent.keyDown(card, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith(baseCollection);
    });

    test('disables collection drop targets when the card is rendered without drop support', () => {
        render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    enableDropZone={false}
                />
            </Provider>,
        );

        expect(screen.getByTestId('droppable-collection')).toHaveAttribute('data-disabled', 'true');
    });

    test('uses the shared default collection color token for uncolored collections', () => {
        render(
            <Provider>
                <FPCollectionCard
                    collection={{ ...baseCollection, color: 'var(--collection-default-color)' }}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        expect(screen.getByRole('button', { name: 'Open collection Collection One' })).toHaveStyle('--card-color: var(--collection-default-color)');
    });

    test('renders tab and group count badges in the footer leading slot', () => {
        const collectionWithGroups = {
            ...baseCollection,
            tabs: [
                ...baseCollection.tabs,
                {
                    uid: 'tab-2',
                    title: 'Grouped Tab',
                    url: 'https://example.com/grouped',
                    groupUid: 'group-1',
                },
            ],
            chromeGroups: [{ uid: 'group-1', name: 'Work', color: 'blue' }],
        };

        const { container } = render(
            <Provider>
                <FPCollectionCard
                    collection={collectionWithGroups}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        const leadingMeta = container.querySelector('.fp-card-footer-leading-meta');
        expect(leadingMeta).toContainElement(screen.getByText('2 tabs'));
        expect(leadingMeta).toContainElement(screen.getByText('1 group'));
        expect(screen.getByText('2 tabs')).toHaveClass('fp-card-count-chip', 'tabs');
        expect(screen.getByText('1 group')).toHaveClass('fp-card-count-chip', 'groups');
        expect(container.querySelector('.fp-collection-card')).toBeInTheDocument();
    });

    test('renders a bulk selection checkbox without triggering card selection', () => {
        const onSelect = jest.fn();
        const onToggleBulkSelected = jest.fn();

        render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={onSelect}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    onToggleBulkSelected={onToggleBulkSelected}
                />
            </Provider>,
        );

        const checkbox = screen.getByRole('button', { name: 'Select collection Collection One' });
        expect(checkbox).toHaveAttribute('tabindex', '-1');

        fireEvent.click(checkbox);

        expect(onToggleBulkSelected).toHaveBeenCalledWith(baseCollection);
        expect(onSelect).not.toHaveBeenCalled();
    });

    test('uses a distinct bulk-selected visual state and hides inline actions in bulk mode', () => {
        render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    bulkSelectionActive={true}
                    isBulkSelected={true}
                    onToggleBulkSelected={jest.fn()}
                />
            </Provider>,
        );

        expect(screen.getByRole('button', { name: 'Open collection Collection One' })).toHaveClass('fp-card-bulk-selected');
        expect(screen.getByRole('button', { name: 'Deselect collection Collection One' })).toBeInTheDocument();
        expect(screen.queryByText('Open')).not.toBeInTheDocument();
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    test('keeps the card active while the action menu is open', () => {
        render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        const card = screen.getByRole('button', { name: 'Open collection Collection One' });
        expect(card).not.toHaveClass('fp-card-interaction-active');

        fireEvent.click(screen.getByText('Open Menu'));
        expect(card).toHaveClass('fp-card-interaction-active');

        fireEvent.click(screen.getByText('Close Menu'));
        expect(card).not.toHaveClass('fp-card-interaction-active');
    });

    test('keeps the card active while the color picker is open', () => {
        render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        const card = screen.getByRole('button', { name: 'Open collection Collection One' });
        expect(card).not.toHaveClass('fp-card-interaction-active');

        fireEvent.click(screen.getByText('Open Color Picker'));
        expect(card).toHaveClass('fp-card-interaction-active');

        fireEvent.click(screen.getByText('Close Color Picker'));
        expect(card).not.toHaveClass('fp-card-interaction-active');
    });

    test('shows all favicons and hides the overflow counter when there is enough space', () => {
        const collectionWithFavicons = {
            ...baseCollection,
            tabs: Array.from({ length: 4 }, (_, index) => ({
                uid: `tab-${index + 1}`,
                title: `Tab ${index + 1}`,
                url: `https://example.com/${index + 1}`,
                favIconUrl: `https://example.com/favicon-${index + 1}.ico`,
            })),
        };

        const clientWidthSpy = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidthGetter() {
            if (this.classList?.contains('fp-card-favicons')) {
                return 220;
            }

            if (this.classList?.contains('fp-card-favicon-more')) {
                return 30;
            }

            return 0;
        });

        const { container } = render(
            <Provider>
                <FPCollectionCard
                    collection={collectionWithFavicons}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        expect(container.querySelectorAll('.fp-card-favicon')).toHaveLength(4);
        expect(container.querySelector('.fp-card-favicon-more')).not.toBeInTheDocument();

        clientWidthSpy.mockRestore();
    });

    test('always shows all favicons for collections with fewer than nine tabs', () => {
        const collectionWithTwoFavicons = {
            ...baseCollection,
            tabs: Array.from({ length: 2 }, (_, index) => ({
                uid: `tab-${index + 1}`,
                title: `Tab ${index + 1}`,
                url: `https://example.com/${index + 1}`,
                favIconUrl: `https://example.com/favicon-${index + 1}.ico`,
            })),
        };

        const clientWidthSpy = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidthGetter() {
            if (this.classList?.contains('fp-card-favicons')) {
                return 60;
            }

            if (this.classList?.contains('fp-card-favicon-more')) {
                return 30;
            }

            return 0;
        });

        const { container } = render(
            <Provider>
                <FPCollectionCard
                    collection={collectionWithTwoFavicons}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        expect(container.querySelectorAll('.fp-card-favicon')).toHaveLength(2);
        expect(container.querySelector('.fp-card-favicon-more')).not.toBeInTheDocument();

        clientWidthSpy.mockRestore();
    });

    test('uses fallback favicons so small collections still show one chip per tab', () => {
        const collectionWithMissingFavicon = {
            ...baseCollection,
            tabs: [
                {
                    uid: 'tab-1',
                    title: 'Tab 1',
                    url: 'https://example.com/1',
                    favIconUrl: 'https://example.com/favicon-1.ico',
                },
                {
                    uid: 'tab-2',
                    title: 'Tab 2',
                    url: 'https://example.com/2',
                    favIconUrl: '',
                },
            ],
        };

        const { container } = render(
            <Provider>
                <FPCollectionCard
                    collection={collectionWithMissingFavicon}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        const renderedFavicons = container.querySelectorAll('.fp-card-favicon');
        expect(renderedFavicons).toHaveLength(2);
        expect(renderedFavicons[1]).toHaveAttribute('src', './images/favicon-fallback.png');
        expect(container.querySelector('.fp-card-favicon-more')).not.toBeInTheDocument();
    });

    test('adds a centered title-row class in full-page list mode', () => {
        const { container } = render(
            <Provider>
                <FPCollectionCard
                    collection={baseCollection}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    viewMode="list"
                />
            </Provider>,
        );

        expect(container.querySelector('.fp-card-title-row')).toHaveClass('fp-card-title-row-list');
    });

    test('shows an overflow counter only when the favicon area runs out of space', () => {
        const collectionWithFavicons = {
            ...baseCollection,
            tabs: Array.from({ length: 10 }, (_, index) => ({
                uid: `tab-${index + 1}`,
                title: `Tab ${index + 1}`,
                url: `https://example.com/${index + 1}`,
                favIconUrl: `https://example.com/favicon-${index + 1}.ico`,
            })),
        };

        const clientWidthSpy = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidthGetter() {
            if (this.classList?.contains('fp-card-favicons')) {
                return 90;
            }

            if (this.classList?.contains('fp-card-favicon-more')) {
                return 30;
            }

            return 0;
        });

        const { container } = render(
            <Provider>
                <FPCollectionCard
                    collection={collectionWithFavicons}
                    index={0}
                    onSelect={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                />
            </Provider>,
        );

        expect(container.querySelectorAll('.fp-card-favicon')).toHaveLength(3);
        expect(screen.getByText('+5')).toBeInTheDocument();

        clientWidthSpy.mockRestore();
    });
});
