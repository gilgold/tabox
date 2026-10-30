import { normalizeDeferredTab } from '../app/utils/urlUtils';
import { getCurrentTabsAndGroups } from '../app/utils';
import { buildCollectionFromSnapshot } from '../app/utils/saveCollectionSnapshot';
import { normalizeBrowserSessionEntry } from '../app/utils/browserSessions';
import { browser } from '../static/globals';
const bg = require('../chrome/background-utils');
const real = 'https://synthetic.example/watch?q=a%26b&x=%25';
const title = '日本語 "<b>" 100% %26 & + (click to load)';
const wrap = (payload, scheme = 'chrome-extension') => `${scheme}://test/deferedLoading.html#${encodeURIComponent(JSON.stringify(payload))}`;
const tab = { id: 7, url: wrap({ url: real, title }), title: 'synthetic.example (click to load)', groupId: 3, favIconUrl: 'https://synthetic.example/icon' };

describe.each([['UI', normalizeDeferredTab], ['background', bg.normalizeDeferredTab]])('%s deferred metadata', (_, normalize) => {
    test('captures pending wrapper metadata before the document commits', () => {
        expect(normalize({ ...tab, url: 'about:blank', title: '', pendingUrl: tab.url })).toMatchObject({ url: real, title });
    });
    test('recovers exact embedded metadata and preserves other fields', () => {
        expect(normalize(tab)).toEqual({ ...tab, url: real, title });
    });
    test.each([undefined, null, '', '   ', 42, {}, []])('legacy/invalid title %p uses an available saved title', value => {
        const live = { ...tab, url: wrap({ url: real, title: value }, 'moz-extension') };
        expect(normalize(live, [{ id: 7, url: real, title }]).title).toBe(title);
    });
    test.each(['Tabox - Loading Content', '', undefined])('transient default title %p cannot overwrite a saved title', transient => {
        expect(normalize({ ...tab, url: wrap({ url: real }), title: transient }, [{ url: real, title }]).title).toBe(title);
    });
    test('handles legacy query wrappers and nested wrappers', () => {
        const legacy = `moz-extension://test/deferedLoading.html?url=${encodeURIComponent(real)}`;
        expect(normalize({ ...tab, url: legacy }, [{ url: real, title }])).toMatchObject({ url: real, title });
        expect(normalize({ ...tab, url: wrap({ url: wrap({ url: real, title }) }) })).toMatchObject({ url: real, title });
    });
    test('does not strip real website titles, even on lookalike URLs', () => {
        const normal = { url: `https://synthetic.example/deferedLoading.html?url=${encodeURIComponent(real)}`, title: 'synthetic.example (click to load)' };
        expect(normalize(normal, [{ url: real, title }])).toEqual(normal);
        expect(normalize({ ...tab, url: real })).toEqual({ ...tab, url: real });
    });
    test('only replaces known generated or empty wrapper titles; cannot recover overwritten titles', () => {
        const legacy = { ...tab, url: wrap({ url: real }) };
        expect(normalize(legacy, [{ url: real, title }]).title).toBe(title);
        expect(normalize({ ...legacy, title: 'Real website (click to load)' }, [{ url: real, title }]).title).toBe('Real website (click to load)');
        expect(normalize(legacy).title).toBe('synthetic.example');
        expect(normalize({ ...tab, url: 'chrome-extension://test/deferedLoading.html#%broken' })).toEqual({ ...tab, url: 'chrome-extension://test/deferedLoading.html#%broken' });
    });
});

describe('real capture/update paths', () => {
    beforeEach(() => {
        browser.runtime.getURL = jest.fn(path => `chrome-extension://test/${path}`);
        browser.storage.local.get = jest.fn(async () => ({}));
        browser.tabs.query = jest.fn(async () => [tab]);
        browser.windows.getCurrent = jest.fn(async () => ({ id: 1 }));
        browser.windows.get = jest.fn(async () => ({ id: 1 }));
        browser.tabGroups.query = jest.fn(async () => [{ id: 3, title: 'Group' }]);
        global.browser = browser;
    });
    afterEach(() => { delete global.browser; });
    test('save and Add Selected capture original titles and real URLs', async () => {
        const collection = await getCurrentTabsAndGroups('saved', true);
        expect(collection.tabs[0]).toMatchObject({ url: real, title });
    });
    test('manual update uses authoritative title for a legacy wrapper', async () => {
        browser.tabs.query.mockResolvedValue([{ ...tab, url: wrap({ url: real }) }]);
        const collection = await getCurrentTabsAndGroups('saved', false, [{ url: real, title }]);
        expect(collection.tabs[0]).toMatchObject({ url: real, title });
    });
    test('background auto-update preserves title and groups', async () => {
        browser.tabs.query.mockResolvedValue([{ ...tab, url: wrap({ url: real }) }]);
        const result = await bg.updateCollection({ uid: 'saved', tabs: [{ url: real, title }] }, 1);
        expect(result.tabs[0]).toMatchObject({ url: real, title, groupId: 3 });
        expect(result.chromeGroups[0].id).toBe(3);
    });
    test('190 deferred tabs survive capture and auto-update without opening destinations', async () => {
        const originals = Array.from({ length: 190 }, (_, i) => ({ ...tab, id: i, url: `${real}&n=${i}`, title: `${title} ${i}` }));
        browser.tabs.query.mockResolvedValue(originals.map(t => ({ ...t, url: wrap({ url: t.url, title: t.title }), title: 'Tabox - Loading Content' })));
        const captured = await getCurrentTabsAndGroups('large', true);
        const updated = await bg.updateCollection({ uid: 'large', tabs: originals }, 1);
        for (const collection of [captured, updated]) {
            expect(collection.tabs.map(t => [t.url, t.title])).toEqual(originals.map(t => [t.url, t.title]));
        }
    });
    test('snapshot and recently closed session resaves preserve embedded titles', () => {
        expect(buildCollectionFromSnapshot({ snapshot: { tabs: [tab] }, name: 'saved' }).tabs[0]).toMatchObject({ url: real, title });
        expect(normalizeBrowserSessionEntry({ tab }).collections[0].tabs[0]).toMatchObject({ url: real, title });
    });
});
