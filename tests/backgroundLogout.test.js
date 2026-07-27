// Sign-out must clear the cached Pro entitlement (and pending-checkout flag)
// along with the google* auth keys — otherwise a brand-new account signed in
// after sign-out inherits the previous user's Pro entitlement for up to
// 24h + 72h grace (the isEntitled() window is time-based only).

const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background logout handler', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        browser = createBrowserHarness({
            localData: {
                googleUser: { permissionId: 'user-A', emailAddress: 'a@b.c' },
                googleToken: 'access-token',
                googleRefreshToken: 'refresh-token',
                tokenExpiryTime: Date.now() + 3600_000,
                syncAuthError: false,
                premiumEntitlement: {
                    entitled: true, status: 'active', plan: 'monthly',
                    refreshedAt: new Date().toISOString(), ownerId: 'user-A',
                },
                proCheckoutPendingUntil: Date.now() + 60_000,
            },
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.getAuthToken = jest.fn(async () => 'access-token');
        global.teardownPushSubscription = jest.fn(async () => undefined);
        global.logSyncOperation = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.getAuthToken;
        delete global.teardownPushSubscription;
        delete global.logSyncOperation;
    });

    test('logout removes the cached Pro entitlement and pending-checkout flag with the auth keys', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'logout' });

        expect(result).toBe(true);
        const data = browser.storage.local._data;
        expect(data.googleUser).toBeUndefined();
        expect(data.googleToken).toBeUndefined();
        expect(data.googleRefreshToken).toBeUndefined();
        expect(data.premiumEntitlement).toBeUndefined();
        expect(data.proCheckoutPendingUntil).toBeUndefined();
    });
});
