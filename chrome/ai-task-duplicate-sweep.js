// chrome/ai-task-duplicate-sweep.js
// AI task: find duplicate tabs, pick a deterministic keeper, and ask the model
// for a short name for the new collection each group could create. Writes the
// interactive sweep state to chrome.storage.local('duplicateSweep'); the popup
// drives resolution. Planning only — never mutates collections.
(() => {
const DUPLICATE_SWEEP_KEY = 'duplicateSweep';
const FALLBACK_COLLECTION_NAME = 'Shared Tabs';
const BATCH_CONCURRENCY = 3;
function localArea() { return (globalThis.browser || globalThis.chrome).storage.local; }

function namingCollectionForGroup(group) {
    return {
        tabs: (group.urls || []).map((entry) => {
            const occurrences = entry.occurrences || [];
            const best = [...occurrences].sort((a, b) => {
                const aTitle = (a && (a.title || (a.tab && a.tab.title))) || '';
                const bTitle = (b && (b.title || (b.tab && b.tab.title))) || '';
                return bTitle.length - aTitle.length;
            })[0] || {};
            const tab = best.tab || {};
            return {
                title: best.title || tab.title || '',
                url: best.url || tab.url || entry.normalizedUrl || '',
            };
        }),
    };
}

const def = {
    id: 'duplicate-sweep',
    async run({ ctx, params, report, signal }) {
        const { planners, client, loadCollections, isCancelled } = ctx;
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
                    suggestedNewCollectionName: FALLBACK_COLLECTION_NAME,
                    bestTitlePerUrl: [],
                };
            } else {
                g.recommendation = planners.buildDeterministicDedupSuggestion(g, namesByUid, pickKeeper(g.collectionUids));
            }
        }

        await report({ total: groups.length, filed: 0 });

        if (isCancelled && await isCancelled()) {
            return { summary: 'Duplicate scan cancelled', undo: null };
        }

        if (groups.length) {
            let session;
            try {
                session = await client.createAISession({
                    systemPrompt: 'You name groups of browser tabs. Names are short (2-4 words), specific, and in Title Case. Never include quotes or emojis.',
                    temperature: 0,
                    signal,
                });
                const size = planners.BATCH_NAME_SIZE;
                const batches = [];
                for (let start = 0; start < groups.length; start += size) {
                    batches.push(groups.slice(start, start + size));
                }
                let completed = 0;
                let aborted = false;
                let next = 0;

                // Each prompt is self-contained, so a few workers can safely
                // share the session and cut total wait time to roughly the
                // slowest batch instead of the sum of every batch.
                async function worker() {
                    for (;;) {
                        if (aborted) return;
                        if (isCancelled && await isCancelled()) { aborted = true; return; }
                        const batchIndex = next++;
                        if (batchIndex >= batches.length) return;
                        const batch = batches[batchIndex];
                        try {
                            const { names } = await client.promptForJSON(
                                session,
                                planners.buildBatchNamePrompt(batch.map(namingCollectionForGroup)),
                                planners.BATCH_NAME_SCHEMA,
                                signal,
                            );
                            const nameByLocalIndex = new Map();
                            for (const entry of (Array.isArray(names) ? names : [])) {
                                if (entry && Number.isInteger(entry.index)) nameByLocalIndex.set(entry.index, entry.name);
                            }
                            batch.forEach((group, index) => {
                                const name = String(nameByLocalIndex.get(index) || '').trim().slice(0, planners.MAX_NAME_LENGTH);
                                if (name) group.recommendation.suggestedNewCollectionName = name;
                            });
                        } catch (error) {
                            if (error && error.name === 'AbortError') { aborted = true; return; }
                            console.error('Tabox AI: duplicate-group naming failed', error);
                        }
                        completed += batch.length;
                        await report({ filed: completed });
                    }
                }

                await Promise.all(Array.from(
                    { length: Math.min(BATCH_CONCURRENCY, batches.length) },
                    () => worker(),
                ));
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                console.error('Tabox AI: duplicate-group naming unavailable', error);
            } finally {
                if (session) session.destroy();
            }
        }

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

        await report({ total: groups.length, filed: groups.length });

        const totalDupes = groups.reduce((n, g) => n + g.urls.reduce((m, u) => m + u.occurrences.length, 0), 0);
        return { summary: groups.length ? `Found ${groups.length} duplicate group${groups.length === 1 ? '' : 's'} (${totalDupes} tabs)` : 'No duplicate tabs found', undo: null };
    },
    async undo() {}, // interactive undo is handled by chrome/duplicate-sweep.js, not the engine
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
