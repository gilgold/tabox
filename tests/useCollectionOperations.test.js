import { act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from './helpers/renderWithProviders';

jest.mock('../app/utils', () => ({
    downloadTextFile: jest.fn(),
    getCurrentTabsAndGroups: jest.fn(),
    generateCopyName: jest.fn(),
    applyUid: jest.fn((value) => value),
}));

jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
    showInfoToast: jest.fn(),
}));

jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
    deleteSingleCollection: jest.fn(),
    updateFolderCollectionCount: jest.fn(),
}));

const { browser } = require('../static/globals');
const utils = require('../app/utils');
const toastHelpers = require('../app/toastHelpers');
const storageUtils = require('../app/utils/storageUtils');
const {
    useCollectionOperations,
    openCollectionTabs,
} = require('../app/useCollectionOperations');

let latestOperations;

function HookHarness(props) {
    latestOperations = useCollectionOperations(props);
    return null;
}

describe('useCollectionOperations', () => {
    const collection = {
        uid: 'collection-1',
        name: 'Collection One',
        color: 'blue',
        createdOn: 100,
        parentId: 'folder-1',
        tabs: [{ uid: 'tab-1', url: 'https://example.com' }],
        chromeGroups: [],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        browser.windows.get = browser.windows.get || jest.fn();
        browser.windows.create = browser.windows.create || jest.fn();
        browser.windows.getCurrent = browser.windows.getCurrent || jest.fn();
        browser.tabs.query = browser.tabs.query || jest.fn();

        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.runtime.sendMessage.mockReset();
        browser.windows.create.mockReset();
        browser.windows.getCurrent.mockReset();
        browser.windows.get.mockReset();
        browser.tabs.query.mockReset();
        browser.system = {
            display: {
                getInfo: jest.fn(async () => [
                    { bounds: { left: 0, top: 0, width: 1920, height: 1080 } },
                ]),
            },
        };

        storageUtils.loadAllCollections.mockResolvedValue([{ uid: 'previous' }]);
        storageUtils.deleteSingleCollection.mockResolvedValue(true);
        storageUtils.updateFolderCollectionCount.mockResolvedValue(true);

        utils.getCurrentTabsAndGroups.mockResolvedValue({
            name: 'Collection One',
            tabs: [{ uid: 'tab-new', url: 'https://openai.com' }],
            chromeGroups: [],
        });
        utils.generateCopyName.mockReturnValue('Collection One (copy)');
        utils.applyUid.mockImplementation((value) => ({
            ...value,
            uid: 'collection-copy',
        }));

        browser.windows.getCurrent.mockResolvedValue({ id: 77, tabs: [] });
        browser.windows.get.mockResolvedValue({ id: 77 });
        browser.windows.create.mockResolvedValue({ id: 99, tabs: [{ id: 1, url: 'about:blank' }] });
        browser.tabs.query.mockResolvedValue([{ id: 1, url: 'about:blank' }]);
        browser.storage.local.get.mockResolvedValue({ collectionsToTrack: [] });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('opens a collection in the current window; lastOpened is stamped by the background', async () => {
        browser.storage.local.get.mockResolvedValue({ chkOpenNewWindow: false });
        browser.runtime.sendMessage.mockResolvedValue({ ok: true });
        const updateCollection = jest.fn(async () => true);

        const result = await openCollectionTabs({
            collectionToOpen: collection,
            updateCollection,
        });

        expect(result).toEqual({ ok: true });
        expect(browser.windows.getCurrent).toHaveBeenCalledWith({
            populate: true,
            windowTypes: ['normal'],
        });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'openTabs',
            collection,
            newWindow: false,
        }));
        // `lastOpened` is stamped background-side (background openTabs handler,
        // see tests/backgroundOpenTabsLastOpened.test.js) - the popup no longer
        // bumps it itself, so the frontend `updateCollection` is not called here.
        expect(updateCollection).not.toHaveBeenCalled();
    });

    test('sends createWindowSpec (not a pre-created window) for the new-window path, so a window-stealing focus event on Firefox cannot orphan it', async () => {
        browser.storage.local.get.mockResolvedValue({ chkOpenNewWindow: true });
        browser.runtime.sendMessage.mockResolvedValue({ ok: true });

        await openCollectionTabs({
            collectionToOpen: collection,
            updateCollection: jest.fn(async () => true),
        });

        // The popup must never call windows.create itself for the new-window path -
        // that create+focus call is what tears the popup down on Firefox before it
        // can send the openTabs message. Window creation now happens in the
        // background, driven by the createWindowSpec below.
        expect(browser.windows.create).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'openTabs',
            collection,
            newWindow: true,
            createWindowSpec: expect.objectContaining({ focused: true }),
        }));
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ window: expect.anything() }),
        );
    });

    test('falls back from incognito window creation and shows informational toasts (fallback now happens in the background)', async () => {
        browser.storage.local.get.mockResolvedValue({ chkOpenNewWindow: true });
        browser.runtime.sendMessage
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({
                wasFromIncognito: true,
                restoredToIncognito: false,
                isIncognitoWindow: false,
                skippedForIncognito: 2,
            });

        await openCollectionTabs({
            collectionToOpen: {
                ...collection,
                savedFromIncognito: true,
            },
            updateCollection: jest.fn(async () => true),
        });

        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, { type: 'checkIncognitoAccess' });
        // The popup itself no longer touches windows.create for the new-window
        // path - it just tells the background to try incognito via
        // createWindowSpec.incognito. The actual create-with-fallback (and its
        // console.warn) is exercised by the background test suite - see
        // tests/backgroundOpenTabsCreateWindowSpec.test.js.
        expect(browser.windows.create).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
            type: 'openTabs',
            createWindowSpec: expect.objectContaining({ incognito: true }),
        }));
        expect(toastHelpers.showInfoToast).toHaveBeenCalledWith(
            expect.stringContaining('Opened in normal window'),
            4000,
        );
        expect(toastHelpers.showInfoToast).toHaveBeenCalledWith('2 tab(s) skipped - not allowed in incognito', 4000);
    });

    test('deletes a collection, updates folder counts, and wires undo data', async () => {
        const updateRemoteData = jest.fn(async () => true);
        const onDataUpdate = jest.fn(async () => true);
        const setDeletingCollectionUids = jest.fn((updater) => updater(new Set()));

        storageUtils.loadAllCollections
            .mockResolvedValueOnce([{ uid: 'before-delete' }])
            .mockResolvedValueOnce([{ uid: 'after-delete' }]);

        renderWithProviders(
            <HookHarness
                collection={collection}
                updateCollection={jest.fn(async () => true)}
                updateRemoteData={updateRemoteData}
                setDeletingCollectionUids={setDeletingCollectionUids}
                onDataUpdate={onDataUpdate}
            />,
        );

        await act(async () => {
            await latestOperations._handleDelete();
        });
        await act(async () => {
            jest.advanceTimersByTime(450);
        });

        expect(storageUtils.deleteSingleCollection).toHaveBeenCalledWith('collection-1');
        expect(storageUtils.updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
        expect(updateRemoteData).toHaveBeenCalledWith([{ uid: 'after-delete' }]);
        expect(toastHelpers.showUndoToast).toHaveBeenCalledWith(
            expect.anything(),
            'Collection deleted successfully',
            'Collection One',
            expect.any(Function),
            10,
        );
    });

    test('duplicates a collection into the same folder and refreshes counts', async () => {
        const addCollection = jest.fn(async () => true);
        const onDataUpdate = jest.fn(async () => true);

        storageUtils.loadAllCollections.mockResolvedValue([
            collection,
            { uid: 'collection-2', name: 'Other Collection' },
        ]);

        renderWithProviders(
            <HookHarness
                collection={collection}
                addCollection={addCollection}
                updateCollection={jest.fn(async () => true)}
                updateRemoteData={jest.fn(async () => true)}
                onDataUpdate={onDataUpdate}
            />,
        );

        await act(async () => {
            await latestOperations._handleDuplicate();
        });

        expect(utils.generateCopyName).toHaveBeenCalledWith('Collection One', expect.any(Array));
        expect(addCollection).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-copy',
            name: 'Collection One (copy)',
            parentId: 'folder-1',
        }));
        expect(storageUtils.updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
    });

    test('updates a collection from current tabs and links it to the current window when manual linking is enabled', async () => {
        const updateCollection = jest.fn(async () => true);
        const updateRemoteData = jest.fn(async () => true);
        const setIsAutoUpdate = jest.fn();

        browser.storage.local.get.mockImplementation(async (key) => {
            if (key === 'chkEnableAutoUpdate') {
                return { chkEnableAutoUpdate: true };
            }
            if (key === 'chkManualUpdateLinkCollection') {
                return { chkManualUpdateLinkCollection: true };
            }
            if (key === 'collectionsToTrack') {
                return { collectionsToTrack: [] };
            }
            return {};
        });

        renderWithProviders(
            <HookHarness
                collection={collection}
                updateCollection={updateCollection}
                updateRemoteData={updateRemoteData}
                setIsAutoUpdate={setIsAutoUpdate}
            />,
        );

        await act(async () => {
            await latestOperations._handleUpdate();
        });

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'trackCollection', collectionUid: 'collection-1', windowId: 77 });
        expect(setIsAutoUpdate).toHaveBeenCalledWith(true);
        expect(updateCollection).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-1',
            createdOn: 100,
            parentId: 'folder-1',
            tabs: [{ uid: 'tab-new', url: 'https://openai.com' }],
        }), true);
        expect(toastHelpers.showUndoToast).toHaveBeenCalledWith(
            expect.anything(),
            'Collection updated and linked to window successfully',
            'Collection One',
            expect.any(Function),
            10,
        );
    });

    test('focuses the tracked window and records lastOpened', async () => {
        const updateCollection = jest.fn(async () => true);
        browser.storage.local.get.mockResolvedValue({
            collectionsToTrack: [{ collectionUid: 'collection-1', windowId: 88 }],
        });
        // The tracked window still holds one of the collection's tabs, so the
        // staleness guard (issue #90) lets the focus path proceed.
        browser.windows.get.mockResolvedValue({
            id: 88,
            tabs: [{ id: 5, url: 'https://example.com' }],
        });

        renderWithProviders(
            <HookHarness
                collection={collection}
                updateCollection={updateCollection}
            />,
        );

        await act(async () => {
            await latestOperations._handleFocusWindow();
        });

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'focusWindow',
            windowId: 88,
        });
        expect(updateCollection).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-1',
            lastOpened: expect.any(Number),
        }));
    });

    test('reopens instead of focusing when the tracked window no longer holds the collection tabs (issue #90)', async () => {
        const updateCollection = jest.fn(async () => true);
        browser.storage.local.get.mockResolvedValue({
            collectionsToTrack: [{ collectionUid: 'collection-1', windowId: 88 }],
        });
        // Tracked window still exists but the collection's tabs were all closed.
        browser.windows.get.mockResolvedValue({ id: 88, tabs: [{ id: 5, url: 'chrome://newtab/' }] });
        browser.runtime.sendMessage.mockResolvedValue({ ok: true });

        renderWithProviders(
            <HookHarness
                collection={collection}
                updateCollection={updateCollection}
            />,
        );

        await act(async () => {
            await latestOperations._handleFocusWindow();
        });

        // The stale tracking entry is dropped...
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'stopTrackingCollection', collectionUid: 'collection-1' });
        // ...and the collection actually opens instead of a silent focus no-op.
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'openTabs',
            collection: expect.objectContaining({ uid: 'collection-1' }),
        }));
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            type: 'focusWindow',
        }));
    });

    test('delegates stop intent to the background, including quarantined candidates', async () => {
        const setIsAutoUpdate = jest.fn();
        browser.storage.local.get.mockResolvedValue({ collectionsToTrack: [{ collectionUid: 'collection-2', windowId: 99 }] });

        renderWithProviders(
            <HookHarness
                collection={collection}
                setIsAutoUpdate={setIsAutoUpdate}
            />,
        );

        await act(async () => {
            await latestOperations._handleStopTracking();
        });

        expect(setIsAutoUpdate).toHaveBeenCalledWith(false);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'stopTrackingCollection', collectionUid: 'collection-1' });
        await expect(latestOperations._isAutoUpdate()).resolves.toBe(false);
    });
});
