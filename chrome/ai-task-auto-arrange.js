// chrome/ai-task-auto-arrange.js
// AI task: file loose collections into folders. Domain logic only.
(() => {
const FOLDER_COLORS = ['#4facfe', '#43e97b', '#a855f7', '#fb923c', '#ef4444', '#eab308', '#ec4899', '#14b8a6', '#6b7280'];
function shuffledColors() {
    const colors = [...FOLDER_COLORS];
    for (let i = colors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    return colors;
}
// Fail-fast: if folder creation fails partway, already-created folders may be orphaned with no undo path
// (the snapshot is only written after all moves succeed). Matches the original autoArrangeApply.js behavior.
async function resolveTargets(assignments, storage) {
    const createdFolderUids = [];
    const createdByLowerName = new Map();
    const targetByCollection = new Map();
    const palette = shuffledColors();
    for (const a of assignments) {
        if (a.existingFolderId) { targetByCollection.set(a.collectionId, a.existingFolderId); continue; }
        const key = a.newFolderName.toLowerCase();
        let uid = createdByLowerName.get(key);
        if (!uid) {
            const color = palette[createdFolderUids.length % palette.length];
            const folder = await storage.createFolderBG(a.newFolderName, color, true);
            if (!folder) throw new Error(`Failed to create folder "${a.newFolderName}"`);
            uid = folder.uid;
            createdByLowerName.set(key, uid);
            createdFolderUids.push(uid);
        }
        targetByCollection.set(a.collectionId, uid);
    }
    return { targetByCollection, createdFolderUids };
}
const def = {
    id: 'auto-arrange',
    async run({ ctx, report }) {
        const { planners, client, storage, loadCollections, triggerSync, isCancelled } = ctx;
        const all = await loadCollections();
        const loose = all.filter((c) => !c.parentId).slice(0, planners.MAX_COLLECTIONS);
        const fIndex = await storage.loadFoldersIndexBG();
        const existingFolders = Object.keys(fIndex).map((id) => ({ id, name: fIndex[id].name }));
        await report({ total: loose.length, filed: 0 });
        if (await isCancelled()) return { summary: '', undo: null };
        const session = await client.createAISession({ systemPrompt: 'You sort browser-tab collections into folders. Folder names are short (2-4 words), specific, Title Case, no quotes or emojis.', temperature: 0.7, topK: 3 });
        let raw;
        try { raw = await client.promptForJSON(session, planners.buildArrangePrompt({ collections: loose, existingFolders }), planners.ARRANGE_SCHEMA); }
        finally { session.destroy(); }
        const { assignments } = planners.normalizeArrangePlan(raw, loose, existingFolders);
        const cIndex = await storage.loadCollectionsIndexBG();
        const priorParentById = new Map(loose.map((c) => [c.uid, (cIndex[c.uid] && cIndex[c.uid].parentId) || null]));
        const { targetByCollection, createdFolderUids } = await resolveTargets(assignments, storage);
        const moves = [];
        const updates = [];
        const affected = new Set();
        for (const a of assignments) {
            const target = targetByCollection.get(a.collectionId);
            const prev = priorParentById.has(a.collectionId) ? priorParentById.get(a.collectionId) : null;
            moves.push({ uid: a.collectionId, prevParentId: prev });
            updates.push({ uid: a.collectionId, parentId: target });
            affected.add(target);
            if (prev) affected.add(prev);
        }
        await storage.moveCollectionsToFoldersBG(updates);
        await storage.updateFolderCountsBG([...affected]);
        await report({ filed: moves.length });
        await triggerSync();
        const summary = `Filed ${moves.length} collection${moves.length === 1 ? '' : 's'} into folders · created ${createdFolderUids.length} new folder${createdFolderUids.length === 1 ? '' : 's'}`;
        return { summary, undo: { task: 'auto-arrange', moves, createdFolderUids } };
    },
    async undo({ ctx, snapshot }) {
        const { storage, triggerSync } = ctx;
        const moves = snapshot.moves || [];
        await storage.moveCollectionsToFoldersBG(moves.map((m) => ({ uid: m.uid, parentId: m.prevParentId || null })));
        const affected = new Set(snapshot.createdFolderUids || []);
        moves.forEach((m) => { if (m.prevParentId) affected.add(m.prevParentId); });
        await storage.updateFolderCountsBG([...affected]);
        const cIndex = await storage.loadCollectionsIndexBG();
        const countByParent = {};
        Object.values(cIndex).forEach((c) => { if (c.parentId) countByParent[c.parentId] = (countByParent[c.parentId] || 0) + 1; });
        for (const uid of snapshot.createdFolderUids || []) {
            if (!countByParent[uid]) await storage.deleteFolderBG(uid);
        }
        await triggerSync();
    },
};
/* istanbul ignore next */ if (typeof globalThis !== 'undefined' && globalThis.TaboxAIRegistry) globalThis.TaboxAIRegistry.register(def);
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = def;
})();
