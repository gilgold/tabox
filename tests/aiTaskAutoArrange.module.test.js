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
    client: {
      createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockResolvedValue({ folders: [{ existingFolderId: null, newFolderName: 'Reading', collectionIndexes: [1] }] }),
    },
    storage: {
      loadFoldersIndexBG: jest.fn().mockResolvedValue({}),
      loadCollectionsIndexBG: jest.fn().mockResolvedValue({ c1: { parentId: null } }),
      createFoldersBG: jest.fn().mockResolvedValue([{ uid: 'f-new' }]),
      moveCollectionsToFoldersBG: jest.fn().mockResolvedValue(true),
      updateFolderCountsBG: jest.fn().mockResolvedValue(true),
      deleteFolderBG: jest.fn().mockResolvedValue(true),
    },
    loadLooseSummaries: jest.fn().mockResolvedValue([{ uid: 'c1', name: 'A', tabs: [], parentId: null }]),
    triggerSync: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

test('auto-arrange creates a folder, moves the collection, records undo, triggers sync, at temperature 0', async () => {
  const c = baseCtx();
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.storage.createFoldersBG).toHaveBeenCalledWith([{ name: 'Reading', color: expect.any(String), collapsed: true }]);
  expect(c.storage.moveCollectionsToFoldersBG).toHaveBeenCalledWith([{ uid: 'c1', parentId: 'f-new' }]);
  expect(c.client.createAISession).toHaveBeenCalledTimes(1);
  expect(c.client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
  expect(c.triggerSync).toHaveBeenCalled();
  expect(res.status).toBe('done');
  expect(res.undo).toEqual({ task: 'auto-arrange', moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: ['f-new'] });
});

test('auto-arrange assigns to an existing folder without creating one', async () => {
  const base = baseCtx();
  const c = baseCtx({
    storage: { ...base.storage, loadFoldersIndexBG: jest.fn().mockResolvedValue({ f1: { name: 'Work' } }), createFoldersBG: jest.fn().mockResolvedValue([]) },
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockResolvedValue({ folders: [{ existingFolderId: 'f1', newFolderName: null, collectionIndexes: [1] }] }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.storage.createFoldersBG).not.toHaveBeenCalled();
  expect(c.storage.moveCollectionsToFoldersBG).toHaveBeenCalledWith([{ uid: 'c1', parentId: 'f1' }]);
  expect(res.undo.createdFolderUids).toEqual([]);
});

test('auto-arrange chunks all loose collections in a single run, reusing one session', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ uid: `c${i + 1}`, name: `C${i + 1}`, tabs: [], parentId: null }));
  const cIndex = Object.fromEntries(many.map((c) => [c.uid, { parentId: null }]));
  let call = 0;
  const c = baseCtx({
    loadLooseSummaries: jest.fn().mockResolvedValue(many),
    storage: { ...baseCtx().storage, loadCollectionsIndexBG: jest.fn().mockResolvedValue(cIndex), createFoldersBG: jest.fn().mockResolvedValue([{ uid: 'f-new' }]) },
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
      promptForJSON: jest.fn().mockImplementation(async () => {
        call += 1;
        const n = call === 1 ? 20 : 5; // chunk 1 = 20 collections, chunk 2 = remaining 5
        return { folders: [{ existingFolderId: null, newFolderName: 'Reading', collectionIndexes: Array.from({ length: n }, (_, i) => i + 1) }] };
      }) },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.client.promptForJSON).toHaveBeenCalledTimes(2);
  expect(c.client.createAISession).toHaveBeenCalledTimes(1); // one session reused across chunks
  // 'Reading' created once in chunk 1, reused in chunk 2 (no second create).
  expect(c.storage.createFoldersBG).toHaveBeenCalledTimes(1);
  expect(c.storage.moveCollectionsToFoldersBG.mock.calls[0][0]).toHaveLength(25);
  expect(res.status).toBe('done');
});

test('auto-arrange does nothing when there are no loose collections', async () => {
  const c = baseCtx({ loadLooseSummaries: jest.fn().mockResolvedValue([]) });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.client.createAISession).not.toHaveBeenCalled();
  expect(c.storage.moveCollectionsToFoldersBG).not.toHaveBeenCalled();
  expect(res.status).toBe('done');
});

test('auto-arrange undo restores parentId and deletes the now-empty created folder', async () => {
  const c = baseCtx({ storage: { ...baseCtx().storage, loadCollectionsIndexBG: jest.fn().mockResolvedValue({}) } });
  const engine = createEngine({ registry, ctx: c });
  await browser.storage.local.set({ aiTaskState: { undo: { task: 'auto-arrange', moves: [{ uid: 'c1', prevParentId: null }], createdFolderUids: ['f-new'] } } });
  await engine.undoLast();
  expect(c.storage.moveCollectionsToFoldersBG).toHaveBeenCalledWith([{ uid: 'c1', parentId: null }]);
  expect(c.storage.deleteFolderBG).toHaveBeenCalledWith('f-new');
});

test('auto-arrange applies accumulated moves then stops when cancelled mid-loop, with undo + session destroyed', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ uid: `c${i + 1}`, name: `C${i + 1}`, tabs: [], parentId: null }));
  const cIndex = Object.fromEntries(many.map((c) => [c.uid, { parentId: null }]));
  const session = { prompt: jest.fn(), destroy: jest.fn() };
  let call = 0;
  const c = baseCtx({
    loadLooseSummaries: jest.fn().mockResolvedValue(many),
    storage: { ...baseCtx().storage, loadCollectionsIndexBG: jest.fn().mockResolvedValue(cIndex), createFoldersBG: jest.fn().mockResolvedValue([{ uid: 'f-new' }]) },
    client: {
      createAISession: jest.fn().mockResolvedValue(session),
      promptForJSON: jest.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          const s = (await browser.storage.local.get('aiTaskState')).aiTaskState;
          await browser.storage.local.set({ aiTaskState: { ...s, cancelRequested: true } });
        }
        return { folders: [{ existingFolderId: null, newFolderName: 'Reading', collectionIndexes: Array.from({ length: 20 }, (_, i) => i + 1) }] };
      }),
    },
  });
  const res = await createEngine({ registry, ctx: c }).runTask({ id: 'auto-arrange', params: {} });
  expect(c.client.promptForJSON).toHaveBeenCalledTimes(1); // chunk 2 never runs after cancel
  expect(c.storage.moveCollectionsToFoldersBG.mock.calls[0][0]).toHaveLength(20); // chunk 1's moves applied
  expect(res.status).toBe('cancelled');
  expect(res.undo).toEqual(expect.objectContaining({ task: 'auto-arrange' }));
  expect(session.destroy).toHaveBeenCalledTimes(1);
});
