require('jest-webextension-mock');
const STORAGE_KEYS = { COLLECTIONS_INDEX: 'collections_index', COLLECTION_PREFIX: 'collection_', DELETED_COLLECTION_TOMBSTONES: 'deleted_collection_tombstones' };
const store = require('../chrome/ai-storage.js');

let _store = {};
browser.storage.local.get = jest.fn(async (keys) => {
  if (keys == null) return { ..._store };
  if (typeof keys === 'string') return { [keys]: _store[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, _store[k]]));
  return Object.fromEntries(Object.keys(keys).map((k) => [k, _store[k]]));
});
browser.storage.local.set = jest.fn(async (payload) => { Object.assign(_store, payload); });
browser.storage.local.remove = jest.fn(async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete _store[k]); });
browser.storage.local.clear = jest.fn(async () => { _store = {}; });
const local = browser.storage.local;

const seed = async () => {
  await local.clear();
  await local.set({
    [STORAGE_KEYS.COLLECTIONS_INDEX]: { A: { name: 'A', tabCount: 2 } },
    [`${STORAGE_KEYS.COLLECTION_PREFIX}A`]: { uid: 'A', name: 'A', tabs: [
      { uid: 't1', url: 'https://x.com', title: 'X' }, { uid: 't2', url: 'https://y.com', title: 'Y' },
    ] },
  });
};

beforeEach(seed);

test('removeTabsFromCollectionsBG drops tabs by uid and updates tabCount', async () => {
  await store.removeTabsFromCollectionsBG([{ collectionUid: 'A', tabUids: ['t1'] }]);
  const rec = (await local.get('collection_A')).collection_A;
  const idx = (await local.get('collections_index')).collections_index;
  expect(rec.tabs.map((t) => t.uid)).toEqual(['t2']);
  expect(idx.A.tabCount).toBe(1);
});

test('restoreTabsToCollectionsBG re-inserts at original position', async () => {
  await store.removeTabsFromCollectionsBG([{ collectionUid: 'A', tabUids: ['t1'] }]);
  await store.restoreTabsToCollectionsBG([{ collectionUid: 'A', tab: { uid: 't1', url: 'https://x.com', title: 'X' }, position: 0 }]);
  const rec = (await local.get('collection_A')).collection_A;
  expect(rec.tabs.map((t) => t.uid)).toEqual(['t1', 't2']);
});

test('setTabTitlesBG updates a tab title', async () => {
  await store.setTabTitlesBG([{ collectionUid: 'A', tabUid: 't1', title: 'New X' }]);
  const rec = (await local.get('collection_A')).collection_A;
  expect(rec.tabs.find((t) => t.uid === 't1').title).toBe('New X');
});

test('createCollectionBG then deleteCollectionBG round-trips index + record + tombstone', async () => {
  const created = await store.createCollectionBG({ name: 'New', tabs: [{ uid: 'z1', url: 'https://z.com', title: 'Z' }] });
  expect(created.uid).toBeTruthy();
  let idx = (await local.get('collections_index')).collections_index;
  expect(idx[created.uid].name).toBe('New');
  await store.deleteCollectionBG(created.uid);
  idx = (await local.get('collections_index')).collections_index;
  const tombs = (await local.get('deleted_collection_tombstones')).deleted_collection_tombstones;
  expect(idx[created.uid]).toBeUndefined();
  expect(tombs[created.uid]).toBeTruthy();
});
