const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react');
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

jest.mock('../app/useCollectionOperations', () => ({
    openCollectionTabs: jest.fn()
}));

jest.mock('../app/Header', () => () => null);
jest.mock('../app/AddNewTextbox', () => () => null);
jest.mock('../app/CollectionList', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/fullpage/FPLayout', () => () => null);
jest.mock('../app/CommandPalette', () => {

    return function MockCommandPalette({ onCollectionAction }) {
        return (
            <button
                data-testid="command-palette-open"
                onClick={() => onCollectionAction({
                    uid: 'collection-1',
                    name: 'Wix collection',
                    tabs: [{ url: 'https://wix-bo.com' }]
                }, 'open')}
            >
                Open Collection
            </button>
        );
    };
});
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const { openCollectionTabs } = require('../app/useCollectionOperations');
const App = require('../app/App').default;

describe('App command palette open action', () => {
    let browser;

    beforeEach(() => {
        cleanup();
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        openCollectionTabs.mockResolvedValue({ success: true });
        openCollectionTabs.mockClear();
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    test('routes collection opens through shared openCollectionTabs logic', async () => {
        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        browser.windows.create.mockClear();
        browser.tabs.create.mockClear();

        fireEvent.click(screen.getByTestId('command-palette-open'));

        await waitFor(() => {
            expect(openCollectionTabs).toHaveBeenCalledWith(expect.objectContaining({
                collectionToOpen: expect.objectContaining({
                    uid: 'collection-1',
                    name: 'Wix collection'
                }),
                updateCollection: expect.any(Function)
            }));
        });

        expect(browser.windows.create).not.toHaveBeenCalled();
        expect(browser.tabs.create).not.toHaveBeenCalled();
    });
});
