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

    test('normalizeArrangePlan forces exactly one target per folder block and falls back to Misc', () => {
        const collections = [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }];
        const raw = { folders: [
            // both set -> existing wins; collection a placed in f1. b is never referenced -> Misc.
            { existingFolderId: 'f1', newFolderName: 'X', collectionIndexes: [1] },
        ] };
        const out = normalizeArrangePlan(raw, collections, [{ id: 'f1', name: 'Work' }]);
        expect(out.assignments[0]).toEqual({ collectionId: 'a', existingFolderId: 'f1', newFolderName: null });
        expect(out.assignments[1]).toEqual({ collectionId: 'b', existingFolderId: null, newFolderName: CATCHALL_FOLDER_NAME });
    });

    test('normalizeArrangePlan merges a new folder name that case-insensitively matches an existing folder', () => {
        const out = normalizeArrangePlan(
            { folders: [{ existingFolderId: null, newFolderName: 'work', collectionIndexes: [1] }] },
            [{ uid: 'a', name: 'A' }],
            [{ id: 'f1', name: 'Work' }],
        );
        expect(out.assignments[0]).toEqual({ collectionId: 'a', existingFolderId: 'f1', newFolderName: null });
    });

    test('normalizeArrangePlan groups multiple collections into one new folder by index', () => {
        const collections = [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }, { uid: 'c', name: 'C' }];
        const out = normalizeArrangePlan(
            { folders: [{ existingFolderId: null, newFolderName: 'Reading', collectionIndexes: [1, 2, 3] }] },
            collections, [],
        );
        expect(out.assignments.map((x) => x.newFolderName)).toEqual(['Reading', 'Reading', 'Reading']);
        expect(out.assignments.every((x) => x.existingFolderId === null)).toBe(true);
    });

    test('buildArrangePrompt numbers collections and does not leak their uids', () => {
        const uid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
        const p = buildArrangePrompt({ collections: [{ uid, name: 'A', tabs: [{ title: 'Docs' }] }], existingFolders: [] });
        expect(p).toContain('1. "A"');
        expect(p).toContain('Docs');
        expect(p).not.toContain(uid);
    });

    test('normalizeOrganizePlan puts unplaced capped tabs into Other', () => {
        const tabs = [{ tabId: 1 }, { tabId: 2 }];
        const out = normalizeOrganizePlan({ groups: [{ name: 'G', color: 'blue', tabIndexes: [1] }] }, tabs, []);
        const other = out.newGroups.find((g) => g.name === 'Other');
        expect(other.tabIds).toContain(2);
        expect(GROUP_COLORS).toContain('blue');
    });

    test('normalizeOrganizePlan routes tabs to an existing group via additions', () => {
        const tabs = [{ tabId: 1 }, { tabId: 2 }];
        const out = normalizeOrganizePlan(
            { groups: [{ existingGroupId: 99, tabIndexes: [1, 2] }] },
            tabs,
            [{ id: 99, title: 'Work' }],
        );
        expect(out.additions).toEqual([{ groupId: 99, tabIds: [1, 2] }]);
        expect(out.newGroups).toEqual([]);
    });

    test('normalizeOrganizePlan replaces an invalid color with a GROUP_COLORS value', () => {
        const out = normalizeOrganizePlan(
            { groups: [{ name: 'G', color: 'not-a-color', tabIndexes: [1] }] },
            [{ tabId: 1 }],
            [],
        );
        expect(GROUP_COLORS).toContain(out.newGroups[0].color);
    });
});
