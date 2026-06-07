# Migration Data-Safety Guarantee — Design

**Date:** 2026-06-07
**Issue:** [#102 — data lost](https://github.com/gilgold/tabox/issues/102)
**Status:** Approved framing, pending spec review

## Problem

On extension update, users lose data: favorite collections revert to a state from
several months prior, recent collections vanish, deleted collections reappear. Sync is
disabled for affected users, so this is purely a **local on-update migration** defect.

### Root cause

The legacy `tabsArray` is a **write-frozen snapshot**. Since the 4.0 indexed-storage
migration, the source of truth is per-collection `collection_<uid>` records +
`collections_index`. Normal writes (`saveSingleCollection`, `deleteSingleCollection`,
batch ops) **never update `tabsArray`** — and the old migration deliberately left it in
place "for safety" (`storageUtils.js:915`). So `tabsArray` stays frozen at the moment of
the last legacy migration.

On every update, `migrateLegacyStorage()` runs (`App.js:1132`). Even when storage
`version (3) >= CURRENT_STORAGE_VERSION (3)` and a valid index exists, it calls
`checkIfMigrationNeedsRepair(existingIndex, tabsArray)` (`storageUtils.js:769`). That
function returns `true` under common conditions:

- **`storageUtils.js:664`** — legacy collections-with-tabs count > current index count →
  fires whenever the user has net-**deleted** collections since the freeze.
- **`storageUtils.js:701–709`** — `legacyMissingMetadata`: frozen records lacking
  `order`/`lastOpened`/`lastUpdated` (typical for old data) → fires.
- **`storageUtils.js:737`** — any thrown error → returns `true` "to be safe".

When `needsRepair` is true, the code rebuilds `collections_index` **wholesale from the
stale `tabsArray`** (`storageUtils.js:808–913`), writing it as the entire index at
`storageUtils.js:909`. Consequences:

- Collections **deleted** since the freeze → **resurrected**.
- Collections **edited** since the freeze → **reverted**.
- Collections **created** after the freeze → dropped from the index (records orphaned,
  invisible in UI).

`tabsArray` is never cleared, so this re-triggers on subsequent updates ("happened
twice").

## Guiding principle (hard constraint)

> Migration must **never** make user data disappear or be altered. Even if migration
> fails, leave existing data exactly as-is. Migrations may only **augment** — apply
> specific, additive, non-breaking changes — never replace, rebuild, or overwrite from a
> less-trusted source.

The indexed `collection_<uid>` records are the **only** source of truth. `tabsArray` is
demoted to *never-authoritative*: it may contribute only collections whose uid is entirely
absent from the index (and not tombstoned). Nothing in migration may reduce or alter an
existing collection's data.

## Design — three layers

### Layer 1 — Additive-only `migrateLegacyStorage` repair

Remove the destructive rebuild path:

- Delete the count-based trigger (`storageUtils.js:664`) and the metadata-based trigger
  (`storageUtils.js:701–709`) from `checkIfMigrationNeedsRepair`. The remaining valid
  repair signals are kept but **redirected to in-place repair, not full rebuild**:
  - index entry exists but `collection_<uid>` record is missing/has no `tabs`
    (`storageUtils.js:676`),
  - missing metadata fields on indexed records / index entries / folders.
- Replace the wholesale rebuild (`storageUtils.js:808–913`) with **gap-fill merge**:
  1. **Add** a collection from `tabsArray` **only if** its uid is absent from
     `collections_index` **and** has no entry in deleted-collection tombstones
     (`loadDeletedCollectionTombstones`). This prevents resurrecting deleted collections.
  2. For uids **already present** in the index, never touch the live record or its index
     entry — the indexed record wins unconditionally.
  3. **Repair missing metadata in place** on indexed records (`order` ← existing
     positional order, `lastOpened` ← `null`, `lastUpdated` ← own `lastUpdated`/
     `createdOn`/now). Never source these from `tabsArray`.
- Folder normalization (`storageUtils.js:858–903`) follows the same rule: repair/augment
  in place, never overwrite an existing folder record from stale data, skip tombstoned
  folder uids (`loadDeletedFolderTombstones`).

First-time 4.0 migration (no index yet, `tabsArray` is the only data) is unchanged in
effect: with an empty index, every uid is "absent", so all collections are added — the
legacy import still works.

### Layer 2 — Coordinator step audit

`migrationCoordinator.executeMigration` steps already run inside
`atomicStorageTransaction` with a rollback chain and an `isDataSafe` gate. Audit each to
confirm it is field-additive and never drops records:

- `color_migration` — rewrites color fields only. Additive. ✓ (verify)
- `timestamp_migration` — adds `lastUpdated`/`lastOpened` only when missing. Additive. ✓
- `repair_deferred_urls` — rewrites `tab.url` field only, idempotent. Additive. ✓
- folder normalization within the above — must not drop folders.

Tighten any step found to replace rather than merge. Confirm step failure triggers
rollback that restores prior state (existing behavior — verify with a test).

### Layer 3 — `withDataSafetyGuard(label, fn)` global net

A wrapper applied to **both** `migrateLegacyStorage` and `executeMigration`:

1. **Snapshot** before: load full indexed collections (`loadMultipleCollections` over
   `loadCollectionsIndex`) and folders (`loadAllFolders`), plus the version markers the
   migration may change.
2. **Run** `fn`.
3. **Verify invariant** (below).
4. On invariant violation **or** thrown error: **restore** the snapshot (re-set the
   captured records/indices, remove `collection_`/`folder_` keys created during the failed
   run, leave version markers unchanged) and return `{ success: false, restored: true }`.
   Storage version is **not** advanced, but because data is restored and migration is
   gated to re-run, the additive Layer-1 logic means the next run is a safe no-op rather
   than a loss loop.

This reuses the existing `backupUtils` snapshot/rollback primitives where practical rather
than introducing a parallel mechanism.

### Invariant

Checked over the migration window (startup, no concurrent user edits):

- Every collection uid present **before** is present **after**, with
  `tabs.length` and `chromeGroups.length` **>= before**.
- Every folder uid present before is present after.
- Additions (new uids) and field transforms (colors, urls, timestamps) are allowed.
  Losses and per-record shrinkage are not.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `checkIfMigrationNeedsRepair` (rewritten) | Decide only whether *in-place* repair is needed; never signals rebuild | index, indexed records, tombstones |
| `migrateLegacyStorage` (rewritten repair) | Gap-fill missing collections/folders additively; repair metadata in place | tombstones, batch load/save helpers |
| `withDataSafetyGuard` (new) | Snapshot → run → verify invariant → restore on loss | `backupUtils`, batch load helpers |
| `verifyMigrationInvariant` (new) | Pure comparison of before/after snapshots | none (pure) |

## Testing

Reproduction-first (TDD), then fixes:

1. **Repro #102 (must fail before fix):** seed indexed store with collections where the
   user has deleted some and added others; seed a frozen `tabsArray` matching the
   months-old state; mark storage version == CURRENT; run the App update path. Assert no
   collection is lost, none resurrected, none reverted.
2. Net-deleted collections case (count trigger) — no resurrection.
3. Missing-metadata case — repaired in place, no rebuild, no revert.
4. New-collection-after-freeze case — survives, stays in index.
5. First-time 4.0 migration (empty index, only `tabsArray`) — still imports everything.
6. `withDataSafetyGuard`: inject a step that drops a collection → guard restores snapshot,
   returns failure, data intact, version not advanced.
7. Coordinator step failure → rollback restores prior state.
8. `verifyMigrationInvariant` unit tests: detects lost uid, shrunk tabs, lost folder;
   permits additions and field transforms.

## Out of scope (YAGNI)

- Retiring/clearing `tabsArray` (Approach C) — wider blast radius on sync/backup/export;
  deferred.
- Any sync-path changes — issue is local-only.
- UI changes beyond existing toasts.
