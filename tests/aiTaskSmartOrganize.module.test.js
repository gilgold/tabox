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
