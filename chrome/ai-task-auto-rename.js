// chrome/ai-task-auto-rename.js
// AI task: batch-rename collections. Domain logic only — driven by the engine.
(() => {
// Name many collections per request (one prompt lists a whole batch), then run
// a few batches in flight at once. Batching is the dominant win: it cuts both
// round-trips AND the number of requests, so a large library stays well under
// the Worker's 20-req/60s per-user burst limit instead of tripping it.
const BATCH_CONCURRENCY = 3;

const def = {
    id: 'auto-rename',
    async run({ ctx, params, report, signal }) {
        const { planners, client, storage, loadCollections, triggerSync, isCancelled } = ctx;
        const all = await loadCollections();
        const targets = all.filter((c) => params.uids.includes(c.uid));
        await report({ total: targets.length, filed: 0 });
        // Index-keyed by GLOBAL target position so results keep original order
        // regardless of which batch finishes first; compacted with filter(Boolean).
        const renameByIndex = new Array(targets.length).fill(null);
        const skippedByIndex = new Array(targets.length).fill(null);
        const orderedRenames = () => renameByIndex.filter(Boolean);
        const orderedSkipped = () => skippedByIndex.filter(Boolean);
        // Contiguous slices; `start` is the global index of the batch's first item.
        const size = planners.BATCH_NAME_SIZE;
        const batches = [];
        for (let i = 0; i < targets.length; i += size) batches.push({ start: i, items: targets.slice(i, i + size) });

        let completed = 0;
        let aborted = false;
        let next = 0;
        // One session shared across workers: each prompt is a stateless request
        // (system prompt + that batch only), so concurrent use is safe. The run's
        // abort signal rides along so aiCancel aborts in-flight fetches too, not
        // just future batches.
        const session = await client.createAISession({ systemPrompt: 'You name groups of browser tabs. Names are short (2-4 words), specific, and in Title Case. Never include quotes or emojis.', temperature: 0, signal });

        async function worker() {
            for (;;) {
                if (aborted) return;
                if (await isCancelled()) { aborted = true; return; }
                const b = next++;
                if (b >= batches.length) return;
                const { start, items } = batches[b];
                await report({ currentLabel: items[0].name, currentUid: items[0].uid });
                let names;
                try {
                    ({ names } = await client.promptForJSON(session, planners.buildBatchNamePrompt(items), planners.BATCH_NAME_SCHEMA, signal));
                } catch (err) {
                    if (err.name === 'AbortError') { aborted = true; return; }
                    console.error('Tabox AI: batch rename failed for', items.map((c) => c.uid), err);
                    for (let k = 0; k < items.length; k++) skippedByIndex[start + k] = { uid: items[k].uid, reason: 'error' };
                    completed += items.length;
                    await report({ filed: completed, results: orderedRenames(), skipped: orderedSkipped() });
                    continue;
                }
                // Map each name back by the echoed local index — never by array
                // position — so a reordered/partial response can't misassign names.
                const nameByLocalIndex = new Map();
                for (const entry of Array.isArray(names) ? names : []) {
                    if (entry && Number.isInteger(entry.index)) nameByLocalIndex.set(entry.index, entry.name);
                }
                for (let k = 0; k < items.length; k++) {
                    const c = items[k];
                    const suggested = nameByLocalIndex.get(k);
                    if (suggested == null) { skippedByIndex[start + k] = { uid: c.uid, reason: 'error' }; continue; }
                    const name = String(suggested).trim().slice(0, 50);
                    if (name && name !== c.name) renameByIndex[start + k] = { uid: c.uid, oldName: c.name, newName: name };
                }
                completed += items.length;
                await report({ filed: completed, results: orderedRenames(), skipped: orderedSkipped() });
            }
        }

        try {
            await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()));
        } finally {
            session.destroy();
        }
        const renames = orderedRenames();
        const skipped = orderedSkipped();
        await report({ filed: targets.length, results: renames, skipped });
        if (renames.length) { await storage.renameCollectionsBG(renames); await triggerSync(); }
        return { summary: `Renamed ${renames.length} collection${renames.length === 1 ? '' : 's'} with AI`, undo: { task: 'auto-rename', renames } };
    },
    async undo({ ctx, snapshot }) {
        const reverts = (snapshot.renames || []).map((r) => ({ uid: r.uid, oldName: r.newName, newName: r.oldName }));
        if (reverts.length) { await ctx.storage.renameCollectionsBG(reverts); await ctx.triggerSync(); }
    },
    async undoItems({ ctx, snapshot, uids }) {
        const want = new Set(uids);
        const reverts = (snapshot.renames || [])
            .filter((r) => want.has(r.uid))
            .map((r) => ({ uid: r.uid, oldName: r.newName, newName: r.oldName }));
        if (reverts.length) { await ctx.storage.renameCollectionsBG(reverts); await ctx.triggerSync(); }
    },
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
