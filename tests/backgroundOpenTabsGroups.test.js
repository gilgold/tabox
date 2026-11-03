const { createBrowserHarness } = require('./helpers/browserHarness');

describe('saved group restore feedback through the real openTabs message handler', () => {
    let browser;
    let bgUtils;
    const fixture = () => ({
        uid: 'synthetic', name: 'Synthetic',
        chromeGroups: [1, 2].map(id => ({ id, uid: `g${id}`, title: `Private group ${id}`, color: 'blue', collapsed: false })),
        tabs: [1, 2].map(id => ({ uid: `t${id}`, url: `https://example.invalid/${id}`, groupUid: `g${id}`, groupId: id })),
    });
    const open = (collection, newWindow = false, extra = {}) => browser.runtime.sendMessage({
        type: 'openTabs', collection, newWindow, trackOpenedWindow: false,
        ...(newWindow ? { createWindowSpec: { focused: true } } : { window: { id: 300, tabs: [] } }), ...extra,
    });
    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        bgUtils = require('../chrome/background-utils');
        Object.entries(bgUtils).forEach(([key, value]) => {
            if (typeof value === 'function') global[key] = value;
        });
        require('../chrome/background');
    });
    afterEach(() => {
        jest.restoreAllMocks();
        Object.keys(bgUtils).forEach(key => { if (typeof global[key] === 'function') delete global[key]; });
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });
    test.each([false, true])('reports new group success in new window: %s', async newWindow => {
        const result = await open(fixture(), newWindow);
        expect(result).toMatchObject({ success: true, tabsOpened: 2, tabsFailed: 0, groupsRestored: 2, groupsFailed: 0 });
        expect(browser.tabs.group).toHaveBeenCalledTimes(2);
        expect(browser.tabGroups.update).toHaveBeenCalledTimes(2);
        expect(browser.storage.local._data.groupRestoreNoticePending).toBeUndefined();
    });
    test('reuses a matching title and color in the target window', async () => {
        browser.tabGroups.query.mockResolvedValue([{ id: 91, title: 'Private group 1', color: 'blue' }]);
        const result = await open(fixture());
        expect(result.groupsRestored).toBe(2);
        expect(browser.tabs.group).toHaveBeenNthCalledWith(1, { groupId: 91, tabIds: [1] });
        expect(browser.tabGroups.query).toHaveBeenCalledWith({ windowId: 300 });
    });
    test.each(['group', 'update'])('keeps opened tabs and reports tabs.%s / tabGroups failure without leaking details', async method => {
        const error = new Error('private error https://example.invalid/secret');
        (method === 'group' ? browser.tabs.group : browser.tabGroups.update).mockRejectedValue(error);
        const result = await open(fixture());
        expect(result).toMatchObject({ success: true, tabsOpened: 2, tabsFailed: 0, groupsRestored: 0, groupsFailed: 2 });
        expect(browser.tabs.remove).not.toHaveBeenCalled();
        expect(browser.tabs.ungroup).not.toHaveBeenCalled();
        const pending = browser.storage.local._data.groupRestoreNoticePending;
        expect(pending).toEqual({ tabsOpened: 2, groupsFailed: 2, ts: expect.any(Number) });
        expect(JSON.stringify(result)).not.toMatch(/private error|Private group|secret/);
        expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.any(String), error);
    });
    test.each([[false, 'group'], [true, 'group'], [false, 'update'], [true, 'update']])(
        'continues after failure in new window %s at %s', async (newWindow, method) => {
        (method === 'group' ? browser.tabs.group : browser.tabGroups.update).mockRejectedValueOnce(new Error('synthetic rejection'));
        const result = await open(fixture(), newWindow);
        expect(result).toMatchObject({ success: true, tabsOpened: 2, groupsRestored: 1, groupsFailed: 1 });
        expect(browser.tabs.group).toHaveBeenCalledTimes(2);
        expect(browser.tabGroups.update).toHaveBeenCalledTimes(method === 'group' ? 1 : 2);
    });
    test('group-only opening reports failure and never tracks the partial collection', async () => {
        browser.tabs.group.mockRejectedValue(new Error('synthetic rejection'));
        const collection = fixture();
        collection.tabs = collection.tabs.slice(0, 1);
        collection.chromeGroups = collection.chromeGroups.slice(0, 1);
        const result = await open(collection);
        expect(result).toMatchObject({ success: true, tabsOpened: 1, groupsFailed: 1 });
        expect(browser.storage.local._data.collectionsToTrack || []).toEqual([]);
    });
    test.each(['tabs.group', 'tabGroups', 'android', 'incognito'])('intentional %s fallback is not reported as failure', async mode => {
        if (mode === 'tabs.group' || mode === 'android') delete browser.tabs.group;
        if (mode === 'tabGroups' || mode === 'android') delete browser.tabGroups;
        if (mode === 'android') delete browser.windows;
        const result = await open(fixture(), false, mode === 'incognito' ? { window: { id: 300, tabs: [], incognito: true } } : {});
        expect(result).toMatchObject({ success: true, tabsOpened: 2, groupsRestored: 0, groupsFailed: 0 });
        expect(browser.storage.local._data.groupRestoreNoticePending).toBeUndefined();
    });
    test('dedupe-skipped groups are not failures', async () => {
        const collection = fixture();
        await browser.storage.local.set({ chkIgnoreDuplicates: true });
        const result = await open(collection, false, { window: { id: 300, tabs: collection.tabs } });
        expect(result).toMatchObject({ tabsOpened: 0, groupsRestored: 0, groupsFailed: 0 });
        expect(browser.tabs.group).not.toHaveBeenCalled();
    });
});
