// chrome/ai-task-duplicate-sweep.js
// AI task: find duplicate tabs (plain code) and, for cross-collection groups,
// ask the model which collection to keep them in. Writes the interactive sweep
// state to chrome.storage.local('duplicateSweep'); the popup drives resolution.
// Planning only — never mutates collections.
(() => {
const DUPLICATE_SWEEP_KEY = 'duplicateSweep';
function localArea() { return (globalThis.browser || globalThis.chrome).storage.local; }

const def = {
    id: 'duplicate-sweep',
    async run({ ctx, params, report }) {
        const { client, planners, loadCollections, isCancelled } = ctx;
        const detect = ctx.detect || globalThis.TaboxDuplicateDetect;
        await localArea().remove(DUPLICATE_SWEEP_KEY); // clear any prior sweep before a fresh scan
        const all = await loadCollections();
        const scoped = (params && Array.isArray(params.uids) && params.uids.length);
        const inScope = scoped ? all.filter((c) => params.uids.includes(c.uid)) : all;
        const namesByUid = Object.fromEntries(inScope.map((c) => [c.uid, c.name]));

        const { groups } = detect.detectDuplicateGroups(inScope);
        const crossGroups = groups.filter((g) => g.kind === 'cross');
        await report({ total: crossGroups.length, filed: 0 });

        let session = null;
        let processed = 0;
        try {
            for (const g of groups) {
                if (isCancelled && await isCancelled()) break;
                if (g.kind === 'within') {
                    g.recommendation = {
                        recommendedKeeperUid: g.collectionUids[0],
                        message: `"${namesByUid[g.collectionUids[0]] || 'This collection'}" contains the same tab more than once.`,
                        suggestedNewCollectionName: 'Shared Tabs',
                        bestTitlePerUrl: [],
                    };
                    continue;
                }
                await report({ filed: processed, currentLabel: g.collectionUids.map((u) => namesByUid[u]).filter(Boolean).join(', ') });
                try {
                    if (!session) {
                        session = await client.createAISession({ systemPrompt: 'You help tidy saved browser tabs. Be concise and concrete.', temperature: 0 });
                    }
                    const raw = await client.promptForJSON(session, planners.buildDedupPrompt(g, namesByUid), planners.DEDUP_SCHEMA);
                    g.recommendation = planners.normalizeDedupSuggestion(raw, g, namesByUid);
                } catch (err) {
                    if (err && err.name === 'AbortError') break;
                    console.error('Tabox AI: dedup suggestion failed for', g.id, err);
                    g.recommendation = planners.normalizeDedupSuggestion(null, g, namesByUid); // deterministic fallback
                }
                processed += 1;
                await report({ filed: processed });
            }
        } finally {
            if (session) session.destroy();
        }

        if (isCancelled && await isCancelled()) {
            return { summary: 'Duplicate scan cancelled', undo: null };
        }

        const totalDupes = groups.reduce((n, g) => n + g.urls.reduce((m, u) => m + u.occurrences.length, 0), 0);
        await localArea().set({
            [DUPLICATE_SWEEP_KEY]: {
                createdAt: Date.now(),
                scope: scoped ? { type: 'selected', uids: params.uids } : { type: 'all' },
                groups,
                history: [],
            },
        });
        await report({ filed: crossGroups.length });
        return { summary: groups.length ? `Found ${groups.length} duplicate group${groups.length === 1 ? '' : 's'} (${totalDupes} tabs)` : 'No duplicate tabs found', undo: null };
    },
    async undo() {}, // interactive undo is handled by chrome/duplicate-sweep.js, not the engine
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
