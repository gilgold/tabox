# Migration Data-Safety Guarantee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tabox on-update migration incapable of losing or altering user data — the stale legacy `tabsArray` can never overwrite or rebuild newer indexed collections, and any step that would shrink data is rolled back.

**Architecture:** Three layers. (1) `migrateLegacyStorage`'s repair path becomes additive-only: gap-fill missing collections from `tabsArray` (tombstone-aware), repair metadata in place, never overwrite live indexed records. (2) A pure `verifyMigrationInvariant` comparator. (3) A `withDataSafetyGuard` wrapper that snapshots indexed data, runs a migration step, verifies the invariant, and fully restores on any loss or throw. Layers 2–3 wrap both `migrateLegacyStorage` and the coordinator.

**Tech Stack:** JavaScript (ES2020+), Jest 29, `browser.storage.local` (webextension-polyfill, mocked in tests via `static/globals`).

**Spec:** `docs/superpowers/specs/2026-06-07-migration-data-safety-design.md`

---

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `app/utils/migrationInvariant.js` | Pure before/after comparator: detect lost uids / shrunk tabs / lost folders | Create |
| `app/utils/migrationSafety.js` | `withDataSafetyGuard`: snapshot → run → verify → restore | Create |
| `app/utils/storageUtils.js` | `checkIfMigrationNeedsRepair` (no destructive triggers) + `migrateLegacyStorage` (additive merge) | Modify |
| `app/utils/migrationCoordinator.js` | Wrap `executeMigration` in the guard | Modify |
| `tests/migrationInvariant.test.js` | Unit tests for the comparator | Create |
| `tests/migrationSafety.test.js` | Unit tests for the guard | Create |
| `tests/migrateLegacyStorage.test.js` | #102 repro + additive-merge tests | Create |

Shared test helper (stateful `browser.storage.local` mock) is copied per test file, matching the existing pattern in `tests/storageUtils.test.js:400-429`.

---

## Task 1: Pure invariant comparator

**Files:**
- Create: `app/utils/migrationInvariant.js`
- Test: `tests/migrationInvariant.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/migrationInvariant.test.js
import { snapshotShape, verifyMigrationInvariant } from '../app/utils/migrationInvariant';

const coll = (uid, tabs = 0, groups = 0) => ({
    uid,
    tabs: Array.from({ length: tabs }, (_, i) => ({ url: `u${i}` })),
    chromeGroups: Array.from({ length: groups }, (_, i) => ({ id: i })),
});

describe('verifyMigrationInvariant', () => {
    test('passes when nothing is lost or shrunk', () => {
        const before = snapshotShape([coll('a', 2), coll('b', 1)], [{ uid: 'f1' }]);
        const after = snapshotShape([coll('a', 2), coll('b', 1)], [{ uid: 'f1' }]);
        expect(verifyMigrationInvariant(before, after).ok).toBe(true);
    });

    test('passes when collections or tabs are ADDED', () => {
        const before = snapshotShape([coll('a', 2)], []);
        const after = snapshotShape([coll('a', 3), coll('b', 1)], [{ uid: 'f1' }]);
        expect(verifyMigrationInvariant(before, after).ok).toBe(true);
    });

    test('fails when a collection uid disappears', () => {
        const before = snapshotShape([coll('a', 2), coll('b', 1)], []);
        const after = snapshotShape([coll('a', 2)], []);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'collection_lost', uid: 'b' });
    });

    test('fails when a collection tab count shrinks', () => {
        const before = snapshotShape([coll('a', 5)], []);
        const after = snapshotShape([coll('a', 2)], []);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'tabs_shrunk', uid: 'a', before: 5, after: 2 });
    });

    test('fails when chromeGroups shrink', () => {
        const before = snapshotShape([coll('a', 2, 3)], []);
        const after = snapshotShape([coll('a', 2, 1)], []);
        expect(verifyMigrationInvariant(before, after).ok).toBe(false);
    });

    test('fails when a folder uid disappears', () => {
        const before = snapshotShape([], [{ uid: 'f1' }, { uid: 'f2' }]);
        const after = snapshotShape([], [{ uid: 'f1' }]);
        const result = verifyMigrationInvariant(before, after);
        expect(result.ok).toBe(false);
        expect(result.violations).toContainEqual({ type: 'folder_lost', uid: 'f2' });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/migrationInvariant.test.js`
Expected: FAIL — `snapshotShape`/`verifyMigrationInvariant` not exported.

- [ ] **Step 3: Implement `app/utils/migrationInvariant.js`**

```javascript
/**
 * Pure helpers describing the data-safety invariant for migrations.
 * No storage access — operates on plain snapshots so it is trivially testable.
 *
 * Invariant (over the migration window, where no user edits occur):
 *   - every collection uid present before is present after,
 *     with tabs.length and chromeGroups.length >= before;
 *   - every folder uid present before is present after.
 * Additions and field transforms (colors, urls, timestamps) are allowed.
 */

/**
 * Reduce full records to the minimal shape the invariant cares about.
 * @param {Array<object>} collections - collection records with uid/tabs/chromeGroups
 * @param {Array<object>} folders - folder records with uid
 * @returns {{collections: Object, folders: Object}}
 */
export const snapshotShape = (collections = [], folders = []) => {
    const collectionShape = {};
    collections.forEach((c) => {
        if (!c || !c.uid) return;
        collectionShape[c.uid] = {
            tabs: Array.isArray(c.tabs) ? c.tabs.length : 0,
            groups: Array.isArray(c.chromeGroups) ? c.chromeGroups.length : 0,
        };
    });

    const folderShape = {};
    folders.forEach((f) => {
        if (!f || !f.uid) return;
        folderShape[f.uid] = true;
    });

    return { collections: collectionShape, folders: folderShape };
};

/**
 * Compare two snapshots produced by snapshotShape.
 * @returns {{ok: boolean, violations: Array<object>}}
 */
export const verifyMigrationInvariant = (before, after) => {
    const violations = [];

    Object.keys(before.collections).forEach((uid) => {
        const b = before.collections[uid];
        const a = after.collections[uid];
        if (!a) {
            violations.push({ type: 'collection_lost', uid });
            return;
        }
        if (a.tabs < b.tabs) {
            violations.push({ type: 'tabs_shrunk', uid, before: b.tabs, after: a.tabs });
        }
        if (a.groups < b.groups) {
            violations.push({ type: 'groups_shrunk', uid, before: b.groups, after: a.groups });
        }
    });

    Object.keys(before.folders).forEach((uid) => {
        if (!after.folders[uid]) {
            violations.push({ type: 'folder_lost', uid });
        }
    });

    return { ok: violations.length === 0, violations };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test tests/migrationInvariant.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/migrationInvariant.js tests/migrationInvariant.test.js
git commit -m "feat(migration): add pure data-safety invariant comparator (#102)"
```

---

## Task 2: Data-safety guard wrapper

**Files:**
- Create: `app/utils/migrationSafety.js`
- Test: `tests/migrationSafety.test.js`

The guard reads/writes `browser.storage.local` directly (NOT via storageUtils load helpers) to avoid a circular import — `storageUtils` will import the guard.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/migrationSafety.test.js
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

test('restores snapshot when fn throws, and rethrows nothing (returns failure)', async () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/migrationSafety.test.js`
Expected: FAIL — `withDataSafetyGuard` not exported.

- [ ] **Step 3: Implement `app/utils/migrationSafety.js`**

```javascript
/**
 * Data-safety guard for migrations.
 *
 * Snapshots indexed collections + folders before running a migration step,
 * verifies the data-safety invariant afterward, and fully restores the snapshot
 * if any record was lost or shrunk (or the step threw). Guarantees that a
 * migration can only ever augment data — never destroy or alter it.
 *
 * Reads/writes browser.storage.local directly (no storageUtils import) to avoid
 * a circular dependency: storageUtils imports this module.
 */

import { browser } from '../../static/globals';
import { STORAGE_KEYS } from './sharedConstants';
import { snapshotShape, verifyMigrationInvariant } from './migrationInvariant';

const isCollectionKey = (key) => key.startsWith(STORAGE_KEYS.COLLECTION_PREFIX);
const isFolderKey = (key) => key.startsWith(STORAGE_KEYS.FOLDER_PREFIX);

/**
 * Capture everything needed to (a) verify the invariant and (b) fully restore.
 */
const captureSnapshot = async () => {
    const all = await browser.storage.local.get(null);
    const records = {};
    const collections = [];
    const folders = [];

    Object.keys(all).forEach((key) => {
        if (isCollectionKey(key)) {
            records[key] = all[key];
            if (all[key]) collections.push(all[key]);
        } else if (isFolderKey(key)) {
            records[key] = all[key];
            if (all[key]) folders.push(all[key]);
        }
    });

    records[STORAGE_KEYS.COLLECTIONS_INDEX] = all[STORAGE_KEYS.COLLECTIONS_INDEX];
    records[STORAGE_KEYS.FOLDERS_INDEX] = all[STORAGE_KEYS.FOLDERS_INDEX];
    records[STORAGE_KEYS.STORAGE_VERSION] = all[STORAGE_KEYS.STORAGE_VERSION];

    return {
        records,
        keys: new Set(Object.keys(records)),
        shape: snapshotShape(collections, folders),
    };
};

/**
 * Restore captured records and delete any collection_/folder_ key created during
 * the failed run (so resurrected/ghost records cannot linger).
 */
const restoreSnapshot = async (snapshot) => {
    const all = await browser.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter(
        (key) => (isCollectionKey(key) || isFolderKey(key)) && !snapshot.keys.has(key)
    );
    if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
    }

    const restorePayload = {};
    snapshot.keys.forEach((key) => {
        if (snapshot.records[key] !== undefined) {
            restorePayload[key] = snapshot.records[key];
        }
    });
    await browser.storage.local.set(restorePayload);
};

/**
 * Build the "after" shape from current storage for invariant verification.
 */
const captureCurrentShape = async () => {
    const all = await browser.storage.local.get(null);
    const collections = [];
    const folders = [];
    Object.keys(all).forEach((key) => {
        if (isCollectionKey(key) && all[key]) collections.push(all[key]);
        else if (isFolderKey(key) && all[key]) folders.push(all[key]);
    });
    return snapshotShape(collections, folders);
};

/**
 * Run `fn` under the data-safety guarantee.
 * @param {string} label - for logging
 * @param {() => Promise<object>} fn - the migration step; its result is returned on success
 * @returns {Promise<object>} fn's result, or { success: false, restored: true, violations|error }
 */
export const withDataSafetyGuard = async (label, fn) => {
    const snapshot = await captureSnapshot();

    let result;
    try {
        result = await fn();
    } catch (error) {
        console.error(`Migration "${label}" threw — restoring snapshot:`, error);
        await restoreSnapshot(snapshot);
        return { success: false, restored: true, error: error.message };
    }

    const afterShape = await captureCurrentShape();
    const verdict = verifyMigrationInvariant(snapshot.shape, afterShape);

    if (!verdict.ok) {
        console.error(`Migration "${label}" violated data-safety invariant — restoring:`, verdict.violations);
        await restoreSnapshot(snapshot);
        return { success: false, restored: true, violations: verdict.violations };
    }

    return result;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test tests/migrationSafety.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/migrationSafety.js tests/migrationSafety.test.js
git commit -m "feat(migration): add withDataSafetyGuard snapshot/restore wrapper (#102)"
```

---

## Task 3: Remove destructive triggers from `checkIfMigrationNeedsRepair`

The count-based trigger (`storageUtils.js:664`) and the `legacyMissingMetadata` trigger (`storageUtils.js:701-709`) cause full rebuilds from stale `tabsArray`. They must go. The function keeps only signals that indicate **in-place** repair is needed (missing backing record, missing metadata on the *indexed* record/index entry/folder) — never anything sourced from `tabsArray`'s contents beyond "this uid is missing entirely" (handled in Task 4).

**Files:**
- Modify: `app/utils/storageUtils.js:652-739`
- Test: `tests/migrateLegacyStorage.test.js` (created here, extended in Task 4)

- [ ] **Step 1: Write failing tests**

```javascript
// tests/migrateLegacyStorage.test.js
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
        // Live indexed state: user kept only collection "a" (deleted "b" and "c").
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 1, parentId: null, order: 0, lastUpdated: 200, lastOpened: null } },
            collection_a: { uid: 'a', name: 'A', tabs: [{ url: 'live' }], lastUpdated: 200, lastOpened: null, order: 0 },
            // Tombstones recorded when b and c were deleted.
            deleted_collection_tombstones: { b: 150, c: 150 },
            // Frozen months-old mirror still listing all three with tabs.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/migrateLegacyStorage.test.js`
Expected: FAIL — current code resurrects `b`/`c` and/or reverts `a` (rebuild from `tabsArray`).

- [ ] **Step 3: Replace `checkIfMigrationNeedsRepair` body**

Replace the entire function at `app/utils/storageUtils.js:652-739` with:

```javascript
/**
 * Decide whether IN-PLACE repair of indexed records is needed.
 *
 * IMPORTANT: this NEVER signals "rebuild from tabsArray". The indexed
 * collection_<uid> records are the source of truth; tabsArray is a frozen,
 * write-stale mirror and is never authoritative. We only report repair when an
 * indexed record is missing its backing data or required metadata fields.
 */
const checkIfMigrationNeedsRepair = async (existingIndex) => {
    try {
        if (!existingIndex || Object.keys(existingIndex).length === 0) {
            return false;
        }

        // Spot-check a few collections: index entry must have a backing record with a tabs array.
        const uidsToCheck = Object.keys(existingIndex).slice(0, 3);
        for (const uid of uidsToCheck) {
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const result = await browser.storage.local.get(collectionKey);
            const collection = result[collectionKey];

            if (!collection || !Array.isArray(collection.tabs)) {
                return true;
            }

            const indexMeta = existingIndex[uid];
            const recordMissingMetadata = (
                collection.lastUpdated === undefined ||
                collection.lastOpened === undefined ||
                collection.order === undefined
            );
            const indexMissingMetadata = (
                indexMeta.lastUpdated === undefined ||
                indexMeta.lastOpened === undefined ||
                indexMeta.order === undefined
            );
            if (recordMissingMetadata || indexMissingMetadata) {
                return true;
            }
        }

        const foldersIndex = await loadFoldersIndex();
        if (Object.keys(foldersIndex).length > 0) {
            const folders = await loadMultipleFolders(Object.keys(foldersIndex));
            for (const uid of Object.keys(foldersIndex)) {
                const folder = folders[uid];
                const folderMeta = foldersIndex[uid];
                if (!folder || folder.lastUpdated === undefined || folder.order === undefined) {
                    return true;
                }
                if (folderMeta.lastUpdated === undefined || folderMeta.order === undefined) {
                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        // If we cannot check, DO NOT assume rebuild. Returning false keeps live data
        // untouched (the data-safety guard is the backstop). Returning true here used
        // to trigger a destructive rebuild — that is exactly the #102 bug.
        console.error('Error checking migration repair needs:', error);
        return false;
    }
};
```

- [ ] **Step 4: Update the one call site**

At `app/utils/storageUtils.js:769`, change the call (it no longer takes `tabsArray`):

```javascript
            const needsRepair = await checkIfMigrationNeedsRepair(existingIndex);
```

- [ ] **Step 5: Run tests**

Run: `yarn test tests/migrateLegacyStorage.test.js`
Expected: STILL FAILING on resurrection — because the fall-through rebuild at lines 808-913 is fixed in Task 4. The "not reverted" test may now pass (early return when no repair needed). That's expected mid-task. Proceed.

- [ ] **Step 6: Commit**

```bash
git add app/utils/storageUtils.js tests/migrateLegacyStorage.test.js
git commit -m "fix(migration): stop signaling tabsArray rebuild from repair check (#102)"
```

---

## Task 4: Make `migrateLegacyStorage` additive-only

Replace the wholesale rebuild (`storageUtils.js:808-913`) with a gap-fill merge: start from the existing index, ADD only collections whose uid is absent **and** not tombstoned, repair metadata in place on existing records, and never overwrite a live record. Folders follow the same rule.

**Files:**
- Modify: `app/utils/storageUtils.js:744-936`
- Test: `tests/migrateLegacyStorage.test.js`

- [ ] **Step 1: Add more failing tests**

```javascript
// append to tests/migrateLegacyStorage.test.js
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
        // existing 'a' untouched
        expect(store.collection_a.tabs).toEqual([{ url: 'x' }]);
    });

    test('repairs missing metadata IN PLACE without reverting content', async () => {
        store = makeStore({
            collections_index: { a: { name: 'A', type: 'collection', tabCount: 2, parentId: null } }, // missing order/lastUpdated/lastOpened
            collection_a: { uid: 'a', name: 'A current', tabs: [{ url: '1' }, { url: '2' }], createdOn: 1000 }, // missing metadata
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/migrateLegacyStorage.test.js`
Expected: FAIL (resurrection test from Task 3 + the new additive tests).

- [ ] **Step 3: Rewrite the migration body**

Replace `migrateLegacyStorage` (`app/utils/storageUtils.js:744-936`) with the version below. Key changes: load tombstones; build `nextIndex` from a clone of `existingIndex`; only add absent, non-tombstoned uids; repair metadata in place; never overwrite existing records; same rule for folders.

```javascript
/**
 * Migrate / repair indexed storage. ADDITIVE ONLY.
 *
 * The indexed collection_<uid> records are the source of truth. The legacy
 * tabsArray is a frozen, write-stale mirror; it may only contribute collections
 * whose uid is entirely absent from the index AND not tombstoned. Existing
 * records are never overwritten or reverted — only missing metadata is repaired
 * in place. (See #102.)
 */
export const migrateLegacyStorage = async () => {
    try {
        const storageData = await browser.storage.local.get([
            STORAGE_KEYS.STORAGE_VERSION,
            STORAGE_KEYS.COLLECTIONS_INDEX,
            STORAGE_KEYS.LEGACY_TABS_ARRAY,
        ]);

        const version = storageData[STORAGE_KEYS.STORAGE_VERSION];
        const existingIndex = storageData[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tabsArray = storageData[STORAGE_KEYS.LEGACY_TABS_ARRAY];

        const supportAssessment = assessMigrationSupport40(await browser.storage.local.get(null));
        if (!supportAssessment.supported) {
            return { success: false, unsupportedPre40: true, error: 'Automatic migration is only supported for 4.0+ local data' };
        }

        const hasIndex = Object.keys(existingIndex).length > 0;

        // Up-to-date and structurally sound → nothing to do.
        if (version >= CURRENT_STORAGE_VERSION && hasIndex) {
            const needsRepair = await checkIfMigrationNeedsRepair(existingIndex);
            if (!needsRepair) {
                return { success: true, migrated: false };
            }
        }

        const tombstones = await loadDeletedCollectionTombstones();
        const folderTombstones = await loadDeletedFolderTombstones();

        const nextIndex = { ...existingIndex };
        const savePromises = [];
        let addedCount = 0;
        let repairedCount = 0;

        // --- Repair metadata IN PLACE on existing indexed records (never revert content). ---
        for (const uid of Object.keys(existingIndex)) {
            const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const existing = (await browser.storage.local.get(key))[key];
            if (!existing) continue; // missing backing record handled by add-pass below if present in tabsArray

            const order = existing.order !== undefined ? existing.order : (existingIndex[uid].order !== undefined ? existingIndex[uid].order : 999999);
            const lastUpdated = existing.lastUpdated !== undefined && existing.lastUpdated !== null
                ? existing.lastUpdated
                : (existing.createdOn || Date.now());
            const lastOpened = existing.lastOpened !== undefined ? existing.lastOpened : null;

            const needsRecordPatch = existing.order === undefined || existing.lastUpdated === undefined || existing.lastOpened === undefined;
            if (needsRecordPatch) {
                const patched = { ...existing, order, lastUpdated, lastOpened };
                savePromises.push(browser.storage.local.set({ [key]: patched }));
                repairedCount++;
            }

            nextIndex[uid] = {
                ...existingIndex[uid],
                type: 'collection',
                tabCount: Array.isArray(existing.tabs) ? existing.tabs.length : (existingIndex[uid].tabCount || 0),
                order: existingIndex[uid].order !== undefined ? existingIndex[uid].order : order,
                lastUpdated: existingIndex[uid].lastUpdated !== undefined ? existingIndex[uid].lastUpdated : lastUpdated,
                lastOpened: existingIndex[uid].lastOpened !== undefined ? existingIndex[uid].lastOpened : lastOpened,
                parentId: existingIndex[uid].parentId !== undefined ? existingIndex[uid].parentId : (existing.parentId !== undefined ? existing.parentId : null),
            };
        }

        // --- Add collections that exist ONLY in the frozen tabsArray, gated by tombstones. ---
        if (Array.isArray(tabsArray) && tabsArray.length > 0) {
            for (const [collectionIndex, collection] of tabsArray.entries()) {
                if (!collection || !collection.uid) continue;
                const uid = collection.uid;
                if (existingIndex[uid]) continue;        // live record wins — never overwrite/revert
                if (tombstones[uid]) continue;           // user deleted it — never resurrect

                const normalized = {
                    ...collection,
                    uid,
                    name: collection.name || 'Untitled Collection',
                    tabs: collection.tabs || [],
                    createdOn: collection.createdOn || Date.now(),
                    lastUpdated: collection.lastUpdated != null ? collection.lastUpdated : Date.now(),
                    lastOpened: collection.lastOpened != null ? collection.lastOpened : null,
                    color: collection.color || 'default',
                    parentId: collection.parentId !== undefined ? collection.parentId : null,
                    order: collection.order !== undefined ? collection.order : collectionIndex,
                };

                const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
                savePromises.push(browser.storage.local.set({ [key]: normalized }));
                nextIndex[uid] = {
                    name: normalized.name,
                    type: 'collection',
                    tabCount: normalized.tabs.length,
                    lastUpdated: normalized.lastUpdated,
                    lastOpened: normalized.lastOpened,
                    createdOn: normalized.createdOn,
                    color: normalized.color,
                    size: JSON.stringify(normalized).length,
                    parentId: normalized.parentId,
                    order: normalized.order,
                };
                addedCount++;
            }
        }

        // --- Folders: repair in place, never drop, skip tombstoned. ---
        const existingFoldersIndex = (await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX))[STORAGE_KEYS.FOLDERS_INDEX] || {};
        const folderUids = Object.keys(existingFoldersIndex).filter((uid) => !folderTombstones[uid]);
        const existingFolders = folderUids.length > 0 ? await loadMultipleFolders(folderUids) : {};
        const nextFoldersIndex = {};

        folderUids.forEach((uid, folderIndex) => {
            const meta = existingFoldersIndex[uid] || {};
            const record = existingFolders[uid] || {};
            const createdOn = record.createdOn || meta.createdOn || Date.now();
            const lastUpdated = record.lastUpdated != null ? record.lastUpdated : (meta.lastUpdated != null ? meta.lastUpdated : createdOn);
            const order = record.order !== undefined ? record.order : (meta.order !== undefined ? meta.order : folderIndex);

            const normalizedFolder = {
                uid,
                name: record.name || meta.name || 'Untitled Folder',
                type: 'folder',
                color: record.color || meta.color || 'var(--folder-default-color)',
                collapsed: record.collapsed !== undefined ? record.collapsed : (meta.collapsed !== undefined ? meta.collapsed : false),
                createdOn,
                lastUpdated,
                order,
            };

            const recordNeedsPatch = record.lastUpdated === undefined || record.order === undefined || record.createdOn === undefined;
            if (recordNeedsPatch) {
                savePromises.push(browser.storage.local.set({ [`${STORAGE_KEYS.FOLDER_PREFIX}${uid}`]: normalizedFolder }));
            }

            nextFoldersIndex[uid] = {
                name: normalizedFolder.name,
                type: 'folder',
                color: normalizedFolder.color,
                collapsed: normalizedFolder.collapsed,
                collectionCount: Object.values(nextIndex).filter((m) => m.parentId === uid).length,
                lastUpdated: normalizedFolder.lastUpdated,
                createdOn: normalizedFolder.createdOn,
                order: normalizedFolder.order,
                size: JSON.stringify(normalizedFolder).length,
            };
        });

        await Promise.all(savePromises);
        await browser.storage.local.set({
            [STORAGE_KEYS.COLLECTIONS_INDEX]: nextIndex,
            [STORAGE_KEYS.FOLDERS_INDEX]: nextFoldersIndex,
            [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_STORAGE_VERSION,
        });

        const migrated = addedCount > 0 || repairedCount > 0 || !hasIndex;
        const totalTabs = Object.values(nextIndex).reduce((sum, meta) => sum + (meta.tabCount || 0), 0);

        return { success: true, migrated, count: Object.keys(nextIndex).length, totalTabs };
    } catch (error) {
        console.error('❌ Migration failed:', error);
        return { success: false, error: error.message };
    }
};
```

- [ ] **Step 4: Run the migration tests**

Run: `yarn test tests/migrateLegacyStorage.test.js`
Expected: PASS (all Task 3 + Task 4 tests — no resurrection, no revert, adds recovered + first-time imports, in-place repair).

- [ ] **Step 5: Run the existing storage suite for regressions**

Run: `yarn test tests/storageUtils.test.js`
Expected: PASS. If any test asserted the old rebuild behavior, update it to the additive contract (note in commit).

- [ ] **Step 6: Commit**

```bash
git add app/utils/storageUtils.js tests/migrateLegacyStorage.test.js
git commit -m "fix(migration): additive-only legacy merge — never overwrite/resurrect/revert (#102)"
```

---

## Task 5: Wrap both migration entry points in the guard

**Files:**
- Modify: `app/utils/storageUtils.js` (wrap `migrateLegacyStorage`'s effectful body)
- Modify: `app/utils/migrationCoordinator.js:181-287` (wrap `executeMigration`'s work)
- Test: `tests/migrateLegacyStorage.test.js`

- [ ] **Step 1: Add a guard-integration test**

```javascript
// append to tests/migrateLegacyStorage.test.js
describe('migrateLegacyStorage — guarded against loss', () => {
    test('a hypothetical lossy outcome leaves data intact (guard restores)', async () => {
        // Two live collections; tabsArray empty so no adds. Then simulate the
        // guard contract: if the body somehow dropped collection_b, the guard
        // restores it. We assert the end state preserves both.
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
```

- [ ] **Step 2: Run it (should pass already, establishes the contract)**

Run: `yarn test tests/migrateLegacyStorage.test.js -t "guard restores"`
Expected: PASS.

- [ ] **Step 3: Wrap `migrateLegacyStorage` body in the guard**

Add the import near the top of `app/utils/storageUtils.js` (after existing imports):

```javascript
import { withDataSafetyGuard } from './migrationSafety';
```

Rename the additive implementation from Task 4 to `migrateLegacyStorageUnsafe` (keep its body identical), then export a guarded wrapper:

```javascript
// Rename: `export const migrateLegacyStorage = async () => {`  →
const migrateLegacyStorageUnsafe = async () => {
    // ... unchanged body from Task 4 ...
};

export const migrateLegacyStorage = () =>
    withDataSafetyGuard('migrateLegacyStorage', migrateLegacyStorageUnsafe);
```

- [ ] **Step 4: Wrap the coordinator's `executeMigration` work**

In `app/utils/migrationCoordinator.js`, add the import (top, with the other `./` imports):

```javascript
import { withDataSafetyGuard } from './migrationSafety';
```

Wrap the migration-steps execution. At `app/utils/migrationCoordinator.js:223`, replace:

```javascript
      const migrationResult = await this.executeMigrationSteps(
        assessment.currentVersion,
        assessment.migrationPath
      );
```

with:

```javascript
      const guarded = await withDataSafetyGuard('coordinator', () =>
        this.executeMigrationSteps(assessment.currentVersion, assessment.migrationPath)
      );
      // If the guard restored due to invariant violation, surface as a failed step result.
      const migrationResult = guarded && guarded.restored
        ? { success: false, error: 'data-safety guard restored snapshot', restored: true }
        : guarded;
```

- [ ] **Step 5: Run migration tests + coordinator tests**

Run: `yarn test tests/migrateLegacyStorage.test.js tests/migrationCoordinator.test.js`
Expected: PASS. If `migrationCoordinator.test.js` mocks `./migrationSafety`, ensure the mock passes the fn through (e.g. `withDataSafetyGuard: (l, fn) => fn()`); add that mock if the suite isolates storage.

- [ ] **Step 6: Commit**

```bash
git add app/utils/storageUtils.js app/utils/migrationCoordinator.js tests/migrateLegacyStorage.test.js
git commit -m "feat(migration): guard both entry points with data-safety wrapper (#102)"
```

---

## Task 6: Coordinator step-additivity regression test

Confirm color/timestamp/deferred-url steps never drop a collection or shrink tabs, and that the guard catches a hypothetical lossy step.

**Files:**
- Test: `tests/migrationCoordinator.test.js` (extend)

- [ ] **Step 1: Read the existing coordinator test setup**

Run: `sed -n '1,60p' tests/migrationCoordinator.test.js`
Note how it mocks storage and whether it already mocks `./migrationSafety`.

- [ ] **Step 2: Add an additivity test**

```javascript
// append to tests/migrationCoordinator.test.js — adapt imports/mocks to the file's existing setup
import { migrationCoordinator } from '../app/utils/migrationCoordinator';

test('color/timestamp/deferred-url steps preserve every collection and its tab count', async () => {
    const data = {
        collection_a: { uid: 'a', tabs: [{ url: 'http://x' }, { url: 'http://y' }], color: '#1D76DB' },
        collection_b: { uid: 'b', tabs: [{ url: 'http://z' }], color: '#D93F0B' },
        tabsArray: [
            { uid: 'a', tabs: [{ url: 'http://x' }, { url: 'http://y' }], color: '#1D76DB' },
            { uid: 'b', tabs: [{ url: 'http://z' }], color: '#D93F0B' },
        ],
    };

    const afterColor = await migrationCoordinator.migrateColorsOnly(data);
    const afterTs = await migrationCoordinator.migrateTimestamps(afterColor);
    const afterUrls = await migrationCoordinator.repairDeferredUrls(afterTs);

    expect(afterUrls.collection_a.tabs).toHaveLength(2);
    expect(afterUrls.collection_b.tabs).toHaveLength(1);
    expect(afterUrls.collection_a.uid).toBe('a');
    expect(afterUrls.collection_b.uid).toBe('b');
});
```

- [ ] **Step 3: Run it**

Run: `yarn test tests/migrationCoordinator.test.js`
Expected: PASS. If a step is found to drop/shrink data, fix that step to merge additively, then re-run.

- [ ] **Step 4: Commit**

```bash
git add tests/migrationCoordinator.test.js
git commit -m "test(migration): assert coordinator steps are additive (#102)"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `yarn test`
Expected: All suites PASS. Address any regression in suites that asserted the old destructive rebuild behavior by updating them to the additive contract.

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: No errors in changed files.

- [ ] **Step 3: Production build verification (project requirement)**

Run: `yarn prod`
Expected: Build succeeds.

- [ ] **Step 4: Final commit (if lint/build produced fixes)**

```bash
git add -A
git commit -m "chore(migration): lint + prod build verification for data-safety fix (#102)"
```

---

## Self-Review Notes

- **Spec coverage:** Layer 1 → Tasks 3+4; Layer 2 → Task 6; Layer 3 (`withDataSafetyGuard` + invariant) → Tasks 1, 2, 5; invariant definition → Task 1; tombstone-aware add → Task 4; first-time migration preserved → Task 4 Step 1. All spec testing bullets mapped to a task.
- **Type/name consistency:** `withDataSafetyGuard(label, fn)`, `snapshotShape`, `verifyMigrationInvariant`, `migrateLegacyStorageUnsafe`/`migrateLegacyStorage`, `checkIfMigrationNeedsRepair(existingIndex)` (arity reduced — single call site updated in Task 3 Step 4) — consistent across tasks.
- **No placeholders:** every code/test step has concrete content.
- **Known dependency note:** `migrationCoordinator.test.js` may need a `./migrationSafety` mock that passes `fn` through (called out in Task 5 Step 5). `migrateColorsOnly`/`migrateTimestamps`/`repairDeferredUrls` are instance methods on the exported `migrationCoordinator` singleton (verified in `migrationCoordinator.js`), so Task 6 can call them directly.
