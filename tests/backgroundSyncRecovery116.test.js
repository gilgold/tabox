const { createBrowserHarness } = require('./helpers/browserHarness');

describe('issue 116 sync recovery', () => {
    let browser;
    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness({ localData: {
            googleUser: { displayName: 'Test' }, googleRefreshToken: 'refresh', localTimestamp: 123,
        }, syncData: { syncFileId: 'file' } });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.logSyncOperation = jest.fn();
        global.getAuthToken = jest.fn(async () => 'token');
        global.getOrCreateSyncFile = jest.fn(async () => true);
        global.syncData = jest.fn(async () => true);
        require('../chrome/background');
    });
    afterEach(() => {
        for (const key of ['browser', 'chrome', 'importScripts', 'logSyncOperation', 'getAuthToken', 'getOrCreateSyncFile', 'syncData']) delete global[key];
    });
    test.each([false, 'already_in_progress'])('reset does not claim completion for %s', async (result) => {
        global.syncData.mockResolvedValue(result);
        expect(await browser.runtime.sendMessage({ type: 'forceSyncReset' })).toBe(false);
    });
    test('reset succeeds only after sync completes', async () => {
        expect(await browser.runtime.sendMessage({ type: 'forceSyncReset' })).toBe(true);
        expect(browser.storage.local._data.localTimestamp).toBe(123);
        expect(browser.storage.local._data.syncSessionState.status).toBe('active');
        expect(global.getOrCreateSyncFile).toHaveBeenCalledWith('token', { rediscover: true });
    });
    test.each(['getAuthToken', 'getOrCreateSyncFile'])('reset reports %s failure', async (name) => {
        global[name].mockResolvedValue(false);
        expect(await browser.runtime.sendMessage({ type: 'forceSyncReset' })).toBe(false);
        expect(global.syncData).not.toHaveBeenCalled();
    });
    test.each(['login', 'loadFromServer', 'updateRemote'])('missing access blocks %s before authentication', async (type) => {
        browser.permissions.contains.mockResolvedValue(false);
        expect(await browser.runtime.sendMessage({ type })).toBe(false);
        expect(global.getAuthToken).not.toHaveBeenCalled();
    });
    test('signed-out reset does not claim success', async () => {
        await browser.storage.local.remove('googleRefreshToken');
        expect(await browser.runtime.sendMessage({ type: 'forceSyncReset' })).toBe(false);
        expect(global.syncData).not.toHaveBeenCalled();
    });
    test('missing access prevents reset mutation and exposes an actionable status', async () => {
        browser.permissions = { contains: jest.fn(async () => false) };
        expect(await browser.runtime.sendMessage({ type: 'forceSyncReset' })).toBe(false);
        expect(browser.storage.local._data.localTimestamp).toBe(123);
        expect(global.getAuthToken).not.toHaveBeenCalled();
        const status = await browser.runtime.sendMessage({ type: 'checkSyncStatus' });
        expect(status.syncError).toContain('Google site access');
    });
});
