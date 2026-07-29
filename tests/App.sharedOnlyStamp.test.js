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

// Capture the collection-mutation callbacks App passes down so tests can
// invoke them directly (the real children are irrelevant here).
const mockCaptured = {};

jest.mock('../app/Header', () => () => null);
jest.mock('../app/AddNewTextbox', () => (props) => {
    mockCaptured.addCollection = props.addCollection;
    return null;
});
jest.mock('../app/CollectionList', () => (props) => {
    mockCaptured.updateCollection = props.updateCollection;
    mockCaptured.folders = props.folders;
    mockCaptured.collections = props.collections;
    return null;
});
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/fullpage/FPLayout', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const App = require('../app/App').default;

const SHARED_FOLDER_UID = 'shared-folder-1';
const SHARED_COLLECTION_UID = 'col-shared-1';

const sharedFolder = {
    uid: SHARED_FOLDER_UID,
    name: 'Team folder',
    color: '#4285f4',
    order: 0,
    lastUpdated: 100,
    shared: {
        folderId: 'server-folder-1',
        role: 'owner',
        ownerEmail: 'owner@example.com',
        members: []
    }
};

const plainFolder = {
    uid: 'plain-folder-1',
    name: 'Private folder',
    color: '#34a853',
    order: 1,
    lastUpdated: 100
};

const sharedCollection = {
    uid: SHARED_COLLECTION_UID,
    name: 'Shared collection',
    parentId: SHARED_FOLDER_UID,
    tabs: [],
    chromeGroups: [],
    order: 3,
    lastUpdated: 50
};

const getLocalTimestampStamps = (browser) =>
    browser.storage.local.set.mock.calls.filter(([items]) => items && 'localTimestamp' in items);

const getSharedSyncNowMessages = (browser) =>
    browser.runtime.sendMessage.mock.calls.filter(([message]) => message?.type === 'sharedSyncNow');

describe('App shared-only mutations do not stamp the Drive watermark', () => {
    let browser;

    beforeEach(() => {
        cleanup();
        mockCaptured.addCollection = undefined;
        mockCaptured.updateCollection = undefined;
        mockCaptured.folders = undefined;
        mockCaptured.collections = undefined;

        browser = createBrowserHarness({
            localData: {
                collections_index: {
                    [SHARED_COLLECTION_UID]: {
                        name: sharedCollection.name,
                        parentId: SHARED_FOLDER_UID,
                        order: 3,
                        lastUpdated: 50
                    }
                },
                folders_index: {
                    // The `shared` marker is mirrored into the index in
                    // production (markLocalFolderShared / materialize) —
                    // storage-level code keys off the index copy.
                    [SHARED_FOLDER_UID]: { name: sharedFolder.name, order: 0, lastUpdated: 100, shared: sharedFolder.shared },
                    [plainFolder.uid]: { name: plainFolder.name, order: 1, lastUpdated: 100 }
                },
                [`folder_${SHARED_FOLDER_UID}`]: sharedFolder,
                [`folder_${plainFolder.uid}`]: plainFolder,
                [`collection_${SHARED_COLLECTION_UID}`]: sharedCollection,
                tabox_storage_version: 3
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

    const renderAppAndWaitForData = async () => {
        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(mockCaptured.addCollection).toBeDefined();
            expect(mockCaptured.updateCollection).toBeDefined();
            expect(mockCaptured.folders?.length).toBe(2);
            expect(mockCaptured.collections?.length).toBe(1);
        });

        browser.storage.local.set.mockClear();
        browser.runtime.sendMessage.mockClear();
    };

    test('adding a collection into a shared folder skips localTimestamp and nudges shared sync', async () => {
        await renderAppAndWaitForData();

        await act(async () => {
            await mockCaptured.addCollection({
                uid: 'new-shared-col',
                name: 'New shared collection',
                parentId: SHARED_FOLDER_UID,
                tabs: [],
                chromeGroups: []
            });
        });

        expect(getLocalTimestampStamps(browser)).toHaveLength(0);
        expect(getSharedSyncNowMessages(browser)).toHaveLength(1);
        // Context-menu update must still be sent
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'addCollection' });
    });

    test('adding a collection into a shared folder produces syncable explicit orders for it AND shifted siblings', async () => {
        await renderAppAndWaitForData();

        await act(async () => {
            await mockCaptured.addCollection({
                uid: 'new-shared-col',
                name: 'New shared collection',
                parentId: SHARED_FOLDER_UID,
                tabs: [],
                chromeGroups: []
            });
        });

        const { 'collection_new-shared-col': saved, collections_index: index } =
            await browser.storage.local.get(['collection_new-shared-col', 'collections_index']);

        // New collection inserts first; the existing sibling shifts below it.
        expect(saved.order).toBe(0);
        expect(index[SHARED_COLLECTION_UID].order).toBe(1);
        // The shifted sibling's timestamp must move past the shared-sync
        // watermark (it was 50) or its new order never pushes to members.
        expect(index[SHARED_COLLECTION_UID].lastUpdated).toBeGreaterThan(50);
    });

    test('adding a collection with no parent still stamps localTimestamp', async () => {
        await renderAppAndWaitForData();

        await act(async () => {
            await mockCaptured.addCollection({
                uid: 'new-root-col',
                name: 'New root collection',
                parentId: null,
                tabs: [],
                chromeGroups: []
            });
        });

        expect(getLocalTimestampStamps(browser).length).toBeGreaterThan(0);
        expect(getSharedSyncNowMessages(browser)).toHaveLength(0);
    });

    test('adding a collection into a non-shared folder still stamps localTimestamp', async () => {
        await renderAppAndWaitForData();

        await act(async () => {
            await mockCaptured.addCollection({
                uid: 'new-plain-col',
                name: 'New plain collection',
                parentId: plainFolder.uid,
                tabs: [],
                chromeGroups: []
            });
        });

        expect(getLocalTimestampStamps(browser).length).toBeGreaterThan(0);
        expect(getSharedSyncNowMessages(browser)).toHaveLength(0);
    });

    test('updating a collection that stays in the same shared folder skips localTimestamp and nudges shared sync', async () => {
        await renderAppAndWaitForData();

        await act(async () => {
            await mockCaptured.updateCollection({
                ...sharedCollection,
                name: 'Renamed shared collection'
            });
        });

        expect(getLocalTimestampStamps(browser)).toHaveLength(0);
        expect(getSharedSyncNowMessages(browser)).toHaveLength(1);
    });

    test('moving a collection out of a shared folder to root still stamps localTimestamp', async () => {
        await renderAppAndWaitForData();

        await act(async () => {
            await mockCaptured.updateCollection({
                ...sharedCollection,
                parentId: null
            });
        });

        expect(getLocalTimestampStamps(browser).length).toBeGreaterThan(0);
        expect(getSharedSyncNowMessages(browser)).toHaveLength(0);
    });
});
