// chrome/ai-storage.js
// Minimal, atomic collection/folder storage ops for AI apply, runnable in the
// service worker. Each function does a SINGLE read-modify-write of each index
// (never per-item parallel writes — see storage-index-atomic-writes). Folder
// deletes write a tombstone so sync doesn't resurrect them.
(() => {
// IMPORTANT: STORAGE_KEYS is intentionally duplicated here (not imported from
// background-utils.js) so this module is self-contained and lint-safe. This
// copy MUST stay in sync with app/utils/sharedConstants.js,
// chrome/background-utils.js, and chrome/sync-apply.js.
const STORAGE_KEYS = {
    COLLECTIONS_INDEX: 'collections_index',
    FOLDERS_INDEX: 'folders_index',
    LEGACY_TABS_ARRAY: 'tabsArray',
    DELETED_COLLECTION_TOMBSTONES: 'deleted_collection_tombstones',
    DELETED_FOLDER_TOMBSTONES: 'deleted_folder_tombstones',
    COLLECTION_PREFIX: 'collection_',
    FOLDER_PREFIX: 'folder_',
    STORAGE_VERSION: 'tabox_storage_version'
};
const KEYS = STORAGE_KEYS;
const local = (globalThis.browser || globalThis.chrome).storage.local;

const FOLDER_DEFAULT_ORDER = 999999; // new folders sort to the bottom; UI reorders after

async function getKey(k) { return (await local.get(k))[k]; }

async function loadCollectionsIndexBG() { return (await getKey(KEYS.COLLECTIONS_INDEX)) || {}; }
async function loadFoldersIndexBG() { return (await getKey(KEYS.FOLDERS_INDEX)) || {}; }

async function renameCollectionsBG(renames) {
    if (!Array.isArray(renames) || renames.length === 0) return false;
    const index = await loadCollectionsIndexBG();
    const now = Date.now();
    const recordKeys = renames.map((r) => `${KEYS.COLLECTION_PREFIX}${r.uid}`);
    const records = await local.get(recordKeys);
    const writes = {};
    for (const r of renames) {
        if (!index[r.uid]) continue;
        index[r.uid] = { ...index[r.uid], name: r.newName, lastUpdated: now };
        const recKey = `${KEYS.COLLECTION_PREFIX}${r.uid}`;
        const rec = records[recKey];
        if (rec) writes[recKey] = { ...rec, name: r.newName, lastUpdated: now };
    }
    writes[KEYS.COLLECTIONS_INDEX] = index;
    await local.set(writes);
    return true;
}

async function moveCollectionsToFoldersBG(moves) {
    if (!Array.isArray(moves) || moves.length === 0) return false;
    const index = await loadCollectionsIndexBG();
    const now = Date.now();
    const recordKeys = moves.map((m) => `${KEYS.COLLECTION_PREFIX}${m.uid}`);
    const records = await local.get(recordKeys);
    const writes = {};
    for (const m of moves) {
        if (!index[m.uid]) continue;
        index[m.uid] = { ...index[m.uid], parentId: m.parentId ?? null, lastUpdated: now };
        const recKey = `${KEYS.COLLECTION_PREFIX}${m.uid}`;
        const rec = records[recKey];
        if (rec) writes[recKey] = { ...rec, parentId: m.parentId ?? null, lastUpdated: now };
    }
    writes[KEYS.COLLECTIONS_INDEX] = index;
    await local.set(writes);
    return true;
}

function newUid() {
    return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function createFoldersBG(specs) {
    if (!Array.isArray(specs) || specs.length === 0) return [];
    const now = Date.now();
    const index = await loadFoldersIndexBG();
    const writes = {};
    const created = [];
    for (const s of specs) {
        if (!s || !s.name || typeof s.name !== 'string' || !s.name.trim()) {
            throw new Error('createFoldersBG: name is required');
        }
        const folder = {
            uid: newUid(), name: s.name, type: 'folder',
            color: s.color || 'var(--folder-default-color)',
            createdOn: now, lastUpdated: now, collapsed: !!s.collapsed,
            order: FOLDER_DEFAULT_ORDER, collectionCount: 0,
        };
        index[folder.uid] = { name: folder.name, color: folder.color, collapsed: folder.collapsed, order: folder.order, lastUpdated: now, collectionCount: 0 };
        writes[`${KEYS.FOLDER_PREFIX}${folder.uid}`] = folder;
        created.push(folder);
    }
    writes[KEYS.FOLDERS_INDEX] = index;
    await local.set(writes);
    return created;
}

async function createFolderBG(name, color, collapsed) {
    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new Error('createFolderBG: name is required');
    }
    const [folder] = await createFoldersBG([{ name, color, collapsed }]);
    return folder;
}

async function deleteFolderBG(uid) {
    const index = await loadFoldersIndexBG();
    delete index[uid];
    const tombs = (await getKey(KEYS.DELETED_FOLDER_TOMBSTONES)) || {};
    tombs[uid] = Date.now();
    await local.set({ [KEYS.FOLDERS_INDEX]: index, [KEYS.DELETED_FOLDER_TOMBSTONES]: tombs });
    await local.remove(`${KEYS.FOLDER_PREFIX}${uid}`);
    return true;
}

async function updateFolderCountsBG(folderUids) {
    if (!Array.isArray(folderUids) || folderUids.length === 0) return false;
    const cIndex = await loadCollectionsIndexBG();
    const fIndex = await loadFoldersIndexBG();
    const now = Date.now();
    const recordWrites = {};
    const folderRecords = await local.get((folderUids || []).map((u) => `${KEYS.FOLDER_PREFIX}${u}`));
    for (const uid of folderUids || []) {
        if (!fIndex[uid]) continue;
        const count = Object.values(cIndex).filter((c) => c.parentId === uid).length;
        fIndex[uid] = { ...fIndex[uid], collectionCount: count, lastUpdated: now };
        const recKey = `${KEYS.FOLDER_PREFIX}${uid}`;
        const rec = folderRecords[recKey];
        if (rec) recordWrites[recKey] = { ...rec, collectionCount: count, lastUpdated: now };
    }
    recordWrites[KEYS.FOLDERS_INDEX] = fIndex;
    await local.set(recordWrites);
    return true;
}

async function removeTabsFromCollectionsBG(removals) {
    if (!Array.isArray(removals) || removals.length === 0) return false;
    const index = await loadCollectionsIndexBG();
    const now = Date.now();
    const recordKeys = removals.map((r) => `${KEYS.COLLECTION_PREFIX}${r.collectionUid}`);
    const records = await local.get(recordKeys);
    const writes = {};
    for (const r of removals) {
        const recKey = `${KEYS.COLLECTION_PREFIX}${r.collectionUid}`;
        const rec = records[recKey];
        if (!rec) continue;
        const drop = new Set(r.tabUids || []);
        const tabs = (rec.tabs || []).filter((t) => !drop.has(t.uid));
        writes[recKey] = { ...rec, tabs, lastUpdated: now };
        if (index[r.collectionUid]) index[r.collectionUid] = { ...index[r.collectionUid], tabCount: tabs.length, lastUpdated: now };
    }
    writes[KEYS.COLLECTIONS_INDEX] = index;
    await local.set(writes);
    return true;
}

async function restoreTabsToCollectionsBG(restorations) {
    if (!Array.isArray(restorations) || restorations.length === 0) return false;
    const index = await loadCollectionsIndexBG();
    const now = Date.now();
    const byCol = new Map();
    for (const r of restorations) {
        if (!byCol.has(r.collectionUid)) byCol.set(r.collectionUid, []);
        byCol.get(r.collectionUid).push(r);
    }
    const recordKeys = [...byCol.keys()].map((uid) => `${KEYS.COLLECTION_PREFIX}${uid}`);
    const records = await local.get(recordKeys);
    const writes = {};
    for (const [uid, items] of byCol.entries()) {
        const recKey = `${KEYS.COLLECTION_PREFIX}${uid}`;
        const rec = records[recKey];
        if (!rec) continue;
        const tabs = [...(rec.tabs || [])];
        // Insert ascending by position so earlier insertions don't shift later ones.
        items.sort((a, b) => a.position - b.position);
        for (const it of items) {
            const at = Math.max(0, Math.min(it.position, tabs.length));
            tabs.splice(at, 0, it.tab);
        }
        writes[recKey] = { ...rec, tabs, lastUpdated: now };
        if (index[uid]) index[uid] = { ...index[uid], tabCount: tabs.length, lastUpdated: now };
    }
    writes[KEYS.COLLECTIONS_INDEX] = index;
    await local.set(writes);
    return true;
}

async function setTabTitlesBG(edits) {
    if (!Array.isArray(edits) || edits.length === 0) return false;
    const now = Date.now();
    const byCol = new Map();
    for (const e of edits) {
        if (!byCol.has(e.collectionUid)) byCol.set(e.collectionUid, []);
        byCol.get(e.collectionUid).push(e);
    }
    const recordKeys = [...byCol.keys()].map((uid) => `${KEYS.COLLECTION_PREFIX}${uid}`);
    const records = await local.get(recordKeys);
    const writes = {};
    for (const [uid, items] of byCol.entries()) {
        const recKey = `${KEYS.COLLECTION_PREFIX}${uid}`;
        const rec = records[recKey];
        if (!rec) continue;
        const titleByUid = new Map(items.map((i) => [i.tabUid, i.title]));
        const tabs = (rec.tabs || []).map((t) => (titleByUid.has(t.uid) ? { ...t, title: titleByUid.get(t.uid) } : t));
        writes[recKey] = { ...rec, tabs, lastUpdated: now };
    }
    await local.set(writes);
    return true;
}

async function createCollectionBG({ name, tabs = [], color } = {}) {
    if (!name || typeof name !== 'string' || !name.trim()) throw new Error('createCollectionBG: name is required');
    const now = Date.now();
    const uid = newUid();
    const record = {
        uid, name: name.trim(), type: 'collection', tabs,
        color: color || 'var(--collection-default-color)',
        createdOn: now, lastUpdated: now, lastOpened: null, chromeGroups: [], parentId: null,
    };
    const index = await loadCollectionsIndexBG();
    index[uid] = {
        name: record.name, type: 'collection', tabCount: tabs.length,
        lastUpdated: now, lastOpened: null, createdOn: now, color: record.color,
        size: JSON.stringify(record).length, parentId: null,
    };
    await local.set({ [`${KEYS.COLLECTION_PREFIX}${uid}`]: record, [KEYS.COLLECTIONS_INDEX]: index });
    return record;
}

async function deleteCollectionBG(uid) {
    const index = await loadCollectionsIndexBG();
    delete index[uid];
    const tombs = (await getKey(KEYS.DELETED_COLLECTION_TOMBSTONES)) || {};
    tombs[uid] = Date.now();
    await local.set({ [KEYS.COLLECTIONS_INDEX]: index, [KEYS.DELETED_COLLECTION_TOMBSTONES]: tombs });
    await local.remove(`${KEYS.COLLECTION_PREFIX}${uid}`);
    return true;
}

const aiStorageApi = {
    loadCollectionsIndexBG, loadFoldersIndexBG, renameCollectionsBG,
    moveCollectionsToFoldersBG, createFolderBG, createFoldersBG, deleteFolderBG, updateFolderCountsBG,
    removeTabsFromCollectionsBG, restoreTabsToCollectionsBG, setTabTitlesBG,
    createCollectionBG, deleteCollectionBG,
};
/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIStorage = aiStorageApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = aiStorageApi;
})();
