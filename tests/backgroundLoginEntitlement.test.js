// Sign-out removes the cached Pro entitlement (backgroundLogout.test.js), so
// a Pro user who signs back in has no cached record — and the `cached &&`
// zero-Worker-calls guards mean nothing ever refreshes it. The login handler
// must therefore fire one refreshProEntitlement() after a successful
// interactive sign-in, so the entitled record is restored (and any open
// popup/full-page view flips to Pro via the storage.onChanged listener).

const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background login handler — Pro entitlement restore', () => {
    let browser;

    const stubLoginGlobals = () => {
        global.createAuthEndpoint = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth');
        global.getAuthRedirectConfig = jest.fn(() => ({ viaWorker: false }));
        global.getTokens = jest.fn(async () => 'token-123');
        global.getOrCreateSyncFile = jest.fn(async () => 'file-123');
        global.getGoogleUser = jest.fn(async () => ({ displayName: 'Test User', email: 'a@x.com' }));
        global.loadAllCollectionsBG = jest.fn(async () => []);
        global.ensureBackgroundSyncAlarm = jest.fn(async () => {});
        global.syncData = jest.fn(async () => true);
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.syncSharedFolders = jest.fn(async () => ({ ok: true, data: { pulled: 0, pushed: 0, revoked: 0 } }));
        global.isPushHealthy = jest.fn(async () => false);
        global.ensurePushSubscription = jest.fn(async () => true);
        global.teardownPushSubscription = jest.fn(async () => undefined);
        global.handleContextMenuCreation = jest.fn(async () => {});
        global.SYNC_SESSION_STATUS = {
            SYNCING: 'syncing', ACTIVE: 'active', ERROR: 'error', USER_INFO_ERROR: 'user_info_error'
        };
        browser.identity = {
            launchWebAuthFlow: jest.fn(async () => 'https://redirect.example.com/?code=abc')
        };
    };

    const clearLoginGlobals = () => {
        delete global.createAuthEndpoint;
        delete global.getAuthRedirectConfig;
        delete global.getTokens;
        delete global.getOrCreateSyncFile;
        delete global.getGoogleUser;
        delete global.loadAllCollectionsBG;
        delete global.ensureBackgroundSyncAlarm;
        delete global.syncData;
        delete global.loadCollectionsIndexBG;
        delete global.syncSharedFolders;
        delete global.isPushHealthy;
        delete global.ensurePushSubscription;
        delete global.teardownPushSubscription;
        delete global.handleContextMenuCreation;
        delete global.SYNC_SESSION_STATUS;
        delete global.refreshProEntitlement;
    };

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        browser = createBrowserHarness({ localData: {} });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.getAuthToken = jest.fn(async () => 'access-token');
        global.logSyncOperation = jest.fn();
        stubLoginGlobals();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        clearLoginGlobals();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.getAuthToken;
        delete global.logSyncOperation;
    });

    test('successful login refreshes the Pro entitlement (restores Pro after sign-out → sign-in)', async () => {
        global.refreshProEntitlement = jest.fn(async () => ({
            entitled: true, status: 'active', plan: 'monthly',
            refreshedAt: new Date().toISOString(),
        }));
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'login' });

        expect(result).toEqual({ displayName: 'Test User', email: 'a@x.com' });
        expect(global.refreshProEntitlement).toHaveBeenCalled();
    });

    test('a failing entitlement refresh never fails the login', async () => {
        global.refreshProEntitlement = jest.fn(async () => { throw new Error('worker down'); });
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'login' });

        expect(result).toEqual({ displayName: 'Test User', email: 'a@x.com' });
    });

    test('login still works when pro-entitlement.js is not loaded (no refreshProEntitlement global)', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'login' });

        expect(result).toEqual({ displayName: 'Test User', email: 'a@x.com' });
    });
});
