# Orphaned-Collection Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect collections that the pre-#102 migration dropped from the index (their `collection_<uid>` records still exist as orphans) and let the user restore them — consent-first via a modal, plus a manual entry point in both popup and full-page settings.

**Architecture:** A pure detection function and an additive, data-safety-guarded recovery function live in a new isolated module (`app/utils/orphanRecovery.js`). A shared hook (`app/useOrphanRecovery.js`) runs detection after migration completes and drives three UI surfaces (consent modal, full-page Recovery card, popup settings entry) from one source of truth. Recovery only ever *adds* index entries pointing at records that already exist — it never overwrites, resurrects tombstoned items, or reduces data.

**Tech Stack:** React 19, Jotai (not needed here — local hook state), Jest 29 + React Testing Library, `webextension-polyfill` (`browser` from `static/globals`). Reuses `withDataSafetyGuard` (`app/utils/migrationSafety.js`), `STORAGE_KEYS` (`app/utils/sharedConstants.js`), and the `react-modal` + `Modal.css` pattern used by existing modals.

---

## File Structure

- **Create** `app/utils/orphanRecovery.js` — `detectRecoverableCollections()` (read-only) and `recoverOrphanedCollections(uids)` (additive, guarded).
- **Create** `tests/orphanRecovery.test.js` — unit tests for both functions.
- **Create** `app/useOrphanRecovery.js` — shared hook: detect-on-ready, `recover`, `dismiss`, derived `showModal`/`showEntry`.
- **Create** `tests/useOrphanRecovery.test.js` — hook tests.
- **Create** `app/OrphanRecoveryModal.js` + `app/OrphanRecoveryModal.css` — consent-first modal.
- **Create** `tests/OrphanRecoveryModal.test.js` — modal tests.
- **Modify** `app/App.js` — set `orphanScanReady` after migration; own the hook; render the modal; pass the `orphanRecovery` object to `SettingsMenu`.
- **Modify** `app/SettingsMenu.js` — thread `orphanRecovery` through; add the popup entry to `popupBackupSection`.
- **Modify** `app/SyncDebugRecoveryPanel.js` — render the full-page orphan card + restore picker.

Each task is independently testable and committed on its own.

---

## Task 1: Detection — `detectRecoverableCollections()`

**Files:**
- Create: `app/utils/orphanRecovery.js`
- Test: `tests/orphanRecovery.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/orphanRecovery.test.js`:

```javascript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/orphanRecovery.test.js -t detectRecoverableCollections`
Expected: FAIL — "Cannot find module '../app/utils/orphanRecovery'" / `detectRecoverableCollections is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `app/utils/orphanRecovery.js`:

```javascript
import { browser } from '../../static/globals';
import { STORAGE_KEYS } from './sharedConstants';

/**
 * Find collection records that exist in storage but are not referenced by the
 * collections_index (and were not deliberately deleted). These are the
 * collections the pre-#102 migration dropped from the index. Read-only.
 */
export const detectRecoverableCollections = async () => {
    try {
        const all = await browser.storage.local.get(null);
        const index = all[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tombstones = all[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES] || {};
        const prefix = STORAGE_KEYS.COLLECTION_PREFIX;

        const orphans = [];
        for (const key of Object.keys(all)) {
            if (!key.startsWith(prefix)) continue;
            const uid = key.slice(prefix.length);
            if (index[uid]) continue;        // already visible
            if (tombstones[uid]) continue;   // user deleted it deliberately

            const record = all[key];
            if (!record || typeof record !== 'object' || !Array.isArray(record.tabs)) continue;

            orphans.push({
                uid,
                name: record.name || 'Untitled Collection',
                tabCount: record.tabs.length,
                createdOn: record.createdOn || 0,
                lastUpdated: record.lastUpdated != null ? record.lastUpdated : null,
                parentId: record.parentId != null ? record.parentId : null,
                color: record.color || 'default',
            });
        }

        orphans.sort((a, b) => (b.createdOn || 0) - (a.createdOn || 0));
        return orphans;
    } catch (error) {
        console.error('Failed to detect recoverable collections:', error);
        return [];
    }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/orphanRecovery.test.js -t detectRecoverableCollections`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/orphanRecovery.js tests/orphanRecovery.test.js
git commit -m "feat(recovery): detect orphaned collections missing from the index"
```

---

## Task 2: Recovery — `recoverOrphanedCollections(uids)`

**Files:**
- Modify: `app/utils/orphanRecovery.js`
- Test: `tests/orphanRecovery.test.js`

This uses the REAL `withDataSafetyGuard` (no mock) so the rollback test exercises the actual guard. The guard reads/writes `browser.storage.local` directly, which the in-memory mock already supports — but the mock needs a `remove` implementation (the guard may call it). Add it in Step 1.

- [ ] **Step 1: Write the failing test**

Add to `tests/orphanRecovery.test.js`. First, extend the `beforeEach` mock with `remove` (add this line after the `set` mock):

```javascript
    browser.storage.local.remove.mockImplementation(async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
    });
```

Then add the import at the top:

```javascript
import { detectRecoverableCollections, recoverOrphanedCollections } from '../app/utils/orphanRecovery';
```

(Replace the existing single-name import from Task 1.)

Then add this describe block:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/orphanRecovery.test.js -t recoverOrphanedCollections`
Expected: FAIL — `recoverOrphanedCollections is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `app/utils/orphanRecovery.js` (new import + function):

```javascript
import { withDataSafetyGuard } from './migrationSafety';
```

```javascript
/**
 * Re-link selected orphaned collections into the index. ADDITIVE ONLY: it adds
 * index entries pointing at records that already exist; it never overwrites a
 * live record, resurrects a tombstoned uid, or removes anything. Runs under the
 * data-safety guard, which rolls back on any throw or invariant violation.
 * @param {string[]} uids
 * @returns {Promise<{success: boolean, recovered: number, uids: string[]}>}
 */
export const recoverOrphanedCollections = async (uids = []) => {
    if (!Array.isArray(uids) || uids.length === 0) {
        return { success: true, recovered: 0, uids: [] };
    }

    return withDataSafetyGuard('orphan-recovery', async () => {
        const index = (await browser.storage.local.get(STORAGE_KEYS.COLLECTIONS_INDEX))[STORAGE_KEYS.COLLECTIONS_INDEX] || {};
        const tombstones = (await browser.storage.local.get(STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES))[STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES] || {};
        const foldersIndex = (await browser.storage.local.get(STORAGE_KEYS.FOLDERS_INDEX))[STORAGE_KEYS.FOLDERS_INDEX] || {};

        const keys = uids.map((uid) => `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`);
        const records = await browser.storage.local.get(keys);

        const nextIndex = { ...index };
        const writePayload = {};
        const recoveredUids = [];
        const now = Date.now();

        uids.forEach((uid, i) => {
            if (index[uid]) return;        // already visible
            if (tombstones[uid]) return;   // deliberately deleted
            const key = `${STORAGE_KEYS.COLLECTION_PREFIX}${uid}`;
            const record = records[key];
            if (!record || !Array.isArray(record.tabs)) return;

            const order = record.order !== undefined ? record.order : 999999 + i; // missing order -> sort last
            const lastUpdated = record.lastUpdated != null ? record.lastUpdated : (record.createdOn || now);
            const lastOpened = record.lastOpened !== undefined ? record.lastOpened : null;
            const parentDead = record.parentId && !foldersIndex[record.parentId];
            const parentId = parentDead ? null : (record.parentId != null ? record.parentId : null);

            const needsPatch = record.order === undefined
                || record.lastUpdated === undefined
                || record.lastOpened === undefined
                || parentDead;
            const normalized = needsPatch ? { ...record, order, lastUpdated, lastOpened, parentId } : record;
            if (needsPatch) writePayload[key] = normalized;

            nextIndex[uid] = {
                name: normalized.name || 'Untitled Collection',
                type: 'collection',
                tabCount: Array.isArray(normalized.tabs) ? normalized.tabs.length : 0,
                lastUpdated,
                lastOpened,
                createdOn: normalized.createdOn || now,
                color: normalized.color || 'default',
                size: JSON.stringify(normalized).length,
                parentId,
                order,
            };
            recoveredUids.push(uid);
        });

        if (recoveredUids.length > 0) {
            writePayload[STORAGE_KEYS.COLLECTIONS_INDEX] = nextIndex;
            await browser.storage.local.set(writePayload);
        }

        return { success: true, recovered: recoveredUids.length, uids: recoveredUids };
    });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/orphanRecovery.test.js`
Expected: PASS (all 5 tests across both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add app/utils/orphanRecovery.js tests/orphanRecovery.test.js
git commit -m "feat(recovery): additively re-link orphaned collections under data-safety guard"
```

---

## Task 3: Shared hook — `useOrphanRecovery`

**Files:**
- Create: `app/useOrphanRecovery.js`
- Test: `tests/useOrphanRecovery.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/useOrphanRecovery.test.js`:

```javascript
jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(), set: jest.fn() } } },
}));
jest.mock('../app/utils/orphanRecovery', () => ({
    detectRecoverableCollections: jest.fn(),
    recoverOrphanedCollections: jest.fn(),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';
import { detectRecoverableCollections, recoverOrphanedCollections } from '../app/utils/orphanRecovery';
import useOrphanRecovery from '../app/useOrphanRecovery';

beforeEach(() => {
    jest.clearAllMocks();
    browser.storage.local.get.mockResolvedValue({});       // no dismiss flag
    browser.storage.local.set.mockResolvedValue(undefined);
});

test('does not detect until ready is true', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a' }]);
    const { result } = renderHook(() => useOrphanRecovery(false));
    expect(detectRecoverableCollections).not.toHaveBeenCalled();
    expect(result.current.showModal).toBe(false);
});

test('shows modal when orphans exist and not dismissed', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a', name: 'A' }]);
    const { result } = renderHook(() => useOrphanRecovery(true));
    await waitFor(() => expect(result.current.orphanCount).toBe(1));
    expect(result.current.showModal).toBe(true);
    expect(result.current.showEntry).toBe(true);
});

test('dismiss() persists the flag and hides the modal but keeps the entry', async () => {
    detectRecoverableCollections.mockResolvedValue([{ uid: 'a', name: 'A' }]);
    const { result } = renderHook(() => useOrphanRecovery(true));
    await waitFor(() => expect(result.current.showModal).toBe(true));

    await act(async () => { await result.current.dismiss(); });

    expect(browser.storage.local.set).toHaveBeenCalledWith({ orphanRecoveryModalDismissed: true });
    expect(result.current.showModal).toBe(false);
    expect(result.current.showEntry).toBe(true);
});

test('recover() restores, re-detects, and fires onRecovered', async () => {
    detectRecoverableCollections
        .mockResolvedValueOnce([{ uid: 'a', name: 'A' }])  // initial
        .mockResolvedValueOnce([]);                        // after recovery
    recoverOrphanedCollections.mockResolvedValue({ success: true, recovered: 1, uids: ['a'] });
    const onRecovered = jest.fn();

    const { result } = renderHook(() => useOrphanRecovery(true, { onRecovered }));
    await waitFor(() => expect(result.current.orphanCount).toBe(1));

    await act(async () => { await result.current.recover(); });

    expect(recoverOrphanedCollections).toHaveBeenCalledWith(['a']);
    expect(onRecovered).toHaveBeenCalledWith(1);
    await waitFor(() => expect(result.current.orphanCount).toBe(0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/useOrphanRecovery.test.js`
Expected: FAIL — "Cannot find module '../app/useOrphanRecovery'".

- [ ] **Step 3: Write minimal implementation**

Create `app/useOrphanRecovery.js`:

```javascript
import { useCallback, useEffect, useState } from 'react';
import { browser } from '../static/globals';
import { detectRecoverableCollections, recoverOrphanedCollections } from './utils/orphanRecovery';

const DISMISS_KEY = 'orphanRecoveryModalDismissed';

/**
 * Single source of truth for orphaned-collection recovery across all surfaces.
 * @param {boolean} ready - run detection only once migration has finished
 * @param {{ onRecovered?: (count: number) => (void|Promise<void>) }} [options]
 */
export default function useOrphanRecovery(ready, { onRecovered } = {}) {
    const [orphans, setOrphans] = useState([]);
    const [dismissed, setDismissed] = useState(true); // suppress modal until detection confirms otherwise
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!ready) return undefined;
        let cancelled = false;
        (async () => {
            const found = await detectRecoverableCollections();
            const { [DISMISS_KEY]: flag } = await browser.storage.local.get(DISMISS_KEY);
            if (cancelled) return;
            setOrphans(found);
            setDismissed(Boolean(flag));
        })();
        return () => { cancelled = true; };
    }, [ready]);

    const recover = useCallback(async (uids) => {
        const target = (uids && uids.length) ? uids : orphans.map((o) => o.uid);
        if (target.length === 0) return { success: true, recovered: 0, uids: [] };
        setBusy(true);
        try {
            const result = await recoverOrphanedCollections(target);
            const remaining = await detectRecoverableCollections();
            setOrphans(remaining);
            if (result.success && result.recovered > 0 && typeof onRecovered === 'function') {
                await onRecovered(result.recovered);
            }
            return result;
        } finally {
            setBusy(false);
        }
    }, [orphans, onRecovered]);

    const dismiss = useCallback(async () => {
        await browser.storage.local.set({ [DISMISS_KEY]: true });
        setDismissed(true);
    }, []);

    return {
        orphans,
        orphanCount: orphans.length,
        showModal: orphans.length > 0 && !dismissed,
        showEntry: orphans.length > 0,
        busy,
        recover,
        dismiss,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/useOrphanRecovery.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/useOrphanRecovery.js tests/useOrphanRecovery.test.js
git commit -m "feat(recovery): shared useOrphanRecovery hook driving all surfaces"
```

---

## Task 4: Consent modal — `OrphanRecoveryModal`

**Files:**
- Create: `app/OrphanRecoveryModal.js`
- Create: `app/OrphanRecoveryModal.css`
- Test: `tests/OrphanRecoveryModal.test.js`

The modal is presentational: it receives `orphans`, `busy`, and callbacks. It does NOT call the hook itself (App owns the hook and passes props), so it's trivially testable.

- [ ] **Step 1: Write the failing test**

Create `tests/OrphanRecoveryModal.test.js`:

```javascript
import { render, screen, fireEvent } from '@testing-library/react';
import OrphanRecoveryModal from '../app/OrphanRecoveryModal';

const orphans = [
    { uid: 'a', name: 'Alpha', tabCount: 3 },
    { uid: 'b', name: 'Beta', tabCount: 1 },
];

test('renders the count and wires the three actions', () => {
    const onRestoreAll = jest.fn();
    const onChoose = jest.fn();
    const onDismiss = jest.fn();

    render(
        <OrphanRecoveryModal
            isOpen
            orphans={orphans}
            busy={false}
            onRestoreAll={onRestoreAll}
            onChoose={onChoose}
            onDismiss={onDismiss}
        />,
    );

    expect(screen.getByText(/2 collections/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restore all/i }));
    expect(onRestoreAll).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /choose what to restore/i }));
    expect(onChoose).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onDismiss).toHaveBeenCalled();
});

test('disables actions while busy', () => {
    render(
        <OrphanRecoveryModal isOpen orphans={orphans} busy onRestoreAll={() => {}} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /restoring/i })).toBeDisabled();
});

test('renders nothing when closed', () => {
    const { container } = render(
        <OrphanRecoveryModal isOpen={false} orphans={orphans} busy={false} onRestoreAll={() => {}} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/OrphanRecoveryModal.test.js`
Expected: FAIL — "Cannot find module '../app/OrphanRecoveryModal'".

- [ ] **Step 3: Write minimal implementation**

Create `app/OrphanRecoveryModal.css`:

```css
.orphan-recovery-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.orphan-recovery-modal {
    background: var(--background-color, #fff);
    color: var(--text-color, #1a1a1a);
    border-radius: 12px;
    padding: 24px;
    max-width: 420px;
    width: calc(100% - 32px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.orphan-recovery-modal h3 { margin: 0 0 8px; font-size: 18px; }
.orphan-recovery-modal p { margin: 0 0 16px; font-size: 14px; line-height: 1.5; }

.orphan-recovery-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.orphan-recovery-actions .primary {
    background: var(--primary-color, #2563eb);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 10px 14px;
    font-weight: 600;
    cursor: pointer;
}

.orphan-recovery-actions .secondary,
.orphan-recovery-actions .tertiary {
    background: transparent;
    border: 1px solid var(--border-color, #d4d4d8);
    border-radius: 8px;
    padding: 10px 14px;
    cursor: pointer;
    color: inherit;
}

.orphan-recovery-actions .tertiary { border-color: transparent; }
.orphan-recovery-actions button:disabled { opacity: 0.6; cursor: default; }
```

Create `app/OrphanRecoveryModal.js`:

```javascript
import React from 'react';
import { MdSettingsBackupRestore } from 'react-icons/md';
import './OrphanRecoveryModal.css';

/**
 * Consent-first modal shown when recoverable orphaned collections are detected.
 * Presentational only — all state lives in the parent via useOrphanRecovery.
 */
function OrphanRecoveryModal({ isOpen, orphans = [], busy = false, onRestoreAll, onChoose, onDismiss }) {
    if (!isOpen) return null;

    const count = orphans.length;
    const label = count === 1 ? 'collection' : 'collections';

    return (
        <div className="orphan-recovery-overlay" role="dialog" aria-modal="true" aria-label="Recover hidden collections">
            <div className="orphan-recovery-modal">
                <h3><MdSettingsBackupRestore size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />We found collections we can restore</h3>
                <p>
                    An earlier update accidentally hid <strong>{count} {label}</strong>. They&apos;re still safe on your
                    device — want them back?
                </p>
                <div className="orphan-recovery-actions">
                    <button type="button" className="primary" onClick={onRestoreAll} disabled={busy}>
                        {busy ? 'Restoring…' : `Restore all ${count}`}
                    </button>
                    <button type="button" className="secondary" onClick={onChoose} disabled={busy}>
                        Choose what to restore
                    </button>
                    <button type="button" className="tertiary" onClick={onDismiss} disabled={busy}>
                        Not now
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OrphanRecoveryModal;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/OrphanRecoveryModal.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/OrphanRecoveryModal.js app/OrphanRecoveryModal.css tests/OrphanRecoveryModal.test.js
git commit -m "feat(recovery): consent-first orphan recovery modal"
```

---

## Task 5: Wire detection + modal into App

**Files:**
- Modify: `app/App.js` (migration block ~1132-1142; component return ~2026; SettingsMenu render)

App owns the single `useOrphanRecovery` instance, flips `orphanScanReady` to true once migration has run, renders the modal, and passes the `orphanRecovery` object down to `SettingsMenu` so the full-page and popup entries share the same state.

- [ ] **Step 1: Add imports and the ready flag**

Near the top imports of `app/App.js`, add:

```javascript
import useOrphanRecovery from './useOrphanRecovery';
import OrphanRecoveryModal from './OrphanRecoveryModal';
```

Inside the `App` component body, with the other `useState` declarations, add:

```javascript
const [orphanScanReady, setOrphanScanReady] = useState(false);
```

- [ ] **Step 2: Flip the ready flag after migration**

In the init effect, immediately AFTER the `needsStorageMigration` block (after `app/App.js:1142`, where the `if (needsStorageMigration) { ... }` block closes), add:

```javascript
      // Migration (if any) has now run — safe to scan for orphaned collections.
      setOrphanScanReady(true);
```

- [ ] **Step 3: Instantiate the hook**

After the `useState` declarations in the component body, add (the `onRecovered` reuses the same collections refresh App already passes to SettingsMenu as `onDataUpdate`; replace `reloadCollections` with App's actual refresh function name if different):

```javascript
const orphanRecovery = useOrphanRecovery(orphanScanReady, {
    onRecovered: async (count) => {
        await reloadCollections();
        showSuccessToast(`Restored ${count} hidden collection${count === 1 ? '' : 's'}`);
    },
});
```

- [ ] **Step 4: Render the modal**

Inside the top-level returned JSX (in BOTH the full-page and popup branches, or in a shared wrapper if one exists — search for the `return (` near `app/App.js:2026`), add the modal as a sibling near the root element:

```jsx
<OrphanRecoveryModal
    isOpen={orphanRecovery.showModal}
    orphans={orphanRecovery.orphans}
    busy={orphanRecovery.busy}
    onRestoreAll={() => orphanRecovery.recover()}
    onChoose={() => { orphanRecovery.dismiss(); openSettingsToRecovery(); }}
    onDismiss={() => orphanRecovery.dismiss()}
/>
```

If App has no existing `openSettingsToRecovery` helper, use `onChoose={() => orphanRecovery.dismiss()}` for now (the user can open the settings entry manually) and note it — the picker is fully reachable from Task 6/7.

- [ ] **Step 5: Pass the hook object to SettingsMenu**

Find where `<SettingsMenu ... />` is rendered in `app/App.js` and add the prop:

```jsx
orphanRecovery={orphanRecovery}
```

- [ ] **Step 6: Verify the app still builds and tests pass**

Run: `yarn jest tests/orphanRecovery.test.js tests/useOrphanRecovery.test.js tests/OrphanRecoveryModal.test.js && yarn lint`
Expected: PASS, no lint errors in the new/modified files.

- [ ] **Step 7: Commit**

```bash
git add app/App.js
git commit -m "feat(recovery): detect orphans after migration and show consent modal"
```

---

## Task 6: Full-page Recovery card + picker

**Files:**
- Modify: `app/SettingsMenu.js` (pass `orphanRecovery` into the full-page `SyncDebugRecoveryPanel`)
- Modify: `app/SyncDebugRecoveryPanel.js` (render the card + reuse `BackupRestorePickerModal`)
- Test: `tests/SyncDebugRecoveryPanel.orphans.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/SyncDebugRecoveryPanel.orphans.test.js`:

```javascript
jest.mock('../static/globals', () => ({ browser: { runtime: { sendMessage: jest.fn().mockResolvedValue({ groups: [] }) } } }));

import { render, screen, fireEvent } from '@testing-library/react';
import SyncDebugRecoveryPanel from '../app/SyncDebugRecoveryPanel';

const orphanRecovery = {
    orphans: [{ uid: 'a', name: 'Alpha', tabCount: 2 }],
    orphanCount: 1,
    showEntry: true,
    busy: false,
    recover: jest.fn().mockResolvedValue({ success: true, recovered: 1 }),
    dismiss: jest.fn(),
};

test('shows the orphan card with the count and triggers recover', async () => {
    render(<SyncDebugRecoveryPanel isActive mode="recovery" orphanRecovery={orphanRecovery} />);

    expect(await screen.findByText(/hidden collections found/i)).toBeInTheDocument();
    expect(screen.getByText(/1 recoverable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /review & restore/i }));
    // picker opens; restore-all path
    fireEvent.click(await screen.findByRole('button', { name: /restore/i }));
    expect(orphanRecovery.recover).toHaveBeenCalled();
});

test('hides the card when there are no orphans', () => {
    render(<SyncDebugRecoveryPanel isActive mode="recovery" orphanRecovery={{ ...orphanRecovery, orphans: [], orphanCount: 0, showEntry: false }} />);
    expect(screen.queryByText(/hidden collections found/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/SyncDebugRecoveryPanel.orphans.test.js`
Expected: FAIL — card text not found (prop not consumed yet).

- [ ] **Step 3: Implement the card in `SyncDebugRecoveryPanel.js`**

Add `orphanRecovery` to the component's destructured props (default `{}`):

```javascript
function SyncDebugRecoveryPanel({
    isActive = false,
    isSyncEnabled = false,
    mode = 'recovery',
    applyDataFromServer,
    updateRemoteData,
    onDataUpdate,
    feedbackToasterId,
    orphanRecovery = {},
}) {
```

Add local state for the orphan picker near the other `useState` calls:

```javascript
    const [orphanPickerOpen, setOrphanPickerOpen] = useState(false);
```

In `renderRecoveryView`, immediately inside the returned fragment (before the `sync-recovery-header`), add the card:

```jsx
{orphanRecovery.showEntry && (
    <section className="sync-recovery-orphan-card">
        <div className="sync-recovery-orphan-copy">
            <strong>Hidden collections found</strong>
            <span>{orphanRecovery.orphanCount} recoverable — collections an earlier update hid. They&apos;re safe on your device.</span>
        </div>
        <button
            type="button"
            className="sync-recovery-primary-action"
            disabled={orphanRecovery.busy}
            onClick={() => setOrphanPickerOpen(true)}
        >
            <MdOutlineRestore size={16} />
            <span>Review &amp; Restore</span>
        </button>
    </section>
)}
```

At the end of `renderRecoveryView` (next to the existing `<BackupRestorePickerModal ... />`), render a second picker for orphans, reusing the existing modal component by feeding it an orphan-shaped preview:

```jsx
<BackupRestorePickerModal
    isOpen={orphanPickerOpen}
    onClose={() => setOrphanPickerOpen(false)}
    backup={{ label: 'Hidden collections' }}
    previewData={{
        collections: (orphanRecovery.orphans || []).map((o) => ({ previewId: o.uid, name: o.name, tabCount: o.tabCount, groupCount: 0, color: o.color, previewTabs: [] })),
        sections: [{ id: 'root', title: 'Recoverable', collections: (orphanRecovery.orphans || []).map((o) => ({ previewId: o.uid, name: o.name, tabCount: o.tabCount, groupCount: 0, color: o.color, previewTabs: [] })) }],
    }}
    isLoading={false}
    isRestoring={orphanRecovery.busy}
    selectedCollectionIds={(orphanRecovery.orphans || []).map((o) => o.uid)}
    onSelectionChange={() => {}}
    onConfirm={async () => {
        const res = await orphanRecovery.recover((orphanRecovery.orphans || []).map((o) => o.uid));
        if (res?.success) setOrphanPickerOpen(false);
    }}
/>
```

(Note: this v1 restores all listed orphans on confirm. Per-item selection wiring can be added later by tracking `selectedCollectionIds` in local state and passing them to `recover`.)

Add minimal CSS to `app/SyncDebugRecoveryPanel.css`:

```css
.sync-recovery-orphan-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
    border: 1px solid var(--primary-color, #2563eb);
    border-radius: 10px;
    background: var(--primary-color-faded, rgba(37, 99, 235, 0.08));
}
.sync-recovery-orphan-copy { display: flex; flex-direction: column; gap: 2px; }
.sync-recovery-orphan-copy span { font-size: 13px; opacity: 0.85; }
```

- [ ] **Step 4: Pass the prop through `SettingsMenu.js`**

In the full-page Recovery section's `renderFullPageContent` (`app/SettingsMenu.js:464`), add `orphanRecovery={props.orphanRecovery}` to the `<SyncDebugRecoveryPanel ... mode="recovery" ... />` element.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn jest tests/SyncDebugRecoveryPanel.orphans.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app/SyncDebugRecoveryPanel.js app/SyncDebugRecoveryPanel.css app/SettingsMenu.js tests/SyncDebugRecoveryPanel.orphans.test.js
git commit -m "feat(recovery): full-page Recovery card + picker for hidden collections"
```

---

## Task 7: Popup settings entry

**Files:**
- Modify: `app/SettingsMenu.js` (`popupBackupSection`, ~`app/SettingsMenu.js:410`)
- Test: `tests/SettingsMenu.orphans.test.js`

The popup entry is a button in `popupBackupSection`. Clicking it restores all recoverable collections (popup has no room for the full picker; "Choose what to restore" remains the full-page path). It only appears when `orphanRecovery.showEntry` is true.

- [ ] **Step 1: Write the failing test**

Create `tests/SettingsMenu.orphans.test.js`. Mirror the existing `SettingsMenu` test setup (copy the top mocks/imports from `tests/CollectionListOptions.test.js` or any test that renders `SettingsMenu`; if none exists, render `SettingsMenu` with the minimal props it requires). The assertion that matters:

```javascript
test('popup settings shows the recover-hidden entry and triggers recover', async () => {
    const recover = jest.fn().mockResolvedValue({ success: true, recovered: 1 });
    const orphanRecovery = { orphans: [{ uid: 'a' }], orphanCount: 1, showEntry: true, busy: false, recover, dismiss: jest.fn() };

    renderSettingsMenu({ variant: 'popup', orphanRecovery }); // helper from the copied setup

    // open the Backup & Restore section, then click the entry
    fireEvent.click(screen.getByRole('button', { name: /restore .*hidden|recover hidden/i }));
    expect(recover).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/SettingsMenu.orphans.test.js`
Expected: FAIL — the entry button is not rendered yet.

- [ ] **Step 3: Add the conditional entry to `popupBackupSection`**

In `app/SettingsMenu.js`, accept the prop where props are destructured/used (the component already reads `props`; reference `props.orphanRecovery`). Then add this item to the start of `popupBackupSection.items` array (`app/SettingsMenu.js:414`):

```javascript
            ...(props.orphanRecovery?.showEntry ? [{
                type: 'button',
                key: 'recover-hidden',
                title: 'Recover hidden collections',
                description: `${props.orphanRecovery.orphanCount} collections were hidden by an earlier update. Restore them to this device.`,
                onClick: () => props.orphanRecovery.recover(),
                content: `Restore ${props.orphanRecovery.orphanCount} hidden collections`,
            }] : []),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/SettingsMenu.orphans.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/SettingsMenu.js tests/SettingsMenu.orphans.test.js
git commit -m "feat(recovery): popup settings entry to restore hidden collections"
```

---

## Task 8: Full suite + production build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `yarn test`
Expected: all tests pass (including the 5 new test files).

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: no errors.

- [ ] **Step 3: Production build (required by CLAUDE.md)**

Run: `yarn prod`
Expected: build completes with no errors.

- [ ] **Step 4: Manual smoke test (load `build/` as unpacked extension)**

1. In a throwaway profile, open the service-worker console and seed an orphan:
   `chrome.storage.local.get('collections_index', r => { const i = r.collections_index||{}; chrome.storage.local.set({ collection_test_orphan: { uid:'test_orphan', name:'Orphan Smoke', tabs:[{url:'https://example.com'}], createdOn: Date.now() } }); });`
   (Leave `collections_index` without `test_orphan`.)
2. Reload the extension to trigger startup detection.
3. Confirm: the consent modal appears with "1 collection". Click **Restore all 1** → the collection appears; modal closes.
4. Re-seed, reload, click **Not now** → confirm the modal does not reappear on next open, but the entry shows in both popup **Backup & Restore** and full-page **Recovery**.
5. Use the full-page **Review & Restore** → confirm the collection returns.

- [ ] **Step 5: Final commit (if any build artifacts/config changed)**

```bash
git add -A
git commit -m "chore(recovery): verify build and full suite for orphan recovery"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** detection (Task 1), guarded additive recovery + dead-parent reroot + tombstone respect + batched write + rollback (Task 2), shared hook + persisted dismiss flag (Task 3), consent modal (Task 4), startup trigger after migration + modal render (Task 5), full-page card + picker (Task 6), popup entry (Task 7), build/smoke (Task 8). All spec sections map to a task.
- **App-specific names to confirm at implementation time:** App's collections-refresh function (the one wired to `SettingsMenu`'s `onDataUpdate`) — used as `reloadCollections` in Task 5 Step 3; and whether a helper to open settings on the Recovery section exists (Task 5 Step 4). Substitute the real names; the rest is exact.
- **Atomic writes:** recovery performs a single `set` (index + patched records) — consistent with the project rule against per-item parallel collection writes.
