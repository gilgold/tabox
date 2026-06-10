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

    test('opens a collection in the current window and updates lastOpened', async () => {
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
        expect(updateCollection).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-1',
            lastOpened: expect.any(Number),
        }));
    });

    test('falls back from incognito window creation and shows informational toasts', async () => {
        // The fallback path intentionally warns when the incognito window fails.
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        browser.storage.local.get.mockResolvedValue({ chkOpenNewWindow: true });
        browser.runtime.sendMessage
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({
                wasFromIncognito: true,
                restoredToIncognito: false,
                isIncognitoWindow: false,
                skippedForIncognito: 2,
            });
        browser.windows.create
            .mockRejectedValueOnce(new Error('incognito blocked'))
            .mockResolvedValueOnce({ id: 88, tabs: [{ id: 2, url: 'about:blank' }] });

        await openCollectionTabs({
            collectionToOpen: {
                ...collection,
                savedFromIncognito: true,
            },
            updateCollection: jest.fn(async () => true),
        });

        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, { type: 'checkIncognitoAccess' });
        expect(browser.windows.create).toHaveBeenCalledTimes(2);
        expect(toastHelpers.showInfoToast).toHaveBeenCalledWith(
            expect.stringContaining('Opened in normal window'),
            4000,
        );
        expect(toastHelpers.showInfoToast).toHaveBeenCalledWith('2 tab(s) skipped - not allowed in incognito', 4000);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Failed to create incognito window'),
            expect.any(Error),
        );
        warnSpy.mockRestore();
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

        expect(browser.storage.local.set).toHaveBeenCalledWith({
            collectionsToTrack: [{ collectionUid: 'collection-1', windowId: 77 }],
        });
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

    test('stops tracking only when the collection is currently auto-updated', async () => {
        const setIsAutoUpdate = jest.fn();
        browser.storage.local.get
            .mockResolvedValueOnce({
                collectionsToTrack: [
                    { collectionUid: 'collection-1', windowId: 88 },
                    { collectionUid: 'collection-2', windowId: 99 },
                ],
            })
            .mockResolvedValueOnce({
                collectionsToTrack: [{ collectionUid: 'collection-2', windowId: 99 }],
            });

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
        expect(browser.storage.local.set).toHaveBeenCalledWith({
            collectionsToTrack: [{ collectionUid: 'collection-2', windowId: 99 }],
        });
        await expect(latestOperations._isAutoUpdate()).resolves.toBe(false);
    });
});
