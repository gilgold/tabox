import { test, expect } from 'crxbox';
import { buildSeed, openFullPage, seedStorage } from './support/fixtures.mjs';
import { startDrag, dragOver, drop } from './support/dnd.mjs';

test('mouse dragging works when a touchscreen is also present', async ({ ext }) => {
  await seedStorage(ext, buildSeed({
    collections: [{ uid: 'hybrid-card', name: 'Hybrid card', order: 0 }],
    folders: [{ uid: 'hybrid-folder', name: 'Destination', order: 0 }],
  }));
  const page = await openFullPage(ext);
  // Emulate the media-query combination of a laptop with both touch and mouse.
  // The drag below uses actual mouse events against the built extension.
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = matchMedia(query);
      if (query === '(any-pointer: coarse)') Object.defineProperty(result, 'matches', { value: true });
      return result;
    };
  });
  await page.reload();
  const card = page.locator('[data-sortable-collection-id="hybrid-card"]');
  const destination = page.locator('[data-sidebar-folder-uid="hybrid-folder"] .fp-sidebar-folder-item');
  await expect(card).toBeVisible();
  await startDrag(page, card);
  await dragOver(page, destination);
  await expect(destination).toHaveClass(/fp-sidebar-drop-over/);
  await drop(page);
  await expect.poll(async () => (await ext.storage.local.get('collections_index'))['hybrid-card'].parentId)
    .toBe('hybrid-folder');
});
