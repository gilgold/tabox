// Task 5: push-driven shared sync with adaptive fallback polling.
// When web push (chrome/push-client.js) is healthy it delivers change
// tickles, so the periodic poll relaxes to a slow safety net
// (SHARED_SYNC_FALLBACK_PERIOD_MINUTES); without a healthy push subscription
// the poll stays the 1-minute cadence that IS the sync mechanism.
const { createBrowserHarness } = require('./helpers/browserHarness');

describe('shared sync adaptive alarm + push wiring', () => {
    let browser;
    let addEventListenerSpy;

    beforeEach(() => {
        jest.resetModules();

        browser = createBrowserHarness({
            localData: {
                googleUser: { displayName: 'Test User' },
                googleRefreshToken: 'refresh-token'
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.getAuthToken = jest.fn(async () => 'token-123');
        global.syncData = jest.fn(async () => true);
        global.logSyncOperation = jest.fn();
        // push-client.js and shared-folders.js are loaded via importScripts,
        // mocked as a no-op above - stub the bare identifiers directly,
        // mirroring tests/backgroundSharedFolderPushDebounce.test.js.
        global.syncSharedFolders = jest.fn(async () => ({ ok: true, data: { pulled: 0, pushed: 0, revoked: 0 } }));
        global.isPushHealthy = jest.fn(async () => false);
        global.ensurePushSubscription = jest.fn(async () => true);
        global.teardownPushSubscription = jest.fn(async () => undefined);
        global.handleContextMenuCreation = jest.fn(async () => {});

        addEventListenerSpy = jest.spyOn(self, 'addEventListener');
    });

    afterEach(() => {
        addEventListenerSpy.mockRestore();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.logSyncOperation;
        delete global.syncSharedFolders;
        delete global.isPushHealthy;
        delete global.ensurePushSubscription;
        delete global.teardownPushSubscription;
        delete global.handleContextMenuCreation;
    });

    function getListener(eventName) {
        const call = addEventListenerSpy.mock.calls.find(([name]) => name === eventName);
        return call && call[1];
    }

    describe('desiredSharedSyncPeriod (adaptive period)', () => {
        test('healthy push: shared sync alarm created with the 60-minute fallback period', async () => {
            global.isPushHealthy = jest.fn(async () => true);
            require('../chrome/background.js');

            await browser.runtime.onStartup.trigger();

            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ delayInMinutes: 60, periodInMinutes: 60 })
            );
        });

        test('unhealthy push: shared sync alarm created with the 1-minute period', async () => {
            global.isPushHealthy = jest.fn(async () => false);
            require('../chrome/background.js');

            await browser.runtime.onStartup.trigger();

            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ delayInMinutes: 1, periodInMinutes: 1 })
            );
        });

        test('absent push state: falls back to the 1-minute period byte-identically to push-less clients', async () => {
            global.isPushHealthy = jest.fn(async () => false); // no push_subscription_state stored yet
            require('../chrome/background.js');

            await browser.runtime.onStartup.trigger();

            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ delayInMinutes: 1, periodInMinutes: 1 })
            );
        });
    });

    describe('alarm recreation', () => {
        test('existing 1-minute alarm + healthy push: clears then recreates at 60 minutes', async () => {
            browser.alarms.create('shared-folders-sync', { delayInMinutes: 1, periodInMinutes: 1 });
            browser.alarms.create.mockClear();
            global.isPushHealthy = jest.fn(async () => true);

            require('../chrome/background.js');
            await browser.runtime.onStartup.trigger();

            expect(browser.alarms.clear).toHaveBeenCalledWith('shared-folders-sync');
            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ periodInMinutes: 60 })
            );
        });

        test('existing 60-minute alarm + healthy push: left untouched', async () => {
            browser.alarms.create('shared-folders-sync', { delayInMinutes: 60, periodInMinutes: 60 });
            browser.alarms.clear.mockClear();
            browser.alarms.create.mockClear();
            global.isPushHealthy = jest.fn(async () => true);

            require('../chrome/background.js');
            await browser.runtime.onStartup.trigger();

            expect(browser.alarms.clear).not.toHaveBeenCalledWith('shared-folders-sync');
            expect(browser.alarms.create).not.toHaveBeenCalledWith('shared-folders-sync', expect.anything());
        });
    });

    describe('push event listeners (registered synchronously at SW top level)', () => {
        test('push listener is registered at require time', () => {
            require('../chrome/background.js');
            expect(typeof getListener('push')).toBe('function');
        });

        test('push event handler calls event.waitUntil(syncSharedFolders())', async () => {
            require('../chrome/background.js');
            const handler = getListener('push');
            const waitUntil = jest.fn();

            handler({ waitUntil });

            expect(waitUntil).toHaveBeenCalledTimes(1);
            await waitUntil.mock.calls[0][0];
            expect(global.syncSharedFolders).toHaveBeenCalled();
        });

        test('pushsubscriptionchange handler force-reregisters then re-evaluates the alarm', async () => {
            require('../chrome/background.js');
            const handler = getListener('pushsubscriptionchange');
            const waitUntil = jest.fn();

            handler({ waitUntil });

            expect(waitUntil).toHaveBeenCalledTimes(1);
            await waitUntil.mock.calls[0][0];
            expect(global.ensurePushSubscription).toHaveBeenCalledWith({ force: true });
        });
    });

    describe('push subscription established as part of ensureSharedSyncAlarm (login wiring)', () => {
        // ensureSharedSyncAlarm() must call ensurePushSubscription() as its
        // FIRST step, so every caller that (re)evaluates the alarm -
        // onInstalled/onStartup, interactive login, and every
        // chrome/shared-folders.js call site - also (re)establishes push.
        // These mocks simulate a real ensurePushSubscription() that flips
        // the stored healthy state, which isPushHealthy() then reads back -
        // exercising the actual call-order dependency, not just presence.
        test('subscribe succeeds: alarm lands at the 60-minute healthy period', async () => {
            let healthy = false;
            global.ensurePushSubscription = jest.fn(async () => {
                healthy = true;
                return true;
            });
            global.isPushHealthy = jest.fn(async () => healthy);

            require('../chrome/background.js');
            await browser.runtime.onStartup.trigger();

            expect(global.ensurePushSubscription).toHaveBeenCalled();
            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ delayInMinutes: 60, periodInMinutes: 60 })
            );
        });

        test('subscribe fails: alarm lands at the 1-minute fallback period', async () => {
            let healthy = false;
            global.ensurePushSubscription = jest.fn(async () => {
                healthy = false;
                return false;
            });
            global.isPushHealthy = jest.fn(async () => healthy);

            require('../chrome/background.js');
            await browser.runtime.onStartup.trigger();

            expect(global.ensurePushSubscription).toHaveBeenCalled();
            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ delayInMinutes: 1, periodInMinutes: 1 })
            );
        });

        test('interactive login (request.type === "login") ends up establishing the push subscription', async () => {
            let healthy = false;
            global.ensurePushSubscription = jest.fn(async () => {
                healthy = true;
                return true;
            });
            global.isPushHealthy = jest.fn(async () => healthy);

            // Stub the background-utils.js globals the login handler needs
            // (importScripts is mocked as a no-op above).
            global.createAuthEndpoint = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth');
            global.getAuthRedirectConfig = jest.fn(() => ({ viaWorker: false }));
            global.getTokens = jest.fn(async () => 'token-123');
            global.getOrCreateSyncFile = jest.fn(async () => 'file-123');
            global.getGoogleUser = jest.fn(async () => ({ displayName: 'Test User', email: 'a@x.com' }));
            global.loadAllCollectionsBG = jest.fn(async () => []);
            global.ensureBackgroundSyncAlarm = jest.fn(async () => {});
            global.SYNC_SESSION_STATUS = {
                SYNCING: 'syncing', ACTIVE: 'active', ERROR: 'error', USER_INFO_ERROR: 'user_info_error'
            };
            browser.identity = {
                launchWebAuthFlow: jest.fn(async () => 'https://redirect.example.com/?code=abc')
            };

            require('../chrome/background.js');
            const result = await browser.runtime.sendMessage({ type: 'login' });

            expect(result).toEqual({ displayName: 'Test User', email: 'a@x.com' });
            expect(global.ensurePushSubscription).toHaveBeenCalled();
            expect(browser.alarms.create).toHaveBeenCalledWith(
                'shared-folders-sync',
                expect.objectContaining({ periodInMinutes: 60 })
            );

            delete global.createAuthEndpoint;
            delete global.getAuthRedirectConfig;
            delete global.getTokens;
            delete global.getOrCreateSyncFile;
            delete global.getGoogleUser;
            delete global.loadAllCollectionsBG;
            delete global.ensureBackgroundSyncAlarm;
            delete global.SYNC_SESSION_STATUS;
        });
    });

    describe('sign-in/sign-out lifecycle wiring', () => {
        test('onStartup ensures the push subscription before (re)evaluating the shared sync alarm', async () => {
            require('../chrome/background.js');

            await browser.runtime.onStartup.trigger();

            expect(global.ensurePushSubscription).toHaveBeenCalled();
            expect(browser.alarms.create).toHaveBeenCalledWith('shared-folders-sync', expect.anything());
        });

        test('onInstalled ensures the push subscription before (re)evaluating the shared sync alarm', async () => {
            require('../chrome/background.js');

            await browser.runtime.onInstalled.trigger({ reason: 'install' });

            expect(global.ensurePushSubscription).toHaveBeenCalled();
            expect(browser.alarms.create).toHaveBeenCalledWith('shared-folders-sync', expect.anything());
        });

        test('signing out tears down the push subscription', async () => {
            require('../chrome/background.js');

            await browser.runtime.sendMessage({ type: 'logout' });

            expect(global.teardownPushSubscription).toHaveBeenCalled();
        });
    });
});
