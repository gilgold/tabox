/**
 * Fix round 2 (task-13-report.md "## Review round 2"): the command palette's
 * "Delete" and "Move to Folder -> Root" actions in App.js's cmdCollectionAction
 * called deleteSingleCollection / removeCollectionFromFolder directly with no
 * permission guard, so Ctrl/Cmd+K on a collection inside a read-only shared
 * folder could silently delete it or pull it out of the shared folder.
 *
 * This renders the real App component (mirroring the pattern in
 * tests/App.commandPaletteOpen.test.js) with a read-only shared folder and a
 * collection inside it, then invokes the real cmdCollectionAction handler
 * exposed by a mocked CommandPalette to prove both actions are now blocked.
 */

const { render, act, cleanup, waitFor } = require('@testing-library/react');
require('@testing-library/jest-dom');
const { Provider, createStore } = require('jotai');

const { createBrowserHarness } = require('./helpers/browserHarness');
const { noPermissionOpenState } = require('../app/atoms/sharedFoldersState');

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
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

let latestOnCollectionAction = null;
let latestFolders = null;
jest.mock('../app/CommandPalette', () => {
    return function MockCommandPalette({ onCollectionAction, folders }) {
        latestOnCollectionAction = onCollectionAction;
        latestFolders = folders;
        return null;
    };
});

jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    deleteSingleCollection: jest.fn(),
}));

jest.mock('../app/utils/folderOperations', () => ({
    ...jest.requireActual('../app/utils/folderOperations'),
    removeCollectionFromFolder: jest.fn(),
}));

const storageUtils = require('../app/utils/storageUtils');
const folderOperations = require('../app/utils/folderOperations');
const App = require('../app/App').default;

const READ_ONLY_FOLDER = { name: 'Research', order: 0, shared: { folderId: 'folder-1', role: 'read' } };
const SHARED_COLLECTION = {
    uid: 'collection-1',
    name: 'Shared collection',
    tabs: [],
    chromeGroups: [],
    parentId: 'folder-1',
    order: 0,
    lastUpdated: 10,
    createdOn: 10,
};

const buildLocalData = () => ({
    tabox_storage_version: 3,
    collections_index: {
        'collection-1': { name: SHARED_COLLECTION.name, type: 'collection', parentId: 'folder-1', order: 0, lastUpdated: 10 },
    },
    'collection_collection-1': { ...SHARED_COLLECTION },
    folders_index: {
        'folder-1': { ...READ_ONLY_FOLDER },
    },
    'folder_folder-1': { uid: 'folder-1', ...READ_ONLY_FOLDER },
});

// Positive-path counterpart (round 3 test gap): a folder the user CAN edit -
// here, an unshared root folder - must not be blocked by the same guard.
const EDITABLE_FOLDER = { name: 'Personal', order: 0 };
const EDITABLE_COLLECTION = {
    uid: 'collection-2',
    name: 'Editable collection',
    tabs: [],
    chromeGroups: [],
    parentId: 'folder-2',
    order: 0,
    lastUpdated: 10,
    createdOn: 10,
};

const buildEditableLocalData = () => ({
    tabox_storage_version: 3,
    collections_index: {
        'collection-2': { name: EDITABLE_COLLECTION.name, type: 'collection', parentId: 'folder-2', order: 0, lastUpdated: 10 },
    },
    'collection_collection-2': { ...EDITABLE_COLLECTION },
    folders_index: {
        'folder-2': { ...EDITABLE_FOLDER },
    },
    'folder_folder-2': { uid: 'folder-2', ...EDITABLE_FOLDER },
});

describe('command palette delete/move guards for read-only shared folders', () => {
    let browser;

    beforeEach(() => {
        cleanup();
        latestOnCollectionAction = null;
        latestFolders = null;
        storageUtils.deleteSingleCollection.mockReset().mockResolvedValue(true);
        folderOperations.removeCollectionFromFolder.mockReset();

        browser = createBrowserHarness({ localData: buildLocalData() });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    const renderAppAndWaitForFolder = async (store) => {
        render(
            <Provider store={store}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(latestFolders).toEqual(
                expect.arrayContaining([expect.objectContaining({ uid: 'folder-1' })]),
            );
        });
    };

    test('blocks palette delete on a collection inside a read-only shared folder', async () => {
        const store = createStore();
        await renderAppAndWaitForFolder(store);

        await act(async () => {
            await latestOnCollectionAction(SHARED_COLLECTION, 'delete');
        });

        expect(storageUtils.deleteSingleCollection).not.toHaveBeenCalled();
        expect(store.get(noPermissionOpenState)).toBe(true);
    });

    test('blocks palette move-to-root from a read-only shared folder', async () => {
        const store = createStore();
        await renderAppAndWaitForFolder(store);

        await act(async () => {
            await latestOnCollectionAction(SHARED_COLLECTION, 'move', { targetFolderId: null });
        });

        expect(folderOperations.removeCollectionFromFolder).not.toHaveBeenCalled();
        expect(store.get(noPermissionOpenState)).toBe(true);
    });

    // Positive-path gap (round 3): an editable folder must NOT trip the same guard.
    test('does not block palette delete on a collection inside an editable folder', async () => {
        browser = createBrowserHarness({ localData: buildEditableLocalData() });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        const store = createStore();
        render(
            <Provider store={store}>
                <App />
            </Provider>
        );
        await waitFor(() => {
            expect(latestFolders).toEqual(
                expect.arrayContaining([expect.objectContaining({ uid: 'folder-2' })]),
            );
        });

        await act(async () => {
            await latestOnCollectionAction(EDITABLE_COLLECTION, 'delete');
        });

        expect(storageUtils.deleteSingleCollection).toHaveBeenCalledWith('collection-2');
        expect(store.get(noPermissionOpenState)).toBe(false);
    });

    test('does not block palette move-to-root from an editable folder', async () => {
        browser = createBrowserHarness({ localData: buildEditableLocalData() });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        const store = createStore();
        render(
            <Provider store={store}>
                <App />
            </Provider>
        );
        await waitFor(() => {
            expect(latestFolders).toEqual(
                expect.arrayContaining([expect.objectContaining({ uid: 'folder-2' })]),
            );
        });

        await act(async () => {
            await latestOnCollectionAction(EDITABLE_COLLECTION, 'move', { targetFolderId: null });
        });

        expect(folderOperations.removeCollectionFromFolder).toHaveBeenCalledWith('collection-2');
        expect(store.get(noPermissionOpenState)).toBe(false);
    });
});
