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

// The duplicate-sweep task is pure local code: detection + deterministic
// recommendations, no model call. Any client method being invoked is a bug.
const noClient = {
  createAISession: async () => { throw new Error('duplicate-sweep must not create an AI session'); },
  promptForJSON: async () => { throw new Error('duplicate-sweep must not call the model'); },
};

const ctx = {
  planners, detect,
  client: noClient,
  loadCollections: async () => ([
    { uid: 'A', name: 'A', lastUpdated: 10, tabs: [{ uid: 'a1', url: 'https://x.com', title: 'X' }] },
    { uid: 'D', name: 'D', lastUpdated: 99, tabs: [{ uid: 'd1', url: 'https://x.com', title: 'X home' }] },
  ]),
};

beforeEach(() => { _store = {}; });

test('detects cross-collection duplicates and writes a deterministic recommendation, no mutation', async () => {
  const reports = [];
  const out = await task.run({ ctx, params: {}, report: async (p) => reports.push(p) });
  const st = _store.duplicateSweep;
  expect(st.groups).toHaveLength(1);
  // deterministic keeper = freshest collection (D, lastUpdated 99)
  expect(st.groups[0].recommendation.recommendedKeeperUid).toBe('D');
  expect(st.groups[0].status).toBe('pending');
  expect(out.summary).toContain('duplicate');
  expect(reports.length).toBeGreaterThan(0);
});

test('within-only duplicates get a templated recommendation', async () => {
  const withinCtx = { ...ctx,
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

test('cancelled run does not write partial sweep state', async () => {
  const cancelCtx = { ...ctx, isCancelled: async () => true };
  // seed a stale sweep to prove it is cleared
  _store.duplicateSweep = { createdAt: 0, scope: { type: 'all' }, groups: [{ id: 'stale' }], history: [] };
  const out = await task.run({ ctx: cancelCtx, params: {}, report: async () => {} });
  expect(_store.duplicateSweep).toBeUndefined();
  expect(out.summary).toMatch(/cancel/i);
});

test('cross-collection duplicates with differing titles still get a deterministic keeper (no model call)', async () => {
  const c = { ...ctx,
    loadCollections: async () => ([
      { uid: 'A', name: 'Work', lastUpdated: 10, tabs: [{ uid: 'a1', url: 'https://x.com', title: 'X' }] },
      { uid: 'D', name: 'Reference', lastUpdated: 99, tabs: [{ uid: 'd1', url: 'https://x.com', title: 'X Home' }] },
    ]),
  };
  await task.run({ ctx: c, params: {}, report: async () => {} });
  const st = _store.duplicateSweep;
  expect(st.groups).toHaveLength(1);
  expect(st.groups[0].recommendation.recommendedKeeperUid).toBe('D');
  expect(st.groups[0].recommendation.message).toContain('Reference');
});
