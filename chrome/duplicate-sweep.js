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
    return { uid: occ.tabUid, url: occ.url, title: overrideTitle || occ.title };
}

function toRemovedTabs(group, removed) {
    return removed.map((o) => ({ collectionUid: o.collectionUid, position: o.position, tab: { uid: o.tabUid, url: o.url, title: o.title } }));
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
        const created = await S.createCollectionBG({ name: group.recommendation.suggestedNewCollectionName, tabs });
        const removed = urls.flatMap((e) => e.occurrences);
        await applyRemovals(S, removed);
        return { actionId: newActionId(), groupId: group.id, action: 'extract', createdCollectionUid: created.uid, removedTabs: toRemovedTabs(group, removed) };
    }

    // keep-one
    const keeper = group.collectionUids.includes(keeperUid) ? keeperUid : group.recommendation.recommendedKeeperUid;
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

async function applyDuplicateSweepAction({ groupId, action, keeperUid, applyToAll } = {}) {
    const state = await readState();
    if (!state) return { ok: false, reason: 'missing' };
    const current = state.groups.find((g) => g.id === groupId);
    if (!current) return { ok: false, reason: 'unknown-group' };

    const targets = [{ group: current, keeperUid }];
    if (applyToAll) {
        for (const g of state.groups) {
            if (g.status !== 'pending' || g.id === groupId) continue;
            targets.push({ group: g, keeperUid: g.recommendation ? g.recommendation.recommendedKeeperUid : undefined });
        }
    }

    for (const t of targets) {
        const effectiveAction = (t.group.kind === 'within' && action !== 'skip') ? 'dedupe-within' : action;
        const entry = await executeGroupAction(t.group, effectiveAction, t.keeperUid);
        state.history.push(entry);
        t.group.status = 'resolved';
    }
    await writeState(state);
    return { ok: true, applied: targets.length };
}

async function undoDuplicateSweepLast() {
    const state = await readState();
    if (!state || !state.history.length) return { ok: false, reason: 'empty' };
    const S = storageApi();
    const entry = state.history.pop();
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

async function dismissDuplicateSweep() { await local.remove(DUPLICATE_SWEEP_KEY); return { ok: true }; }

const taboxDuplicateSweepApi = { DUPLICATE_SWEEP_KEY, applyDuplicateSweepAction, undoDuplicateSweepLast, dismissDuplicateSweep };
/* istanbul ignore next */ if (typeof globalThis !== 'undefined') globalThis.TaboxDuplicateSweep = taboxDuplicateSweepApi;
/* istanbul ignore next */ if (typeof module !== 'undefined' && module.exports) module.exports = taboxDuplicateSweepApi;
})();
