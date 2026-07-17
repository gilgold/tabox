const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background sync alarm', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

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
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.logSyncOperation;
    });

    test('creates a recurring background sync alarm on startup when sync is enabled', async () => {
        require('../chrome/background.js');

        await browser.runtime.onStartup.trigger();

        expect(browser.alarms.create).toHaveBeenCalledWith(
            'background-sync-alarm',
            expect.objectContaining({
                delayInMinutes: 360,
                periodInMinutes: 360
            })
        );
    });

    test('runs syncData when the background sync alarm fires', async () => {
        require('../chrome/background.js');

        await browser.alarms.onAlarm.trigger({ name: 'background-sync-alarm' });

        expect(global.getAuthToken).toHaveBeenCalled();
        expect(global.syncData).toHaveBeenCalledWith('token-123');
    });

    test('recreates an existing background sync alarm when it uses an outdated interval', async () => {
        browser.alarms.create('background-sync-alarm', {
            delayInMinutes: 1,
            periodInMinutes: 1
        });

        require('../chrome/background.js');

        await browser.runtime.onStartup.trigger();

        expect(browser.alarms.clear).toHaveBeenCalledWith('background-sync-alarm');

        // Verify background-sync-alarm was created with correct interval
        expect(browser.alarms.create).toHaveBeenCalledWith(
            'background-sync-alarm',
            expect.objectContaining({
                delayInMinutes: 360,
                periodInMinutes: 360
            })
        );

        // Verify shared-folders-sync alarm was also created (new behavior)
        expect(browser.alarms.create).toHaveBeenCalledWith(
            'shared-folders-sync',
            expect.objectContaining({
                delayInMinutes: 1,
                periodInMinutes: 5
            })
        );
    });

    test('uses the popup as the default toolbar action on startup', async () => {
        require('../chrome/background.js');

        await browser.runtime.onStartup.trigger();

        expect(browser.action.setPopup).toHaveBeenCalledWith({ popup: 'index.html' });
    });

    test('opens the full page in a new tab when the toolbar action is configured for full page', async () => {
        browser = createBrowserHarness({
            localData: {
                googleUser: { displayName: 'Test User' },
                googleRefreshToken: 'refresh-token',
                chkToolbarIconOpensFullPage: true
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        require('../chrome/background.js');

        await browser.runtime.onStartup.trigger();
        browser.tabs.query.mockResolvedValue([]);
        await browser.action.onClicked.trigger();

        expect(browser.action.setPopup).toHaveBeenCalledWith({ popup: '' });
        expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/fullpage.html' });
    });

    test('focuses the existing full-page tab in the current window when the toolbar action is configured for full page', async () => {
        browser = createBrowserHarness({
            localData: {
                googleUser: { displayName: 'Test User' },
                googleRefreshToken: 'refresh-token',
                chkToolbarIconOpensFullPage: true
            }
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        browser.tabs.query.mockResolvedValue([{ id: 77, url: 'chrome-extension://test/fullpage.html' }]);

        require('../chrome/background.js');

        await browser.runtime.onStartup.trigger();
        await browser.action.onClicked.trigger();

        expect(browser.tabs.update).toHaveBeenCalledWith(77, { active: true });
        expect(browser.tabs.create).not.toHaveBeenCalled();
    });
});
