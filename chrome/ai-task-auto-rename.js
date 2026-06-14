// chrome/ai-task-auto-rename.js
// AI task: batch-rename collections. Domain logic only — driven by the engine.
(() => {
const def = {
    id: 'auto-rename',
    async run({ ctx, params, report }) {
        const { planners, client, storage, loadCollections, triggerSync, isCancelled } = ctx;
        const all = await loadCollections();
        const targets = all.filter((c) => params.uids.includes(c.uid));
        await report({ total: targets.length, filed: 0 });
        const renames = [];
        for (let i = 0; i < targets.length; i++) {
            if (await isCancelled()) break;
            const c = targets[i];
            await report({ filed: i, currentLabel: c.name, currentUid: c.uid });
            const session = await client.createAISession({ systemPrompt: 'You name groups of browser tabs. Names are short (2-4 words), specific, and in Title Case. Never include quotes or emojis.', temperature: 0.7, topK: 3 });
            let name;
            try { ({ name } = await client.promptForJSON(session, planners.buildNamePrompt(c), planners.NAME_SCHEMA)); }
            finally { session.destroy(); }
            name = String(name).trim().slice(0, 50);
            if (name && name !== c.name) renames.push({ uid: c.uid, oldName: c.name, newName: name });
        }
        await report({ filed: targets.length, results: renames });
        if (renames.length) { await storage.renameCollectionsBG(renames); await triggerSync(); }
        return { summary: `Renamed ${renames.length} collection${renames.length === 1 ? '' : 's'} with AI`, undo: { task: 'auto-rename', renames } };
    },
    async undo({ ctx, snapshot }) {
        const reverts = (snapshot.renames || []).map((r) => ({ uid: r.uid, oldName: r.newName, newName: r.oldName }));
        if (reverts.length) { await ctx.storage.renameCollectionsBG(reverts); await ctx.triggerSync(); }
    },
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
