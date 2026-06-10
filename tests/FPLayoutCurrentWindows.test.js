import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPLayout from '../app/fullpage/FPLayout';
import { sidebarNavigationState, currentWindowsState } from '../app/atoms/fullpageState';
import { detailPanelOpenState, selectedCurrentWindowIdState } from '../app/atoms/globalAppSettingsState';

jest.mock('../app/fullpage/FPTopBar', () => function MockFPTopBar() {
    return <div>Top Bar</div>;
});

jest.mock('../app/fullpage/FPSidebar', () => function MockFPSidebar() {
    return <div>Sidebar</div>;
});

jest.mock('../app/fullpage/FPContentArea', () => function MockFPContentArea({ currentWindows, onSelectCurrentWindow }) {
    return (
        <div>
            <div data-testid="current-window-count">{currentWindows.length}</div>
            <div data-testid="current-window-names">{currentWindows.map((window) => `${window.windowId}:${window.name}`).join('|')}</div>
            <button type="button" onClick={() => currentWindows[0] && onSelectCurrentWindow(currentWindows[0])}>
                Select Window
            </button>
        </div>
    );
});

jest.mock('../app/CollectionDetailPanel', () => function MockCollectionDetailPanel() {
    return <div>Collection Panel</div>;
});

jest.mock('../app/fullpage/SaveCollectionModal', () => function MockSaveCollectionModal() {
    return null;
});

jest.mock('../app/fullpage/CurrentWindowCloseModal', () => function MockCurrentWindowCloseModal() {
    return null;
});

jest.mock('../app/fullpage/FPCurrentWindowPanel', () => function MockFPCurrentWindowPanel({ windowSnapshot }) {
    return <div>{windowSnapshot.name}</div>;
});

const baseProps = {
    folders: [],
    collections: [],
    allCollections: [],
    logout: jest.fn(),
    applyDataFromServer: jest.fn(),
    updateRemoteData: jest.fn(),
    addCollection: jest.fn(),
    removeCollection: jest.fn(),
    updateCollection: jest.fn(),
    addFolder: jest.fn(),
    onDataUpdate: jest.fn(),
    onFolderStateChange: jest.fn(),
    updateFolders: jest.fn(),
    triggerSync: jest.fn(),
    viewMode: 'grid',
    onViewModeChange: jest.fn(),
    onFiltersChange: jest.fn(),
    hasActiveFilters: false,
    triggerFolderLightningEffect: jest.fn(),
    trackedCollectionUids: new Set(),
    listKey: 'layout-test',
};

const renderWithStore = () => {
    const store = createStore();
    store.set(sidebarNavigationState, 'current-windows');
    store.set(detailPanelOpenState, false);
    store.set(selectedCurrentWindowIdState, null);
    store.set(currentWindowsState, []);

    const view = render(
        <Provider store={store}>
            <FPLayout {...baseProps} />
        </Provider>,
    );

    return { store, ...view };
};

describe('FPLayout current window refresh', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.windows.getAll
            .mockResolvedValueOnce([{ id: 1, focused: true, tabs: [] }])
            .mockResolvedValueOnce([{ id: 1, focused: true, tabs: [] }, { id: 2, focused: false, tabs: [] }])
            .mockResolvedValue([{ id: 1, focused: false, tabs: [] }, { id: 2, focused: true, tabs: [] }]);
        browser.windows.getCurrent.mockResolvedValue({ id: 1, focused: true, tabs: [] });
        browser.tabGroups.query.mockResolvedValue([]);
    });

    test('refreshes current windows from live browser events and opens the dedicated panel', async () => {
        const { store } = renderWithStore();

        await waitFor(() => {
            expect(screen.getByTestId('current-window-count')).toHaveTextContent('1');
        });

        await act(async () => {
            browser.windows.onCreated.trigger({ id: 2 });
        });

        await waitFor(() => {
            expect(screen.getByTestId('current-window-count')).toHaveTextContent('2');
        });

        await act(async () => {
            browser.windows.onFocusChanged.trigger(2);
        });

        await waitFor(() => {
            expect(screen.getByTestId('current-window-names')).toHaveTextContent('1:Window 1|2:Current Window');
        });

        await act(async () => {
            screen.getByText('Select Window').click();
        });

        expect(store.get(selectedCurrentWindowIdState)).toBe(1);
        expect(screen.getByText('Window 1')).toBeInTheDocument();
    });
});
