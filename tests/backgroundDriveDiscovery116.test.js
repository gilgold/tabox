const { createBrowserHarness } = require('./helpers/browserHarness');

describe('issue 116 Drive file discovery', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        global.browser = createBrowserHarness();
        global.fetch = jest.fn();
    });
    afterEach(() => { jest.useRealTimers(); delete global.browser; delete global.fetch; });
    test('uses bearer authorization without cookies', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ files: [{ id: 'existing' }] }) });
        const { getOrCreateSyncFile } = require('../chrome/background-utils');
        expect(await getOrCreateSyncFile('token')).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('drive/v3/files/'), expect.objectContaining({
            credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer token' })
        }));
        expect(global.browser.storage.sync._data.syncFileId).toBe('existing');
    });
    test('failed rediscovery preserves the existing sync target', async () => {
        await global.browser.storage.sync.set({ syncFileId: 'original' });
        global.fetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
        const { getOrCreateSyncFile } = require('../chrome/background-utils');
        const result = getOrCreateSyncFile('token', { rediscover: true });
        await jest.runAllTimersAsync();
        expect(await result).toBe(false);
        expect(global.browser.storage.sync._data.syncFileId).toBe('original');
    });
    test('does not claim successful discovery when creating the file fails', async () => {
        global.fetch.mockImplementation(async url => String(url).includes('uploadType')
            ? { ok: false, status: 403, statusText: 'Forbidden' }
            : { ok: true, json: async () => ({ files: [] }) });
        const { getOrCreateSyncFile } = require('../chrome/background-utils');
        const result = getOrCreateSyncFile('token');
        await jest.runAllTimersAsync();
        expect(await result).toBe(false);
        expect(global.browser.storage.sync._data.syncFileId).toBeUndefined();
    });
});
