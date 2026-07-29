// Regression: shared-folder changes pulled by the background engine only
// render live if something actually TRIGGERS a sync while a view is open.
// The full page used to be excluded from the popup's periodic `sharedSyncNow`
// nudge and relied entirely on (best-effort) web-push tickles — so an open
// full page went stale until a manual reload. Both views must now nudge the
// engine on mount and again when the view regains focus/visibility.
const { render, waitFor, cleanup, act } = require('@testing-library/react');
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

const getSharedSyncNowMessages = (browser) =>
    browser.runtime.sendMessage.mock.calls.filter(([message]) => message?.type === 'sharedSyncNow');

const signedInSessionState = {
    user: { emailAddress: 'me@example.com', displayName: 'Me' },
    hasRefreshToken: true,
    isEnabled: true,
    status: 'active',
    error: null,
    lastCheckedAt: 1
};

describe.each(['fullpage', 'popup'])('App shared sync nudge (%s view)', (mode) => {
    let browser;

    beforeEach(() => {
        cleanup();
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3,
                syncSessionState: signedInSessionState,
                googleRefreshToken: 'refresh-token'
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

    test('nudges sharedSyncNow once signed-in state is known, and again on window focus', async () => {
        render(
            <Provider store={createStore()}>
                <App mode={mode} />
            </Provider>
        );

        // checkSyncStatus is deferred (extra 1s in full-page mode) — wait for
        // the signed-in state to propagate and produce the mount-time nudge.
        await waitFor(() => {
            expect(getSharedSyncNowMessages(browser).length).toBeGreaterThanOrEqual(1);
        }, { timeout: 4000 });

        browser.runtime.sendMessage.mockClear();

        // Regaining focus (e.g. switching back to the full-page tab after
        // making changes elsewhere) must trigger a fresh nudge immediately.
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });

        await waitFor(() => {
            expect(getSharedSyncNowMessages(browser).length).toBeGreaterThanOrEqual(1);
        });
    }, 10000);
});
