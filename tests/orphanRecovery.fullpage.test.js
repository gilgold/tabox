/** @jest-environment jsdom */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { createBrowserHarness } from './helpers/browserHarness';

const mockBrowserProxy = new Proxy({}, { get(_t, p) { return global.browser?.[p]; } });
jest.mock('../static/globals', () => ({ browser: mockBrowserProxy }));

jest.mock('../app/Header', () => () => <div>Header</div>);
jest.mock('../app/AddNewTextbox', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({ CollectionListOptions: () => null }));
jest.mock('../app/CollectionList', () => () => <div data-testid="cl" />);
jest.mock('../app/fullpage/FPLayout', () => () => <div data-testid="fp" />);
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const App = require('../app/App').default;

const renderApp = (mode) => {
    const store = createStore();
    return render(<Provider store={store}><App mode={mode} /></Provider>);
};

const seed = () => ({
    tabox_storage_version: 3,
    localTimestamp: 0,
    collections_index: {
        a: { name: 'Alpha', type: 'collection', tabCount: 1, lastUpdated: 6000, lastOpened: 6000, createdOn: 1000, color: 'default', size: 100, parentId: null, order: 0 },
    },
    collection_a: { uid: 'a', name: 'Alpha', tabs: [{ uid: 't', url: 'https://a.example.com', title: 'A' }], chromeGroups: [], color: 'default', createdOn: 1000, lastUpdated: 6000, lastOpened: 6000, parentId: null, order: 0 },
    // Orphan: record present, NOT referenced by collections_index, not tombstoned.
    collection_orphan: { uid: 'orphan', name: 'Lost Collection', tabs: [{ uid: 'tl', url: 'https://lost.example.com', title: 'Lost' }], chromeGroups: [], color: 'red', createdOn: 2000, lastUpdated: 2000, lastOpened: null, parentId: null, order: 1 },
});

describe('orphan recovery detection in full-page view', () => {
    beforeEach(() => {
        cleanup();
        const browser = createBrowserHarness({
            localData: seed(),
            runtimeSendMessageImpl: async (message) => {
                if (message?.type === 'checkSyncStatus') return false;
                if (message?.type === 'loadFromServer') return 'no_update_needed';
                return true;
            },
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

    test('the consent modal appears in full-page mode when an orphan exists', async () => {
        renderApp('fullpage');
        await waitFor(
            () => expect(screen.getByText(/We found collections we can restore/i)).toBeInTheDocument(),
            { timeout: 4000 },
        );
    });
});
