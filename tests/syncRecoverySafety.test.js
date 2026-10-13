const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');
const { createVersion40LocalSnapshot, createVersion40RemoteDocument } = require('./helpers/upgradeFixtures');

describe('offline recovery and sync safety', () => {
    let browser;
    let utils;
    let remote;
    let failUpload;
    let uploads;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.setSystemTime(1000000);
        browser = createBrowserHarness({
            localData: { ...createVersion40LocalSnapshot(), lastSuccessfulSyncTime: 500, localTimestamp: 100000 },
            syncData: { syncFileId: 'remote-file-id' }
        });
        browser.storage.sync._data = { syncFileId: 'remote-file-id' };
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        utils = require('../chrome/background-utils');
        remote = createVersion40RemoteDocument();
        remote.timestamp = 500000;
        uploads = [];
        failUpload = false;
        global.fetch = jest.fn(async (url, init = {}) => {
            if (url.includes('uploadType=media')) {
                if (failUpload) return { ok: false, status: 503, statusText: 'Unavailable' };
                remote = JSON.parse(init.body);
                uploads.push(cloneValue(remote));
                return { ok: true, json: async () => ({ id: 'remote-file-id' }) };
            }
            return { ok: true, json: async () => cloneValue(remote) };
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
        delete global.browser;
        delete global.chrome;
        delete global.fetch;
    });

    const sync = async () => {
        const result = utils.syncData('token');
        await jest.runAllTimersAsync();
        return result;
    };

    test.each([100000, 500000, 900000])('preserves offline edits and disjoint data when local timestamp is %s', async (timestamp) => {
        browser.storage.local._data.localTimestamp = timestamp;
        const edited = browser.storage.local._data['collection_collection-root-a'];
        edited.lastUpdated = 300000;
        edited.tabs.push({ uid: 'offline-tab', url: 'https://example.com/offline', title: 'Offline edit' });
        remote.tabsArray = remote.tabsArray.filter(c => c.uid !== 'collection-folder-b');
        remote.tabsArray.push({ ...cloneValue(remote.tabsArray[0]), uid: 'remote-only', name: 'Remote only' });
        expect(await sync()).toBe(true);
        const local = await utils.loadAllCollectionsBG(true);
        expect(local.map(c => c.uid)).toEqual(expect.arrayContaining(['collection-folder-b', 'remote-only']));
        expect(local.find(c => c.uid === edited.uid).tabs).toEqual(edited.tabs);
        expect(remote.tabsArray.find(c => c.uid === edited.uid).tabs).toEqual(edited.tabs);
        expect(remote.tabsArray.map(c => c.uid)).toContain('collection-folder-b');
    });

    test('forced saves update the record as well as the index so restored contents win', async () => {
        const restored = { ...browser.storage.local._data['collection_collection-root-a'], name: 'Restored locally', lastUpdated: 100 };
        const folder = { ...browser.storage.local._data['folder_folder-alpha'], lastUpdated: 100 };
        await utils.saveSingleCollectionBG(restored, true);
        await utils.saveSingleFolderBG(folder, true);
        expect(browser.storage.local._data[`collection_${restored.uid}`].lastUpdated).toBe(1000000);
        expect(browser.storage.local._data[`folder_${folder.uid}`].lastUpdated).toBe(1000000);
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.find(c => c.uid === restored.uid).name).toBe('Restored locally');
    });

    test('repairs timestamps from pre-fix offline saves before reconciling, then converges', async () => {
        const local = browser.storage.local._data;
        local['collection_collection-root-a'].name = 'Restored on the old build';
        local.collections_index['collection-root-a'].lastUpdated = 1000000;
        local['folder_folder-alpha'].name = 'Offline folder edit';
        local.folders_index['folder-alpha'].lastUpdated = 1000000;
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.find(c => c.uid === 'collection-root-a').name).toBe('Restored on the old build');
        expect(remote.foldersArray.find(f => f.uid === 'folder-alpha').name).toBe('Offline folder edit');
        expect((await utils.loadSingleCollectionBG('collection-root-a')).lastUpdated).toBe(1000000);
        expect((await utils.loadSingleFolderBG('folder-alpha')).lastUpdated).toBe(1000000);
        const count = uploads.length;
        expect(await sync()).toBe(true);
        expect(uploads).toHaveLength(count);
    });

    test('applies deletion of every collection and folder without resurrecting local data', async () => {
        remote.deletedCollections = remote.tabsArray.map(c => ({ uid: c.uid, lastUpdated: 500000 }));
        remote.deletedFolders = remote.foldersArray.map(f => ({ uid: f.uid, lastUpdated: 500000 }));
        remote.tabsArray = [];
        remote.foldersArray = [];
        expect(await sync()).toBe(true);
        expect(await utils.loadAllCollectionsBG(true)).toEqual([]);
        expect(await utils.loadAllFoldersBG()).toEqual([]);
        expect(await sync()).toBe(true);
        expect(remote.tabsArray).toEqual([]);
    });

    test('remote-only changes download once without uploads or repeated backup rotation', async () => {
        remote.tabsArray[0].lastUpdated = 200000;
        remote.tabsArray[0].name = 'Edited elsewhere';
        expect(await sync()).toBe(true);
        const backups = cloneValue(browser.storage.local._data.preSyncBackups);
        expect(backups[0].tabsArray[0].tabs).toBeDefined();
        expect(backups[0].foldersArray).toHaveLength(2);
        expect(uploads).toHaveLength(0);
        jest.setSystemTime(2000000);
        expect(await sync()).toBe(true);
        expect(uploads).toHaveLength(0);
        expect(browser.storage.local._data.preSyncBackups).toEqual(backups);
    });

    test('upload failure retries fresh local edits and converges without repeated uploads', async () => {
        await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-root-a'], name: 'Offline edit' }, true);
        failUpload = true;
        expect(await sync()).toBe(false);
        expect(browser.storage.local._data.lastSuccessfulSyncTime).toBe(500);
        await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-folder-a'], name: 'Edited during retry' }, true);
        failUpload = false;
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.find(c => c.uid === 'collection-root-a').name).toBe('Offline edit');
        expect(remote.tabsArray.find(c => c.uid === 'collection-folder-a').name).toBe('Edited during retry');
        const count = uploads.length;
        expect(await sync()).toBe(true);
        expect(uploads).toHaveLength(count);
    });

    test('aborts before replacing local data when a full recovery snapshot cannot be stored', async () => {
        remote.tabsArray[0].name = 'Remote edit';
        remote.tabsArray[0].lastUpdated = 500000;
        const before = cloneValue(browser.storage.local._data['collection_collection-root-a']);
        const originalSet = browser.storage.local.set;
        browser.storage.local.set = jest.fn(async values => {
            if (values.preSyncBackups) throw new Error('QUOTA_BYTES');
            return originalSet(values);
        });
        expect(await sync()).toBe(false);
        expect(browser.storage.local._data['collection_collection-root-a']).toEqual(before);
        expect(uploads).toHaveLength(0);
    });

    test('backup cleanup retains full tabs and groups instead of converting recovery data to metadata', async () => {
        const large = { timestamp: 1, tabsArray: [{ uid: 'big', tabs: [{ url: 'https://example.com', title: 'x'.repeat(600000) }], chromeGroups: [{ id: 1, title: 'Group' }] }], foldersArray: [] };
        browser.storage.local._data.preSyncBackups = [large];
        await globalThis.cleanupBackups();
        expect(browser.storage.local._data.preSyncBackups[0].tabsArray[0].tabs?.[0].title.length).toBe(600000);
        expect(browser.storage.local._data.preSyncBackups[0].tabsArray[0].chromeGroups).toEqual(large.tabsArray[0].chromeGroups);
    });

    test('does not sync partial indexed storage or turn a read failure into an empty payload', async () => {
        delete browser.storage.local._data['collection_collection-folder-b'];
        const initialRemote = cloneValue(remote);
        expect(await sync()).toBe(false);
        expect(remote).toEqual(initialRemote);
        expect(uploads).toHaveLength(0);
    });

    test('clears old deletion markers when the background explicitly restores an item', async () => {
        browser.storage.local._data.deleted_collection_tombstones = { 'collection-root-a': 900000 };
        browser.storage.local._data.deleted_folder_tombstones = { 'folder-alpha': 900000 };
        remote.deletedCollections = [{ uid: 'collection-root-a', lastUpdated: 900000 }];
        await utils.saveSingleCollectionBG(browser.storage.local._data['collection_collection-root-a'], true);
        await utils.saveSingleFolderBG(browser.storage.local._data['folder_folder-alpha'], true);
        expect(browser.storage.local._data.deleted_collection_tombstones).toEqual({});
        expect(browser.storage.local._data.deleted_folder_tombstones).toEqual({});
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.some(c => c.uid === 'collection-root-a')).toBe(true);
        expect(remote.deletedCollections).toEqual([]);
    });

    test('re-reads a cloud edit made during reconciliation instead of uploading an obsolete merge', async () => {
        await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-root-a'], name: 'Local edit' }, true);
        const fetchImpl = global.fetch;
        let reads = 0;
        global.fetch = jest.fn(async (url, init) => {
            if (url.includes('alt=media') && ++reads === 3) {
                remote.tabsArray.push({ ...cloneValue(remote.tabsArray[0]), uid: 'late-remote' });
            }
            return fetchImpl(url, init);
        });
        expect(await sync()).toBe(false);
        expect(uploads).toHaveLength(0);
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.map(c => c.uid)).toContain('late-remote');
        expect(remote.tabsArray.find(c => c.uid === 'collection-root-a').name).toBe('Local edit');
    });

    test('keeps a local edit made while upload is in flight and does not mark it synced', async () => {
        await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-root-a'], name: 'First edit' }, true);
        const fetchImpl = global.fetch;
        let edited = false;
        global.fetch = jest.fn(async (url, init) => {
            if (url.includes('uploadType=media') && !edited) {
                edited = true;
                jest.setSystemTime(1001000);
                await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-root-a'], name: 'Second edit' }, true);
            }
            return fetchImpl(url, init);
        });
        expect(await sync()).toBe(false);
        expect(browser.storage.local._data.lastSuccessfulSyncTime).toBe(500);
        expect((await utils.loadSingleCollectionBG('collection-root-a')).name).toBe('Second edit');
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.find(c => c.uid === 'collection-root-a').name).toBe('Second edit');
    });

    test('conditional upload conflicts stop the PATCH and retry with a fresh remote snapshot', async () => {
        await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-root-a'], name: 'Local edit' }, true);
        const fetchImpl = global.fetch;
        let conflict = true;
        let attempts = 0;
        const conditionalHeaders = [];
        global.fetch = jest.fn(async (url, init = {}) => {
            if (url.includes('uploadType=media')) {
                attempts++;
                conditionalHeaders.push(init.headers['If-Match']);
                if (conflict) {
                    remote.tabsArray.push({ ...cloneValue(remote.tabsArray[0]), uid: 'conflicting-remote' });
                    return { ok: false, status: 412, statusText: 'Precondition Failed' };
                }
            }
            return { ...await fetchImpl(url, init), headers: { get: () => '"revision-1"' } };
        });
        expect(await sync()).toBe(false);
        expect(attempts).toBe(1);
        conflict = false;
        expect(await sync()).toBe(true);
        expect(remote.tabsArray.map(c => c.uid)).toContain('conflicting-remote');
        expect(conditionalHeaders).toEqual(['"revision-1"', '"revision-1"']);
    });

    test('two previously synced devices converge and then stop uploading identical snapshots', async () => {
        const secondDevice = cloneValue(browser.storage.local._data);
        secondDevice['collection_collection-folder-a'].name = 'Device B edit';
        secondDevice['collection_collection-folder-a'].lastUpdated = 600000;
        await utils.saveSingleCollectionBG({ ...browser.storage.local._data['collection_collection-root-a'], name: 'Device A edit' }, true);
        expect(await sync()).toBe(true);
        let firstDevice = cloneValue(browser.storage.local._data);
        browser.storage.local._data = secondDevice;
        expect(await sync()).toBe(true);
        const secondSynced = cloneValue(browser.storage.local._data);
        browser.storage.local._data = firstDevice;
        expect(await sync()).toBe(true);
        const uploadCount = uploads.length;
        for (const data of [secondSynced, browser.storage.local._data, secondSynced]) {
            browser.storage.local._data = data;
            jest.setSystemTime(Date.now() + 120000);
            expect(await sync()).toBe(true);
        }
        expect(uploads).toHaveLength(uploadCount);
        expect(remote.tabsArray.find(c => c.uid === 'collection-root-a').name).toBe('Device A edit');
        expect(remote.tabsArray.find(c => c.uid === 'collection-folder-a').name).toBe('Device B edit');
    });
});
