// chrome/ai-task-duplicate-sweep.js
// AI task: find duplicate tabs (plain code) and, for every duplicate group,
// pick a deterministic keeper. Writes the interactive sweep state to
// chrome.storage.local('duplicateSweep'); the popup drives resolution.
// Detection + recommendations are pure local code — no model call.
// Planning only — never mutates collections.
(() => {
const DUPLICATE_SWEEP_KEY = 'duplicateSweep';
function localArea() { return (globalThis.browser || globalThis.chrome).storage.local; }

const def = {
    id: 'duplicate-sweep',
    async run({ ctx, params, report }) {
        const { planners, loadCollections, isCancelled } = ctx;
        const detect = ctx.detect || globalThis.TaboxDuplicateDetect;
        await localArea().remove(DUPLICATE_SWEEP_KEY); // clear any prior sweep before a fresh scan
        const all = await loadCollections();
        const scoped = (params && Array.isArray(params.uids) && params.uids.length);
        const inScope = scoped ? all.filter((c) => params.uids.includes(c.uid)) : all;
        const namesByUid = Object.fromEntries(inScope.map((c) => [c.uid, c.name]));

        const { groups } = detect.detectDuplicateGroups(inScope);
        // Pick the freshest collection (then most tabs, then uid) as the keeper.
        const metaByUid = Object.fromEntries(inScope.map((c) => [c.uid, { lastUpdated: c.lastUpdated || 0, tabCount: (c.tabs || []).length }]));
        const pickKeeper = (uids) => [...uids].sort((a, b) => {
            const ma = metaByUid[a] || {}; const mb = metaByUid[b] || {};
            return (mb.lastUpdated || 0) - (ma.lastUpdated || 0)
                || (mb.tabCount || 0) - (ma.tabCount || 0)
                || (a < b ? -1 : 1);
        })[0];

        // Every group gets a deterministic recommendation: within-groups a
        // templated one, cross-groups a keeper chosen by freshness.
        for (const g of groups) {
            if (g.kind === 'within') {
                g.recommendation = {
                    recommendedKeeperUid: g.collectionUids[0],
                    message: `"${namesByUid[g.collectionUids[0]] || 'This collection'}" contains the same tab more than once.`,
                    suggestedNewCollectionName: 'Shared Tabs',
                    bestTitlePerUrl: [],
                };
            } else {
                g.recommendation = planners.buildDeterministicDedupSuggestion(g, namesByUid, pickKeeper(g.collectionUids));
            }
        }

        await report({ total: 0, filed: 0 });

        if (isCancelled && await isCancelled()) {
            return { summary: 'Duplicate scan cancelled', undo: null };
        }

        await localArea().set({
            [DUPLICATE_SWEEP_KEY]: {
                createdAt: Date.now(),
                scope: scoped ? { type: 'selected', uids: params.uids } : { type: 'all' },
                groups,
                history: [],
            },
        });

        const totalDupes = groups.reduce((n, g) => n + g.urls.reduce((m, u) => m + u.occurrences.length, 0), 0);
        return { summary: groups.length ? `Found ${groups.length} duplicate group${groups.length === 1 ? '' : 's'} (${totalDupes} tabs)` : 'No duplicate tabs found', undo: null };
    },
    async undo() {}, // interactive undo is handled by chrome/duplicate-sweep.js, not the engine
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
