# Smart Organize — Design Spec

**Date:** 2026-06-13
**Status:** Approved (pending spec review)
**Feature:** The flagship Tabox AI tool. Groups all ungrouped tabs in a live browser window into Chrome tab groups by context, adds fitting tabs into existing groups, applies immediately, and offers a persistent undo plus save-as-collection.

---

## 1. Goal & guiding principles

Give the user a one-click "tidy my window" action: every eligible tab ends up in a sensibly-named Chrome tab group. Because this visibly rearranges the user's live window, the design is built around **trust**:

- **Minimal, predictable mutation.** Smart Organize only ever touches **ungrouped** tabs. It never reshuffles tabs that are already in a group, and never renames or recolors existing groups. This makes the change easy to reason about — and makes undo bulletproof.
- **Persistent undo.** Not just the temporary toast. A snapshot persists in `chrome.storage.local` (survives popup close), surfaced as a constant "Undo Smart Organize" chip beside the AI button until the user acts or the window closes.
- **Progressive enhancement.** Gated behind Tabox AI being enabled and the on-device model being available (same pre-flight as the rename tools).

## 2. Scope

**In scope (v1):**
- Operate on a **single** window.
  - **Popup:** the window the popup is attached to (unambiguous — no picker).
  - **Full-page:** a window picker (reuses the existing "Current Windows" snapshot data); user chooses which window to organize.
- Read that window's **ungrouped** tabs and **existing** tab groups.
- One holistic AI call → a grouping plan (new groups + additions to existing groups).
- Apply immediately via the background service worker (survives popup close).
- Persistent undo + save-as-collection + close.

**Out of scope (YAGNI):**
- Multi-window organize in a single run.
- Reordering/merging/renaming **existing** groups.
- Preview-then-apply or per-group accept/reject (decision: apply directly + undo).
- Scheduled/background-triggered runs.
- Semantic search or embeddings.

## 3. Eligibility rules

A tab is **eligible** to be grouped if it is: not pinned, not the Tabox full-page tab, and currently **ungrouped** (`groupId === -1`). Already-grouped tabs are never moved. Pinned tabs are never touched.

The result goal — "all tabs in groups" — applies to **eligible** tabs. Tabs the AI can't cluster meaningfully are placed in a catch-all group named **"Other"** so the end state has no leftover ungrouped (eligible) tabs.

## 4. AI engine: `app/ai/tasks/smartOrganizeTabs.js`

A single holistic inference (not sequential per-item — this is one clustering decision over the whole window).

**Input** (built by the caller from the live window read):
- `ungroupedTabs`: `[{ index, title, domain }]` — `index` is a 1-based position used only to reference tabs in the prompt; caller maps it back to the real Chrome `tabId`. Capped at `MAX_TABS = 50`; any remainder is left ungrouped and reported.
- `existingGroups`: `[{ id, title, sampleTitles }]` — `id` is the real Chrome group id; `sampleTitles` is a few member tab titles for context.

**Prompt:** asks the model to cluster the ungrouped tabs by topic/context, optionally assigning some to an existing group when they clearly belong, and to place anything that fits nothing into a group named "Other". Titles are truncated per-tab to keep within Nano's context budget.

**Structured output** (`responseConstraint` JSON schema):
```
{
  groups: [
    {
      name: string (maxLength 40),          // used for NEW groups; ignored for additions
      color: enum[grey,blue,red,yellow,green,pink,purple,cyan,orange],
      existingGroupId: integer | null,      // null = create a new group; set = add to that existing group
      tabIndexes: integer[]                 // references into ungroupedTabs
    }
  ]
}
```

**Engine responsibilities:**
- Build the prompt; call `promptForJSON` (with the language options already in `aiClient`).
- Validate: drop unknown `tabIndexes`; clamp `color` to the enum (fallback: round-robin from the palette avoiding collision with existing group colors); ignore `existingGroupId` values not present in `existingGroups`.
- Map `tabIndexes` → real `tabId`s.
- Return a normalized **plan**:
  ```
  {
    newGroups:  [{ name, color, tabIds[] }],
    additions:  [{ groupId, tabIds[] }],
    skippedTabIds: number[]   // eligible tabs beyond the cap or unplaced by the model
  }
  ```
  (If the model leaves eligible tabs unplaced, the engine collects them into the "Other" new group so the end state is fully grouped.)

Supports `AbortSignal` for cancel, consistent with the other AI tasks.

## 5. Apply & undo (background service worker)

Apply and undo run in `chrome/background.js` so they complete even if the popup closes. The popup/full-page computes the plan, then sends it to the background.

**Message: `smartOrganizeApply`** — payload `{ windowId, plan }`:
1. **Snapshot for undo** (before any mutation): read the target window's tabs; record
   ```
   {
     windowId,
     createdAt,                 // Date.now() timestamp, for the undo-chip label
     orderedTabIds: number[],   // every tab id in current order (for order restore)
     affectedTabIds: number[]   // the tabs this run will group (newGroups + additions)
   }
   ```
   Persist under storage key `smartOrganizeUndo` (single latest snapshot; a new run overwrites). Include a small `summary` for UI ({ windowId, groupsCreated, tabsAdded, createdAt }).
2. **Apply additions:** for each `{ groupId, tabIds }`, `browser.tabs.group({ groupId, tabIds })` (skips tab ids that no longer exist).
3. **Apply new groups:** for each `{ name, color, tabIds }`, `browser.tabs.group({ createProperties: { windowId }, tabIds })` then `browser.tabGroups.update(groupId, { title: name, color })`.
4. Return `{ success, groupsCreated, tabsAdded, skipped }`.

**Message: `smartOrganizeUndo`** — payload `{ windowId }` (or none → use the stored snapshot):
1. Load the snapshot. If missing or its window no longer exists → return `{ success: false, reason: 'expired' }` and clear the key.
2. `browser.tabs.ungroup(affectedTabIds)` (skip missing). Newly-created groups become empty and Chrome removes them; existing groups simply lose the added tabs.
3. Restore order: from `orderedTabIds`, move surviving tabs back to their original relative order via `browser.tabs.move`. Best-effort; tabs closed since are skipped.
4. Clear the `smartOrganizeUndo` key. Return `{ success: true }`.

**Snapshot lifecycle / clearing:** the snapshot is cleared when undo runs, the user dismisses it, the target window is closed (checked on read), or a new run supersedes it. No time-based expiry — the user asked for a *constant* undo.

## 6. Persistent undo surface

- **Immediate:** the standard undo toast right after applying (`showUndoToast`, calls the `smartOrganizeUndo` message).
- **Constant:** a small **"Undo Smart Organize" chip** rendered beside the AI button in both toolbars whenever a `smartOrganizeUndo` snapshot exists for an open window. Clicking it runs undo; an `×` dismisses (clears the snapshot without undoing). Driven by a hook/atom reading the storage key with a `storage.onChanged` listener (same live-update pattern as `useTaboxAIEnabled`).
- **In-modal:** the Smart Organize panel's done/idle state also shows the undo when a snapshot exists.

## 7. Modal: flagship presentation & panel flow

- **Registry:** `AI_TOOLS` entry for `smart-organize` gains `featured: true`. `AIToolsModal` renders featured tools as a **hero card** at the top (distinct gradient border + "Flagship" badge), above the regular tool-card grid.
- **Panel state machine:** `idle → running → done` (mirrors the bulk-rename panel's structure and busy-lockout):
  - **idle:**
    - Popup: "Organize N ungrouped tabs in this window" + run button (disabled with a hint when N === 0: "Everything here is already grouped.").
    - Full-page: a **window picker** (list from the current-windows snapshot, each showing window title/tab count + ungrouped count) → then the same run affordance for the chosen window.
    - If a `smartOrganizeUndo` snapshot exists, show the "Undo last organize" affordance here too.
  - **running:** single AI call; progress/“Organizing…” indicator; cancel (AbortSignal); modal close locked while running (same pattern as bulk rename).
  - **done:** summary ("Created 4 groups · added 6 tabs to existing groups · 2 left over") + three actions: **Save as collection** (capture the now-organized window via `getCurrentTabsAndGroups`/window read → `buildCollectionFromSnapshot` → `addCollection`, success toast), **Undo**, **Close**.
- Smart Organize does **not** use the `aiToolsScopeState` (all/selected) atom — it targets a live window, not saved collections.

## 8. Files

**New:**
- `app/ai/tasks/smartOrganizeTabs.js` — engine.
- `app/ai/tasks/readWindowStructure.js` (or a small helper in an existing util) — read a given windowId's `{ ungroupedTabs, existingGroups, allTabs }` for the prompt and for the picker; built on `browser.tabs.query`/`browser.tabGroups.query`. (May extend `app/utils/currentWindows.js` instead — follow existing patterns.)

**Modified:**
- `app/ai/aiTasks.js` — registry entry with `featured: true`.
- `app/AIToolsModal.js` / `.css` — hero card rendering + the Smart Organize panel.
- `chrome/background.js` (+ `chrome/background-utils.js` if helpers fit there) — `smartOrganizeApply` / `smartOrganizeUndo` handlers + snapshot read/write.
- `app/atoms/aiState.js` — undo-state hook/atom (or a new `app/ai/useSmartOrganizeUndo.js` hook).
- `app/AIButton.js` (or a sibling `SmartOrganizeUndoChip.js`) + toolbar render sites (`CollectionListOptions.js`, `app/fullpage/FPContentArea.js`) — the persistent chip. **Constraint:** `app/CollectionListOptions.css` has pre-existing uncommitted user changes; do NOT edit/commit it — popup chip styling goes in a committed CSS file (e.g. the chip's own or AIButton.css).

**Reuses:** `aiClient` (`promptForJSON`, language opts, availability), `getCurrentTabsAndGroups` / `loadCurrentWindowsSnapshots`, the `applyChromeGroupSettings` group-API pattern, `buildCollectionFromSnapshot` + `addCollection`, `showUndoToast`/`UNDO_TIME`, the AI modal shell + pre-flight availability check + busy lockout.

## 9. Edge cases

- **No eligible tabs:** idle state disables run with "Everything here is already grouped."
- **AI unavailable:** pre-flight `getAIAvailability() !== 'available'` → error, no mutation.
- **Tabs closed between plan and apply:** background skips missing tab ids.
- **>50 ungrouped tabs:** organize the first 50; report the remainder as left ungrouped.
- **Target window closed before undo:** undo returns `expired`, snapshot cleared, chip disappears, user informed.
- **Tab order shifts** when groups form (inherent to Chrome tab groups); undo restores original order best-effort.
- **Cancel mid-run:** AbortSignal aborts the inference; nothing applied (apply only happens after the plan returns).

## 10. Testing

- **Engine** (`tests/smartOrganizeTabs.test.js`): prompt includes titles+domains+existing group context; index→tabId mapping; color enum clamping/fallback; `existingGroupId` validation (unknown → treated as new); unplaced eligible tabs collected into "Other"; cap at 50 with remainder reported; AbortSignal forwarded.
- **Background** (`tests/smartOrganize.background.test.js` or extend existing background tests): with mocked `browser.tabs`/`browser.tabGroups` — apply writes the snapshot then issues the right `group`/`update` calls; undo ungroups the affected set, restores order, clears the key; expired-window undo path.
- **Modal**: featured hero card renders; idle counts/picker; run flow with mocked engine + mocked background message; done-state actions (save-as-collection calls `addCollection`; undo sends the message); persistent-undo chip presence driven by a preset storage key.
- Full `yarn test`, `yarn lint`, `yarn prod` green before completion (CLAUDE.md).

## 11. Manual verification (real Chrome 138+)

1. Open a messy window (mix of grouped + many ungrouped tabs). Popup → Smart Organize → groups form; already-grouped tabs untouched; existing groups not renamed.
2. Undo from the toast → window returns to prior state (groups gone, order restored).
3. Re-run → close the popup → reopen → the persistent "Undo Smart Organize" chip is beside the AI button → undo from it works.
4. Run → Save as collection → the organized window is saved with its groups.
5. Full-page → window picker → organize a chosen window.
6. Performance mode / AI-disabled: feature hidden or degraded gracefully.
7. >50 ungrouped tabs: remainder reported, no crash.
