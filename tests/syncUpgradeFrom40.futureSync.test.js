const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot } = require('./helpers/upgradeFixtures');

const withBrowser = async (browser, callback) => {
    const previousBrowser = global.browser;
    const previousChrome = global.chrome;
    global.browser = browser;
    global.chrome = { runtime: browser.runtime };

    try {
        return await callback();
    } finally {
        global.browser = previousBrowser;
        global.chrome = previousChrome;
    }
};

describe('4.0 upgrade compatibility - future sync operations', () => {
    let backgroundUtils;

    beforeEach(() => {
        jest.resetModules();
        backgroundUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
    });

    test('post-upgrade tab edits sync across devices without losing collection structure', async () => {
        const deviceA = createBrowserHarness({ localData: createVersion40LocalSnapshot() });
        const deviceB = createBrowserHarness({ localData: createVersion40LocalSnapshot() });

        const remoteDoc = await withBrowser(deviceA, async () => {
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');
            collection.tabs = [
                collection.tabs[1],
                collection.tabs[0],
                {
                    uid: 'alpha-new-tab',
                    url: 'https://alpha.example.com/new',
                    title: 'Alpha New',
                    pinned: true,
                    muted: false,
                    active: false
                }
            ];
            collection.lastUpdated = 9100;
            await backgroundUtils.saveSingleCollectionBG(collection, false);
            return backgroundUtils.prepareSyncDataForUpload();
        });

        await withBrowser(deviceB, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDoc));
        });

        await withBrowser(deviceB, async () => {
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');
            expect(collection.tabs.map((tab) => tab.title)).toEqual([
                'Alpha Docs',
                'Alpha Home',
                'Alpha New'
            ]);
            expect(collection.tabs[2]).toEqual(
                expect.objectContaining({
                    pinned: true,
                    url: 'https://alpha.example.com/new'
                })
            );
        });
    });

    test('post-upgrade tab removals sync across devices without resurrecting deleted tabs', async () => {
        const deviceA = createBrowserHarness({ localData: createVersion40LocalSnapshot() });
        const deviceB = createBrowserHarness({ localData: createVersion40LocalSnapshot() });

        const remoteDoc = await withBrowser(deviceA, async () => {
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');
            collection.tabs = [collection.tabs[0]];
            collection.lastUpdated = 9150;
            await backgroundUtils.saveSingleCollectionBG(collection, false);
            return backgroundUtils.prepareSyncDataForUpload();
        });

        await withBrowser(deviceB, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDoc));
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');

            expect(collection.tabs.map((tab) => tab.title)).toEqual(['Alpha Home']);
            expect(collection.tabs).toHaveLength(1);
        });
    });

    test('post-upgrade collection and folder add-remove changes propagate to another device', async () => {
        const deviceA = createBrowserHarness({ localData: createVersion40LocalSnapshot() });
        const deviceB = createBrowserHarness({ localData: createVersion40LocalSnapshot() });

        const remoteDoc = await withBrowser(deviceA, async () => {
            await backgroundUtils.saveSingleFolderBG({
                uid: 'folder-new',
                name: 'Fresh Folder',
                type: 'folder',
                color: 'teal',
                collapsed: false,
                createdOn: 9200,
                lastUpdated: 9200,
                order: 2
            }, false);

            await backgroundUtils.saveSingleCollectionBG({
                uid: 'collection-new',
                name: 'Fresh Collection',
                tabs: [
                    {
                        uid: 'fresh-tab',
                        url: 'https://fresh.example.com',
                        title: 'Fresh'
                    }
                ],
                chromeGroups: [],
                color: 'default',
                createdOn: 9300,
                lastUpdated: 9300,
                lastOpened: null,
                parentId: 'folder-new',
                order: 0
            }, false);

            await backgroundUtils.deleteSingleCollectionBG('collection-folder-b');
            await backgroundUtils.deleteSingleFolderBG('folder-empty');

            return backgroundUtils.prepareSyncDataForUpload();
        });

        await withBrowser(deviceB, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDoc));

            const collections = await backgroundUtils.loadAllCollectionsBG(true);
            const folders = await backgroundUtils.loadAllFoldersBG();

            expect(collections.map((collection) => collection.uid)).toContain('collection-new');
            expect(collections.map((collection) => collection.uid)).not.toContain('collection-folder-b');
            expect(folders.map((folder) => folder.uid)).toContain('folder-new');
            expect(folders.map((folder) => folder.uid)).not.toContain('folder-empty');
        });
    });

    test('post-upgrade collection and folder metadata edits propagate to another device', async () => {
        const deviceA = createBrowserHarness({ localData: createVersion40LocalSnapshot() });
        const deviceB = createBrowserHarness({ localData: createVersion40LocalSnapshot() });

        const remoteDoc = await withBrowser(deviceA, async () => {
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-folder-a');
            collection.name = 'Foldered One Renamed';
            collection.color = 'purple';
            collection.lastUpdated = 9350;
            await backgroundUtils.saveSingleCollectionBG(collection, false);

            const folder = await backgroundUtils.loadSingleFolderBG('folder-alpha');
            folder.name = 'Folder Alpha Renamed';
            folder.color = 'teal';
            folder.lastUpdated = 9351;
            await backgroundUtils.saveSingleFolderBG(folder, false);

            return backgroundUtils.prepareSyncDataForUpload();
        });

        await withBrowser(deviceB, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDoc));

            const collection = await backgroundUtils.loadSingleCollectionBG('collection-folder-a');
            const folder = await backgroundUtils.loadSingleFolderBG('folder-alpha');

            expect(collection).toEqual(expect.objectContaining({
                name: 'Foldered One Renamed',
                color: 'purple'
            }));
            expect(folder).toEqual(expect.objectContaining({
                name: 'Folder Alpha Renamed',
                color: 'teal'
            }));
        });
    });

    test('post-upgrade moves from root into a folder propagate to another device', async () => {
        const deviceA = createBrowserHarness({ localData: createVersion40LocalSnapshot() });
        const deviceB = createBrowserHarness({ localData: createVersion40LocalSnapshot() });

        const remoteDoc = await withBrowser(deviceA, async () => {
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');
            collection.parentId = 'folder-alpha';
            collection.order = 2;
            collection.lastUpdated = 9360;
            await backgroundUtils.saveSingleCollectionBG(collection, false);
            return backgroundUtils.prepareSyncDataForUpload();
        });

        await withBrowser(deviceB, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDoc));
            const collection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');

            expect(collection).toEqual(expect.objectContaining({
                parentId: 'folder-alpha',
                order: 2
            }));
        });
    });

    test('post-upgrade moves and manual order changes survive repeated sync cycles', async () => {
        const deviceA = createBrowserHarness({ localData: createVersion40LocalSnapshot() });
        const deviceB = createBrowserHarness({ localData: createVersion40LocalSnapshot() });

        const firstRemoteDoc = await withBrowser(deviceA, async () => {
            const folderCollection = await backgroundUtils.loadSingleCollectionBG('collection-folder-a');
            folderCollection.parentId = null;
            folderCollection.order = 0;
            folderCollection.lastUpdated = 9400;
            await backgroundUtils.saveSingleCollectionBG(folderCollection, false);

            const rootCollection = await backgroundUtils.loadSingleCollectionBG('collection-root-a');
            rootCollection.order = 1;
            rootCollection.lastUpdated = 9401;
            await backgroundUtils.saveSingleCollectionBG(rootCollection, false);

            const folder = await backgroundUtils.loadSingleFolderBG('folder-alpha');
            folder.order = 1;
            folder.lastUpdated = 9402;
            await backgroundUtils.saveSingleFolderBG(folder, false);

            return backgroundUtils.prepareSyncDataForUpload();
        });

        await withBrowser(deviceB, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(firstRemoteDoc));

            const collections = await backgroundUtils.loadAllCollectionsBG(true);
            expect(collections.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
                expect.objectContaining({
                    parentId: null,
                    order: 0
                })
            );
        });

        const secondRemoteDoc = await withBrowser(deviceB, async () => backgroundUtils.prepareSyncDataForUpload());

        await withBrowser(deviceA, async () => {
            await backgroundUtils.migrateIncomingSyncData(cloneValue(secondRemoteDoc));
            const collections = await backgroundUtils.loadAllCollectionsBG(true);
            const folders = await backgroundUtils.loadAllFoldersBG();

            expect(collections.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
                expect.objectContaining({
                    parentId: null,
                    order: 0
                })
            );
            expect(folders.find((folder) => folder.uid === 'folder-alpha')).toEqual(
                expect.objectContaining({
                    order: 1
                })
            );
        });
    });
});
