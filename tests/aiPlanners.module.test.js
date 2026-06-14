const {
    buildNamePrompt, buildArrangePrompt, normalizeArrangePlan,
    buildOrganizePrompt, normalizeOrganizePlan, CATCHALL_FOLDER_NAME, GROUP_COLORS,
} = require('../chrome/ai-planners.js');

describe('ai-planners module', () => {
    test('buildNamePrompt lists tab titles', () => {
        const p = buildNamePrompt({ tabs: [{ title: 'Docs', url: 'https://example.com/x' }] });
        expect(p).toContain('Docs');
        expect(p).toContain('example.com');
    });

    test('normalizeArrangePlan forces exactly one target and falls back to Misc', () => {
        const collections = [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }];
        const raw = { assignments: [
            { collectionId: 'a', existingFolderId: 'f1', newFolderName: 'X' }, // both set -> existing wins
            { collectionId: 'b', existingFolderId: null, newFolderName: null }, // neither -> Misc
        ]};
        const out = normalizeArrangePlan(raw, collections, [{ id: 'f1', name: 'Work' }]);
        expect(out.assignments[0]).toEqual({ collectionId: 'a', existingFolderId: 'f1', newFolderName: null });
        expect(out.assignments[1]).toEqual({ collectionId: 'b', existingFolderId: null, newFolderName: CATCHALL_FOLDER_NAME });
    });

    test('normalizeOrganizePlan puts unplaced capped tabs into Other', () => {
        const tabs = [{ tabId: 1 }, { tabId: 2 }];
        const out = normalizeOrganizePlan({ groups: [{ name: 'G', color: 'blue', tabIndexes: [1] }] }, tabs, []);
        const other = out.newGroups.find((g) => g.name === 'Other');
        expect(other.tabIds).toContain(2);
        expect(GROUP_COLORS).toContain('blue');
    });
});
