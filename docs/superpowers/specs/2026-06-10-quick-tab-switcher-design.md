# Quick Tab Switcher — Design

**Date:** 2026-06-10
**Branch:** feature/v4.1.3
**Status:** Implemented (see docs/superpowers/plans/2026-06-10-quick-tab-switcher.md)

## Overview

A fast, OS-Cmd+Tab-style command palette for jumping to any open tab. Available
in both the popup and the full-page view via `Ctrl/Cmd+Shift+S` or a dedicated
header button. The user types to filter all open tabs across all current
windows (including incognito), navigates with the keyboard, and hits Enter to
focus the tab (and its window). A thumbnail preview of the selected tab appears
beside/below the list when available.

## Goals

- Single shared implementation for popup and full page — zero duplicated code.
- Instant feel: open, type, arrow, Enter. No perceptible lag with 500+ tabs.
- Search matches title or URL, with matched substrings highlighted.
- Results show favicon, title, URL, and a window label; incognito tabs badged.
- Right-click on a result opens a live-tab context menu.
- Optional screenshot thumbnails behind a runtime-requested permission.

## Out of scope (deferred)

- **Injecting the switcher into arbitrary websites** (original requirement 13).
  Requires content scripts and a `chrome.commands` slot (all 4 suggested-key
  slots are taken by `open-collection-1..4`). The optional `<all_urls>`
  permission added for thumbnails deliberately paves the way; the switcher core
  is built portal-rendered and self-contained so it can be injected later.
- Reading Chrome's user-assigned window names — not exposed by any extension
  API (verified against current `chrome.windows` docs). We derive labels
  instead (see Window labels).

## Entry points

1. **Keyboard:** `Ctrl/Cmd+Shift+S` keydown listener in `App.js`, registered
   alongside the existing Cmd+K palette listener, active in both view contexts.
   Pressing it while open closes the switcher (toggle).
2. **Header button:** new shared `TabSwitcherButton` component rendered in both
   `Header.js` (popup) and `fullpage/FPTopBar.js`. Icon button with tooltip
   showing the shortcut.
3. Both set a new Jotai atom `tabSwitcherOpenState`
   (`app/atoms/tabSwitcherState.js`).

No `chrome.manifest` `commands` entry — the shortcut only needs to work inside
extension pages.

## Architecture

### New modules

| File | Purpose |
|---|---|
| `app/TabSwitcher.js` + `.css` | The switcher modal. Portal-rendered into `document.body`, mounted once in `App.js` so popup and full page share it. |
| `app/TabSwitcherButton.js` | Shared header trigger button. |
| `app/atoms/tabSwitcherState.js` | `tabSwitcherOpenState` atom. |
| `app/utils/tabSwitcherUtils.js` | Pure functions: flatten windows→tab entries, MRU sort, search/score, window labels. Unit-tested. |
| `app/useListNavigation.js` | Arrow/Enter/Escape/Home/End + hover-follows-selection list navigation hook; used by TabSwitcher (CommandPalette may adopt it later, not required in this change). Lives flat in `app/` per codebase convention. |
| `chrome/thumbnail-capture.js` | Background-side thumbnail capture pipeline (loaded by `background.js` via `importScripts`, like the sync modules). |

(Planning note: match highlighting needs no extraction — `highlightText` in
`app/utils/searchUtils.js` is already shared and parameterized by class name;
TabSwitcher reuses it directly.)

### Shared-code rules

- `TabSwitcher` renders identically in both contexts; only sizing differs via
  CSS (`viewContextState` drives a `popup`/`fullpage` class on the root).
- The favicon fallback constant currently inlined in `TabRow.js` is extracted
  to a shared module and reused.
- The right-click menu reuses the existing generic `app/ContextMenu.js`.

## Data

On open (and not before), the switcher calls
`browser.windows.getAll({ populate: true, windowTypes: ['normal'] })` and
flattens to entries:

```js
{ tabId, windowId, title, url, favIconUrl, lastAccessed,
  active, pinned, muted, incognito, windowLabel }
```

- Incognito windows are included automatically when the user has enabled the
  extension in incognito (`"incognito": "spanning"` already set).
- The list is sorted by `lastAccessed` descending (MRU).
- **Initial selection:** row 1 (the second item) when row 0 is the active tab
  of the current window — mirrors Cmd+Tab "previous tab" behavior. Otherwise
  row 0.
- The list does not live-update while open; if an action targets a tab that no
  longer exists, the row is removed and an unobtrusive refresh of the list
  occurs.

### Window labels

Windows are numbered in `getAll()` order: "Window 1", "Window 2", …
The window the switcher was opened from is labeled "This window". Incognito
windows append an incognito badge (icon + "Incognito"). Rendered as a small
muted badge on the right of each row.

## Search

- Case-insensitive substring match against title and URL.
- Score: title-prefix (highest) > title-contains > URL-contains; ties broken by
  recency (`lastAccessed`).
- Matched ranges computed in `tabSwitcherUtils` and rendered via
  `HighlightedText` for both the title and URL lines.
- Filtering is a `useMemo` over the in-memory entry list. Rendered results are
  capped at 50 (with a "N more — keep typing" footer when truncated); the full
  list is still searched.
- Empty query shows the full MRU list (capped at 50 rendered).

## Interaction

- **Keyboard:** ArrowUp/ArrowDown move selection (wrapping), Home/End jump,
  Enter activates, Escape closes. Typing always goes to the search input
  (input keeps focus; navigation keys are intercepted).
- **Mouse:** hover moves selection; click activates; right-click opens the
  context menu for that row.
- **Activate** = `browser.tabs.update(tabId, { active: true })` then
  `browser.windows.update(windowId, { focused: true })`, then close the
  switcher. (In the popup, focusing another window closes the popup — expected.)
- **Context menu items** (via `ContextMenu.js`): Switch to tab, Copy URL,
  Pin/Unpin, Mute/Unmute, Close tab, Move to new window. Pin/Mute/Close update
  the row (or remove it) in place without closing the switcher.

## Thumbnail previews

> **Update (2026-06-11): screenshot thumbnails were removed after shipping.**
> `captureVisibleTab` can only photograph visible tabs, so coverage was too
> sparse to justify the optional `<all_urls>` permission — most rows showed
> the fallback anyway. The capture pipeline (`chrome/thumbnail-capture.js`),
> the `optional_host_permissions` manifest entry, and the permission-request
> flow were all removed; the preview pane now always renders the details card
> (favicon, title, URL, window label). The section below is kept for history.

### UX

- The list stays compact — no inline thumbnails.
- A preview pane shows **only the selected row's** preview, debounced ~150ms
  after selection settles so rapid arrowing never stutters.
- Full page: preview docks as a side panel right of the list. Popup: docks
  below the list. Pane has a fixed size; no layout shift while arrowing.
- Preview content: cached screenshot when available; otherwise a fallback card
  (large favicon, full title, URL, window label).

### Capture pipeline (background)

- `chrome/thumbnail-capture.js`. Listeners are attached synchronously at
  service-worker startup (MV3 only wakes the worker for synchronously
  registered listeners); each capture first checks
  `browser.permissions.contains({ origins: ['<all_urls>'] })` and no-ops
  cheaply when not granted.
- Captures the visible tab on `tabs.onActivated`, `tabs.onUpdated`
  (status `complete` on the active tab), and `windows.onFocusChanged`,
  debounced ≥600ms per tab to stay under `captureVisibleTab`'s
  2-calls-per-second quota.
- Image downscaled to ~320px-wide JPEG (quality ~0.7) via `OffscreenCanvas`
  in the service worker.
- Stored in `chrome.storage.session` (in-memory only — never persisted to
  disk, which also keeps incognito captures off disk), keyed
  `thumb_<tabId>`, with an LRU index capped at 100 entries.
  Entries are pruned on `tabs.onRemoved`.
- `captureVisibleTab` cannot capture background tabs, so tabs not activated
  since the browser session started simply have no thumbnail → fallback card.

### Permission flow

- `manifest.json` gains `"optional_host_permissions": ["<all_urls>"]` — no
  install-time warning; nothing changes for users who don't opt in.
- When the permission is not granted, the preview pane shows the fallback card
  plus an "Enable tab previews" button. Clicking it calls
  `browser.permissions.request({ origins: ['<all_urls>'] })` (valid user
  gesture in an extension page). On grant, the background immediately captures
  the active tab of each window so previews appear right away.
- Declining leaves the fallback-card experience; the button remains available.

## Styling

`TabSwitcher.css`, themed via the app's existing CSS variables (light/dark).
Centered panel over a dimmed backdrop, search input on top, favicon-led rows
(~40px), window badge right-aligned. Popup context: near-full-width panel,
preview below. Full page: ~640px panel + side preview. Subtle open transition
(opacity/scale, ~120ms) — no entry animation on rows for speed.

## Edge cases

- **Zero results:** "No matching tabs" empty state.
- **Activating the current tab:** just closes the switcher.
- **Tab closed externally while open:** action fails gracefully → row removed,
  list refreshed.
- **Stale thumbnails:** shown as-is; recaptured next time the tab is active.
- **Permission revoked at runtime:** the thumbnail cache is cleared; capture
  listeners stay attached but no-op (per-capture permission check).
- **chrome:// / Web Store pages:** capture fails silently (no host access even
  with `<all_urls>`); fallback card covers them.

## Testing

### Unit (Jest)

- `tabSwitcherUtils`: flattening, MRU sort, scoring order, match-range
  computation (title vs URL, case-insensitivity), window labels, result cap.
- `HighlightedText`: renders highlight spans for given ranges (also covers the
  CommandPalette regression after extraction).

### E2E (crxbox, `e2e/tab-switcher.spec.mjs`)

- `Ctrl+Shift+S` opens the switcher in the popup; again in the full page.
- Header button opens it in both views.
- Typing filters the list; highlight spans present on matched text.
- ArrowDown + Enter focuses the target tab/window (asserted via
  `ext.background` `tabs.query` for the active tab).
- Click on a row switches tabs.
- Right-click opens the context menu; Copy URL and Close tab verified.
- Escape closes; empty query shows MRU order with the previous tab preselected.
- Preview pane shows the fallback card and the "Enable tab previews" button
  when permission is not granted.
- The native permission dialog cannot be driven by Playwright, so the
  grant-and-capture path is covered by unit tests around
  `thumbnailCapture.js`'s handlers (mocked `browser.*`), not e2e.

### Modified files (summary)

`app/App.js` (mount + shortcut), `app/Header.js`, `app/fullpage/FPTopBar.js`
(button), `chrome/background.js` (load capture module, `captureAllWindows`
message), `chrome/manifest.json` (`optional_host_permissions`).
CommandPalette and TabRow stay untouched — highlighting is already shared via
`searchUtils.highlightText`, and the favicon fallback constant is exported
from `tabSwitcherUtils`.
