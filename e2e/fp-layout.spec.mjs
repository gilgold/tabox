import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Full-page view: rendering + search filtering (FPTopBar / FPContentArea / FPSidebar).

const SEED = buildSeed({
  collections: [
    { uid: 'col-a', name: 'Alpha', order: 0 },
    { uid: 'col-b', name: 'Beta', order: 1 },
    { uid: 'col-f1', name: 'InFolder', order: 0, parentId: 'fold-1' },
  ],
  folders: [
    { uid: 'fold-1', name: 'Work', order: 0 },
    { uid: 'fold-2', name: 'Personal', order: 1 },
  ],
});

test('renders collection cards and the folder sidebar', async ({ ext, context }) => {
  await ext.storage.local.set(SEED);
  const page = await openFullPage(ext);

  // All three collections render as cards in the default "All Collections" view.
  await expect(page.locator('.fp-collection-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Open collection Alpha' })).toBeVisible();

  // Sidebar lists both folders with their collection counts (Work has 1, Personal 0).
  await expect(page.locator('[data-sidebar-folder-uid="fold-1"]')).toContainText('Work');
  await expect(page.locator('[data-sidebar-folder-uid="fold-1"]')).toContainText('1');
  await expect(page.locator('[data-sidebar-folder-uid="fold-2"]')).toContainText('Personal');
});

test('search filters the visible collection cards', async ({ ext, context }) => {
  await ext.storage.local.set(SEED);
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card')).toHaveCount(3);

  await page.locator('.fp-search-input').fill('Beta');

  // Only the matching collection card remains.
  await expect(page.locator('.fp-collection-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open collection Beta' })).toBeVisible();

  // Clearing search restores all cards.
  await page.locator('.fp-search-input').fill('');
  await expect(page.locator('.fp-collection-card')).toHaveCount(3);
});
