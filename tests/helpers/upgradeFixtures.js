const COLLECTIONS_INDEX = 'collections_index';
const FOLDERS_INDEX = 'folders_index';
const COLLECTION_PREFIX = 'collection_';
const FOLDER_PREFIX = 'folder_';
const STORAGE_VERSION = 'tabox_storage_version';

const makeTab = (url, title, overrides = {}) => ({
    uid: overrides.uid || `${title.toLowerCase().replace(/\s+/g, '-')}-uid`,
    url,
    title,
    pinned: false,
    muted: false,
    active: false,
    ...overrides
});

const makeCollection = (overrides = {}) => {
    const {
        uid,
        name,
        tabs = [],
        parentId = null,
        color = 'default',
        createdOn = 1000,
        lastUpdated = 2000,
        lastOpened = 1500,
        order = 0,
        chromeGroups = []
    } = overrides;

    return {
        uid,
        name,
        tabs,
        chromeGroups,
        color,
        createdOn,
        lastUpdated,
        lastOpened,
        parentId,
        order,
        type: 'collection'
    };
};

const makeFolder = (overrides = {}) => {
    const {
        uid,
        name,
        color = 'blue',
        collapsed = false,
        createdOn = 900,
        lastUpdated = 2100,
        order = 0
    } = overrides;

    return {
        uid,
        name,
        type: 'folder',
        color,
        collapsed,
        createdOn,
        lastUpdated,
        order
    };
};

const baseCollections = () => ([
    makeCollection({
        uid: 'collection-root-a',
        name: 'Root Alpha',
        tabs: [
            makeTab('https://alpha.example.com', 'Alpha Home'),
            makeTab('https://alpha.example.com/docs', 'Alpha Docs')
        ],
        order: 0,
        parentId: null,
        createdOn: 1000,
        lastUpdated: 5000,
        lastOpened: 5200
    }),
    makeCollection({
        uid: 'collection-folder-a',
        name: 'Foldered One',
        tabs: [
            makeTab('https://folder.example.com', 'Folder Home'),
            makeTab('https://folder.example.com/team', 'Folder Team')
        ],
        order: 0,
        parentId: 'folder-alpha',
        color: 'green',
        createdOn: 1100,
        lastUpdated: 5100,
        lastOpened: 5300
    }),
    makeCollection({
        uid: 'collection-folder-b',
        name: 'Foldered Two',
        tabs: [
            makeTab('https://beta.example.com', 'Beta Home'),
            makeTab('https://beta.example.com/notes', 'Beta Notes')
        ],
        order: 1,
        parentId: 'folder-alpha',
        color: 'orange',
        createdOn: 1200,
        lastUpdated: 5200,
        lastOpened: 5400
    })
]);

const baseFolders = () => ([
    makeFolder({
        uid: 'folder-alpha',
        name: 'Folder Alpha',
        color: 'purple',
        order: 0,
        createdOn: 900,
        lastUpdated: 4800
    }),
    makeFolder({
        uid: 'folder-empty',
        name: 'Empty Folder',
        color: 'gray',
        order: 1,
        createdOn: 950,
        lastUpdated: 4900
    })
]);

const createCollectionsIndex = (collections) => collections.reduce((index, collection) => {
    index[collection.uid] = {
        name: collection.name,
        type: 'collection',
        tabCount: collection.tabs.length,
        lastUpdated: collection.lastUpdated,
        lastOpened: collection.lastOpened,
        createdOn: collection.createdOn,
        color: collection.color,
        size: JSON.stringify(collection).length,
        parentId: collection.parentId || null,
        order: collection.order
    };
    return index;
}, {});

const createFoldersIndex = (folders, collections) => folders.reduce((index, folder) => {
    index[folder.uid] = {
        name: folder.name,
        type: 'folder',
        color: folder.color,
        collapsed: folder.collapsed,
        collectionCount: collections.filter((collection) => collection.parentId === folder.uid).length,
        lastUpdated: folder.lastUpdated,
        createdOn: folder.createdOn,
        size: JSON.stringify(folder).length,
        order: folder.order
    };
    return index;
}, {});

const createVersion40LocalSnapshot = (options = {}) => {
    const {
        includeTabsArray = true,
        incompleteIndexedCollections = false,
        orphanRootCollection = false,
        missingOptionalFields = false
    } = options;

    const collections = baseCollections();
    const folders = baseFolders();

    if (orphanRootCollection) {
        collections[0].parentId = 'folder-missing';
    }

    if (missingOptionalFields) {
        delete collections[1].lastOpened;
        delete collections[2].lastUpdated;
        delete collections[2].order;
        delete folders[1].lastUpdated;
    }

    const snapshot = {
        [STORAGE_VERSION]: 3,
        localTimestamp: 5500,
        [COLLECTIONS_INDEX]: createCollectionsIndex(collections),
        [FOLDERS_INDEX]: createFoldersIndex(folders, collections)
    };

    collections.forEach((collection, index) => {
        snapshot[`${COLLECTION_PREFIX}${collection.uid}`] = incompleteIndexedCollections && index === 2
            ? { uid: collection.uid, name: collection.name, parentId: collection.parentId }
            : JSON.parse(JSON.stringify(collection));
    });

    folders.forEach((folder) => {
        snapshot[`${FOLDER_PREFIX}${folder.uid}`] = JSON.parse(JSON.stringify(folder));
    });

    if (includeTabsArray) {
        snapshot.tabsArray = JSON.parse(JSON.stringify(collections));
    }

    return snapshot;
};

const createVersion40RemoteDocument = (options = {}) => {
    const {
        omitFoldersArray = false,
        missingOptionalFields = false,
        includeCollectionUids = null,
        includeFolderUids = null,
        renameRootCollection = false
    } = options;

    let collections = baseCollections();
    let folders = baseFolders();

    if (includeCollectionUids) {
        collections = collections.filter((collection) => includeCollectionUids.includes(collection.uid));
    }

    if (includeFolderUids) {
        folders = folders.filter((folder) => includeFolderUids.includes(folder.uid));
        collections = collections.map((collection) => {
            if (collection.parentId && !includeFolderUids.includes(collection.parentId)) {
                return { ...collection, parentId: null };
            }
            return collection;
        });
    }

    if (renameRootCollection) {
        collections = collections.map((collection) => (
            collection.uid === 'collection-root-a'
                ? { ...collection, name: 'Root Alpha (Remote)' }
                : collection
        ));
    }

    if (missingOptionalFields) {
        collections = collections.map((collection, index) => {
            if (index === 0) {
                const updated = { ...collection };
                delete updated.lastUpdated;
                delete updated.order;
                return updated;
            }

            if (index === 1) {
                const updated = { ...collection };
                delete updated.lastOpened;
                return updated;
            }

            return collection;
        });

        folders = folders.map((folder, index) => {
            if (index === 0) {
                const updated = { ...folder };
                delete updated.lastUpdated;
                delete updated.order;
                return updated;
            }

            return folder;
        });
    }

    const document = {
        timestamp: 9000,
        tabsArray: JSON.parse(JSON.stringify(collections)),
        syncVersion: '4.0',
        storageVersion: 3,
        extensionVersion: '4.0.0',
        isIncrementalSync: false
    };

    if (!omitFoldersArray) {
        document.foldersArray = JSON.parse(JSON.stringify(folders));
    }

    return document;
};

const summarizeCollections = (collections) => collections.map((collection) => ({
    uid: collection.uid,
    name: collection.name,
    parentId: collection.parentId || null,
    order: collection.order,
    tabCount: collection.tabs?.length || 0
}));

module.exports = {
    COLLECTIONS_INDEX,
    FOLDERS_INDEX,
    COLLECTION_PREFIX,
    FOLDER_PREFIX,
    createVersion40LocalSnapshot,
    createVersion40RemoteDocument,
    summarizeCollections
};
