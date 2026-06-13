jest.mock('../app/ai/aiClient', () => ({
    createAISession: jest.fn(),
    promptForJSON: jest.fn(),
}));

import { createAISession, promptForJSON } from '../app/ai/aiClient';
import { buildOrganizePrompt, smartOrganizeTabs, GROUP_COLORS } from '../app/ai/tasks/smartOrganizeTabs';

const ungrouped = [
    { tabId: 11, title: 'React docs', url: 'https://react.dev/learn' },
    { tabId: 12, title: 'MDN array', url: 'https://developer.mozilla.org/x' },
    { tabId: 13, title: 'Gmail', url: 'https://mail.google.com' },
];
const existingGroups = [{ id: 99, title: 'Email', sampleTitles: ['Inbox'] }];

describe('buildOrganizePrompt', () => {
    test('includes ungrouped tab titles+domains and existing group names', () => {
        const prompt = buildOrganizePrompt({ ungroupedTabs: ungrouped, existingGroups });
        expect(prompt).toContain('React docs');
        expect(prompt).toContain('react.dev');
        expect(prompt).toContain('Email');
    });
});

describe('smartOrganizeTabs', () => {
    beforeEach(() => {
        createAISession.mockResolvedValue({ destroy: jest.fn() });
        promptForJSON.mockReset();
    });

    test('maps tabIndexes to tabIds, splits new groups vs additions', async () => {
        promptForJSON.mockResolvedValue({
            groups: [
                { name: 'Docs', color: 'blue', existingGroupId: null, tabIndexes: [1, 2] },
                { name: '', color: 'grey', existingGroupId: 99, tabIndexes: [3] },
            ],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(plan.newGroups).toEqual([{ name: 'Docs', color: 'blue', tabIds: [11, 12] }]);
        expect(plan.additions).toEqual([{ groupId: 99, tabIds: [13] }]);
        expect(plan.skippedTabIds).toEqual([]);
    });

    test('clamps an invalid color to a palette color', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'X', color: 'chartreuse', existingGroupId: null, tabIndexes: [1] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(GROUP_COLORS).toContain(plan.newGroups[0].color);
    });

    test('treats an unknown existingGroupId as a new group', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'Stuff', color: 'red', existingGroupId: 12345, tabIndexes: [1] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(plan.additions).toEqual([]);
        expect(plan.newGroups[0].tabIds).toEqual([11]);
    });

    test('collects tabs the model left unplaced into an "Other" group', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'Docs', color: 'blue', existingGroupId: null, tabIndexes: [1] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        const other = plan.newGroups.find((g) => g.name === 'Other');
        expect(other.tabIds.sort()).toEqual([12, 13]);
    });

    test('caps at 50 tabs and reports the remainder as skipped', async () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ tabId: i + 1, title: `T${i}`, url: 'https://e.com' }));
        promptForJSON.mockResolvedValue({ groups: [] });
        const plan = await smartOrganizeTabs({ ungroupedTabs: many, existingGroups: [] });
        // first 50 unplaced -> Other; the 10 beyond the cap -> skipped
        expect(plan.skippedTabIds).toHaveLength(10);
        expect(plan.skippedTabIds).toContain(60);
    });

    test('drops unknown tabIndexes from the model output', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'Docs', color: 'blue', existingGroupId: null, tabIndexes: [1, 999] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(plan.newGroups[0].tabIds).toEqual([11]);
    });

    test('forwards the abort signal and destroys the session', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockResolvedValue({ groups: [] });
        const signal = new AbortController().signal;
        await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups, signal });
        expect(promptForJSON).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(Object), signal);
        expect(destroy).toHaveBeenCalled();
    });
});
