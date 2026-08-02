require('jest-webextension-mock');
const { installStatefulLocalStorage } = require('./helpers/statefulLocalStorage');
installStatefulLocalStorage();
const registry = require('../chrome/ai-registry.js');
const { createEngine } = require('../chrome/ai-engine.js');
require('../chrome/ai-task-smart-organize.js');

beforeEach(async () => { await browser.storage.local.clear(); });

test('smart-organize produces a plan in results and does NOT trigger sync', async () => {
  const ctx = {
    planners: require('../chrome/ai-planners.js'),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
              promptForJSON: jest.fn().mockResolvedValue({ groups: [{ name: 'Work', color: 'blue', existingGroupId: null, tabIndexes: [1] }] }) },
    readWindow: jest.fn().mockResolvedValue({ ungroupedTabs: [{ tabId: 11, title: 'A', url: 'https://a.com' }], existingGroups: [] }),
    triggerSync: jest.fn().mockResolvedValue(true),
  };
  const res = await createEngine({ registry, ctx }).runTask({ id: 'smart-organize', params: { windowId: 5 } });
  expect(res.status).toBe('done');
  expect(res.results.newGroups.length).toBeGreaterThan(0);
  expect(res.results.skippedTabIds).toEqual([]);
  expect(ctx.triggerSync).not.toHaveBeenCalled();
});

test('smart-organize creates the AI session at temperature 0', async () => {
  const ctx = {
    planners: require('../chrome/ai-planners.js'),
    client: { createAISession: jest.fn().mockResolvedValue({ prompt: jest.fn(), destroy: jest.fn() }),
              promptForJSON: jest.fn().mockResolvedValue({ groups: [{ name: 'Work', color: 'blue', existingGroupId: null, tabIndexes: [1] }] }) },
    readWindow: jest.fn().mockResolvedValue({ ungroupedTabs: [{ tabId: 11, title: 'A', url: 'https://a.com' }], existingGroups: [] }),
    triggerSync: jest.fn().mockResolvedValue(true),
  };
  await createEngine({ registry, ctx }).runTask({ id: 'smart-organize', params: { windowId: 5 } });
  expect(ctx.client.createAISession).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
});

test('smart-organize reports meaningful progress phases while building the plan', async () => {
  const progressReports = [];
  const originalSet = browser.storage.local.set;
  browser.storage.local.set = jest.fn(async (payload) => {
    if (payload.aiTaskState && Number.isFinite(payload.aiTaskState.progress)) {
      progressReports.push({
        progress: payload.aiTaskState.progress,
        currentLabel: payload.aiTaskState.currentLabel,
      });
    }
    return originalSet(payload);
  });
  const ctx = {
    planners: require('../chrome/ai-planners.js'),
    client: { createAISession: jest.fn().mockResolvedValue({ destroy: jest.fn() }),
              promptForJSON: jest.fn().mockResolvedValue({ groups: [{ name: 'Work', color: 'blue', existingGroupId: null, tabIndexes: [1] }] }) },
    readWindow: jest.fn().mockResolvedValue({ ungroupedTabs: [{ tabId: 11, title: 'A', url: 'https://a.com' }], existingGroups: [] }),
  };

  await createEngine({ registry, ctx }).runTask({ id: 'smart-organize', params: { windowId: 5 } });
  browser.storage.local.set = originalSet;

  expect(progressReports).toEqual(expect.arrayContaining([
    { progress: 10, currentLabel: 'Step 1 of 3: Reading tabs…' },
    { progress: 35, currentLabel: 'Step 2 of 3: Asking AI to group tabs…' },
    { progress: 85, currentLabel: 'Step 3 of 3: Preparing tab groups…' },
    { progress: 100, currentLabel: 'Step 3 of 3: Preparing tab groups…' },
  ]));
});
