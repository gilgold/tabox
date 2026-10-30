const { createBrowserHarness, cloneValue } = require('./helpers/browserHarness');

// 9a46293 TaboxCollection + Drive writer: no lastUpdated, version or folders.
const legacyCollection = (uid = 'remote') => ({
    uid, name: 'Synthetic', createdOn: 100, color: 'blue', window: { id: 7 },
    tabs: [{ id: 12, url: 'https://example.invalid', groupId: 3, index: 0 }],
    chromeGroups: [{ id: 3, title: 'Synthetic group', color: 'blue' }]
});
const legacy = () => ({ timestamp: 1000, tabsArray: [legacyCollection()] });

describe('authentic versionless Drive envelope', () => {
    let browser, api, remote;
    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness({ syncData: { syncFileId: 'synthetic' } });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        api = require('../chrome/background-utils');
        remote = legacy();
        global.fetch = jest.fn(async (_url, options = {}) => {
            if (options.method === 'PATCH') remote = JSON.parse(options.body);
            return { ok: true, headers: { get: () => 'synthetic-etag' }, json: async () => cloneValue(remote) };
        });
    });
    afterEach(() => { delete global.browser; delete global.chrome; delete global.fetch; });

    test('direct migration preserves original identity, groups, members and stable dates', async () => {
        const result = await api.migrateIncomingSyncData(legacy());
        expect(result).not.toBe(false);
        expect(result[0]).toEqual(expect.objectContaining({ ...legacyCollection(), lastUpdated: 100, order: 0 }));
        expect(legacy().timestamp).toBe(1000);
    });

    test('reader and reconciliation accept the historical document without forging remote time or uploading', async () => {
        expect(await api.syncData('synthetic')).toBe(true);
        expect(browser.storage.local._data.localTimestamp).toBe(1000);
        expect(global.fetch.mock.calls.every(([, opts]) => opts.method === 'GET')).toBe(true);
        expect((await api.loadAllCollectionsBG(true))[0]).toEqual(expect.objectContaining(legacyCollection()));
    });

    test('known empty historical array is valid and preserves local folders', async () => {
        browser.storage.local._data = { folders_index: { folder: { uid: 'folder' } }, folder_folder: { uid: 'folder', name: 'Synthetic folder', createdOn: 50, lastUpdated: 60 } };
        expect(await api.migrateIncomingSyncData({ timestamp: 1000, tabsArray: [] })).toEqual([]);
        expect((await api.loadAllFoldersBG()).map(f => f.uid)).toEqual(['folder']);
    });

    test.each([undefined, null, {}, { tabsArray: [] }, { timestamp: 1 }, { timestamp: 1, tabsArray: null },
        { timestamp: 1, tabsArray: {} }, { timestamp: '1', tabsArray: [] }, { timestamp: NaN, tabsArray: [] },
        { timestamp: Infinity, tabsArray: [] }, { timestamp: 1, tabs: [] }, { timestamp: 1, collections: [] },
        { timestamp: 1, tabsArray: [null] }, { timestamp: 1, tabsArray: [{ name: 'Bad', tabs: [] }] },
        { timestamp: 1, tabsArray: [{ uid: 'x', name: 'Bad', tabs: null }] },
        { timestamp: 1, tabsArray: [legacyCollection(), legacyCollection()] },
        { timestamp: 1, tabsArray: [{ ...legacyCollection(), chromeGroups: {} }] },
        { timestamp: 1, tabsArray: [{ ...legacyCollection(), createdOn: 'bad' }] },
        { ...legacy(), foldersArray: [] }, { ...legacy(), syncVersion: null },
        ...['99.0', '4.0garbage', '3.0', {}, 4.1].map(syncVersion => ({ ...legacy(), syncVersion }))
    ])('rejects unknown/malformed input without data writes: %p', async input => {
        const before = cloneValue(browser.storage.local._data);
        expect(await api.migrateIncomingSyncData(input)).toBe(false);
        // Logger metadata is allowed; collection/index/timestamp writes are not.
        const after = cloneValue(browser.storage.local._data);
        delete after.syncLogs;
        expect(after).toEqual(before);
    });

    test('a later legacy envelope save does not promote old entities over known local edits or tombstones', async () => {
        remote.timestamp = 9000; // e.g. another collection was saved on the legacy device
        remote.tabsArray.push(legacyCollection('removed'));
        await api.saveSingleCollectionBG({ ...legacyCollection(), name: 'Known local edit', lastUpdated: 2000 }, false);
        browser.storage.local._data.deleted_collection_tombstones = { removed: 2000 };
        expect(await api.syncData('synthetic')).toBe(true);
        expect(remote.tabsArray.map(c => c.uid)).not.toContain('removed');
        expect(remote.tabsArray.find(c => c.uid === 'remote').name).toBe('Known local edit');
    });

    test('forced legacy reader preserves even UIDs containing the old uid marker', async () => {
        remote.tabsArray = [legacyCollection('saved-uid')];
        const result = await api.updateLocalDataFromServer('synthetic', true);
        expect(result[0].uid).toBe('saved-uid');
        expect(browser.storage.local._data['collection_saved-uid'].uid).toBe('saved-uid');
    });

    test('direct legacy load aborts if local data changes during its awaited backup', async () => {
        await api.saveSingleCollectionBG({ ...legacyCollection(), lastUpdated: 2000 }, false);
        const originalSet = browser.storage.local.set.getMockImplementation();
        browser.storage.local.set.mockImplementation(async items => {
            await originalSet(items);
            if (items.preSyncBackups) browser.storage.local._data.collection_remote.name = 'Concurrent local edit';
        });
        expect(await api.migrateIncomingSyncData(legacy())).toBe(false);
        expect(browser.storage.local._data.collection_remote.name).toBe('Concurrent local edit');
    });

    test('forced reader load also merges legacy sets and preserves newer local records', async () => {
        await api.saveSingleCollectionBG({ ...legacyCollection(), name: 'Newer local', lastUpdated: 2000 }, false);
        await api.saveSingleCollectionBG({ ...legacyCollection('local-only'), lastUpdated: 2000 }, false);
        const result = await api.updateLocalDataFromServer('synthetic', true);
        expect(result.map(c => c.uid).sort()).toEqual(['local-only', 'remote']);
        expect(result.find(c => c.uid === 'remote').name).toBe('Newer local');
        expect(browser.storage.local._data.localTimestamp).toBe(1000);
    });

    test('invalid remote aborts reconciliation before backup, apply or upload', async () => {
        remote = { timestamp: 1000, tabsArray: [null] };
        expect(await api.syncData('synthetic')).toBe(false);
        expect(global.fetch.mock.calls.every(([, opts]) => opts.method === 'GET')).toBe(true);
        expect(browser.storage.local._data.preSyncBackups).toBeUndefined();
        expect(browser.storage.local._data.collections_index).toBeUndefined();
    });

    test('two distinct devices converge with local edits, disjoint sets, folders and tombstones intact', async () => {
        const deviceA = browser;
        await api.saveSingleCollectionBG({ ...legacyCollection('local-a'), lastUpdated: 2000 }, false);
        await api.saveSingleCollectionBG({ ...legacyCollection(), name: 'Local edited', lastUpdated: 2000 }, false);
        deviceA.storage.local._data.deleted_collection_tombstones = { removed: 2000 };
        remote.tabsArray.push(legacyCollection('removed'));
        deviceA.storage.local._data.folders_index = { folder: { uid: 'folder' } };
        deviceA.storage.local._data.folder_folder = { uid: 'folder', name: 'Synthetic folder', createdOn: 50, lastUpdated: 60 };
        expect(await api.syncData('synthetic')).toBe(true);
        expect(remote.tabsArray.map(c => c.uid).sort()).toEqual(['local-a', 'remote']);
        expect(remote.tabsArray.find(c => c.uid === 'remote').name).toBe('Local edited');
        expect(remote.deletedCollections).toEqual([{ uid: 'removed', lastUpdated: 2000 }]);
        expect(deviceA.storage.local._data.preSyncBackups.length).toBeGreaterThan(0);
        const deviceB = createBrowserHarness({ syncData: { syncFileId: 'synthetic' } });
        global.browser = deviceB;
        await api.saveSingleCollectionBG({ ...legacyCollection('local-b'), lastUpdated: 3000 }, false);
        expect(await api.syncData('synthetic')).toBe(true);
        global.browser = deviceA;
        expect(await api.syncData('synthetic')).toBe(true);
        expect((await api.loadAllCollectionsBG(true)).map(c => c.uid).sort()).toEqual(['local-a', 'local-b', 'remote']);
        expect((await api.loadAllFoldersBG()).map(f => f.uid)).toEqual(['folder']);
        expect(remote.deletedCollections).toEqual([{ uid: 'removed', lastUpdated: 2000 }]);
    });
});
