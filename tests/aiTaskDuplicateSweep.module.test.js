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

const session = { destroy: jest.fn() };
const client = {
  createAISession: jest.fn().mockResolvedValue(session),
  promptForJSON: jest.fn().mockResolvedValue({ names: [{ index: 0, name: 'X Research' }] }),
};

const ctx = {
  planners, detect,
  client,
  loadCollections: async () => ([
    { uid: 'A', name: 'A', lastUpdated: 10, tabs: [{ uid: 'a1', url: 'https://x.com', title: 'X' }] },
    { uid: 'D', name: 'D', lastUpdated: 99, tabs: [{ uid: 'd1', url: 'https://x.com', title: 'X home' }] },
  ]),
};

beforeEach(() => {
  _store = {};
  jest.clearAllMocks();
  client.promptForJSON.mockResolvedValue({ names: [{ index: 0, name: 'X Research' }] });
});

test('detects duplicates, picks a deterministic keeper, and asks AI for the new collection name', async () => {
  const reports = [];
  const out = await task.run({ ctx, params: {}, report: async (p) => reports.push(p) });
  const st = _store.duplicateSweep;
  expect(st.groups).toHaveLength(1);
  // deterministic keeper = freshest collection (D, lastUpdated 99)
  expect(st.groups[0].recommendation.recommendedKeeperUid).toBe('D');
  expect(st.groups[0].recommendation.suggestedNewCollectionName).toBe('X Research');
  expect(st.groups[0].status).toBe('pending');
  expect(client.createAISession).toHaveBeenCalledTimes(1);
  expect(client.promptForJSON).toHaveBeenCalledTimes(1);
  expect(client.promptForJSON.mock.calls[0][1]).toContain('X home');
  expect(session.destroy).toHaveBeenCalledTimes(1);
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
  expect(client.createAISession).not.toHaveBeenCalled();
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
  expect(client.createAISession).not.toHaveBeenCalled();
});

test('cross-collection duplicates with differing titles still get a deterministic keeper', async () => {
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

test('maps every batched AI name back to its duplicate group by index', async () => {
  client.promptForJSON.mockResolvedValue({
    names: [{ index: 1, name: 'Y Dashboards' }, { index: 0, name: 'X Research' }],
  });
  const multiCtx = {
    ...ctx,
    loadCollections: async () => ([
      { uid: 'A', name: 'A', tabs: [
        { uid: 'a1', url: 'https://x.com', title: 'X Research' },
        { uid: 'a2', url: 'https://y.com', title: 'Y Dashboard' },
        { uid: 'a3', url: 'https://y.com', title: 'Y Dashboard copy' },
      ] },
      { uid: 'D', name: 'D', tabs: [{ uid: 'd1', url: 'https://x.com', title: 'X home' }] },
    ]),
  };

  await task.run({ ctx: multiCtx, params: {}, report: async () => {} });
  const names = _store.duplicateSweep.groups.map((g) => g.recommendation.suggestedNewCollectionName);
  expect(names).toEqual(['X Research', 'Y Dashboards']);
});

test('runs duplicate-group naming batches concurrently', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const groups = Array.from({ length: 25 }, (_, index) => ({
    id: `within:A:${index}`,
    kind: 'within',
    collectionUids: ['A'],
    urls: [{
      normalizedUrl: `example.com/${index}`,
      occurrences: [{ title: `Example ${index}`, url: `https://example.com/${index}` }],
    }],
    status: 'pending',
    recommendation: null,
  }));
  const concurrentClient = {
    createAISession: jest.fn().mockResolvedValue({ destroy: jest.fn() }),
    promptForJSON: jest.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { names: Array.from({ length: 10 }, (_, index) => ({ index, name: `Group ${index}` })) };
    }),
  };
  const concurrentCtx = {
    ...ctx,
    client: concurrentClient,
    detect: { detectDuplicateGroups: () => ({ groups }) },
    loadCollections: async () => ([{ uid: 'A', name: 'A', tabs: [] }]),
  };

  await task.run({ ctx: concurrentCtx, params: {}, report: async () => {} });
  expect(concurrentClient.promptForJSON).toHaveBeenCalledTimes(3);
  expect(maxInFlight).toBeGreaterThan(1);
  expect(_store.duplicateSweep.groups).toHaveLength(25);
});

test('falls back to Shared Tabs when AI naming fails', async () => {
  client.promptForJSON.mockRejectedValue(new Error('model unavailable'));
  await task.run({ ctx, params: {}, report: async () => {} });
  expect(_store.duplicateSweep.groups[0].recommendation.suggestedNewCollectionName).toBe('Shared Tabs');
  expect(session.destroy).toHaveBeenCalledTimes(1);
});

test('forwards the task abort signal to AI naming', async () => {
  const signal = new AbortController().signal;
  await task.run({ ctx, params: {}, signal, report: async () => {} });
  expect(client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ signal }));
  expect(client.promptForJSON.mock.calls[0][3]).toBe(signal);
});
