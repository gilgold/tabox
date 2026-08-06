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

    test('recovers to active when googleUser is missing but the refresh token still yields a token', async () => {
        const user = { displayName: 'Jane Doe', emailAddress: 'jane@example.com' };
        global.getAuthToken = jest.fn(async () => 'valid-token');
        global.getGoogleUser = jest.fn(async () => user);
        global.getOrCreateSyncFile = jest.fn(async () => true);

        require('../chrome/background.js');

        const response = await browser.runtime.sendMessage({ type: 'checkSyncStatus' });

        expect(response).toEqual(expect.objectContaining({ syncStatus: 'active' }));
        expect(global.getGoogleUser).toHaveBeenCalledWith('valid-token');
        expect(browser.storage.local._data.syncSessionState).toEqual(expect.objectContaining({
            status: 'active',
            hasRefreshToken: true,
            user
        }));

        delete global.getGoogleUser;
        delete global.getOrCreateSyncFile;
    });
});

describe('background checkSyncStatus stale auth error recovery', () => {
    let browser;
    const user = { displayName: 'Jane Doe', emailAddress: 'jane@example.com' };

    const setup = (overrides = {}) => {
        jest.resetModules();
        browser = createBrowserHarness({
            localData: {
                googleUser: user,
                googleRefreshToken: 'refresh-token',
                syncAuthError: {
                    type: 'missing_credentials',
                    message: 'Sync credentials not configured.',
                    timestamp: 1
                },
                ...overrides
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.syncData = jest.fn(async () => true);
        global.logSyncOperation = jest.fn();
        global.getGoogleUser = jest.fn(async () => user);
        global.getOrCreateSyncFile = jest.fn(async () => true);
    };

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.logSyncOperation;
        delete global.getGoogleUser;
        delete global.getOrCreateSyncFile;
    });

    test('clears a stale auth error and reports active when a token can still be obtained', async () => {
        setup();
        global.getAuthToken = jest.fn(async () => 'valid-token');

        require('../chrome/background.js');

        const response = await browser.runtime.sendMessage({ type: 'checkSyncStatus' });

        expect(response).toEqual(expect.objectContaining({ syncStatus: 'active' }));
        expect(browser.storage.local._data.syncAuthError).toBeUndefined();
    });

    test('keeps the auth error and reports auth_required when a token cannot be obtained', async () => {
        setup();
        global.getAuthToken = jest.fn(async () => false);

        require('../chrome/background.js');

        const response = await browser.runtime.sendMessage({ type: 'checkSyncStatus' });

        expect(response).toEqual(expect.objectContaining({ syncStatus: 'auth_required' }));
        expect(browser.storage.local._data.syncAuthError).toBeDefined();
    });
});
