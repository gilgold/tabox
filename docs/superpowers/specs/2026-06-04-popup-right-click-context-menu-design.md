# Popup right-click context menus

## Goal

In the popup view, right-clicking a collection tile or a folder header opens the
**same** `ContextMenu` that the existing `...` button opens — identical items,
identical styling, no duplicated menu definitions.

Tabs (`TabRow`) already support right-click in the popup and have no `...` menu
to share, so they are out of scope for this change.

## Approach

Teach the shared `ContextMenu` component (`app/ContextMenu.js`) to optionally
open from a right-click on a host element, positioned at the cursor. The host
passes a ref to the element that should respond to right-click. This keeps a
single menu definition and a single rendering path; the `...` button continues
to work unchanged.

## Changes

### `app/ContextMenu.js`

- New optional prop `triggerRef` — a ref to the element that should respond to
  right-click.
- New state `cursorPosition` (`{x, y} | null`).
- Effect: when `triggerRef.current` exists, attach a `contextmenu` listener that
  - calls `preventDefault` + `stopPropagation`,
  - clamps `{x, y}` to the viewport using an estimated menu size (same
    estimate-and-clamp approach `TabRow` already uses),
  - stores `cursorPosition`,
  - sets the global `activeMenuId` to this menu's id (opens it; closes any other
    open menu via the shared `activeContextMenuState` atom).
- Portal positioning: when `cursorPosition` is set, render with
  `position: fixed; top: y; left: x`. Otherwise keep the existing
  button-relative `{ top, right }` behavior.
- Reset `cursorPosition` to `null` whenever the menu closes, so a later `...`
  click anchors to the button again.
- Skip the button-relative "refine height / cutoff" effect while in cursor mode
  (clamping happens at open time instead).

### `app/CollectionTile.js`

- Create a ref, attach it to the `.collection-tile` root div, and pass it as
  `triggerRef` to the existing `ContextMenu`. Menu items unchanged.

### `app/FolderContainer.js`

- Create a ref, attach it to the `.folder-header` div, and pass it as
  `triggerRef` to the existing folder `ContextMenu`. Items unchanged.
- A collection nested inside a folder opens the collection menu (its own
  listener calls `stopPropagation`); the folder listener is scoped to the header
  element only (collections live in the sibling `DroppableFolderContent`), so the
  two do not collide.

## Edge cases

- **dnd-kit**: right-click is button 2 and does not start a drag; `preventDefault`
  suppresses the native browser menu (same as `TabRow` today).
- **One menu at a time**: reuses the existing `activeContextMenuState` atom.
- **Viewport clamping**: cursor coordinates clamped so the menu never overflows.

## Testing

- `ContextMenu`: with a `triggerRef`, firing a `contextmenu` event opens the menu
  at the cursor and closes on outside click / Escape; without `triggerRef`,
  behavior is unchanged.
- Light wiring assertions in `CollectionTile` / `FolderContainer` tests where
  practical.
