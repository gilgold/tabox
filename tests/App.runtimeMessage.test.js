const { render, waitFor, cleanup } = require('@testing-library/react');
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

jest.mock('../app/Header', () => () => null);
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

const isThenable = (value) => value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';

describe('App runtime.onMessage listener', () => {
    let browser;

    beforeEach(() => {
        cleanup();
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    const renderApp = async () => {
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
            expect(browser.runtime.onMessage._listeners.size).toBeGreaterThan(0);
        });

        return [...browser.runtime.onMessage._listeners];
    };

    // Regression: a page-side listener must NOT claim the response channel for
    // messages it does not handle. webextension-polyfill treats any returned
    // Promise as "I will respond" and sends `undefined`. When a full-page tab is
    // open while importing from the popup, that stray `undefined` wins the race
    // against the background's real response, so the import resolves to `null`.
    test('does not return a thenable for messages it does not handle', async () => {
        const listeners = await renderApp();

        for (const listener of listeners) {
            const result = listener({ type: 'importData', data: { type: 'folder' } });
            expect(isThenable(result)).toBe(false);
            expect(result).toBeUndefined();
        }
    });
});
