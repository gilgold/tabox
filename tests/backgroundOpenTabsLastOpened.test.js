const { createBrowserHarness } = require('./helpers/browserHarness');

// Regression test for the "recently opened" green dot disappearing / never showing.
//
// Root cause: `lastOpened` was only written by the popup/fullpage UI *after* the
// tabs were opened. In the popup that write was lost because opening a window tears
// the popup document down; in fullpage it raced with the background auto-update that
// rebuilds the collection from the freshly opened window. The durable fix is for the
// background `openTabs` handler to persist `lastOpened` itself.
describe('background openTabs marks collection as recently opened', () => {
    let browser;
    let bgUtils;

    beforeEach(() => {
        jest.resetModules();

        // postOpenTasks logs an expected console.error here: the harness does not
        // define applyChromeGroupSettings (chrome-group handling is out of scope
        // for these tests), and background.js catches and logs that failure.
        jest.spyOn(console, 'error').mockImplementation(() => {});

        browser = createBrowserHarness();

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();

        // Wire the real background-utils storage helpers so the handler persists to
        // the harness storage exactly as it would in production.
        bgUtils = require('../chrome/background-utils.js');
        Object.entries(bgUtils).forEach(([key, value]) => {
            if (typeof value === 'function') {
                global[key] = value;
            }
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        Object.keys(bgUtils || {}).forEach((key) => {
            if (typeof global[key] === 'function') {
                delete global[key];
            }
        });
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('persists lastOpened on the stored collection after opening its tabs', async () => {
        require('../chrome/background.js');

        // Seed a collection that has never been opened.
        await bgUtils.saveSingleCollectionBG({
            uid: 'collection-open-me',
            name: 'Open Me',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: [],
            lastOpened: null
        }, true);

        const seeded = await bgUtils.loadSingleCollectionBG('collection-open-me');
        expect(seeded.lastOpened).toBeNull();
        const seededLastUpdated = seeded.lastUpdated;

        const before = Date.now();
        await browser.runtime.sendMessage({
            type: 'openTabs',
            collection: seeded,
            window: { id: 200, incognito: false, tabs: [{ id: 1, url: 'about:blank' }] },
            newWindow: true,
            trackOpenedWindow: true
        });
        const after = Date.now();

        const updated = await bgUtils.loadSingleCollectionBG('collection-open-me');
        expect(typeof updated.lastOpened).toBe('number');
        expect(updated.lastOpened).toBeGreaterThanOrEqual(before);
        expect(updated.lastOpened).toBeLessThanOrEqual(after);

        // Opening should not be treated as a content edit: lastUpdated stays put.
        expect(updated.lastUpdated).toBe(seededLastUpdated);
    });

    test('marks lastOpened even when the collection has no tabs', async () => {
        require('../chrome/background.js');

        await bgUtils.saveSingleCollectionBG({
            uid: 'collection-empty',
            name: 'Empty',
            tabs: [],
            chromeGroups: [],
            lastOpened: null
        }, true);

        const before = Date.now();
        await browser.runtime.sendMessage({
            type: 'openTabs',
            collection: await bgUtils.loadSingleCollectionBG('collection-empty'),
            window: { id: 201, incognito: false, tabs: [] },
            newWindow: true,
            trackOpenedWindow: true
        });

        const updated = await bgUtils.loadSingleCollectionBG('collection-empty');
        expect(typeof updated.lastOpened).toBe('number');
        expect(updated.lastOpened).toBeGreaterThanOrEqual(before);
    });
});
