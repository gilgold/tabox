require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const registry = require('../chrome/ai-registry.js');
const { createEngine } = require('../chrome/ai-engine.js');

beforeEach(async () => { await browser.storage.local.clear(); registry._reset(); });

function ctx(overrides = {}) {
  return { storage: {}, loadCollections: jest.fn(), readWindow: jest.fn(),
           triggerSync: jest.fn().mockResolvedValue(true), client: {}, planners: {}, ...overrides };
}

test('engine runs ANY registered task and writes the full aiTaskState lifecycle', async () => {
  registry.register({
    id: 'demo',
    async run({ report }) { await report({ total: 2, filed: 1, currentLabel: 'x' }); return { summary: 'done demo', undo: { task: 'demo', n: 1 } }; },
    async undo() {},
  });
  const engine = createEngine({ registry, ctx: ctx() });
  const res = await engine.runTask({ id: 'demo', params: {} });
  expect(res.status).toBe('done');
  expect(res.type).toBe('demo');
  expect(res.summary).toBe('done demo');
  expect(res.undo).toEqual({ task: 'demo', n: 1 });
  const persisted = (await browser.storage.local.get('aiTaskState')).aiTaskState;
  expect(persisted.status).toBe('done');
  expect(persisted.total).toBe(2);
});

test('engine maps a task throw to status:error without rejecting', async () => {
  registry.register({ id: 'boom', async run() { throw new Error('kaboom'); }, async undo() {} });
  const res = await createEngine({ registry, ctx: ctx() }).runTask({ id: 'boom', params: {} });
  expect(res.status).toBe('error');
  expect((await browser.storage.local.get('aiTaskState')).aiTaskState.status).toBe('error');
});

test('engine marks cancelled when the signal aborts mid-run', async () => {
  registry.register({ id: 'cancellable', async run({ signal }) { if (signal.aborted) return { summary: '', undo: null }; const e = new Error('a'); e.name = 'AbortError'; throw e; }, async undo() {} });
  const controller = new AbortController(); controller.abort();
  const res = await createEngine({ registry, ctx: ctx() }).runTask({ id: 'cancellable', params: {}, signal: controller.signal });
  expect(res.status).toBe('cancelled');
});

test('undoLast dispatches to the task named in the stored snapshot', async () => {
  const undoSpy = jest.fn();
  registry.register({ id: 'demo', async run() { return { summary: '', undo: { task: 'demo' } }; }, undo: undoSpy });
  await browser.storage.local.set({ aiTaskState: { undo: { task: 'demo', x: 1 } } });
  await createEngine({ registry, ctx: ctx() }).undoLast();
  expect(undoSpy).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { task: 'demo', x: 1 } }));
  expect((await browser.storage.local.get('aiTaskState')).aiTaskState).toBeFalsy(); // cleared
});

test('unknown task id resolves to status:error (no crash)', async () => {
  const res = await createEngine({ registry, ctx: ctx() }).runTask({ id: 'nope', params: {} });
  expect(res.status).toBe('error');
});

test('report() persists incremental progress mid-run', async () => {
  const seen = [];
  const origSet = browser.storage.local.set;
  browser.storage.local.set = jest.fn(async (payload) => {
    if (payload.aiTaskState) seen.push(payload.aiTaskState.filed);
    return origSet(payload);
  });
  registry.register({ id: 'prog', async run({ report }) { await report({ filed: 1 }); await report({ filed: 2 }); return { summary: '', undo: null }; }, async undo() {} });
  await createEngine({ registry, ctx: ctx() }).runTask({ id: 'prog', params: {} });
  browser.storage.local.set = origSet;
  expect(seen).toEqual(expect.arrayContaining([1, 2]));
});

test('undoLast is a no-op when there is no undo snapshot', async () => {
  await browser.storage.local.set({ aiTaskState: { undo: null } });
  await expect(createEngine({ registry, ctx: ctx() }).undoLast()).resolves.toBeUndefined();
});

test('undoItems delegates to the task, flags reverted results, trims the snapshot, and keeps state', async () => {
  const undoItemsSpy = jest.fn();
  registry.register({
    id: 'demo', async run() { return { summary: '', undo: { task: 'demo' } }; },
    async undo() {}, undoItems: undoItemsSpy,
  });
  await browser.storage.local.set({ aiTaskState: {
    type: 'demo', status: 'done',
    results: [{ uid: 'a', x: 1 }, { uid: 'b', x: 2 }],
    undo: { task: 'demo', renames: [{ uid: 'a' }, { uid: 'b' }] },
  } });

  await createEngine({ registry, ctx: ctx() }).undoItems({ uids: ['a'] });

  expect(undoItemsSpy).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: { task: 'demo', renames: [{ uid: 'a' }, { uid: 'b' }] }, uids: ['a'],
  }));
  const st = (await browser.storage.local.get('aiTaskState')).aiTaskState;
  expect(st).toBeTruthy(); // NOT cleared
  expect(st.results).toEqual([{ uid: 'a', x: 1, reverted: true }, { uid: 'b', x: 2 }]);
  expect(st.undo).toEqual({ task: 'demo', renames: [{ uid: 'b' }] });
});

test('undoItems nulls the undo snapshot once every rename is reverted', async () => {
  registry.register({ id: 'demo', async run() { return { summary: '', undo: null }; }, async undo() {}, undoItems: jest.fn() });
  await browser.storage.local.set({ aiTaskState: {
    type: 'demo', status: 'done', results: [{ uid: 'a' }], undo: { task: 'demo', renames: [{ uid: 'a' }] },
  } });
  await createEngine({ registry, ctx: ctx() }).undoItems({ uids: ['a'] });
  const st = (await browser.storage.local.get('aiTaskState')).aiTaskState;
  expect(st.undo).toBeNull();
  expect(st.results).toEqual([{ uid: 'a', reverted: true }]);
});

test('undoItems is a no-op without a snapshot or with empty uids', async () => {
  const undoItemsSpy = jest.fn();
  registry.register({ id: 'demo', async run() { return { summary: '', undo: null }; }, async undo() {}, undoItems: undoItemsSpy });
  await browser.storage.local.set({ aiTaskState: { type: 'demo', status: 'done', results: [], undo: null } });
  const engine = createEngine({ registry, ctx: ctx() });
  await engine.undoItems({ uids: ['a'] }); // no snapshot
  await browser.storage.local.set({ aiTaskState: { type: 'demo', status: 'done', results: [], undo: { task: 'demo', renames: [] } } });
  await engine.undoItems({ uids: [] }); // empty uids
  expect(undoItemsSpy).not.toHaveBeenCalled();
});
