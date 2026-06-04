(() => {
const normalizeCollection = (collection, index, now) => {
    const createdOn = Number.isFinite(collection.createdOn) ? collection.createdOn : now;
    const lastUpdated = Number.isFinite(collection.lastUpdated) ? collection.lastUpdated : createdOn;

    return {
        ...collection,
        uid: collection.uid,
        name: collection.name || 'Untitled Collection',
        tabs: Array.isArray(collection.tabs) ? collection.tabs : [],
        chromeGroups: Array.isArray(collection.chromeGroups) ? collection.chromeGroups : [],
        createdOn,
        lastUpdated,
        lastOpened: collection.lastOpened !== undefined ? collection.lastOpened : null,
        parentId: collection.parentId ?? null,
        order: collection.order !== undefined ? collection.order : index,
        type: 'collection'
    };
};

const normalizeFolder = (folder, index, now) => {
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
        order: folder.order !== undefined ? folder.order : index
    };
};

function normalizeSyncSnapshot(syncData = {}, now = Date.now()) {
    return {
        timestamp: Number.isFinite(syncData.timestamp) ? syncData.timestamp : 0,
        tabsArray: Array.isArray(syncData.tabsArray)
            ? syncData.tabsArray.map((collection, index) => normalizeCollection(collection, index, now))
            : [],
        deletedCollections: Array.isArray(syncData.deletedCollections)
            ? syncData.deletedCollections
                .filter((tombstone) => tombstone?.uid)
                .map((tombstone) => ({
                    uid: tombstone.uid,
                    lastUpdated: Number.isFinite(tombstone.lastUpdated) ? tombstone.lastUpdated : 0
                }))
            : [],
        deletedFolders: Array.isArray(syncData.deletedFolders)
            ? syncData.deletedFolders
                .filter((tombstone) => tombstone?.uid)
                .map((tombstone) => ({
                    uid: tombstone.uid,
                    lastUpdated: Number.isFinite(tombstone.lastUpdated) ? tombstone.lastUpdated : 0
                }))
            : [],
        foldersArray: Array.isArray(syncData.foldersArray)
            ? syncData.foldersArray.map((folder, index) => normalizeFolder(folder, index, now))
            : [],
        syncVersion: syncData.syncVersion || '4.0',
        storageVersion: Number.isFinite(syncData.storageVersion) ? syncData.storageVersion : 3,
        extensionVersion: syncData.extensionVersion || '4.0',
        isIncrementalSync: false
    };
}

const sortByOrderAndUid = (items) => (
    [...items].sort((left, right) => {
        const leftOrder = left.order;
        const rightOrder = right.order;

        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }

        return String(left.uid).localeCompare(String(right.uid));
    })
);

const chooseMergedEntity = (localEntity, remoteEntity) => {
    return remoteEntity.lastUpdated >= localEntity.lastUpdated
        ? remoteEntity
        : localEntity;
};

const resolveSingleSidedEntity = ({
    localEntity,
    remoteEntity,
    localSnapshotTimestamp,
    remoteSnapshotTimestamp
}) => {
    if (localEntity && remoteEntity) {
        return chooseMergedEntity(localEntity, remoteEntity);
    }

    if (localEntity) {
        return localEntity;
    }

    const localDeletionLikely = (
        localSnapshotTimestamp > remoteSnapshotTimestamp &&
        remoteEntity.lastUpdated <= localSnapshotTimestamp
    );

    return localDeletionLikely ? null : remoteEntity;
};

const mergeDeletionTombstones = (localDeletedCollections, remoteDeletedCollections) => {
    const tombstones = new Map();

    [...localDeletedCollections, ...remoteDeletedCollections].forEach((tombstone) => {
        const existingLastUpdated = tombstones.get(tombstone.uid) || 0;
        if (tombstone.lastUpdated >= existingLastUpdated) {
            tombstones.set(tombstone.uid, tombstone.lastUpdated);
        }
    });

    return tombstones;
};

const applyDeletionTombstones = (entities, tombstones) => {
    return entities.filter((entity) => {
        const tombstoneLastUpdated = tombstones.get(entity.uid);
        return !tombstoneLastUpdated || tombstoneLastUpdated < entity.lastUpdated;
    });
};

const serializeDeletionTombstones = (tombstones, survivingEntities) => {
    const survivingEntityMap = new Map(survivingEntities.map((entity) => [entity.uid, entity.lastUpdated]));

    return Array.from(tombstones.entries())
        .filter(([uid, tombstoneLastUpdated]) => {
            const survivingEntityLastUpdated = survivingEntityMap.get(uid);
            return !survivingEntityLastUpdated || tombstoneLastUpdated >= survivingEntityLastUpdated;
        })
        .map(([uid, lastUpdated]) => ({ uid, lastUpdated }))
        .sort((left, right) => {
            if (left.lastUpdated !== right.lastUpdated) {
                return left.lastUpdated - right.lastUpdated;
            }

            return String(left.uid).localeCompare(String(right.uid));
        });
};

const mergeEntityCollections = ({
    localEntities,
    remoteEntities,
    localSnapshotTimestamp,
    remoteSnapshotTimestamp
}) => {
    const localEntityMap = new Map(localEntities.map((entity) => [entity.uid, entity]));
    const remoteEntityMap = new Map(remoteEntities.map((entity) => [entity.uid, entity]));
    const allUids = new Set([
        ...localEntityMap.keys(),
        ...remoteEntityMap.keys()
    ]);
    const mergedEntities = [];

    allUids.forEach((uid) => {
        const mergedEntity = resolveSingleSidedEntity({
            localEntity: localEntityMap.get(uid),
            remoteEntity: remoteEntityMap.get(uid),
            localSnapshotTimestamp,
            remoteSnapshotTimestamp
        });

        if (mergedEntity) {
            mergedEntities.push(mergedEntity);
        }
    });

    return sortByOrderAndUid(mergedEntities);
};

const normalizeOrphanedCollections = (collections, folders) => {
    const folderUids = new Set(folders.map((folder) => folder.uid));

    return collections.map((collection) => (
        collection.parentId && !folderUids.has(collection.parentId)
            ? { ...collection, parentId: null }
            : collection
    ));
}

function mergeSyncSnapshots({ localSnapshot, remoteSnapshot, now = Date.now() }) {
    const normalizedLocalSnapshot = normalizeSyncSnapshot(localSnapshot, now);
    const normalizedRemoteSnapshot = normalizeSyncSnapshot(remoteSnapshot, now);
    const mergedDeletionTombstones = mergeDeletionTombstones(
        normalizedLocalSnapshot.deletedCollections,
        normalizedRemoteSnapshot.deletedCollections
    );
    const mergedFolderDeletionTombstones = mergeDeletionTombstones(
        normalizedLocalSnapshot.deletedFolders,
        normalizedRemoteSnapshot.deletedFolders
    );
    const mergedFolders = applyDeletionTombstones(
        mergeEntityCollections(
            {
                localEntities: normalizedLocalSnapshot.foldersArray,
                remoteEntities: normalizedRemoteSnapshot.foldersArray,
                localSnapshotTimestamp: normalizedLocalSnapshot.timestamp,
                remoteSnapshotTimestamp: normalizedRemoteSnapshot.timestamp
            }
        ),
        mergedFolderDeletionTombstones
    );
    const deletedFolders = serializeDeletionTombstones(mergedFolderDeletionTombstones, mergedFolders);
    const mergedCollections = normalizeOrphanedCollections(
        applyDeletionTombstones(mergeEntityCollections(
            {
                localEntities: normalizedLocalSnapshot.tabsArray,
                remoteEntities: normalizedRemoteSnapshot.tabsArray,
                localSnapshotTimestamp: normalizedLocalSnapshot.timestamp,
                remoteSnapshotTimestamp: normalizedRemoteSnapshot.timestamp
            }
        ), mergedDeletionTombstones),
        mergedFolders
    );
    const deletedCollections = serializeDeletionTombstones(mergedDeletionTombstones, mergedCollections);

    return {
        timestamp: Math.max(normalizedLocalSnapshot.timestamp, normalizedRemoteSnapshot.timestamp),
        tabsArray: sortByOrderAndUid(mergedCollections),
        deletedCollections,
        deletedFolders,
        foldersArray: mergedFolders,
        syncVersion: normalizedRemoteSnapshot.syncVersion,
        storageVersion: normalizedRemoteSnapshot.storageVersion,
        extensionVersion: normalizedRemoteSnapshot.extensionVersion,
        isIncrementalSync: false
    };
}

const syncMergeApi = {
    normalizeSyncSnapshot,
    mergeSyncSnapshots
};

/* istanbul ignore next */
if (typeof globalThis !== 'undefined') {
    globalThis.TaboxSyncMerge = syncMergeApi;
}

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncMergeApi;
}
})();
