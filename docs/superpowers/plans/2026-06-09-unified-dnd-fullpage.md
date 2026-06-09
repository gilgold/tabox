# Unified Drag & Drop (Full Page View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the look, feel, and code paths of drag & drop across the full-page view — sidebar folders, collection cards (list + grid), and tab/group dragging in the collection detail panel — while deleting dead code and fixing drag-time performance issues.

**Architecture:** Three dnd-kit `DndContext`s remain (sidebar folder sort, content-area collections, detail-panel tabs) but share one foundation module for sensors/constants, one sidebar hit-test utility, one CSS token set for all drop indicators/overlays, and one cross-context drag atom flow. Pure drop-resolution engines (`collectionSectionDragEngine.js`, `collectionDragUtils.js`) stay as-is; the superseded engine in `fpCollectionSections.js` is deleted.

**Tech Stack:** React 19, @dnd-kit/core + @dnd-kit/sortable, Jotai, Jest 29 + React Testing Library, plain CSS, Playwright + crxbox e2e (`yarn test:e2e`, runs against `build/`).

**Branch:** all work happens on `feature/v4.1.3` (created in Task 0). **Definition of done:** `yarn test`, `yarn lint`, `yarn prod`, and `yarn test:e2e` all green — including the new DnD e2e specs.

**crxbox note (standing instruction):** Tabox doubles as the test bed for the in-development crxbox framework. If any e2e task hits a crxbox gap or bug (e.g. missing mid-drag control in `ext.dragAndDrop()`), log it with evidence in `crxbox-feedback.md` and work around it with raw `page.mouse` — don't silently drop the test.

---

## Current-State Inventory (as researched 2026-06-09)

| Area | File(s) | Mechanism |
|---|---|---|
| Sidebar folder reorder | `app/fullpage/FPSidebar.js:614-653` | Own `DndContext`, PointerSensor **distance 6**, `useSortable` rows, persists via `reorderSidebarFolders()` |
| Sidebar as drop target for collections | `FPSidebar.js:141-172` (hover) + `app/fullpage/FPContentArea.js:2324-2340` (drop) | **Two duplicate manual hit-test loops** over `[data-sidebar-folder-uid]` rects; hover via document `mousemove` keyed off `draggingCollectionState` atom |
| Sidebar native HTML5 drop | `FPSidebar.js:89-90, 268-278` | **Dead code** — `e.dataTransfer` is never set anywhere (no `draggable` attribute exists in `app/fullpage/`) |
| Collection cards (list + grid) | `FPContentArea.js` (4,094 lines) | One `DndContext`, PointerSensor distance 5, ~110-line `customCollisionDetection` (2061-2176), ~250 lines of manual `querySelectorAll` hit-testing (425-673), engine = `app/utils/collectionSectionDragEngine.js` (pure, tested) |
| Old grouped-section engine | `app/fullpage/fpCollectionSections.js` | Only `buildGroupedAllCollectionSections` + `ROOT_LEVEL_SECTION_ID` are imported (`FPContentArea.js:98-100`). The other ~200 lines (`isGroupedSectionDropId`, `resolveGroupedDropId`, `reorderCollectionsWithinParent`, `moveCollectionBetweenParents`, `getSectionDropTarget`) are a **superseded duplicate** of `collectionSectionDragEngine.js`, kept alive only by `tests/fpCollectionSections.test.js` |
| Tab/group DnD in detail panel | `app/ExpandedCollectionData.js` (shared popup + FP via `CollectionDetailPanel`) | Own `DndContext`, distance 5, own ~60-line collision cascade, engine = `app/utils/collectionDragUtils.js` (pure, tested), indicators = `DropGap` + `CollectionEdgeDropZone` |
| Cross-collection tab/group transfer | `app/useCollectionItemCrossDrag.js` | Document `mousemove`/`mouseup` + `elementsFromPoint`; **writes `dragSessionState` atom on every pointer move** |
| Cross-context atoms | `app/atoms/animationsState.js:25,28` | `dragSessionState` (tab/group) and `draggingCollectionState` (collection) — two parallel mechanisms |

### Visual inconsistencies found

1. **Five indicator styles**: dashed ghost-card gap (`fp-collection-insert-gap`, hard-coded `rgba(22,152,226,…)`, `FPContentArea.css:1130-1151`); expanding pulse gap (`DropGap.css`, hard-coded blue); sidebar outline highlight (`FPSidebar.css:428-457`, uses `var(--primary-color)` — the only themable one); edge pill with label (`CollectionList.css:1295-1313`, hard-coded blue); **cross-collection card target** (`DroppableCollection.js` — inline styles with a *different* hard-coded fallback blue, `rgba(var(--primary-color-rgb, 52, 152, 219), 0.15)`).
2. **Five "source item while dragging" treatments**: grid card opacity 0.5, list card collapsed+hidden, tab row opacity 0.25, dragged group collapsed to zero height (`SortableGroupContainer.js:52-62`), folder row unchanged.
3. **Overlay styling**: FP card overlay uses CSS class (`.fp-card-drag-overlay`: `--fp-shadow-xl`, opacity .92, primary border); tab/group overlays use inline styles in `ExpandedCollectionData.js:817-825, 840-846` (different shadow, hard-coded `width: 400px`).
4. **Activation distance**: 6 px (folders) vs 5 px (everything else).
5. **Settle feedback**: collections flash via `highlightedCollectionUidState` after drop; tabs/groups get nothing.
6. **Indicator gating is inconsistent** ("when to show"):
   - Tab/group drags suppress no-op indicators (`isCollectionDropTargetEnabled` returns false when the drop wouldn't change anything), but collection drags set `previewTarget` without checking `resolveCollectionDropOperation` — so list mode can show an insert gap on the no-op side of an adjacent card, and dropping does nothing.
   - The sidebar excludes the dragged collection's *current folder* from drop affordances (`isSameFolder`, `FPSidebar.js:629-630`) but does **not** exclude "Root Level" when the dragged collection is already at root (`isNoFolderDropTarget = isDraggingCollection`, line 524) — a no-op target lights up as droppable.
   - Container targets have ambient affordance in the sidebar (`fp-sidebar-drop-active` on all valid folders during a drag) but folder section headers in the content area show nothing until hovered (and only when collapsed — `canHighlight={isCollapsedSectionTarget}`).

### Performance issues found

1. `useCollectionItemCrossDrag.js:61-85` updates the `dragSessionState` atom on **every** mousemove → every subscriber (including the 4k-line `FPContentArea`) re-renders per pointer move during a tab drag.
2. `FPContentArea.js:2098` computes `closestCorners(args)` eagerly on every collision pass even when pointer collisions already win.
3. `handleDragOver` runs up to three separate `querySelectorAll` + `getBoundingClientRect` document scans per event (`findGroupedEmptySectionTargetAtPoint`, `findGroupedGridCollectionTargetAtPoint`, `findGroupedSectionBodyTargetAtPoint`).

### Invariants — must not regress

- Pinned tabs are immovable and stay at the top (`firstMovableIndex` / `firstNonPinnedTopLevelIndex` logic in `collectionDragUtils.js`).
- Collection DnD is disabled while a search query is active; tab search filters the drag model.
- All persistence goes through optimistic state + batch helpers (`persistCollectionLayoutChanges`, `batchUpdateCollections`). **Never** run per-item collection storage ops in parallel.
- Cross-collection transfer works while the detail panel overlays cards (`elementsFromPoint` sees through the panel).
- Grid same-section reorder uses the hovered tile's index (matches the sortable transform preview); list uses before/after sides.
- Folder "lightning" effect fires when a collection lands in a folder.
- Migrations/storage shape untouched — this plan only changes UI/interaction code.

### Unified design language (target spec)

- **Accent tokens** (new, in `static/index.css`): every indicator derives from `--primary-color`; no hard-coded blues.
- **Insert between items** → expanding dashed gap (current `DropGap` look), used for tabs, groups, and list-mode collection gaps; grid keeps ghost-card-sized gap but with the same border/background tokens.
- **Drop into a container** (sidebar folder, empty folder section, foreign collection, group append) → 2px solid accent outline + soft tint (current sidebar look).
- **Lifted item (DragOverlay)** → shared `.dnd-drag-overlay` class: `--fp-shadow-xl`-equivalent shadow, opacity 0.92, accent border, `cursor: grabbing`.
- **Source item left behind** → opacity 0.35 everywhere it stays in flow (grid cards, tabs, folder rows); list-mode collapse stays (the gap preview replaces it).
- **Settle** → brief accent flash on the dropped item, for tabs/groups too.
- **Activation distance** → 5 px everywhere.

**Indicator visibility policy (when to show what):**

| Rule | Detail |
|---|---|
| No-op suppression | An indicator never appears where dropping would change nothing: not on the dragged item's own position/sides, not on its current folder (sidebar **and** content-area sections), not on "Root Level" when it's already at root. Tab/group drags already enforce this via `isCollectionDropTargetEnabled`; collection drags must gate `previewTarget` through `resolveCollectionDropOperation`. |
| Ambient affordance | During an eligible drag, *enumerable container targets* (sidebar folders, root-level item, grouped section headers, empty-section dropzones) show the subtle dashed ambient cue so users discover where dropping is possible. Cards as cross-collection tab targets do NOT get ambient treatment (dozens of cards = noise); they highlight on hover only. |
| Hover emphasis | Exactly one strong highlight at a time — the target under the pointer (solid accent outline + tint for containers, expanded gap for insertions). |
| Eligibility by drag kind | Collection drag → sidebar items, section headers/edges/empty zones, card insert positions. Tab drag → tab edges, group edges, group append surfaces (header/body), collection start/end edges, foreign collection cards. Group drag → group edges, ungrouped-tab edges, collection start/end edges, foreign collection cards. Pinned-tab positions never light up. |

---

## Phase 0 — Branch, version, and baseline e2e safety net

### Task 0: Create the v4.1.3 branch and bump the version

**Files:**
- Modify: `package.json`, `chrome/manifest.json`

- [ ] **Step 1: Branch off the current HEAD** (which contains the e2e + crxbox tooling):

```bash
git checkout -b feature/v4.1.3
```

- [ ] **Step 2: Bump the version** — in `package.json` and `chrome/manifest.json`, change `"version": "4.1.2"` → `"version": "4.1.3"` (verify the current value first with `grep -n '"version"' package.json chrome/manifest.json`).

- [ ] **Step 3: Verify and commit**

Run: `yarn prod`
Expected: build succeeds; `build/manifest.json` shows 4.1.3.

```bash
git add package.json chrome/manifest.json
git commit -m "chore(release): start 4.1.3"
```

### Task 0.25: Update dnd-kit and supporting libraries to latest

Checked against the Wix npm registry on 2026-06-09: `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, and transitive `@dnd-kit/accessibility` 3.1.1 are **already the latest** in `yarn.lock`. The only available update is `@dnd-kit/utilities` 3.2.2 → 3.3.0 (minor). Re-verify at execution time in case anything newer has shipped since.

**Files:**
- Modify: `package.json`, `yarn.lock`

- [ ] **Step 1: Re-check latest versions at execution time**

```bash
npm view @dnd-kit/core version --registry=https://npm.dev.wixpress.com
npm view @dnd-kit/sortable version --registry=https://npm.dev.wixpress.com
npm view @dnd-kit/utilities version --registry=https://npm.dev.wixpress.com
```
If core or sortable have new **major** versions, stop and review their changelogs/migration notes before bumping (the collision-detection and sortable APIs this codebase leans on — `pointerWithin`, `closestCorners`, `MeasuringStrategy`, `useSortable` data payloads — have changed across past majors). Minor/patch bumps proceed directly.

- [ ] **Step 2: Bump to latest**

In `package.json` set `"@dnd-kit/utilities": "^3.3.0"` (plus any newer minors found in Step 1), then:

```bash
yarn install
grep -A1 '"@dnd-kit/utilities@' yarn.lock
```
Expected: lockfile resolves 3.3.0 (or newer).

- [ ] **Step 3: Verify nothing moved under us**

Run: `yarn test && yarn lint && yarn prod`
Expected: full unit suite green, build OK.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore(deps): update @dnd-kit packages to latest"
```

### Task 0.5: Baseline DnD e2e specs (must pass BEFORE any refactor — they guard every later phase)

These pin the *current* behavior that the refactor must preserve. Write them against the unmodified code, watch them pass, and keep them green through every subsequent task. Mid-drag assertions (hover highlights, gap indicators) need pointer control that `ext.dragAndDrop()` doesn't expose, so add a small manual-drag helper.

**Files:**
- Create: `e2e/support/dnd.mjs`
- Create: `e2e/fp-dnd-baseline.spec.mjs`

- [ ] **Step 1: Add the manual-drag helper**

```js
// e2e/support/dnd.mjs
// Manual pointer-driven drag for mid-drag assertions (indicators, hover
// highlights). ext.dragAndDrop() is atomic — press/assert/release needs raw
// mouse control. dnd-kit's PointerSensor activates after 5px of travel.

export async function startDrag(page, sourceLocator) {
  const box = await sourceLocator.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Exceed the activation distance so the drag session starts.
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 });
  return { startX, startY };
}

export async function dragOver(page, targetLocator, { steps = 10 } = {}) {
  const box = await targetLocator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}

export async function drop(page) {
  await page.mouse.up();
}
```

- [ ] **Step 2: Write `e2e/fp-dnd-baseline.spec.mjs`** — four tests, following the seed/assert pattern of `e2e/fp-reorder.spec.mjs`:

```js
import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';
import { startDrag, dragOver, drop } from './support/dnd.mjs';

// Baseline behaviors the DnD unification refactor must preserve.

test('dragging a card over a sidebar folder highlights it and drop moves the collection', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }],
      folders: [{ uid: 'f1', name: 'Work', order: 0 }],
    }),
  );
  const page = await openFullPage(ext);
  await expect(page.locator('[data-sortable-collection-id="col-a"]')).toBeVisible();

  await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));
  await dragOver(page, page.locator('[data-sidebar-folder-uid="f1"]'));

  // Hover highlight while dragging (cross-context sidebar target).
  await expect(page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item'))
    .toHaveClass(/fp-sidebar-drop-over/);

  await drop(page);

  await expect
    .poll(async () => (await ext.storage.local.get('collections_index'))['col-a'].parentId)
    .toBe('f1');
});

test('list mode shows an insert gap while dragging and drop reorders within the section', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [
        { uid: 'col-a', name: 'Alpha', order: 0 },
        { uid: 'col-b', name: 'Beta', order: 1 },
        { uid: 'col-c', name: 'Gamma', order: 2 },
      ],
    }),
  );
  const page = await openFullPage(ext);
  // Grouped "All Collections" view + list mode (the view-mode toggle lives in
  // the content header; use its accessible control — verify the selector in
  // FPContentArea's header render before relying on it).
  await page.locator('[data-view-mode-toggle="list"], [aria-label="List view"]').first().click();
  await expect(page.locator('[data-sortable-collection-id]')).toHaveCount(3);

  await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));
  await dragOver(page, page.locator('[data-sortable-collection-id="col-c"]'));

  await expect(page.locator('.fp-collection-insert-gap')).toBeVisible();

  await drop(page);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return [idx['col-a'].order, idx['col-b'].order, idx['col-c'].order];
    })
    .toEqual([2, 0, 1]);
});

test('dropping a card on an empty folder section moves it into the folder', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }],
      folders: [{ uid: 'f1', name: 'Empty', order: 0 }],
    }),
  );
  const page = await openFullPage(ext);

  await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));
  await dragOver(page, page.locator('.fp-grouped-empty-dropzone').first());
  await drop(page);

  await expect
    .poll(async () => (await ext.storage.local.get('collections_index'))['col-a'].parentId)
    .toBe('f1');
});

test('reorders tabs inside the collection detail panel', async ({ ext }) => {
  const seed = buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] });
  // Three ungrouped tabs with stable uids (fixtures.mjs default is a single tab).
  seed['collection_col-a'].tabs = [
    { uid: 'tab-1', title: 'One', url: 'https://one.example.com', groupId: -1 },
    { uid: 'tab-2', title: 'Two', url: 'https://two.example.com', groupId: -1 },
    { uid: 'tab-3', title: 'Three', url: 'https://three.example.com', groupId: -1 },
  ];
  seed.collections_index['col-a'].tabCount = 3;
  await ext.storage.local.set(seed);
  const page = await openFullPage(ext);

  await page.locator('[data-sortable-collection-id="col-a"]').click();
  const tabRows = page.locator('.collection-detail-panel .collection-draggable-tab');
  await expect(tabRows).toHaveCount(3);

  await ext.dragAndDrop(tabRows.nth(0), tabRows.nth(2));

  await expect
    .poll(async () => {
      const col = await ext.storage.local.get('collection_col-a');
      return col['collection_col-a'].tabs.map((t) => t.uid);
    })
    .toEqual(['tab-2', 'tab-3', 'tab-1']);
});

// --- seed helper for group scenarios: one group (g1: tab-1, tab-2) + one ungrouped tab-3 ---
const seedWithGroup = () => {
  const seed = buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] });
  seed['collection_col-a'].chromeGroups = [{ uid: 'g1', id: 1, title: 'Work', color: 'blue' }];
  seed['collection_col-a'].tabs = [
    { uid: 'tab-1', title: 'One', url: 'https://one.example.com', groupUid: 'g1', groupId: 1 },
    { uid: 'tab-2', title: 'Two', url: 'https://two.example.com', groupUid: 'g1', groupId: 1 },
    { uid: 'tab-3', title: 'Three', url: 'https://three.example.com', groupId: -1 },
  ];
  seed.collections_index['col-a'].tabCount = 3;
  return seed;
};

const colTabs = async (ext, uid = 'col-a') => {
  const col = await ext.storage.local.get(`collection_${uid}`);
  return col[`collection_${uid}`].tabs;
};

test('drags an ungrouped tab into a tab group', async ({ ext }) => {
  await ext.storage.local.set(seedWithGroup());
  const page = await openFullPage(ext);
  await page.locator('[data-sortable-collection-id="col-a"]').click();

  const panel = page.locator('.collection-detail-panel');
  // Expand the group so its member tab rows are droppable anchors.
  await panel.locator('.collection-draggable-group').click();
  // Drag ungrouped tab-3 onto tab-2 (inside g1) → TAB_EDGE with a grouped anchor joins the group.
  await ext.dragAndDrop(
    panel.locator('.collection-draggable-tab').filter({ hasText: 'Three' }),
    panel.locator('.collection-draggable-tab').filter({ hasText: 'Two' }),
  );

  await expect
    .poll(async () => (await colTabs(ext)).find((t) => t.uid === 'tab-3').groupUid)
    .toBe('g1');
});

test('drags a grouped tab out of its group to the collection end', async ({ ext }) => {
  await ext.storage.local.set(seedWithGroup());
  const page = await openFullPage(ext);
  await page.locator('[data-sortable-collection-id="col-a"]').click();

  const panel = page.locator('.collection-detail-panel');
  await panel.locator('.collection-draggable-group').click();

  // Drag tab-1 onto the "Drop at end" collection edge zone → leaves g1, lands last, ungrouped.
  await startDrag(page, panel.locator('.collection-draggable-tab').filter({ hasText: 'One' }));
  await dragOver(page, panel.locator('.collection-edge-drop-zone').last());
  await drop(page);

  await expect
    .poll(async () => {
      const tabs = await colTabs(ext);
      const moved = tabs.find((t) => t.uid === 'tab-1');
      return { last: tabs[tabs.length - 1].uid, groupUid: moved.groupUid ?? null };
    })
    .toEqual({ last: 'tab-1', groupUid: null });
});

test('drags a whole tab group below an ungrouped tab', async ({ ext }) => {
  await ext.storage.local.set(seedWithGroup());
  const page = await openFullPage(ext);
  await page.locator('[data-sortable-collection-id="col-a"]').click();

  const panel = page.locator('.collection-detail-panel');
  // Drag the group header onto ungrouped tab-3 → group reinserts after it.
  await ext.dragAndDrop(
    panel.locator('.collection-draggable-group'),
    panel.locator('.collection-draggable-tab').filter({ hasText: 'Three' }),
  );

  await expect
    .poll(async () => (await colTabs(ext)).map((t) => t.uid))
    .toEqual(['tab-3', 'tab-1', 'tab-2']);
});

test('drags a tab from the detail panel onto another collection card', async ({ ext }) => {
  const seed = buildSeed({
    collections: [
      { uid: 'col-a', name: 'Alpha', order: 0 },
      { uid: 'col-b', name: 'Beta', order: 1 },
    ],
  });
  seed['collection_col-a'].tabs = [
    { uid: 'tab-1', title: 'One', url: 'https://one.example.com', groupId: -1 },
    { uid: 'tab-2', title: 'Two', url: 'https://two.example.com', groupId: -1 },
  ];
  seed.collections_index['col-a'].tabCount = 2;
  await ext.storage.local.set(seed);
  const page = await openFullPage(ext);

  await page.locator('[data-sortable-collection-id="col-a"]').click();
  const tabRow = page.locator('.collection-detail-panel .collection-draggable-tab').first();
  await expect(tabRow).toBeVisible();

  // The transfer is finalized by useCollectionItemCrossDrag's document mouseup,
  // so a manual drag (real pointer events) is required here.
  await startDrag(page, tabRow);
  await dragOver(page, page.locator('[data-sortable-collection-id="col-b"]'));

  // Foreign-card hover highlight while dragging.
  await expect(page.locator('[data-collection-uid="col-b"][data-collection-drop-zone]')).toBeVisible();

  await drop(page);

  await expect.poll(async () => (await colTabs(ext, 'col-a')).length).toBe(1);
  await expect
    .poll(async () => (await colTabs(ext, 'col-b')).map((t) => t.uid))
    .toContain('tab-1');
});

test('drops a collection card onto another folder section header in the content area', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [
        { uid: 'col-a', name: 'Alpha', order: 0 },
        { uid: 'col-b', name: 'Beta', order: 0, parentId: 'f1' },
      ],
      folders: [{ uid: 'f1', name: 'Work', order: 0 }],
    }),
  );
  const page = await openFullPage(ext);

  // Drag root-level Alpha onto the f1 section header (sectionStart target) → moves into folder at index 0.
  await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));
  await dragOver(page, page.locator('[data-grouped-section-parent-id="f1"]'));
  await drop(page);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return { parent: idx['col-a'].parentId, order: idx['col-a'].order };
    })
    .toEqual({ parent: 'f1', order: 0 });
});
```

Adjust selectors against the real DOM as needed (run headed with `SLOWMO=400 yarn test:e2e:headed --grep baseline` while authoring) — the storage assertions are the contract; the locators may need tuning. If `seed['collection_col-a'].tabs` items need additional fields (check `app/model/TaboxCollection` and how tabs get `uid`s on load), extend the fixture rather than the test. Note the tab-drag test asserts the **persisted value lands through the indexed-storage write path** — exactly the kind of regression the refactor could introduce.

- [ ] **Step 3: Build and run**

Run: `yarn prod && yarn test:e2e --grep "dnd-baseline|baseline"`
Expected: all 4 PASS against the unmodified code. Iterate on selectors until green.

- [ ] **Step 4: Commit**

```bash
git add e2e/support/dnd.mjs e2e/fp-dnd-baseline.spec.mjs
git commit -m "test(e2e): baseline drag-and-drop coverage before DnD unification"
```

---

## Phase 1 — Delete dead & duplicate code

### Task 1: Remove the dead native HTML5 drop path from FPSidebar

The fullpage app has no element with `draggable=true`, so `e.dataTransfer.getData()` can never return anything; the real sidebar drop is handled in `FPContentArea.handleDragEnd`. `tests/FPSidebar.test.js` has no coverage of this path (verified by grep).

**Files:**
- Modify: `app/fullpage/FPSidebar.js`

- [ ] **Step 1: Run the existing sidebar tests to establish a green baseline**

Run: `yarn jest tests/FPSidebar.test.js`
Expected: PASS

- [ ] **Step 2: Delete the dead code**

In `app/fullpage/FPSidebar.js`:

1. In `SortableSidebarFolderItem` (lines 54-106): remove the `onDrop` prop from the signature and remove these two attributes from the wrapper div:
```js
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, folder.uid)}
```
2. Delete the whole `handleFolderDrop` function (lines 268-278):
```js
    // Folder drop handler
    const handleFolderDrop = async (e, folderId) => {
        const collectionUid = e.dataTransfer.getData('text/plain');
        if (!collectionUid) return;
        const success = await moveCollectionToFolder(collectionUid, folderId);
        if (success) {
            if (triggerFolderLightningEffect) triggerFolderLightningEffect(folderId);
            if (triggerSync) triggerSync();
            if (onDataUpdate) await onDataUpdate();
        }
    };
```
3. Remove `onDrop={handleFolderDrop}` from the `<SortableSidebarFolderItem>` call site (line 647).
4. Remove now-unused import `moveCollectionToFolder` from the `folderOperations` import block (line 20) — first grep the file to confirm no other usage:
```bash
grep -n "moveCollectionToFolder" app/fullpage/FPSidebar.js
```

- [ ] **Step 3: Verify**

Run: `yarn jest tests/FPSidebar.test.js && yarn lint`
Expected: PASS, no unused-variable lint errors.

- [ ] **Step 4: Commit**

```bash
git add app/fullpage/FPSidebar.js
git commit -m "refactor(fp-sidebar): remove dead native HTML5 drop path"
```

### Task 2: Collapse `fpCollectionSections.js` to the one function actually used

`FPContentArea.js:98-100` imports only `buildGroupedAllCollectionSections` and `ROOT_LEVEL_SECTION_ID`. Everything else duplicates `collectionSectionDragEngine.js`.

**Files:**
- Modify: `app/fullpage/fpCollectionSections.js`
- Modify: `tests/fpCollectionSections.test.js`

- [ ] **Step 1: Confirm no other consumers**

Run: `grep -rn "fpCollectionSections" app/ tests/ static/ chrome/`
Expected: only `FPContentArea.js` and `tests/fpCollectionSections.test.js`.

- [ ] **Step 2: Rewrite `fpCollectionSections.js` with only the live code**

Replace the entire file with:

```js
import { sortCollectionsForDisplay } from '../utils/storageUtils';
import {
    normalizeCollectionParentId,
    ROOT_LEVEL_SECTION_ID,
} from '../utils/collectionSectionDragEngine';

export { ROOT_LEVEL_SECTION_ID } from '../utils/collectionSectionDragEngine';

const sortSectionCollections = (collections, sortBy, sortOrder) => {
    const allHaveExplicitOrder = collections.every(collection => collection.order !== undefined && collection.order !== null);

    if (allHaveExplicitOrder) {
        return [...collections].sort((a, b) => a.order - b.order);
    }

    return sortCollectionsForDisplay(collections, {
        sortBy,
        sortOrder,
        flatSort: true,
    });
};

export const buildGroupedAllCollectionSections = ({
    collections = [],
    folders = [],
    sortBy = 'lastUpdated',
    sortOrder = 'asc',
}) => {
    const folderUidSet = new Set(folders.map(folder => folder.uid));

    const sections = folders.map(folder => {
        const folderCollections = sortSectionCollections(
            collections.filter(collection => normalizeCollectionParentId(collection, folderUidSet) === folder.uid),
            sortBy,
            sortOrder,
        );

        return {
            id: folder.uid,
            kind: 'folder',
            title: folder.name,
            color: folder.color,
            collapsed: !!folder.collapsed,
            folder,
            collections: folderCollections,
            count: folderCollections.length,
        };
    });

    const rootCollections = sortSectionCollections(
        collections.filter(collection => normalizeCollectionParentId(collection, folderUidSet) === null),
        sortBy,
        sortOrder,
    );

    sections.push({
        id: ROOT_LEVEL_SECTION_ID,
        kind: 'root',
        title: 'Root Level',
        collapsed: false,
        collections: rootCollections,
        count: rootCollections.length,
    });

    return sections;
};
```

Note: both files already use the literal `'__root__'` for `ROOT_LEVEL_SECTION_ID` (verified), so swapping the duplicate constant for the engine's export is behavior-neutral.

- [ ] **Step 3: Trim the test file**

In `tests/fpCollectionSections.test.js`, delete every `describe`/`test` block that exercises the removed exports (`isGroupedSectionDropId`, `resolveGroupedDropId`, `reorderCollectionsWithinParent`, `moveCollectionBetweenParents`, `getSectionDropTarget`, `normalizeParentId`). Keep all `buildGroupedAllCollectionSections` and `ROOT_LEVEL_SECTION_ID` tests. The same behaviors remain covered by `tests/collectionSectionDragEngine.test.js`.

- [ ] **Step 4: Verify**

Run: `yarn jest tests/fpCollectionSections.test.js tests/collectionSectionDragEngine.test.js && yarn lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/fullpage/fpCollectionSections.js tests/fpCollectionSections.test.js
git commit -m "refactor(fp): delete superseded grouped-section drag engine duplicates"
```

### Task 3: Replace hand-rolled `reorderSidebarFolders` body with `arrayMove`

**Files:**
- Modify: `app/fullpage/sidebarFolderReorder.js`

- [ ] **Step 1: Run its tests (they define the contract — keep them all)**

Run: `yarn jest tests/sidebarFolderReorder.test.js`
Expected: PASS

- [ ] **Step 2: Simplify the implementation**

```js
import { arrayMove } from '@dnd-kit/sortable';

export const reorderSidebarFolders = (folders = [], activeId, overId) => {
    if (!Array.isArray(folders) || !activeId || !overId || activeId === overId) {
        return folders;
    }

    const activeIndex = folders.findIndex((folder) => folder.uid === activeId);
    const overIndex = folders.findIndex((folder) => folder.uid === overId);

    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
        return folders;
    }

    return arrayMove(folders, activeIndex, overIndex);
};
```

- [ ] **Step 3: Verify and commit**

Run: `yarn jest tests/sidebarFolderReorder.test.js`
Expected: PASS

```bash
git add app/fullpage/sidebarFolderReorder.js
git commit -m "refactor(fp-sidebar): reuse dnd-kit arrayMove for folder reorder"
```

### Task 4: Phase 1 build verification

- [ ] **Step 1:** Run `yarn test` — expected: full suite PASS.
- [ ] **Step 2:** Run `yarn prod` — expected: build succeeds.
- [ ] **Step 3:** Commit anything pending.

---

## Phase 2 — Shared DnD foundation

### Task 5: Create `app/utils/dndShared.js` (sensor config + constants)

**Files:**
- Create: `app/utils/dndShared.js`
- Test: `tests/dndShared.test.js`
- Modify: `app/fullpage/FPSidebar.js`, `app/fullpage/FPContentArea.js`, `app/ExpandedCollectionData.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/dndShared.test.js
import { DND_ACTIVATION_DISTANCE, dndPointerSensorOptions } from '../app/utils/dndShared';

describe('dndShared', () => {
    test('exposes a single activation distance used by all drag contexts', () => {
        expect(DND_ACTIVATION_DISTANCE).toBe(5);
    });

    test('pointer sensor options use the shared activation distance', () => {
        expect(dndPointerSensorOptions).toEqual({
            activationConstraint: { distance: 5 },
        });
    });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `yarn jest tests/dndShared.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// app/utils/dndShared.js
// Single source of truth for drag-and-drop interaction tuning so every
// DndContext (sidebar folders, collection cards, detail-panel tabs) feels identical.
export const DND_ACTIVATION_DISTANCE = 5;

export const dndPointerSensorOptions = Object.freeze({
    activationConstraint: Object.freeze({ distance: DND_ACTIVATION_DISTANCE }),
});
```

- [ ] **Step 4: Run test to verify pass**

Run: `yarn jest tests/dndShared.test.js`
Expected: PASS

- [ ] **Step 5: Adopt in all three contexts**

1. `FPSidebar.js:232-234` (this also fixes the 6 px vs 5 px inconsistency):
```js
    const folderSortSensors = useSensors(
        useSensor(PointerSensor, dndPointerSensorOptions),
    );
```
2. `FPContentArea.js:2057-2059`:
```js
    const sensors = useSensors(
        useSensor(PointerSensor, dndPointerSensorOptions)
    );
```
3. `ExpandedCollectionData.js:90-96`:
```js
    const sensors = useSensors(
        useSensor(PointerSensor, dndPointerSensorOptions),
    );
```
Add `import { dndPointerSensorOptions } from '../utils/dndShared';` (path `./utils/dndShared` from `app/ExpandedCollectionData.js`).

- [ ] **Step 6: Verify and commit**

Run: `yarn jest tests/dndShared.test.js tests/FPSidebar.test.js tests/collectionDragComponents.test.js && yarn lint`
Expected: PASS

```bash
git add app/utils/dndShared.js tests/dndShared.test.js app/fullpage/FPSidebar.js app/fullpage/FPContentArea.js app/ExpandedCollectionData.js
git commit -m "feat(dnd): shared sensor config; unify activation distance to 5px"
```

### Task 6: One sidebar hit-test path (kill the duplicate mousemove tracker)

Today the sidebar hover highlight (FPSidebar `mousemove` effect, lines 141-172) and the actual drop (`FPContentArea.findSidebarDropTarget`, lines 2324-2340) are two copies of the same rect-scanning loop. Consolidate: extract one utility, have `FPContentArea`'s `onDragMove` publish the hovered sidebar target into the existing `draggingCollectionState` atom, and have `FPSidebar` simply read it.

**Files:**
- Create: `app/fullpage/sidebarDropTargets.js`
- Test: `tests/sidebarDropTargets.test.js`
- Modify: `app/fullpage/FPContentArea.js`, `app/fullpage/FPSidebar.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/sidebarDropTargets.test.js
import { findSidebarDropTarget } from '../app/fullpage/sidebarDropTargets';

const mockRect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});

describe('findSidebarDropTarget', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('returns the folder uid whose rect contains the point', () => {
        document.body.innerHTML = `
            <div data-sidebar-folder-uid="folder-1"></div>
            <div data-sidebar-folder-uid="folder-2"></div>
            <div data-sidebar-no-folder="true"></div>
        `;
        const [f1, f2, root] = document.body.children;
        f1.getBoundingClientRect = () => mockRect(0, 0, 200, 40);
        f2.getBoundingClientRect = () => mockRect(0, 40, 200, 40);
        root.getBoundingClientRect = () => mockRect(0, 80, 200, 40);

        expect(findSidebarDropTarget(100, 60)).toBe('folder-2');
    });

    test('returns "no-folder" when the point is over the root-level item', () => {
        document.body.innerHTML = '<div data-sidebar-no-folder="true"></div>';
        document.body.firstElementChild.getBoundingClientRect = () => mockRect(0, 0, 200, 40);

        expect(findSidebarDropTarget(10, 10)).toBe('no-folder');
    });

    test('returns null when the point is outside every sidebar target', () => {
        document.body.innerHTML = '<div data-sidebar-folder-uid="folder-1"></div>';
        document.body.firstElementChild.getBoundingClientRect = () => mockRect(0, 0, 200, 40);

        expect(findSidebarDropTarget(500, 500)).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `yarn jest tests/sidebarDropTargets.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (move the existing logic verbatim from `FPContentArea.js:2324-2340`)**

```js
// app/fullpage/sidebarDropTargets.js
// Hit-tests the sidebar folder rows (and the root-level item) at a viewport
// point. Used while dragging a collection card so the sidebar can act as a
// cross-context drop target without belonging to the content DndContext.
export const findSidebarDropTarget = (x, y) => {
    const folderItems = document.querySelectorAll('[data-sidebar-folder-uid]');
    for (const item of folderItems) {
        const rect = item.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return item.getAttribute('data-sidebar-folder-uid');
        }
    }
    const noFolderItem = document.querySelector('[data-sidebar-no-folder]');
    if (noFolderItem) {
        const rect = noFolderItem.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return 'no-folder';
        }
    }
    return null;
};
```

- [ ] **Step 4: Run test to verify pass**

Run: `yarn jest tests/sidebarDropTargets.test.js`
Expected: PASS

- [ ] **Step 5: Use it in FPContentArea and publish hover state through the atom**

1. Delete the local `findSidebarDropTarget` (lines 2324-2340) and import the new module:
```js
import { findSidebarDropTarget } from './sidebarDropTargets';
```
2. Add a drag-move handler near `handleDragOver` that publishes the hovered sidebar target only when it changes (atom writes per pointer move are what we are avoiding):
```js
    const lastSidebarHoverRef = useRef(null);

    const handleDragMove = (event) => {
        if (!activeCollection) {
            return;
        }

        const point = getActualPointerCoordinates(event);
        const sidebarTarget = point ? findSidebarDropTarget(point.x, point.y) : null;

        if (lastSidebarHoverRef.current === sidebarTarget) {
            return;
        }

        lastSidebarHoverRef.current = sidebarTarget;
        setDraggingCollection({ collection: activeCollection, overSidebarTarget: sidebarTarget });
    };
```
3. Register it on the DndContext (`FPContentArea.js:3828-3836`): add `onDragMove={handleDragMove}`.
4. In `resetDragState` (2183-2190) add `lastSidebarHoverRef.current = null;`.
5. `handleDragStart` already calls `setDraggingCollection({ collection: col })` — no change needed (`overSidebarTarget` is simply undefined until the first move).

- [ ] **Step 6: Simplify FPSidebar to read the atom instead of tracking mousemove**

In `FPSidebar.js`:
1. Delete the `dragOverTargetId` state (line 139) and the entire `mousemove` effect (lines 141-172).
2. Replace its usages:
```js
    const draggingCollection = useAtomValue(draggingCollectionState);
    const isDraggingCollection = draggingCollection !== null;
    const dragOverTargetId = draggingCollection?.overSidebarTarget ?? null;
```
The rest of the highlight logic (`isNoFolderHovered`, per-folder `isHovered`) is unchanged.

- [ ] **Step 7: Verify**

Run: `yarn jest tests/FPSidebar.test.js tests/sidebarDropTargets.test.js && yarn lint && yarn prod`
Expected: PASS, build OK.

Manual check (load `build/` unpacked, open full page view): drag a card over each folder → folder highlights exactly as before; drop into folder moves the collection and fires the lightning effect; drop on "Root Level" moves to root; folders stop highlighting the instant the pointer leaves the sidebar.

- [ ] **Step 8: Commit**

```bash
git add app/fullpage/sidebarDropTargets.js tests/sidebarDropTargets.test.js app/fullpage/FPContentArea.js app/fullpage/FPSidebar.js
git commit -m "refactor(fp): single sidebar drop hit-test path shared by hover and drop"
```

---

## Phase 3 — Visual & UX unification

### Task 7: Introduce DnD accent tokens and migrate all indicator CSS to them

**Files:**
- Modify: `static/index.css` (global tokens), `app/DropGap.css`, `app/fullpage/FPContentArea.css`, `app/CollectionList.css`, `app/fullpage/FPSidebar.css`

- [ ] **Step 1: Add tokens to `static/index.css`** (next to the existing theme variables; verify `--primary-color` is defined there or in the theme root and place these in the same `:root` block):

```css
/* ---- Drag & drop design tokens ---- */
:root {
    --dnd-accent: var(--primary-color);
    --dnd-accent-border: color-mix(in srgb, var(--dnd-accent) 72%, transparent);
    --dnd-accent-border-soft: color-mix(in srgb, var(--dnd-accent) 50%, transparent);
    --dnd-accent-bg: color-mix(in srgb, var(--dnd-accent) 14%, transparent);
    --dnd-accent-bg-soft: color-mix(in srgb, var(--dnd-accent) 6%, transparent);
    --dnd-overlay-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    --dnd-source-opacity: 0.35;
}
```

- [ ] **Step 2: Migrate `DropGap.css`** — replace every `rgba(22, 152, 226, …)` (and the dark-theme `rgba(58,119,216,…)`/`rgba(96,165,250,…)` overrides) with the tokens:

```css
.drop-gap-indicator {
	position: absolute;
	inset: 0;
	box-sizing: border-box;
	background: linear-gradient(135deg, var(--dnd-accent-bg) 0%, var(--dnd-accent-bg-soft) 100%);
	border: 2px dashed var(--dnd-accent-border);
	border-radius: 6px;
	box-shadow: 0 0 0 1px var(--dnd-accent-bg);
	pointer-events: none;
	animation: drop-gap-pulse 1.1s ease-in-out infinite;
}
```
Delete the `[data-theme="dark"] .drop-gap-indicator` color override (tokens follow the theme automatically since `--primary-color` does); keep the dark-theme border-radius rule only if it differs (it doesn't — delete it too).

- [ ] **Step 3: Migrate `FPContentArea.css:1130-1151`** (`.fp-collection-insert-gap`, `.fp-grouped-insert-gap`) to the same border/background tokens:

```css
.fp-collection-insert-gap,
.fp-grouped-insert-gap {
    min-height: var(--fp-grid-card-height, 150px);
    border: 2px dashed var(--dnd-accent-border-soft);
    border-radius: var(--fp-card-radius, 16px);
    background: linear-gradient(135deg, var(--dnd-accent-bg) 0%, var(--dnd-accent-bg-soft) 100%);
    animation: drop-gap-pulse 1.1s ease-in-out infinite;
}
```
(Keep the existing `.fp-content-list-mode` size override at 1147-1151.) Move `@keyframes drop-gap-pulse` to `static/index.css` so both files can use it, and delete the duplicate from `DropGap.css`.

- [ ] **Step 4: Migrate `CollectionList.css:1295-1313`** (`.collection-edge-drop-zone`, label) — replace `rgba(22, 152, 226, 0.18)` → `var(--dnd-accent-bg)`, `rgba(22, 152, 226, 0.72)` → `var(--dnd-accent-border)`, `rgba(22, 152, 226, 0.88)` → `var(--dnd-accent)`.

- [ ] **Step 5: Re-point `FPSidebar.css:428-457`** drop classes at the tokens (behavior identical, just shared source):

```css
.fp-sidebar-drop-active {
    outline: 1.5px dashed var(--dnd-accent-border-soft);
    outline-offset: -1.5px;
    background: var(--dnd-accent-bg-soft);
}

.fp-sidebar-drop-over {
    outline: 2px solid var(--dnd-accent);
    outline-offset: -2px;
    background: var(--dnd-accent-bg);
}
```
Keep the existing transitions; delete the dark-theme overrides at 449-457 (tokens adapt).

- [ ] **Step 6: Migrate `DroppableCollection.js` (cross-collection card target) from inline styles to a tokened class.** Replace the inline `style` object with:

```js
    return (
        <div
            className={`dnd-container-target${showDropZone ? ' is-over' : ''}`}
            data-collection-drop-zone={disabled ? undefined : 'true'}
            data-collection-uid={disabled ? undefined : collection.uid}
        >
            {children}
        </div>
    );
```
(keep `position: relative` — fold it into the class) and add to `static/index.css`:

```css
.dnd-container-target {
    position: relative;
    border-radius: 8px;
    transition: background 0.15s ease, box-shadow 0.15s ease;
}

.dnd-container-target.is-over {
    background: var(--dnd-accent-bg);
    box-shadow: inset 0 0 0 2px var(--dnd-accent), 0 0 0 2px var(--dnd-accent-bg);
}
```
This kills the fifth indicator variant and its divergent `52, 152, 219` fallback. Check `tests/FolderDropWrappers.test.js` and `tests/collectionDragComponents.test.js` for assertions on the old inline styles and update them to assert the class instead.

- [ ] **Step 7: Search for stragglers**

Run: `grep -rn "22, 152, 226\|52, 152, 219" app/ static/`
Expected: zero hits in DnD-related rules (any remaining hits are non-DnD styles — leave them).

- [ ] **Step 8: Verify**

Run: `yarn test && yarn prod`, load the build, check in **both light and dark themes**: tab drop gap, group drop gap, collection insert gap (list + grid), sidebar folder highlight, detail-panel edge zones, foreign-card highlight while dragging a tab over another collection. All indicators should now share the same accent family.

- [ ] **Step 9: Commit**

```bash
git add static/index.css app/DropGap.css app/fullpage/FPContentArea.css app/CollectionList.css app/fullpage/FPSidebar.css app/DroppableCollection.js tests/
git commit -m "style(dnd): unify all drop indicators on shared accent tokens"
```

### Task 8: Shared drag-overlay class; remove inline overlay styles

**Files:**
- Modify: `static/index.css`, `app/ExpandedCollectionData.js`, `app/fullpage/FPCollectionCard.css`

- [ ] **Step 1: Add the shared class to `static/index.css`:**

```css
.dnd-drag-overlay {
    box-shadow: var(--dnd-overlay-shadow);
    border-radius: 8px;
    overflow: hidden;
    cursor: grabbing;
    opacity: 0.92;
}

.dnd-drag-overlay--group {
    width: min(400px, 90vw);
}
```

- [ ] **Step 2: Replace the inline-styled overlay wrappers in `ExpandedCollectionData.js:815-856`:**

```jsx
                {createPortal(
                    <DragOverlay adjustScale={false} dropAnimation={null}>
                        {activeOverlay?.kind === 'group' ? (
                            <div className="dnd-drag-overlay dnd-drag-overlay--group">
                                <GroupContainer
                                    group={activeOverlay.group}
                                    tabs={activeOverlay.tabs}
                                    onSaveGroupColor={() => {}}
                                    onSaveGroupName={() => {}}
                                    onDeleteGroup={() => {}}
                                    onOpenGroupTabs={() => {}}
                                    isExpanded={false}
                                    isDragging
                                />
                            </div>
                        ) : activeOverlay?.kind === 'tab' ? (
                            <div className="dnd-drag-overlay">
                                <TabRow
                                    tab={activeOverlay.tab}
                                    updateCollection={props.updateCollection}
                                    collection={baseCollection}
                                    group={groupFromId(activeOverlay.tab.groupUid, baseCollection.chromeGroups)}
                                    isDragging
                                />
                            </div>
                        ) : null}
                    </DragOverlay>,
                    document.body,
                )}
```

- [ ] **Step 3: Make the FP card overlay extend the shared class.** In `FPContentArea.js:3847-3851` add the class: `className="fp-card-drag-overlay dnd-drag-overlay"`. In `FPCollectionCard.css:1032-1035` drop the now-duplicated `opacity` and keep only what's card-specific:

```css
.fp-card-drag-overlay {
    box-shadow: var(--fp-shadow-xl);
}
```
(`--fp-shadow-xl` wins over the shared shadow because it's declared after — verify visually; if specificity bites, use `.fp-card-drag-overlay.dnd-drag-overlay`.)

- [ ] **Step 4: Verify** — `yarn jest tests/collectionDragComponents.test.js && yarn prod`; drag a tab, a group, and a card: all three overlays show the same lift treatment (shadow, slight transparency, grabbing cursor).

- [ ] **Step 5: Commit**

```bash
git add static/index.css app/ExpandedCollectionData.js app/fullpage/FPContentArea.js app/fullpage/FPCollectionCard.css
git commit -m "style(dnd): shared drag-overlay treatment across cards, tabs, groups"
```

### Task 9: Unify the source-item-while-dragging treatment

**Files:**
- Modify: `app/SortableTabRow.js`, `app/fullpage/FPContentArea.js` (SortableFPCard), `app/fullpage/FPSidebar.css`, `app/SortableGroupContainer.js` (check its isDragging style first)

- [ ] **Step 1:** In `SortableTabRow.js:28` change `opacity: isDragging ? 0.25 : 1` → `opacity: isDragging ? 0.35 : 1`.
- [ ] **Step 2:** In `SortableFPCard` (`FPContentArea.js:817`) change `opacity: isDragging && !hideWhileDragging ? 0.5 : undefined` → `0.35`. The list-mode collapse path stays untouched.
- [ ] **Step 3:** Check `SortableGroupContainer.js` for its `isDragging` opacity (grep `isDragging`) and align it to `0.35` if it sets one.
- [ ] **Step 4:** In `FPSidebar.css`, give the sorted folder row the same dimming so folder drag matches (`.fp-sidebar-folder-row-sorting` currently only raises z-index):

```css
.fp-sidebar-folder-row-sorting {
    z-index: 2;
    opacity: var(--dnd-source-opacity, 0.35);
}
```
Note: the folder row has no DragOverlay — the row itself moves — so instead of dimming it, keep it fully opaque and keep the existing lift shadow (`FPSidebar.css:320-323`). **Decision: leave folder row opacity alone; only items that leave a ghost behind get dimmed.** Apply the rule "dim the in-flow ghost to 0.35; the moving element (overlay or transformed row) stays opaque."
- [ ] **Step 5:** Verify visually (grid card drag, list card drag, tab drag, group drag, folder drag), then `yarn prod` and commit:

```bash
git add app/SortableTabRow.js app/fullpage/FPContentArea.js app/SortableGroupContainer.js
git commit -m "style(dnd): consistent 0.35 source-item dimming during drags"
```

### Task 10: Settle highlight for dropped tabs/groups (parity with collections)

Collections flash after a drop via `highlightedCollectionUidState`; tabs/groups give no landing feedback.

**Files:**
- Modify: `app/ExpandedCollectionData.js`, `app/TabRow.css` (or co-located CSS — check where `.collection-draggable-tab` styles live), `app/GroupContainer.css`

- [ ] **Step 1:** Add local state in `ExpandedCollectionData`:

```js
    const [settledItemId, setSettledItemId] = useState(null);
    const settleTimerRef = useRef(null);

    useEffect(() => () => clearTimeout(settleTimerRef.current), []);

    const flashSettledItem = (itemId) => {
        clearTimeout(settleTimerRef.current);
        setSettledItemId(itemId);
        settleTimerRef.current = setTimeout(() => setSettledItemId(null), 900);
    };
```

- [ ] **Step 2:** In `handleDragEnd`, right after `setOptimisticCollection(updatedCollection)` (line 505), call `flashSettledItem(currentSession.itemId);`.

- [ ] **Step 3:** Thread it to rows: pass `isSettled={settledItemId === tab.uid}` into each `SortableTabRow` and `isSettled={settledItemId === item.groupUid}` into `SortableGroupContainer`; in `SortableTabRow.js` add to the wrapper div `className={`collection-draggable-tab${props.isSettled ? ' dnd-settled' : ''}`}` and do the analogous className addition in `SortableGroupContainer.js`.

- [ ] **Step 4:** Add the animation to `static/index.css`:

```css
.dnd-settled {
    animation: dnd-settle-flash 0.9s ease-out;
}

@keyframes dnd-settle-flash {
    0% { background: var(--dnd-accent-bg); box-shadow: inset 0 0 0 2px var(--dnd-accent-border); }
    100% { background: transparent; box-shadow: none; }
}
```

- [ ] **Step 5:** Verify: drop a tab and a group within a collection → brief accent flash at the landing position. `yarn jest tests/collectionDragComponents.test.js && yarn prod`.

- [ ] **Step 6: Commit**

```bash
git add app/ExpandedCollectionData.js app/SortableTabRow.js app/SortableGroupContainer.js static/index.css
git commit -m "feat(dnd): settle flash on dropped tabs and groups, matching collections"
```

### Task 10.5: Implement the indicator visibility policy (no-op suppression + ambient affordance)

Brings collection drags up to the gating standard tabs already have, and makes container-target discovery consistent (see "Indicator visibility policy" in the design spec).

**Files:**
- Modify: `app/fullpage/FPContentArea.js` (handleDragOver, section header render), `app/fullpage/FPSidebar.js`, `static/index.css`, `app/fullpage/FPSidebar.css`

- [ ] **Step 1: Suppress no-op collection previews.** In `handleDragOver` (`FPContentArea.js`), after a `resolvedTarget`/`nextTarget` is determined and before storing it, gate it through the engine:

```js
        const operation = resolveCollectionDropOperation({
            collections: sourceCollections,
            folders,
            activeId: activeCollection.uid,
            target: nextTargetWithSide, // the collection-kind target after side resolution, or the section target
            viewMode,
            sortBy: sortByField,
            sortOrder,
        });

        if (!operation) {
            setPreviewTarget(null);
            previewTargetRef.current = null;
            return;
        }
```
Apply to both the collection-kind branch (after `side` is resolved) and the section-kind fallthrough at the end of the handler. Do **not** clear `lastMeaningfulDropTargetRef` on no-op — leave it holding the last *meaningful* target, which is its job. `resolveCollectionDropOperation` is pure and already covered by `tests/collectionSectionDragEngine.test.js`; this step only adds the call site.

- [ ] **Step 2: Exclude "Root Level" as a target when the dragged collection is already at root.** In `FPSidebar.js`, replace line 524:

```js
    const draggedParentId = draggingCollection?.collection?.parentId || null;
    const draggedIsAtRoot = !draggedParentId || !folders.some((folder) => folder.uid === draggedParentId);
    const isNoFolderDropTarget = isDraggingCollection && !draggedIsAtRoot;
```
(The `folders.some` check mirrors `normalizeCollectionParentId` — a parentId pointing at a deleted folder counts as root.)

- [ ] **Step 3: Ambient affordance on content-area section headers.** Add shared ambient classes to `static/index.css`:

```css
.dnd-drop-ambient {
    outline: 1.5px dashed var(--dnd-accent-border-soft);
    outline-offset: -1.5px;
    background: var(--dnd-accent-bg-soft);
    border-radius: 10px;
}
```
In `renderGroupedAllCollections` (`FPContentArea.js`), extend the section header dropzone className so every section that is a *valid, non-current* target shows the cue while a card is dragged:

```js
                    <FPSectionDropZone
                        className={`fp-grouped-section-header-dropzone${isCollapsed ? ' collapsed' : ''}${
                            activeCollection && normalizedSectionParentId !== activeParentId ? ' dnd-drop-ambient' : ''
                        }`}
                        parentId={normalizedSectionParentId}
                        canHighlight={isCollapsedSectionTarget}
                    >
```
Give the empty-section dropzone the same treatment (`FPSectionContentDropZone` call site: append `dnd-drop-ambient` to its className under the same condition).

- [ ] **Step 4: Converge the sidebar's ambient style on the shared class.** In `FPSidebar.css`, redefine `.fp-sidebar-drop-active` as a grouping with the shared rule so both surfaces stay in lock-step:

```css
.fp-sidebar-drop-active,
.dnd-drop-ambient {
    outline: 1.5px dashed var(--dnd-accent-border-soft);
    outline-offset: -1.5px;
    background: var(--dnd-accent-bg-soft);
}
```
(Keep the `.fp-sidebar-drop-over` strong-hover rule as-is; class names stay stable for the e2e specs.)

- [ ] **Step 5: Verify**

Run: `yarn test && yarn prod`. Manual: drag a card that lives in folder A → folder A's section header and sidebar row show **no** affordance; every other folder + Root Level (if the card isn't at root) shows the dashed ambient cue; hovering one upgrades it to the strong highlight; in list mode no insert gap appears around the card's own position.

- [ ] **Step 6: Commit**

```bash
git add app/fullpage/FPContentArea.js app/fullpage/FPSidebar.js app/fullpage/FPSidebar.css static/index.css
git commit -m "feat(dnd): no-op suppression and ambient drop affordances per indicator policy"
```

---

## Phase 4 — Performance

### Task 11: Stop per-mousemove atom writes in `useCollectionItemCrossDrag`

`setDragSession` currently fires on every pointer move (pointer x/y in the atom), re-rendering every subscriber — including `FPContentArea` — for the whole drag. Only `overCollectionUid` changes need to hit the atom; the pointer goes in a ref. (`ExpandedCollectionData` derives the live pointer itself from `session.pointer` + dnd-kit deltas, and `handleMouseUp` reads coordinates from the event — nothing consumes the atom's live pointer.)

**Files:**
- Modify: `app/useCollectionItemCrossDrag.js`
- Test: `tests/useCollectionItemCrossDrag.test.js`

- [ ] **Step 1: Write the failing test.** Add to `tests/useCollectionItemCrossDrag.test.js`, reusing its existing `PopupHarness`, `makeTab`, and Jotai-store setup (mousemove is rAF-throttled in the hook, so stub `requestAnimationFrame` to run callbacks synchronously):

```js
    test('does not rewrite the drag session atom when the hovered collection is unchanged', async () => {
        const sourceCollection = { uid: 'source', tabs: [makeTab('tab-a')], chromeGroups: [] };
        const targetCollection = { uid: 'target', tabs: [], chromeGroups: [] };
        const store = createStore();
        const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });

        store.set(dragSessionState, {
            kind: 'tab',
            itemId: 'tab-a',
            sourceCollectionUid: sourceCollection.uid,
            snapshot: { tab: sourceCollection.tabs[0] },
            pointer: { x: 10, y: 10 },
            overCollectionUid: null,
        });

        const { container } = render(
            <Provider store={store}>
                <PopupHarness
                    sourceCollection={sourceCollection}
                    targetCollection={targetCollection}
                    updateCollection={jest.fn(() => Promise.resolve())}
                    onDataUpdate={jest.fn(() => Promise.resolve())}
                />
            </Provider>,
        );

        document.elementsFromPoint = jest.fn(() => [container.querySelector('[data-collection-uid="target"]')]);

        fireEvent.mouseMove(document, { clientX: 20, clientY: 20 });
        const sessionAfterFirstMove = store.get(dragSessionState);
        expect(sessionAfterFirstMove.overCollectionUid).toBe('target');

        fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
        // Same hovered collection — the atom value must be referentially unchanged.
        expect(store.get(dragSessionState)).toBe(sessionAfterFirstMove);

        rafSpy.mockRestore();
    });
```

- [ ] **Step 2:** Run `yarn jest tests/useCollectionItemCrossDrag.test.js` — the new test should FAIL (pointer x/y currently changes the object every move).

- [ ] **Step 3: Implement** — replace `updatePointer` (lines 61-85):

```js
        const updatePointer = (x, y) => {
            const current = dragSessionRef.current;
            const overCollectionUid = readOverCollectionUid(x, y, current?.sourceCollectionUid);

            setDragSession((session) => {
                if (!session || session.overCollectionUid === overCollectionUid) {
                    return session;
                }

                return {
                    ...session,
                    overCollectionUid,
                };
            });
        };
```
(The `pointer` field set at drag start stays in the session — `ExpandedCollectionData.handleDragMove` uses it as the delta base. It just stops being rewritten per move.)

- [ ] **Step 4:** Run `yarn jest tests/useCollectionItemCrossDrag.test.js tests/collectionDragComponents.test.js` — expected: PASS. If an existing test asserted per-move pointer updates, update it to the new contract.

- [ ] **Step 5:** Manual verify: drag a tab from an open detail panel onto another collection card → card hover state appears, drop transfers the tab; drag within the panel still reorders smoothly.

- [ ] **Step 6: Commit**

```bash
git add app/useCollectionItemCrossDrag.js tests/useCollectionItemCrossDrag.test.js
git commit -m "perf(dnd): only update cross-drag atom when hovered collection changes"
```

### Task 12: Lazy `closestCorners` in the content-area collision detection

`FPContentArea.js:2098-2114` computes `closestCorners(args)` and the derived `collectionTargets`/`sectionTargets` arrays on every collision pass, even when pointer collisions win (the common case while hovering cards).

**Files:**
- Modify: `app/fullpage/FPContentArea.js:2061-2176`

- [ ] **Step 1:** Restructure `customCollisionDetection` so the corner pass is computed only on the branches that need it. Keep behavior identical:

```js
    const customCollisionDetection = useCallback((args) => {
        if (dragSession) {
            return [];
        }

        const activeId = args.active?.id;
        const pointerCollisions = pointerWithin(args);

        const isCollectionCollision = (collision) => {
            const collisionId = typeof collision.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision.id;
            return collisionId !== activeId && displayCollections.some((collection) => collection.uid === collisionId);
        };
        const isSectionCollision = (collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            return dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty;
        };
        const getCollisionParentId = (collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            const dataParentId = collision?.data?.droppableContainer?.data?.current?.parentId;

            if (
                dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty
            ) {
                return dataParentId || null;
            }

            const collisionId = typeof collision?.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision?.id;
            const collection = displayCollections.find((entry) => entry.uid === collisionId);
            return collection ? normalizeCollectionParentId(collection, folderUidSet) : undefined;
        };

        const pointerCollectionTargets = pointerCollisions.filter(isCollectionCollision);
        const pointerSectionTargets = pointerCollisions.filter(isSectionCollision);

        if (shouldRenderGroupedAllCollections) {
            if (pointerCollectionTargets.length > 0) {
                return pointerCollectionTargets;
            }

            if (viewMode === 'grid') {
                if (pointerSectionTargets.length > 0) {
                    const hoveredParentId = getCollisionParentId(pointerSectionTargets[0]);
                    const cornerCollectionTargets = closestCorners(args).filter((collision) => (
                        isCollectionCollision(collision) && getCollisionParentId(collision) === hoveredParentId
                    ));

                    if (cornerCollectionTargets.length > 0) {
                        return cornerCollectionTargets;
                    }

                    return pointerSectionTargets;
                }

                return [];
            }

            if (pointerSectionTargets.length > 0) {
                return pointerSectionTargets;
            }

            // List mode fallback: widen with corner collisions only when the
            // pointer found nothing.
            const cornerCollisions = closestCorners(args);
            const uniqueCollisions = [...pointerCollisions, ...cornerCollisions].filter((collision, index, array) => (
                index === array.findIndex((entry) => entry.id === collision.id)
            ));
            const collectionTargets = uniqueCollisions.filter(isCollectionCollision);

            if (collectionTargets.length > 0) {
                return collectionTargets;
            }

            const sectionTargets = uniqueCollisions.filter(isSectionCollision);

            if (sectionTargets.length > 0) {
                return sectionTargets;
            }

            return [];
        }

        if (canReorderFlatCollections) {
            const cornerCollisions = closestCorners(args);
            const uniqueCollisions = [...pointerCollisions, ...cornerCollisions].filter((collision, index, array) => (
                index === array.findIndex((entry) => entry.id === collision.id)
            ));
            const collectionTargets = uniqueCollisions.filter(isCollectionCollision);

            if (collectionTargets.length > 0) {
                return collectionTargets;
            }

            return [];
        }

        return [];
    }, [
        canReorderFlatCollections,
        dragSession,
        displayCollections,
        folderUidSet,
        shouldRenderGroupedAllCollections,
        viewMode,
    ]);
```

- [ ] **Step 2:** Run `yarn test` (collision detection has no direct unit test; the component tests and engine tests must stay green) and `yarn prod`.

- [ ] **Step 3:** Manual verify in the build, list + grid, grouped "All Collections" view: hover between two cards, hover section headers, hover empty folders, drag into a collapsed folder header. Behavior must match pre-change.

- [ ] **Step 4: Commit**

```bash
git add app/fullpage/FPContentArea.js
git commit -m "perf(dnd): compute corner collisions lazily in content-area collision detection"
```

### Task 13: Single DOM scan per dragOver for grouped-section hit testing

`handleDragOver` (`FPContentArea.js:2236-2322`) can invoke up to three helpers that each run `document.querySelectorAll('[data-grouped-section-body-parent-id]')` + per-card `getBoundingClientRect`. Consolidate into one scan.

**Files:**
- Create: `app/fullpage/groupedSectionHitTest.js`
- Test: `tests/groupedSectionHitTest.test.js`
- Modify: `app/fullpage/FPContentArea.js` (delete `findGroupedSectionBodyTargetAtPoint`, `findGroupedEmptySectionTargetAtPoint`, `findGroupedGridCollectionTargetAtPoint`, lines 490-673)

- [ ] **Step 1: Write the failing test.** Build DOM fixtures the same way `tests/sidebarDropTargets.test.js` does (mock `getBoundingClientRect`). Cover the four behaviors the three old helpers implemented (use the exact slack constants from the current code — `emptySectionTopSlack` 32, `emptySectionBottomSlack` 64, band slack `Math.max(24, Math.min(40, cardHeight / 2))`, `extraBottomHit` 64, empty-section `hitSlop` 18):

```js
// tests/groupedSectionHitTest.test.js
import { resolveGroupedSectionTarget } from '../app/fullpage/groupedSectionHitTest';
import { collectionDropKinds, collectionDropSides } from '../app/utils/collectionSectionDragEngine';

const mockRect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});

// Builds <div data-grouped-section-body-parent-id> with optional
// [data-sortable-collection-id] cards, all with mocked rects.
const buildSection = (parentId, rect, cards = []) => {
    const body = document.createElement('div');
    body.setAttribute('data-grouped-section-body-parent-id', parentId);
    body.getBoundingClientRect = () => rect;
    cards.forEach(({ id, rect: cardRect }) => {
        const card = document.createElement('div');
        card.setAttribute('data-sortable-collection-id', id);
        card.getBoundingClientRect = () => cardRect;
        body.appendChild(card);
    });
    document.body.appendChild(body);
    return body;
};

describe('resolveGroupedSectionTarget', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('empty section returns sectionEmpty within the 18px hit slop', () => {
        buildSection('folder-1', mockRect(0, 100, 400, 80));

        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 90 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionEmpty, parentId: 'folder-1' });
    });

    test('empty root section maps __root__ to a null parentId', () => {
        buildSection('__root__', mockRect(0, 100, 400, 80));

        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 140 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionEmpty, parentId: null });
    });

    test('list mode: top band returns sectionStart, bottom band returns sectionEnd', () => {
        buildSection('folder-1', mockRect(0, 100, 400, 200), [
            { id: 'col-a', rect: mockRect(0, 110, 400, 56) },
            { id: 'col-b', rect: mockRect(0, 170, 400, 56) },
        ]);

        // top band: within ±max(24, min(40, 56/2)) = ±28 of the first card's top
        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 110 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionStart, parentId: 'folder-1' });

        // bottom band: between lastRect.bottom - 28 and lastRect.bottom + 64
        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 250 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionEnd, parentId: 'folder-1' });
    });

    test('grid mode: returns the nearest non-active card with a side', () => {
        buildSection('folder-1', mockRect(0, 0, 600, 200), [
            { id: 'col-a', rect: mockRect(0, 20, 200, 150) },
            { id: 'col-b', rect: mockRect(220, 20, 200, 150) },
        ]);

        // Pointer in the left half of col-b's middle vertical band → before
        expect(resolveGroupedSectionTarget({ point: { x: 260, y: 95 }, viewMode: 'grid', activeId: 'col-x' }))
            .toEqual({
                kind: collectionDropKinds.collection,
                parentId: 'folder-1',
                collectionId: 'col-b',
                side: collectionDropSides.before,
            });
    });

    test('grid mode: skips the active card when finding the nearest target', () => {
        buildSection('folder-1', mockRect(0, 0, 600, 200), [
            { id: 'col-a', rect: mockRect(0, 20, 200, 150) },
            { id: 'col-b', rect: mockRect(220, 20, 200, 150) },
        ]);

        const target = resolveGroupedSectionTarget({ point: { x: 100, y: 95 }, viewMode: 'grid', activeId: 'col-a' });
        expect(target.collectionId).toBe('col-b');
    });

    test('returns null when the point is outside every section', () => {
        buildSection('folder-1', mockRect(0, 100, 400, 80));

        expect(resolveGroupedSectionTarget({ point: { x: 900, y: 900 }, viewMode: 'list', activeId: 'col-x' }))
            .toBeNull();
    });
});
```

Note: jsdom returns zero-size rects by default, which the current code filters out as invisible cards — the mocked `getBoundingClientRect` above is what makes these tests meaningful.

- [ ] **Step 2:** Run `yarn jest tests/groupedSectionHitTest.test.js` — FAIL (module not found).

- [ ] **Step 3: Implement** `resolveGroupedSectionTarget({ point, viewMode, activeId })`: one `querySelectorAll('[data-grouped-section-body-parent-id]')` loop; for each body read the rect once and the card rects once, then evaluate in priority order — (1) empty-section hit (both modes, with the 18px slop and the 32/64 slack variants from the current code), (2) grid: nearest-card with `getCollectionTargetSide({viewMode: 'grid', …})`, (3) list: start/end bands. Port the bodies of the three deleted functions verbatim into the single loop; the logic is already correct — this task only removes redundant DOM passes.

- [ ] **Step 4:** Replace the call sites in `handleDragOver` (2249-2263):

```js
        const groupedTarget = shouldRenderGroupedAllCollections && pointerPoint
            ? resolveGroupedSectionTarget({
                point: pointerPoint,
                viewMode,
                activeId: activeCollection?.uid,
            })
            : null;
        let nextTarget = (groupedTarget?.kind === collectionDropKinds.collection && baseTarget?.kind === collectionDropKinds.collection)
            ? baseTarget
            : groupedTarget || baseTarget;
```
Preserve the existing precedence exactly: today `groupedEmptySectionTarget` beats everything; the grid card hit only applies when `baseTarget` isn't already a collection; list start/end bands beat `baseTarget`. Encode that precedence inside `resolveGroupedSectionTarget` (return empty-section first) and keep the `baseTarget?.kind === collection` guard for the grid-card case as shown.

- [ ] **Step 5:** Delete the three old helpers (lines 490-673) and run `yarn jest tests/groupedSectionHitTest.test.js && yarn test && yarn prod`.

- [ ] **Step 6:** Manual verify (grouped All Collections, list + grid): drop into an empty folder, drop at a folder's start band and end band in list mode, drop between cards in grid mode across sections.

- [ ] **Step 7: Commit**

```bash
git add app/fullpage/groupedSectionHitTest.js tests/groupedSectionHitTest.test.js app/fullpage/FPContentArea.js
git commit -m "perf(dnd): single DOM scan per dragOver for grouped-section hit testing"
```

---

## Phase 5 — Structural DRY: extract the collection drag controller from FPContentArea

`FPContentArea.js` is 4,094 lines; ~600 of them are drag plumbing. Extract a hook so the drag system is reviewable and testable in isolation. **Pure code motion — no behavior change.**

### Task 14: Create `app/fullpage/useFPCollectionDnd.js`

**Files:**
- Create: `app/fullpage/useFPCollectionDnd.js`
- Modify: `app/fullpage/FPContentArea.js`

- [ ] **Step 1:** Move these (verbatim) from `FPContentArea.js` into the hook file:
  - Module-level helpers: `getDragOverlayCenter`, `getActualPointerCoordinates`, `getPointerCoordinates` (lines 425-488).
  - From the component body: `activeCollection`/`previewTarget` state, `previewTargetRef`, `lastMeaningfulDropTargetRef`, `activeDragRectRef`, `lastSidebarHoverRef` (Task 6), `customCollisionDetection`, `measuring`, `resetDragState`, `handleDragStart`, `getCollectionTargetRect`, `handleDragMove`, `handleDragOver`, `handleDragEnd`.

- [ ] **Step 2:** Hook signature — everything the moved code closes over comes in as parameters:

```js
export function useFPCollectionDnd({
    sourceCollections,
    displayCollections,
    folders,
    folderUidSet,
    viewMode,
    sortByField,
    sortOrder,
    dragSession,
    hasSearchQuery,
    shouldRenderGroupedAllCollections,
    canReorderFlatCollections,
    groupedSectionCollectionsMap,
    persistCollectionChanges,
    setHighlightedCollectionUid,
    setDraggingCollection,
    triggerFolderLightningEffect,
}) {
    // ...moved code...
    return {
        sensors,
        measuring,
        customCollisionDetection,
        activeCollection,
        previewTarget,
        activeDragRectRef,
        handleDragStart,
        handleDragMove,
        handleDragOver,
        handleDragEnd,
        resetDragState,
    };
}
```

- [ ] **Step 3:** In `FPContentArea`, replace the moved code with one hook call and destructure; the `DndContext` props and all `previewTarget`/`activeCollection` reads in render are unchanged.

- [ ] **Step 4:** Run `yarn test && yarn lint && yarn prod`. The full manual drag matrix (see Verification below) must pass.

- [ ] **Step 5: Commit**

```bash
git add app/fullpage/useFPCollectionDnd.js app/fullpage/FPContentArea.js
git commit -m "refactor(fp): extract collection drag controller into useFPCollectionDnd hook"
```

---

## Phase 6 — E2E coverage for the unified UX (crxbox)

### Task 15: `e2e/fp-dnd-unified.spec.mjs` — verify the new unified behavior end-to-end

Run this after Phases 2–4 are complete (it asserts the new tokens/classes). The baseline spec from Task 0.5 must still be green at this point.

**Files:**
- Create: `e2e/fp-dnd-unified.spec.mjs`
- Modify: `e2e/fp-reorder.spec.mjs` (stale comments/options)

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';
import { startDrag, dragOver, drop } from './support/dnd.mjs';

// Verifies the unified DnD design language introduced in v4.1.3:
// shared accent tokens, shared overlay class, settle flash, 5px activation.

const threeCollections = () =>
  buildSeed({
    collections: [
      { uid: 'col-a', name: 'Alpha', order: 0 },
      { uid: 'col-b', name: 'Beta', order: 1 },
      { uid: 'col-c', name: 'Gamma', order: 2 },
    ],
    folders: [{ uid: 'f1', name: 'Work', order: 0 }],
  });

test('drop indicators derive from the shared accent token in both themes', async ({ ext }) => {
  await ext.storage.local.set(threeCollections());
  const page = await openFullPage(ext);
  await page.locator('[data-view-mode-toggle="list"], [aria-label="List view"]').first().click();

  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

    // The accent every DnD indicator must resolve to in this theme.
    const accent = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.color = 'var(--dnd-accent)';
      document.body.appendChild(el);
      const value = getComputedStyle(el).color;
      el.remove();
      return value;
    });

    await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));
    await dragOver(page, page.locator('[data-sortable-collection-id="col-c"]'));

    const gap = page.locator('.fp-collection-insert-gap');
    await expect(gap).toBeVisible();
    // border-color must be accent-derived, not the legacy hard-coded blue.
    const borderColor = await gap.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(borderColor).not.toContain('22, 152, 226');

    // Sidebar highlight uses the same accent family while hovering a folder.
    await dragOver(page, page.locator('[data-sidebar-folder-uid="f1"]'));
    const folderItem = page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item');
    await expect(folderItem).toHaveClass(/fp-sidebar-drop-over/);
    const outlineColor = await folderItem.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outlineColor).toBe(accent);

    // Cancel without dropping so the next theme iteration starts clean.
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
});

test('card, tab, and group drags all use the shared drag overlay treatment', async ({ ext }) => {
  const seed = threeCollections();
  seed['collection_col-a'].tabs = [
    { uid: 'tab-1', title: 'One', url: 'https://one.example.com', groupId: -1 },
    { uid: 'tab-2', title: 'Two', url: 'https://two.example.com', groupId: -1 },
  ];
  seed.collections_index['col-a'].tabCount = 2;
  await ext.storage.local.set(seed);
  const page = await openFullPage(ext);

  // Card drag → overlay carries the shared class.
  await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));
  await expect(page.locator('.dnd-drag-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // Tab drag inside the detail panel → same shared class.
  await page.locator('[data-sortable-collection-id="col-a"]').click();
  const tabRows = page.locator('.collection-detail-panel .collection-draggable-tab');
  await expect(tabRows).toHaveCount(2);
  await startDrag(page, tabRows.nth(0));
  await expect(page.locator('.dnd-drag-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('dropped tab gets a settle flash', async ({ ext }) => {
  const seed = buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] });
  seed['collection_col-a'].tabs = [
    { uid: 'tab-1', title: 'One', url: 'https://one.example.com', groupId: -1 },
    { uid: 'tab-2', title: 'Two', url: 'https://two.example.com', groupId: -1 },
    { uid: 'tab-3', title: 'Three', url: 'https://three.example.com', groupId: -1 },
  ];
  seed.collections_index['col-a'].tabCount = 3;
  await ext.storage.local.set(seed);
  const page = await openFullPage(ext);

  await page.locator('[data-sortable-collection-id="col-a"]').click();
  const tabRows = page.locator('.collection-detail-panel .collection-draggable-tab');
  await expect(tabRows).toHaveCount(3);

  await ext.dragAndDrop(tabRows.nth(0), tabRows.nth(2));

  await expect(page.locator('.collection-detail-panel .dnd-settled')).toBeVisible();
});

test('indicator gating: no-op targets show nothing, valid containers show ambient cues', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-a', name: 'Alpha', order: 0, parentId: 'f1' }],
      folders: [
        { uid: 'f1', name: 'Work', order: 0 },
        { uid: 'f2', name: 'Personal', order: 1 },
      ],
    }),
  );
  const page = await openFullPage(ext);

  await startDrag(page, page.locator('[data-sortable-collection-id="col-a"]'));

  // Current folder (f1): no affordance anywhere — sidebar row or section header.
  await expect(page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item'))
    .not.toHaveClass(/fp-sidebar-drop-active|fp-sidebar-drop-over/);
  // Other folder (f2) + Root Level: ambient cue without hovering.
  await expect(page.locator('[data-sidebar-folder-uid="f2"] .fp-sidebar-folder-item'))
    .toHaveClass(/fp-sidebar-drop-active/);
  await expect(page.locator('[data-sidebar-no-folder="true"]')).toHaveClass(/fp-sidebar-drop-active/);
  // Content-area section headers follow the same rule.
  await expect(page.locator('[data-grouped-section-parent-id="f2"]')).toHaveClass(/dnd-drop-ambient/);
  await expect(page.locator('[data-grouped-section-parent-id="f1"]')).not.toHaveClass(/dnd-drop-ambient/);

  await page.keyboard.press('Escape');
  await page.mouse.up();

  // Root-level no-op: a collection already at root must not light up "Root Level".
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-r', name: 'Rooted', order: 0 }] }));
  const page2 = await openFullPage(ext);
  await startDrag(page2, page2.locator('[data-sortable-collection-id="col-r"]'));
  await expect(page2.locator('[data-sidebar-no-folder="true"]'))
    .not.toHaveClass(/fp-sidebar-drop-active|fp-sidebar-drop-over/);
  await page2.keyboard.press('Escape');
  await page2.mouse.up();
});

test('folder reorder activates at the unified 5px distance', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      folders: [
        { uid: 'f1', name: 'Work', order: 0 },
        { uid: 'f2', name: 'Personal', order: 1 },
      ],
    }),
  );
  const page = await openFullPage(ext);

  // nudge 7 > 5 (new unified distance) but < the legacy 6+buffer — proves the sensor changed.
  await ext.dragAndDrop(
    page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item'),
    page.locator('[data-sidebar-folder-uid="f2"] .fp-sidebar-folder-item'),
    { nudge: 7 },
  );

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('folders_index');
      return [idx['f1'].order, idx['f2'].order];
    })
    .toEqual([1, 0]);
});
```

Notes for the implementer:
- `Escape` cancels a dnd-kit drag (`onDragCancel`); the trailing `mouse.up()` releases the physical button. If Escape-cancel doesn't reset cleanly, drop on the source card instead (no-op reorder).
- The settle-flash assertion has a 900ms window — Playwright's auto-wait covers it, but don't add slow steps between drop and assert.
- The token assertion compares `outlineColor` to a resolved `--dnd-accent` probe rather than a hard-coded rgb so it stays correct if the theme palette changes.
- If crxbox's `ext.dragAndDrop()` or fixture reset shows gaps/bugs while authoring these, record them with repro details in `crxbox-feedback.md` (standing instruction).

- [ ] **Step 2: Refresh `e2e/fp-reorder.spec.mjs`** — the header comment says "FPSidebar, distance:6"; update it to the unified 5px and re-evaluate the `{ nudge: 10 }` option (10 still > 5, so it can stay, but the comment on line 65 must change).

- [ ] **Step 3: Run the full e2e suite**

Run: `yarn prod && yarn test:e2e`
Expected: ALL specs pass — baseline, unified, and the pre-existing suite (`fp-reorder`, `reorder-collections`, etc.).

- [ ] **Step 4: Commit**

```bash
git add e2e/fp-dnd-unified.spec.mjs e2e/fp-reorder.spec.mjs
git commit -m "test(e2e): cover unified DnD indicators, overlays, and settle feedback"
```

---

## Phase 7 (stretch, separate decision) — Keyboard accessibility

No drag context registers a `KeyboardSensor`; drag-and-drop is mouse-only today. dnd-kit ships `KeyboardSensor` + `sortableKeyboardCoordinates` that compose with the existing `useSortable` wiring for the *sortable* cases (folder rows, flat collection reorder, tab reorder). The manual hit-test paths (sidebar cross-drop, grouped sections) would need announcement/coordinate work that is a project of its own. Recommendation: add `KeyboardSensor` to `dndShared.js` and enable it for the sidebar folder list first (smallest surface), evaluate, then decide on the rest. Not scheduled in this plan — ask the user.

---

## Verification (run after every phase)

1. `yarn test` — full suite green.
2. `yarn lint` — clean.
3. `yarn prod` — required by CLAUDE.md before any work is considered complete.
4. `yarn test:e2e` — full Playwright/crxbox suite green (the Task 0.5 baseline specs guard Phases 1–5; Task 15 specs guard the new UX). **The job is not done while any e2e test fails.**
5. Manual drag matrix on the built extension (full page view, light + dark theme):

| # | Action | Expected |
|---|---|---|
| 1 | Reorder folders in sidebar | rows shift, persist after reload |
| 2 | Drag card (grid) within a section | tiles make room, drop reorders, settle flash |
| 3 | Drag card (list) within a section | dashed gap preview, source row collapses, drop reorders |
| 4 | Drag card to another folder section (incl. empty + collapsed) | outline/gap indicators, lightning effect, count updates |
| 5 | Drag card onto sidebar folder / Root Level | folder highlights on hover only, drop moves collection |
| 6 | Drag tab within collection (detail panel) | gap indicator, pinned tabs immovable, settle flash |
| 7 | Drag tab into/out of a group; drag group between tabs/groups | group membership updates, empty group removed |
| 8 | Drag tab/group from detail panel onto another collection card | card highlights, item transfers |
| 9 | Search active (global + tab search) | collection DnD disabled; tab DnD respects filter |
| 10 | All indicators | same accent family, both themes, no hard-coded blue |
| 11 | No-op targets while dragging | own folder (sidebar + section header), Root Level when already at root, and the card's own position show **no** indicator; all other containers show the ambient cue |
| 12 | Tab ↔ group membership | drag ungrouped tab into a group (onto member tab + onto group header/body append), drag grouped tab out via edge zones; empty group disappears after its last tab leaves |

---

## Explicitly out of scope

- Popup-view DnD (`CollectionList.js`, `FolderContainer.js`, etc.) — shares `ExpandedCollectionData`/`DropGap`/tokens, so it inherits the visual unification for tabs automatically; its collection/folder drag code is untouched.
- Merging the three `DndContext`s into one root context (would require relocating all of FPContentArea's drag state above FPLayout — high risk, low payoff after Task 6).
- Changing `MeasuringStrategy.Always` — flagged as a possible win, but the gap-preview layout shifts likely depend on continuous re-measurement; only attempt with dedicated profiling.
- Storage/migration changes — none.
