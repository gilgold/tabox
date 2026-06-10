import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Full-page sidebar navigation filters the content area by folder (FPSidebar → FPContentArea).

const SEED = buildSeed({
  collections: [
    { uid: 'col-a', name: 'Alpha', order: 0 }, // root
    { uid: 'col-b', name: 'Beta', order: 1 }, // root
    { uid: 'col-w1', name: 'WorkDoc', order: 0, parentId: 'fold-work' },
    { uid: 'col-w2', name: 'WorkPlan', order: 1, parentId: 'fold-work' },
  ],
  folders: [{ uid: 'fold-work', name: 'Work', order: 0 }],
});

test('selecting a folder shows only that folder\'s collections', async ({ ext, context }) => {
  await ext.storage.local.set(SEED);
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card')).toHaveCount(4);

  // Click the "Work" folder in the sidebar.
  await page.locator('[data-sidebar-folder-uid="fold-work"]').click();

  // Only the two collections inside Work remain.
  await expect(page.locator('.fp-collection-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Open collection WorkDoc' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open collection WorkPlan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open collection Alpha' })).toHaveCount(0);
});

test('selecting "Root Level" shows only collections with no folder', async ({ ext, context }) => {
  await ext.storage.local.set(SEED);
  const page = await openFullPage(ext);

  await page.locator('[data-sidebar-no-folder="true"]').click();

  await expect(page.locator('.fp-collection-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Open collection Alpha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open collection Beta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open collection WorkDoc' })).toHaveCount(0);
});
