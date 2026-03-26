---
title: "Fix: Full Page Drag-Drop Reorder Overridden by Sort"
type: fix
status: active
date: 2026-03-10
---

# Fix: Full Page Drag-Drop Reorder Overridden by Sort

## Overview

Drag-and-drop reordering of collections in the full page view silently fails — the collection snaps back to its pre-drag position. The root cause is that sorting logic re-sorts the list on every render, overriding the manual position change because the in-memory collection objects never receive the updated `order` values written to storage.

## Problem Statement

Two interacting bugs in `app/fullpage/FPContentArea.js`:

### Bug A — Stale `order` in state after drag

`handleDragEnd` (line 541–552) calls `updateCollectionsOrder(reordered)` which writes `order: 0, 1, 2…` to **storage only**. The `reordered` array objects still carry their old `order: null` values. These stale objects are passed to `updateRemoteData`, which sets them as React state.

### Bug B — All-or-nothing order gate

`flatSortCollections` (line 271–288) checks `list.every(c => c.order !== undefined && c.order !== null)`. Because the in-memory objects have `order: null` (Bug A), this check fails, and the function **re-sorts by the active sort type** (DATE/NAME/COLOR) — completely undoing the drag.

### Why the popup doesn't have this bug

The popup's `CollectionList.js` doesn't use `flatSortCollections`. After drag-drop, the array order passed to `updateRemoteData` directly determines display order. The sort-based reordering only happens at the storage layer on explicit sort actions, not on every render.

## Proposed Solution

### Fix 1 — Stamp `order` on in-memory objects before state update

In `FPContentArea.js` `handleDragEnd`, after `arrayMove` and `updateCollectionsOrder`, assign `order` values to the reordered collection objects before passing them to `updateRemoteData`:

```javascript
// app/fullpage/FPContentArea.js — handleDragEnd, ~line 541
if (oldIndex !== -1 && newIndex !== -1) {
    const reordered = arrayMove(filteredCollections, oldIndex, newIndex);
    await updateCollectionsOrder(reordered);

    // Stamp order on in-memory objects so flatSortCollections
    // sees allHaveOrder=true and preserves manual order
    const reorderedWithOrder = reordered.map((c, i) => ({ ...c, order: i }));
    const reorderedUids = new Set(reorderedWithOrder.map(c => c.uid));
    const otherCollections = collections.filter(c => !reorderedUids.has(c.uid))
        .map((c, i) => ({ ...c, order: reorderedWithOrder.length + i }));
    updateRemoteData([...reorderedWithOrder, ...otherCollections]);
}
```

Key details:
- `reorderedWithOrder`: the visible/reordered collections get `order: 0, 1, 2…`
- `otherCollections` (collections outside the current filtered view) also get sequential `order` values starting after the reordered set, ensuring **all** collections have `order` and `flatSortCollections` returns the list as-is.

### Fix 2 — Also handle folder-view and unorganized-view drag order

When `sidebarNavigation` is a folder UID or `'unorganized'`, the same `handleDragEnd` runs against the filtered subset. The fix from Fix 1 applies identically — stamp `order` on the subset, then assign continuation order to the rest.

### Fix 3 — Clear sort indicator after manual drag

When the user manually reorders via drag, the active sort type (DATE/NAME/COLOR shown in the UI) becomes misleading since the list is now in custom order. After a successful drag reorder, reset the sort state to indicate custom/manual ordering, or at minimum ensure the sort indicator doesn't imply a sort that's no longer accurate.

This is optional/cosmetic and can be deferred.

## Acceptance Criteria

- [ ] **Immediate visual reorder**: After drag-drop in "all" view, the collection stays at its new position without snapping back
- [ ] **Persistence across refresh**: After drag-drop, closing and reopening the full page view preserves the new order
- [ ] **Sort → drag → sort cycle**: Applying a sort, then dragging to reorder, then applying another sort — each action produces the expected result
- [ ] **Folder-filtered view**: Drag-drop reordering works when viewing collections within a specific folder
- [ ] **Unorganized view**: Drag-drop reordering works in the "No Folder" view
- [ ] **Mixed state resilience**: Collections with pre-existing `order: null` (from a prior sort) don't cause the fix to break
- [ ] **No regression in popup**: Popup drag-drop reordering continues to work correctly
- [ ] **`yarn prod` passes**: Build succeeds after changes

## Technical Considerations

### Files to modify

| File | Change |
|------|--------|
| `app/fullpage/FPContentArea.js` | `handleDragEnd` — stamp `order` on reordered + other collections before `updateRemoteData` |

### Files to verify (no changes expected)

| File | Why |
|------|-----|
| `app/CollectionList.js` | Popup drag-drop — confirm no regression |
| `app/utils/storageUtils.js` | `updateCollectionsOrder` and `loadAllCollections` — confirm storage layer is correct |
| `app/App.js` | `updateRemoteData` flow — no changes needed |

### Edge cases

- **Drag to same position**: `oldIndex === newIndex` → early return already handles this (line 533)
- **Rapid successive drags**: `updateCollectionsOrder` is async; a fast second drag before the first completes could race. Low risk since the UI blocks interaction during drag animation.
- **Search active**: Drag is disabled during search (`setDisableDrag` pattern) — no interaction
- **`updateCollectionsOrder` failure**: Currently unhandled. If it throws, `updateRemoteData` still runs with stale data. Consider wrapping in try/catch with a toast error. (Low priority — separate issue)

### Out of scope

- Google Drive sync conflict resolution for `order` field (existing behavior unchanged)
- Adding unit tests for `flatSortCollections` (recommended as follow-up)
- Sort indicator reset after manual drag (cosmetic, deferrable)

## References

- `app/fullpage/FPContentArea.js:271-288` — `flatSortCollections` (the all-or-nothing gate)
- `app/fullpage/FPContentArea.js:541-552` — `handleDragEnd` (the stale-order bug)
- `app/fullpage/FPContentArea.js:460-470` — `handleSort` (clears `order` on all collections)
- `app/utils/storageUtils.js:903-939` — `updateCollectionsOrder` (writes order to storage)
- `app/utils/storageUtils.js:482-518` — `loadAllCollections` sort logic (order vs sortBy)
- `app/CollectionList.js:882-901` — Popup drag-drop (working reference implementation)
- `app/App.js:486-500` — `updateRemoteData` (batchUpdate + setState)
