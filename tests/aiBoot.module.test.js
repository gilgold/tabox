global.STORAGE_KEYS = { COLLECTIONS_INDEX:'collections_index', FOLDERS_INDEX:'folders_index',
  COLLECTION_PREFIX:'collection_', FOLDER_PREFIX:'folder_',
  DELETED_COLLECTION_TOMBSTONES:'deleted_collection_tombstones', DELETED_FOLDER_TOMBSTONES:'deleted_folder_tombstones',
  LEGACY_TABS_ARRAY:'tabsArray', STORAGE_VERSION:'tabox_storage_version' };

const AI_MODULES = ['ai-client','ai-planners','ai-storage','ai-registry','ai-engine',
  'ai-task-auto-rename','ai-task-auto-arrange','ai-task-smart-organize','ai-task-split-collection'];

test('all SW plain-JS modules load and export without throwing', () => {
  require('../chrome/ai-registry.js'); // task modules need the registry global first
  AI_MODULES.forEach((m) => expect(() => require(`../chrome/${m}.js`)).not.toThrow());
  expect(require('../chrome/sync-merge.js').mergeSyncSnapshots).toBeDefined();
  expect(require('../chrome/sync-apply.js')).toBeDefined();
  expect(require('../chrome/ai-engine.js').createEngine).toBeInstanceOf(Function);
});

test('every task module self-registers into the registry', () => {
  const registry = require('../chrome/ai-registry.js');
  registry._reset();
  // jest.isolateModules re-executes the module IIFE in an isolated module cache,
  // but globalThis.TaboxAIRegistry still points to the same registry object.
  // This ensures register() fires against the current (reset) registry even though
  // these modules were previously cached at the outer Jest module scope.
  const taskModules = [
    ['ai-task-auto-rename', 'auto-rename'],
    ['ai-task-auto-arrange', 'auto-arrange'],
    ['ai-task-smart-organize', 'smart-organize'],
    ['ai-task-split-collection', 'split-collection'],
  ];
  taskModules.forEach(([moduleName]) => {
    jest.isolateModules(() => require(`../chrome/${moduleName}.js`));
  });
  taskModules.forEach(([, taskId]) => {
    expect(registry.getTask(taskId)).toEqual(expect.objectContaining({ id: taskId }));
  });
});

test('AI globals do not collide with existing Tabox SW globals', () => {
  const ai = ['TaboxAIClient','TaboxAIPlanners','TaboxAIStorage','TaboxAIRegistry','TaboxAIEngine'];
  const existing = ['TaboxBackgroundUtils','TaboxSyncMerge','TaboxSyncApply','TaboxSyncTransport','TaboxSyncThrottle','TaboxSyncSessionState'];
  expect(ai.filter((k) => existing.includes(k))).toEqual([]);
});
