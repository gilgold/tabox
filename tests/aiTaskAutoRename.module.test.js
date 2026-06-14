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
