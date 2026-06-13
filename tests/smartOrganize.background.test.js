// tests/smartOrganize.background.test.js
import { browser } from '../static/globals';
import { applySmartOrganizePlan, undoSmartOrganize, SMART_ORGANIZE_UNDO_KEY } from '../chrome/background-utils';

describe('applySmartOrganizePlan', () => {
    beforeEach(() => {
        browser.tabs.query = jest.fn().mockResolvedValue([
            { id: 1, groupId: -1 }, { id: 2, groupId: -1 }, { id: 3, groupId: 7 },
        ]);
        browser.tabs.group = jest.fn().mockResolvedValue(900);
        browser.tabs.ungroup = jest.fn().mockResolvedValue();
        browser.tabs.move = jest.fn().mockResolvedValue();
        browser.tabGroups.update = jest.fn().mockResolvedValue();
        browser.storage.local.set = jest.fn().mockResolvedValue();
        browser.storage.local.get = jest.fn().mockResolvedValue({});
        browser.windows.get = jest.fn().mockResolvedValue({ id: 100 });
    });

    test('writes an undo snapshot then creates groups and applies additions', async () => {
        const plan = {
            newGroups: [{ name: 'Docs', color: 'blue', tabIds: [1] }],
            additions: [{ groupId: 7, tabIds: [2] }],
            skippedTabIds: [],
        };
        const result = await applySmartOrganizePlan({ windowId: 100, plan, createdAt: 123 });

        // snapshot saved BEFORE mutation
        const saved = browser.storage.local.set.mock.calls[0][0][SMART_ORGANIZE_UNDO_KEY];
        expect(saved.windowId).toBe(100);
        expect(saved.orderedTabIds).toEqual([1, 2, 3]);
        expect(saved.affectedTabIds.sort()).toEqual([1, 2]);

        // addition uses existing groupId
        expect(browser.tabs.group).toHaveBeenCalledWith({ groupId: 7, tabIds: [2] });
        // new group created then titled/colored
        expect(browser.tabs.group).toHaveBeenCalledWith({ createProperties: { windowId: 100 }, tabIds: [1] });
        expect(browser.tabGroups.update).toHaveBeenCalledWith(900, { title: 'Docs', color: 'blue' });
        expect(result).toEqual(expect.objectContaining({ success: true, groupsCreated: 1, tabsAdded: 1 }));
    });
});

describe('undoSmartOrganize', () => {
    beforeEach(() => {
        browser.tabs.ungroup = jest.fn().mockResolvedValue();
        browser.tabs.move = jest.fn().mockResolvedValue();
        browser.tabs.query = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
        browser.storage.local.remove = jest.fn().mockResolvedValue();
        browser.windows.get = jest.fn().mockResolvedValue({ id: 100 });
    });

    test('ungroups affected tabs, restores order, clears the key', async () => {
        browser.storage.local.get = jest.fn().mockResolvedValue({
            [SMART_ORGANIZE_UNDO_KEY]: { windowId: 100, orderedTabIds: [1, 2, 3], affectedTabIds: [1, 2] },
        });
        const result = await undoSmartOrganize({ windowId: 100 });
        expect(browser.tabs.ungroup).toHaveBeenCalledWith([1, 2]);
        expect(browser.storage.local.remove).toHaveBeenCalledWith(SMART_ORGANIZE_UNDO_KEY);
        expect(result.success).toBe(true);
    });

    test('returns expired and clears the key when the window is gone', async () => {
        browser.storage.local.get = jest.fn().mockResolvedValue({
            [SMART_ORGANIZE_UNDO_KEY]: { windowId: 100, orderedTabIds: [1], affectedTabIds: [1] },
        });
        browser.windows.get = jest.fn().mockRejectedValue(new Error('No window with id 100'));
        const result = await undoSmartOrganize({ windowId: 100 });
        expect(result).toEqual({ success: false, reason: 'expired' });
        expect(browser.storage.local.remove).toHaveBeenCalledWith(SMART_ORGANIZE_UNDO_KEY);
    });
});
