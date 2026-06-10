import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Batch D — detail panel + bulk delete (full-page).

test('clicking a collection card opens the detail panel', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }));
  const page = await openFullPage(ext);

  // The card body click handler is `onSelect` → opens the detail panel.
  await page.getByRole('button', { name: 'Open collection Alpha' }).click();

  await expect(page.locator('.collection-detail-panel.open')).toBeVisible();
  await expect(page.locator('.collection-detail-panel')).toContainText('Alpha');
});

test('bulk-selecting cards and deleting removes them all', async ({ ext, context }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [
        { uid: 'col-a', name: 'Alpha', order: 0 },
        { uid: 'col-b', name: 'Beta', order: 1 },
      ],
    }),
  );
  const page = await openFullPage(ext);

  // Enter bulk selection by toggling each card's select button.
  for (const uid of ['col-a', 'col-b']) {
    const card = page.locator(`[data-sortable-collection-id="${uid}"]`);
    await card.hover();
    await card.locator('.fp-card-bulk-select-btn').click();
  }

  // The bulk toolbar appears; click its Delete action, then confirm in the modal.
  await page.locator('.fp-bulk-toolbar-slot button[aria-label="Delete"]').click();
  await page.locator('.delete-confirm-btn-danger', { hasText: 'Delete Collections' }).click();

  await expect(page.locator('.fp-collection-card')).toHaveCount(0);
  await expect.poll(async () => await ext.storage.local.get('collections_index')).toEqual({});
});
