// C1 (part 2): chrome/shared-folders.js's pollInvites() creates a Chrome
// notification (id `shared-invite-<folderId>`) for each newly-seen invite, but
// until now nothing handled a click on it. background.js must open the
// extension's full-page view and clear the notification.
const { createBrowserHarness } = require('./helpers/browserHarness');

describe('shared-invite notification click handling', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness({
            localData: { collections_index: {}, folders_index: {} }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('opens the full-page view and clears the notification for a shared-invite id', async () => {
        require('../chrome/background.js');

        await browser.notifications.onClicked.trigger('shared-invite-folder-1');

        expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/fullpage.html' });
        expect(browser.notifications.clear).toHaveBeenCalledWith('shared-invite-folder-1');
    });

    test('focuses an already-open full-page tab instead of creating a new one', async () => {
        browser.tabs.query.mockResolvedValueOnce([{ id: 42 }]);
        require('../chrome/background.js');

        await browser.notifications.onClicked.trigger('shared-invite-folder-2');

        expect(browser.tabs.update).toHaveBeenCalledWith(42, { active: true });
        expect(browser.tabs.create).not.toHaveBeenCalled();
        expect(browser.notifications.clear).toHaveBeenCalledWith('shared-invite-folder-2');
    });

    test('ignores notification ids that are not shared-invite notifications', async () => {
        require('../chrome/background.js');

        await browser.notifications.onClicked.trigger('some-other-notification');

        expect(browser.tabs.create).not.toHaveBeenCalled();
        expect(browser.notifications.clear).not.toHaveBeenCalled();
    });
});
