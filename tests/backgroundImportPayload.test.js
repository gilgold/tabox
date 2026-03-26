const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background import payloads', () => {
    let browser;
    let uidCounter;

    beforeEach(() => {
        jest.resetModules();

        uidCounter = 0;
        browser = createBrowserHarness();

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.loadAllCollectionsBG = jest.fn(async () => []);
        global.loadAllFoldersBG = jest.fn(async () => []);
        global.loadSingleCollectionBG = jest.fn(async (uid) => ({ uid }));
        global.saveSingleCollectionBG = jest.fn(async () => true);
        global.saveSingleFolderBG = jest.fn(async () => true);
        global.forceLegacyStorageSync = jest.fn(async () => {});
        global.generateUid = jest.fn(() => `generated-uid-${++uidCounter}`);
        global.applyUid = jest.fn((value) => value);
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.loadAllCollectionsBG;
        delete global.loadAllFoldersBG;
        delete global.loadSingleCollectionBG;
        delete global.saveSingleCollectionBG;
        delete global.saveSingleFolderBG;
        delete global.forceLegacyStorageSync;
        delete global.generateUid;
        delete global.applyUid;
    });

    test('returns every imported collection descriptor for legacy array imports and preserves firstCollectionUid', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({
            type: 'importData',
            data: [
                { name: 'Collection One', tabs: [] },
                { name: 'Collection Two', tabs: [] },
            ],
        });

        expect(result).toEqual(expect.objectContaining({
            success: true,
            collectionsImported: 2,
            firstCollectionUid: 'generated-uid-1',
            importedCollections: [
                { uid: 'generated-uid-1', parentId: null },
                { uid: 'generated-uid-2', parentId: null },
            ],
        }));
    });

    test('includes folder parent ids in imported collection descriptors', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({
            type: 'importData',
            data: {
                type: 'folder',
                folder: {
                    uid: 'original-folder',
                    name: 'Imported Folder',
                },
                collections: [
                    {
                        name: 'Nested Collection',
                        tabs: [],
                    },
                ],
            },
        });

        expect(result).toEqual(expect.objectContaining({
            success: true,
            foldersImported: 1,
            collectionsImported: 1,
            firstCollectionUid: 'generated-uid-2',
            importedCollections: [
                { uid: 'generated-uid-2', parentId: 'generated-uid-1' },
            ],
        }));
    });

});
