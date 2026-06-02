const React = require('react');
const { render, screen, waitFor, cleanup } = require('@testing-library/react');
require('@testing-library/jest-dom');
const { Provider, createStore } = require('jotai');

const { createBrowserHarness } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot } = require('./helpers/upgradeFixtures');

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
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('../app/CollectionList', () => function MockCollectionList({ collections = [] }) {
    return (
        <div data-testid="collection-names">
            {collections.map((collection) => collection.name).join('|')}
        </div>
    );
});
jest.mock('../app/fullpage/FPLayout', () => () => null);
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const App = require('../app/App').default;

describe('App launch sync reconciliation', () => {
    let browser;

    beforeEach(() => {
        cleanup();
        const localSnapshot = createVersion40LocalSnapshot();
        localSnapshot.googleUser = {
            displayName: 'Sync User',
            emailAddress: 'sync@example.com'
        };
        localSnapshot.googleRefreshToken = 'refresh-token';

        browser = createBrowserHarness({
            localData: localSnapshot,
            runtimeSendMessageImpl: async (message, activeBrowser) => {
                if (message?.type === 'checkSyncStatus') {
                    return {
                        displayName: 'Sync User',
                        emailAddress: 'sync@example.com',
                        syncStatus: 'active'
                    };
                }

                if (message?.type === 'updateRemote') {
                    await activeBrowser.storage.local.set({
                        collections_index: {
                            ...activeBrowser.storage.local._data.collections_index,
                            'collection-root-a': {
                                ...activeBrowser.storage.local._data.collections_index['collection-root-a'],
                                name: 'Root Alpha (Remote)',
                                lastUpdated: 9999
                            }
                        },
                        'collection_collection-root-a': {
                            ...activeBrowser.storage.local._data['collection_collection-root-a'],
                            name: 'Root Alpha (Remote)',
                            lastUpdated: 9999
                        },
                        lastSuccessfulSyncTime: 9999
                    });

                    return true;
                }

                if (message?.type === 'loadFromServer') {
                    return 'no_update_needed';
                }

                return undefined;
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

    test('reconciles through the updateRemote sync path on launch and hydrates newer remote changes into the UI', async () => {
        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'checkSyncStatus' });
        });

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'updateRemote' });
        });

        await waitFor(() => {
            expect(screen.getByTestId('collection-names')).toHaveTextContent('Root Alpha (Remote)');
        });
    });
});
