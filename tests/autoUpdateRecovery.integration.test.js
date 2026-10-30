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
    test.each(['startup', 'close', 'restore-event', 'late-restore', 'worker-wake'])('jittered automatic alarms recover a stable exact match after %s without an initial tick', async kind => {
        windows[0].id = 88;
        const before = JSON.stringify(browser.storage.local._data);
        const completeTabs = windows[0].tabs;
        if (kind === 'late-restore') windows[0].tabs = completeTabs.slice(0, 1);
        await restart();
        const startedAt = Date.now();
        const deadline = browser.storage.local._data.autoUpdateRecovery.pending.deadline;
        // These timers model browser alarm delivery, not production timers. No
        // alarm or tick is dispatched at startup; the first arrives 849ms late.
        setTimeout(() => alarm(), 60849);
        setTimeout(() => alarm(), 120010);
        const eventTime = kind === 'late-restore' ? 45000 : 1290;
        await jest.advanceTimersByTimeAsync(eventTime);
        if (kind === 'late-restore') {
            windows[0].tabs = completeTabs;
            await browser.tabs.onCreated.trigger(completeTabs[1]);
        }
        if (kind === 'close') await browser.windows.onRemoved.trigger(999);
        if (kind === 'restore-event') await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
        if (kind === 'worker-wake') {
            jest.resetModules();
            const api = require('../chrome/auto-update-recovery');
            const recovery = api.createRecovery({ browser, normalize: utils.normalizeDeferredTab,
                loadCollection: utils.loadSingleCollectionBG, loadCollections: utils.loadAllCollectionsBG,
                loadFolder: utils.loadSingleFolderBG });
            // A worker wake must preserve the existing absolute cutoff.
            await recovery.startup();
        }
        expect(browser.storage.local._data.autoUpdateRecovery.pending.deadline).toBe(deadline);
        await jest.advanceTimersByTimeAsync(60849 - eventTime);
        expect(Date.now() - startedAt).toBe(60849);
        const lastEvent = ['close', 'restore-event', 'late-restore'].includes(kind) ? eventTime : 0;
        expect(browser.storage.local._data.autoUpdateRecovery.pending.since).toBe(startedAt + lastEvent);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        await jest.advanceTimersByTimeAsync(59161);
        expect(browser.storage.local._data.autoUpdateRecovery.pending).toBeUndefined();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 88 }]);
        const original = JSON.parse(before);
        for (const key of Object.keys(original).filter(k => k.startsWith('collection_') || ['localTimestamp', 'autoBackups'].includes(k))) {
            expect(browser.storage.local._data[key]).toEqual(original[key]);
        }
    });

    test('graceful close then restored content with changed window ID rebinds without writing a collection', async () => {
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 10 }]);
        await browser.windows.onRemoved.trigger(10);
        windows[0].id = 80;
        windows[0].tabs.forEach(t => { t.windowId = 80; t.id += 100; });
        const before = JSON.stringify(await utils.loadSingleCollectionBG('c1'));
        await restart();
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 80 }]);
        expect(JSON.stringify(await utils.loadSingleCollectionBG('c1'))).toBe(before);
    });
    test('crash leaves stale mapping: startup quarantines it and recovers the changed ID', async () => {
        windows[0].id = 90;
        await restart();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 90 }]);
    });
    test('stopping a candidate during quarantine revokes it even without an active window', async () => {
        await restart();
        await browser.runtime.sendMessage({ type: 'stopTrackingCollection', collectionUid: 'c1' });
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toEqual([]);
    });
    test.each(['chkResumeAutoUpdate', 'chkEnableAutoUpdate'])('disabling %s then enabling it cannot resurrect prior intent', async key => {
        await browser.storage.local.set({ [key]: false });
        await browser.storage.local.set({ [key]: true });
        await restart();
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('deletion revokes the candidate even if the same content is later restored by undo', async () => {
        await browser.storage.local.remove('collection_c1');
        await utils.saveSingleCollectionBG(collection, true);
        await restart();
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('a reused old ID cannot overwrite data when a tab event precedes onStartup', async () => {
        await browser.storage.session.clear();
        windows[0].tabs = [{ id: 99, windowId: 10, index: 0, status: 'complete', url: 'https://unrelated.example/' }];
        const before = JSON.stringify(await utils.loadSingleCollectionBG('c1'));
        await browser.tabs.onCreated.trigger(windows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(2500);
        expect(JSON.stringify(await utils.loadSingleCollectionBG('c1'))).toBe(before);
        await browser.runtime.onStartup.trigger();
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('worker wake preserves current associations and pending recovery observations', async () => {
        await restart();
        await alarm();
        await jest.advanceTimersByTimeAsync(60000);
        // A new module instance models a discarded worker, retaining both storage areas.
        jest.resetModules();
        const api = require('../chrome/auto-update-recovery');
        const recovery = api.createRecovery({ browser, normalize: utils.normalizeDeferredTab,
            loadCollection: utils.loadSingleCollectionBG, loadCollections: utils.loadAllCollectionsBG,
            loadFolder: utils.loadSingleFolderBG });
        await recovery.tick();
        await jest.advanceTimersByTimeAsync(60000);
        await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 10 }]);
        await recovery.withWindow(10, async () => {});
        expect(browser.storage.local._data.collectionsToTrack).toHaveLength(1);
    });

    test.each(['partial', 'empty', 'loading', 'newtab', 'error', 'reordered', 'duplicate-url', 'pinned', 'privacy', 'ambiguous-window', 'duplicate-collection', 'changed-source', 'read-only'])('fails closed for %s without collection or sync writes', async kind => {
        const before = JSON.stringify(await utils.loadSingleCollectionBG('c1'));
        if (kind === 'partial') windows[0].tabs.pop();
        if (kind === 'empty') windows[0].tabs = [];
        if (kind === 'loading') windows[0].tabs[0].status = 'loading';
        if (kind === 'newtab') windows[0].tabs[0].url = 'about:newtab';
        if (kind === 'error') windows[0].tabs[0].url = 'about:neterror?e=x';
        if (kind === 'reordered') windows[0].tabs.reverse();
        if (kind === 'duplicate-url') windows[0].tabs[1].url = windows[0].tabs[0].url;
        if (kind === 'pinned') windows[0].tabs[0].pinned = true;
        if (kind === 'privacy') windows[0].incognito = true;
        if (kind === 'ambiguous-window') windows.push({ ...windows[0], id: 91 });
        if (kind === 'duplicate-collection') await utils.saveSingleCollectionBG({ ...collection, uid: 'c2' }, true);
        if (kind === 'changed-source') await utils.saveSingleCollectionBG({ ...collection, tabs: collection.tabs.slice(1) }, true);
        if (kind === 'read-only') {
            await utils.saveSingleCollectionBG({ ...collection, parentId: 'read-folder' }, true);
            await utils.saveSingleFolderBG({ uid: 'read-folder', shared: { role: 'read' } });
        }
        const expected = kind === 'changed-source' || kind === 'read-only' ? JSON.stringify(await utils.loadSingleCollectionBG('c1')) : before;
        await restart();
        const independent = { localTimestamp: browser.storage.local._data.localTimestamp, autoBackups: browser.storage.local._data.autoBackups };
        await browser.tabs.onCreated.trigger({ id: 99, windowId: 10 });
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect(JSON.stringify(await utils.loadSingleCollectionBG('c1'))).toBe(expected);
        expect({ localTimestamp: browser.storage.local._data.localTimestamp, autoBackups: browser.storage.local._data.autoBackups }).toEqual(independent);
        expect(browser.storage.sync.set).not.toHaveBeenCalled();
    });
    test('partial restore becomes complete early enough to settle, then ordinary tab changes auto-update', async () => {
        const allTabs = windows[0].tabs;
        windows[0].tabs = allTabs.slice(0, 1);
        await restart();
        await alarm();
        await jest.advanceTimersByTimeAsync(30000);
        windows[0].tabs = allTabs;
        windows[0].id = 77;
        await browser.windows.onCreated.trigger(windows[0]);
        await alarm();
        await jest.advanceTimersByTimeAsync(90000);
        await alarm();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 77 }]);
        windows[0].tabs.push({ id: 123, windowId: 77, index: 2, status: 'complete', url: 'https://three.example/' });
        await browser.tabs.onCreated.trigger(windows[0].tabs[2]);
        await jest.advanceTimersByTimeAsync(2500);
        expect((await utils.loadSingleCollectionBG('c1')).tabs.map(t => t.url)).toEqual(['https://one.example/', 'https://two.example/', 'https://three.example/']);
    });
    test('an identical delayed second window vetoes the first apparent match', async () => {
        await restart(); await alarm();
        await jest.advanceTimersByTimeAsync(90000);
        windows.push({ ...windows[0], id: 99 });
        await browser.windows.onCreated.trigger(windows[1]);
        await alarm();
        await jest.advanceTimersByTimeAsync(30000); await alarm();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('after the bounded attempt new ordinary matching windows are never adopted', async () => {
        windows = [];
        await restart(); await settle();
        windows = [{ id: 99, tabs: collection.tabs.map((t, index) => ({ ...t, index, status: 'complete' })) }];
        await browser.windows.onCreated.trigger(windows[0]); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toEqual([]);
    });
    test('events between equal observations invalidate stability even if the URL changes back', async () => {
        await restart(); await alarm();
        await jest.advanceTimersByTimeAsync(110000);
        await browser.tabs.onUpdated.trigger(1, { status: 'loading' }, { ...windows[0].tabs[0], status: 'loading' });
        await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(10000); await alarm();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('manual opening during startup wins over recovery and records only one association', async () => {
        await restart();
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c1', windowId: 10 });
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 10 }]);
    });

    test('folder-level stop revokes all selected startup candidates atomically', async () => {
        await restart();
        const result = await browser.runtime.sendMessage({ type: 'stopTrackingCollections', collectionUids: ['c1'] });
        expect(result).toBe(1);
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('changing window ownership removes the old collection recovery intent', async () => {
        await utils.saveSingleCollectionBG({ ...collection, uid: 'c2' }, true);
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c2', windowId: 10 });
        expect(browser.storage.local._data.autoUpdateRecovery.entries.map(e => e.collectionUid)).toEqual(['c2']);
    });
    test('regular closes retain snapshots for at most one day', async () => {
        await browser.windows.onRemoved.trigger(10);
        await jest.advanceTimersByTimeAsync(86400001);
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('source mutation while reading windows vetoes recovery', async () => {
        await restart(); await alarm();
        await jest.advanceTimersByTimeAsync(120000);
        const original = browser.windows.getAll.getMockImplementation();
        browser.windows.getAll.mockImplementationOnce(async () => {
            const result = await original();
            await utils.saveSingleCollectionBG({ ...collection, tabs: collection.tabs.slice(1) }, true);
            return result;
        });
        await alarm();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });

    test('enabling resume in the current session preserves a manually tracked window', async () => {
        await browser.storage.local.set({ chkResumeAutoUpdate: false });
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c1', windowId: 10 });
        await browser.storage.session.clear();
        // A current-session open with resume OFF must establish a session marker.
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c1', windowId: 10 });
        await browser.storage.local.set({ chkResumeAutoUpdate: true });
        await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(2500);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 10 }]);
        expect(browser.storage.local._data.autoUpdateRecovery.entries).toHaveLength(1);
    });

    test('a current-session manual close is never recovered in that same startup attempt', async () => {
        await browser.windows.onRemoved.trigger(10);
        windows[0].id = 55;
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        // It remains eligible for the next actual restart, within retention.
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 55 }]);
    });
    test('manually reopening a prior candidate revokes its startup eligibility even if closed again', async () => {
        await restart();
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c1', windowId: 10 });
        await browser.windows.onRemoved.trigger(10);
        windows[0].id = 66;
        await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });

    test('swapped IDs across two restored windows follow content, never the old IDs', async () => {
        const second = { ...collection, uid: 'c2', tabs: [{ url: 'https://distinct.example/', groupId: -1 }] };
        await utils.saveSingleCollectionBG(second, true);
        windows.push({ id: 20, tabs: second.tabs.map((t, index) => ({ ...t, index, status: 'complete' })) });
        await browser.runtime.sendMessage({ type: 'trackCollection', collectionUid: 'c2', windowId: 20 });
        windows[0].id = 20; windows[1].id = 10;
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([
            { collectionUid: 'c1', windowId: 20 }, { collectionUid: 'c2', windowId: 10 },
        ]);
    });
    test('complete smart-loading pending wrappers rebind through production startup without rewriting saved URLs or titles', async () => {
        windows[0].id = 70;
        windows[0].tabs = windows[0].tabs.map(t => ({ ...t, url: 'about:blank',
            pendingUrl: `moz-extension://fixture/deferedLoading.html#${encodeURIComponent(JSON.stringify({ url: t.url, title: t.title }))}` }));
        const before = await utils.loadSingleCollectionBG('c1');
        await restart(); await settle();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 70 }]);
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(before);
    });

    test('startup after an initial current-session open preserves its mapping through the deadline', async () => {
        // First open established the marker even though there were no previous
        // candidates. A later onStartup must not quarantine that current mapping.
        expect(browser.storage.local._data.autoUpdateRecovery.pending.candidates).toEqual([]);
        await browser.runtime.onStartup.trigger();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 10 }]);
        await settle();
        expect(browser.storage.local._data.autoUpdateRecovery.pending).toBeUndefined();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 10 }]);
    });

    test('complete identical pending URLs recover by the two-minute deadline', async () => {
        windows[0].tabs.forEach(t => { t.pendingUrl = t.url; });
        windows[0].id = 88;
        await restart();
        const startedAt = browser.storage.local._data.autoUpdateRecovery.pending.startedAt;
        await settle();
        expect(Date.now() - startedAt).toBe(120000);
        expect(browser.storage.local._data.autoUpdateRecovery.pending).toBeUndefined();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c1', windowId: 88 }]);
    });

    test.each(['stop', 'disable'])('%s while an auto-update awaits window data vetoes its collection write', async action => {
        const before = await utils.loadSingleCollectionBG('c1');
        windows[0].tabs.push({ id: 123, windowId: 10, index: 2, status: 'complete', url: 'https://three.example/' });
        const get = browser.windows.get.getMockImplementation();
        let stopped;
        browser.windows.get.mockImplementationOnce(async (...args) => {
            if (action === 'stop') stopped = browser.runtime.sendMessage({ type: 'stopTrackingCollection', collectionUid: 'c1' });
            else await browser.storage.local.set({ chkEnableAutoUpdate: false });
            return get(...args);
        });
        await browser.tabs.onUpdated.trigger(1, { status: 'complete' }, windows[0].tabs[0]);
        await jest.advanceTimersByTimeAsync(2500);
        if (stopped) await stopped;
        expect(await utils.loadSingleCollectionBG('c1')).toEqual(before);
        expect(browser.storage.local._data.collectionsToTrack).toEqual(action === 'stop' ? [] : [{ collectionUid: 'c1', windowId: 10 }]);
    });

});
