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

jest.mock('../app/Header', () => () => <div>Header</div>);
jest.mock('../app/AddNewTextbox', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('../app/CollectionList', () => function MockCollectionList({ collections = [], folders = [] }) {
    return (
        <div>
            <div data-testid="popup-collections">{collections.map((collection) => `${collection.name}:${collection.tabs?.length || 0}`).join('|')}</div>
            <div data-testid="popup-folders">{folders.map((folder) => folder.name).join('|')}</div>
        </div>
    );
});
jest.mock('../app/fullpage/FPLayout', () => function MockFPLayout({ allCollections = [], folders = [] }) {
    return (
        <div>
            <div data-testid="fullpage-collections">{allCollections.map((collection) => `${collection.name}:${collection.tabs?.length || 0}`).join('|')}</div>
            <div data-testid="fullpage-folders">{folders.map((folder) => folder.name).join('|')}</div>
        </div>
    );
});
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

// Orphan recovery is orthogonal to sync/upgrade coverage; stub it so its
// on-mount async detection doesn't read shared storage across these tests.
jest.mock('../app/useOrphanRecovery', () => ({
    __esModule: true,
    default: () => ({ orphans: [], orphanCount: 0, showModal: false, showEntry: false, busy: false, recover: () => {}, dismiss: () => {} }),
}));

const App = require('../app/App').default;

describe('4.0 upgrade compatibility - multi-device and UI coverage', () => {
    let browser;

    beforeEach(() => {
        cleanup();
        browser = createBrowserHarness({
            localData: createVersion40LocalSnapshot(),
            runtimeSendMessageImpl: async (message) => {
                if (message?.type === 'checkSyncStatus') {
                    return false;
                }

                if (message?.type === 'loadFromServer') {
                    return 'no_update_needed';
                }

                return true;
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        jest.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    const renderApp = (mode) => {
        const store = createStore();
        return render(
            <Provider store={store}>
                <App mode={mode} />
            </Provider>
        );
    };

    test('popup and full-page views load the same 4.0-upgraded collections and folders', async () => {
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
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('Root Alpha');
            expect(screen.getByTestId('popup-folders')).toHaveTextContent('Folder Alpha');
            expect(screen.getByTestId('fullpage-collections')).toHaveTextContent('Foldered One');
            expect(screen.getByTestId('fullpage-folders')).toHaveTextContent('Empty Folder');
        });
    });

    test('an already-open popup view reacts when the first upgraded collection arrives from sync', async () => {
        browser.storage.local._data = {
            collections_index: {},
            folders_index: {},
            tabox_storage_version: 3,
            localTimestamp: 0
        };

        renderApp(undefined);

        await waitFor(() => {
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('');
        });

        await browser.storage.local.set({
            collections_index: {
                'collection-root-a': {
                    name: 'Root Alpha',
                    type: 'collection',
                    tabCount: 1,
                    lastUpdated: 6000,
                    lastOpened: 6000,
                    createdOn: 1000,
                    color: 'default',
                    size: 120,
                    parentId: null,
                    order: 0
                }
            },
            'collection_collection-root-a': {
                uid: 'collection-root-a',
                name: 'Root Alpha',
                tabs: [
                    { uid: 'root-tab', url: 'https://alpha.example.com', title: 'Alpha Home' }
                ],
                chromeGroups: [],
                color: 'default',
                createdOn: 1000,
                lastUpdated: 6000,
                lastOpened: 6000,
                parentId: null,
                order: 0
            }
        });

        await waitFor(() => {
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('Root Alpha');
        });
    });

    test('an already-open full-page view reacts when an upgraded collection is deleted by sync', async () => {
        renderApp('fullpage');

        await waitFor(() => {
            expect(screen.getByTestId('fullpage-collections')).toHaveTextContent('Foldered Two');
        });

        const nextIndex = { ...browser.storage.local._data.collections_index };
        delete nextIndex['collection-folder-b'];
        await browser.storage.local.remove('collection_collection-folder-b');
        await browser.storage.local.set({
            collections_index: nextIndex
        });

        await waitFor(() => {
            expect(screen.getByTestId('fullpage-collections')).not.toHaveTextContent('Foldered Two');
        });
    });

    test('an already-open popup view reacts when upgraded tab counts change from sync', async () => {
        renderApp(undefined);

        await waitFor(() => {
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('Root Alpha:2');
        });

        await browser.storage.local.set({
            collections_index: {
                ...browser.storage.local._data.collections_index,
                'collection-root-a': {
                    ...browser.storage.local._data.collections_index['collection-root-a'],
                    tabCount: 3,
                    lastUpdated: 9600
                }
            },
            'collection_collection-root-a': {
                ...browser.storage.local._data['collection_collection-root-a'],
                lastUpdated: 9600,
                tabs: [
                    ...browser.storage.local._data['collection_collection-root-a'].tabs,
                    {
                        uid: 'root-tab-3',
                        url: 'https://alpha.example.com/extra',
                        title: 'Alpha Extra'
                    }
                ]
            }
        });

        await waitFor(() => {
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('Root Alpha:3');
        });
    });

    test('popup and full-page views both react to the same upgraded tab-level sync change while already open', async () => {
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
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('Root Alpha:2');
            expect(screen.getByTestId('fullpage-collections')).toHaveTextContent('Root Alpha:2');
        });

        await browser.storage.local.set({
            collections_index: {
                ...browser.storage.local._data.collections_index,
                'collection-root-a': {
                    ...browser.storage.local._data.collections_index['collection-root-a'],
                    tabCount: 3,
                    lastUpdated: 9700
                }
            },
            'collection_collection-root-a': {
                ...browser.storage.local._data['collection_collection-root-a'],
                lastUpdated: 9700,
                tabs: [
                    ...browser.storage.local._data['collection_collection-root-a'].tabs,
                    {
                        uid: 'root-tab-4',
                        url: 'https://alpha.example.com/live',
                        title: 'Alpha Live'
                    }
                ]
            }
        });

        await waitFor(() => {
            expect(screen.getByTestId('popup-collections')).toHaveTextContent('Root Alpha:3');
            expect(screen.getByTestId('fullpage-collections')).toHaveTextContent('Root Alpha:3');
        });
    });
});
