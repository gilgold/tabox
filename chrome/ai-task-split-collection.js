// chrome/ai-task-split-collection.js
// AI task: propose 2-4 themed sub-collections for one oversized collection.
// Planning only — the splitCollectionApply message performs the storage mutation.
(() => {
const def = {
    id: 'split-collection',
    async run({ ctx, params, report }) {
        const { client, planners, loadCollections } = ctx;
        const all = await loadCollections();
        const target = all.find((c) => c.uid === (params && params.uid));
        if (!target) {
            await report({ total: 0, filed: 0, results: { ok: false, reason: 'missing' } });
            return { summary: 'Collection not found', undo: null };
        }
        const tabs = target.tabs || [];
        await report({ total: tabs.length, filed: 0 });

        const session = await client.createAISession({
            systemPrompt: 'You organize saved browser tabs into themed sub-collections. Names are short, specific, Title Case, no quotes or emojis.',
            temperature: 0,
        });
        let raw;
        try {
            raw = await client.promptForJSON(session, planners.buildSplitPrompt({ name: target.name, tabs }), planners.SPLIT_SCHEMA);
        } finally {
            session.destroy();
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
