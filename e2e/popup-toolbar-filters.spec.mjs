import { test, expect } from 'crxbox';
import { buildSeed } from './support/fixtures.mjs';

// Regression: activating a filter reveals the leading clear-button area, which
// must not push the popup toolbar onto a second row (the toolbar wrapper is
// position:fixed, so a wrapped second row overlaps the collection list).
// Historically the full-page @media(max-width:900px) .fp-toolbar rules leaked
// into the 670px popup and made it wrap once the favorites star pill was added.

async function measureToolbar(popup) {
  return popup.evaluate(() => {
    const toolbar = document.querySelector('.collections-toolbar');
    const rows = new Set(
      [...toolbar.children]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    return {
      rowCount: rows.size,
      height: toolbar.getBoundingClientRect().height,
      overflowsHorizontally: toolbar.scrollWidth > toolbar.clientWidth,
    };
  });
}

test('popup toolbar stays on a single row when filters are active', async ({ ext }) => {
  const seed = buildSeed({ collections: [{ uid: 'col-a', name: 'a collection', order: 0 }] });
  seed['collection_col-a'].isFavorite = true;
  seed['collection_col-a'].favoriteOrder = 0;
  seed.collections_index['col-a'].isFavorite = true;
  seed.collections_index['col-a'].favoriteOrder = 0;
  await ext.storage.local.set(seed);

  const popup = await ext.popup.open();
  await expect(popup.locator('.collections-toolbar')).toBeVisible();

  const before = await measureToolbar(popup);
  expect(before.rowCount).toBe(1);
  expect(before.overflowsHorizontally).toBe(false);

  // Favorites filter on: clear button appears, list narrows to favorites.
  await popup.locator('#filter-favorites').click();
  await expect(popup.locator('.fp-toolbar-leading.is-visible')).toBeVisible();

  const withFavorites = await measureToolbar(popup);
  expect(withFavorites.rowCount).toBe(1);
  expect(withFavorites.overflowsHorizontally).toBe(false);
  expect(withFavorites.height).toBe(before.height);

  // Stack the second filter on top — worst-case width.
  await popup.locator('#filter-recently-opened').click();
  const withBoth = await measureToolbar(popup);
  expect(withBoth.rowCount).toBe(1);
  expect(withBoth.overflowsHorizontally).toBe(false);
});
