jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } } },
}));

import { browser } from '../static/globals';
import { detectRecoverableCollections, recoverOrphanedCollections } from '../app/utils/orphanRecovery';

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
    browser.storage.local.remove.mockImplementation(async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
    });
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

describe('recoverOrphanedCollections', () => {
    test('additively re-links orphans into the index without touching existing collections', async () => {
        store = makeStore({
            collections_index: { live: { name: 'Live', type: 'collection', tabCount: 1, order: 0 } },
            collection_live: { uid: 'live', name: 'Live', tabs: [{ url: 'x' }], order: 0, lastUpdated: 5, lastOpened: null },
            collection_old: { uid: 'old', name: 'Old', tabs: [{ url: 'a' }], createdOn: 100, order: 3, lastUpdated: 100, lastOpened: null },
        });

        const result = await recoverOrphanedCollections(['old']);

        expect(result).toMatchObject({ success: true, recovered: 1, uids: ['old'] });
        expect(store.collections_index.live).toBeDefined();            // untouched
        expect(store.collections_index.old).toMatchObject({ name: 'Old', tabCount: 1, order: 3, parentId: null });
        expect(store.collection_old.tabs).toHaveLength(1);             // record unchanged
    });

    test('is idempotent, skips tombstoned uids, and reroots collections whose folder is gone', async () => {
        store = makeStore({
            collections_index: { live: { name: 'Live', type: 'collection' } },
            collection_live: { uid: 'live', name: 'Live', tabs: [] },
            collection_orphan: { uid: 'orphan', name: 'Orphan', tabs: [], createdOn: 1, parentId: 'missing-folder' },
            collection_tomb: { uid: 'tomb', name: 'Tomb', tabs: [], createdOn: 1 },
            deleted_collection_tombstones: { tomb: 123 },
            folders_index: {},
        });

        const result = await recoverOrphanedCollections(['orphan', 'tomb', 'live']);

        expect(result.recovered).toBe(1);                              // only 'orphan'
        expect(store.collections_index.orphan.parentId).toBeNull();    // dead parent -> root
        expect(store.collections_index.tomb).toBeUndefined();          // tombstoned, not resurrected
    });

    test('patches missing metadata on the record and writes it back', async () => {
        store = makeStore({
            collection_bare: { uid: 'bare', name: 'Bare', tabs: [{ url: 'a' }], createdOn: 7 }, // no order/lastUpdated/lastOpened
        });

        const result = await recoverOrphanedCollections(['bare']);

        expect(result.recovered).toBe(1);
        expect(store.collection_bare).toMatchObject({ order: expect.any(Number), lastUpdated: 7, lastOpened: null });
        expect(store.collections_index.bare).toMatchObject({ lastUpdated: 7, lastOpened: null });
    });

    test('rolls back via the data-safety guard if the write throws', async () => {
        store = makeStore({
            collections_index: { live: { name: 'Live', type: 'collection' } },
            collection_live: { uid: 'live', name: 'Live', tabs: [] },
            collection_old: { uid: 'old', name: 'Old', tabs: [], createdOn: 1 },
        });
        const indexBefore = { ...store.collections_index };

        // Make the index-writing set call throw once.
        const realSet = browser.storage.local.set.getMockImplementation();
        browser.storage.local.set.mockImplementationOnce(async (items) => {
            if (items.collections_index) throw new Error('disk full');
            return realSet(items);
        });

        const result = await recoverOrphanedCollections(['old']);

        expect(result.success).toBe(false);
        expect(store.collections_index).toEqual(indexBefore);          // unchanged after rollback
    });
});
