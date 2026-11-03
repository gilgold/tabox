const { createBrowserHarness } = require('./helpers/browserHarness');

// Exercise the production openTabs message, window close, startup, alarms and
// tab events against real indexed storage. Browser APIs alone are synthetic.
describe('issue 48 restart recovery lifecycle', () => {
    let browser, utils, windows, collection;
    const alarm = () => browser.alarms.onAlarm.trigger({ name: 'auto-update-recovery' });
    const settle = async () => {
        await alarm();
        await jest.advanceTimersByTimeAsync(60000);
        await alarm();
        await jest.advanceTimersByTimeAsync(60000);
        await alarm();
    };
    beforeEach(async () => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        collection = { uid: 'c1', name: 'Synthetic', tabs: [
            { url: 'https://one.example/', title: 'One', pinned: false, groupId: -1 },
            { url: 'https://two.example/', title: 'Two', pinned: true, groupId: -1 },
        ], chromeGroups: [] };
        windows = [{ id: 10, type: 'normal', incognito: false,
            tabs: collection.tabs.map((t, i) => ({ ...t, id: i + 1, index: i, windowId: 10, status: 'complete' })) }];
        browser = createBrowserHarness({ localData: {
            chkEnableAutoUpdate: true, chkResumeAutoUpdate: true, collectionsToTrack: [],
        } });
        browser.windows.getAll.mockImplementation(async () => JSON.parse(JSON.stringify(windows)));
        browser.windows.get.mockImplementation(async id => {
            const w = windows.find(w => w.id === id);
            if (!w) throw new Error('missing window');
            return JSON.parse(JSON.stringify(w));
        });
        browser.tabs.query.mockImplementation(async q => (windows.find(w => w.id === q.windowId)?.tabs || []));
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        utils = require('../chrome/background-utils');
        Object.entries(utils).forEach(([k, v]) => { if (typeof v === 'function') global[k] = v; });
        global.ensurePushSubscription = jest.fn(async () => {});
        global.ensureSharedSyncAlarm = jest.fn(async () => {});
        await utils.saveSingleCollectionBG(collection, true);
        require('../chrome/background');
        await browser.runtime.sendMessage({ type: 'openTabs', collection, window: windows[0], newWindow: false });
        await jest.advanceTimersByTimeAsync(500);
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
        Object.keys(utils || {}).forEach(k => { if (typeof global[k] === 'function') delete global[k]; });
        delete global.browser; delete global.chrome; delete global.importScripts;
        delete global.ensurePushSubscription; delete global.ensureSharedSyncAlarm;
    });
    const restart = async () => {
        await browser.storage.session.clear();
        await browser.runtime.onStartup.trigger();
    };

    test('final adoption removal preserves complete indexed collection', async () => {
        const before = await utils.loadSingleCollectionBG('c1');
        windows[0].id = 88;
        windows[0].tabs.forEach(t => { t.windowId = 88; });
        await restart();
        await jest.advanceTimersByTimeAsync(120000);
        const set = browser.storage.local.set.getMockImplementation();
        let activity;
        let injected = false;
        browser.storage.local.set.mockImplementation(async items => {
            if (!injected && items.collectionsToTrack?.some(t => t.windowId === 88) && !items.autoUpdateRecovery?.pending) {
                injected = true;
                await Promise.resolve(); // Yield while the storage/read operation is in flight.
                const removed = windows[0].tabs.pop();
                // An extension storage write is asynchronous. Deliver a browser
                // event after the final guard but before the write completes.
                activity = browser.tabs.onRemoved.trigger(removed.id, { windowId: 88, isWindowClosing: false });
            }
            return set(items);
        });
        await alarm();
        await activity;
        expect(injected).toBe(true);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        await jest.advanceTimersByTimeAsync(2500);
        const after = await utils.loadSingleCollectionBG('c1');
        expect(before.tabs).toHaveLength(2);
        expect(after).toEqual(before);
    });

    test('CONTROL: same restore removal before final validation is vetoed and preserves saved tabs', async () => {
        windows[0].id = 88;
        windows[0].tabs.forEach(t => { t.windowId = 88; });
        await restart();
        await jest.advanceTimersByTimeAsync(120000);
        const get = browser.storage.local.get.getMockImplementation();
        let activity;
        let injected = false;
        // The source collection batch read is inside tick before its final guard.
        browser.storage.local.get.mockImplementation(async keys => {
            const result = await get(keys);
            if (!injected && Array.isArray(keys) && keys.includes('collection_c1')) {
                injected = true;
                await Promise.resolve(); // Yield while the storage/read operation is in flight.
                const removed = windows[0].tabs.pop();
                activity = browser.tabs.onRemoved.trigger(removed.id, { windowId: 88, isWindowClosing: false });
            }
            return result;
        });
        await alarm(); await activity;
        expect(injected).toBe(true);
        await jest.advanceTimersByTimeAsync(2500);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect((await utils.loadSingleCollectionBG('c1')).tabs).toHaveLength(2);
    });

    test('Resume OFF during final adoption leaves no new association', async () => {
        windows[0].id = 88;
        windows[0].tabs.forEach(t => { t.windowId = 88; });
        await restart(); await jest.advanceTimersByTimeAsync(120000);
        const set = browser.storage.local.set.getMockImplementation();
        let injected = false;
        browser.storage.local.set.mockImplementation(async items => {
            if (!injected && items.collectionsToTrack?.some(t => t.windowId === 88) && !items.autoUpdateRecovery?.pending) {
                injected = true;
                await Promise.resolve(); // The browser write has not completed.
                expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
                await set({ chkResumeAutoUpdate: false });
            }
            return set(items);
        });
        await alarm();
        // Drain queued storage cleanup.
        await browser.runtime.sendMessage({ type: 'pruneCollectionTracking' });
        expect(browser.storage.local._data.chkResumeAutoUpdate).toBe(false);
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toEqual([]);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        const removed = windows[0].tabs.pop();
        await browser.tabs.onRemoved.trigger(removed.id, { windowId: 88, isWindowClosing: false });
        await jest.advanceTimersByTimeAsync(2500);
        expect((await utils.loadSingleCollectionBG('c1')).tabs).toHaveLength(2);
    });

    test.each(['stop', 'delete', 'master-off', 'source', 'deadline', 'write-reject', 'rollback-reject'])('provisional adoption rejects %s and preserves manual mappings', async kind => {
        windows[0].id = 88;
        windows[0].tabs.forEach(t => { t.windowId = 88; });
        await restart();
        const manual = { uid: 'manual', tabs: [{ url: 'https://manual.example/', title: 'Manual' }], chromeGroups: [] };
        await utils.saveSingleCollectionBG(manual, true);
        windows.push({ id: 99, tabs: [{ ...manual.tabs[0], status: 'complete', windowId: 99 }] });
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'manual', windowId: 99 });
        await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(120000);
        const set = browser.storage.local.set.getMockImplementation();
        let injected = false, queued, rollbackFailed = false;
        browser.storage.local.set.mockImplementation(async items => {
            if (!injected && items.collectionsToTrack?.some(t => t.windowId === 88) && !items.autoUpdateRecovery?.pending) {
                injected = true;
                await Promise.resolve();
                if (kind === 'stop') queued = browser.runtime.sendMessage({ type: 'stopTrackingCollection', collectionUid: 'c1' });
                if (kind === 'delete') await browser.storage.local.remove('collection_c1');
                if (kind === 'master-off') await set({ chkEnableAutoUpdate: false });
                if (kind === 'source') await utils.saveSingleCollectionBG({ ...collection, tabs: [collection.tabs[0]] }, true);
                if (kind === 'deadline') jest.setSystemTime(browser.storage.local._data.autoUpdateRecovery.pending.deadline);
                if (kind === 'rollback-reject') queued = browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
                await set(items);
                if (kind === 'write-reject') throw new Error('Committed but rejected');
                return;
            }
            if (kind === 'rollback-reject' && injected && !rollbackFailed && items.collectionsToTrack) {
                rollbackFailed = true;
                throw new Error('Rollback failed');
            }
            return set(items);
        });
        if (['write-reject', 'rollback-reject'].includes(kind)) await expect(alarm()).rejects.toThrow();
        else await alarm();
        await queued;
        await browser.runtime.sendMessage({ type: 'pruneCollectionTracking' });
        expect(injected).toBe(true);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'manual', windowId: 99 }]);
        expect(browser.storage.local._data.autoUpdateRecovery.provisional).toBeUndefined();
    });

    test.each(['adoption', 'rollback'])('partial %s storage failure cannot expose provisional tracking on worker wake', async boundary => {
        windows[0].id = 88;
        windows[0].tabs.forEach(t => { t.windowId = 88; });
        await restart();
        await jest.advanceTimersByTimeAsync(120000);
        const before = await utils.loadSingleCollectionBG('c1');
        const set = browser.storage.local.set.getMockImplementation();
        let injected = false;
        browser.storage.local.set.mockImplementation(async items => {
            if (!injected && items.collectionsToTrack?.some(t => t.windowId === 88)) {
                injected = true;
                if (boundary === 'adoption') {
                    // Only the mapping key survives a rejected multi-key write.
                    await set({ collectionsToTrack: items.collectionsToTrack });
                    throw new Error('Partial adoption write');
                }
                await set(items);
                throw new Error('Adoption committed but rejected');
            }
            if (boundary === 'rollback' && injected && items.collectionsToTrack) {
                // Cleanup metadata must never become durable before revocation.
                if (items.autoUpdateRecovery) await set({ autoUpdateRecovery: items.autoUpdateRecovery });
                throw new Error('Tracking rollback unavailable');
            }
            return set(items);
        });
        await expect(alarm()).rejects.toThrow();
        expect(injected).toBe(true);
        browser.storage.local.set.mockImplementation(set);
        // New controller, same persistent and session stores: ordinary worker wake.
        const { createRecovery } = require('../chrome/auto-update-recovery');
        const recovery = createRecovery({ browser, normalize: utils.normalizeDeferredTab,
            loadCollection: utils.loadSingleCollectionBG, loadCollections: utils.loadAllCollectionsBG,
            loadFolder: utils.loadSingleFolderBG });
        await recovery.startup();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        windows[0].tabs.pop();
        await browser.tabs.onRemoved.trigger(2, { windowId: 88, isWindowClosing: false });
        await jest.advanceTimersByTimeAsync(2500);
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(before);
    });

    test('worker wake revokes a persisted provisional mapping before an actual tab update', async () => {
        await settle();
        const state = browser.storage.local._data.autoUpdateRecovery;
        await browser.storage.local.set({ autoUpdateRecovery: { ...state,
            provisional: { added: [{ collectionUid: 'c1', windowId: 10 }], candidates: ['c1'] } } });
        const before = await utils.loadSingleCollectionBG('c1');
        windows[0].tabs.pop();
        await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(2500);
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(before);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('closing during refresh preserves the unchanged last-complete snapshot', async () => {
        await settle();
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toHaveLength(1);
        const originalWindows = JSON.parse(JSON.stringify(windows));
        const before = await utils.loadSingleCollectionBG('c1');
        let closed;
        browser.windows.getAll.mockImplementationOnce(async () => {
            await Promise.resolve();
            windows = [];
            closed = browser.windows.onRemoved.trigger(10);
            return [];
        });
        await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, originalWindows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(2500);
        await closed;
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toHaveLength(1);
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(before);
        windows = originalWindows;
        windows[0].id = 88;
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 88 }]);
    });


    test.each(['close-first', 'changed-source', 'invalid-live', 'failed-read', 'stop', 'delete'])('snapshot retention distinguishes %s', async kind => {
        await settle();
        const api = require('../chrome/auto-update-recovery');
        const recovery = api.createRecovery({ browser, normalize: utils.normalizeDeferredTab,
            loadCollection: utils.loadSingleCollectionBG, loadCollections: utils.loadAllCollectionsBG,
            loadFolder: utils.loadSingleFolderBG });
        const original = JSON.parse(JSON.stringify(windows));
        if (kind === 'close-first') await browser.windows.onRemoved.trigger(10);
        if (kind === 'changed-source') await utils.saveSingleCollectionBG({ ...collection, tabs: [collection.tabs[0]] }, true);
        if (kind === 'stop') await browser.runtime.sendMessage({ type: 'stopTrackingCollection', collectionUid: 'c1' });
        if (kind === 'delete') await browser.storage.local.remove('collection_c1');
        windows = kind === 'invalid-live' ? [{ ...original[0], tabs: [] }] : [];
        if (kind === 'failed-read') browser.windows.getAll.mockRejectedValueOnce(new Error('Read unavailable'));
        await recovery.withWindow(10, async () => {});
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toHaveLength(kind === 'close-first' ? 1 : 0);
        windows = original;
        windows[0].id = 88;
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual(kind === 'close-first' ? [{ collectionUid: 'c1', windowId: 88 }] : []);
    });
    test('normalized pending smart-load metadata survives capture, completion and restart', async () => {
        await settle();
        const real = 'https://three.example/';
        const wrapper = `chrome-extension://test/deferedLoading.html#${encodeURIComponent(JSON.stringify({ url: real, title: 'Three' }))}`;
        windows[0].tabs.push({ id: 123, windowId: 10, index: 2, status: 'loading', url: 'about:blank', pendingUrl: wrapper, title: '' });
        await browser.tabs.onCreated.trigger(windows[0].tabs[2]);
        await jest.advanceTimersByTimeAsync(2500);
        const saved = await utils.loadSingleCollectionBG('c1');
        expect(saved.tabs[2]).toMatchObject({ url: real, title: 'Three', pendingUrl: wrapper });
        windows[0].tabs[2] = { id: 123, windowId: 10, index: 2, status: 'complete', url: wrapper, title: 'Tabox - Loading Content' };
        await browser.tabs.onUpdated.trigger(123, { status: 'complete' }, windows[0].tabs[2]);
        await jest.advanceTimersByTimeAsync(2500);
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(saved);
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toHaveLength(1);
        await browser.windows.onRemoved.trigger(10);
        windows[0].id = 88;
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 88 }]);
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(saved);
    });

    test('enabling Resume arms explicit current-session tracking without tab activity', async () => {
        await browser.storage.local.set({ chkResumeAutoUpdate: false });
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c1', windowId: 10 });
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toEqual([]);
        await browser.storage.local.set({ chkResumeAutoUpdate: true });
        // Settings changes and graceful window closure do not create tab events.
        await browser.runtime.sendMessage({ type: 'pruneCollectionTracking' });
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toHaveLength(1);
        await browser.windows.onRemoved.trigger(10);
        windows[0].id = 88;
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 88 }]);
    });

    test.each(['wake', 'stale-id', 'reused-id', 'master-off', 'deleted', 'ambiguous-window', 'ambiguous-source', 'stopped', 'untracked', 'reassigned', 'duplicate-mapping', 'read-only', 'changed-source'])('opt-in ownership control: %s', async kind => {
        await browser.storage.local.set({ chkResumeAutoUpdate: false });
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c1', windowId: 10 });
        if (['stale-id', 'reused-id'].includes(kind)) {
            await restart(); // Default-OFF startup preserves local IDs but not their ownership.
            if (kind === 'reused-id') windows[0].tabs[0].url = 'https://unrelated.example/';
        }
        if (kind === 'master-off') await browser.storage.local.set({ chkEnableAutoUpdate: false });
        if (kind === 'deleted') await browser.storage.local.remove('collection_c1');
        if (kind === 'ambiguous-window') windows.push({ ...windows[0], id: 11 });
        if (kind === 'ambiguous-source') await utils.saveSingleCollectionBG({ ...collection, uid: 'duplicate' }, true);
        if (kind === 'stopped') await browser.runtime.sendMessage({ type: 'stopTrackingCollection', collectionUid: 'c1' });
        if (kind === 'duplicate-mapping') await browser.storage.local.set({ collectionsToTrack: [{ collectionUid: 'c1', windowId: 10 }, { collectionUid: 'other', windowId: 10 }] });
        if (kind === 'read-only') {
            await browser.storage.local.set({ folder_readonly: { uid: 'readonly', shared: { role: 'read' } } });
            await utils.saveSingleCollectionBG({ ...collection, parentId: 'readonly' }, true);
        }
        if (kind === 'changed-source') await utils.saveSingleCollectionBG({ ...collection, tabs: [collection.tabs[0]] }, true);
        if (kind === 'untracked') await browser.storage.local.set({ collectionsToTrack: [] });
        if (kind === 'reassigned') {
            await utils.saveSingleCollectionBG({ ...collection, uid: 'replacement', tabs: [collection.tabs[0]] }, true);
            windows[0].tabs.pop();
            await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'replacement', windowId: 10 });
        }
        if (kind === 'wake') {
            // Fresh controller; retain storage.session, replace only its listener.
            browser.storage.onChanged._listeners.clear();
            const { createRecovery } = require('../chrome/auto-update-recovery');
            const recovery = createRecovery({ browser, normalize: utils.normalizeDeferredTab,
                loadCollection: utils.loadSingleCollectionBG, loadCollections: utils.loadAllCollectionsBG,
                loadFolder: utils.loadSingleFolderBG });
            browser.storage.onChanged.addListener(recovery.storageChanged);
            await recovery.startup();
            await browser.storage.local.set({ chkResumeAutoUpdate: true });
            await recovery.prune();
        } else {
            await browser.storage.local.set({ chkResumeAutoUpdate: true });
            await browser.runtime.sendMessage({ type: 'pruneCollectionTracking' });
        }
        expect(browser.storage.local._data.autoUpdateRecovery.entries.map(e => e.collectionUid)).toEqual(
            kind === 'wake' ? ['c1'] : kind === 'reassigned' ? ['replacement'] : []);
    });

});
