require('jest-webextension-mock');
let _store = {};
browser.storage.local.get = jest.fn(async (keys) => {
  if (keys == null) return { ..._store };
  if (typeof keys === 'string') return { [keys]: _store[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, _store[k]]));
  return Object.fromEntries(Object.keys(keys).map((k) => [k, _store[k]]));
});
browser.storage.local.set = jest.fn(async (payload) => { Object.assign(_store, payload); });
browser.storage.local.remove = jest.fn(async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete _store[k]); });

global.TaboxAIRegistry = { register: (def) => { global.__task = def; } };
const planners = require('../chrome/ai-planners.js');
const detect = require('../chrome/duplicate-detect.js');
require('../chrome/ai-task-duplicate-sweep.js');
const task = global.__task;

const ctx = {
  planners, detect,
  client: {
    createAISession: async () => ({ destroy() {} }),
    promptForJSON: async () => ({ recommendedKeeper: 2, message: 'Keep in D.', suggestedNewCollectionName: 'Shared', titles: [] }),
  },
  loadCollections: async () => ([
    { uid: 'A', name: 'A', tabs: [{ uid: 'a1', url: 'https://x.com', title: 'X' }] },
    { uid: 'D', name: 'D', tabs: [{ uid: 'd1', url: 'https://x.com', title: 'X home' }] },
  ]),
};

beforeEach(() => { _store = {}; });

test('detects, enriches cross groups with AI recommendation, writes duplicateSweep, no mutation', async () => {
  const reports = [];
  const out = await task.run({ ctx, params: {}, report: async (p) => reports.push(p) });
  const st = _store.duplicateSweep;
  expect(st.groups).toHaveLength(1);
  expect(st.groups[0].recommendation.recommendedKeeperUid).toBe('D');
  expect(st.groups[0].status).toBe('pending');
  expect(out.summary).toContain('duplicate');
  expect(reports.length).toBeGreaterThan(0);
});

test('within-only duplicates get a templated recommendation (no AI call)', async () => {
  const withinCtx = { ...ctx,
    client: { createAISession: async () => { throw new Error('should not be called'); }, promptForJSON: async () => { throw new Error('no'); } },
    loadCollections: async () => ([
      { uid: 'A', name: 'A', tabs: [
        { uid: 'a1', url: 'https://x.com', title: 'X' },
        { uid: 'a2', url: 'https://x.com', title: 'X dup' },
      ] },
    ]),
  };
  await task.run({ ctx: withinCtx, params: {}, report: async () => {} });
  const st = _store.duplicateSweep;
  expect(st.groups).toHaveLength(1);
  expect(st.groups[0].kind).toBe('within');
  expect(st.groups[0].recommendation.recommendedKeeperUid).toBe('A');
});

test('no duplicates -> writes empty groups and a no-op summary', async () => {
  const emptyCtx = { ...ctx, loadCollections: async () => ([{ uid: 'A', name: 'A', tabs: [{ uid: 'a1', url: 'https://x.com', title: 'X' }] }]) };
  await task.run({ ctx: emptyCtx, params: {}, report: async () => {} });
  expect(_store.duplicateSweep.groups).toEqual([]);
});

test('params.uids scopes detection to selected collections', async () => {
  await task.run({ ctx, params: { uids: ['A'] }, report: async () => {} });
  // Only collection A in scope -> the cross-collection dup with D is not detected.
  expect(_store.duplicateSweep.groups).toEqual([]);
  expect(_store.duplicateSweep.scope).toEqual({ type: 'selected', uids: ['A'] });
});
