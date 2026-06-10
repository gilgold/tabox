import { test, expect } from 'crxbox';
import { buildSeed, collectionIndexEntry, openFullPage, T } from './support/fixtures.mjs';

// Batch A — tab lifecycle: opening a collection's tabs, and importing data.
//
// Note: "save current tabs → new collection" is intentionally NOT tested here. crxbox opens
// the popup as a page (popup-as-page), so it isn't bound to a real browsing window, and the
// harness's own pages ARE the "current window" tabs — so that flow can't be faithfully
// reproduced. The save path itself is covered deterministically via importData below.
// (Logged as crxbox feedback.)

test('opening a collection launches its tabs and marks it opened', async ({ ext, context }) => {
  // Use extension-page URLs so the opened tabs load offline (no network).
  const tabs = [
    { title: 'Idx', url: ext.url('index.html') },
    { title: 'Full', url: ext.url('fullpage.html') },
  ];
  await ext.storage.local.set({
    collections_index: { 'col-a': collectionIndexEntry('Alpha', { order: 0 }) },
    'collection_col-a': {
      uid: 'col-a', name: 'Alpha', color: '#4fc3f7', parentId: null, order: 0,
      tabs, chromeGroups: [], lastUpdated: T, lastOpened: null, createdOn: T,
    },
  });

  const page = await openFullPage(ext);
  const card = page.locator('[data-sortable-collection-id="col-a"]');
  await card.hover();
  await card.locator('.fp-card-rail-open').click();

  // Both of the collection's tabs are now open in the context.
  await expect
    .poll(() => context.pages().map((p) => p.url()))
    .toEqual(expect.arrayContaining([ext.url('index.html'), ext.url('fullpage.html')]));

  // The collection is marked as opened (lastOpened timestamp set).
  await expect
    .poll(async () => (await ext.storage.local.get('collections_index'))['col-a'].lastOpened)
    .not.toBeNull();
});

test('importData (full_export) creates the imported collections', async ({ ext }) => {
  const payload = {
    type: 'full_export',
    folders: [],
    collections: [
      { uid: 'imp-1', name: 'Imported One', color: '#ff9800', parentId: null, tabs: [{ title: 'a', url: 'https://a.example.com' }], chromeGroups: [] },
      { uid: 'imp-2', name: 'Imported Two', color: '#2196f3', parentId: null, tabs: [{ title: 'b', url: 'https://b.example.com' }], chromeGroups: [] },
    ],
  };

  const result = await ext.background.sendMessage({ type: 'importData', data: payload });
  expect(result?.success).toBe(true);

  // Collections land in the index (import may regenerate uids — assert by name).
  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return Object.values(idx).map((c) => c.name).sort();
    })
    .toEqual(['Imported One', 'Imported Two']);
});

test('importData (single collection) creates one collection', async ({ ext }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-x', name: 'Existing', order: 0 }] }));

  const result = await ext.background.sendMessage({
    type: 'importData',
    data: { name: 'Imported Single', color: '#4caf50', tabs: [{ title: 's', url: 'https://s.example.com' }] },
  });
  expect(result?.success).toBe(true);

  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return Object.values(idx).map((c) => c.name).sort();
    })
    .toEqual(['Existing', 'Imported Single']);
});
