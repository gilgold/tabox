const { signature, createRecovery, KEY, SESSION_KEY } = require('../chrome/auto-update-recovery');
const { normalizeDeferredTab } = require('../chrome/background-utils');
const { createBrowserHarness } = require('./helpers/browserHarness');

const tab = { url: 'https://example.test/', pinned: false, groupId: -1 };
const sig = (tabs, groups = [], live = false) => signature(tabs, groups, false, normalizeDeferredTab, live);

describe('restart identity', () => {
    test('ignores titles and tab IDs, preserves duplicate multiplicity and order', () => {
        expect(sig([tab, tab])).not.toBe(sig([tab]));
        expect(sig([tab])).toBe(sig([{ ...tab, title: 'Changed', id: 999 }]));
        expect(sig([tab, { ...tab, url: 'https://other.test/' }])).not.toBe(sig([{ ...tab, url: 'https://other.test/' }, tab]));
    });
    test('uses the issue121 smart-loading normalizer including pending and legacy wrappers', () => {
        const payload = encodeURIComponent(JSON.stringify({ url: tab.url, title: 'Original' }));
        for (const wrapper of [`chrome-extension://test/deferedLoading.html#${payload}`, `moz-extension://test/deferedLoading.html?url=${encodeURIComponent(tab.url)}`]) {
            expect(sig([{ ...tab, url: wrapper }])).toBe(sig([tab]));
            expect(sig([{ ...tab, url: 'about:blank', pendingUrl: wrapper }])).toBe(sig([tab]));
        }
    });
    test('rejects unsupported URLs, ordinary pending loads and incomplete states', () => {
        for (const url of ['', 'about:blank', 'chrome://newtab/', 'about:neterror', 'invalid', 'file:///test']) expect(sig([{ ...tab, url }])).toBeNull();
        expect(sig([{ ...tab, pendingUrl: 'https://new.test/', status: 'complete' }], [], true)).toBeNull();
        expect(sig([{ ...tab, pendingUrl: 'https://new.test/' }])).toBe(sig([tab]));
        expect(sig([{ ...tab, status: 'loading' }], [], true)).toBeNull();
        expect(sig([{ ...tab, status: 'loading', discarded: true }], [], true)).toBeNull();
        expect(sig([{ ...tab, status: 'unloaded', discarded: true }], [], true)).toBe(sig([tab]));
    });
    test('an identical pending URL does not reject a complete stable destination', () => {
        expect(sig([{ ...tab, pendingUrl: tab.url, status: 'complete' }], [], true)).toBe(sig([tab]));
        expect(sig([{ ...tab, pendingUrl: tab.url, status: 'loading' }], [], true)).toBeNull();
    });
    test('group identities survive changed session IDs but preserve membership and metadata', () => {
        const groups = [{ id: 1, uid: 'g1', title: 'Work', color: 'blue', collapsed: false }];
        const source = [{ ...tab, groupId: 111, groupUid: 'g1' }];
        const restored = [{ ...tab, groupId: 22 }];
        expect(sig(source, groups)).toBe(sig(restored, [{ ...groups[0], id: 22 }]));
        expect(sig(source, groups)).not.toBe(sig([tab]));
        expect(sig(restored, [{ ...groups[0], id: 22, color: 'red' }])).not.toBe(sig(source, groups));
        expect(sig(restored, [])).toBeNull();
    });
});

describe('recovery metadata and capability boundaries', () => {
    const setup = (data = {}) => {
        const browser = createBrowserHarness({ localData: { chkEnableAutoUpdate: true, chkResumeAutoUpdate: true,
            collectionsToTrack: [{ collectionUid: 'c', windowId: 1 }], ...data } });
        const recovery = createRecovery({ browser, normalize: normalizeDeferredTab, loadCollection: async () => null,
            loadCollections: async () => [], loadFolder: async () => null, now: () => 1000000000 });
        return { browser, recovery };
    };
    test.each([undefined, {}, { version: 0, entries: [{ collectionUid: 'c' }] }, { version: 1, entries: [null, {}, { collectionUid: 'c', signature: 'x', savedAt: 0 }] }])('ignores corrupt, old or expired records: %j', async data => {
        const { browser, recovery } = setup({ [KEY]: data });
        await recovery.startup();
        expect(browser.storage.local._data[KEY].entries).toEqual([]);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('missing session API never permits unvalidated stale window writes', async () => {
        const { browser, recovery } = setup();
        delete browser.storage.session;
        const update = jest.fn();
        await recovery.withWindow(1, update);
        expect(update).not.toHaveBeenCalled();
        expect(browser.windows.getAll).not.toHaveBeenCalled();
    });
    test('Firefox Android never queries windows or tracks', async () => {
        const { browser, recovery } = setup();
        delete browser.windows;
        await recovery.startup(); await recovery.track('c', 1); await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect(browser.alarms.create).not.toHaveBeenCalled();
    });
    test('default off never discovers candidates or enables the setting', async () => {
        const { browser, recovery } = setup({ chkResumeAutoUpdate: undefined });
        await recovery.startup(); await recovery.tick();
        expect(browser.storage.local._data.chkResumeAutoUpdate).toBeUndefined();
        expect(browser.storage.local._data[KEY].entries).toEqual([]);
        expect(browser.windows.getAll).not.toHaveBeenCalled();
    });
    test('default-off startup preserves existing tracking and establishes the session marker', async () => {
        const { browser, recovery } = setup({ chkResumeAutoUpdate: undefined });
        await recovery.startup();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c', windowId: 1 }]);
        expect(browser.storage.session._data[SESSION_KEY]).toBe(1);
        await browser.storage.local.set({ chkResumeAutoUpdate: true });
        await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c', windowId: 1 }]);
        expect(browser.storage.local._data[KEY]?.pending).toBeUndefined();
    });
    test('corrupt pending state in an existing browser session expires safely', async () => {
        const { browser, recovery } = setup({ [KEY]: { version: 1, entries: [], pending: {} } });
        await browser.storage.session.set({ [SESSION_KEY]: 1 });
        await recovery.tick();
        expect(browser.storage.local._data[KEY].pending).toBeUndefined();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });
    test('corrupt entries within a live session cannot abort cleanup', async () => {
        const { browser, recovery } = setup({ [KEY]: { version: 1, entries: [null, {}, { collectionUid: 'c', signature: 'x' }],
            pending: { startedAt: 999820000, deadline: 1000000000, candidates: ['c'] } } });
        await browser.storage.session.set({ [SESSION_KEY]: 1 });
        await recovery.tick();
        expect(browser.storage.local._data[KEY].entries).toEqual([]);
        expect(browser.storage.local._data[KEY].pending).toBeUndefined();
    });
    test('API failures at the recovery deadline retire candidates rather than retry forever', async () => {
        const { browser, recovery } = setup({ [KEY]: { version: 1, entries: [],
            pending: { startedAt: 999820000, deadline: 1000000000, candidates: [] } } });
        await browser.storage.session.set({ [SESSION_KEY]: 1 });
        browser.windows.getAll.mockRejectedValue(new Error('Window closed during query'));
        await recovery.tick();
        expect(browser.storage.local._data[KEY].pending).toBeUndefined();
        expect(browser.alarms.clear).toHaveBeenCalledWith('auto-update-recovery');
    });

    test('disable and re-enable during the final storage read vetoes an in-flight match', async () => {
        const c = { uid: 'c', tabs: [tab], chromeGroups: [] };
        const windows = [{ id: 8, tabs: [{ ...tab, status: 'complete' }] }];
        const observed = JSON.stringify([{ id: 8, signature: sig([tab]) }]);
        const browser = createBrowserHarness({ localData: { chkResumeAutoUpdate: true, chkEnableAutoUpdate: true, collectionsToTrack: [],
            [KEY]: { version: 1, entries: [{ collectionUid: 'c', signature: sig([tab]), savedAt: 999999999 }],
                pending: { startedAt: 999880000, deadline: 1000060000, candidates: ['c'], observation: observed, since: 999880000 } } } });
        await browser.storage.session.set({ [SESSION_KEY]: 1 });
        browser.windows.getAll.mockResolvedValue(windows);
        const recovery = createRecovery({ browser, normalize: normalizeDeferredTab, loadCollection: async () => c,
            loadCollections: async () => {
                const read = browser.storage.local.get.getMockImplementation();
                browser.storage.local.get.mockImplementationOnce(async keys => {
                    await browser.storage.local.set({ chkResumeAutoUpdate: false });
                    await browser.storage.local.set({ chkResumeAutoUpdate: true });
                    return read(keys);
                });
                return [c];
            }, loadFolder: async () => null, now: () => 1000000000 });
        browser.storage.onChanged.addListener(recovery.storageChanged);
        await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
    });

    test('a failed snapshot refresh drops stale eligibility without failing a manual tracking write', async () => {
        const browser = createBrowserHarness({ localData: { chkResumeAutoUpdate: true, chkEnableAutoUpdate: true,
            collectionsToTrack: [], [KEY]: { version: 1, entries: [{ collectionUid: 'c', signature: sig([tab]), savedAt: 1000000000 }] } } });
        await browser.storage.session.set({ [SESSION_KEY]: 1 });
        browser.windows.getAll.mockRejectedValue(new Error('Window disappeared'));
        const recovery = createRecovery({ browser, normalize: normalizeDeferredTab, loadCollection: async () => ({ uid: 'c', tabs: [tab] }),
            loadCollections: async () => [], loadFolder: async () => null, now: () => 1000000000 });
        await expect(recovery.track('c', 1)).resolves.toBeUndefined();
        expect(browser.storage.local._data[KEY].entries).toEqual([]);
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c', windowId: 1 }]);
    });

});

describe('bounded recovery under delayed browser scheduling', () => {
    let browser, recovery, time, collection;
    const makeRecovery = () => createRecovery({ browser, normalize: normalizeDeferredTab,
        loadCollection: async () => collection, loadCollections: async () => [collection],
        loadFolder: async () => null, now: () => time });
    beforeEach(() => {
        time = 1000000000;
        collection = { uid: 'c', tabs: [tab], chromeGroups: [] };
        browser = createBrowserHarness({ localData: { chkResumeAutoUpdate: true, chkEnableAutoUpdate: true,
            collectionsToTrack: [{ collectionUid: 'c', windowId: 1 }],
            [KEY]: { version: 1, entries: [{ collectionUid: 'c', signature: sig([tab]), savedAt: time }] } } });
        browser.windows.getAll.mockResolvedValue([{ id: 88, tabs: [{ ...tab, status: 'complete' }] }]);
        recovery = makeRecovery();
    });
    test('delayed lifecycle initialization and jittered alarms recover without a startup tick', async () => {
        time += 30000; // Startup handler itself was delayed; no tick at initialization.
        await recovery.startup();
        const start = time;
        time = start + 60849; await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        recovery = makeRecovery(); // Worker discarded between automatic alarms.
        time = start + 120010; await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c', windowId: 88 }]);
        expect(browser.storage.local._data[KEY].pending).toBeUndefined();
        expect(browser.alarms.create).toHaveBeenCalledTimes(1);
        expect(browser.alarms.create).toHaveBeenCalledWith('auto-update-recovery', { periodInMinutes: 1 });
        expect(browser.alarms.clear).toHaveBeenCalledWith('auto-update-recovery');
    });
    test('late restore events require a whole minute, within a fixed three-minute budget', async () => {
        await recovery.startup();
        const start = time;
        expect(browser.storage.local._data[KEY].pending.deadline).toBe(start + 180000);
        time = start + 60849; await recovery.tick();
        time = start + 90000; await recovery.activity();
        time = start + 120010; await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect(browser.storage.local._data[KEY].pending.deadline).toBe(start + 180000);
        time = start + 149999; await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        time = start + 150000; await recovery.tick();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([{ collectionUid: 'c', windowId: 88 }]);
    });
    test.each([180000, 180010, 86400000])('worker waking at %dms expires without adopting an ordinary matching window', async delay => {
        await recovery.startup();
        const start = time;
        time = start + 60849; await recovery.tick();
        time = start + delay;
        browser.windows.getAll.mockClear();
        browser.windows.getAll.mockResolvedValue([{ id: 99, tabs: [{ ...tab, status: 'complete' }] }]);
        recovery = makeRecovery();
        await recovery.startup(); await recovery.activity(); await recovery.tick();
        expect(browser.windows.getAll).not.toHaveBeenCalled();
        expect(browser.storage.local._data.collectionsToTrack).toEqual([]);
        expect(browser.storage.local._data[KEY].pending).toBeUndefined();
        expect(browser.storage.local._data[KEY].entries).toEqual([]);
        expect(browser.alarms.clear).toHaveBeenCalledWith('auto-update-recovery');
    });
});
