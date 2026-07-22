(() => {
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

const normalizeCollection = (collection, index, now) => {
    const createdOn = Number.isFinite(collection.createdOn) ? collection.createdOn : now;
    const lastUpdated = Number.isFinite(collection.lastUpdated) ? collection.lastUpdated : createdOn;

    return {
        ...collection,
        uid: collection.uid,
        name: collection.name || 'Untitled Collection',
        tabs: Array.isArray(collection.tabs) ? collection.tabs : [],
        chromeGroups: Array.isArray(collection.chromeGroups) ? collection.chromeGroups : [],
        color: collection.color || 'default',
        createdOn,
        lastUpdated,
        lastOpened: collection.lastOpened !== undefined ? collection.lastOpened : null,
        parentId: collection.parentId ?? null,
        order: collection.order !== undefined ? collection.order : index,
        type: 'collection'
    };
};

const normalizeFolder = (folder, index, collections, now) => {
    const createdOn = Number.isFinite(folder.createdOn) ? folder.createdOn : now;
    const lastUpdated = Number.isFinite(folder.lastUpdated) ? folder.lastUpdated : createdOn;

    return {
        ...folder,
        uid: folder.uid,
        name: folder.name || 'Untitled Folder',
        type: 'folder',
        color: folder.color || 'var(--folder-default-color)',
        collapsed: folder.collapsed !== undefined ? folder.collapsed : false,
        createdOn,
        lastUpdated,
        order: folder.order !== undefined ? folder.order : index,
        collectionCount: collections.filter((collection) => collection.parentId === folder.uid).length
    };
};

// Task 9: shared folders (Task 8) are owned by the Cloudflare Worker, never by Google
// Drive. Mirrors chrome/shared-folders.js's isSharedFolderRecord - duplicated in place
// rather than required, because this file is loaded earliest in background.js's
// importScripts chain (before shared-folders.js) and is held to a 100% coverage bar;
// a cross-module require would need an untestable environment-detection branch for no
// real benefit over this one-line predicate.
function isSharedFolderRecord(folder) {
    return Boolean(folder && folder.shared && folder.shared.folderId);
}

function buildIndexedSyncPayload({ currentStorage = {}, syncData = {}, now = Date.now() }) {
    // Compute the LOCAL shared-folder/collection uids up front so pulled Drive data can
    // never create, update, or delete a shared folder (or a collection living inside
    // one) - regardless of what a foreign/legacy device may have uploaded.
    const localCollectionIndex = currentStorage[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
    const localFolderIndex = currentStorage[STORAGE_KEYS.FOLDERS_INDEX] || {};
    const localSharedFolderUids = new Set(
        Object.keys(localFolderIndex).filter((uid) => isSharedFolderRecord(localFolderIndex[uid]))
    );
    const localSharedCollectionUids = new Set(
        Object.keys(localCollectionIndex).filter((uid) => localSharedFolderUids.has(localCollectionIndex[uid].parentId))
    );

    const rawIncomingCollections = Array.isArray(syncData.tabsArray)
        ? syncData.tabsArray.filter((collection) =>
            !localSharedCollectionUids.has(collection.uid) && !localSharedFolderUids.has(collection.parentId))
        : [];
    const rawIncomingFolders = Array.isArray(syncData.foldersArray)
        ? syncData.foldersArray.filter((folder) => !localSharedFolderUids.has(folder.uid))
        : [];

    // Defense-in-depth: a completely empty incoming snapshot must never wipe existing
    // local data. A stale/corrupt remote (or a device that lost its localTimestamp) could
    // otherwise delete every collection. When the snapshot is empty but local storage has
    // data, preserve the local set instead of applying the deletion. A snapshot with any
    // collections/folders is treated as authoritative (legitimate deletions still apply).
    const incomingIsEmpty = rawIncomingCollections.length === 0 && rawIncomingFolders.length === 0;
    const localHasData = Object.keys(localCollectionIndex).length > 0
        || Object.keys(localFolderIndex).length > 0;

    let rawCollections;
    let rawFolders;

    if (incomingIsEmpty && localHasData) {
        rawCollections = Object.keys(localCollectionIndex)
            .map((uid) => currentStorage[`${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`])
            .filter(Boolean);
        rawFolders = Object.keys(localFolderIndex)
            .map((uid) => currentStorage[`${STORAGE_KEYS.FOLDER_PREFIX}${uid}`])
            .filter(Boolean);
    } else {
        // Shared folders/collections were excluded from the incoming set above - reinstate
        // the local records verbatim so a pull can never delete or overwrite them.
        const localSharedCollections = Array.from(localSharedCollectionUids)
            .map((uid) => currentStorage[`${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`])
            .filter(Boolean);
        const localSharedFolders = Array.from(localSharedFolderUids)
            .map((uid) => currentStorage[`${STORAGE_KEYS.FOLDER_PREFIX}${uid}`])
            .filter(Boolean);
        rawCollections = rawIncomingCollections.concat(localSharedCollections);
        rawFolders = rawIncomingFolders.concat(localSharedFolders);
    }

    let collections = rawCollections.map((collection, index) => normalizeCollection(collection, index, now));
    let folders = rawFolders.map((folder, index) => normalizeFolder(folder, index, collections, now));

    const collectionsIndex = collections.reduce((index, collection) => {
        index[collection.uid] = {
            name: collection.name,
            type: 'collection',
            tabCount: collection.tabs.length,
            lastUpdated: collection.lastUpdated,
            lastOpened: collection.lastOpened,
            createdOn: collection.createdOn,
            color: collection.color,
            size: JSON.stringify(collection).length,
            parentId: collection.parentId,
            order: collection.order
        };
        return index;
    }, {});

    const foldersIndex = folders.reduce((index, folder) => {
        index[folder.uid] = {
            name: folder.name,
            type: 'folder',
            color: folder.color,
            collapsed: folder.collapsed,
            collectionCount: folder.collectionCount,
            lastUpdated: folder.lastUpdated,
            createdOn: folder.createdOn,
            size: JSON.stringify(folder).length,
            order: folder.order,
            // Carry the shared marker through the rebuild - stripping it here would leave
            // the folder unprotected on the NEXT pull (and trigger a destructive
            // rematerialize in shared-folders.js). Only set the key when present so
            // unshared entries stay clean.
            ...(isSharedFolderRecord(folder) ? { shared: folder.shared } : {})
        };
        return index;
    }, {});

    const staleCollectionKeys = Object.keys(currentStorage[STORAGE_KEYS.COLLECTIONS_INDEX] || {})
        .filter((uid) => !collectionsIndex[uid])
        .map((uid) => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
    const staleFolderKeys = Object.keys(currentStorage[STORAGE_KEYS.FOLDERS_INDEX] || {})
        .filter((uid) => !foldersIndex[uid])
        .map((uid) => `${STORAGE_KEYS.FOLDER_PREFIX}${uid}`);
    const deletedCollections = Array.isArray(syncData.deletedCollections)
        ? syncData.deletedCollections.reduce((entries, tombstone) => {
            if (!tombstone?.uid || !Number.isFinite(tombstone.lastUpdated) || localSharedCollectionUids.has(tombstone.uid)) {
                return entries;
            }

            entries[tombstone.uid] = tombstone.lastUpdated;
            return entries;
        }, {})
        : {};
    const deletedFolders = Array.isArray(syncData.deletedFolders)
        ? syncData.deletedFolders.reduce((entries, tombstone) => {
            if (!tombstone?.uid || !Number.isFinite(tombstone.lastUpdated) || localSharedFolderUids.has(tombstone.uid)) {
                return entries;
            }

            entries[tombstone.uid] = tombstone.lastUpdated;
            return entries;
        }, {})
        : {};

    const setPayload = {
        [STORAGE_KEYS.COLLECTIONS_INDEX]: collectionsIndex,
        [STORAGE_KEYS.FOLDERS_INDEX]: foldersIndex,
        [STORAGE_KEYS.LEGACY_TABS_ARRAY]: collections,
        [STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES]: deletedCollections,
        [STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES]: deletedFolders,
        [STORAGE_KEYS.STORAGE_VERSION]: 3
    };

    collections.forEach((collection) => {
        setPayload[`${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`] = collection;
    });

    folders.forEach((folder) => {
        setPayload[`${STORAGE_KEYS.FOLDER_PREFIX}${folder.uid}`] = folder;
    });

    return {
        setPayload,
        removeKeys: staleCollectionKeys.concat(staleFolderKeys),
        collections,
        folders
    };
}

const SYNC_MANAGED_KEYS = new Set([
    STORAGE_KEYS.COLLECTIONS_INDEX,
    STORAGE_KEYS.FOLDERS_INDEX,
    STORAGE_KEYS.LEGACY_TABS_ARRAY,
    STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES,
    STORAGE_KEYS.DELETED_FOLDER_TOMBSTONES,
    STORAGE_KEYS.STORAGE_VERSION
]);

function isSyncManagedKey(key) {
    return SYNC_MANAGED_KEYS.has(key)
        || key.startsWith(STORAGE_KEYS.COLLECTION_PREFIX)
        || key.startsWith(STORAGE_KEYS.FOLDER_PREFIX);
}

function valuesMatch(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function rollbackSyncManagedKeys(storageArea, snapshot, payload) {
    const touchedKeys = Array.from(new Set([
        ...Object.keys(snapshot).filter(isSyncManagedKey),
        ...Object.keys(payload.setPayload),
        ...payload.removeKeys
    ].filter(isSyncManagedKey)));

    /* istanbul ignore next: setPayload always contributes sync-managed keys */
    const currentValues = touchedKeys.length > 0
        ? await storageArea.get(touchedKeys)
        : {};
    const rollbackSet = {};
    const rollbackRemove = [];

    touchedKeys.forEach((key) => {
        const hadSnapshotValue = Object.prototype.hasOwnProperty.call(snapshot, key);
        const attemptedValue = Object.prototype.hasOwnProperty.call(payload.setPayload, key)
            ? payload.setPayload[key]
            : (payload.removeKeys.includes(key) ? undefined : snapshot[key]);
        const currentValue = Object.prototype.hasOwnProperty.call(currentValues, key)
            ? currentValues[key]
            : undefined;

        if (!valuesMatch(currentValue, attemptedValue)) {
            return;
        }

        if (hadSnapshotValue) {
            rollbackSet[key] = snapshot[key];
            return;
        }

        rollbackRemove.push(key);
    });

    if (Object.keys(rollbackSet).length > 0) {
        await storageArea.set(rollbackSet);
    }

    if (rollbackRemove.length > 0) {
        await storageArea.remove(rollbackRemove);
    }
}

async function applySyncSnapshotAtomically({ storageArea, syncData, now = Date.now() }) {
    const currentStorage = await storageArea.get(null);
    const payload = buildIndexedSyncPayload({
        currentStorage,
        syncData,
        now
    });

    try {
        await storageArea.set(payload.setPayload);
        await storageArea.remove(payload.removeKeys);

        return {
            success: true,
            collections: payload.collections,
            folders: payload.folders
        };
    } catch (error) {
        try {
            await rollbackSyncManagedKeys(storageArea, currentStorage, payload);
        } catch (rollbackError) {
            return {
                success: false,
                error: error.message,
                rollbackSucceeded: false,
                rollbackError: rollbackError.message
            };
        }

        return {
            success: false,
            error: error.message,
            rollbackSucceeded: true
        };
    }
}

const syncApplyApi = {
    STORAGE_KEYS,
    isSharedFolderRecord,
    buildIndexedSyncPayload,
    isSyncManagedKey,
    applySyncSnapshotAtomically
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') {
    globalThis.TaboxSyncApply = syncApplyApi;
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncApplyApi;
}
})();
