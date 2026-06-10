import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Batch B+C — collection operations.
//
// NOTE: A migration test was attempted but removed. Tabox's active migration is idempotent
// 4.0+ data repair (color/timestamp/deferred-URL via migrationSupport40 + migrationCoordinator),
// but `executeMigration` is gated behind extension-update / storage-version flows that aren't
// reachable by seeding storage + opening the extension. (Bare pre-4.0 `tabsArray` is, by
// design, NOT migrated — the app shows "Automatic migration is now limited to 4.0+ local
// data".) Logged as a testability-boundary finding in crxbox-feedback.md.

test('duplicates a collection from the card menu', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] }));
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card')).toHaveCount(1);

  const card = page.locator('[data-sortable-collection-id="col-a"]');
  await card.hover();
  await card.locator('.fp-card-menu-option').click();
  await page.locator('.context-menu-item', { hasText: 'Duplicate Collection' }).click();

  // A second collection now exists; the original remains.
  await expect(page.locator('.fp-collection-card')).toHaveCount(2);
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('collections_index')).length)
    .toBe(2);
  await expect(ext.storage.local).toHaveStorageValue(
    'collections_index',
    expect.objectContaining({ 'col-a': expect.objectContaining({ name: 'Alpha' }) }),
  );
});

test('changes a collection color via the color picker', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] }));
  const page = await openFullPage(ext);

  const card = page.locator('[data-sortable-collection-id="col-a"]');
  await card.hover();
  await card.locator('.fp-card-color-picker').click();
  await expect(page.locator('.modern-color-popover')).toBeVisible();
  await page.locator('.modern-color-popover .modern-color-option').first().click();

  // The collection's stored color changes from the seeded value.
  await expect
    .poll(async () => (await ext.storage.local.get('collection_col-a')).color)
    .not.toBe('#4fc3f7');
});

test('moves a collection into a folder by dragging onto the sidebar', async ({ ext, context }) => {
  await ext.storage.local.set(
    buildSeed({
      collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }],
      folders: [{ uid: 'fold-1', name: 'Work', order: 0 }],
    }),
  );
  const page = await openFullPage(ext);
  await expect(page.locator('[data-sortable-collection-id="col-a"]')).toBeVisible();

  // Drag the root collection card onto the "Work" folder row in the sidebar.
  await ext.dragAndDrop(
    page.locator('[data-sortable-collection-id="col-a"]'),
    page.locator('[data-sidebar-folder-uid="fold-1"]'),
  );

  await expect
    .poll(async () => (await ext.storage.local.get('collection_col-a')).parentId)
    .toBe('fold-1');
});
