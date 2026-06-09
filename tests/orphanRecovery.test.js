jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } } },
}));

import { browser } from '../static/globals';
import { detectRecoverableCollections } from '../app/utils/orphanRecovery';

let store;
const makeStore = (overrides = {}) => ({
    tabox_storage_version: 3,
    collections_index: {},
    folders_index: {},
    deleted_collection_tombstones: {},
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
});

describe('detectRecoverableCollections', () => {
    test('returns records present in storage but missing from the index, sorted newest-first', async () => {
        store = makeStore({
            collections_index: { live: { name: 'Live', type: 'collection', tabCount: 1 } },
            collection_live: { uid: 'live', name: 'Live', tabs: [{ url: 'x' }] },
            collection_old: { uid: 'old', name: 'Old', tabs: [{ url: 'a' }, { url: 'b' }], createdOn: 100, parentId: null },
            collection_new: { uid: 'new', name: 'New', tabs: [], createdOn: 200, parentId: 'f1' },
        });

        const orphans = await detectRecoverableCollections();

        expect(orphans.map((o) => o.uid)).toEqual(['new', 'old']); // 'live' excluded, sorted desc by createdOn
        expect(orphans[1]).toMatchObject({ uid: 'old', name: 'Old', tabCount: 2, createdOn: 100, parentId: null });
    });

    test('excludes tombstoned uids and malformed records', async () => {
        store = makeStore({
            deleted_collection_tombstones: { deleted: 999 },
            collection_deleted: { uid: 'deleted', name: 'Gone', tabs: [{ url: 'x' }] },
            collection_junk: { uid: 'junk', name: 'Junk' }, // no tabs array
        });

        const orphans = await detectRecoverableCollections();

        expect(orphans).toEqual([]);
    });

    test('handles storage with no collections_index key at all', async () => {
        store = {
            tabox_storage_version: 3,
            collection_lonely: { uid: 'lonely', name: 'Lonely', tabs: [{ url: 'x' }], createdOn: 50 },
        };

        const orphans = await detectRecoverableCollections();

        expect(orphans.map((o) => o.uid)).toEqual(['lonely']);
    });
});
