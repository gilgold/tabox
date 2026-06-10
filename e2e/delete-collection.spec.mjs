import { test, expect } from 'crxbox';

// E2E: delete a collection from the popup list via its row menu.
//   row .menu-icon (ContextMenu trigger) → "Delete Collection" item → _handleDelete
//   removes it from indexed storage (~400ms animation delay, no confirm dialog).
// Also exercises the `toHaveStorageValue` matcher for the stable post-delete state.

const T = 1_710_000_000_000;

const collection = (uid, name) => ({
  uid,
  name,
  color: '#4fc3f7',
  parentId: null,
  tabs: [{ title: `${name} tab`, url: `https://${uid}.example.com` }],
  chromeGroups: [],
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
});

const indexEntry = (name) => ({
  name,
  type: 'collection',
  tabCount: 1,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color: '#4fc3f7',
  size: 0,
  parentId: null,
});

async function deleteCollection(popup, uid) {
  const row = popup.locator(`[data-collection-uid="${uid}"]`);
  await row.hover();
  await row.locator('.menu-icon').click();
  // The menu is portalled to <body>; click the danger "Delete Collection" item.
  await popup.locator('.context-menu-item', { hasText: 'Delete Collection' }).click();
}

test('deletes a collection and removes it from storage', async ({ ext }) => {
  await ext.storage.local.set({
    collections_index: { 'col-a': indexEntry('Alpha'), 'col-b': indexEntry('Beta') },
    'collection_col-a': collection('col-a', 'Alpha'),
    'collection_col-b': collection('col-b', 'Beta'),
  });

  const popup = await ext.popup.open();
  await expect(popup.locator('[data-collection-drop-zone="true"]')).toHaveCount(2);

  await deleteCollection(popup, 'col-a');

  // The row disappears and the index drops the deleted uid (async delete — poll).
  await expect(popup.locator('[data-collection-uid="col-a"]')).toHaveCount(0);
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('collections_index')))
    .toEqual(['col-b']);

  // Its per-collection record is gone too.
  expect(await ext.storage.local.get('collection_col-a')).toBeUndefined();

  // The survivor is intact — assert via the toHaveStorageValue matcher (state is now stable).
  await expect(ext.storage.local).toHaveStorageValue(
    'collections_index',
    expect.objectContaining({ 'col-b': expect.objectContaining({ name: 'Beta' }) }),
  );
});

test('deleting the only collection empties the index', async ({ ext }) => {
  await ext.storage.local.set({
    collections_index: { 'col-a': indexEntry('Alpha') },
    'collection_col-a': collection('col-a', 'Alpha'),
  });

  const popup = await ext.popup.open();
  await expect(popup.locator('[data-collection-drop-zone="true"]')).toHaveCount(1);

  await deleteCollection(popup, 'col-a');

  await expect(popup.locator('[data-collection-drop-zone="true"]')).toHaveCount(0);
  await expect.poll(async () => await ext.storage.local.get('collections_index')).toEqual({});
});
