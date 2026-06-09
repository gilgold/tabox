import { test, expect } from 'crxbox';

// E2E: drag-and-drop a collection in the popup list to change its position.
//
// The popup list (app/CollectionList.js) uses @dnd-kit with a PointerSensor whose
// activationConstraint is `{ distance: 5 }` — so a single Playwright dragTo() won't trigger
// it. We use crxbox's `ext.dragAndDrop()` helper, which does the press → nudge-past-
// activation → stepped-glide → settle → release sequence that trips dnd-kit.
//
// The popup renders collections as list rows: each row is `[data-collection-uid="<uid>"]`
// with a dedicated drag handle `.column.handle` (aria-roledescription="sortable"); the
// dnd-kit sortable id is the collection uid. We grab the handle and drop onto the target
// row. Dropping row A onto row B reorders root collections via arrayMove(old=A, new=B) →
// [B, A, C], persisted by updateCollectionsOrder which writes `order` = array-position
// into collections_index.

const T = 1_710_000_000_000;

// Root collection seed with an explicit `order` so the initial list order is deterministic.
const collection = (uid, name, order) => ({
  uid,
  name,
  color: '#4fc3f7',
  parentId: null,
  order,
  tabs: [{ title: `${name} tab`, url: `https://${uid}.example.com` }],
  chromeGroups: [],
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
});

const indexEntry = (name, order) => ({
  name,
  type: 'collection',
  tabCount: 1,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color: '#4fc3f7',
  size: 0,
  parentId: null,
  order,
});

const SEED = {
  collections_index: {
    'col-a': indexEntry('Alpha', 0),
    'col-b': indexEntry('Beta', 1),
    'col-c': indexEntry('Gamma', 2),
  },
  'collection_col-a': collection('col-a', 'Alpha', 0),
  'collection_col-b': collection('col-b', 'Beta', 1),
  'collection_col-c': collection('col-c', 'Gamma', 2),
};

// Drive a @dnd-kit pointer drag: press on the source handle, exceed the activation
// distance, glide to the target row's center, settle, release.
// Persisted/displayed order, read from each row's data-collection-uid (DOM order).
const uidOrder = (page) =>
  page
    .locator('[data-collection-drop-zone="true"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-collection-uid')));

test('drag-and-drop reorders a collection in the popup list', async ({ ext }) => {
  await ext.storage.local.set(SEED);

  const popup = await ext.popup.open();

  const row = (uid) => popup.locator(`[data-collection-uid="${uid}"]`);
  const handle = (uid) => row(uid).locator('.handle').first();

  // Initial order from the seeded `order` field.
  await expect(popup.locator('[data-collection-drop-zone="true"]')).toHaveCount(3);
  expect(await uidOrder(popup)).toEqual(['col-a', 'col-b', 'col-c']);

  // Drag Alpha (col-a) onto Beta (col-b) → expect [Beta, Alpha, Gamma].
  await ext.dragAndDrop(handle('col-a'), row('col-b'));

  // The list re-renders in the new order.
  await expect.poll(() => uidOrder(popup)).toEqual(['col-b', 'col-a', 'col-c']);

  // …and the new order is persisted to the index (write is async — poll it).
  await expect
    .poll(async () => {
      const index = await ext.storage.local.get('collections_index');
      return {
        beta: index['col-b'].order,
        alpha: index['col-a'].order,
        gamma: index['col-c'].order,
      };
    })
    .toEqual({ beta: 0, alpha: 1, gamma: 2 });
});
