// chrome/split-collection.js
// Owns the Split Collection apply + undo. Destructive: replaces one oversized
// collection with 2-4 sub-collections (optionally inside a new folder named
// after the original). Snapshots the original to chrome.storage.local
// ('splitCollectionUndo') before mutating so undo fully restores it.
// All storage mutations go through TaboxAIStorage (atomic single-index writes).
(() => {
const SPLIT_COLLECTION_UNDO_KEY = 'splitCollectionUndo';
const local = (globalThis.browser || globalThis.chrome).storage.local;
function S() { return globalThis.TaboxAIStorage; }

function newOpId() {
    return (globalThis.crypto && globalThis.crypto.randomUUID)
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

async function applySplitCollectionPlan({ uid, plan, folder } = {}) {
    const recKey = `collection_${uid}`;
    const original = (await local.get(recKey))[recKey];
    if (!original) return { success: false, reason: 'missing' };

    const opId = newOpId();
    // Capture the original's existing index entry BEFORE any mutation so undo
    // can restore it verbatim (preserving fields like isFavorite/favoriteOrder).
    const indexBefore = await S().loadCollectionsIndexBG();
    const originalIndexEntry = indexBefore[uid];

    const tabs = original.tabs || [];
    const specs = (plan.groups || []).map((g, i) => ({
        name: g.name,
        tabs: g.tabIndices.map((idx) => tabs[idx]).filter(Boolean),
        color: original.color,
        order: (typeof original.order === 'number' ? original.order : 0) + i * 0.001,
    }));

    let folderUid = null;
    if (folder && folder.name) {
        const created = await S().createFolderBG(folder.name, original.color, false);
        folderUid = created.uid;
        specs.forEach((s) => { s.parentId = folderUid; });
    } else {
        specs.forEach((s) => { s.parentId = original.parentId ?? null; });
    }

    const createdCollections = await S().createCollectionsBG(specs);
    const createdUids = createdCollections.map((c) => c.uid);

    // Snapshot BEFORE deleting the original so undo can fully restore.
    await local.set({
        [SPLIT_COLLECTION_UNDO_KEY]: {
            opId,
            createdAt: Date.now(),
            original,
            originalIndexEntry,
            createdUids,
            folderUid,
        },
    });

    await S().deleteCollectionBG(uid);
    if (folderUid) await S().updateFolderCountsBG([folderUid]);

    return { success: true, opId, createdUids, folderUid };
}

async function undoSplitCollection({ opId } = {}) {
    const snap = (await local.get(SPLIT_COLLECTION_UNDO_KEY))[SPLIT_COLLECTION_UNDO_KEY];
    if (!snap) return { success: false, reason: 'missing' };

    // If the caller scopes the undo to a specific operation and the snapshot is
    // for a different (newer) split, refuse — without destroying anything.
    if (opId && snap.opId && opId !== snap.opId) {
        return { success: false, reason: 'superseded' };
    }

    for (const u of snap.createdUids || []) {
        try { await S().deleteCollectionBG(u); } catch (e) { console.error('split undo: delete sub failed', u, e); }
    }
    if (snap.folderUid) {
        try { await S().deleteFolderBG(snap.folderUid); } catch (e) { console.error('split undo: delete folder failed', e); }
    }
    // Restore the original verbatim (exact uid/order/parentId/tabs).
    const o = snap.original;
    const index = await S().loadCollectionsIndexBG();
    index[o.uid] = snap.originalIndexEntry
        ? snap.originalIndexEntry
        : {
            name: o.name, type: 'collection', tabCount: (o.tabs || []).length,
            lastUpdated: Date.now(), lastOpened: o.lastOpened ?? null, createdOn: o.createdOn,
            color: o.color, size: JSON.stringify(o).length, parentId: o.parentId ?? null, order: o.order,
        };
    await local.set({ [`collection_${o.uid}`]: o, collections_index: index });
    if (o.parentId) { try { await S().updateFolderCountsBG([o.parentId]); } catch (_) { /* folder may be gone */ } }
    await local.remove(SPLIT_COLLECTION_UNDO_KEY);
    return { success: true };
}

const api = { applySplitCollectionPlan, undoSplitCollection, SPLIT_COLLECTION_UNDO_KEY };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxSplitCollection = api;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
