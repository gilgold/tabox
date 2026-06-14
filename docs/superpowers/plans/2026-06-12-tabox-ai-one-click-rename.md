# Tabox AI — One-Click Auto-Rename (Single, All, Selected) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the pick-one rename flow with three one-click AI rename surfaces, each with undo: (1) a button inside the collection detail panel renaming that collection; (2) the AI Tools modal's auto-rename tool renaming ALL collections; (3) a selection-toolbar AI button in full-page view scoping the modal's action to the checked collections.

**Architecture:** A sequential bulk engine (`autoRenameCollections`) suggests names one collection at a time (no parallel AI sessions, no parallel storage ops). Bulk apply happens once at the end via `updateRemoteData(fullArray)` → `batchUpdateCollections` (the established batch path). Undo (single and bulk) re-fetches fresh data and patches ONLY `name` back — never restores whole snapshots. A new `aiToolsScopeState` atom (`{type:'all'} | {type:'selected', uids}`) tells the modal what to operate on; the header AIButton resets it to `all`, the selection toolbar sets `selected`.

**Tech Stack:** Existing app/ai layer, jotai, `showUndoToast(icon, message, title, undoFn, UNDO_TIME)` from toastHelpers, `loadAllCollections`/`loadSingleCollection` from storageUtils.

---

## Design decisions (locked in)

1. **Bulk apply = one batch write.** Suggestions are gathered sequentially with progress + cancel; nothing is persisted until the run finishes (or is cancelled — then the completed subset is applied). One `updateRemoteData(patched full array)` call. Honors the "never run per-item collection storage ops in parallel" rule.
2. **Undo is name-only and fresh-fetch based** (both directions), mirroring the existing apply pattern: load fresh by uid, set `name` back to `oldName`, `lastUpdated: Date.now()`. Collections deleted in the meantime are silently skipped on undo.
3. **The modal's picker flow is REMOVED** (select/suggest/apply states, their tests). The auto-rename panel becomes: idle (count + run button) → running (progress + cancel) → done (old→new summary). The undo affordance is the standard undo toast fired right after apply.
4. **Scope reset:** AIButton (header) sets scope `{type:'all'}` before opening so a stale `selected` scope can never leak into a header-initiated session. Selection is NOT cleared after bulk rename (renames don't invalidate selection).
5. **Gating everywhere:** every new surface renders only when `useTaboxAIEnabled()` && `isAISupported()`.

## File Structure

```
app/ai/tasks/autoRenameCollections.js   # NEW — sequential bulk suggest engine
app/atoms/aiState.js                    # MODIFY — add aiToolsScopeState
app/AIToolsModal.js / .css              # MODIFY — one-click bulk panel (replaces picker flow)
app/AIButton.js                         # MODIFY — reset scope to 'all' on open
app/App.js                              # MODIFY — pass updateRemoteData to AIToolsModal
app/CollectionDetailPanel.js / .css     # MODIFY — AI rename button in title row
app/fullpage/FPContentArea.js           # MODIFY — AI button in selection toolbar
tests/autoRenameCollections.test.js     # NEW
tests/AIToolsModal.test.js              # REWRITE for bulk flow
tests/CollectionDetailPanel.aiRename.test.js  # NEW
tests/FPContentArea AI toolbar coverage # extend existing FPContentArea tests if present, else new focused test
```

---

### Task A: Bulk engine + scope atom

**Files:** Create `app/ai/tasks/autoRenameCollections.js`, modify `app/atoms/aiState.js`, create `tests/autoRenameCollections.test.js`.

Engine (complete code):

```js
// app/ai/tasks/autoRenameCollections.js
import { suggestCollectionName } from './suggestCollectionName';

// Suggests new names for collections one at a time. AI inference and the
// surrounding session lifecycle are strictly sequential — Gemini Nano handles
// one prompt at a time, and per-item storage writes are forbidden in parallel
// anyway (apply happens in one batch after this returns).
export async function autoRenameCollections({ collections, onProgress, shouldCancel }) {
    const results = [];
    const skipped = [];
    let cancelled = false;

    for (let index = 0; index < collections.length; index++) {
        if (shouldCancel && shouldCancel()) {
            cancelled = true;
            break;
        }
        const collection = collections[index];
        if (onProgress) onProgress(index, collections.length, collection);
        try {
            const newName = await suggestCollectionName(collection);
            if (newName && newName !== collection.name) {
                results.push({ uid: collection.uid, oldName: collection.name, newName });
            } else {
                skipped.push({ uid: collection.uid, reason: 'unchanged' });
            }
        } catch (error) {
            console.error('Tabox AI: rename suggestion failed for', collection.uid, error);
            skipped.push({ uid: collection.uid, reason: 'error' });
        }
    }

    return { results, skipped, cancelled };
}
```

Atom addition to `app/atoms/aiState.js`:

```js
// What the AI Tools modal operates on. The header button resets this to
// 'all'; the full-page selection toolbar sets the checked collection uids.
export const aiToolsScopeState = atom({ type: 'all' });
```

Tests (jest.mock `./suggestCollectionName`): sequential order; collects oldName/newName; skips unchanged and errored (continues after a rejection); `shouldCancel` after item 1 → only item 0 processed, `cancelled: true`; onProgress called with (index, total, collection).

Commit: `feat(ai): add sequential bulk auto-rename engine and modal scope atom`

### Task B: AIToolsModal one-click bulk flow + AIButton scope reset + App.js prop

**Files:** Modify `app/AIToolsModal.js`, `app/AIToolsModal.css` (add progress styles, reuse `.ai-enable-progress*` patterns), `app/AIButton.js`, `app/App.js` (pass `updateRemoteData={updateRemoteData}` to the `aiToolsModalEl`), rewrite `tests/AIToolsModal.test.js`.

Modal auto-rename panel states (replace the picker/suggest/apply flow and its handlers entirely):
- Read `aiToolsScopeState`; targets = nameable collections (tabs.length > 0), filtered to `scope.uids` when `scope.type === 'selected'`.
- **idle:** "Automatically rename N collections using on-device AI. You can undo afterwards." + `Auto-rename N collections` button (disabled when N === 0 with a hint).
- **running:** progress bar (`i/N`, current collection name), Cancel button (sets a ref flag consumed by `shouldCancel`); overlay/Esc close disabled while running (same busy pattern as AIEnableModal).
- Apply at end (also for cancelled partial results, if any): `const fresh = await loadAllCollections();` patch `name`/`lastUpdated` by uid for each result whose uid still exists; `await updateRemoteData(patchedFullArray);` then `showUndoToast(<BsStars />, 'Renamed N collections with AI', 'Tabox AI', undoFn, UNDO_TIME)` where `undoFn` re-loads fresh and patches `oldName` back by uid (skip missing), via `updateRemoteData` again.
- **done:** summary list (`oldName → newName`, plus "M skipped" line when applicable) + Done button. Modal stays open until user closes.
- Keep the suggest-token/reopen-reset hygiene: reset state machine on open; a run belongs to one open session (bump a run token on open; discard late progress/results from a previous session).

Tests (rewrite): registry list still renders; one-click run renames all nameable collections (mock engine module OR mock suggestCollectionName — prefer mocking `autoRenameCollections`) and calls `updateRemoteData` once with patched names; scope `selected` limits targets; cancel applies completed subset; undo callback passed to showUndoToast restores old names via second `updateRemoteData` (capture the mock call); failure of one collection skips it.

Commit: `feat(ai): one-click bulk auto-rename with undo in AI tools modal`

### Task C: AI rename button in CollectionDetailPanel

**Files:** Modify `app/CollectionDetailPanel.js` (title row, ~line 290) + its CSS; create `tests/CollectionDetailPanel.aiRename.test.js`.

- Button beside the edit button in `panel-title-row`: BsStars icon, class `panel-edit-btn panel-ai-rename-btn`, tooltip "Auto-name with AI", `aria-label="Auto-name with AI"`, gated by `useTaboxAIEnabled() && isAISupported()`, spinner/disabled while running, hidden while `isEditingName`.
- Click flow: `suggestCollectionName(collection)` → if same name, info toast "Name already fits — no change."; else re-fetch `loadSingleCollection(collection.uid)` (missing → error toast, abort), `updateCollection({...fresh, name, lastUpdated}, true)`, then `showUndoToast(<BsStars />, \`Renamed to '\${newName}'\`, oldName, undoFn, UNDO_TIME)`; `undoFn` re-fetches and patches `oldName` back via `updateCollection(..., true)` (skip if deleted). Errors → error toast, no write.
- Local `isAiRenaming` state guards double-click.

Tests: button hidden when AI off; click renames via updateCollection with fresh data and fires undo toast; undo callback restores old name; suggest failure → error toast, no updateCollection call. Mock aiClient/useTaboxAIEnabled/suggestCollectionName/storageUtils/toastHelpers per existing conventions.

Commit: `feat(ai): one-click AI rename with undo in collection detail panel`

### Task D: Selection-toolbar AI button (full page)

**Files:** Modify `app/fullpage/FPContentArea.js` (selection toolbar, ~lines 2572-2673); extend FPContentArea tests if a suite exists, else add a focused test file.

- New toolbar button after the existing action buttons (before Clear): class `fp-toolbar-btn fp-toolbar-ai-btn`, BsStars icon + label "AI", tooltip "AI actions for selected collections", gated by `useTaboxAIEnabled() && isAISupported()`, disabled when selection empty.
- onClick: `setAiToolsScope({ type: 'selected', uids: [...selectedCollectionUids] }); setAiToolsModalOpen(true);` (useSetAtom both). Do not clear selection.
- Small CSS (in FPContentArea.css or FPTopBar.css-adjacent file already styling fp-toolbar-btn — follow where `.fp-toolbar-btn` lives) for an accent tint on the AI button if trivial; otherwise the base class is fine.

Tests: with AI enabled (mock hook) and ≥1 selected, button renders; click sets scope atom to the selected uids and opens modal atom (assert via store.get). With AI disabled, button absent.

Commit: `feat(ai): AI bulk action entry from full-page selection toolbar`

### Task E: Verification

`yarn test` (full), `yarn lint`, `yarn prod`. Final whole-feature review (range from current HEAD 1d14ca7). Manual smoke on Chrome 138+: single rename undo; rename-all from header modal with progress + cancel + undo; selected-scope rename from full-page toolbar + undo.
