require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const registry = require('../chrome/ai-registry.js');
const { createEngine } = require('../chrome/ai-engine.js');
require('../chrome/ai-task-auto-rename.js'); // self-registers as 'auto-rename'

beforeEach(async () => { await browser.storage.local.clear(); });

function ctx(overrides = {}) {
  return {
    planners: require('../chrome/ai-planners.js'),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
              promptForJSON: jest.fn().mockResolvedValue({ name: 'Fresh' }) },
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
  const c = ctx({ client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
    promptForJSON: jest.fn().mockResolvedValue({ name: 'Old' }) } });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1'] } });
  expect(c.storage.renameCollectionsBG).not.toHaveBeenCalled();
  expect(res.undo).toEqual({ task: 'auto-rename', renames: [] });
});

test('auto-rename continues past a per-item AI error and applies the successful ones', async () => {
  let call = 0;
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([
      { uid: 'c1', name: 'O1', tabs: [] }, { uid: 'c2', name: 'O2', tabs: [] }, { uid: 'c3', name: 'O3', tabs: [] },
    ]),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockImplementation(async () => { call++; if (call === 2) throw new Error('transient'); return { name: `N${call}` }; }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1', 'c2', 'c3'] } });
  expect(res.status).toBe('done');
  expect(c.storage.renameCollectionsBG.mock.calls[0][0].map((r) => r.uid)).toEqual(['c1', 'c3']);
});

test('auto-rename applies already-completed renames then stops when cancelled mid-loop', async () => {
  let call = 0;
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'O1', tabs: [] }, { uid: 'c2', name: 'O2', tabs: [] }]),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockImplementation(async () => {
        call++;
        if (call === 1) { const s = (await browser.storage.local.get('aiTaskState')).aiTaskState; await browser.storage.local.set({ aiTaskState: { ...s, cancelRequested: true } }); return { name: 'New1' }; }
        return { name: 'New2' };
      }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1', 'c2'] } });
  expect(c.storage.renameCollectionsBG).toHaveBeenCalledWith([{ uid: 'c1', oldName: 'O1', newName: 'New1' }]);
  expect(res.status).toBe('cancelled');
});

test('auto-rename reuses a single AI session across the loop at temperature 0', async () => {
  const session = { prompt: jest.fn(), destroy: jest.fn() };
  const c = ctx({
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'O1', tabs: [] }, { uid: 'c2', name: 'O2', tabs: [] }]),
    client: { createAISession: jest.fn().mockResolvedValue(session), promptForJSON: jest.fn().mockResolvedValue({ name: 'Fresh' }) },
  });
  await createEngine({ registry, ctx: c }).runTask({ id: 'auto-rename', params: { uids: ['c1', 'c2'] } });
  expect(c.client.createAISession).toHaveBeenCalledTimes(1);
  expect(c.client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
  expect(session.destroy).toHaveBeenCalledTimes(1);
});
