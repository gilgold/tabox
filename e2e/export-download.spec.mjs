import { readFileSync } from 'node:fs';
import { test, expect } from 'crxbox';

// E2E: exporting collections triggers a real browser download (anchor + Blob).
// Exercises Playwright's download capture against the extension popup:
//   - "Export all collections & folders" (Settings) → full_export JSON
//   - per-row "Export Collection" → single-collection JSON

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

const SEED = {
  collections_index: { 'col-a': indexEntry('Alpha'), 'col-b': indexEntry('Beta') },
  'collection_col-a': collection('col-a', 'Alpha'),
  'collection_col-b': collection('col-b', 'Beta'),
};

async function readDownloadJson(download) {
  const path = await download.path();
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('exports all collections as a JSON download', async ({ ext }) => {
  await ext.storage.local.set(SEED);
  const popup = await ext.popup.open();

  // Open Settings → Backup & Restore (expanded by default).
  await popup.locator('.settings-button').click();
  await expect(popup.locator('.custom-drawer.open')).toBeVisible();

  const downloadPromise = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'Export all collections & folders' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toContain('tabox-full-export');

  const data = await readDownloadJson(download);
  expect(data.type).toBe('full_export');
  expect(data.collections.map((c) => c.name).sort()).toEqual(['Alpha', 'Beta']);
  expect(data.stats.totalCollections).toBe(2);
});

test('exports a single collection from its row menu', async ({ ext }) => {
  await ext.storage.local.set(SEED);
  const popup = await ext.popup.open();

  const row = popup.locator('[data-collection-uid="col-a"]');
  await row.hover();
  await row.locator('.menu-icon').click();

  const downloadPromise = popup.waitForEvent('download');
  await popup.locator('.context-menu-item', { hasText: 'Export Collection' }).click();
  const download = await downloadPromise;

  // downloadTextFile(JSON.stringify(collection), collection.name) → "<name>.txt".
  expect(download.suggestedFilename()).toBe('Alpha.txt');

  const data = await readDownloadJson(download);
  expect(data).toMatchObject({ uid: 'col-a', name: 'Alpha' });
  expect(data.tabs).toHaveLength(1);
  expect(data.tabs[0].url).toBe('https://col-a.example.com');
});
