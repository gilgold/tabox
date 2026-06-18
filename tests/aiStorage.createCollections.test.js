require('jest-webextension-mock');
const storage = require('../chrome/ai-storage');

// Patch in the full storage operations (same pattern as aiStorage.module.test.js).
let _store = {};
browser.storage.local.get = jest.fn(async (keys) => {
    if (keys === null || keys === undefined) return { ..._store };
    if (typeof keys === 'string') return { [keys]: _store[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, _store[k]]));
    return Object.fromEntries(Object.keys(keys).map((k) => [k, _store[k]]));
});
browser.storage.local.set = jest.fn(async (payload) => { Object.assign(_store, payload); });
browser.storage.local.remove = jest.fn(async (keys) => {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete _store[k]);
});
browser.storage.local.clear = jest.fn(async () => { _store = {}; });

const local = browser.storage.local;

beforeEach(async () => { await local.clear(); });

test('createCollectionsBG creates N collections with parentId in a single index', async () => {
    const created = await storage.createCollectionsBG([
        { name: 'Work', tabs: [{ uid: 't1', url: 'https://a.com', title: 'A' }], parentId: 'folder-1' },
        { name: 'Play', tabs: [{ uid: 't2', url: 'https://b.com', title: 'B' }], parentId: 'folder-1' },
    ]);
    expect(created).toHaveLength(2);

    const index = (await local.get('collections_index')).collections_index;
    expect(Object.keys(index)).toHaveLength(2);
    created.forEach((c) => {
        expect(index[c.uid].parentId).toBe('folder-1');
        expect(index[c.uid].tabCount).toBe(1);
    });

    const rec = (await local.get(`collection_${created[0].uid}`))[`collection_${created[0].uid}`];
    expect(rec.tabs).toHaveLength(1);
    expect(rec.parentId).toBe('folder-1');
});

test('createCollectionsBG defaults parentId to null and assigns increasing order', async () => {
    const created = await storage.createCollectionsBG([
        { name: 'One', tabs: [] }, { name: 'Two', tabs: [] },
    ]);
    const index = (await local.get('collections_index')).collections_index;
    expect(index[created[0].uid].parentId).toBeNull();
    expect(index[created[1].uid].order).toBeGreaterThan(index[created[0].uid].order);
});
