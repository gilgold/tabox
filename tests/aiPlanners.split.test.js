const planners = require('../chrome/ai-planners');

const tabs = Array.from({ length: 6 }, (_, i) => ({
    title: `Tab ${i}`,
    url: `https://site${i}.com/page`,
}));

describe('two-phase split planners', () => {
    test('buildSplitThemesPrompt samples evenly and stays within the sample cap', () => {
        const many = Array.from({ length: 200 }, (_, i) => ({ title: `T${i}`, url: `https://s${i}.com` }));
        const p = planners.buildSplitThemesPrompt({ name: 'Big', tabs: many });
        expect(p).toContain('Big');
        expect(p).toContain('T0'); // first tab always sampled
        // Evenly spaced sample, so late tabs are represented too…
        expect(p).toMatch(/T1[5-9][0-9]/);
        // …but not every tab is listed.
        const listed = (p.match(/^- /gm) || []).length;
        expect(listed).toBeLessThanOrEqual(planners.SPLIT_THEME_SAMPLE_MAX);
    });

    test('SPLIT_THEMES_SCHEMA asks for 2-4 named themes only', () => {
        expect(planners.SPLIT_THEMES_SCHEMA.properties.themes.minItems).toBe(2);
        expect(planners.SPLIT_THEMES_SCHEMA.properties.themes.maxItems).toBe(4);
        expect(planners.SPLIT_THEMES_SCHEMA.properties.themes.items.required).toEqual(['name']);
    });

    test('buildSplitAssignPrompt numbers themes and uses GLOBAL 1-based tab numbers', () => {
        const batch = [{ title: 'A', url: 'https://a.com' }, { title: 'B', url: 'https://b.com' }];
        const p = planners.buildSplitAssignPrompt({ themes: ['Work', 'News'], tabs: batch, startIndex: 40 });
        expect(p).toContain('1. Work');
        expect(p).toContain('2. News');
        expect(p).toContain('41. A'); // startIndex 40 → first tab is global #41
        expect(p).toContain('42. B');
    });

    test('splitAssignmentsToRawGroups maps theme numbers to named groups with global indices', () => {
        const raw = planners.splitAssignmentsToRawGroups(['Work', 'News'], [
            { tab: 1, theme: 1 }, { tab: 2, theme: 2 }, { tab: 3, theme: 1 },
            { tab: 99, theme: 7 },  // invalid theme → dropped (Misc sweep catches the tab)
            { tab: 'x', theme: 1 }, // malformed → dropped
        ]);
        expect(raw.groups).toEqual([
            { name: 'Work', tabIndices: [1, 3] },
            { name: 'News', tabIndices: [2] },
        ]);
    });
});

describe('normalizeSplitPlan', () => {
    test('partitions every tab into exactly one group', () => {
        const raw = { groups: [
            { name: 'Alpha', tabIndices: [1, 2, 3] },
            { name: 'Beta', tabIndices: [4, 5, 6] },
        ] };
        const { groups } = planners.normalizeSplitPlan(raw, tabs);
        const all = groups.flatMap((g) => g.tabIndices).sort((a, b) => a - b);
        expect(all).toEqual([0, 1, 2, 3, 4, 5]); // zero-based output indices
        expect(groups).toHaveLength(2);
    });

    test('dedupes a tab claimed by two groups (first wins)', () => {
        const raw = { groups: [
            { name: 'Alpha', tabIndices: [1, 2] },
            { name: 'Beta', tabIndices: [2, 3, 4, 5, 6] },
        ] };
        const { groups } = planners.normalizeSplitPlan(raw, tabs);
        expect(groups[0].tabIndices).toEqual([0, 1]);
        expect(groups[1].tabIndices).toEqual([2, 3, 4, 5]);
    });

    test('sweeps unassigned tabs into a Misc group', () => {
        const raw = { groups: [{ name: 'Alpha', tabIndices: [1, 2] }] };
        const { groups } = planners.normalizeSplitPlan(raw, tabs);
        const misc = groups.find((g) => g.name === 'Misc');
        expect(misc).toBeDefined();
        expect(misc.tabIndices).toEqual([2, 3, 4, 5]);
    });

    test('drops out-of-range indices', () => {
        const raw = { groups: [
            { name: 'Alpha', tabIndices: [1, 99] },
            { name: 'Beta', tabIndices: [2, 3, 4, 5, 6] },
        ] };
        const { groups } = planners.normalizeSplitPlan(raw, tabs);
        const all = groups.flatMap((g) => g.tabIndices);
        expect(all).not.toContain(98);
        expect(all.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    test('clamps to at most SPLIT_MAX_GROUPS, folding extras into the last', () => {
        const raw = { groups: [
            { name: 'A', tabIndices: [1] }, { name: 'B', tabIndices: [2] },
            { name: 'C', tabIndices: [3] }, { name: 'D', tabIndices: [4] },
            { name: 'E', tabIndices: [5, 6] },
        ] };
        const { groups } = planners.normalizeSplitPlan(raw, tabs);
        expect(groups.length).toBeLessThanOrEqual(planners.SPLIT_MAX_GROUPS);
    });

    test('returns ok:false when fewer than 2 usable groups and no leftovers', () => {
        const raw = { groups: [{ name: 'Alpha', tabIndices: [1, 2, 3, 4, 5, 6] }] };
        const result = planners.normalizeSplitPlan(raw, tabs);
        expect(result.ok).toBe(false);
    });
});
