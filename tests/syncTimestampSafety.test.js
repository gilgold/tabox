const { createBrowserHarness } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot } = require('./helpers/upgradeFixtures');

describe('sync timestamp safety', () => {
    let browser;
    let backgroundUtils;
    let errorSpy;

    beforeEach(() => {
        jest.resetModules();
        // The sync logger intentionally emits console.error when the remote
        // timestamp lookup fails and the sync aborts — the path under test.
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.useFakeTimers();
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        backgroundUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.fetch;
    });

    test('does not replace syncFileId or create a new sync file when remote timestamp lookup is temporarily unavailable', async () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot.localTimestamp = 9100;
        browser.storage.local._data = snapshot;
        browser.storage.sync._data = {
            syncFileId: 'remote-file-id'
        };

        global.fetch = jest.fn(async (url) => {
            if (url.includes('/drive/v3/files/remote-file-id?alt=media')) {
                return {
                    ok: false,
                    status: 503,
                    statusText: 'Service Unavailable',
                    json: async () => ({})
                };
            }

            if (url.includes('/drive/v3/files?corpora=user')) {
                return {
                    ok: true,
                    json: async () => ({ files: [] })
                };
            }

            if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'new-sync-file-id' })
                };
            }

            if (url.includes('/upload/drive/v3/files/new-sync-file-id?uploadType=media')) {
                return {
                    ok: true,
                    json: async () => ({ id: 'new-sync-file-id', uploaded: true })
                };
            }

            return {
                ok: true,
                json: async () => ({})
            };
        });

        const syncPromise = backgroundUtils.syncData('token-123');
        await jest.runAllTimersAsync();
        const result = await syncPromise;

        expect(result).toBe(false);
        expect(browser.storage.sync._data.syncFileId).toBe('remote-file-id');
        expect(browser.storage.local._data.localTimestamp).toBe(9100);
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/upload/drive/v3/files?uploadType=multipart'),
            expect.anything()
        );
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/upload/drive/v3/files/new-sync-file-id?uploadType=media'),
            expect.anything()
        );
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Server timestamp is temporarily unavailable, aborting sync safely')
        );
    });
});
