import { test, expect } from 'crxbox';
import { buildSeed, openFullPage, tab } from './support/fixtures.mjs';
import { startDrag, dragOver, drop } from './support/dnd.mjs';

// Coverage for the UNIFIED full-page drag-and-drop UX (v4.1.2):
//   - shared accent tokens (--dnd-accent*, derived from --primary-color, theme-adaptive)
//   - shared .dnd-drag-overlay lift treatment on card / tab / group overlays
//   - .dnd-settled settle flash on dropped detail-panel items
//   - unified 5px activation distance (app/utils/dndShared.js) on every surface
//   - indicator gating: no-op targets show nothing, valid containers get ambient cues
//     (.dnd-drop-ambient on section header dropzones, fp-sidebar-drop-active in the sidebar)
//
// Class/computed-style assertions here are the contract for the visual unification;
// storage assertions for the underlying moves live in fp-dnd-baseline.spec.mjs.

// --- shared helpers ---------------------------------------------------------

const cardLocator = (page, uid) => page.locator(`[data-sortable-collection-id="${uid}"]`);

const sidebarFolderItem = (page, uid) =>
  page.locator(`[data-sidebar-folder-uid="${uid}"] .fp-sidebar-folder-item`);

// Cancel an in-flight CARD drag: Escape triggers dnd-kit's onDragCancel
// (FPContentArea wires it), then release the still-held button. NOTE: do not
// use this inside the collection detail panel — Escape also closes the panel
// there; use a no-op drop (release without moving to a target) instead.
async function cancelDrag(page) {
  await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function openDetailPanel(page, uid) {
  await cardLocator(page, uid).click();
  const panel = page.locator('.collection-detail-panel.open');
  await expect(panel).toBeVisible();
  // The fp-detail-panel column slides open (width transition); wait for the
  // panel's bounding box to stop moving before any pointer math.
  let prev = null;
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      const key = box && [box.x, box.y, box.width, box.height].join(',');
      const stable = prev !== null && key === prev;
      prev = key;
      return stable;
    }, { message: 'detail panel bounding box never stabilized' })
    .toBe(true);
  return panel;
}

const tabRows = (panel) => panel.locator('.collection-draggable-tab');
const tabDragHandle = (rowLocator) => rowLocator.locator('.drag-handle');

// Resolve the computed value of --dnd-accent via a probe element.
const resolveAccent = (page) =>
  page.evaluate(() => {
    const el = document.createElement('div');
    el.style.color = 'var(--dnd-accent)';
    document.body.appendChild(el);
    const color = getComputedStyle(el).color;
    el.remove();
    return color;
  });

// --- 1. theme-adaptive accent tokens ----------------------------------------

test('drop indicators derive from the shared accent token in both themes', async ({ ext }) => {
  await ext.storage.local.set({
    ...buildSeed({
      collections: [
        { uid: 'col-a', name: 'Alpha', order: 0 },
        { uid: 'col-b', name: 'Beta', order: 1 },
        { uid: 'col-c', name: 'Gamma', order: 2 },
      ],
      folders: [{ uid: 'f1', name: 'Work', order: 0 }],
    }),
    fpViewMode: 'list',
  });
  const page = await openFullPage(ext);
  await expect(page.locator('[data-sortable-collection-id]')).toHaveCount(3);

  const accents = {};
  const gapBorders = {};

  for (const theme of ['light', 'dark']) {
    // Tokens resolve purely from CSS, so setting the attribute directly is
    // equivalent to flipping the theme setting for this purpose.
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    accents[theme] = await resolveAccent(page);

    // Insert gap (card reorder preview) uses --dnd-accent-border-soft.
    await startDrag(page, cardLocator(page, 'col-a'));
    await dragOver(page, cardLocator(page, 'col-c'));
    const gap = page.locator('.fp-collection-insert-gap');
    await expect(gap).toBeVisible();
    gapBorders[theme] = await gap.evaluate((el) => getComputedStyle(el).borderTopColor);
    // The pre-unification gap border was hard-coded rgba(22, 152, 226, …); the
    // token version computes to a color-mix() result, which Chrome serializes
    // as color(srgb …) — the legacy literal must be gone.
    expect(gapBorders[theme]).not.toContain('22, 152, 226');

    // Hovered sidebar folder uses the full-strength accent for its outline.
    // outline-color transitions for 0.12s after the class lands, so poll until
    // the computed value settles on the accent.
    const folderItem = sidebarFolderItem(page, 'f1');
    await dragOver(page, folderItem);
    await expect(folderItem).toHaveClass(/fp-sidebar-drop-over/);
    await expect
      .poll(() => folderItem.evaluate((el) => getComputedStyle(el).outlineColor), {
        message: `sidebar drop-over outline never settled on the ${theme} accent`,
      })
      .toBe(accents[theme]);

    await cancelDrag(page);
    await expect(page.locator('.fp-collection-insert-gap')).toHaveCount(0);
    await expect(folderItem).not.toHaveClass(/fp-sidebar-drop-over/);
  }

  // The accent (and everything derived from it) must adapt to the theme.
  expect(accents.light).not.toBe(accents.dark);
  expect(gapBorders.light).not.toBe(gapBorders.dark);
});

// --- 2. shared drag overlay across all three surfaces ------------------------

test('card, tab, and group drags all use the shared drag overlay treatment', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [
        {
          uid: 'col-a',
          name: 'Alpha',
          order: 0,
          chromeGroups: [{ uid: 'g1', id: 1, title: 'Work', color: 'blue' }],
          tabs: [
            tab('tab-1', 'One', { groupUid: 'g1', groupId: 1 }),
            tab('tab-2', 'Two', { groupUid: 'g1', groupId: 1 }),
            tab('tab-3', 'Three'),
          ],
        },
        { uid: 'col-b', name: 'Beta', order: 1 },
        { uid: 'col-c', name: 'Gamma', order: 2 },
      ],
    }),
  );
  const page = await openFullPage(ext);
  await expect(cardLocator(page, 'col-a')).toBeVisible();

  const overlay = page.locator('.dnd-drag-overlay');

  // Collection card drag → shared overlay class on the card overlay.
  await startDrag(page, cardLocator(page, 'col-a'));
  await expect(page.locator('.fp-card-drag-overlay.dnd-drag-overlay')).toBeVisible();
  await cancelDrag(page);
  await expect(overlay).toHaveCount(0);

  // Tab drag inside the detail panel → same shared overlay class. Inside the
  // panel Escape would close the panel along with the drag, so end these drags
  // with a no-op drop (release without moving to a target) instead.
  const panel = await openDetailPanel(page, 'col-a');
  const rows = tabRows(panel);
  await expect(rows).toHaveCount(1); // group collapsed: only ungrouped Three visible
  await startDrag(page, tabDragHandle(rows.filter({ hasText: 'Three' })));
  await expect(overlay).toBeVisible();
  await expect(page.locator('.dnd-drag-overlay--group')).toHaveCount(0);
  await drop(page);
  await expect(overlay).toHaveCount(0);

  // Whole-group drag → shared overlay class plus the group modifier.
  await startDrag(page, panel.locator('.collection-draggable-group .group-drag-handle'));
  await expect(page.locator('.dnd-drag-overlay.dnd-drag-overlay--group')).toBeVisible();
  await drop(page);
  await expect(overlay).toHaveCount(0);
});

// --- 3. settle flash on drop -------------------------------------------------

test('dropped tab gets a settle flash', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [
        {
          uid: 'col-a',
          name: 'Alpha',
          order: 0,
          tabs: [tab('tab-1', 'One'), tab('tab-2', 'Two'), tab('tab-3', 'Three')],
        },
      ],
    }),
  );
  const page = await openFullPage(ext);
  const panel = await openDetailPanel(page, 'col-a');

  const rows = tabRows(panel);
  await expect(rows).toHaveCount(3);

  // Manual drag (ext.dragAndDrop measures up front; sortable rows translate mid-drag).
  await startDrag(page, tabDragHandle(rows.nth(0)));
  await dragOver(page, rows.nth(2));
  await drop(page);

  // The settle flash lives for 900ms (setSettledItemId + timeout), so assert
  // immediately after the drop — and confirm it flagged the dropped tab.
  const settled = page.locator('.collection-detail-panel .dnd-settled');
  await expect(settled).toBeVisible();
  await expect(settled).toContainText('One');
});

// --- 4. unified 5px activation distance --------------------------------------

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
  await expect(page.locator('[data-sidebar-folder-uid]')).toHaveCount(2);

  // nudge: 7 exceeds the unified 5px sensor (app/utils/dndShared.js) but stays
  // below the old sidebar 6px + buffer the previous spec needed (nudge: 10).
  await ext.dragAndDrop(
    sidebarFolderItem(page, 'f1'),
    sidebarFolderItem(page, 'f2'),
    { nudge: 7 },
  );

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('folders_index');
      return { f1: idx['f1'].order, f2: idx['f2'].order };
    })
    .toEqual({ f1: 1, f2: 0 });
});

// --- 5. indicator gating ------------------------------------------------------

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
  let page = await openFullPage(ext);
  await expect(cardLocator(page, 'col-a')).toBeVisible();

  const rootItem = page.locator('[data-sidebar-no-folder="true"]');
  await startDrag(page, cardLocator(page, 'col-a'));

  // Own folder (no-op): no ambient cue and no hover cue.
  await expect(sidebarFolderItem(page, 'f1')).not.toHaveClass(/fp-sidebar-drop-active/);
  await expect(sidebarFolderItem(page, 'f1')).not.toHaveClass(/fp-sidebar-drop-over/);
  // Valid container targets: ambient cue while the drag is live.
  await expect(sidebarFolderItem(page, 'f2')).toHaveClass(/fp-sidebar-drop-active/);
  await expect(rootItem).toHaveClass(/fp-sidebar-drop-active/);
  // Content-area section header dropzones mirror the same gating.
  await expect(page.locator('[data-grouped-section-parent-id="f2"]')).toHaveClass(/dnd-drop-ambient/);
  await expect(page.locator('[data-grouped-section-parent-id="f1"]')).not.toHaveClass(/dnd-drop-ambient/);

  await cancelDrag(page);
  await expect(sidebarFolderItem(page, 'f2')).not.toHaveClass(/fp-sidebar-drop-active/);
  await page.close();

  // A root-level collection must not light up Root Level (already there → no-op).
  // Clear first so the previous seed's unindexed blobs can't trip orphan recovery.
  await ext.storage.local.clear();
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-r', name: 'Rooty', order: 0 }],
      folders: [{ uid: 'f1', name: 'Work', order: 0 }],
    }),
  );
  page = await openFullPage(ext);
  await expect(cardLocator(page, 'col-r')).toBeVisible();

  await startDrag(page, cardLocator(page, 'col-r'));
  // Sanity: the drag session is live (f1 shows its ambient cue) …
  await expect(sidebarFolderItem(page, 'f1')).toHaveClass(/fp-sidebar-drop-active/);
  // … yet Root Level shows neither cue.
  const root2 = page.locator('[data-sidebar-no-folder="true"]');
  await expect(root2).not.toHaveClass(/fp-sidebar-drop-active/);
  await expect(root2).not.toHaveClass(/fp-sidebar-drop-over/);
  await cancelDrag(page);
});

// --- 6. suppressed no-op hover must not fall back to a stale target -----------

test('dropping on a suppressed no-op target does not move the collection', async ({ ext }) => {
  await ext.storage.local.set({
    ...buildSeed({
      collections: [
        { uid: 'col-a', name: 'Alpha', order: 0 },
        { uid: 'col-b', name: 'Beta', order: 1 },
        { uid: 'col-c', name: 'Gamma', order: 2 },
      ],
    }),
    fpViewMode: 'list',
  });
  const page = await openFullPage(ext);
  await expect(page.locator('[data-sortable-collection-id]')).toHaveCount(3);

  const gap = page.locator('.fp-collection-insert-gap');

  // 1. Hover a valid target so the indicator shows (and the engine records a
  //    meaningful drop target for the dead-zone fallback).
  await startDrag(page, cardLocator(page, 'col-a'));
  await dragOver(page, cardLocator(page, 'col-c'));
  await expect(gap).toBeVisible();

  // 2. Move to an explicitly suppressed no-op position: the TOP half of Beta
  //    resolves to "insert before Beta", which is Alpha's own slot (Alpha is
  //    collapsed while dragging) — the engine returns no operation and clears
  //    the preview (no gap). dnd-kit only re-fires onDragOver when the `over`
  //    droppable CHANGES, so force an over-change that lands directly in
  //    Beta's top half: park on Gamma, then jump in a single mousemove.
  //    Retry the pair in case a mid-flight layout shift (the gap moving)
  //    swallows one of the over-changes.
  await expect(async () => {
    const boxC = await cardLocator(page, 'col-c').boundingBox();
    await page.mouse.move(boxC.x + boxC.width / 2, boxC.y + boxC.height * 0.75, { steps: 1 });
    const boxB = await cardLocator(page, 'col-b').boundingBox();
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height * 0.25, { steps: 1 });
    await expect(gap).toHaveCount(0, { timeout: 250 });
  }).toPass();

  // 3. Release while no indicator is showing: the drop must be a no-op, not a
  //    fall-back to the stale Gamma target from step 1.
  await drop(page);
  await expect(page.locator('.dnd-drag-overlay')).toHaveCount(0);

  // Give a (buggy) pending write time to land before asserting stability.
  await page.waitForTimeout(400);
  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return [idx['col-a'].order, idx['col-b'].order, idx['col-c'].order];
    })
    .toEqual([0, 1, 2]);
});
