require('jest-webextension-mock');
require('../chrome/ai-storage');           // defines globalThis.TaboxAIStorage
const split = require('../chrome/split-collection');

// Patch storage mock (same pattern as aiStorage.createCollections.test.js).
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

const local = (globalThis.browser || globalThis.chrome).storage.local;

async function seedOriginal() {
    const uid = 'orig-1';
    const tabs = Array.from({ length: 6 }, (_, i) => ({ uid: `t${i}`, url: `https://s${i}.com`, title: `T${i}` }));
    const record = { uid, name: 'Big One', type: 'collection', tabs, color: 'var(--collection-default-color)',
        createdOn: 1, lastUpdated: 1, lastOpened: null, chromeGroups: [], parentId: null, order: 5 };
    await local.set({
        [`collection_${uid}`]: record,
        collections_index: { [uid]: { name: 'Big One', type: 'collection', tabCount: 6, parentId: null, order: 5, color: record.color } },
    });
    return { uid, tabs };
}

const plan = { groups: [
    { name: 'First', tabIndices: [0, 1, 2] },
    { name: 'Second', tabIndices: [3, 4, 5] },
] };

beforeEach(async () => { await local.clear(); });

test('applySplitCollectionPlan creates sub-collections in a folder and deletes the original', async () => {
    const { uid } = await seedOriginal();
    const res = await split.applySplitCollectionPlan({ uid, plan, folder: { name: 'Big One' } });

    expect(res.success).toBe(true);
    expect(res.createdUids).toHaveLength(2);
    expect(res.folderUid).toBeTruthy();

    const cIndex = (await local.get('collections_index')).collections_index;
    expect(cIndex[uid]).toBeUndefined();                       // original gone
    res.createdUids.forEach((u) => expect(cIndex[u].parentId).toBe(res.folderUid));

    const fIndex = (await local.get('folders_index')).folders_index;
    expect(fIndex[res.folderUid].name).toBe('Big One');
    expect(fIndex[res.folderUid].collectionCount).toBe(2);
});

test('applySplitCollectionPlan without folder leaves new collections at top level', async () => {
    const { uid } = await seedOriginal();
    const res = await split.applySplitCollectionPlan({ uid, plan, folder: null });
    const cIndex = (await local.get('collections_index')).collections_index;
    res.createdUids.forEach((u) => expect(cIndex[u].parentId).toBeNull());
    expect(res.folderUid).toBeNull();
});

test('undoSplitCollection restores the original and removes the new collections + folder', async () => {
    const { uid, tabs } = await seedOriginal();
    const res = await split.applySplitCollectionPlan({ uid, plan, folder: { name: 'Big One' } });
    const undo = await split.undoSplitCollection();

    expect(undo.success).toBe(true);
    const cIndex = (await local.get('collections_index')).collections_index;
    expect(cIndex[uid]).toBeDefined();                         // original back
    expect(cIndex[uid].order).toBe(5);
    res.createdUids.forEach((u) => expect(cIndex[u]).toBeUndefined());
    const original = (await local.get(`collection_${uid}`))[`collection_${uid}`];
    expect(original.tabs).toHaveLength(tabs.length);
    const fIndex = (await local.get('folders_index')).folders_index;
    expect(fIndex[res.folderUid]).toBeUndefined();
});

test('apply aborts cleanly if the collection no longer exists', async () => {
    const res = await split.applySplitCollectionPlan({ uid: 'ghost', plan, folder: null });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('missing');
});
