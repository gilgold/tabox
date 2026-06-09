import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';
import { startDrag, dragOver, drop } from './support/dnd.mjs';

// Baseline coverage for the CURRENT full-page drag-and-drop behavior, pinned
// before the DnD unification refactor. Storage assertions are the contract:
// collections_index / collection_<uid> must end up exactly as asserted here.
//
// Three DnD surfaces are covered:
//   1. Content area cards → sidebar folders / section headers / empty folder zones
//      (FPContentArea + FPSidebar, manual DOM hit-testing on drag move)
//   2. Card reordering with the list-mode insert gap preview
//   3. The collection detail panel (ExpandedCollectionData): tab/group sorting,
//      group membership changes, edge drop zones, and cross-collection transfer
//      (useCollectionItemCrossDrag, finalized by a document-level mouseup).

// --- seed helpers -----------------------------------------------------------

const tab = (uid, title, extra = {}) => ({
  uid,
  title,
  url: `https://${uid}.example.com`,
  groupId: -1,
  ...extra,
});

// col-a with three ungrouped tabs (tab-1/2/3).
function seedWithTabs() {
  const seed = buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] });
  seed['collection_col-a'].tabs = [tab('tab-1', 'One'), tab('tab-2', 'Two'), tab('tab-3', 'Three')];
  seed.collections_index['col-a'].tabCount = 3;
  return seed;
}

// col-a with a tab group "Work" (tab-1, tab-2) followed by ungrouped tab-3.
function seedWithGroup() {
  const seed = buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] });
  seed['collection_col-a'].chromeGroups = [{ uid: 'g1', id: 1, title: 'Work', color: 'blue' }];
  seed['collection_col-a'].tabs = [
    tab('tab-1', 'One', { groupUid: 'g1', groupId: 1 }),
    tab('tab-2', 'Two', { groupUid: 'g1', groupId: 1 }),
    tab('tab-3', 'Three'),
  ];
  seed.collections_index['col-a'].tabCount = 3;
  return seed;
}

// --- shared helpers ---------------------------------------------------------

const cardLocator = (page, uid) => page.locator(`[data-sortable-collection-id="${uid}"]`);

async function openDetailPanel(page, uid) {
  await cardLocator(page, uid).click();
  const panel = page.locator('.collection-detail-panel.open');
  await expect(panel).toBeVisible();
  // The fp-detail-panel column slides open (width transition), so coordinates
  // measured right after `.open` appears go stale within milliseconds. Wait for
  // the panel's bounding box to stop moving before any pointer math.
  let prev = null;
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      const key = box && [box.x, box.y, box.width, box.height].join(',');
      const stable = prev !== null && key === prev;
      prev = key;
      return stable;
    })
    .toBe(true);
  return panel;
}

const tabRows = (panel) => panel.locator('.collection-draggable-tab');

// Tab rows only activate dnd-kit drags from their `.drag-handle` element
// (TabRow spreads the sortable listeners there, not on the whole row).
const tabDragHandle = (rowLocator) => rowLocator.locator('.drag-handle');

async function expandGroup(panel) {
  await panel.locator('button[title="Expand group"]').click();
  await expect(panel.locator('button[title="Collapse group"]')).toBeVisible();
}

const storedTabs = async (ext, uid) => {
  const col = await ext.storage.local.get(`collection_${uid}`);
  return (col?.tabs || []).map((t) => t.uid);
};

// --- 1. card → sidebar folder ----------------------------------------------

test('dragging a card over a sidebar folder highlights it and drop moves the collection', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }],
      folders: [{ uid: 'f1', name: 'Work', order: 0 }],
    }),
  );
  const page = await openFullPage(ext);
  await expect(cardLocator(page, 'col-a')).toBeVisible();

  const folderItem = page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item');
  await startDrag(page, cardLocator(page, 'col-a'));
  await dragOver(page, folderItem);
  await expect(folderItem).toHaveClass(/fp-sidebar-drop-over/);
  await drop(page);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return idx['col-a'].parentId;
    })
    .toBe('f1');
});

// --- 2. list-mode reorder with insert-gap preview ---------------------------

test('list mode shows an insert gap while dragging and drop reorders within the section', async ({ ext }) => {
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

  const cardC = cardLocator(page, 'col-c');
  await startDrag(page, cardLocator(page, 'col-a'));
  await dragOver(page, cardC);
  await expect(page.locator('.fp-collection-insert-gap')).toBeVisible();

  // Aim at the bottom third of Gamma so the gap (and drop) lands AFTER it.
  const box = await cardC.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.85, { steps: 4 });
  await drop(page);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return [idx['col-a'].order, idx['col-b'].order, idx['col-c'].order];
    })
    .toEqual([2, 0, 1]);
});

// --- 3. card → empty folder dropzone ----------------------------------------

test('dropping a card on an empty folder section moves it into the folder', async ({ ext }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }],
      folders: [{ uid: 'f1', name: 'Work', order: 0 }],
    }),
  );
  const page = await openFullPage(ext);
  await expect(cardLocator(page, 'col-a')).toBeVisible();

  const emptyZone = page.locator('.fp-grouped-empty-dropzone');
  await expect(emptyZone).toBeVisible();
  await startDrag(page, cardLocator(page, 'col-a'));
  await dragOver(page, emptyZone);
  await drop(page);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return idx['col-a'].parentId;
    })
    .toBe('f1');
});

// --- 4. tab reorder inside the detail panel ---------------------------------

test('reorders tabs inside the collection detail panel', async ({ ext }) => {
  await ext.storage.local.set(seedWithTabs());
  const page = await openFullPage(ext);
  const panel = await openDetailPanel(page, 'col-a');

  const rows = tabRows(panel);
  await expect(rows).toHaveCount(3);

  // Drag One below Three → [Two, Three, One]. Manual drag: target coordinates
  // must be computed mid-drag because sortable rows translate while dragging.
  await startDrag(page, tabDragHandle(rows.nth(0)));
  await dragOver(page, rows.nth(2));
  await drop(page);

  await expect.poll(() => storedTabs(ext, 'col-a')).toEqual(['tab-2', 'tab-3', 'tab-1']);
});

// --- 5. ungrouped tab → into a group ----------------------------------------

test('drags an ungrouped tab into a tab group', async ({ ext }) => {
  await ext.storage.local.set(seedWithGroup());
  const page = await openFullPage(ext);
  const panel = await openDetailPanel(page, 'col-a');

  // Group renders collapsed by default; expand it so member rows are visible.
  await expandGroup(panel);
  const rows = tabRows(panel);
  await expect(rows).toHaveCount(3);

  // Drop ungrouped Three onto grouped Two → Three joins the Work group.
  await startDrag(page, tabDragHandle(rows.filter({ hasText: 'Three' })));
  await dragOver(page, rows.filter({ hasText: 'Two' }));
  await drop(page);

  await expect
    .poll(async () => {
      const col = await ext.storage.local.get('collection_col-a');
      return col.tabs.find((t) => t.uid === 'tab-3')?.groupUid;
    })
    .toBe('g1');
});

// --- 6. grouped tab → out of the group via the end edge zone ----------------

test('drags a grouped tab out of its group to the collection end', async ({ ext }) => {
  await ext.storage.local.set(seedWithGroup());
  const page = await openFullPage(ext);
  const panel = await openDetailPanel(page, 'col-a');

  await expandGroup(panel);
  const rows = tabRows(panel);
  await expect(rows).toHaveCount(3);

  // Manual drag: the "Drop at end" zone only activates mid-drag.
  const endZone = panel.locator('.collection-edge-drop-zone').last();
  await startDrag(page, tabDragHandle(rows.filter({ hasText: 'One' })));
  await dragOver(page, endZone);
  await drop(page);

  await expect
    .poll(async () => {
      const col = await ext.storage.local.get('collection_col-a');
      const last = col.tabs[col.tabs.length - 1];
      return { uid: last?.uid, groupUid: last?.groupUid ?? null };
    })
    .toEqual({ uid: 'tab-1', groupUid: null });
});

// --- 7. whole group reorder below an ungrouped tab --------------------------

test('drags a whole tab group below an ungrouped tab', async ({ ext }) => {
  await ext.storage.local.set(seedWithGroup());
  const page = await openFullPage(ext);
  const panel = await openDetailPanel(page, 'col-a');

  const rows = tabRows(panel);
  await expect(rows).toHaveCount(1); // group collapsed: only ungrouped Three visible

  // Drag the whole Work group below Three → [Three, One, Two]. Manual drag:
  // the dragged group collapses to zero height, shifting the layout, so the
  // target box must be measured mid-drag (ext.dragAndDrop measures up front).
  await startDrag(page, panel.locator('.collection-draggable-group .group-drag-handle'));
  await dragOver(page, rows.filter({ hasText: 'Three' }));
  await drop(page);

  await expect.poll(() => storedTabs(ext, 'col-a')).toEqual(['tab-3', 'tab-1', 'tab-2']);
});

// --- 8. tab → another collection card (cross-collection transfer) -----------

test('drags a tab from the detail panel onto another collection card', async ({ ext }) => {
  const seed = buildSeed({
    collections: [
      { uid: 'col-a', name: 'Alpha', order: 0 },
      { uid: 'col-b', name: 'Beta', order: 1 },
    ],
  });
  seed['collection_col-a'].tabs = [tab('tab-1', 'One'), tab('tab-2', 'Two')];
  seed.collections_index['col-a'].tabCount = 2;
  await ext.storage.local.set(seed);

  const page = await openFullPage(ext);
  const panel = await openDetailPanel(page, 'col-a');
  const rows = tabRows(panel);
  await expect(rows).toHaveCount(2);

  // Manual drag: the cross-collection transfer is finalized by a document-level
  // mouseup listener (useCollectionItemCrossDrag), so real pointer events are required.
  await startDrag(page, tabDragHandle(rows.filter({ hasText: 'One' })));
  await dragOver(page, cardLocator(page, 'col-b'));
  await expect(page.locator('[data-collection-uid="col-b"][data-collection-drop-zone]')).toBeVisible();
  await drop(page);

  await expect
    .poll(async () => {
      const colA = await ext.storage.local.get('collection_col-a');
      const colB = await ext.storage.local.get('collection_col-b');
      return {
        aCount: colA.tabs.length,
        bHasTab1: colB.tabs.some((t) => t.uid === 'tab-1'),
      };
    })
    .toEqual({ aCount: 1, bHasTab1: true });
});

// --- 9. card → folder section header in the content area --------------------

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
  await expect(cardLocator(page, 'col-a')).toBeVisible();

  await startDrag(page, cardLocator(page, 'col-a'));
  await dragOver(page, page.locator('[data-grouped-section-parent-id="f1"]'));
  await drop(page);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return { parentId: idx['col-a'].parentId, order: idx['col-a'].order };
    })
    .toEqual({ parentId: 'f1', order: 0 });
});
