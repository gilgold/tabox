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

async function createFolderBG(name, color, collapsed) {
    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new Error('createFolderBG: name is required');
    }
    const now = Date.now();
    const folder = {
        uid: newUid(), name, type: 'folder',
        color: color || 'var(--folder-default-color)',
        createdOn: now, lastUpdated: now, collapsed: !!collapsed,
        order: FOLDER_DEFAULT_ORDER, collectionCount: 0,
    };
    const index = await loadFoldersIndexBG();
    index[folder.uid] = { name: folder.name, color: folder.color, collapsed: folder.collapsed, order: folder.order, lastUpdated: now, collectionCount: 0 };
    await local.set({
        [KEYS.FOLDERS_INDEX]: index,
        [`${KEYS.FOLDER_PREFIX}${folder.uid}`]: folder,
    });
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

const aiStorageApi = {
    loadCollectionsIndexBG, loadFoldersIndexBG, renameCollectionsBG,
    moveCollectionsToFoldersBG, createFolderBG, deleteFolderBG, updateFolderCountsBG,
};
/* istanbul ignore next */
if (typeof globalThis !== 'undefined') globalThis.TaboxAIStorage = aiStorageApi;
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) module.exports = aiStorageApi;
})();
