// Firefox for Android has no windows, tabGroups, sessions, commands,
// contextMenus or identity APIs. These tests load the real background script
// against a harness with those namespaces removed and pin: startup still
// registers every lifecycle listener, collections open into the single tab
// strip, auto-update never tracks, and the tab-based sign-in completes from a
// top-level tabs.onUpdated listener (the event page may have been suspended).

const { createBrowserHarness } = require('./helpers/browserHarness');

const ANDROID_MISSING = ['windows', 'tabGroups', 'sessions', 'commands', 'contextMenus', 'identity', 'system'];

describe('background on Firefox for Android (reduced API surface)', () => {
    let browser;
    let bgUtils;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});

        browser = createBrowserHarness();
        ANDROID_MISSING.forEach((ns) => { delete browser[ns]; });
        delete browser.tabs.group;
        delete browser.tabs.ungroup;
        delete browser.tabs.move;
        delete browser.tabs.onMoved;

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();

        bgUtils = require('../chrome/background-utils.js');
        Object.entries(bgUtils).forEach(([key, value]) => {
            if (typeof value === 'function') global[key] = value;
        });
        global.AUTH_API_BASE = 'https://share.tbxpro.app';
        global.TAB_AUTH_PENDING_KEY = bgUtils.TAB_AUTH_PENDING_KEY;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        Object.keys(bgUtils || {}).forEach((key) => {
            if (typeof global[key] === 'function') delete global[key];
        });
        delete global.AUTH_API_BASE;
        delete global.TAB_AUTH_PENDING_KEY;
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.handleShareLinkRedeem;
    });

    test('startup registers lifecycle, alarm and tab listeners despite the missing APIs', () => {
        require('../chrome/background.js');
        expect(browser.runtime.onMessage.addListener).toHaveBeenCalled();
        expect(browser.runtime.onInstalled.addListener).toHaveBeenCalled();
        expect(browser.runtime.onStartup.addListener).toHaveBeenCalled();
        expect(browser.alarms.onAlarm.addListener).toHaveBeenCalled();
        expect(browser.tabs.onRemoved.addListener).toHaveBeenCalled();
    });

    test.each(['error-result', 'exception'])('a share link can retry after %s while concurrent notifications are deduplicated', async (failure) => {
        browser.runtime.getURL.mockImplementation(path => `moz-extension://test/${path}`);
        let finish;
        global.handleShareLinkRedeem = jest.fn()
            .mockImplementationOnce(() => new Promise((resolve, reject) => {
                finish = () => failure === 'exception' ? reject(new Error('Offline')) : resolve({ ok: false, status: 'error' });
            }))
            .mockResolvedValue({ ok: true, status: 'joined' });
        require('../chrome/background.js');
        const change = { url: 'https://share.tbxpro.app/join/retry-token' };
        const first = browser.tabs.onUpdated.trigger(42, change, { id: 42 });
        await browser.tabs.onUpdated.trigger(43, change, { id: 43 });
        expect(global.handleShareLinkRedeem).toHaveBeenCalledTimes(1);
        finish();
        await first;
        await browser.tabs.onUpdated.trigger(44, change, { id: 44 });
        expect(global.handleShareLinkRedeem).toHaveBeenCalledTimes(2);
        expect(browser.storage.local._data.shareLinkNotice.status).toBe('joined');
    });

    test('openTabs ignores the window spec and opens into the single tab strip without pinned/windowId', async () => {
        require('../chrome/background.js');
        browser.tabs.query.mockResolvedValue([{ id: 900, url: 'https://already.open/' }]);

        const collection = {
            uid: 'c-android',
            name: 'Android',
            tabs: [
                { url: 'https://a.example/', title: 'A', pinned: true, active: false },
                { url: 'https://b.example/', title: 'B', pinned: false, active: true },
            ],
            chromeGroups: [],
        };
        await bgUtils.saveSingleCollectionBG(collection, true);

        const result = await browser.runtime.sendMessage({
            type: 'openTabs',
            collection,
            createWindowSpec: { focused: true },
            newWindow: true,
            trackOpenedWindow: true,
        });

        expect(result.success).toBe(true);
        expect(result.tabsOpened).toBe(2);
        const created = browser.tabs.create.mock.calls.map(([props]) => props);
        expect(created).toEqual([
            { active: true, url: 'https://a.example/' },
            { active: false, url: 'https://b.example/' },
        ]);
        // Never tracked: auto-update would rewrite the collection from the
        // partial tab list Android exposes.
        await new Promise((resolve) => setTimeout(resolve, 600));
        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        expect(collectionsToTrack || []).toEqual([]);
    });

    test('getAuthRedirectConfig switches to the tab flow targeting the Worker /auth/done', () => {
        expect(bgUtils.hasIdentityFlow()).toBe(false);
        const config = bgUtils.getAuthRedirectConfig();
        expect(config.tabFlow).toBe(true);
        expect(config.viaWorker).toBe(true);
        expect(config.target).toMatch(/\/auth\/done$/);
        expect(config.exchangeRedirect).toMatch(/\/auth\/callback$/);
    });

    describe('readTabAuthCode', () => {
        const encode = (obj) => bgUtils.base64UrlEncodeJson(obj);
        const pending = { nonce: 'n-1', startedAt: Date.now() };
        const done = (fragment) => `https://share.tbxpro.app/auth/done#${fragment}`;

        test('returns the code when the nonce matches', () => {
            const state = encode({ t: 'https://share.tbxpro.app/auth/done', n: 'n-1' });
            expect(bgUtils.readTabAuthCode(done(`code=abc&state=${state}`), pending)).toBe('abc');
        });

        test('rejects a nonce mismatch, a declined consent, and a stale attempt', () => {
            const wrong = encode({ t: 'x', n: 'other' });
            expect(() => bgUtils.readTabAuthCode(done(`code=abc&state=${wrong}`), pending)).toThrow(/nonce/);
            const state = encode({ t: 'x', n: 'n-1' });
            expect(() => bgUtils.readTabAuthCode(done(`error=access_denied&state=${state}`), pending)).toThrow(/access_denied/);
            expect(() => bgUtils.readTabAuthCode(done(`code=abc&state=${state}`), { nonce: 'n-1', startedAt: 0 })).toThrow(/expired/);
        });
    });

    test('a woken event page finishes the pending sign-in from tabs.onUpdated', async () => {
        require('../chrome/background.js');
        await browser.storage.local.set({
            [bgUtils.TAB_AUTH_PENDING_KEY]: { nonce: 'n-2', tabId: 42, returnTabId: 7, startedAt: Date.now() },
        });
        const state = bgUtils.base64UrlEncodeJson({ t: 'https://share.tbxpro.app/auth/done', n: 'n-2' });

        await browser.tabs.onUpdated.trigger(42, { url: `https://share.tbxpro.app/auth/done#error=access_denied&state=${state}` }, { id: 42 });

        const stored = await browser.storage.local.get(bgUtils.TAB_AUTH_PENDING_KEY);
        expect(stored[bgUtils.TAB_AUTH_PENDING_KEY]).toBeUndefined();
        expect(browser.tabs.remove).toHaveBeenCalledWith(42);
        expect(browser.tabs.update).toHaveBeenCalledWith(7, { active: true });
    });

    test('ignores /auth/done in a tab that is not the pending sign-in tab', async () => {
        require('../chrome/background.js');
        const pendingRecord = { nonce: 'n-3', tabId: 42, returnTabId: 7, startedAt: Date.now() };
        await browser.storage.local.set({ [bgUtils.TAB_AUTH_PENDING_KEY]: pendingRecord });

        await browser.tabs.onUpdated.trigger(99, { url: 'https://share.tbxpro.app/auth/done#code=x' }, { id: 99 });

        const stored = await browser.storage.local.get(bgUtils.TAB_AUTH_PENDING_KEY);
        expect(stored[bgUtils.TAB_AUTH_PENDING_KEY]).toEqual(pendingRecord);
        expect(browser.tabs.remove).not.toHaveBeenCalledWith(99);
    });
});
