# Favorite Collections — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Branch:** feature/v4.1.3

## Overview

Add a "Favorites" feature: users can star any collection to pin it into a dedicated
Favorites section shown at the top of both the popup view and the full-page view.
A favorited collection appears in **both** the Favorites section and its normal
location (folder or root list). The star can be toggled off from anywhere the
collection is visible, including inside the Favorites section.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Duplication | Favorited collection appears in both Favorites and its normal location |
| Placement | Favorites is the topmost section, above folders, in both views |
| Ordering | Manual drag-and-drop order within the Favorites section |
| Empty state | Section always visible, with hint text "Star a collection to pin it here" |
| Cross-section drag | Not allowed in v1 — the star is the only way to favorite/unfavorite |

## Data Model

Two new fields on the collection object, mirroring the existing `parentId`/`order`
pattern (Approach A — chosen over a separate `favorites_index` storage key to avoid
new sync/merge/orphan-repair logic):

- `isFavorite: boolean` — default `false`; a missing field reads as not-favorite,
  so **no storage version bump or migration is needed**.
- `favoriteOrder: number` — sort position within the Favorites section. Only
  meaningful when `isFavorite` is true.

Both fields are persisted:
- In the full record (`collection_<uid>`) via the existing `saveSingleCollection`
  / `batchUpdateCollections` paths in `app/utils/storageUtils.js`.
- In the `collections_index` entry, so the Favorites section renders from the fast
  metadata index without loading full collection records.

Google Drive sync propagates both fields automatically (the sync layer uploads all
fields); no sync changes required.

Deleting a collection removes it from Favorites naturally — it is the same object.

## Star Toggle

A star icon button — `FaStar` (filled) when favorited, `FaRegStar` (outline)
otherwise, from react-icons, matching existing icon patterns — added to:

1. Popup list rows: `app/CollectionListItem.js`
2. Popup grid tiles: `app/CollectionTile.js`
3. Full-page cards: `app/fullpage/FPCollectionCard.js` via `FPCardHoverActions`
4. Context menu: "Add to Favorites" / "Remove from Favorites" entry in
   `app/utils/contextMenuItems.js`

Behavior — one shared toggle helper in `useCollectionOperations` so every surface
behaves identically:
- **Toggle on:** set `isFavorite: true`, `favoriteOrder = max(existing favoriteOrder) + 1`
  (appends to the end of the Favorites section).
- **Toggle off:** set `isFavorite: false` and clear `favoriteOrder`. Works from any
  surface, including rows rendered inside the Favorites section.

## Favorites Section

- **Popup** (`app/CollectionList.js`): a new `CollapsableSection` rendered above the
  Folders section. Reuses the existing row/tile components (`SortableCollectionItem`
  / `SortableCollectionTile`) so favorites get identical click-to-open and actions.
- **Full page** (`app/fullpage/fpCollectionSections.js`): a new section built before
  folders, rendering the same `FPCollectionCard` components.
- A collection appears twice in the DOM when favorited (Favorites + normal home);
  sortable item IDs in the Favorites section must be namespaced (e.g.
  `fav:<uid>`) to avoid dnd-kit/react key collisions with the main list.
- **Empty state:** section always visible; when no favorites exist, show hint text
  "Star a collection to pin it here".
- **Search:** the Favorites section is hidden while a search query is active —
  search results already include favorited collections, matching the existing
  behavior where the Folders section is also replaced by flat search results.
- A favorited collection inside a collapsed folder still shows in Favorites.

## Drag-and-Drop

- Within the Favorites section: dnd-kit sortable reordering, persisting
  `favoriteOrder` for affected collections through a single batch write
  (`batchUpdateCollections`-style helper — never per-item parallel writes, per the
  atomic index-write rule).
- Between sections: **disallowed**. Favorites items cannot be dropped into folders
  or the main list, and dropping a collection onto the Favorites section does not
  favorite it. The existing collision-detection logic in `CollectionList.js`
  remains untouched for cross-section cases.

## Edge Cases

- Duplicating a collection does **not** copy favorite status.
- Importing collections preserves `isFavorite`/`favoriteOrder` if present in the
  imported data; absent fields default to not-favorite.
- Collections with `isFavorite: true` but missing/duplicate `favoriteOrder` sort
  stably (fall back to `lastUpdated`), and the next reorder normalizes values.

## Testing

- **Storage:** fields persist to both index and full record; toggle helper sets and
  clears fields correctly; reorder writes via one batch update; deleted collection
  leaves no favorite remnants.
- **Rendering:** Favorites section renders favorited collections in `favoriteOrder`;
  empty state hint shows; star icon reflects state and toggles on click — covered
  for popup list and full-page card (following the `FPCollectionCard.test.js`
  pattern).
- **Verification:** `yarn test`, `yarn lint`, and `yarn prod` must pass before the
  work is considered complete.

## Out of Scope (v1)

- Dragging collections into/out of the Favorites section to toggle favorite status.
- A separate favorites-only view or keyboard shortcut.
- Favoriting folders.
