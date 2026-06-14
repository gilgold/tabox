# Tabox AI — In-Progress Visual Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** While an AI rename is in flight, show an animated gradient border + looping left-to-right lightning sweep on (a) the collection name in the detail panel (single rename) and (b) the affected collection cards in popup list, popup grid, and full-page grid (bulk runs: scope targets only; single rename: that card). All effects stop when the rename completes/cancels/fails.

**Architecture:** Two atoms drive everything: `aiProcessingUidsState` (string[] — all uids in the current run) and `aiProcessingCurrentUidState` (uid being processed right now, stronger effect). The detail panel sets both for its single rename; the AIToolsModal sets them for bulk runs (targets on start, current via onProgress, cleared on end/reopen/unmount). Card components read the atoms exactly like the existing `highlightedCollectionUidState` pattern and append `ai-processing` / `ai-processing-current` classes. One shared CSS file (`app/AIEffects.css`) defines the keyframes + a mask-composite gradient ring (`::before`) and skewed lightning streak (`::after`); per-surface CSS only tweaks radius if needed. `html.performance-mode` gets an explicit static-border fallback (no animation).

**Key facts:** card roots/classes — `.collection-list-item` (app/CollectionListItem.js:247, uid = props.collection.uid), `.collection-tile` (app/CollectionTile.js:206), `.fp-collection-card` (className built in app/fullpage/FPCollectionCard.js:268-279, uid = collection.uid; memoized wrapper is fine — atom reads inside the component still re-render). Panel title slot: `.panel-title-slot` (app/CollectionDetailPanel.js ~344-374). Existing transient `.lightning-effect` uses `::before` on the same roots — avoid overlap by clearing the processing atoms BEFORE the final `updateCollection(..., true)` so the completion lightning plays after the loop stops. Performance-mode rules live in static/index.css:330-342.

---

## Task F: atoms + shared effect CSS + detail-panel wiring

Files: `app/atoms/aiState.js` (add the two atoms), NEW `app/AIEffects.css`, `app/CollectionDetailPanel.js` (+ its CSS import of AIEffects.css), `tests/CollectionDetailPanel.aiRename.test.js` (extend), small atom test if useful.

- `app/AIEffects.css`: `@keyframes ai-gradient-shift` (background-position 0%→300%), `@keyframes ai-lightning-sweep` (translateX(-130%)→translateX(230%) with skewX(-20deg), ease-in-out, ~1.4s infinite). Class `.ai-processing`: `position: relative; isolation: isolate;` with `::before` gradient ring (inset 0, border-radius inherit, padding 2px, `background: linear-gradient(120deg, #7c3aed, #2563eb, #38bdf8, #ec4899, #7c3aed) 0 0 / 300% 100%`, mask-composite ring technique, `animation: ai-gradient-shift 2.2s linear infinite`, pointer-events none, z-index 2) and `::after` lightning streak (absolute, top 0, bottom 0, width 45%, `background: linear-gradient(100deg, transparent, rgba(255,255,255,0.35) 50%, transparent)`, `animation: ai-lightning-sweep 1.4s ease-in-out infinite`, pointer-events none, z-index 3). `.ai-processing-current::before` faster (1.1s) + brighter (filter brightness(1.2)). `.ai-name-processing` = same visuals tuned for the title slot (radius 8px, slight padding so the ring doesn't clip text). `html.performance-mode` block: `animation: none !important` on all of these pseudo-elements, `::after { display: none }`, `::before` keeps a static purple ring.
- Atoms: `export const aiProcessingUidsState = atom([]); export const aiProcessingCurrentUidState = atom(null);` with a comment.
- Panel: import AIEffects.css; `useSetAtom` both atoms; in `handleAiRename` set `[renamedUid]` + current right after the re-entry guard; clear BOTH (empty array / null) in two places: right before `updateCollection(...)` apply (so completion lightning doesn't overlap) and in the `finally` (idempotent safety). Add `ai-name-processing` class to `.panel-title-slot` while `isAiRenaming` (and `ai-processing` not needed here — the slot class carries both ring+sweep).
- Tests: pending suggest promise → title slot has the class + atoms set in store; resolve → class gone + atoms cleared (including on error path).

Commit: `feat(ai): animated gradient/lightning progress effect for panel AI rename`

## Task G: card effects + bulk-run wiring

Files: `app/CollectionListItem.js`, `app/CollectionTile.js`, `app/fullpage/FPCollectionCard.js` (each: read both atoms, append `ai-processing` / `ai-processing-current` to the existing className arrays, import AIEffects.css once per file), `app/AIToolsModal.js` (set targets' uids on run start; `aiProcessingCurrentUidState` from onProgress; clear both when the engine returns — BEFORE the batch apply — and in the open-reset effect + unmount cleanup), per-surface CSS nudges only if a root needs `overflow: hidden`/radius fixes, tests.

- Card components follow the `highlightedCollectionUidState` consumption pattern verbatim (useAtomValue + uid comparison; `isAiProcessing = aiProcessingUids.includes(uid)`).
- Modal: `setAiProcessingUids(targets.map(t => t.uid))` after status→running; in onProgress (token-guarded) `setAiProcessingCurrentUid(collection.uid)`; when engine resolves (token-guarded): clear both atoms FIRST, then proceed to batch apply. Also clear in the isOpen reset effect and the unmount effect (alongside the abort).
- Tests: card components render with store-preset atoms → classes present/absent (3 quick tests); AIToolsModal — controllable engine promise: while pending, store has the target uids; after resolve, atoms cleared (extend existing suite).

Commit: `feat(ai): processing effect on target collection cards during bulk AI rename`

## Task H: verification

Full `yarn test`, `yarn lint`, `yarn prod`; final review of the range; manual check notes (effects loop during run, stop on done/cancel/error, performance-mode static ring, no clash with the completion lightning flash).
