require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const registry = require('../chrome/ai-registry.js');
const { createEngine, requestCancel } = require('../chrome/ai-engine.js');
require('../chrome/ai-task-auto-rename.js'); // self-registers as 'auto-rename'

beforeEach(async () => { await browser.storage.local.clear(); });

function ctx(overrides = {}) {
  return {
    planners: require('../chrome/ai-planners.js'),
    // Batch response: one { index, name } per collection in the request. A
    // generous fixed index range covers any batch size the task sends.
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
              promptForJSON: jest.fn().mockResolvedValue({ names: Array.from({ length: 10 }, (_, i) => ({ index: i, name: 'Fresh' })) }) },
    storage: { renameCollectionsBG: jest.fn().mockResolvedValue(true) },
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Old', tabs: [] }]),
    triggerSync: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

test('auto-rename applies names and records an undo snapshot tagged with its id', async () => {
  const c = ctx();
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1'] } });
  expect(c.storage.renameCollectionsBG).toHaveBeenCalledWith([{ uid: 'c1', oldName: 'Old', newName: 'Fresh' }]);
  expect(c.triggerSync).toHaveBeenCalled();
  expect(res.status).toBe('done');
  expect(res.undo).toEqual({ task: 'auto-rename', renames: [{ uid: 'c1', oldName: 'Old', newName: 'Fresh' }] });
});

test('auto-rename still resolves done when sync is disabled', async () => {
  const c = ctx({ triggerSync: jest.fn().mockResolvedValue(false) });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1'] } });
  expect(res.status).toBe('done');
  expect(c.storage.renameCollectionsBG).toHaveBeenCalled();
});

test('auto-rename skips a collection whose suggested name is unchanged', async () => {
  const c = ctx({ client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
    promptForJSON: jest.fn().mockResolvedValue({ names: [{ index: 0, name: 'Old' }] }) } });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1'] } });
  expect(c.storage.renameCollectionsBG).not.toHaveBeenCalled();
  expect(res.undo).toEqual({ task: 'auto-rename', renames: [] });
});

test('auto-rename names many collections per request (batched), not one request each', async () => {
  const cols = Array.from({ length: 25 }, (_, i) => ({ uid: `c${i}`, name: `O${i}`, tabs: [] }));
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue(cols),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockImplementation(async () => ({ names: Array.from({ length: 10 }, (_, i) => ({ index: i, name: `Fresh${i}` })) })) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: cols.map((x) => x.uid) } });
  expect(res.status).toBe('done');
  // 25 collections at 10 per batch → 3 requests, NOT 25.
  expect(c.client.promptForJSON).toHaveBeenCalledTimes(3);
  // All 25 renamed, in original order.
  expect(c.storage.renameCollectionsBG.mock.calls[0][0].map((r) => r.uid)).toEqual(cols.map((x) => x.uid));
});

test('auto-rename skips a collection the batch response omits (enforces 1:1 index mapping)', async () => {
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([
      { uid: 'c1', name: 'O1', tabs: [] }, { uid: 'c2', name: 'O2', tabs: [] }, { uid: 'c3', name: 'O3', tabs: [] },
    ]),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
      // Model omits index 1 (c2) — it must not steal another collection's name.
      promptForJSON: jest.fn().mockResolvedValue({ names: [{ index: 0, name: 'N1' }, { index: 2, name: 'N3' }] }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1', 'c2', 'c3'] } });
  expect(res.status).toBe('done');
  expect(c.storage.renameCollectionsBG.mock.calls[0][0].map((r) => r.uid)).toEqual(['c1', 'c3']);
});

test('auto-rename skips every collection in a batch whose request throws', async () => {
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'O1', tabs: [] }, { uid: 'c2', name: 'O2', tabs: [] }]),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockRejectedValue(new Error('transient')) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1', 'c2'] } });
  expect(res.status).toBe('done');
  expect(c.storage.renameCollectionsBG).not.toHaveBeenCalled();
});

test('auto-rename runs batches concurrently, not one at a time', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const cols = Array.from({ length: 25 }, (_, i) => ({ uid: `c${i}`, name: `O${i}`, tabs: [] }));
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue(cols),
    client: {
      createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return { names: Array.from({ length: 10 }, (_, i) => ({ index: i, name: 'Fresh' })) };
      }),
    },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: cols.map((x) => x.uid) } });
  expect(res.status).toBe('done');
  expect(maxInFlight).toBeGreaterThan(1); // proves parallel batches — sequential would cap at 1
  expect(c.storage.renameCollectionsBG.mock.calls[0][0].map((r) => r.uid)).toEqual(cols.map((x) => x.uid));
});

test('auto-rename applies in-flight batches then stops starting new ones when cancelled mid-run', async () => {
  // More batches than the concurrency limit so cancelling during the first
  // in-flight batches leaves later batches' collections never started.
  const cols = Array.from({ length: 45 }, (_, i) => ({ uid: `c${i}`, name: `O${i}`, tabs: [] }));
  let call = 0;
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue(cols),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockImplementation(async () => {
        call++;
        // Cancel via the same serialized write path production uses (aiCancel),
        // so it can't be clobbered by concurrent report() writes.
        if (call === 1) await requestCancel();
        return { names: Array.from({ length: 10 }, (_, i) => ({ index: i, name: `New${call}-${i}` })) };
      }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: cols.map((x) => x.uid) } });
  expect(res.status).toBe('cancelled');
  // Some renames were applied (the in-flight batches)...
  const applied = c.storage.renameCollectionsBG.mock.calls[0][0].map((r) => r.uid);
  expect(applied.length).toBeGreaterThan(0);
  // ...but not all — later batches' collections were never started.
  expect(applied.length).toBeLessThan(cols.length);
  expect(applied).not.toContain('c44');
});

test('auto-rename reuses a single AI session across all batches at temperature 0', async () => {
  const session = { prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() };
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'O1', tabs: [] }, { uid: 'c2', name: 'O2', tabs: [] }]),
    client: { createAISession: jest.fn().mockResolvedValue(session), promptForJSON: jest.fn().mockResolvedValue({ names: [{ index: 0, name: 'Fresh' }, { index: 1, name: 'Fresh2' }] }) },
  });
  await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1', 'c2'] } });
  expect(c.client.createAISession).toHaveBeenCalledTimes(1);
  expect(c.client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
  expect(session.destroy).toHaveBeenCalledTimes(1);
});

test('auto-rename passes the run abort signal to session and requests so cancel kills in-flight fetches', async () => {
  const c = ctx();
  const controller = new AbortController();
  await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1'] }, signal: controller.signal });
  expect(c.client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  // promptForJSON(session, prompt, schema, signal)
  expect(c.client.promptForJSON.mock.calls[0][3]).toBe(controller.signal);
});

test('undoItems reverts the requested uids in a single batched rename', async () => {
  const c = ctx();
  await browser.storage.local.set({ aiTaskState: {
    type: 'auto-rename', status: 'done',
    results: [{ uid: 'c1', oldName: 'Old', newName: 'Fresh' }, { uid: 'c2', oldName: 'O2', newName: 'N2' }],
    undo: { task: 'auto-rename', renames: [
      { uid: 'c1', oldName: 'Old', newName: 'Fresh' }, { uid: 'c2', oldName: 'O2', newName: 'N2' },
    ] },
  } });

  await createEngine({ registry, ctx: c }).undoItems({ uids: ['c1'] });

  expect(c.storage.renameCollectionsBG).toHaveBeenCalledTimes(1);
  expect(c.storage.renameCollectionsBG).toHaveBeenCalledWith([{ uid: 'c1', oldName: 'Fresh', newName: 'Old' }]);
  expect(c.triggerSync).toHaveBeenCalledTimes(1);
});

test('undoItems batches an "undo all" into one rename call', async () => {
  const c = ctx();
  await browser.storage.local.set({ aiTaskState: {
    type: 'auto-rename', status: 'done',
    results: [{ uid: 'c1', oldName: 'A', newName: 'AA' }, { uid: 'c2', oldName: 'B', newName: 'BB' }],
    undo: { task: 'auto-rename', renames: [
      { uid: 'c1', oldName: 'A', newName: 'AA' }, { uid: 'c2', oldName: 'B', newName: 'BB' },
    ] },
  } });

  await createEngine({ registry, ctx: c }).undoItems({ uids: ['c1', 'c2'] });

  expect(c.storage.renameCollectionsBG).toHaveBeenCalledTimes(1);
  expect(c.storage.renameCollectionsBG).toHaveBeenCalledWith([
    { uid: 'c1', oldName: 'AA', newName: 'A' }, { uid: 'c2', oldName: 'BB', newName: 'B' },
  ]);
  expect(c.triggerSync).toHaveBeenCalledTimes(1);
});

test('undoItems is a no-op when none of the uids are in the snapshot', async () => {
  const c = ctx();
  await browser.storage.local.set({ aiTaskState: {
    type: 'auto-rename', status: 'done',
    results: [{ uid: 'c1', oldName: 'A', newName: 'AA' }],
    undo: { task: 'auto-rename', renames: [{ uid: 'c1', oldName: 'A', newName: 'AA' }] },
  } });
  await createEngine({ registry, ctx: c }).undoItems({ uids: ['zzz'] });
  expect(c.storage.renameCollectionsBG).not.toHaveBeenCalled();
});
