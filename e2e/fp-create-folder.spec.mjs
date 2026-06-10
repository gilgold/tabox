import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Full-page "create folder" flow: sidebar + button → CreateFolderModal → addFolder →
// createFolder writes folder_<uid> and updates folders_index.

test('creates a new folder from the sidebar', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ folders: [{ uid: 'f1', name: 'Work', order: 0 }] }));
  const page = await openFullPage(ext);

  await expect(page.locator('[data-sidebar-folder-uid]')).toHaveCount(1);

  // Open the create-folder modal, name it, submit.
  await page.locator('.fp-sidebar-add-folder').click();
  const input = page.locator('#folder-name-input');
  await expect(input).toBeVisible();
  await input.fill('Research');
  await page.getByRole('button', { name: 'Create Folder' }).click();

  // The new folder is persisted to folders_index and appears in the sidebar.
  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('folders_index');
      return Object.values(idx).map((f) => f.name).sort();
    })
    .toEqual(['Research', 'Work']);

  await expect(page.locator('.fp-sidebar-folder-item', { hasText: 'Research' })).toBeVisible();
});
