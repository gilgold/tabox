const { createBrowserHarness } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot, createVersion40RemoteDocument } = require('./helpers/upgradeFixtures');

describe('4.0 upgrade compatibility - remote sync document', () => {
    let browser;
    let backgroundUtils;

    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        backgroundUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
    });

    test('preserves local folders when a 4.0 remote document omits foldersArray', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();

        const result = await backgroundUtils.migrateIncomingSyncData(
            createVersion40RemoteDocument({
                omitFoldersArray: true,
                renameRootCollection: true
            })
        );
        const folders = await backgroundUtils.loadAllFoldersBG();
        const collections = await backgroundUtils.loadAllCollectionsBG(true);

        expect(result).not.toBe(false);
        expect(folders.map((folder) => folder.uid)).toEqual(['folder-alpha', 'folder-empty']);
        expect(collections.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                name: 'Root Alpha (Remote)'
            })
        );
        expect(collections.find((collection) => collection.uid === 'collection-folder-a')).toEqual(
            expect.objectContaining({
                parentId: 'folder-alpha'
            })
        );
    });

    test('removes local collections and folders that are absent from a full 4.0 remote snapshot', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();

        const result = await backgroundUtils.migrateIncomingSyncData(
            createVersion40RemoteDocument({
                includeCollectionUids: ['collection-root-a', 'collection-folder-a'],
                includeFolderUids: ['folder-alpha']
            })
        );
        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        const folders = await backgroundUtils.loadAllFoldersBG();

        expect(result).not.toBe(false);
        expect(collections.map((collection) => collection.uid).sort()).toEqual([
            'collection-folder-a',
            'collection-root-a'
        ]);
        expect(folders.map((folder) => folder.uid)).toEqual(['folder-alpha']);
        expect(browser.storage.local._data['collection_collection-folder-b']).toBeUndefined();
        expect(browser.storage.local._data['folder_folder-empty']).toBeUndefined();
    });

    test('backfills missing order and timestamps from a 4.0 remote snapshot', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();

        await backgroundUtils.migrateIncomingSyncData(
            createVersion40RemoteDocument({
                missingOptionalFields: true
            })
        );

        const collections = await backgroundUtils.loadAllCollectionsBG(true);
        const folders = await backgroundUtils.loadAllFoldersBG();

        expect(collections.find((collection) => collection.uid === 'collection-root-a')).toEqual(
            expect.objectContaining({
                lastUpdated: expect.any(Number),
                order: 0
            })
        );
        expect(folders.find((folder) => folder.uid === 'folder-alpha')).toEqual(
            expect.objectContaining({
                lastUpdated: expect.any(Number),
                order: 0
            })
        );
    });

    test('writes a stable full snapshot after importing 4.0 remote data', async () => {
        browser.storage.local._data = createVersion40LocalSnapshot();

        await backgroundUtils.migrateIncomingSyncData(createVersion40RemoteDocument());
        const prepared = await backgroundUtils.prepareSyncDataForUpload();

        expect(prepared).toEqual(
            expect.objectContaining({
                syncVersion: '4.0',
                storageVersion: 3,
                isIncrementalSync: false
            })
        );
        expect(prepared.tabsArray.map((collection) => collection.uid).sort()).toEqual([
            'collection-folder-a',
            'collection-folder-b',
            'collection-root-a'
        ]);
        expect(prepared.foldersArray.map((folder) => folder.uid)).toEqual(['folder-alpha', 'folder-empty']);
    });
});
