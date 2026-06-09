import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Batch D — folder operations via the sidebar context menu (right-click → Edit / Delete).

test('renames a folder via Edit Folder', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ folders: [{ uid: 'f1', name: 'Work', order: 0 }] }));
  const page = await openFullPage(ext);

  await page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item').click({ button: 'right' });
  await page.locator('.fp-sidebar-ctx-item', { hasText: 'Edit Folder' }).click();

  // CreateFolderModal opens in edit mode, pre-filled with the current name.
  const input = page.locator('#folder-name-input');
  await expect(input).toHaveValue('Work');
  await input.fill('Renamed');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect
    .poll(async () => (await ext.storage.local.get('folders_index'))['f1'].name)
    .toBe('Renamed');
  await expect(page.locator('[data-sidebar-folder-uid="f1"]')).toContainText('Renamed');
});

test('deletes an empty folder via Delete Folder', async ({ ext, context }) => {
  await ext.storage.local.set(
    buildSeed({
      folders: [
        { uid: 'f1', name: 'Keep', order: 0 },
        { uid: 'f2', name: 'Trash', order: 1 },
      ],
    }),
  );
  const page = await openFullPage(ext);
  await expect(page.locator('[data-sidebar-folder-uid]')).toHaveCount(2);

  // Deleting an empty folder (collectionCount 0) skips the confirm modal.
  await page.locator('[data-sidebar-folder-uid="f2"] .fp-sidebar-folder-item').click({ button: 'right' });
  await page.locator('.fp-sidebar-ctx-item', { hasText: 'Delete Folder' }).click();

  await expect(page.locator('[data-sidebar-folder-uid="f2"]')).toHaveCount(0);
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('folders_index')))
    .toEqual(['f1']);
});
