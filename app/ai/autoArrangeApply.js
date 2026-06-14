// Applies an auto-arrange plan to storage and supports undo. Kept separate from
// the planning engine (autoArrangeCollections) so the engine stays pure/testable.
import { browser } from '../../static/globals';
import {
    loadAllCollections,
    batchUpdateCollections,
    updateFolderCollectionCount,
} from '../utils/storageUtils';
import { createFolder, deleteFolder } from '../utils/folderOperations';
import { triggerBackgroundSync } from '../utils/sharedSync';

export const AUTO_ARRANGE_UNDO_KEY = 'autoArrangeUndo';

// The same folder palette the Create/Save Folder UIs offer. New auto-arrange
// folders draw from a shuffled copy so they aren't all one color.
const FOLDER_COLORS = ['#4facfe', '#43e97b', '#a855f7', '#fb923c', '#ef4444', '#eab308', '#ec4899', '#14b8a6', '#6b7280'];

// Fisher-Yates shuffle (returns a new array). Math.random is fine in app code.
function shuffledColors() {
    const colors = [...FOLDER_COLORS];
    for (let i = colors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    return colors;
}

// Resolve every assignment's newFolderName to a real folder uid, creating each
// unique name exactly once. New folders are created collapsed, with varied colors.
// Returns { targetByCollection: Map, createdFolderUids: [] }.
// Note: on partial failure, already-created folders may be orphaned — acceptable since
// fail-fast is the only safe option when a complete snapshot isn't yet available.
async function resolveTargets(assignments) {
    const createdFolderUids = [];
    const createdByLowerName = new Map();
    const targetByCollection = new Map();
    // Assign distinct colors in turn (wraps after the palette is exhausted).
    const palette = shuffledColors();

    for (const a of assignments) {
        if (a.existingFolderId) {
            targetByCollection.set(a.collectionId, a.existingFolderId);
            continue;
        }
        const key = a.newFolderName.toLowerCase();
        let uid = createdByLowerName.get(key);
        if (!uid) {
            const color = palette[createdFolderUids.length % palette.length];
            // createFolder(name, color, collapsed) — collapsed so new folders fold away.
            const folder = await createFolder(a.newFolderName, color, true);
            if (!folder) throw new Error(`Failed to create folder "${a.newFolderName}"`);
            uid = folder.uid;
            createdByLowerName.set(key, uid);
            createdFolderUids.push(uid);
        }
        targetByCollection.set(a.collectionId, uid);
    }
    return { targetByCollection, createdFolderUids };
}

export async function applyAutoArrange(plan) {
    const assignments = (plan && plan.assignments) || [];
    if (assignments.length === 0) {
        return { snapshot: null, foldersCreated: 0, collectionsMoved: 0 };
    }

    // Capture prior parentIds before mutating.
    const current = await loadAllCollections({ metadataOnly: true });
    const priorParentById = new Map(current.map((c) => [c.uid, c.parentId ?? null]));

    const { targetByCollection, createdFolderUids } = await resolveTargets(assignments);

    const now = Date.now();
    const moves = [];
    const updates = [];
    const affectedFolderUids = new Set();
    for (const a of assignments) {
        const targetFolderId = targetByCollection.get(a.collectionId);
        const prevParentId = priorParentById.has(a.collectionId) ? priorParentById.get(a.collectionId) : null;
        moves.push({ uid: a.collectionId, prevParentId });
        updates.push({ uid: a.collectionId, parentId: targetFolderId, lastUpdated: now });
        affectedFolderUids.add(targetFolderId);
        if (prevParentId) affectedFolderUids.add(prevParentId);
    }

    // Single batched storage write (never per-item parallel writes).
    const ok = await batchUpdateCollections(updates);
    if (!ok) throw new Error('Auto-arrange: failed to move collections');

    for (const folderUid of affectedFolderUids) {
        await updateFolderCollectionCount(folderUid);
    }

    const snapshot = { moves, createdFolderUids, createdAt: now };
    await browser.storage.local.set({ [AUTO_ARRANGE_UNDO_KEY]: snapshot });
    // createFolder triggers sync internally; this is the authoritative final sync for the full operation.
    await triggerBackgroundSync();

    return { snapshot, foldersCreated: createdFolderUids.length, collectionsMoved: moves.length };
}

export async function undoAutoArrange(snapshot) {
    if (!snapshot || !snapshot.moves) return;

    const now = Date.now();
    const restores = snapshot.moves.map((m) => ({ uid: m.uid, parentId: m.prevParentId ?? null, lastUpdated: now }));
    const ok = await batchUpdateCollections(restores);
    if (!ok) throw new Error('Auto-arrange undo: failed to restore collections');

    const affected = new Set(snapshot.createdFolderUids || []);
    for (const m of snapshot.moves) {
        if (m.prevParentId) affected.add(m.prevParentId);
    }
    for (const folderUid of affected) {
        await updateFolderCollectionCount(folderUid);
    }

    // Delete folders this run created, only if now empty.
    const after = await loadAllCollections({ metadataOnly: true });
    const countByParent = new Map();
    for (const c of after) {
        const p = c.parentId ?? null;
        if (p) countByParent.set(p, (countByParent.get(p) || 0) + 1);
    }
    for (const folderUid of snapshot.createdFolderUids || []) {
        if (!countByParent.get(folderUid)) {
            await deleteFolder(folderUid, true);
        }
    }

    await browser.storage.local.remove(AUTO_ARRANGE_UNDO_KEY);
    await triggerBackgroundSync();
}
