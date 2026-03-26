const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background sync safety follow-ups', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        browser = createBrowserHarness({
            localData: {
                googleUser: {
                    email: 'sync@example.com'
                },
                googleRefreshToken: 'refresh-token'
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.loadAllCollectionsBG = jest.fn(async () => ([
            {
                uid: 'collection-root-a',
                name: 'Root Alpha',
                tabs: []
            }
        ]));
        global.loadSingleCollectionBG = jest.fn(async () => ({
            uid: 'collection-root-a',
            name: 'Root Alpha',
            tabs: [
                { url: 'https://alpha.example.com', title: 'Alpha' }
            ],
            chromeGroups: []
        }));
        global.updateCollection = jest.fn(async () => ({
            uid: 'collection-root-a',
            name: 'Root Alpha',
            tabs: [
                { url: 'https://alpha.example.com', title: 'Alpha' },
                { url: 'https://alpha.example.com/new', title: 'Alpha New' }
            ],
            chromeGroups: []
        }));
        global.saveSingleCollectionBG = jest.fn(async () => true);
        global.getAuthToken = jest.fn(async () => 'token-123');
        global.syncData = jest.fn(async () => true);
        global.updateRemote = jest.fn(async () => true);
        global.updateLocalDataFromServer = jest.fn(async () => []);
        global.logSyncOperation = jest.fn();
        global.handleContextMenuCreation = jest.fn(async () => {});
        global.cleanupLargeBackups = jest.fn(async () => {});
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.loadAllCollectionsBG;
        delete global.loadSingleCollectionBG;
        delete global.updateCollection;
        delete global.saveSingleCollectionBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.updateRemote;
        delete global.updateLocalDataFromServer;
        delete global.logSyncOperation;
        delete global.handleContextMenuCreation;
        delete global.cleanupLargeBackups;
    });

    test('updateRemote runtime message reconciles through syncData instead of blindly uploading', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'updateRemote' });

        expect(result).toBe(true);
        expect(global.syncData).toHaveBeenCalledWith('token-123');
        expect(global.updateRemote).not.toHaveBeenCalled();
        expect(browser.storage.local._data.syncSessionState).toEqual(expect.objectContaining({
            status: 'active',
            isEnabled: true,
            hasRefreshToken: true
        }));
    });

    test('debounced auto-update window events use the same merge-safe syncData path', async () => {
        browser.storage.local._data.chkEnableAutoUpdate = true;
        browser.storage.local._data.collectionsToTrack = [
            {
                windowId: 1,
                collectionUid: 'collection-root-a'
            }
        ];

        require('../chrome/background.js');

        await browser.tabs.onCreated.trigger({ id: 10, windowId: 1 });
        await jest.runAllTimersAsync();

        expect(global.saveSingleCollectionBG).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'collection-root-a',
            lastUpdated: expect.any(Number)
        }), true);
        expect(global.syncData).toHaveBeenCalledWith('token-123');
        expect(global.updateRemote).not.toHaveBeenCalled();
    });

    test('loadFromServer failure does not push local data back to remote even when local collections exist', async () => {
        global.updateLocalDataFromServer = jest.fn(async () => false);

        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'loadFromServer' });

        expect(result).toBe(false);
        expect(global.updateLocalDataFromServer).toHaveBeenCalledWith('token-123', undefined);
        expect(global.syncData).not.toHaveBeenCalled();
        expect(global.updateRemote).not.toHaveBeenCalled();
        expect(browser.storage.local._data.syncSessionState).toEqual(expect.objectContaining({
            status: 'error',
            isEnabled: true,
            hasRefreshToken: true
        }));
    });
});
