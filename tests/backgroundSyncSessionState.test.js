const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background shared sync session state', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness({
            localData: {
                googleRefreshToken: 'refresh-token'
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.getAuthToken = jest.fn(async () => false);
        global.syncData = jest.fn(async () => true);
        global.logSyncOperation = jest.fn();
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.logSyncOperation;
    });

    test('keeps refresh-token-backed sessions enabled even when googleUser is temporarily missing', async () => {
        require('../chrome/background.js');

        const response = await browser.runtime.sendMessage({ type: 'checkSyncStatus' });

        expect(response).toEqual(expect.objectContaining({
            syncStatus: 'auth_refreshing'
        }));
        expect(browser.storage.local._data.syncSessionState).toEqual(expect.objectContaining({
            isEnabled: true,
            status: 'auth_refreshing',
            hasRefreshToken: true
        }));
    });
});
