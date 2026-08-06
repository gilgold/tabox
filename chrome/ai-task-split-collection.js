// chrome/ai-task-split-collection.js
// AI task: propose 2-4 themed sub-collections for one oversized collection.
// Planning only — the splitCollectionApply message performs the storage mutation.
//
// Small collections (≤ SPLIT_SINGLE_SHOT_MAX tabs) use one request. Larger ones
// use a two-phase scan: a single-shot split's output is O(tabs) — the model
// emits a partition of every tab, generated serially — so one giant call gets
// slow fast. Phase 1 proposes 2-4 themes from a tab sample (tiny output);
// phase 2 assigns ALL tabs to those fixed themes in parallel batches with
// compact outputs. Every tab still gets model judgment; only the call shape changes.
(() => {
const ASSIGN_CONCURRENCY = 3;

const def = {
    id: 'split-collection',
    async run({ ctx, params, report, signal }) {
        const { client, planners, loadCollections, isCancelled } = ctx;
        const all = await loadCollections();
        const target = all.find((c) => c.uid === (params && params.uid));
        if (!target) {
            await report({ total: 0, filed: 0, results: { ok: false, reason: 'missing' } });
            return { summary: 'Collection not found', undo: null };
        }
        const tabs = target.tabs || [];
        await report({ total: tabs.length, filed: 0 });

        // The run's abort signal rides along so aiCancel aborts in-flight
        // fetches too, not just future batches.
        const session = await client.createAISession({
            systemPrompt: 'You organize saved browser tabs into themed sub-collections. Names are short, specific, Title Case, no quotes or emojis.',
            temperature: 0,
            signal,
        });
        let raw;
        try {
            if (tabs.length <= planners.SPLIT_SINGLE_SHOT_MAX) {
                raw = await client.promptForJSON(session, planners.buildSplitPrompt({ name: target.name, tabs }), planners.SPLIT_SCHEMA, signal);
                await report({ filed: tabs.length });
            } else {
                // Phase 1: themes from an evenly-spaced sample. A failure here is
                // fatal (nothing to assign against) — propagate to the engine.
                const { themes: rawThemes } = await client.promptForJSON(
                    session, planners.buildSplitThemesPrompt({ name: target.name, tabs }), planners.SPLIT_THEMES_SCHEMA, signal);
                const themes = (Array.isArray(rawThemes) ? rawThemes : [])
                    .map((t) => String((t && t.name) || '').trim().slice(0, 40))
                    .filter(Boolean);
                if (themes.length < 2) {
                    raw = { groups: [] }; // normalizeSplitPlan maps this to ok:false
                } else {
                    // Phase 2: assign all tabs to the fixed themes, a few batches in
                    // flight at once. Global 1-based numbering lets batches merge as-is.
                    const size = planners.SPLIT_ASSIGN_BATCH;
                    const batches = [];
                    for (let i = 0; i < tabs.length; i += size) batches.push({ start: i, items: tabs.slice(i, i + size) });
                    const assignments = [];
                    let filed = 0;
                    let aborted = false;
                    let next = 0;
                    async function worker() {
                        for (;;) {
                            if (aborted || (await isCancelled())) { aborted = true; return; }
                            const b = next++;
                            if (b >= batches.length) return;
                            const { start, items } = batches[b];
                            try {
                                const res = await client.promptForJSON(
                                    session, planners.buildSplitAssignPrompt({ themes, tabs: items, startIndex: start }), planners.SPLIT_ASSIGN_SCHEMA, signal);
                                assignments.push(...(res.assignments || []));
                            } catch (err) {
                                if (err && err.name === 'AbortError') { aborted = true; return; }
                                // This batch's tabs stay unassigned — the Misc sweep in
                                // normalizeSplitPlan picks them up. Keep scanning.
                                console.error('Tabox AI: split assignment batch failed', target.uid, err);
                            }
                            filed += items.length;
                            await report({ filed });
                        }
                    }
                    await Promise.all(Array.from({ length: Math.min(ASSIGN_CONCURRENCY, batches.length) }, () => worker()));
                    raw = planners.splitAssignmentsToRawGroups(themes, assignments);
                }
            }
        } finally {
            session.destroy();
        }
        if (await isCancelled()) {
            return { summary: 'Split scan cancelled', undo: null };
        }
        const normalized = planners.normalizeSplitPlan(raw, tabs);
        const results = normalized.ok
            ? { ok: true, uid: target.uid, name: target.name, groups: normalized.groups.map((g) => ({
                  name: g.name,
                  tabIndices: g.tabIndices,
                  tabs: g.tabIndices.map((i) => tabs[i]).filter(Boolean),
              })) }
            : { ok: false, reason: normalized.reason };

        await report({ total: tabs.length, filed: tabs.length, results });
        return { summary: normalized.ok ? `Proposed ${results.groups.length} sub-collections` : 'Could not split', undo: null };
    },
    async undo() {},
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
