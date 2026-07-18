// Perf: event-driven push for shared folders. Every local data change already
// flows through the 'updateRemote' message (Drive path). background.js now
// also piggybacks a debounced trigger of the shared-folders sync engine on
// that same signal, so a shared-folder edit reaches the server in ~3s rather
// than waiting for the next 1-minute alarm tick or 8s popup poll.
const { createBrowserHarness } = require('./helpers/browserHarness');

const SHARED_FOLDER_LOCAL_DATA = {
    googleRefreshToken: 'refresh-token',
    folders_index: {
        f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'owner' } }
    }
};

describe('event-driven shared folder push (debounced)', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        browser = createBrowserHarness({ localData: SHARED_FOLDER_LOCAL_DATA });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.loadAllCollectionsBG = jest.fn(async () => []);
        global.getAuthToken = jest.fn(async () => 'token-123');
        global.syncData = jest.fn(async () => true);
        global.logSyncOperation = jest.fn();
        // background.js calls the bare `syncSharedFolders` identifier that the
        // real chrome/shared-folders.js exposes via importScripts in the actual
        // service worker; importScripts is mocked as a no-op above, so stub it
        // directly, mirroring how sibling tests stub `global.updateRemote`/
        // `global.syncData` for background.js's other bare cross-file calls.
        global.syncSharedFolders = jest.fn(async () => ({ ok: true, data: { pulled: 0, pushed: 0, revoked: 0 } }));
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.loadAllCollectionsBG;
        delete global.getAuthToken;
        delete global.syncData;
        delete global.logSyncOperation;
        delete global.syncSharedFolders;
    });

    test('two rapid updateRemote messages collapse into exactly one debounced shared sync ~3s later', async () => {
        require('../chrome/background.js');

        await browser.runtime.sendMessage({ type: 'updateRemote' });
        await jest.advanceTimersByTimeAsync(1000);
        // Second message arrives before the first debounce window elapsed -
        // it must reset the timer rather than scheduling a second run.
        await browser.runtime.sendMessage({ type: 'updateRemote' });

        // Only ~3s since the FIRST call has passed - the debounce reset by the
        // second call means it must not have fired yet.
        await jest.advanceTimersByTimeAsync(2000);
        expect(global.syncSharedFolders).not.toHaveBeenCalled();

        // The remaining time to reach 3s since the SECOND call.
        await jest.advanceTimersByTimeAsync(1000);
        expect(global.syncSharedFolders).toHaveBeenCalledTimes(1);
    });

    test('no shared folders locally: updateRemote never schedules a shared sync', async () => {
        browser = createBrowserHarness({
            localData: { googleRefreshToken: 'refresh-token', folders_index: {} }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        require('../chrome/background.js');

        await browser.runtime.sendMessage({ type: 'updateRemote' });
        await jest.advanceTimersByTimeAsync(5000);

        expect(global.syncSharedFolders).not.toHaveBeenCalled();
    });

    test('signed out: updateRemote never schedules a shared sync even with a shared folder locally', async () => {
        browser = createBrowserHarness({
            localData: {
                folders_index: { f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'owner' } } }
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        require('../chrome/background.js');

        await browser.runtime.sendMessage({ type: 'updateRemote' });
        await jest.advanceTimersByTimeAsync(5000);

        expect(global.syncSharedFolders).not.toHaveBeenCalled();
    });
});
