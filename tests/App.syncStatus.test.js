const React = require('react');
const { render, screen, waitFor, cleanup, act } = require('@testing-library/react');
require('@testing-library/jest-dom');
const { Provider, createStore } = require('jotai');

const { createBrowserHarness } = require('./helpers/browserHarness');

const mockBrowserProxy = new Proxy({}, {
    get(_target, property) {
        return global.browser?.[property];
    }
});

jest.mock('../static/globals', () => ({
    browser: mockBrowserProxy
}));

jest.mock('../app/Header', () => {
    const React = require('react');
    const { useAtomValue } = require('jotai');
    const { isLoggedInState } = require('../app/atoms/globalAppSettingsState');

    return function MockHeader() {
        const isLoggedIn = useAtomValue(isLoggedInState);
        return <div data-testid="sync-enabled">{String(isLoggedIn)}</div>;
    };
});

jest.mock('../app/AddNewTextbox', () => () => null);
jest.mock('../app/CollectionList', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/fullpage/FPLayout', () => {
    const React = require('react');
    const { useAtomValue } = require('jotai');
    const { isLoggedInState } = require('../app/atoms/globalAppSettingsState');

    return function MockFPLayout() {
        const isLoggedIn = useAtomValue(isLoggedInState);
        return <div data-testid="sync-enabled">{String(isLoggedIn)}</div>;
    };
});
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const App = require('../app/App').default;

describe('App sync status state', () => {
    let browser;

    beforeEach(() => {
        cleanup();
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    test('treats an existing refresh token as cached sync enabled state in the popup', async () => {
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3,
                googleRefreshToken: 'refresh-token'
            },
            runtimeSendMessageImpl: async (message) => {
                if (message?.type === 'checkSyncStatus') {
                    return { syncStatus: 'auth_refreshing' };
                }

                return undefined;
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('sync-enabled')).toHaveTextContent('true');
        });
    });

    test('updates sync enabled state when stored sync credentials change', async () => {
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('sync-enabled')).toHaveTextContent('false');
        });

        await act(async () => {
            await browser.storage.local.set({
                googleRefreshToken: 'refresh-token'
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('sync-enabled')).toHaveTextContent('true');
        });
    });

    test('hydrates sync enabled state from the shared syncSessionState snapshot', async () => {
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3,
                syncSessionState: {
                    isEnabled: true,
                    status: 'auth_refreshing',
                    user: null,
                    hasRefreshToken: true,
                    error: null,
                    lastCheckedAt: 1234
                }
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('sync-enabled')).toHaveTextContent('true');
        });
    });

    test('popup and full-page views both react to shared syncSessionState storage updates', async () => {
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3,
                syncSessionState: {
                    isEnabled: false,
                    status: 'disabled',
                    user: null,
                    hasRefreshToken: false,
                    error: null,
                    lastCheckedAt: 1234
                }
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );
        render(
            <Provider store={createStore()}>
                <App mode="fullpage" />
            </Provider>
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('sync-enabled')).toHaveLength(2);
        });
        expect(screen.getAllByTestId('sync-enabled').map((node) => node.textContent)).toEqual(['false', 'false']);

        await act(async () => {
            await browser.storage.local.set({
                syncSessionState: {
                    isEnabled: true,
                    status: 'active',
                    user: { displayName: 'Test User' },
                    hasRefreshToken: true,
                    error: null,
                    lastCheckedAt: 2345
                }
            });
        });

        await waitFor(() => {
            expect(screen.getAllByTestId('sync-enabled').map((node) => node.textContent)).toEqual(['true', 'true']);
        });
    });
});
