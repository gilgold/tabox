// tests/readWindowStructure.test.js
import { browser } from '../static/globals';
import { readWindowStructure } from '../app/ai/readWindowStructure';

describe('readWindowStructure', () => {
    beforeEach(() => {
        browser.tabs.query = jest.fn();
        browser.tabGroups.query = jest.fn();
        browser.runtime.getURL = jest.fn(() => 'chrome-extension://abc/fullpage.html');
    });

    test('returns ungrouped eligible tabs and existing groups with sample titles', async () => {
        browser.tabs.query.mockResolvedValue([
            { id: 1, title: 'A', url: 'https://a.com', groupId: -1, pinned: false },
            { id: 2, title: 'B', url: 'https://b.com', groupId: 7, pinned: false },
            { id: 3, title: 'Pinned', url: 'https://p.com', groupId: -1, pinned: true },
            { id: 4, title: 'Tabox', url: 'chrome-extension://abc/fullpage.html', groupId: -1, pinned: false },
        ]);
        browser.tabGroups.query.mockResolvedValue([{ id: 7, title: 'Work', color: 'blue' }]);

        const result = await readWindowStructure(100);

        expect(result.ungroupedTabs).toEqual([{ tabId: 1, title: 'A', url: 'https://a.com' }]);
        expect(result.existingGroups).toEqual([{ id: 7, title: 'Work', sampleTitles: ['B'] }]);
        expect(result.eligibleCount).toBe(1);
        expect(browser.tabs.query).toHaveBeenCalledWith({ windowId: 100 });
    });

    test('handles a window with no groups', async () => {
        browser.tabs.query.mockResolvedValue([{ id: 1, title: 'A', url: 'https://a.com', groupId: -1, pinned: false }]);
        browser.tabGroups.query.mockResolvedValue([]);
        const result = await readWindowStructure(100);
        expect(result.existingGroups).toEqual([]);
        expect(result.ungroupedTabs).toHaveLength(1);
    });
});
