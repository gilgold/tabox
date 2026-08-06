/* global browser */
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
const mockDownloadTextFile = jest.fn();
const mockSaveCollectionModal = jest.fn(function MockSaveCollectionModal({
    isOpen,
    initialSaveMode,
    snapshotCollection,
    sessionCollection,
}) {
    if (!isOpen) {
        return null;
    }

    const source = snapshotCollection || sessionCollection;

    return (
        <div>
            <div>{initialSaveMode === 'all' ? 'Save All Windows Modal' : 'Save Collection Modal'}</div>
            {source ? <div data-testid="save-collection-source">{source.name}</div> : null}
        </div>
    );
});

jest.mock('../app/utils', () => ({
    ...jest.requireActual('../app/utils'),
    downloadTextFile: (...args) => mockDownloadTextFile(...args),
}));

jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    updateCollectionsOrder: jest.fn(async () => true),
    updateFolderCollectionCount: jest.fn(async () => true),
    loadAllCollections: jest.fn(async () => []),
    batchDeleteCollections: jest.fn(async () => true),
}));

jest.mock('../app/utils/collectionBulkActions', () => ({
    ...jest.requireActual('../app/utils/collectionBulkActions'),
    openCollectionsInSequence: jest.fn(async () => ({
        openedCollections: [],
        failedCollections: [],
        openedCount: 0,
        failedCount: 0,
    })),
}));

import FPContentArea from '../app/fullpage/FPContentArea';
import { collectionRevealBatchState, highlightedCollectionUidState } from '../app/atoms/animationsState';
import { sidebarNavigationState } from '../app/atoms/fullpageState';
import { detailPanelOpenState, searchState, selectedCollectionUidState } from '../app/atoms/globalAppSettingsState';
import { noPermissionOpenState, sharedPanelOpenState } from '../app/atoms/sharedFoldersState';
import { CURRENT_WINDOWS_ACCENT_COLOR } from '../app/fullpage/fpAccentColors';
import {
    loadAllCollections,
    batchDeleteCollections,
    updateFolderCollectionCount,
} from '../app/utils/storageUtils';
import { openCollectionsInSequence } from '../app/utils/collectionBulkActions';

let mockLatestCardFoldersByUid = {};
jest.mock('../app/fullpage/FPCollectionCard', () => function MockFPCollectionCard({
    collection,
    onSelect,
    bulkSelectionActive,
    isBulkSelected,
    onToggleBulkSelected,
    onCardContextMenu,
    isInteractionActive,
    folders,
}) {
    mockLatestCardFoldersByUid[collection.uid] = folders;
    return (
        <div
            className={`fp-card ${isBulkSelected ? 'fp-card-bulk-selected' : ''} ${isInteractionActive ? 'fp-card-interaction-active' : ''}`}
            data-testid={`collection-${collection.uid}`}
            data-bulk-active={bulkSelectionActive ? 'true' : 'false'}
            data-context-menu={onCardContextMenu ? 'enabled' : 'disabled'}
            data-interaction-active={isInteractionActive ? 'true' : 'false'}
            onContextMenu={(event) => onCardContextMenu?.(event, collection, false, {
                _handleOpenTabs: jest.fn(),
                _handleFocusWindow: jest.fn(),
                _handleUpdate: jest.fn(),
                _handleDelete: jest.fn(),
                _handleDuplicate: jest.fn(),
                _exportCollectionToFile: jest.fn(),
                _handleStopTracking: jest.fn(),
            })}
        >
            <button
                type="button"
                aria-label={`open-collection-${collection.uid}`}
                onClick={() => onSelect?.(collection)}
            >
                Open Card
            </button>
            <button
                type="button"
                aria-label={`toggle-collection-${collection.uid}`}
                onClick={() => onToggleBulkSelected?.(collection)}
            >
                {isBulkSelected ? 'Deselect Collection' : 'Select Collection'}
            </button>
            <span>{collection.name}</span>
        </div>
    );
});

jest.mock('../app/fullpage/FPSessionCard', () => function MockFPSessionCard({ collection, sessionTimestamp, onSelect }) {
    return (
        <button
            type="button"
            className="fp-card fp-session-card"
            onClick={() => onSelect?.(collection, sessionTimestamp)}
        >
            {collection.name || 'Session Card'}
        </button>
    );
});

jest.mock('../app/fullpage/FPSingleTabSessionRow', () => function MockFPSingleTabSessionRow({
    collection,
    sessionTimestamp,
    isSelected,
    onToggleSelected,
    onSaveAsCollection,
}) {
    return (
        <div
            className={`fp-single-tab-session-row${isSelected ? ' is-selected' : ''}`}
            data-testid={`single-tab-session-${collection.uid}`}
        >
            <button
                type="button"
                aria-label={`restore-${collection.uid}`}
                onClick={() => global.browser.sessions.restore(collection.sessionId)}
            >
                Restore Tab Row
            </button>
            <button
                type="button"
                aria-label={`select-${collection.uid}`}
                onClick={() => onToggleSelected?.(collection, sessionTimestamp)}
            >
                {isSelected ? 'Deselect' : 'Select'}
            </button>
            <button
                type="button"
                aria-label={`save-${collection.uid}`}
                onClick={() => onSaveAsCollection?.(collection)}
            >
                Save Tab Row
            </button>
            <span>{collection.name}</span>
        </div>
    );
});

jest.mock('../app/fullpage/FPCurrentWindowCard', () => function MockFPCurrentWindowCard({ windowSnapshot, matchingTabs, search }) {
    return (
        <div
            className="fp-card fp-current-window-card"
            data-testid={`current-window-${windowSnapshot.windowId}`}
            data-match-count={matchingTabs?.length || 0}
            data-search={search || ''}
        >
            {windowSnapshot.name}
        </div>
    );
});

jest.mock('../app/fullpage/FPEmptyState', () => function MockFPEmptyState({ title, description, imageSrc, imageAlt, actions }) {
    return (
        <div
            data-testid="fp-empty-state"
            data-image-src={imageSrc || ''}
            data-image-alt={imageAlt || ''}
        >
            <div>{title}</div>
            {description ? <div>{description}</div> : null}
            {actions?.map((action) => (
                <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                >
                    {action.label}
                </button>
            ))}
        </div>
    );
});

jest.mock('../app/fullpage/SaveCollectionModal', () => mockSaveCollectionModal);

jest.mock('../app/fullpage/LegacyImportPreviewModal', () => function MockLegacyImportPreviewModal({
    isOpen,
    previewData,
    onConfirm,
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <div>
            <div>{`Import preview: ${previewData?.collections?.map((collection) => collection.name).join(', ') || 'Unknown'}`}</div>
            <button type="button" onClick={() => onConfirm?.({ selectedCollectionIds: [previewData?.collections?.[0]?.previewId].filter(Boolean) })}>
                Confirm Preview Import
            </button>
        </div>
    );
});

jest.mock('../app/ColorPicker', () => function MockColorPicker({ action, tooltip, currentColor }) {
    return (
        <button
            type="button"
            data-testid={`color-picker-${(tooltip || 'default').replace(/\s+/g, '-').toLowerCase()}`}
            data-current-color={currentColor || ''}
            onClick={() => action?.('teal')}
        >
            Color Picker
        </button>
    );
});

jest.mock('../app/CreateFolderModal', () => function MockCreateFolderModal({ isOpen, folder }) {
    if (!isOpen) {
        return null;
    }

    return <div>{folder ? 'Edit Folder Modal' : 'Create Folder Modal'}</div>;
});

jest.mock('../app/FolderDeleteConfirmModal', () => function MockFolderDeleteConfirmModal({ isOpen, folderName }) {
    if (!isOpen) {
        return null;
    }

    return <div>{`Delete ${folderName}`}</div>;
});

jest.mock('../app/fullpage/BulkMoveCollectionsModal', () => function MockBulkMoveCollectionsModal({
    isOpen,
    onClose,
    onConfirm,
    folders,
    selectedCount,
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <div>
            <div>{`Move ${selectedCount} collections`}</div>
            <button type="button" onClick={() => onConfirm?.(folders[0]?.uid || null)}>
                Confirm Bulk Move
            </button>
            <button type="button" onClick={onClose}>Close Bulk Move</button>
        </div>
    );
});

jest.mock('../app/fullpage/BulkDeleteCollectionsModal', () => function MockBulkDeleteCollectionsModal({
    isOpen,
    onClose,
    onConfirm,
    selectedCount,
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <div>
            <div>{`Delete ${selectedCount} collections`}</div>
            <button type="button" onClick={onConfirm}>Confirm Bulk Delete</button>
            <button type="button" onClick={onClose}>Close Bulk Delete</button>
        </div>
    );
});

jest.mock('../app/utils/folderOperations', () => ({
    moveCollectionToFolder: jest.fn(),
    removeCollectionFromFolder: jest.fn(),
    duplicateFolder: jest.fn(async () => ({ success: true, duplicatedCollections: 0 })),
    deleteFolder: jest.fn(async () => ({ success: true, collectionsDeleted: 0, collectionsMovedToRoot: 0 })),
    updateFolderDetails: jest.fn(async () => true),
}));

const renderWithStore = (
    ui,
    { navigation = 'all', search = '', revealBatch = null, highlightedCollectionUid = null } = {},
) => {
    const store = createStore();
    store.set(sidebarNavigationState, navigation);
    store.set(searchState, search);
    store.set(collectionRevealBatchState, revealBatch);
    store.set(highlightedCollectionUidState, highlightedCollectionUid);
    const rendered = render(<Provider store={store}>{ui}</Provider>);

    return {
        ...rendered,
        store,
        rerenderWithStore: (nextUi) => rendered.rerender(<Provider store={store}>{nextUi}</Provider>),
    };
};

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
    filters: { recentlyOpenedActual: false, colors: [] },
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

describe('FPContentArea grouped all collections view', () => {
    let OriginalFileReader;
    let scrollIntoViewMock;
    let scrollToMock;

    beforeAll(() => {
        OriginalFileReader = global.FileReader;
        class MockFileReader {
            readAsText(file) {
                this.result = file.__mockText || '';
                setTimeout(() => {
                    this.onload?.();
                }, 0);
            }
        }
        global.FileReader = MockFileReader;
    });

    afterAll(() => {
        global.FileReader = OriginalFileReader;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        document.documentElement.setAttribute('data-theme', 'light');
        loadAllCollections.mockResolvedValue([]);
        batchDeleteCollections.mockResolvedValue(true);
        updateFolderCollectionCount.mockResolvedValue(true);
        openCollectionsInSequence.mockResolvedValue({
            openedCollections: [],
            failedCollections: [],
            openedCount: 0,
            failedCount: 0,
        });
        scrollIntoViewMock = jest.fn();
        scrollToMock = jest.fn(function scrollTo(optionsOrX, y) {
            if (typeof optionsOrX === 'object' && optionsOrX !== null) {
                this.scrollTop = optionsOrX.top ?? this.scrollTop ?? 0;
                return;
            }

            this.scrollTop = typeof y === 'number' ? y : optionsOrX;
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoViewMock,
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true,
            value: scrollToMock,
        });
        window.requestAnimationFrame = jest.fn((callback) => setTimeout(() => callback(Date.now()), 16));
        window.cancelAnimationFrame = jest.fn((frameId) => clearTimeout(frameId));
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

            return {};
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('renders folder sections first and keeps root level after folders', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-1', name: 'Root Collection', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                    { uid: 'folder-2', name: 'Folder Two', collapsed: false, color: 'green' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Folder One')).toBeInTheDocument();
        });

        const sectionTitles = screen.getAllByText(/Folder One|Folder Two|Root Level/).map(node => node.textContent);
        expect(sectionTitles).toEqual(['Folder One', 'Folder Two', 'Root Level']);
    });

    test('clicking a collection opens the detail panel even while the shared panel is open', async () => {
        const { store } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-1', name: 'Root Collection', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
        );
        act(() => {
            store.set(sharedPanelOpenState, true);
        });

        await waitFor(() => {
            expect(screen.getByLabelText('open-collection-root-1')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByLabelText('open-collection-root-1'));

        expect(store.get(selectedCollectionUidState)).toBe('root-1');
        expect(store.get(detailPanelOpenState)).toBe(true);
    });

    test('shows empty folders in grouped all collections view', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                folders={[
                    { uid: 'folder-1', name: 'Empty Folder', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Empty Folder')).toBeInTheDocument();
        });

        expect(screen.getByText('Drop collections here to move them into this folder.')).toBeInTheDocument();
        expect(screen.getByText('Root Level')).toBeInTheDocument();
    });

    test('renders the clear-filters button at the left edge of the toolbar when filters are active', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-1', name: 'Root Collection', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Root Collection')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /opened/i }));

        const toolbar = container.querySelector('.fp-toolbar');
        const leadingSlot = container.querySelector('.fp-toolbar-leading');
        expect(toolbar).toBeInTheDocument();
        expect(toolbar.firstElementChild).toHaveClass('fp-toolbar-group-selection');
        expect(leadingSlot).toHaveClass('is-visible');
        expect(leadingSlot.firstElementChild).toHaveClass('fp-toolbar-clear');
        expect(leadingSlot.lastElementChild).toHaveClass('fp-toolbar-leading-divider');
    });

    test('renders default full-page toolbar actions as icon controls with a sort dropdown', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-1', name: 'Root Collection', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Root Collection')).toBeInTheDocument();
        });

        const toolbar = container.querySelector('.fp-toolbar-default');

        expect(toolbar.querySelector('.fp-toolbar-segment')).not.toBeInTheDocument();
        expect(toolbar.querySelector('#fp-toolbar-sort-select .toolbar-select__control')).toBeInTheDocument();
        expect(within(toolbar).getByRole('button', { name: 'Select All' })).not.toHaveTextContent('Select All');
        expect(within(toolbar).getByRole('button', { name: /opened/i })).toHaveTextContent('Opened');
        expect(within(toolbar).getByRole('button', { name: 'Import collections from file' })).not.toHaveTextContent('Import');
    });

    test('keeps the selected collections toolbar compact before mobile wrapping', () => {
        const cssPath = path.join(__dirname, '../app/fullpage/FPContentArea.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        const toolbarRule = css.match(/\.fp-toolbar\s*{[^}]+}/)?.[0] || '';
        const darkToolbarRule = css.match(/\[data-theme="dark"\] \.fp-toolbar\s*{[^}]+}/)?.[0] || '';
        const toolbarButtonRule = css.match(/\.fp-toolbar-btn\s*{[^}]+}/)?.[0] || '';
        const toolbarButtonActiveRule = css.match(/\.fp-toolbar-btn\.active\s*{[^}]+}/)?.[0] || '';
        const toolbarPillRule = css.match(/\.fp-toolbar-pill\s*{[^}]+}/)?.[0] || '';
        const toolbarSelectRule = css.match(/\.toolbar-select__control\s*{[^}]+}/)?.[0] || '';
        const dividerRule = css.match(/\.fp-toolbar-divider\s*{[^}]+}/)?.[0] || '';
        const toolbarStackRule = css.match(/\.fp-toolbar-stack\s*{[^}]+}/)?.[0] || '';
        const bulkSlotRule = css.match(/\.fp-bulk-toolbar-slot\s*{[^}]+}/)?.[0] || '';
        const collectionSelectionRule = css.match(/\.fp-toolbar-group-collection-selection\s*{[^}]+}/)?.[0] || '';
        const compactRule = css.match(/\.fp-toolbar-group-collection-selection \.fp-toolbar-btn-label\s*{[^}]+}/)?.[0] || '';
        const clearRule = css.match(/\.fp-toolbar-group-collection-selection \.fp-toolbar-session-clear-btn span\s*{[^}]+}/)?.[0] || '';
        const mobileRule = css.match(/@media \(max-width: 900px\)\s*{[\s\S]+?\.fp-toolbar-group-selection\s*{[^}]+}[\s\S]+?}/)?.[0] || '';
        const fullPageBorderlessRule = css.match(/html\.fullpage-mode \.fp-content \.fp-toolbar \.fp-toolbar-btn,[\s\S]+?\.toolbar-select__control\s*{[^}]+}/)?.[0] || '';
        const fullPageActiveRule = css.match(/html\.fullpage-mode \.fp-content \.fp-toolbar \.fp-toolbar-btn\.active,[\s\S]+?\.fp-toolbar-primary-btn\s*{[^}]+}/)?.[0] || '';

        expect(toolbarRule).toContain('max-width: calc(100% - 48px)');
        expect(toolbarRule).toContain('border-radius: 14px');
        expect(toolbarRule).toContain('background: var(--fp-toolbar-bg)');
        expect(toolbarRule).toContain('border: 1px solid var(--fp-toolbar-border)');
        expect(darkToolbarRule).toContain('--fp-toolbar-bg: rgba(43, 43, 43, 0.58)');
        expect(toolbarButtonRule).toContain('border: 0');
        expect(toolbarButtonRule).toContain('background: transparent');
        expect(toolbarButtonActiveRule).toContain('background: transparent');
        expect(toolbarButtonActiveRule).toContain('color: var(--primary-color)');
        expect(toolbarButtonActiveRule).toContain('box-shadow: none');
        expect(toolbarPillRule).toContain('border: 0');
        expect(toolbarPillRule).toContain('border-radius: 9px');
        expect(toolbarSelectRule).toContain('border: 0 !important');
        expect(toolbarSelectRule).toContain('background: var(--fp-toolbar-select-bg) !important');
        expect(dividerRule).toContain('background: var(--fp-toolbar-divider)');
        expect(toolbarStackRule).toContain('flex-direction: column');
        expect(bulkSlotRule).toContain('height: var(--fp-bulk-toolbar-slot-height)');
        expect(bulkSlotRule).toContain('opacity: 0');
        expect(collectionSelectionRule).toContain('flex-wrap: nowrap');
        expect(collectionSelectionRule).toContain('width: auto');
        expect(compactRule).toContain('height: 34px');
        expect(compactRule).toContain('font-size: 12px');
        expect(clearRule).toContain('display: none');
        expect(mobileRule).toMatch(/\.fp-toolbar-group-selection\s*{[^}]*width:\s*100%/);
        expect(fullPageBorderlessRule).toContain('border: 0 !important');
        expect(fullPageBorderlessRule).toContain('box-shadow: none !important');
        expect(fullPageActiveRule).toContain('background: transparent !important');
        expect(fullPageActiveRule).toContain('color: var(--primary-color) !important');
    });

    test('reserves enough compact vertical space for the heading above the floating toolbar', () => {
        const cssPath = path.join(__dirname, '../app/fullpage/FPContentArea.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).toContain('--fp-floating-toolbar-top: var(--fp-floating-title-top)');
        expect(css).toContain('--fp-floating-stack-offset: calc(var(--fp-floating-title-toolbar-gap) + var(--fp-toolbar-float-offset))');
        expect(css).toMatch(/@media \(max-width: 900px\)\s*{[\s\S]+?\.fp-toolbar\s*{[^}]*max-width:\s*calc\(100% - 16px\)[^}]*flex-wrap:\s*wrap/);
        expect(css).toMatch(/@media \(max-width: 900px\)\s*{[\s\S]+?\.fp-toolbar-leading:not\(\.is-visible\)\s*{[^}]*display:\s*none/);
    });

    test('keeps the default toolbar stable and shows bulk actions in a separate reserved row', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'bulk-separate', name: 'Separate Bar', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                    { uid: 'folder-2', name: 'Folder Two', collapsed: false, color: 'green' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Separate Bar')).toBeInTheDocument();
        });

        const toolbarStack = container.querySelector('.fp-toolbar-stack');
        const defaultToolbar = container.querySelector('.fp-toolbar-default');
        const bulkSlot = container.querySelector('.fp-bulk-toolbar-slot');

        expect(toolbarStack).toBeInTheDocument();
        expect(defaultToolbar).toBeInTheDocument();
        expect(bulkSlot).toBeInTheDocument();
        expect(bulkSlot).not.toHaveClass('is-visible');
        expect(within(defaultToolbar).getByRole('button', { name: /import/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-separate' }));

        expect(container.querySelector('.fp-toolbar-default')).toBe(defaultToolbar);
        expect(defaultToolbar).toContainElement(within(defaultToolbar).getByRole('button', { name: /import/i }));
        expect(bulkSlot).toHaveClass('is-visible');
        expect(within(bulkSlot).getByRole('button', { name: 'Open Selected' })).toBeInTheDocument();
    });

    test('uses icon-only buttons for selected collection bulk actions', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'bulk-compact', name: 'Compact Me', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                    { uid: 'folder-2', name: 'Folder Two', collapsed: false, color: 'green' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Compact Me')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-compact' }));

        expect(screen.getByRole('button', { name: 'Unselect All' })).not.toHaveTextContent('Unselect');
        expect(screen.getByRole('button', { name: 'Open Selected' })).not.toHaveTextContent('Open');
        expect(screen.getByRole('button', { name: 'Move to Folder' })).not.toHaveTextContent('Move');
        expect(screen.getByRole('button', { name: 'Remove from Folder' })).not.toHaveTextContent('Remove');
        expect(screen.getByRole('button', { name: 'Clear' })).not.toHaveTextContent('Clear');
        expect(screen.queryByText(/^Collections$/)).not.toBeInTheDocument();
    });

    test('emphasizes primary selection toolbar icons and keeps delete as red icon only', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'bulk-icon-size', name: 'Icon Size', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                    { uid: 'folder-2', name: 'Folder Two', collapsed: false, color: 'green' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Icon Size')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-icon-size' }));

        expect(screen.getByRole('button', { name: 'Open Selected' }).querySelector('svg')).toHaveAttribute('height', '20');
        expect(screen.getByRole('button', { name: 'Move to Folder' }).querySelector('svg')).toHaveAttribute('height', '20');
        expect(screen.getByRole('button', { name: 'Remove from Folder' }).querySelector('svg')).toHaveAttribute('height', '20');
        expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('fp-toolbar-danger-btn');
        expect(container.querySelector('.fp-toolbar-danger-btn svg')).toBeInTheDocument();
    });

    test('keeps filtered all collections results flat instead of sectioned', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                hasActiveFilters={true}
                collections={[
                    { uid: 'folder-collection', name: 'Filtered Collection', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('collection-folder-collection')).toBeInTheDocument();
        });

        expect(screen.queryByText('Root Level')).not.toBeInTheDocument();
        expect(screen.queryByText('Folder One')).not.toBeInTheDocument();
    });

    test('keeps search results flat instead of sectioned', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-1', name: 'Search Result', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                ]}
            />,
            { search: 'Search' },
        );

        await waitFor(() => {
            expect(screen.getByTestId('collection-root-1')).toBeInTheDocument();
        });

        expect(screen.queryByText('Root Level')).not.toBeInTheDocument();
        expect(screen.queryByText('Folder One')).not.toBeInTheDocument();
    });

    test('disables the full-page view toggle while collection search results are shown', async () => {
        const onViewModeChange = jest.fn();
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                viewMode="grid"
                onViewModeChange={onViewModeChange}
                collections={[
                    { uid: 'root-1', name: 'Search Result', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
            { search: 'Search' },
        );

        await waitFor(() => {
            expect(screen.getByTestId('collection-root-1')).toBeInTheDocument();
        });

        const viewToggleButton = container.querySelector('button[data-tooltip-content="View mode is unavailable while search is active"]');

        expect(viewToggleButton).toBeDisabled();
        onViewModeChange.mockClear();

        fireEvent.click(viewToggleButton);

        expect(onViewModeChange).not.toHaveBeenCalled();
    });

    test('disables the lightweight current windows view toggle while search results are shown', async () => {
        const onViewModeChange = jest.fn();
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                viewMode="grid"
                onViewModeChange={onViewModeChange}
                currentWindows={[
                    {
                        windowId: 17,
                        name: 'Workspace Window',
                        tabs: [
                            { id: 1, title: 'Search Match', url: 'https://example.com/search' },
                        ],
                        chromeGroups: [],
                        isCurrentWindow: true,
                    },
                ]}
            />,
            { navigation: 'current-windows', search: 'Search' },
        );

        await waitFor(() => {
            expect(screen.getByTestId('current-window-17')).toBeInTheDocument();
        });

        const viewToggleButton = container.querySelector('button[data-tooltip-content="View mode is unavailable while search is active"]');

        expect(viewToggleButton).toBeDisabled();
        onViewModeChange.mockClear();

        fireEvent.click(viewToggleButton);

        expect(onViewModeChange).not.toHaveBeenCalled();
    });

    test('renders the folder heading above the detached floating toolbar with the folder accent', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'folder-collection', name: 'Folder Collection', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Design References', collapsed: false, color: 'blue' },
                ]}
            />,
            { navigation: 'folder-1' },
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Design References' })).toBeInTheDocument();
        });

        const toolbar = container.querySelector('.fp-toolbar-wrapper');
        const titleRow = container.querySelector('.fp-content-title-row');
        const badge = container.querySelector('.fp-content-heading-badge');

        expect(toolbar).toBeInTheDocument();
        expect(toolbar).toHaveClass('fp-toolbar-wrapper-floating');
        expect(titleRow).toBeInTheDocument();
        expect(badge).toBeInTheDocument();
        // The folder accent now flows through the heading gradient/badge via the custom property.
        expect(titleRow).toHaveStyle('--fp-heading-accent: #2563EB');
        expect(titleRow.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('uses a dedicated accent color for the current windows heading', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[
                    {
                        windowId: 17,
                        name: 'Workspace Window',
                        tabs: [],
                        chromeGroups: [],
                        isCurrentWindow: true,
                    },
                ]}
            />,
            { navigation: 'current-windows' },
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Current Windows' })).toBeInTheDocument();
        });

        expect(container.querySelector('.fp-content-title-row')).toHaveStyle(`--fp-heading-accent: ${CURRENT_WINDOWS_ACCENT_COLOR}`);
    });

    test('renders the top full-page heading as a single accent-washed title row above the toolbar', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'folder-collection', name: 'Folder Collection', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                    { uid: 'root-collection', name: 'Root Collection', parentId: null, order: 0, lastUpdated: 9, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Design References', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'All Collections' })).toBeInTheDocument();
        });

        const titleRow = container.querySelector('.fp-content-title-row');

        expect(titleRow).toBeInTheDocument();
        // The accent wash gradient is driven by the --fp-heading-accent custom property.
        expect(titleRow).toHaveStyle('--fp-heading-accent: var(--primary-color)');
        // Single-row header: badge, title, and count all live inside the one title row.
        expect(within(titleRow).getByText('Library area')).toBeInTheDocument();
        expect(titleRow.querySelector('.fp-content-title')).toHaveTextContent('All Collections');
        expect(titleRow.querySelector('.fp-content-heading-count')).toBeInTheDocument();
        // The per-section headings do not get the top title row treatment.
        expect(container.querySelector('[data-section-id="folder-1"]')).not.toHaveClass('fp-content-title-row');
        expect(container.querySelector('[data-section-id="__root__"]')).not.toHaveClass('fp-content-title-row');
    });

    test('renders the subtitle separator only when a subtitle is present', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'collection-1', name: 'Alpha', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'All Collections' })).toBeInTheDocument();
        });

        const titleRow = container.querySelector('.fp-content-title-row');
        // The default "All Collections" view has a subtitle, so the separator and subtitle render.
        expect(titleRow.querySelector('.fp-content-heading-sep')).toBeInTheDocument();
        expect(titleRow.querySelector('.fp-content-heading-subtitle')).toHaveTextContent(
            'Everything you have saved in Tabox',
        );
    });

    test('toggles folder collapse using the view-scoped folder state callback', async () => {
        const onFolderStateChange = jest.fn();

        renderWithStore(
            <FPContentArea
                {...baseProps}
                onFolderStateChange={onFolderStateChange}
                folders={[
                    { uid: 'folder-1', name: 'Collapsible Folder', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Collapsible Folder')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Collapsible Folder'));

        await waitFor(() => {
            expect(onFolderStateChange).toHaveBeenCalledWith(
                expect.objectContaining({ uid: 'folder-1', collapsed: true }),
            );
        });
        expect(screen.getByText('Root Level').closest('[role="button"]')).toBeNull();
    });

    test('opens the sidebar folder context menu when right-clicking a grouped folder header row', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                folders={[
                    { uid: 'folder-1', name: 'Context Folder', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        const folderHeader = await screen.findByRole('button', { name: /Context Folder 0/i });
        fireEvent.contextMenu(folderHeader);

        expect(await screen.findByText('Open All Collections')).toBeInTheDocument();
        expect(screen.getByText('Share…').closest('button')).toContainElement(
            screen.getByLabelText('Tabox Pro feature'),
        );
        expect(screen.getByText('Edit Folder')).toBeInTheDocument();
        expect(screen.getByText('Export Folder')).toBeInTheDocument();
        expect(screen.getByText('Duplicate Folder')).toBeInTheDocument();
        expect(screen.getByText('Delete Folder')).toBeInTheDocument();
    });

    // Fix round 3 (task-13-report.md "## Fix round 3"): the full-page folder
    // context menu had zero shared-folder gating - a read-only member (or the
    // owner) could see and click plain "Delete Folder" on a shared folder. It
    // must instead show the sharing-specific actions and never plain delete.
    test('shows Leave Shared Folder (and not Delete Folder) for a read-only shared folder', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                folders={[
                    { uid: 'folder-1', name: 'Read Only Folder', collapsed: false, color: 'blue', shared: { folderId: 'folder-1', role: 'read' } },
                ]}
            />,
        );

        const folderHeader = await screen.findByRole('button', { name: /Read Only Folder 0/i });
        fireEvent.contextMenu(folderHeader);

        expect(await screen.findByText('Leave Shared Folder')).toBeInTheDocument();
        expect(screen.queryByText('Delete Folder')).not.toBeInTheDocument();
        expect(screen.queryByText('Share…')).not.toBeInTheDocument();
        expect(screen.queryByText('Manage Sharing…')).not.toBeInTheDocument();
        expect(screen.queryByText('Stop Sharing (keep my copy)')).not.toBeInTheDocument();
    });

    test('shows Manage Sharing and Stop Sharing (and not Delete Folder) for a folder the user owns and shares', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                folders={[
                    { uid: 'folder-1', name: 'Owned Shared Folder', collapsed: false, color: 'blue', shared: { folderId: 'folder-1', role: 'owner', members: [] } },
                ]}
            />,
        );

        const folderHeader = await screen.findByRole('button', { name: /Owned Shared Folder 0/i });
        fireEvent.contextMenu(folderHeader);

        expect(await screen.findByText('Manage Sharing…')).toBeInTheDocument();
        expect(screen.getByText('Stop Sharing (keep my copy)')).toBeInTheDocument();
        expect(screen.queryByText('Delete Folder')).not.toBeInTheDocument();
        expect(screen.queryByText('Leave Shared Folder')).not.toBeInTheDocument();
    });

    test('keeps the right-clicked collection card active while its context menu is open', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'collection-1', name: 'Alpha', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                    { uid: 'collection-2', name: 'Beta', parentId: null, order: 1, lastUpdated: 9, tabs: [] },
                ]}
            />,
        );

        const alphaCard = await screen.findByTestId('collection-collection-1');
        const betaCard = screen.getByTestId('collection-collection-2');

        expect(alphaCard).toHaveAttribute('data-interaction-active', 'false');
        expect(betaCard).toHaveAttribute('data-interaction-active', 'false');

        fireEvent.contextMenu(alphaCard);

        expect(await screen.findByText('Open Tabs')).toBeInTheDocument();
        expect(screen.getByText('Share via Link').closest('button')).toContainElement(
            screen.getByLabelText('Tabox Pro feature'),
        );
        expect(alphaCard).toHaveAttribute('data-interaction-active', 'true');
        expect(betaCard).toHaveAttribute('data-interaction-active', 'false');
    });

    test('reveals the root section and the new root collection card in grouped all collections', async () => {
        jest.useFakeTimers();

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-1', name: 'Root Reveal', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
            {
                revealBatch: {
                    runId: 'reveal-root',
                    items: [{ uid: 'root-1', parentId: null }],
                },
            },
        );

        await act(async () => {
            jest.advanceTimersByTime(110);
        });

        expect(scrollToMock).toHaveBeenCalled();
        expect(container.querySelector('[data-section-id="__root__"]')).toHaveAttribute('data-section-reveal', 'true');

        await act(async () => {
            jest.advanceTimersByTime(140);
        });

        const revealShell = container.querySelector('[data-sortable-collection-id="root-1"]');
        expect(revealShell).toHaveAttribute('data-collection-reveal', 'true');
        expect(revealShell).toHaveAttribute('data-collection-reveal-index', '0');
        expect(revealShell).toHaveStyle('--fp-reveal-color: var(--collection-default-color)');
    });

    test('expands a collapsed target folder before revealing imported folder collections', async () => {
        jest.useFakeTimers();
        const onFolderStateChange = jest.fn();
        const revealBatch = {
            runId: 'reveal-folder',
            items: [{ uid: 'folder-collection', parentId: 'folder-1' }],
        };

        const { container, rerenderWithStore } = renderWithStore(
            <FPContentArea
                {...baseProps}
                onFolderStateChange={onFolderStateChange}
                collections={[
                    { uid: 'folder-collection', name: 'Folder Reveal', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Collapsed Folder', collapsed: true, color: 'blue' },
                ]}
            />,
            { revealBatch },
        );

        expect(onFolderStateChange).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'folder-1', collapsed: false }),
        );

        rerenderWithStore(
            <FPContentArea
                {...baseProps}
                onFolderStateChange={onFolderStateChange}
                collections={[
                    { uid: 'folder-collection', name: 'Folder Reveal', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Collapsed Folder', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await act(async () => {
            jest.advanceTimersByTime(110);
        });

        expect(scrollToMock).toHaveBeenCalled();
        expect(container.querySelector('[data-section-id="folder-1"]')).toHaveAttribute('data-section-reveal', 'true');

        await act(async () => {
            jest.advanceTimersByTime(140);
        });

        const revealShell = container.querySelector('[data-sortable-collection-id="folder-collection"]');
        expect(revealShell).toHaveAttribute('data-collection-reveal', 'true');
    });

    test('assigns deterministic stagger indexes to all visible items in a multi-import batch', async () => {
        jest.useFakeTimers();

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-a', name: 'Root A', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                    { uid: 'root-b', name: 'Root B', parentId: null, order: 1, lastUpdated: 9, tabs: [] },
                    { uid: 'root-c', name: 'Root C', parentId: null, order: 2, lastUpdated: 8, tabs: [] },
                ]}
            />,
            {
                revealBatch: {
                    runId: 'reveal-multi',
                    items: [
                        { uid: 'root-b', parentId: null },
                        { uid: 'root-a', parentId: null },
                        { uid: 'root-c', parentId: null },
                    ],
                },
            },
        );

        await act(async () => {
            jest.advanceTimersByTime(110);
        });

        expect(scrollToMock).toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(140);
        });

        expect(container.querySelector('[data-sortable-collection-id="root-b"]')).toHaveAttribute('data-collection-reveal-index', '0');
        expect(container.querySelector('[data-sortable-collection-id="root-a"]')).toHaveAttribute('data-collection-reveal-index', '1');
        expect(container.querySelector('[data-sortable-collection-id="root-c"]')).toHaveAttribute('data-collection-reveal-index', '2');
    });

    test('skips reveal behavior in non-collection views and clears the pending batch', async () => {
        const revealBatch = {
            runId: 'reveal-current-window',
            items: [{ uid: 'window-save', parentId: null }],
        };

        const { store } = renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[
                    {
                        uid: 'current-window-1',
                        windowId: 1,
                        name: 'Current Window',
                        tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                        chromeGroups: [],
                        window: { id: 1 },
                        isCurrentWindow: true,
                    },
                ]}
            />,
            { navigation: 'current-windows', revealBatch },
        );

        await waitFor(() => {
            expect(store.get(collectionRevealBatchState)).toBeNull();
        });

        expect(scrollToMock).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Current Windows' })).toBeInTheDocument();
    });

    test('uses the reduced-motion reveal variant when motion preferences request it', async () => {
        jest.useFakeTimers();
        window.matchMedia = jest.fn().mockImplementation((query) => ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        }));

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-reduced', name: 'Reduced Motion', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
            {
                revealBatch: {
                    runId: 'reveal-reduced',
                    items: [{ uid: 'root-reduced', parentId: null }],
                },
            },
        );

        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            jest.advanceTimersByTime(1);
        });

        expect(scrollToMock).toHaveBeenCalled();
        expect(container.querySelector('[data-sortable-collection-id="root-reduced"]')).toHaveClass('reduced-motion');
        expect(container.querySelector('[data-section-id="__root__"]')).toHaveClass('fp-grouped-section-header-reveal', 'reduced-motion');
    });

    test('reveals highlighted updated collections without changing scroll position', async () => {
        jest.useFakeTimers();

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'updated-root', name: 'Updated Root', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
            {
                highlightedCollectionUid: 'updated-root',
            },
        );

        await act(async () => {
            jest.advanceTimersByTime(110);
        });

        expect(scrollToMock).not.toHaveBeenCalled();
        expect(container.querySelector('[data-section-id="__root__"]')).toHaveAttribute('data-section-reveal', 'true');

        await act(async () => {
            jest.advanceTimersByTime(140);
        });

        expect(container.querySelector('[data-sortable-collection-id="updated-root"]')).toHaveAttribute('data-collection-reveal', 'true');
    });

    test('renders current windows in search mode with matching tab data', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[
                    {
                        uid: 'current-window-1',
                        windowId: 1,
                        name: 'Current Window',
                        tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                        chromeGroups: [],
                        window: { id: 1 },
                        isCurrentWindow: true,
                    },
                    {
                        uid: 'current-window-2',
                        windowId: 2,
                        name: 'Window 2',
                        tabs: [{ uid: 'tab-2', title: 'GitHub', url: 'https://github.com/gilgold/tabox' }],
                        chromeGroups: [],
                        window: { id: 2 },
                        isCurrentWindow: false,
                    },
                ]}
            />,
            { navigation: 'current-windows', search: 'github' },
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Current Windows' })).toBeInTheDocument();
        });

        expect(screen.getByText('Matches for "github"')).toBeInTheDocument();
        expect(screen.getByText('1 window')).toBeInTheDocument();
        expect(screen.queryByTestId('current-window-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('current-window-2')).toBeInTheDocument();
        expect(screen.getByTestId('current-window-2')).toHaveAttribute('data-match-count', '1');
        expect(screen.getByTestId('current-window-2')).toHaveAttribute('data-search', 'github');
        expect(container.querySelector('.fp-session-group-cards.fp-content-search-mode')).toBeInTheDocument();
    });

    test('shows a dedicated empty state for current windows', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[]}
            />,
            { navigation: 'current-windows' },
        );

        await waitFor(() => {
            expect(screen.getByText('No open windows')).toBeInTheDocument();
        });

        expect(container.querySelector('.fp-content-empty-state-wrap [data-testid="fp-empty-state"]')).toBeInTheDocument();
    });

    test('uses the desert artwork for the all collections empty state in light mode', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
            />,
            { navigation: 'all' },
        );

        const emptyState = await screen.findByTestId('fp-empty-state');

        expect(emptyState).toHaveAttribute('data-image-src', 'images/desert.png');
        expect(emptyState).toHaveAttribute('data-image-alt', 'Desert scene');
    });

    test('uses the night desert artwork for the root-level empty state in dark mode', async () => {
        document.documentElement.setAttribute('data-theme', 'dark');

        renderWithStore(
            <FPContentArea
                {...baseProps}
            />,
            { navigation: 'unorganized' },
        );

        const emptyState = await screen.findByTestId('fp-empty-state');

        expect(emptyState).toHaveAttribute('data-image-src', 'images/desert-night.png');
        expect(emptyState).toHaveAttribute('data-image-alt', 'Desert scene');
    });

    test('opens the save collection modal from the all collections empty state action', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
            />,
            { navigation: 'all' },
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Save Current Tabs' }));

        await waitFor(() => {
            expect(screen.getByText('Save Collection Modal')).toBeInTheDocument();
        });
    });

    test('forces the recently closed view to use the shared list layout even when the saved preference is grid', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        collections: [
                            {
                                uid: 'session-1',
                                name: 'Saved Window',
                                tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Saved Window')).toBeInTheDocument();
        });

        expect(container.querySelector('.fp-session-group-cards.fp-content-list-mode')).toBeInTheDocument();
        expect(container.querySelector('.fp-session-group-cards .fp-card.fp-session-card')).toBeInTheDocument();
    });

    test('opens the save-all-windows modal from the current windows toolbar', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[
                    {
                        uid: 'current-window-1',
                        windowId: 1,
                        name: 'Current Window',
                        tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                        chromeGroups: [],
                        window: { id: 1 },
                        isCurrentWindow: true,
                    },
                ]}
            />,
            { navigation: 'current-windows' },
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Save All Windows' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save All Windows' }));

        expect(screen.getByText('Save All Windows Modal')).toBeInTheDocument();
    });

    test('uses the shared card layout container for current windows in list mode', async () => {
        browser.storage.local.get.mockImplementation(async (keys) => {
            const values = {
                currentSortValue: 'DATE',
                currentSortAscending: true,
                fpViewMode: 'list',
                chkOpenNewWindow: false,
                sessions: [],
            };

            if (Array.isArray(keys)) {
                return keys.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {});
            }

            if (typeof keys === 'string') {
                return { [keys]: values[keys] };
            }

            return {};
        });

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[
                    {
                        uid: 'current-window-1',
                        windowId: 1,
                        name: 'Current Window',
                        tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                        chromeGroups: [],
                        window: { id: 1 },
                        isCurrentWindow: true,
                    },
                ]}
            />,
            { navigation: 'current-windows' },
        );

        await waitFor(() => {
            expect(screen.getByText('Current Window')).toBeInTheDocument();
        });

        expect(container.querySelector('.fp-session-group-cards.fp-current-window-group-cards.fp-content-list-mode')).toBeInTheDocument();
        expect(container.querySelector('.fp-session-group-cards .fp-card.fp-current-window-card')).toBeInTheDocument();
    });

    test('adds the standard top content spacing to the current windows live view', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                currentWindows={[
                    {
                        uid: 'current-window-1',
                        windowId: 1,
                        name: 'Current Window',
                        tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                        chromeGroups: [],
                        window: { id: 1 },
                        isCurrentWindow: true,
                    },
                ]}
            />,
            { navigation: 'current-windows' },
        );

        await waitFor(() => {
            expect(screen.getByText('Current Window')).toBeInTheDocument();
        });

        expect(container.querySelector('.fp-content-sessions')).toHaveClass('fp-content-sessions-current-windows');
    });

    test('renders browser sessions and opens the session panel target on click', async () => {
        const onSelectSession = jest.fn();

        renderWithStore(
            <FPContentArea
                {...baseProps}
                onSelectSession={onSelectSession}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        collections: [
                            {
                                uid: 'session-1',
                                name: 'Saved Window',
                                tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Saved Window')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Saved Window'));

        expect(onSelectSession).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'session-1' }),
            1710000000000,
        );
    });

    test('renders a mixed timeline with single-tab rows and window cards in the same bucket', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 2, 27, 12, 0, 0));

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: new Date(2026, 2, 27, 11, 30, 0).getTime(),
                        sourceType: 'window',
                        collections: [
                            {
                                uid: 'window-session',
                                name: 'Window Session',
                                sourceType: 'window',
                                tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 27, 11, 0, 0).getTime(),
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session',
                                name: 'Single Tab Session',
                                sourceType: 'tab',
                                sessionId: 'tab-session-1',
                                sessionEntryKey: 'tab:tab-session-1',
                                tabs: [{ uid: 'tab-2', title: 'Article', url: 'https://example.com/article' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Window Session')).toBeInTheDocument();
        });

        const bucketGrid = container.querySelector('.fp-session-group-cards');
        expect(bucketGrid.querySelector('.fp-card.fp-session-card')).toBeInTheDocument();
        expect(bucketGrid.querySelector('.fp-single-tab-session-row')).toBeInTheDocument();
        expect(screen.getByText('Window Session').compareDocumentPosition(screen.getByText('Single Tab Session')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('groups browser sessions into hour and day buckets based on the available range', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 2, 27, 12, 0, 0));

        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: new Date(2026, 2, 27, 11, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-last-two-hours', name: 'Last Two Hours Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 27, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-two-to-four-hours', name: 'Two To Four Hours Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 27, 7, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-four-to-six-hours', name: 'Four To Six Hours Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 27, 4, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-earlier-today', name: 'Earlier Today Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 26, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-yesterday', name: 'Yesterday Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 25, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-last-three-days', name: 'Last Three Days Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 23, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-last-seven-days', name: 'Last Seven Days Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 18, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-last-thirty-days', name: 'Last Thirty Days Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 0, 20, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-last-ninety-days', name: 'Last Ninety Days Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2025, 11, 15, 9, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-older', name: 'Older Window', tabs: [], chromeGroups: [] },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Last 2 hours')).toBeInTheDocument();
        });

        expect(screen.getByText('2-4 hours ago')).toBeInTheDocument();
        expect(screen.getByText('4-6 hours ago')).toBeInTheDocument();
        expect(screen.getByText('Earlier today')).toBeInTheDocument();
        expect(screen.getByText('Yesterday')).toBeInTheDocument();
        expect(screen.getByText('Last 3 days')).toBeInTheDocument();
        expect(screen.getByText('Last 7 days')).toBeInTheDocument();
        expect(screen.getByText('Last 30 days')).toBeInTheDocument();
        expect(screen.getByText('Last 90 days')).toBeInTheDocument();
        expect(screen.getByText('Older')).toBeInTheDocument();
        expect(screen.getByText('Last Two Hours Window')).toBeInTheDocument();
        expect(screen.getByText('Earlier Today Window')).toBeInTheDocument();
        expect(screen.getByText('Older Window')).toBeInTheDocument();
    });

    test('uses a single grid container for all cards within the same session time bucket', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 2, 27, 12, 0, 0));

        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: new Date(2026, 2, 27, 11, 0, 0).getTime(),
                        collections: [
                            { uid: 'session-a', name: 'Session A', tabs: [], chromeGroups: [] },
                        ],
                    },
                    {
                        timestamp: new Date(2026, 2, 27, 10, 30, 0).getTime(),
                        collections: [
                            { uid: 'session-b', name: 'Session B', tabs: [], chromeGroups: [] },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Last 2 hours')).toBeInTheDocument();
        });

        const bucketHeaders = container.querySelectorAll('.fp-session-group-header');
        const bucketGrids = container.querySelectorAll('.fp-session-group-cards');

        expect(bucketHeaders).toHaveLength(1);
        expect(bucketGrids).toHaveLength(1);
        expect(bucketGrids[0].querySelectorAll('.fp-card.fp-session-card')).toHaveLength(2);
    });

    test('shows collection select all and limits it to visible cards in grouped view', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'root-visible', name: 'Root Visible', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                    { uid: 'folder-hidden', name: 'Hidden In Folder', parentId: 'folder-1', order: 0, lastUpdated: 9, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Hidden Folder', collapsed: true, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Root Visible')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Select All' }));

        expect(screen.getByText('1 selected')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open Selected' })).toBeInTheDocument();
        expect(screen.getByText('Opened')).toBeInTheDocument();
        expect(screen.getByText('Opened').closest('.fp-toolbar')).toHaveClass('fp-toolbar-default');
        expect(screen.getByRole('button', { name: 'Open Selected' }).closest('.fp-bulk-toolbar-slot')).toHaveClass('is-visible');
    });

    test('prunes selected collections when their section is collapsed', async () => {
        const rendered = renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'folder-selection', name: 'Folder Selection', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Collapsible Folder', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Folder Selection')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-folder-selection' }));
        expect(screen.getByText('1 selected')).toBeInTheDocument();

        rendered.rerenderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'folder-selection', name: 'Folder Selection', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Collapsible Folder', collapsed: true, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
        });
    });

    test('moves selected collections to a folder through the bulk toolbar', async () => {
        const updateRemoteData = jest.fn();
        const onDataUpdate = jest.fn();

        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-move-root', name: 'Move Me', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
            { uid: 'other-collection', name: 'Other', parentId: null, order: 1, lastUpdated: 9, tabs: [] },
        ]);

        renderWithStore(
            <FPContentArea
                {...baseProps}
                updateRemoteData={updateRemoteData}
                onDataUpdate={onDataUpdate}
                collections={[
                    { uid: 'bulk-move-root', name: 'Move Me', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                    { uid: 'other-collection', name: 'Other', parentId: null, order: 1, lastUpdated: 9, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-target', name: 'Target Folder', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Move Me')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-move-root' }));
        fireEvent.click(screen.getByRole('button', { name: 'Move to Folder' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Move' }));

        await waitFor(() => {
            expect(updateRemoteData).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ uid: 'bulk-move-root', parentId: 'folder-target' }),
            ]));
        });
        expect(updateFolderCollectionCount).toHaveBeenCalledWith('folder-target');
        expect(onDataUpdate).toHaveBeenCalled();
    });

    test('removes selected collections from folders through the bulk toolbar', async () => {
        const updateRemoteData = jest.fn();

        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-remove', name: 'Remove Me', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
        ]);

        renderWithStore(
            <FPContentArea
                {...baseProps}
                updateRemoteData={updateRemoteData}
                collections={[
                    { uid: 'bulk-remove', name: 'Remove Me', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                ]}
            />,
            { navigation: 'folder-1' },
        );

        await waitFor(() => {
            expect(screen.getByText('Remove Me')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-remove' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove from Folder' }));

        await waitFor(() => {
            expect(updateRemoteData).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ uid: 'bulk-remove', parentId: null }),
            ]));
        });
        expect(updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
    });

    test('recolors selected collections from the bulk toolbar', async () => {
        const updateRemoteData = jest.fn();

        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-recolor', name: 'Recolor Me', parentId: null, color: 'blue', order: 0, lastUpdated: 10, tabs: [] },
        ]);

        renderWithStore(
            <FPContentArea
                {...baseProps}
                updateRemoteData={updateRemoteData}
                collections={[
                    { uid: 'bulk-recolor', name: 'Recolor Me', parentId: null, color: 'blue', order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Recolor Me')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-recolor' }));
        fireEvent.click(screen.getByTestId('color-picker-recolor-selected-collections'));

        await waitFor(() => {
            expect(updateRemoteData).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ uid: 'bulk-recolor', color: 'teal' }),
            ]));
        });
    });

    test('exports selected collections as a full_export subset with referenced folders', async () => {
        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-export', name: 'Export Me', parentId: 'folder-1', color: 'blue', order: 0, lastUpdated: 10, tabs: [] },
        ]);

        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'bulk-export', name: 'Export Me', parentId: 'folder-1', color: 'blue', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder Export', collapsed: false, color: 'red' },
                    { uid: 'folder-2', name: 'Unused Folder', collapsed: false, color: 'green' },
                ]}
            />,
            { navigation: 'folder-1' },
        );

        await waitFor(() => {
            expect(screen.getByText('Export Me')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-export' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        await waitFor(() => {
            expect(mockDownloadTextFile).toHaveBeenCalledTimes(1);
        });
        const exportPayload = JSON.parse(mockDownloadTextFile.mock.calls[0][0]);
        expect(exportPayload).toEqual(expect.objectContaining({
            type: 'full_export',
            collections: [expect.objectContaining({ uid: 'bulk-export' })],
            folders: [expect.objectContaining({ uid: 'folder-1' })],
        }));
    });

    test('opens the txt import preview instead of importing immediately', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[]}
                folders={[]}
            />,
        );

        const input = document.querySelector('input[type="file"][accept=".txt"]');
        const file = new File(['collections'], 'collections.txt', { type: 'application/json' });
        Object.defineProperty(file, '__mockText', {
            value: JSON.stringify({
                type: 'full_export',
                folders: [{ uid: 'folder-1', name: 'Team' }],
                collections: [
                    { uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] },
                    { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [], chromeGroups: [] },
                ],
            }),
        });

        await act(async () => {
            fireEvent.change(input, {
                target: {
                    files: [file],
                },
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Import preview: Alpha, Beta')).toBeInTheDocument();
        });
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            type: 'importData',
        }));
    });

    test('sends only the selected txt collections from the import preview', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[]}
                folders={[]}
            />,
        );

        const input = document.querySelector('input[type="file"][accept=".txt"]');
        const file = new File(['collections'], 'collections.txt', { type: 'application/json' });
        Object.defineProperty(file, '__mockText', {
            value: JSON.stringify({
                type: 'full_export',
                folders: [
                    { uid: 'folder-1', name: 'Team' },
                    { uid: 'folder-2', name: 'Unused' },
                ],
                collections: [
                    { uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] },
                    { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [], chromeGroups: [] },
                ],
            }),
        });

        await act(async () => {
            fireEvent.change(input, {
                target: {
                    files: [file],
                },
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Import preview: Alpha, Beta')).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Preview Import' }));
        });

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'importData',
            data: {
                type: 'full_export',
                folders: [{ uid: 'folder-1', name: 'Team' }],
                collections: [{ uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] }],
            },
        });
    });

    test('opens selected collections from the bulk toolbar', async () => {
        openCollectionsInSequence.mockResolvedValue({
            openedCollections: [{ uid: 'bulk-open' }],
            failedCollections: [],
            openedCount: 1,
            failedCount: 0,
        });
        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-open', name: 'Open Me', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
        ]);

        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'bulk-open', name: 'Open Me', parentId: null, order: 0, lastUpdated: 10, tabs: [] },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Open Me')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-open' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Selected' }));

        await waitFor(() => {
            expect(openCollectionsInSequence).toHaveBeenCalledWith([
                expect.objectContaining({ uid: 'bulk-open' }),
            ]);
        });
    });

    test('deletes selected collections through the bulk toolbar and clears the selection', async () => {
        const updateRemoteData = jest.fn();

        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-delete-a', name: 'Delete A', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
            { uid: 'bulk-delete-b', name: 'Keep B', parentId: null, order: 1, lastUpdated: 9, tabs: [] },
        ]);

        renderWithStore(
            <FPContentArea
                {...baseProps}
                updateRemoteData={updateRemoteData}
                collections={[
                    { uid: 'bulk-delete-a', name: 'Delete A', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                    { uid: 'bulk-delete-b', name: 'Keep B', parentId: null, order: 1, lastUpdated: 9, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Delete A')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-delete-a' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Delete' }));

        await waitFor(() => {
            expect(batchDeleteCollections).toHaveBeenCalledWith(['bulk-delete-a']);
        });
        expect(updateRemoteData).toHaveBeenCalledWith([
            expect.objectContaining({ uid: 'bulk-delete-b' }),
        ]);
        expect(updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
        await waitFor(() => {
            expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
        });
    });

    test('blocks bulk delete when the selection includes a collection inside a read-only shared folder', async () => {
        const updateRemoteData = jest.fn();

        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-delete-shared', name: 'Shared Delete Target', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
        ]);

        const { store } = renderWithStore(
            <FPContentArea
                {...baseProps}
                updateRemoteData={updateRemoteData}
                collections={[
                    { uid: 'bulk-delete-shared', name: 'Shared Delete Target', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Read Only Folder', collapsed: false, color: 'blue', shared: { folderId: 'folder-1', role: 'read' } },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Shared Delete Target')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-delete-shared' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Delete' }));

        await waitFor(() => {
            expect(store.get(noPermissionOpenState)).toBe(true);
        });
        expect(batchDeleteCollections).not.toHaveBeenCalled();
        expect(updateRemoteData).not.toHaveBeenCalled();
    });

    // Positive-path gap (round 3): a folder that is shared but still writable
    // (write/owner role) must NOT trip the read-only bulk-delete guard.
    test('does not block bulk delete when the collection is inside a shared-but-writable folder', async () => {
        const updateRemoteData = jest.fn();

        loadAllCollections.mockResolvedValue([
            { uid: 'bulk-delete-writable', name: 'Writable Shared Delete Target', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
        ]);

        const { store } = renderWithStore(
            <FPContentArea
                {...baseProps}
                updateRemoteData={updateRemoteData}
                collections={[
                    { uid: 'bulk-delete-writable', name: 'Writable Shared Delete Target', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={[
                    { uid: 'folder-1', name: 'Writable Shared Folder', collapsed: false, color: 'blue', shared: { folderId: 'folder-1', role: 'write' } },
                ]}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Writable Shared Delete Target')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-collection-bulk-delete-writable' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Bulk Delete' }));

        await waitFor(() => {
            expect(batchDeleteCollections).toHaveBeenCalledWith(['bulk-delete-writable']);
        });
        expect(store.get(noPermissionOpenState)).toBe(false);
    });

    test('threads the live folders array down to each collection card instead of leaving it to the per-card self-fetch fallback', async () => {
        mockLatestCardFoldersByUid = {};
        const sharedFolders = [
            { uid: 'folder-1', name: 'Folder One', collapsed: false, color: 'blue' },
        ];

        renderWithStore(
            <FPContentArea
                {...baseProps}
                collections={[
                    { uid: 'wired-card', name: 'Wired Card', parentId: 'folder-1', order: 0, lastUpdated: 10, tabs: [] },
                ]}
                folders={sharedFolders}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Wired Card')).toBeInTheDocument();
        });

        expect(mockLatestCardFoldersByUid['wired-card']).toBe(sharedFolders);
    });

    test('shows a bulk action bar for selected single-tab sessions and combines them for save', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-a',
                                name: 'Selected Tab A',
                                sourceType: 'tab',
                                sessionId: 'tab-session-a',
                                sessionEntryKey: 'tab:tab-session-a',
                                tabs: [{ uid: 'tab-a', title: 'Tab A', url: 'https://example.com/a' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                    {
                        timestamp: 1709990000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-b',
                                name: 'Selected Tab B',
                                sourceType: 'tab',
                                sessionId: 'tab-session-b',
                                sessionEntryKey: 'tab:tab-session-b',
                                tabs: [{ uid: 'tab-b', title: 'Tab B', url: 'https://example.com/b' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Selected Tab A')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-a' }));
        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-b' }));

        expect(screen.getByText('2 selected')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Save as Collection' }));

        await waitFor(() => {
            expect(screen.getByText('Save Collection Modal')).toBeInTheDocument();
        });

        const openSaveCall = [...mockSaveCollectionModal.mock.calls].reverse().find(([props]) => props.isOpen);
        expect(openSaveCall[0].snapshotCollection.tabs.map((tab) => tab.title)).toEqual(['Tab A', 'Tab B']);
    });

    test('selects and unselects all visible single-tab sessions from the toolbar', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-select-all-a',
                                name: 'Select All Tab A',
                                sourceType: 'tab',
                                sessionId: 'tab-session-select-all-a',
                                sessionEntryKey: 'tab:tab-session-select-all-a',
                                tabs: [{ uid: 'tab-a', title: 'Tab A', url: 'https://example.com/a' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                    {
                        timestamp: 1709990000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-select-all-b',
                                name: 'Select All Tab B',
                                sourceType: 'tab',
                                sessionId: 'tab-session-select-all-b',
                                sessionEntryKey: 'tab:tab-session-select-all-b',
                                tabs: [{ uid: 'tab-b', title: 'Tab B', url: 'https://example.com/b' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Select All Tab A')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unselect All' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Unselect All' }));

        await waitFor(() => {
            expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
        });
    });

    test('exports selected single-tab sessions as one combined collection file', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-export-a',
                                name: 'Export Tab A',
                                sourceType: 'tab',
                                sessionId: 'tab-session-export-a',
                                sessionEntryKey: 'tab:tab-session-export-a',
                                tabs: [{ uid: 'tab-export-a', title: 'Export A', url: 'https://example.com/export-a' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                    {
                        timestamp: 1709990000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-export-b',
                                name: 'Export Tab B',
                                sourceType: 'tab',
                                sessionId: 'tab-session-export-b',
                                sessionEntryKey: 'tab:tab-session-export-b',
                                tabs: [{ uid: 'tab-export-b', title: 'Export B', url: 'https://example.com/export-b' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Export Tab A')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-export-a' }));
        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-export-b' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export to File' }));

        expect(mockDownloadTextFile).toHaveBeenCalledTimes(1);
        const exportedCollection = JSON.parse(mockDownloadTextFile.mock.calls[0][0]);
        expect(exportedCollection.tabs.map((tab) => tab.title)).toEqual(['Export A', 'Export B']);
    });

    test('restores all selected single-tab sessions even if the list refreshes during the bulk action', async () => {
        const firstSession = {
            timestamp: 1710000000000,
            sourceType: 'tab',
            collections: [
                {
                    uid: 'tab-session-restore-a',
                    name: 'Restore Tab A',
                    sourceType: 'tab',
                    sessionId: 'tab-session-restore-a',
                    sessionEntryKey: 'tab:tab-session-restore-a',
                    tabs: [{ uid: 'tab-restore-a', title: 'Restore A', url: 'https://example.com/restore-a' }],
                    chromeGroups: [],
                },
            ],
        };
        const secondSession = {
            timestamp: 1709990000000,
            sourceType: 'tab',
            collections: [
                {
                    uid: 'tab-session-restore-b',
                    name: 'Restore Tab B',
                    sourceType: 'tab',
                    sessionId: 'tab-session-restore-b',
                    sessionEntryKey: 'tab:tab-session-restore-b',
                    tabs: [{ uid: 'tab-restore-b', title: 'Restore B', url: 'https://example.com/restore-b' }],
                    chromeGroups: [],
                },
            ],
        };

        const rendered = renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[firstSession, secondSession]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Restore Tab A')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-restore-a' }));
        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-restore-b' }));

        browser.sessions.restore
            .mockImplementationOnce(async () => {
                rendered.rerenderWithStore(
                    <FPContentArea
                        {...baseProps}
                        sessionList={[]}
                    />,
                );
            })
            .mockResolvedValueOnce(undefined);

        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => {
            expect(browser.sessions.restore).toHaveBeenCalledTimes(2);
        });
    });

    test('clears the bulk action bar when the selection is cleared', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        sourceType: 'tab',
                        collections: [
                            {
                                uid: 'tab-session-clear',
                                name: 'Clearable Tab',
                                sourceType: 'tab',
                                sessionId: 'tab-session-clear',
                                sessionEntryKey: 'tab:tab-session-clear',
                                tabs: [{ uid: 'tab-clear', title: 'Clear Me', url: 'https://example.com/clear' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions' },
        );

        await waitFor(() => {
            expect(screen.getByText('Clearable Tab')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'select-tab-session-clear' }));
        expect(screen.getByText('1 selected')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

        await waitFor(() => {
            expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
        });
    });

    test('filters browser sessions by matching tab title and flattens search results', async () => {
        const { container } = renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        collections: [
                            {
                                uid: 'session-1',
                                name: 'Work Window',
                                tabs: [{ uid: 'tab-1', title: 'OpenAI Docs', url: 'https://openai.com/docs' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                    {
                        timestamp: 1700000000000,
                        collections: [
                            {
                                uid: 'session-2',
                                name: 'Reading Window',
                                tabs: [{ uid: 'tab-2', title: 'Wikipedia', url: 'https://wikipedia.org/wiki/Search' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions', search: 'openai' },
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Recently Closed' })).toBeInTheDocument();
        });

        expect(screen.getByText('Matches for "openai"')).toBeInTheDocument();
        expect(screen.getByText('1 item')).toBeInTheDocument();
        expect(screen.getByText('Work Window')).toBeInTheDocument();
        expect(screen.queryByText('Reading Window')).not.toBeInTheDocument();
        expect(container.querySelector('.fp-session-group-cards.fp-content-search-mode')).toBeInTheDocument();
    });

    test('filters browser sessions by matching tab url', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        collections: [
                            {
                                uid: 'session-1',
                                name: 'Docs Window',
                                tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                                chromeGroups: [],
                            },
                            {
                                uid: 'session-2',
                                name: 'Repo Window',
                                tabs: [{ uid: 'tab-2', title: 'GitHub', url: 'https://github.com/gilgold/tabox' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions', search: 'gilgold' },
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Recently Closed' })).toBeInTheDocument();
        });

        expect(screen.getByText('Matches for "gilgold"')).toBeInTheDocument();
        expect(screen.getByText('1 item')).toBeInTheDocument();
        expect(screen.queryByText('Docs Window')).not.toBeInTheDocument();
        expect(screen.getByText('Repo Window')).toBeInTheDocument();
    });

    test('shows a session-specific empty state when no recently closed items match search', async () => {
        renderWithStore(
            <FPContentArea
                {...baseProps}
                sessionList={[
                    {
                        timestamp: 1710000000000,
                        collections: [
                            {
                                uid: 'session-1',
                                name: 'Docs Window',
                                tabs: [{ uid: 'tab-1', title: 'Docs', url: 'https://openai.com/docs' }],
                                chromeGroups: [],
                            },
                        ],
                    },
                ]}
            />,
            { navigation: 'sessions', search: 'nomatch' },
        );

        await waitFor(() => {
            expect(screen.getByText('No results')).toBeInTheDocument();
        });

        expect(screen.getByText('No recently closed items match "nomatch"')).toBeInTheDocument();
    });
});
