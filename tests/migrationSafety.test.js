jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } } },
}));

import { browser } from '../static/globals';
import { withDataSafetyGuard } from '../app/utils/migrationSafety';

let store;
beforeEach(() => {
    jest.clearAllMocks();
    store = {
        collections_index: { a: { name: 'A' }, b: { name: 'B' } },
        collection_a: { uid: 'a', name: 'A', tabs: [{ url: 'x' }, { url: 'y' }] },
        collection_b: { uid: 'b', name: 'B', tabs: [{ url: 'z' }] },
        folders_index: { f1: { name: 'F1' } },
        folder_f1: { uid: 'f1', name: 'F1' },
        tabox_storage_version: 3,
    };
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

test('commits and returns fn result when invariant holds', async () => {
    const result = await withDataSafetyGuard('test', async () => {
        store.collection_c = { uid: 'c', name: 'C', tabs: [{ url: 'q' }] };
        store.collections_index = { ...store.collections_index, c: { name: 'C' } };
        return { success: true, migrated: true };
    });
    expect(result.success).toBe(true);
    expect(store.collection_c).toBeDefined();
});

test('restores snapshot and reports failure when a collection is dropped', async () => {
    const result = await withDataSafetyGuard('test', async () => {
        delete store.collection_b;
        store.collections_index = { a: { name: 'A' } };
        return { success: true, migrated: true };
    });
    expect(result.success).toBe(false);
    expect(result.restored).toBe(true);
    expect(store.collection_b).toEqual({ uid: 'b', name: 'B', tabs: [{ url: 'z' }] });
    expect(store.collections_index).toEqual({ a: { name: 'A' }, b: { name: 'B' } });
});

test('restores snapshot and removes keys created during a failed run', async () => {
    await withDataSafetyGuard('test', async () => {
        store.collection_ghost = { uid: 'ghost', tabs: [] };
        delete store.collection_a; // triggers violation
        store.collections_index = { b: { name: 'B' } };
        return { success: true };
    });
    expect(store.collection_ghost).toBeUndefined();
    expect(store.collection_a).toBeDefined();
});

test('restores snapshot when fn throws, and returns failure (does not rethrow)', async () => {
    const result = await withDataSafetyGuard('test', async () => {
        delete store.collection_a;
        throw new Error('boom');
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('boom');
    expect(store.collection_a).toBeDefined();
});

test('shrinking tabs of an existing collection triggers restore', async () => {
    const result = await withDataSafetyGuard('test', async () => {
        store.collection_a = { uid: 'a', name: 'A', tabs: [] };
        return { success: true };
    });
    expect(result.success).toBe(false);
    expect(store.collection_a.tabs).toHaveLength(2);
});

test('removes an index key that was ABSENT before but created by a failed run', async () => {
    store = { collection_a: { uid: 'a', name: 'A', tabs: [{ url: '1' }] } }; // no collections_index
    const result = await withDataSafetyGuard('test', async () => {
        store.collections_index = { a: { name: 'A' } };
        delete store.collection_a; // violation → restore
        return { success: true };
    });
    expect(result.success).toBe(false);
    expect(store.collection_a).toBeDefined();
    expect(store.collections_index).toBeUndefined(); // was absent before → removed on restore
});

test('restores a tombstone mutation made during a failed run', async () => {
    store = {
        collection_a: { uid: 'a', name: 'A', tabs: [{ url: '1' }] },
        deleted_collection_tombstones: { x: 111 },
    };
    await withDataSafetyGuard('test', async () => {
        store.deleted_collection_tombstones = {}; // mutate tombstones
        delete store.collection_a; // violation → restore
        return { success: true };
    });
    expect(store.deleted_collection_tombstones).toEqual({ x: 111 });
});

test('restores when a LIVE folder is dropped from the index', async () => {
    store = {
        collections_index: { a: { name: 'A' } },
        collection_a: { uid: 'a', name: 'A', tabs: [{ url: 'x' }] },
        folders_index: { f1: { name: 'F1' }, f2: { name: 'F2' } },
        folder_f1: { uid: 'f1' },
        folder_f2: { uid: 'f2' },
    };
    const result = await withDataSafetyGuard('test', async () => {
        store.folders_index = { f1: { name: 'F1' } }; // dropped f2 from index (record lingers)
        return { success: true };
    });
    expect(result.success).toBe(false);
    expect(result.restored).toBe(true);
    expect(store.folders_index).toEqual({ f1: { name: 'F1' }, f2: { name: 'F2' } });
});

test('does NOT restore when a tombstoned folder is removed from the index', async () => {
    store = {
        collections_index: { a: { name: 'A' } },
        collection_a: { uid: 'a', name: 'A', tabs: [{ url: 'x' }] },
        folders_index: { f1: { name: 'F1' }, f2: { name: 'F2' } },
        folder_f1: { uid: 'f1' },
        folder_f2: { uid: 'f2' },
    };
    const result = await withDataSafetyGuard('test', async () => {
        store.folders_index = { f1: { name: 'F1' } };
        store.deleted_folder_tombstones = { f2: 123 }; // user legitimately deleted f2
        return { success: true, migrated: true };
    });
    expect(result.success).toBe(true); // legitimate deletion, not flagged as loss
    expect(store.folders_index).toEqual({ f1: { name: 'F1' } });
});
