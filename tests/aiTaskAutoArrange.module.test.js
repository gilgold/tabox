require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const registry = require('../chrome/ai-registry.js');
const { createEngine } = require('../chrome/ai-engine.js');
require('../chrome/ai-task-auto-arrange.js');

beforeEach(async () => { await browser.storage.local.clear(); });

function baseCtx(overrides = {}) {
  return {
    planners: require('../chrome/ai-planners.js'),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
              promptForJSON: jest.fn().mockResolvedValue({ assignments: [{ collectionId: 'c1', existingFolderId: null, newFolderName: 'Reading' }] }) },
    storage: {
      loadFoldersIndexBG: jest.fn().mockResolvedValue({}),
      loadCollectionsIndexBG: jest.fn().mockResolvedValue({ c1: { parentId: null } }),
      createFolderBG: jest.fn().mockResolvedValue({ uid: 'f-new' }),
      moveCollectionsToFoldersBG: jest.fn().mockResolvedValue(true),
      updateFolderCountsBG: jest.fn().mockResolvedValue(true),
      deleteFolderBG: jest.fn().mockResolvedValue(true),
    },
    loadCollections: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'A', tabs: [], parentId: null }]),
    triggerSync: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

test('auto-arrange creates a folder, moves the collection, records undo, triggers sync', async () => {
  const c = baseCtx();
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.storage.createFolderBG).toHaveBeenCalledWith('Reading', expect.any(String), true);
  expect(c.storage.moveCollectionsToFoldersBG).toHaveBeenCalledWith([{ uid: 'c1', parentId: 'f-new' }]);
  expect(c.triggerSync).toHaveBeenCalled();
  expect(res.status).toBe('done');
  expect(res.undo).toEqual({ task: 'auto-arrange', moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: ['f-new'] });
});

test('auto-arrange assigns to an existing folder without creating one', async () => {
  const base = baseCtx();
  const c = baseCtx({
    storage: { ...base.storage, loadFoldersIndexBG: jest.fn().mockResolvedValue({ f1: { name: 'Work' } }), loadCollectionsIndexBG: jest.fn().mockResolvedValue({ c1: { parentId: null } }) },
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockResolvedValue({ assignments: [{ collectionId: 'c1', existingFolderId: 'f1', newFolderName: null }] }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.storage.createFolderBG).not.toHaveBeenCalled();
  expect(c.storage.moveCollectionsToFoldersBG).toHaveBeenCalledWith([{ uid: 'c1', parentId: 'f1' }]);
  expect(res.undo.createdFolderUids).toEqual([]);
});

test('auto-arrange undo restores parentId and deletes the now-empty created folder', async () => {
  const c = baseCtx({ storage: { ...baseCtx().storage, loadCollectionsIndexBG: jest.fn().mockResolvedValue({}) } });
  const engine = createEngine({ registry, ctx: c });
  await browser.storage.local.set({ aiTaskState: { undo: { task: 'auto-arrange', moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: ['f-new'] } } });
  await engine.undoLast();
  expect(c.storage.moveCollectionsToFoldersBG).toHaveBeenCalledWith([{ uid: 'c1', parentId: null }]);
  expect(c.storage.deleteFolderBG).toHaveBeenCalledWith('f-new');
});
