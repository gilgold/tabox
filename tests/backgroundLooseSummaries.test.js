const { createBrowserHarness } = require('./helpers/browserHarness');

describe('loadLooseCollectionSummariesBG', () => {
    let bgUtils;
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        bgUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('returns only loose collections with tab titles capped to maxTitles', async () => {
        await browser.storage.local.set({
            collections_index: {
                c1: { parentId: null, order: 0 },
                c2: { parentId: 'f1', order: 1 },
                c3: { parentId: null, order: 2 },
            },
            collection_c1: { uid: 'c1', name: 'A', parentId: null, tabs: [
                { title: 't1', url: 'u1' }, { title: 't2', url: 'u2' }, { title: 't3', url: 'u3' },
                { title: 't4', url: 'u4' }, { title: 't5', url: 'u5' }, { title: 't6', url: 'u6' },
            ] },
            collection_c2: { uid: 'c2', name: 'B', parentId: 'f1', tabs: [] },
            collection_c3: { uid: 'c3', name: 'C', parentId: null, tabs: [{ title: 'only', url: 'u' }] },
        });
        const out = await bgUtils.loadLooseCollectionSummariesBG(5);
        expect(out.map((c) => c.uid).sort()).toEqual(['c1', 'c3']);
        const c1 = out.find((c) => c.uid === 'c1');
        expect(c1.tabs).toHaveLength(5);
        expect(c1.tabs[0]).toEqual({ title: 't1', url: 'u1' });
    });

    test('falls back to legacy storage when there is no index', async () => {
        await browser.storage.local.set({
            tabsArray: [
                { uid: 'x', name: 'X', parentId: null, tabs: [{ title: 't', url: 'u' }] },
                { uid: 'y', name: 'Y', parentId: 'f', tabs: [] },
            ],
        });
        const out = await bgUtils.loadLooseCollectionSummariesBG(5);
        expect(out.map((c) => c.uid)).toEqual(['x']);
    });
});
