require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const registry = require('../chrome/ai-registry.js');
const { createEngine, requestCancel } = require('../chrome/ai-engine.js');
require('../chrome/ai-task-split-collection.js'); // self-registers as 'split-collection'

beforeEach(async () => { await browser.storage.local.clear(); });

const planners = require('../chrome/ai-planners.js');

const makeTabs = (n) => Array.from({ length: n }, (_, i) => ({ title: `T${i}`, url: `https://s${i}.com` }));

function ctx(overrides = {}) {
  return {
    planners,
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() }),
              promptForJSON: jest.fn() },
    storage: {},
    loadCollections: jest.fn().mockResolvedValue([]),
    triggerSync: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const run = (c, uid = 'c1') => createEngine({ registry, ctx: c }).runTask({ id: 'split-collection', params: { uid } });

const readResults = async () => ((await browser.storage.local.get('aiTaskState')).aiTaskState || {}).results;

test('missing collection reports ok:false', async () => {
  const c = ctx();
  const res = await run(c, 'nope');
  expect(res.status).toBe('done');
  expect(await readResults()).toEqual({ ok: false, reason: 'missing' });
});

test('small collection (≤ single-shot max) splits with ONE request', async () => {
  const tabs = makeTabs(40);
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Big', tabs }]),
  });
  c.client.promptForJSON.mockResolvedValue({ groups: [
    { name: 'Alpha', tabIndices: Array.from({ length: 20 }, (_, i) => i + 1) },
    { name: 'Beta', tabIndices: Array.from({ length: 20 }, (_, i) => i + 21) },
  ] });
  const res = await run(c);
  expect(res.status).toBe('done');
  expect(c.client.promptForJSON).toHaveBeenCalledTimes(1);
  const results = await readResults();
  expect(results.ok).toBe(true);
  expect(results.groups.map((g) => g.name)).toEqual(['Alpha', 'Beta']);
});

test('large collection uses two-phase: one themes call + parallel assignment batches', async () => {
  const tabs = makeTabs(100);
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Huge', tabs }]),
  });
  let inFlight = 0;
  let maxInFlight = 0;
  c.client.promptForJSON.mockImplementation(async (_s, prompt) => {
    if (prompt.includes('Propose')) return { themes: [{ name: 'Work' }, { name: 'Play' }] };
    // Assignment batch: echo every listed global tab number, alternating themes.
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const nums = [...prompt.matchAll(/^(\d+)\. T/gm)].map((m) => parseInt(m[1], 10));
    return { assignments: nums.map((n) => ({ tab: n, theme: (n % 2) + 1 })) };
  });
  const res = await run(c);
  expect(res.status).toBe('done');
  // 1 themes call + ceil(100/SPLIT_ASSIGN_BATCH) assignment calls.
  const expectedBatches = Math.ceil(100 / planners.SPLIT_ASSIGN_BATCH);
  expect(c.client.promptForJSON).toHaveBeenCalledTimes(1 + expectedBatches);
  expect(maxInFlight).toBeGreaterThan(1); // batches ran concurrently
  const results = await readResults();
  expect(results.ok).toBe(true);
  // Full partition: every tab lands in exactly one group.
  const all = results.groups.flatMap((g) => g.tabIndices).sort((a, b) => a - b);
  expect(all).toEqual(Array.from({ length: 100 }, (_, i) => i));
  expect(results.groups.map((g) => g.name)).toEqual(expect.arrayContaining(['Work', 'Play']));
});

test('a failed assignment batch sweeps its tabs into Misc instead of failing the scan', async () => {
  const tabs = makeTabs(80);
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Huge', tabs }]),
  });
  let batchCall = 0;
  c.client.promptForJSON.mockImplementation(async (_s, prompt) => {
    if (prompt.includes('Propose')) return { themes: [{ name: 'Work' }, { name: 'Play' }] };
    batchCall++;
    if (batchCall === 2) throw new Error('transient');
    const nums = [...prompt.matchAll(/^(\d+)\. T/gm)].map((m) => parseInt(m[1], 10));
    return { assignments: nums.map((n) => ({ tab: n, theme: 1 })) };
  });
  const res = await run(c);
  expect(res.status).toBe('done');
  const results = await readResults();
  expect(results.ok).toBe(true);
  const misc = results.groups.find((g) => g.name === 'Misc');
  expect(misc).toBeDefined();
  expect(misc.tabIndices.length).toBeGreaterThan(0);
  // Still a full partition.
  const all = results.groups.flatMap((g) => g.tabIndices).sort((a, b) => a - b);
  expect(all).toEqual(Array.from({ length: 80 }, (_, i) => i));
});

test('themes-call failure fails the scan (engine maps to error)', async () => {
  const tabs = makeTabs(80);
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Huge', tabs }]),
  });
  c.client.promptForJSON.mockRejectedValue(new Error('down'));
  const res = await run(c);
  expect(res.status).toBe('error');
});

test('cancelling mid-batches ends the run as cancelled', async () => {
  const tabs = makeTabs(200); // more batches than the concurrency pool
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Huge', tabs }]),
  });
  let batchCall = 0;
  c.client.promptForJSON.mockImplementation(async (_s, prompt) => {
    if (prompt.includes('Propose')) return { themes: [{ name: 'Work' }, { name: 'Play' }] };
    batchCall++;
    // Cancel via the production write path during the first batch.
    if (batchCall === 1) await requestCancel();
    const nums = [...prompt.matchAll(/^(\d+)\. T/gm)].map((m) => parseInt(m[1], 10));
    return { assignments: nums.map((n) => ({ tab: n, theme: 1 })) };
  });
  const res = await run(c);
  expect(res.status).toBe('cancelled');
  // Cancellation stopped later batches from starting.
  expect(batchCall).toBeLessThan(Math.ceil(200 / planners.SPLIT_ASSIGN_BATCH));
});

test('split passes the run abort signal to session and both phases so cancel kills in-flight fetches', async () => {
  const tabs = makeTabs(100);
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Huge', tabs }]),
  });
  c.client.promptForJSON.mockImplementation(async (_s, prompt) => {
    if (prompt.includes('Propose')) return { themes: [{ name: 'A' }, { name: 'B' }] };
    const nums = [...prompt.matchAll(/^(\d+)\. T/gm)].map((m) => parseInt(m[1], 10));
    return { assignments: nums.map((n) => ({ tab: n, theme: 1 })) };
  });
  const controller = new AbortController();
  await createEngine({ registry, ctx: c }).runTask({ id: 'split-collection', params: { uid: 'c1' }, signal: controller.signal });
  expect(c.client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  // Every promptForJSON call (themes + every batch) carries the signal.
  for (const call of c.client.promptForJSON.mock.calls) expect(call[3]).toBe(controller.signal);
});

test('single session is created once and destroyed across both phases', async () => {
  const session = { prompt: jest.fn(), clone: jest.fn(), destroy: jest.fn() };
  const tabs = makeTabs(100);
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'Huge', tabs }]),
  });
  c.client.createAISession.mockResolvedValue(session);
  c.client.promptForJSON.mockImplementation(async (_s, prompt) => {
    if (prompt.includes('Propose')) return { themes: [{ name: 'A' }, { name: 'B' }] };
    const nums = [...prompt.matchAll(/^(\d+)\. T/gm)].map((m) => parseInt(m[1], 10));
    return { assignments: nums.map((n) => ({ tab: n, theme: 1 })) };
  });
  await run(c);
  expect(c.client.createAISession).toHaveBeenCalledTimes(1);
  expect(session.destroy).toHaveBeenCalledTimes(1);
});
