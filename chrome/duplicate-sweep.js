// chrome/duplicate-sweep.js
// Owns the interactive Duplicate-Tab Sweep state (chrome.storage.local key
// 'duplicateSweep'): applies each user action atomically and maintains a
// multi-level undo stack. Mutations go through TaboxAIStorage (atomic helpers).
(() => {
const DUPLICATE_SWEEP_KEY = 'duplicateSweep';
const local = (globalThis.browser || globalThis.chrome).storage.local;
function storageApi() { return globalThis.TaboxAIStorage; }

async function readState() { return (await local.get(DUPLICATE_SWEEP_KEY))[DUPLICATE_SWEEP_KEY] || null; }
async function writeState(state) { await local.set({ [DUPLICATE_SWEEP_KEY]: state }); }

// All sweep-state mutations go through one queue: the scan task streams AI
// recommendation updates while the user applies actions, and two interleaved
// read-modify-writes on the same key would clobber each other.
let mutationQueue = Promise.resolve();
function serialized(fn) {
    const run = mutationQueue.then(fn, fn);
    mutationQueue = run.then(() => {}, () => {});
    return run;
}

function newActionId() {
    return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Re-read the live tabs of the collections in a group and drop occurrences whose
// tab no longer exists. Returns the surviving url entries, or null if the group
// is no longer a real duplicate (cross: <2 collections still share; within: no
// url with >=2 copies left).
async function liveOccurrences(group) {
    const uids = group.collectionUids;
    const recs = await local.get(uids.map((u) => `collection_${u}`));
    const present = new Map();
    for (const u of uids) {
        const rec = recs[`collection_${u}`];
        present.set(u, new Set((rec && rec.tabs ? rec.tabs : []).map((t) => t.uid)));
    }
    const urls = group.urls.map((entry) => ({
        normalizedUrl: entry.normalizedUrl,
        occurrences: entry.occurrences.filter((o) => present.get(o.collectionUid) && present.get(o.collectionUid).has(o.tabUid)),
    })).filter((e) => e.occurrences.length > 0);
    if (group.kind === 'cross') {
        const distinct = new Set(urls.flatMap((e) => e.occurrences.map((o) => o.collectionUid)));
        if (distinct.size < 2) return null;
    } else if (!urls.some((e) => e.occurrences.length >= 2)) {
        return null;
    }
    return urls;
}

function bestTitleFor(group, normalizedUrl) {
    const rec = group.recommendation && group.recommendation.bestTitlePerUrl;
    const hit = rec && rec.find((b) => b.normalizedUrl === normalizedUrl);
    return hit ? hit.title : null;
}

function reconstructTab(group, occ, overrideTitle) {
    const base = occ.tab ? { ...occ.tab } : { uid: occ.tabUid, url: occ.url, title: occ.title };
    return { ...base, title: overrideTitle || base.title };
}

function toRemovedTabs(group, removed) {
    return removed.map((o) => ({
        collectionUid: o.collectionUid,
        position: o.position,
        tab: o.tab ? { ...o.tab } : { uid: o.tabUid, url: o.url, title: o.title },
    }));
}

async function applyRemovals(S, removed) {
    if (!removed.length) return;
    const byCol = new Map();
    for (const o of removed) {
        if (!byCol.has(o.collectionUid)) byCol.set(o.collectionUid, []);
        byCol.get(o.collectionUid).push(o.tabUid);
    }
    await S.removeTabsFromCollectionsBG([...byCol.entries()].map(([collectionUid, tabUids]) => ({ collectionUid, tabUids })));
}

// Compute + execute one action against one group. Returns the undo entry. Does
// NOT persist the sweep state — the caller does.
async function executeGroupAction(group, action, keeperUid) {
    const S = storageApi();
    const urls = await liveOccurrences(group);
    if (!urls) return { actionId: newActionId(), groupId: group.id, action: 'skip', removedTabs: [] };
    if (action === 'skip') return { actionId: newActionId(), groupId: group.id, action: 'skip', removedTabs: [] };

    if (group.kind === 'within' || action === 'dedupe-within') {
        const removed = [];
        for (const e of urls) {
            const sorted = [...e.occurrences].sort((a, b) => a.position - b.position);
            for (const o of sorted.slice(1)) removed.push(o);
        }
        await applyRemovals(S, removed);
        return { actionId: newActionId(), groupId: group.id, action: 'dedupe-within', removedTabs: toRemovedTabs(group, removed) };
    }

    if (action === 'discard-all') {
        const removed = urls.flatMap((e) => e.occurrences);
        await applyRemovals(S, removed);
        return { actionId: newActionId(), groupId: group.id, action: 'discard-all', removedTabs: toRemovedTabs(group, removed) };
    }

    if (action === 'extract') {
        const tabs = urls.map((e) => reconstructTab(group, e.occurrences[0], bestTitleFor(group, e.normalizedUrl)));
        const removed = urls.flatMap((e) => e.occurrences);
        let created;
        try {
            created = await S.createCollectionBG({ name: (group.recommendation && group.recommendation.suggestedNewCollectionName) || 'Shared Tabs', tabs });
            await applyRemovals(S, removed);
        } catch (err) {
            if (created) { try { await S.deleteCollectionBG(created.uid); } catch { /* best-effort rollback */ } }
            throw err;
        }
        return { actionId: newActionId(), groupId: group.id, action: 'extract', createdCollectionUid: created.uid, removedTabs: toRemovedTabs(group, removed) };
    }

    // keep-one
    const keeper = group.collectionUids.includes(keeperUid)
        ? keeperUid
        : (group.recommendation && group.recommendation.recommendedKeeperUid) || group.collectionUids[0];
    const removed = [];
    const titleEdits = [];
    for (const e of urls) {
        const inKeeper = e.occurrences.filter((o) => o.collectionUid === keeper).sort((a, b) => a.position - b.position);
        const others = e.occurrences.filter((o) => o.collectionUid !== keeper);
        for (const o of others) removed.push(o);
        for (const o of inKeeper.slice(1)) removed.push(o); // dedupe keeper too
        const kept = inKeeper[0];
        const best = bestTitleFor(group, e.normalizedUrl);
        if (kept && best && best !== kept.title) titleEdits.push({ collectionUid: keeper, tabUid: kept.tabUid, prevTitle: kept.title, title: best });
    }
    await applyRemovals(S, removed);
    if (titleEdits.length) await S.setTabTitlesBG(titleEdits.map((t) => ({ collectionUid: t.collectionUid, tabUid: t.tabUid, title: t.title })));
    return {
        actionId: newActionId(), groupId: group.id, action: 'keep-one', keeperUid: keeper,
        removedTabs: toRemovedTabs(group, removed),
        titleEdits: titleEdits.map((t) => ({ collectionUid: t.collectionUid, tabUid: t.tabUid, prevTitle: t.prevTitle })),
    };
}

function applyDuplicateSweepAction(args) { return serialized(() => doApplyDuplicateSweepAction(args)); }
async function doApplyDuplicateSweepAction({ groupId, action, keeperUid, applyToAll } = {}) {
    const state = await readState();
    if (!state) return { ok: false, reason: 'missing' };
    const current = state.groups.find((g) => g.id === groupId);
    if (!current) return { ok: false, reason: 'unknown-group' };
    if (current.status !== 'pending') return { ok: false, reason: 'not-pending' };

    const targets = [{ group: current, keeperUid }];
    if (applyToAll) {
        for (const g of state.groups) {
            if (g.status !== 'pending' || g.id === groupId) continue;
            targets.push({ group: g, keeperUid: g.recommendation ? g.recommendation.recommendedKeeperUid : undefined });
        }
    }

    let applied = 0;
    try {
        for (const t of targets) {
            // within-kind groups have no keeper/extract semantics — any non-skip
            // action collapses to dedupe-within (keep first copy). With applyToAll
            // this means a "Discard all"/"Extract" click dedupes within-groups
            // instead, which is intentional (less destructive, no keeper needed).
            const effectiveAction = (t.group.kind === 'within' && action !== 'skip') ? 'dedupe-within' : action;
            const entry = await executeGroupAction(t.group, effectiveAction, t.keeperUid);
            state.history.push(entry);
            t.group.status = 'resolved';
            applied += 1;
        }
    } catch (err) {
        // Persist whatever succeeded (their storage mutations already happened and
        // their undo entries are in history) before surfacing the failure.
        await writeState(state);
        return { ok: false, reason: (err && err.message) || 'error', applied };
    }
    await writeState(state);
    return { ok: true, applied };
}

// Collections the sweep emptied (touched by a history entry, now 0 tabs) and
// folders that would be left with no collections once those are removed.
// Pre-existing empty collections/folders the sweep never touched are excluded.
async function computeCleanupCandidates(state) {
    const S = storageApi();
    const touched = new Set();
    for (const entry of state.history || []) {
        for (const r of (entry.removedTabs || [])) touched.add(r.collectionUid);
    }
    const cIndex = await S.loadCollectionsIndexBG();
    const collections = [...touched]
        .filter((uid) => cIndex[uid] && (cIndex[uid].tabCount || 0) === 0)
        .map((uid) => ({ uid, name: cIndex[uid].name || 'Untitled collection' }));
    const emptySet = new Set(collections.map((c) => c.uid));
    const fIndex = await S.loadFoldersIndexBG();
    const folders = [];
    for (const [fuid, f] of Object.entries(fIndex)) {
        const children = Object.entries(cIndex).filter(([, c]) => c.parentId === fuid).map(([cuid]) => cuid);
        if (children.length > 0 && children.every((cuid) => emptySet.has(cuid))) {
            folders.push({ uid: fuid, name: f.name || 'Untitled folder', collectionUids: children });
        }
    }
    return { collections, folders };
}

function previewDuplicateSweepCleanup() {
    return serialized(async () => {
        const state = await readState();
        if (!state) return { ok: false, reason: 'missing', collections: [], folders: [] };
        const { collections, folders } = await computeCleanupCandidates(state);
        return { ok: true, collections, folders };
    });
}

// Deletes the requested empty collections/folders, validated against a fresh
// candidate computation so a stale popup can never delete non-empty data. The
// deleted records are kept in the history entry so undo can restore them.
function applyDuplicateSweepCleanup(args) { return serialized(() => doApplyDuplicateSweepCleanup(args)); }
async function doApplyDuplicateSweepCleanup({ collectionUids, folderUids } = {}) {
    const state = await readState();
    if (!state) return { ok: false, reason: 'missing' };
    const S = storageApi();
    const candidates = await computeCleanupCandidates(state);
    const wantedCollections = new Set(Array.isArray(collectionUids) ? collectionUids : []);
    const wantedFolders = new Set(Array.isArray(folderUids) ? folderUids : []);
    const collectionsToDelete = candidates.collections.filter((c) => wantedCollections.has(c.uid));
    const deleteSet = new Set(collectionsToDelete.map((c) => c.uid));

    // A folder may only go if every collection it still holds is being deleted now.
    const cIndex = await S.loadCollectionsIndexBG();
    const foldersToDelete = candidates.folders.filter((f) => {
        if (!wantedFolders.has(f.uid)) return false;
        return Object.entries(cIndex)
            .filter(([, c]) => c.parentId === f.uid)
            .every(([cuid]) => deleteSet.has(cuid));
    });
    if (!collectionsToDelete.length && !foldersToDelete.length) return { ok: true, removedCollections: 0, removedFolders: 0 };

    const collectionRecs = await local.get(collectionsToDelete.map((c) => `collection_${c.uid}`));
    const folderRecs = await local.get(foldersToDelete.map((f) => `folder_${f.uid}`));
    const removedCollections = collectionsToDelete.map((c) => collectionRecs[`collection_${c.uid}`]).filter(Boolean);
    const removedFolders = foldersToDelete.map((f) => folderRecs[`folder_${f.uid}`]).filter(Boolean);

    if (collectionsToDelete.length) await S.deleteCollectionsBG(collectionsToDelete.map((c) => c.uid));
    if (foldersToDelete.length) await S.deleteFoldersBG(foldersToDelete.map((f) => f.uid));

    // Surviving folders that just lost an empty collection need fresh counts.
    const deletedFolderSet = new Set(foldersToDelete.map((f) => f.uid));
    const survivingParents = [...new Set(removedCollections.map((r) => r.parentId).filter(Boolean))]
        .filter((uid) => !deletedFolderSet.has(uid));
    if (survivingParents.length) await S.updateFolderCountsBG(survivingParents);

    state.history.push({ actionId: newActionId(), action: 'cleanup', removedTabs: [], removedCollections, removedFolders });
    await writeState(state);
    return { ok: true, removedCollections: removedCollections.length, removedFolders: removedFolders.length };
}

// Pops and reverses the most recent action (multi-level; newest first). Known
// v1 limitation: if an applyToAll run auto-resolved a later group as a no-op
// because an earlier group removed their shared tabs, undoing the earlier group
// restores those tabs but the later group stays 'resolved'. A fresh sweep run
// re-detects them; no data is lost.
function undoDuplicateSweepLast() { return serialized(doUndoDuplicateSweepLast); }
async function doUndoDuplicateSweepLast() {
    const state = await readState();
    if (!state || !state.history.length) return { ok: false, reason: 'empty' };
    const S = storageApi();
    const entry = state.history.pop();
    if (entry.action === 'cleanup') {
        if (entry.removedFolders && entry.removedFolders.length) await S.restoreFoldersBG(entry.removedFolders);
        if (entry.removedCollections && entry.removedCollections.length) await S.restoreCollectionsBG(entry.removedCollections);
        const parents = [...new Set((entry.removedCollections || []).map((r) => r.parentId).filter(Boolean))];
        if (parents.length) await S.updateFolderCountsBG(parents);
        await writeState(state);
        return { ok: true };
    }
    if (entry.action === 'extract' && entry.createdCollectionUid) await S.deleteCollectionBG(entry.createdCollectionUid);
    if (entry.removedTabs && entry.removedTabs.length) await S.restoreTabsToCollectionsBG(entry.removedTabs);
    if (entry.titleEdits && entry.titleEdits.length) {
        await S.setTabTitlesBG(entry.titleEdits.map((t) => ({ collectionUid: t.collectionUid, tabUid: t.tabUid, title: t.prevTitle })));
    }
    const g = state.groups.find((x) => x.id === entry.groupId);
    if (g) g.status = 'pending';
    await writeState(state);
    return { ok: true };
}

async function dismissDuplicateSweep() { return serialized(async () => { await local.remove(DUPLICATE_SWEEP_KEY); return { ok: true }; }); }

const taboxDuplicateSweepApi = { DUPLICATE_SWEEP_KEY, applyDuplicateSweepAction, undoDuplicateSweepLast, dismissDuplicateSweep, previewDuplicateSweepCleanup, applyDuplicateSweepCleanup };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxDuplicateSweep = taboxDuplicateSweepApi;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = taboxDuplicateSweepApi;
})();
