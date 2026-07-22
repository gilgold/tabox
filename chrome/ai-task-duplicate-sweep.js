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
        // Pick the freshest collection (then most tabs, then uid) as the default
        // keeper for groups that don't need an AI opinion.
        const metaByUid = Object.fromEntries(inScope.map((c) => [c.uid, { lastUpdated: c.lastUpdated || 0, tabCount: (c.tabs || []).length }]));
        const pickKeeper = (uids) => [...uids].sort((a, b) => {
            const ma = metaByUid[a] || {}; const mb = metaByUid[b] || {};
            return (mb.lastUpdated || 0) - (ma.lastUpdated || 0)
                || (mb.tabCount || 0) - (ma.tabCount || 0)
                || (a < b ? -1 : 1);
        })[0];

        // Every group gets an immediate no-inference recommendation: within-groups a
        // templated one, cross-groups a deterministic keeper. That makes the sweep
        // fully usable the moment detection finishes — the model only *refines*
        // title-conflicting groups afterwards.
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

        // Only groups whose copies have *conflicting* titles need the model.
        const aiGroups = groups.filter((g) => g.kind === 'cross' && planners.dedupGroupHasTitleConflict(g));
        await report({ total: aiGroups.length, filed: 0 });

        if (isCancelled && await isCancelled()) {
            return { summary: 'Duplicate scan cancelled', undo: null };
        }

        // Publish now — the panel opens immediately; AI refinements stream in below.
        await localArea().set({
            [DUPLICATE_SWEEP_KEY]: {
                createdAt: Date.now(),
                scope: scoped ? { type: 'selected', uids: params.uids } : { type: 'all' },
                groups,
                history: [],
            },
        });

        // Persist one refined recommendation into the live sweep state. Routed
        // through the sweep store's serialized mutations when available (the SW);
        // falls back to a plain read-merge-write in isolated tests.
        async function persistRecommendation(groupId, recommendation) {
            const store = globalThis.TaboxDuplicateSweep;
            if (store && store.updateDuplicateSweepRecommendation) {
                return store.updateDuplicateSweepRecommendation({ groupId, recommendation });
            }
            const state = (await localArea().get(DUPLICATE_SWEEP_KEY))[DUPLICATE_SWEEP_KEY];
            if (!state) return { ok: false, reason: 'missing' };
            const g = state.groups.find((x) => x.id === groupId);
            if (!g || g.status !== 'pending') return { ok: false, reason: 'not-pending' };
            g.recommendation = recommendation;
            await localArea().set({ [DUPLICATE_SWEEP_KEY]: state });
            return { ok: true };
        }

        let session = null;
        let processed = 0;
        try {
            for (const g of aiGroups) {
                if (isCancelled && await isCancelled()) break;
                await report({ filed: processed, currentLabel: g.collectionUids.map((u) => namesByUid[u]).filter(Boolean).join(', ') });
                let clone = null;
                try {
                    if (!session) {
                        session = await client.createAISession({ systemPrompt: 'You help tidy saved browser tabs. Be concise and concrete.', temperature: 0 });
                    }
                    // Prompt on a fresh clone per group: a shared session accumulates
                    // every previous prompt+response in its context, so each inference
                    // gets slower than the last on large libraries.
                    clone = (typeof session.clone === 'function') ? await session.clone() : null;
                    const raw = await client.promptForJSON(clone || session, planners.buildDedupPrompt(g, namesByUid), planners.DEDUP_SCHEMA);
                    const res = await persistRecommendation(g.id, planners.normalizeDedupSuggestion(raw, g, namesByUid));
                    if (res && res.reason === 'missing') break; // user ended the sweep — stop refining
                } catch (err) {
                    if (err && err.name === 'AbortError') break;
                    // The deterministic recommendation is already live — nothing to repair.
                    console.error('Tabox AI: dedup suggestion failed for', g.id, err);
                } finally {
                    if (clone && typeof clone.destroy === 'function') clone.destroy();
                }
                processed += 1;
                await report({ filed: processed });
            }
        } finally {
            if (session) session.destroy();
        }

        if (isCancelled && await isCancelled()) {
            await localArea().remove(DUPLICATE_SWEEP_KEY);
            return { summary: 'Duplicate scan cancelled', undo: null };
        }

        const totalDupes = groups.reduce((n, g) => n + g.urls.reduce((m, u) => m + u.occurrences.length, 0), 0);
        await report({ filed: aiGroups.length });
        return { summary: groups.length ? `Found ${groups.length} duplicate group${groups.length === 1 ? '' : 's'} (${totalDupes} tabs)` : 'No duplicate tabs found', undo: null };
    },
    async undo() {}, // interactive undo is handled by chrome/duplicate-sweep.js, not the engine
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
