require('jest-webextension-mock');
const STORAGE_KEYS = { COLLECTIONS_INDEX: 'collections_index', COLLECTION_PREFIX: 'collection_', DELETED_COLLECTION_TOMBSTONES: 'deleted_collection_tombstones' };

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

global.TaboxAIStorage = require('../chrome/ai-storage.js'); // inject before requiring the sweep module
const sweep = require('../chrome/duplicate-sweep.js');
const KEY = 'duplicateSweep';

const seed = async () => {
  await local.clear();
  await local.set({
    [STORAGE_KEYS.COLLECTIONS_INDEX]: { A: { name: 'A', tabCount: 1 }, D: { name: 'D', tabCount: 1 } },
    [`${STORAGE_KEYS.COLLECTION_PREFIX}A`]: { uid: 'A', name: 'A', tabs: [{ uid: 'a1', url: 'https://x.com', title: 'X' }] },
    [`${STORAGE_KEYS.COLLECTION_PREFIX}D`]: { uid: 'D', name: 'D', tabs: [{ uid: 'd1', url: 'https://x.com', title: 'X home' }] },
    [KEY]: {
      createdAt: 1, scope: { type: 'all' }, history: [],
      groups: [{
        id: 'cross:A|D', kind: 'cross', collectionUids: ['A', 'D'], status: 'pending',
        recommendation: { recommendedKeeperUid: 'D', message: 'm', suggestedNewCollectionName: 'Shared', bestTitlePerUrl: [{ normalizedUrl: 'x.com', title: 'X home' }] },
        urls: [{ normalizedUrl: 'x.com', occurrences: [
          { collectionUid: 'A', tabUid: 'a1', title: 'X', url: 'https://x.com', position: 0 },
          { collectionUid: 'D', tabUid: 'd1', title: 'X home', url: 'https://x.com', position: 0 },
        ] }],
      }],
    },
  });
};
beforeEach(seed);

test('keep-one removes from non-keepers, keeps keeper, records undo', async () => {
  await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'keep-one', keeperUid: 'D' });
  expect((await local.get('collection_A')).collection_A.tabs).toHaveLength(0);
  expect((await local.get('collection_D')).collection_D.tabs).toHaveLength(1);
  const st = (await local.get(KEY))[KEY];
  expect(st.groups[0].status).toBe('resolved');
  expect(st.history).toHaveLength(1);
  expect(st.history[0].action).toBe('keep-one');
});

test('undo restores removed tabs and flips the group back to pending', async () => {
  await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'keep-one', keeperUid: 'D' });
  await sweep.undoDuplicateSweepLast();
  expect((await local.get('collection_A')).collection_A.tabs.map((t) => t.uid)).toEqual(['a1']);
  const st = (await local.get(KEY))[KEY];
  expect(st.groups[0].status).toBe('pending');
  expect(st.history).toHaveLength(0);
});

test('discard-all removes from every collection in the set', async () => {
  await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'discard-all' });
  expect((await local.get('collection_A')).collection_A.tabs).toHaveLength(0);
  expect((await local.get('collection_D')).collection_D.tabs).toHaveLength(0);
});

test('extract creates a new collection and removes originals; undo deletes it', async () => {
  await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'extract' });
  const idx = (await local.get('collections_index')).collections_index;
  const newUid = Object.keys(idx).find((u) => idx[u].name === 'Shared');
  expect(newUid).toBeTruthy();
  expect((await local.get(`collection_${newUid}`))[`collection_${newUid}`].tabs).toHaveLength(1);
  await sweep.undoDuplicateSweepLast();
  const idx2 = (await local.get('collections_index')).collections_index;
  expect(Object.keys(idx2).find((u) => idx2[u].name === 'Shared')).toBeUndefined();
  expect((await local.get('collection_A')).collection_A.tabs).toHaveLength(1);
});

test('dismiss clears the key', async () => {
  await sweep.dismissDuplicateSweep();
  expect((await local.get(KEY))[KEY]).toBeUndefined();
});

test('applying to an already-resolved group is rejected and adds no history', async () => {
  await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'discard-all' });
  const res = await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'discard-all' });
  expect(res).toEqual({ ok: false, reason: 'not-pending' });
  const st = (await local.get(KEY))[KEY];
  expect(st.history).toHaveLength(1);
});

test('undo restores full tab fidelity (pinned/favicon) when occurrence carries the tab', async () => {
  const st = (await local.get(KEY))[KEY];
  st.groups[0].urls[0].occurrences[0].tab = { uid: 'a1', url: 'https://x.com', title: 'X', pinned: true, favIconUrl: 'ic' };
  await local.set({ [KEY]: st });
  await sweep.applyDuplicateSweepAction({ groupId: 'cross:A|D', action: 'keep-one', keeperUid: 'D' });
  await sweep.undoDuplicateSweepLast();
  const restored = (await local.get('collection_A')).collection_A.tabs.find((t) => t.uid === 'a1');
  expect(restored.pinned).toBe(true);
  expect(restored.favIconUrl).toBe('ic');
});
