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
    const { lastSyncTimeState } = require('../app/atoms/globalAppSettingsState');

    return function MockHeader() {
        const lastSyncTime = useAtomValue(lastSyncTimeState);
        return <div data-testid="last-sync">{String(lastSyncTime)}</div>;
    };
});

jest.mock('../app/AddNewTextbox', () => () => null);
jest.mock('../app/CollectionList', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/fullpage/FPLayout', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const App = require('../app/App').default;

describe('App sync timestamp state', () => {
    let browser;

    beforeEach(() => {
        cleanup();
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3,
                lastSuccessfulSyncTime: 1111
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    test('loads and updates last sync time from persistent storage', async () => {
        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('last-sync')).toHaveTextContent('1111');
        });

        await act(async () => {
            await browser.storage.local.set({
                lastSuccessfulSyncTime: 2222
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('last-sync')).toHaveTextContent('2222');
        });
    });
});
