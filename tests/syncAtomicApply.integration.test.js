const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot, createVersion40RemoteDocument } = require('./helpers/upgradeFixtures');

describe('sync atomic apply integration', () => {
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

    test('rolls back local indexed storage when remote apply hits an index write failure', async () => {
        const snapshot = createVersion40LocalSnapshot();
        browser.storage.local._data = cloneValue(snapshot);

        const remoteDocument = createVersion40RemoteDocument({
            includeCollectionUids: ['collection-root-a', 'collection-folder-a'],
            includeFolderUids: ['folder-alpha']
        });

        const originalSet = browser.storage.local.set.bind(browser.storage.local);
        let failedCollectionsDeleteIndexWrite = false;
        browser.storage.local.set = jest.fn(async (items) => {
            const writesAtomicSyncPayload = Object.prototype.hasOwnProperty.call(items, 'collections_index')
                && Object.prototype.hasOwnProperty.call(items, 'collection_collection-root-a');
            if (!failedCollectionsDeleteIndexWrite && writesAtomicSyncPayload) {
                failedCollectionsDeleteIndexWrite = true;
                throw new Error('Index write failed');
            }

            return originalSet(items);
        });

        const result = await backgroundUtils.migrateIncomingSyncData(cloneValue(remoteDocument));

        expect(result).toBe(false);
        expect(browser.storage.local._data).toEqual(expect.objectContaining(snapshot));
        expect(browser.storage.local._data.syncLogs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                message: 'Applying normalized 4.0 sync data'
            })
        ]));
    });
});
