const planners = require('../chrome/ai-planners');

const tabs = Array.from({ length: 6 }, (_, i) => ({
    title: `Tab ${i}`,
    url: `https://site${i}.com/page`,
}));

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
