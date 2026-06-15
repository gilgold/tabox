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

// Resolve one chunk's assignments to concrete folder uids, batch-creating any new
// folders this chunk needs. Mutates the shared cross-chunk state (existingFolders /
// createdByLowerName / createdFolderUids) so a folder created for an earlier chunk is
// offered to later chunks for reuse instead of being recreated.
// Fail-fast: if folder creation fails partway, already-created folders may be orphaned
// with no undo path (the snapshot is only written after all moves succeed).
async function resolveChunkTargets(assignments, state) {
    const { storage, palette, existingFolders, createdByLowerName, createdFolderUids } = state;
    const pendingNames = [];
    for (const a of assignments) {
        if (a.existingFolderId) continue;
        const key = a.newFolderName.toLowerCase();
        if (createdByLowerName.has(key) || pendingNames.some((n) => n.toLowerCase() === key)) continue;
        pendingNames.push(a.newFolderName);
    }
    if (pendingNames.length) {
        const specs = pendingNames.map((name, i) => ({
            name,
            color: palette[(createdFolderUids.length + i) % palette.length],
            collapsed: true,
        }));
        const created = await storage.createFoldersBG(specs);
        if (!created || created.length !== specs.length) throw new Error('Failed to create folders');
        created.forEach((folder, i) => {
            const key = pendingNames[i].toLowerCase();
            createdByLowerName.set(key, folder.uid);
            createdFolderUids.push(folder.uid);
            existingFolders.push({ id: folder.uid, name: pendingNames[i] });
        });
    }
    const targetByCollection = new Map();
    for (const a of assignments) {
        const target = a.existingFolderId || createdByLowerName.get(a.newFolderName.toLowerCase());
        targetByCollection.set(a.collectionId, target);
    }
    return targetByCollection;
}

const def = {
    id: 'auto-arrange',
    async run({ ctx, report }) {
        const { planners, client, storage, loadLooseSummaries, triggerSync, isCancelled } = ctx;
        const loose = await loadLooseSummaries();
        const fIndex = await storage.loadFoldersIndexBG();
        const cIndex = await storage.loadCollectionsIndexBG();
        const priorParentById = new Map(loose.map((c) => [c.uid, (cIndex[c.uid] && cIndex[c.uid].parentId) || null]));
        await report({ total: loose.length, filed: 0 });
        if (await isCancelled() || loose.length === 0) {
            return { summary: loose.length === 0 ? 'No loose collections to arrange' : '', undo: null };
        }

        // Live folder list: starts with the real existing folders and grows as chunks
        // create new ones, so a folder created for chunk 1 can be reused by chunk 2.
        const existingFolders = Object.keys(fIndex).map((id) => ({ id, name: fIndex[id].name }));
        const state = { storage, palette: shuffledColors(), existingFolders, createdByLowerName: new Map(), createdFolderUids: [] };

        const moves = [];
        const updates = [];
        const affected = new Set();

        const session = await client.createAISession({
            systemPrompt: 'You sort browser-tab collections into folders. Folder names are short (2-4 words), specific, Title Case, no quotes or emojis.',
            temperature: 0,
        });
        try {
            for (let start = 0; start < loose.length; start += planners.MAX_COLLECTIONS) {
                if (await isCancelled()) break;
                const chunk = loose.slice(start, start + planners.MAX_COLLECTIONS);
                const raw = await client.promptForJSON(
                    session,
                    planners.buildArrangePrompt({ collections: chunk, existingFolders }),
                    planners.ARRANGE_SCHEMA,
                );
                const { assignments } = planners.normalizeArrangePlan(raw, chunk, existingFolders);
                const targetByCollection = await resolveChunkTargets(assignments, state);
                for (const a of assignments) {
                    const target = targetByCollection.get(a.collectionId);
                    const prev = priorParentById.has(a.collectionId) ? priorParentById.get(a.collectionId) : null;
                    moves.push({ uid: a.collectionId, prevParentId: prev });
                    updates.push({ uid: a.collectionId, parentId: target });
                    affected.add(target);
                    if (prev) affected.add(prev);
                }
                await report({ filed: moves.length });
            }
        } finally {
            session.destroy();
        }

        await storage.moveCollectionsToFoldersBG(updates);
        await storage.updateFolderCountsBG([...affected]);
        await report({ filed: moves.length });
        await triggerSync();
        const createdCount = state.createdFolderUids.length;
        const summary = `Filed ${moves.length} collection${moves.length === 1 ? '' : 's'} into folders · created ${createdCount} new folder${createdCount === 1 ? '' : 's'}`;
        return { summary, undo: { task: 'auto-arrange', moves, createdFolderUids: state.createdFolderUids } };
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
