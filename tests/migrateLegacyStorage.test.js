jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } } },
}));
jest.mock('../app/utils/migrationSupport40', () => ({
    assessMigrationSupport40: () => ({ supported: true, currentVersion: '4.0', migrationNeeded: false, migrationPath: [] }),
}));

import { browser } from '../static/globals';
import { migrateLegacyStorage } from '../app/utils/storageUtils';

let store;
const makeStore = (overrides = {}) => ({
    tabox_storage_version: 3,
    collections_index: {},
    folders_index: {},
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    store = makeStore();
    browser.storage.local.get.mockImplementation(async (keys) => {
        if (keys === null || keys === undefined) return { ...store };
        if (Array.isArray(keys)) return keys.reduce((r, k) => (k in store ? (r[k] = store[k], r) : r), {});
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
        return {};
    });
    browser.storage.local.set.mockImplementation(async (items) => { Object.assign(store, items); });
    browser.storage.local.remove.mockImplementation(async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
    });
});

describe('migrateLegacyStorage — does not rebuild from stale tabsArray', () => {
    test('net-deleted collections are NOT resurrected from tabsArray', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 1, parentId: null, order: 0, lastUpdated: 200, lastOpened: null } },
            collection_a: { uid: 'a', name: 'A', tabs: [{ url: 'live' }], lastUpdated: 200, lastOpened: null, order: 0 },
            deleted_collection_tombstones: { b: 150, c: 150 },
            tabsArray: [
                { uid: 'a', name: 'A (old)', tabs: [{ url: 'old' }] },
                { uid: 'b', name: 'B', tabs: [{ url: 'b1' }] },
                { uid: 'c', name: 'C', tabs: [{ url: 'c1' }] },
            ],
        });
        await migrateLegacyStorage();
        expect(store.collections_index.b).toBeUndefined();
        expect(store.collections_index.c).toBeUndefined();
        expect(store.collection_b).toBeUndefined();
        expect(store.collection_c).toBeUndefined();
    });

    test('existing collection is NOT reverted to the stale tabsArray version', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 3, parentId: null, order: 0, lastUpdated: 500, lastOpened: null } },
            collection_a: { uid: 'a', name: 'A current', tabs: [{ url: '1' }, { url: '2' }, { url: '3' }], lastUpdated: 500, lastOpened: null, order: 0 },
            tabsArray: [{ uid: 'a', name: 'A old', tabs: [{ url: 'old' }] }],
        });
        await migrateLegacyStorage();
        expect(store.collection_a.name).toBe('A current');
        expect(store.collection_a.tabs).toHaveLength(3);
    });
});

describe('migrateLegacyStorage — additive merge', () => {
    test('first-time migration (empty index) imports all collections from tabsArray', async () => {
        store = makeStore({
            collections_index: {},
            tabsArray: [
                { uid: 'a', name: 'A', tabs: [{ url: '1' }] },
                { uid: 'b', name: 'B', tabs: [{ url: '2' }] },
            ],
        });
        const result = await migrateLegacyStorage();
        expect(result.success).toBe(true);
        expect(Object.keys(store.collections_index).sort()).toEqual(['a', 'b']);
        expect(store.collection_a.tabs).toHaveLength(1);
        expect(store.collection_b.tabs).toHaveLength(1);
    });

    test('adds a non-tombstoned collection that exists only in tabsArray', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 1, parentId: null, order: 0, lastUpdated: 200, lastOpened: null } },
            collection_a: { uid: 'a', name: 'A', tabs: [{ url: 'x' }], lastUpdated: 200, lastOpened: null, order: 0 },
            tabsArray: [
                { uid: 'a', name: 'A old', tabs: [{ url: 'old' }] },
                { uid: 'z', name: 'Z recovered', tabs: [{ url: 'zz' }] },
            ],
        });
        await migrateLegacyStorage();
        expect(store.collections_index.z).toBeDefined();
        expect(store.collection_z.tabs).toHaveLength(1);
        expect(store.collection_a.tabs).toEqual([{ url: 'x' }]);
    });

    test('repairs missing metadata IN PLACE without reverting content', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 2, parentId: null } },
            collection_a: { uid: 'a', name: 'A current', tabs: [{ url: '1' }, { url: '2' }], createdOn: 1000 },
            tabsArray: [{ uid: 'a', name: 'A OLD', tabs: [{ url: 'stale' }] }],
        });
        await migrateLegacyStorage();
        expect(store.collection_a.name).toBe('A current');
        expect(store.collection_a.tabs).toHaveLength(2);
        expect(store.collection_a.order).toBeDefined();
        expect(store.collection_a.lastUpdated).toBeDefined();
        expect(store.collection_a.lastOpened).toBeDefined();
        expect(store.collections_index.a.order).toBeDefined();
    });
});

describe('migrateLegacyStorage — guarded happy path', () => {
    test('all live collections survive the guarded migration unchanged', async () => {
        store = makeStore({
            collections_index: {
                a: { name: 'A', type: 'collection', tabCount: 1, parentId: null, order: 0, lastUpdated: 1, lastOpened: null },
                b: { name: 'B', type: 'collection', tabCount: 1, parentId: null, order: 1, lastUpdated: 1, lastOpened: null },
            },
            collection_a: { uid: 'a', name: 'A', tabs: [{ url: '1' }], order: 0, lastUpdated: 1, lastOpened: null },
            collection_b: { uid: 'b', name: 'B', tabs: [{ url: '2' }], order: 1, lastUpdated: 1, lastOpened: null },
        });

        const result = await migrateLegacyStorage();

        expect(result.success).toBe(true);
        expect(store.collection_a).toBeDefined();
        expect(store.collection_b).toBeDefined();
        expect(Object.keys(store.collections_index).sort()).toEqual(['a', 'b']);
    });
});

describe('migrateLegacyStorage — folders', () => {
    test('preserves a healthy folder and its index entry', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 1, parentId: 'fa', order: 0, lastUpdated: 1, lastOpened: null } },
            collection_a: { uid: 'a', name: 'A', tabs: [{ url: '1' }], parentId: 'fa', order: 0, lastUpdated: 1, lastOpened: null },
            folders_index: { fa: { name: 'FA', type: 'folder', color: 'c', order: 0, lastUpdated: 1, createdOn: 1 } },
            folder_fa: { uid: 'fa', name: 'FA', type: 'folder', color: 'c', order: 0, lastUpdated: 1, createdOn: 1 },
        });
        const result = await migrateLegacyStorage();
        expect(result.success).toBe(true);
        expect(store.folders_index.fa).toBeDefined();
        expect(store.folder_fa).toBeDefined();
    });

    test('does not resurrect a tombstoned folder', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 1, parentId: null, order: 0, lastUpdated: 1, lastOpened: null } },
            // Missing `order` on the record forces the migration past its fast-path
            // into the full repair pass, where tombstoned folders are dropped from
            // the index — the path that exercises the guard's tombstone-aware logic.
            collection_a: { uid: 'a', name: 'A', tabs: [{ url: '1' }], lastUpdated: 1, lastOpened: null },
            folders_index: { fdel: { name: 'Old', type: 'folder', order: 0, lastUpdated: 1, createdOn: 1 } },
            folder_fdel: { uid: 'fdel', name: 'Old', type: 'folder', order: 0, lastUpdated: 1, createdOn: 1 },
            deleted_folder_tombstones: { fdel: 100 },
        });
        const result = await migrateLegacyStorage();
        expect(result.success).toBe(true);
        expect(store.folders_index.fdel).toBeUndefined(); // tombstoned → excluded from index, guard does not flag
    });
});
