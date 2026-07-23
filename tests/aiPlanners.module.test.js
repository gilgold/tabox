const {
    buildNamePrompt, buildArrangePrompt, normalizeArrangePlan,
    normalizeOrganizePlan, CATCHALL_FOLDER_NAME, GROUP_COLORS,
    buildBatchNamePrompt, BATCH_NAME_SCHEMA, BATCH_NAME_SIZE, MAX_BATCH_TABS,
} = require('../chrome/ai-planners.js');

describe('ai-planners module', () => {
    test('buildNamePrompt lists tab titles', () => {
        const p = buildNamePrompt({ tabs: [{ title: 'Docs', url: 'https://example.com/x' }] });
        expect(p).toContain('Docs');
        expect(p).toContain('example.com');
    });

    test('buildBatchNamePrompt labels each collection by index and lists its tabs', () => {
        const p = buildBatchNamePrompt([
            { tabs: [{ title: 'React', url: 'https://react.dev' }] },
            { tabs: [{ title: 'BBC', url: 'https://bbc.com' }] },
        ]);
        expect(p).toContain('Collection 0:');
        expect(p).toContain('Collection 1:');
        expect(p).toContain('React');
        expect(p).toContain('BBC');
        expect(p).toContain('"index"'); // instructs the model to echo indexes
    });

    test('buildBatchNamePrompt caps tabs per collection at MAX_BATCH_TABS', () => {
        const tabs = Array.from({ length: MAX_BATCH_TABS + 5 }, (_, i) => ({ title: `T${i}`, url: `https://e${i}.com` }));
        const p = buildBatchNamePrompt([{ tabs }]);
        expect(p).toContain(`T${MAX_BATCH_TABS - 1}`);
        expect(p).not.toContain(`T${MAX_BATCH_TABS}`);
    });

    test('BATCH_NAME_SCHEMA requires index+name entries and a sane batch size', () => {
        expect(BATCH_NAME_SCHEMA.properties.names.items.required).toEqual(['index', 'name']);
        expect(BATCH_NAME_SCHEMA.properties.names.items.additionalProperties).toBe(false);
        expect(BATCH_NAME_SIZE).toBeGreaterThan(1);
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

    test('normalizeArrangePlan: first folder wins when two blocks claim the same index', () => {
        const collections = [{ uid: 'a' }, { uid: 'b' }];
        const out = normalizeArrangePlan(
            { folders: [
                { existingFolderId: null, newFolderName: 'Work', collectionIndexes: [1, 2] },
                { existingFolderId: null, newFolderName: 'Fun', collectionIndexes: [2] },
            ] },
            collections, [],
        );
        expect(out.assignments[1].newFolderName).toBe('Work'); // 'b' claimed by the first block
    });

    test('normalizeArrangePlan drops out-of-range indexes and Miscs the unreferenced collection', () => {
        const collections = [{ uid: 'a' }, { uid: 'b' }];
        const out = normalizeArrangePlan(
            { folders: [{ existingFolderId: null, newFolderName: 'Work', collectionIndexes: [0, 99, 2] }] },
            collections, [],
        );
        expect(out.assignments[0]).toEqual({ collectionId: 'a', existingFolderId: null, newFolderName: CATCHALL_FOLDER_NAME });
        expect(out.assignments[1]).toEqual({ collectionId: 'b', existingFolderId: null, newFolderName: 'Work' });
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
