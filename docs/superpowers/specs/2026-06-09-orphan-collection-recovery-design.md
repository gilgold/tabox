# Orphaned-Collection Recovery — Design Spec

- **Date:** 2026-06-09
- **Branch:** feature/v4.1.2
- **Status:** Approved for planning
- **Related:** #102 (additive-only migration). This is the *recovery* counterpart — #102 stops the loss going forward; this brings back data already lost.

## Background / Problem

The pre-#102 `migrateLegacyStorage` rebuilt `collections_index` from the frozen legacy
`tabsArray` mirror whenever its repair heuristic fired (or on any thrown error). For users
whose `tabsArray` had gone stale (it freezes when they migrate to indexed storage), this
**dropped every collection created after the freeze from the index** — reverting them to an
old snapshot.

Crucially, the destructive code **only rewrote the index; it never deleted the
`collection_<uid>` records**. So the lost collections almost always still exist physically in
`browser.storage.local` as **orphans** — records with no `collections_index` entry pointing
at them, therefore invisible to the UI and to exports.

Confirmed against a real affected user's data: 51 collections ending exactly at a Dec-2025
boundary plus a single post-update collection, ~6 months missing — matching a revert to the
frozen mirror, not a deletion.

### What #102 (4.1.2) does NOT do
The additive migration only re-adds collections present in `tabsArray`. The lost collections
were created *after* `tabsArray` froze, so they are not in it and are **not** auto-recovered.
No existing code path scans all `collection_<uid>` keys to re-link orphans. Updating to 4.1.2
therefore does **not** bring these collections back. This spec closes that gap.

## Goals

- Detect recoverable orphaned collections (records present in storage, absent from the index,
  not tombstoned).
- Let the user restore them with **consent first** (per product decision: a modal that asks
  before changing anything).
- Provide a "do it later" entry point in **both** popup and full-page settings.
- Be provably safe: additive only, never overwrite/resurrect-deleted/reduce data.

## Non-Goals (v1)

- **Folders.** Orphaned *folder* records are out of scope. A recovered collection whose
  `parentId` references a missing folder is reattached to root (null). Folder recovery is a
  possible follow-up.
- **Auto-restore.** No silent reattachment; recovery only happens on explicit user consent.
- **No new background-message API.** Recovery runs in the app/popup context, where migration
  tooling and the data-safety guard already live.

## Architecture

Recovery runs in the **app/popup context** (not the service worker), because the migration
coordinator, `withDataSafetyGuard`, tombstone helpers, and batch storage helpers all run
there. One new isolated module exposes the logic; all UI surfaces call it through a single
shared hook so popup and full-page behave identically.

```
app/utils/orphanRecovery.js      detectRecoverableCollections(), recoverOrphanedCollections()
app/hooks/useOrphanRecovery.js   shared state hook: detect on mount, expose {orphans, recover, dismiss}
app/OrphanRecoveryModal.js       consent-first modal (renders in whichever surface mounts first)
SyncDebugRecoveryPanel.js        + orphan card at top of recovery view (full-page)
SettingsMenu.js                  + orphan entry in popupBackupSection (popup)
```

## Components

### `detectRecoverableCollections()` — read-only
1. `const all = await browser.storage.local.get(null)`.
2. Read `collections_index` and `deleted_collection_tombstones`.
3. For each key starting with `STORAGE_KEYS.COLLECTION_PREFIX`, derive `uid` and include it
   when **all** hold:
   - `uid` is **not** a key in `collections_index` (otherwise already visible),
   - `uid` is **not** in `deleted_collection_tombstones` (user deleted it deliberately),
   - the record is a valid object with an array `tabs` field (skip junk/partial writes).
4. Return previews `{ uid, name, tabCount, createdOn, lastUpdated, parentId, color }`, sorted
   by `createdOn` descending.
5. Never writes. On any error: log and return `[]` (recovery simply doesn't surface).

### `recoverOrphanedCollections(uids)` — additive write, guarded
Wrapped in `withDataSafetyGuard('orphan-recovery', fn)`:
1. Take a pre-recovery backup (so it appears in the Recovery backup list as a safety net).
2. Load current `collections_index`, `deleted_collection_tombstones`, `folders_index`.
3. For each requested `uid`:
   - Skip if already in the index (idempotent) or tombstoned.
   - Load `collection_<uid>`; skip if the record is missing.
   - Repair missing metadata in place (`order`, `lastUpdated`, `lastOpened`) the same way the
     additive migration does.
   - If `parentId` is set but not present in `folders_index`, reset it to `null` (root).
   - Stage the (possibly patched) record and a new index entry.
4. Write **once**: a single batched `set` of the updated index plus any patched records (per
   the atomic-write guidance — no per-item parallel writes).
5. Return `{ recovered: <count>, uids: <recovered uids> }`.

The data-safety guard snapshots before the write and restores on any throw or invariant
violation. Because recovery only *adds* index entries (it never removes records), the
"no records lost" invariant holds trivially; the guard's role here is to roll back a partial
or failed write.

### `useOrphanRecovery()` hook + state
- On mount (in App), **after** the migration coordinator has finished, call
  `detectRecoverableCollections()` and hold the result in state.
- The only persisted state is the boolean `orphanRecoveryModalDismissed` in `storage.local`
  (shared across popup and full-page).
- Derived:
  - **show modal** = `orphans.length > 0 && !dismissed`
  - **show settings entry** = `orphans.length > 0`
- `recover(uids)` calls `recoverOrphanedCollections`, then refreshes the collection list and
  re-runs detection (recovered uids are now in the index, so they drop out → surfaces hide).
- `dismiss()` sets the persisted flag so the modal never auto-pops again; settings entries
  remain.

### Detection trigger / ordering
Detection must run **after** the migration coordinator completes on app startup, so the
migration's own additive `tabsArray` re-adds are already applied and not double-counted.

## UI Surfaces (three)

1. **Consent modal (`OrphanRecoveryModal.js`)** — shown once when `show modal` is true, in
   whichever surface (popup or full-page) the user opens first; responsive to popup width.
   - Copy: *"We found N collections that an earlier update accidentally hid. They're safe on
     your device — want them back?"*
   - **Restore all N** (primary) → runs `recover(allUids)` immediately, success toast, list
     refresh.
   - **Choose what to restore** (secondary) → opens the selection picker.
   - **Not now** (tertiary) → `dismiss()`.

2. **Full-page Recovery section** — a highlighted card at the top of
   `SyncDebugRecoveryPanel`'s recovery view when orphans exist:
   *"Hidden collections found — N recoverable · Review & Restore."* Opens the selection picker
   (reusing the existing `BackupRestorePickerModal` pattern). Disappears after recovery.

3. **Popup settings** — a matching entry added to `popupBackupSection` in `SettingsMenu.js`:
   *"Hidden collections found — N recoverable · Restore."* Opens the same picker, sized for the
   popup.

All three invoke the same `useOrphanRecovery` hook → identical behavior across surfaces.

## "Restore all" vs picker
- **Restore all** runs immediately (fastest path for the common "just give me my data back").
- **Choose what to restore** is the deliberate review path via the picker.
- Same in modal, full-page card, and popup entry.

## Error Handling
- Recovery failure: guard restores prior state; UI shows an error toast; the settings entry
  stays available to retry.
- Detection failure: swallowed and logged; no modal/entry; never blocks startup.

## Testing

Unit — `detectRecoverableCollections`:
- finds records absent from index; excludes in-index uids; excludes tombstoned uids; excludes
  malformed records; returns sorted previews.

Unit — `recoverOrphanedCollections`:
- additively adds orphans to the index without touching existing collections;
- idempotent (re-running a recovered uid is a no-op);
- dead `parentId` → root;
- tombstoned uid is never resurrected;
- performs a single batched write (assert one `set` for index + records);
- data-safety guard rolls back on an injected write failure.

Component:
- modal shows only when `orphans>0 && !dismissed`; "Not now" sets the shared flag; "Restore
  all" calls `recover`;
- full-page Recovery card visibility and restore;
- popup settings entry visibility and restore;
- dismissing in one surface suppresses the modal in the other (shared flag).

## Open questions
None outstanding. Folder recovery deferred to a possible follow-up.
