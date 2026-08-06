// v4.2 moved `notifications` from required `permissions` to
// `optional_permissions` (a new required permission hard-disables the
// extension on auto-update). Two consequences under test here:
//   1. The service worker must boot cleanly when `browser.notifications` is
//      entirely undefined (the namespace only exists after the user grants
//      the optional permission AND the SW restarts).
//   2. The popup requests the permission from the user's first shared-folder
//      interaction (app/utils/notificationsPermission.js), gated by
//      permissions.contains and asked at most once per popup session.
import { browser } from '../static/globals';

jest.mock('../app/toastHelpers', () => ({
    showInfoToast: jest.fn(),
    showErrorToast: jest.fn(),
    showSuccessToast: jest.fn(),
}));

const { createBrowserHarness } = require('./helpers/browserHarness');

describe('service worker boot without the notifications permission', () => {
    let harness;

    beforeEach(() => {
        jest.resetModules();
        harness = createBrowserHarness({
            localData: { collections_index: {}, folders_index: {} }
        });
        // Optional permission not granted: the namespace does not exist at all.
        delete harness.notifications;
        global.browser = harness;
        global.chrome = { runtime: harness.runtime };
        global.importScripts = jest.fn();
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('registering the SW does not throw and message handling still works', async () => {
        expect(() => require('../chrome/background.js')).not.toThrow();

        // The runtime message handler must be live: getProEntitlement resolves
        // (null — nothing cached) instead of the SW having died at boot.
        const results = await harness.runtime.onMessage.trigger({ type: 'getProEntitlement' });
        expect(results).toContainEqual(null);
    });
});

describe('popup runtime request for the optional notifications permission', () => {
    const loadActions = () => {
        let actions;
        jest.isolateModules(() => {
            actions = require('../app/utils/sharedFolderActions');
        });
        return actions;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        browser.permissions = {
            contains: jest.fn().mockResolvedValue(false),
            request: jest.fn().mockResolvedValue(true),
        };
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ ok: true, data: {} });
    });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    test('accepting an invite requests the permission when not yet granted', async () => {
        const { respondToSharedInvite } = loadActions();
        await respondToSharedInvite({ folderId: 'f1', folderName: 'Team' }, true);
        await flush();
        expect(browser.permissions.contains).toHaveBeenCalledWith({ permissions: ['notifications'] });
        expect(browser.permissions.request).toHaveBeenCalledWith({ permissions: ['notifications'] });
    });

    test('declining an invite never prompts', async () => {
        const { respondToSharedInvite } = loadActions();
        await respondToSharedInvite({ folderId: 'f1', folderName: 'Team' }, false);
        await flush();
        expect(browser.permissions.request).not.toHaveBeenCalled();
    });

    test('already-granted permission is never re-requested', async () => {
        browser.permissions.contains.mockResolvedValue(true);
        const { joinSharedFolderLink } = loadActions();
        await joinSharedFolderLink({ token: 't', name: 'Team' });
        await flush();
        expect(browser.permissions.contains).toHaveBeenCalledWith({ permissions: ['notifications'] });
        expect(browser.permissions.request).not.toHaveBeenCalled();
    });

    test('asks at most once per popup session', async () => {
        // Simulate a decline: request resolves false, and a later action in
        // the same session must NOT re-show Chrome's permission dialog.
        browser.permissions.request.mockResolvedValue(false);
        const { respondToSharedInvite, joinSharedFolderLink } = loadActions();
        await respondToSharedInvite({ folderId: 'f1', folderName: 'Team' }, true);
        await joinSharedFolderLink({ token: 't', name: 'Team' });
        await flush();
        expect(browser.permissions.request).toHaveBeenCalledTimes(1);
    });

    test('a permissions API failure never breaks the flow', async () => {
        browser.permissions.contains.mockRejectedValue(new Error('no gesture'));
        const { joinSharedFolderLink } = loadActions();
        const ok = await joinSharedFolderLink({ token: 't', name: 'Team' });
        await flush();
        expect(ok).toBe(true);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedJoinLink', token: 't' });
    });
});
