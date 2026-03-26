/* global browser */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPLayout from '../app/fullpage/FPLayout';
import { browserSessionsState, sidebarNavigationState, currentWindowsState } from '../app/atoms/fullpageState';
import { detailPanelOpenState, selectedSessionEntryKeyState } from '../app/atoms/globalAppSettingsState';

jest.mock('../app/fullpage/FPTopBar', () => function MockFPTopBar() {
    return <div>Top Bar</div>;
});

jest.mock('../app/fullpage/FPSidebar', () => function MockFPSidebar() {
    return <div>Sidebar</div>;
});

jest.mock('../app/fullpage/FPContentArea', () => function MockFPContentArea({ sessionList, onSelectSession }) {
    return (
        <div>
            <div data-testid="session-count">{sessionList.length}</div>
            <div>{sessionList[0]?.collections?.[0]?.name || 'No Session'}</div>
            <button
                type="button"
                onClick={() => sessionList[0]?.collections?.[0] && onSelectSession(sessionList[0].collections[0], sessionList[0].timestamp)}
            >
                Select Session
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

jest.mock('../app/fullpage/FPCurrentWindowPanel', () => function MockFPCurrentWindowPanel() {
    return <div>Current Window Panel</div>;
});

jest.mock('../app/fullpage/FPSessionPanel', () => function MockFPSessionPanel({ sessionCollection }) {
    return <div>{sessionCollection.name}</div>;
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
    listKey: 'layout-session-test',
};

const renderWithStore = (navigation = 'sessions') => {
    const store = createStore();
    store.set(sidebarNavigationState, navigation);
    store.set(detailPanelOpenState, false);
    store.set(selectedSessionEntryKeyState, null);
    store.set(currentWindowsState, []);
    store.set(browserSessionsState, []);

    const view = render(
        <Provider store={store}>
            <FPLayout {...baseProps} />
        </Provider>,
    );

    return { store, ...view };
};

describe('FPLayout browser sessions panel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.sessions.getRecentlyClosed.mockResolvedValue([
            {
                lastModified: 1710000000,
                window: {
                    sessionId: 'window-session-1',
                    tabs: [
                        {
                            sessionId: 'tab-session-1',
                            title: 'Saved Window Tab',
                            url: 'https://example.com',
                        },
                        {
                            sessionId: 'tab-session-2',
                            title: 'Saved Window Tab Two',
                            url: 'https://example.com/two',
                        },
                    ],
                },
            },
        ]);
    });

    test('loads browser sessions and opens the dedicated session panel', async () => {
        const { store } = renderWithStore();

        await waitFor(() => {
            expect(screen.getByTestId('session-count')).toHaveTextContent('1');
        });

        await act(async () => {
            screen.getByText('Select Session').click();
        });

        expect(store.get(selectedSessionEntryKeyState)).toBe('window:window-session-1');
        expect(screen.getAllByText('Recently closed window')).toHaveLength(2);
    });

    test('refreshes browser sessions when the native sessions API changes', async () => {
        renderWithStore();

        await waitFor(() => {
            expect(screen.getByTestId('session-count')).toHaveTextContent('1');
        });

        browser.sessions.getRecentlyClosed.mockResolvedValue([
            {
                lastModified: 1710000100,
                tab: {
                    sessionId: 'tab-session-2',
                    title: 'Closed Tab',
                    url: 'https://openai.com',
                },
            },
        ]);

        await act(async () => {
            browser.sessions.onChanged.trigger();
        });

        await waitFor(() => {
            expect(screen.getByText('Closed Tab')).toBeInTheDocument();
        });
    });

    test('redirects stale recent navigation back to all', async () => {
        const { store } = renderWithStore('recent');

        await waitFor(() => {
            expect(store.get(sidebarNavigationState)).toBe('all');
        });
    });
});
