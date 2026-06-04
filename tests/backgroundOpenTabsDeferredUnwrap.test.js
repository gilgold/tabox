const { createBrowserHarness } = require('./helpers/browserHarness');

// Regression test for: "I turned smart tab loading OFF but collections still open the
// blocked deferedLoading.html page."
//
// Collections saved while smart loading was on persisted the deferred wrapper URL
// (chrome-extension://.../deferedLoading.html?url=<real>) as the tab URL. Opening that
// stored URL verbatim re-triggers the blocked extension page regardless of the setting.
// openTabs must unwrap the stored URL to the real destination before creating tabs.
describe('background openTabs unwraps stored deferred-loading URLs', () => {
    let browser;
    let bgUtils;

    const EXT = 'chrome-extension://test/deferedLoading.html';
    const realUrl1 = 'https://example.com/first';
    const realUrl2 = 'https://example.com/second';
    const wrapper2 = `${EXT}?url=${encodeURIComponent(realUrl2)}&favicon=`;

    beforeEach(() => {
        jest.resetModules();

        // Smart tab loading is OFF: nothing should be (re-)deferred.
        browser = createBrowserHarness({ localData: { chkEnableTabDiscard: false } });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();

        bgUtils = require('../chrome/background-utils.js');
        Object.entries(bgUtils).forEach(([key, value]) => {
            if (typeof value === 'function') {
                global[key] = value;
            }
        });
    });

    afterEach(() => {
        Object.keys(bgUtils || {}).forEach((key) => {
            if (typeof global[key] === 'function') {
                delete global[key];
            }
        });
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('opens the real destination URL, never the deferedLoading wrapper', async () => {
        require('../chrome/background.js');

        await bgUtils.saveSingleCollectionBG({
            uid: 'collection-corrupted',
            name: 'Corrupted',
            tabs: [
                { url: realUrl1, title: 'First' },
                { url: wrapper2, title: 'Second' }, // stored as a deferred wrapper
            ],
            chromeGroups: [],
            lastOpened: null,
        }, true);

        await browser.runtime.sendMessage({
            type: 'openTabs',
            collection: await bgUtils.loadSingleCollectionBG('collection-corrupted'),
            window: { id: 300, incognito: false, tabs: [{ id: 1, url: 'about:blank' }] },
            newWindow: true,
            trackOpenedWindow: true,
        });

        // Collect every URL the handler tried to navigate to (tab create + first-tab update).
        const createdUrls = browser.tabs.create.mock.calls.map(([props]) => props && props.url);
        const updatedUrls = browser.tabs.update.mock.calls.map(([, props]) => props && props.url);
        const allUrls = [...createdUrls, ...updatedUrls].filter(Boolean);

        // No tab may point at the deferred-loading placeholder.
        expect(allUrls.some((url) => url.includes('deferedLoading.html'))).toBe(false);
        // The wrapped tab resolves to its real destination.
        expect(allUrls).toContain(realUrl2);
    });
});
