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

test('cancelled run does not write partial sweep state', async () => {
  let calls = 0;
  const cancelCtx = { ...ctx, isCancelled: async () => { calls += 1; return calls > 0; } };
  // seed a stale sweep to prove it is cleared
  _store.duplicateSweep = { createdAt: 0, scope: { type: 'all' }, groups: [{ id: 'stale' }], history: [] };
  const out = await task.run({ ctx: cancelCtx, params: {}, report: async () => {} });
  expect(_store.duplicateSweep).toBeUndefined();
  expect(out.summary).toMatch(/cancel/i);
});

test('publishes the sweep with a deterministic recommendation before the AI responds, then upgrades it', async () => {
  let stateWhenAIRuns;
  const c = { ...ctx, client: {
    createAISession: async () => ({ destroy() {} }),
    promptForJSON: async () => {
      stateWhenAIRuns = JSON.parse(JSON.stringify(_store.duplicateSweep));
      return { recommendedKeeper: 1, message: 'AI says keep in A.', suggestedNewCollectionName: 'Shared', titles: [] };
    },
  } };
  await task.run({ ctx: c, params: {}, report: async () => {} });
  // Sweep state was live (and usable) while inference was still in flight.
  expect(stateWhenAIRuns).toBeTruthy();
  expect(stateWhenAIRuns.groups[0].status).toBe('pending');
  expect(stateWhenAIRuns.groups[0].recommendation.recommendedKeeperUid).toBeTruthy();
  // The AI result replaced the deterministic placeholder afterwards.
  expect(_store.duplicateSweep.groups[0].recommendation.message).toBe('AI says keep in A.');
  expect(_store.duplicateSweep.groups[0].recommendation.recommendedKeeperUid).toBe('A');
});

test('prompts on a fresh session clone per group so context never accumulates', async () => {
  const prompted = [];
  const base = { clone: jest.fn(async () => ({ __clone: true, destroy: jest.fn() })), destroy: jest.fn() };
  const c = { ...ctx, client: {
    createAISession: async () => base,
    promptForJSON: async (session) => { prompted.push(session); return { recommendedKeeper: 2, message: 'm', suggestedNewCollectionName: 'S', titles: [] }; },
  } };
  await task.run({ ctx: c, params: {}, report: async () => {} });
  expect(base.clone).toHaveBeenCalledTimes(1);
  expect(prompted).toHaveLength(1);
  expect(prompted[0].__clone).toBe(true);
});

test('does not overwrite a group the user resolved while the AI was thinking', async () => {
  const c = { ...ctx, client: {
    createAISession: async () => ({ destroy() {} }),
    promptForJSON: async () => {
      // Simulate the user acting on the group mid-inference.
      _store.duplicateSweep.groups[0].status = 'resolved';
      return { recommendedKeeper: 2, message: 'late AI opinion', suggestedNewCollectionName: 'S', titles: [] };
    },
  } };
  await task.run({ ctx: c, params: {}, report: async () => {} });
  expect(_store.duplicateSweep.groups[0].status).toBe('resolved');
  expect(_store.duplicateSweep.groups[0].recommendation.message).not.toBe('late AI opinion');
});

test('stops refining when the user ends the sweep mid-run', async () => {
  const promptForJSON = jest.fn(async () => {
    // Simulate "End sweep" while the first inference is in flight.
    delete _store.duplicateSweep;
    return { recommendedKeeper: 2, message: 'm', suggestedNewCollectionName: 'S', titles: [] };
  });
  const c = { ...ctx,
    client: { createAISession: async () => ({ destroy() {} }), promptForJSON },
    loadCollections: async () => ([
      { uid: 'A', name: 'A', tabs: [
        { uid: 'a1', url: 'https://x.com', title: 'X' },
        { uid: 'a2', url: 'https://y.com', title: 'Y' },
      ] },
      { uid: 'D', name: 'D', tabs: [
        { uid: 'd1', url: 'https://x.com', title: 'X home' },
        { uid: 'd2', url: 'https://y.com', title: 'Y home' },
      ] },
      { uid: 'E', name: 'E', tabs: [{ uid: 'e1', url: 'https://y.com', title: 'Y other' }] },
    ]),
  };
  await task.run({ ctx: c, params: {}, report: async () => {} });
  expect(promptForJSON).toHaveBeenCalledTimes(1);
  expect(_store.duplicateSweep).toBeUndefined();
});

test('skips the AI entirely for cross groups whose copies share the same title', async () => {
  const noAiCtx = {
    planners, detect,
    client: {
      createAISession: async () => { throw new Error('AI should not be called for identical titles'); },
      promptForJSON: async () => { throw new Error('AI should not be called for identical titles'); },
    },
    loadCollections: async () => ([
      { uid: 'A', name: 'Work', lastUpdated: 10, tabs: [{ uid: 'a1', url: 'https://x.com', title: 'Same Title' }] },
      { uid: 'D', name: 'Reference', lastUpdated: 99, tabs: [{ uid: 'd1', url: 'https://x.com', title: 'Same Title' }] },
    ]),
  };
  const reports = [];
  const out = await task.run({ ctx: noAiCtx, params: {}, report: async (p) => reports.push(p) });
  const st = _store.duplicateSweep;
  expect(st.groups).toHaveLength(1);
  // deterministic keeper = freshest collection (D, lastUpdated 99)
  expect(st.groups[0].recommendation.recommendedKeeperUid).toBe('D');
  expect(st.groups[0].recommendation.message).toContain('Reference');
  // total reported is 0 AI groups
  expect(reports[0]).toEqual({ total: 0, filed: 0 });
  expect(out.summary).toContain('duplicate');
});
