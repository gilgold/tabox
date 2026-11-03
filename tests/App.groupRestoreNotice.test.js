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

jest.mock('../app/toastHelpers', () => ({
    ...jest.requireActual('../app/toastHelpers'),
    showInfoToast: jest.fn(),
}));
const { showInfoToast } = require('../app/toastHelpers');
const App = require('../app/App').default;

describe('App installs group-restore feedback in both views', () => {
    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
        jest.clearAllMocks();
    });
    test.each(['popup', 'fullpage'])('%s shows a persisted partial-open notice', async mode => {
        const browser = createBrowserHarness({ localData: {
            collections_index: {}, folders_index: {}, tabox_storage_version: 3,
            groupRestoreNoticePending: { tabsOpened: 2, groupsFailed: 1 },
        } });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        render(<Provider store={createStore()}><App mode={mode} /></Provider>);
        await waitFor(() => expect(showInfoToast).toHaveBeenCalledWith(
            'Opened 2 tabs, but 1 saved group could not be fully restored.', 10000,
        ));
        expect(browser.storage.local._data.groupRestoreNoticePending).toBeUndefined();
    });
});
