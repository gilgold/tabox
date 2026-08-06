import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Regression: the Favorites sidebar view must render its cards with the exact
// same grid layout as All Collections. It once wrapped cards in its own
// <section>, which became a single grid item of .fp-content-grid and squeezed
// every card into one narrow column.

function favoritesSeed() {
  const seed = buildSeed({
    collections: [
      { uid: 'col-a', name: 'Alpha', order: 0 },
      { uid: 'col-b', name: 'Beta', order: 1 },
      { uid: 'col-c', name: 'Gamma', order: 2 },
    ],
  });
  ['col-a', 'col-b'].forEach((uid, i) => {
    seed[`collection_${uid}`].isFavorite = true;
    seed[`collection_${uid}`].favoriteOrder = i;
    seed.collections_index[uid].isFavorite = true;
    seed.collections_index[uid].favoriteOrder = i;
  });
  return seed;
}

async function cardMetrics(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.fp-collection-card')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y) };
    });
    return cards;
  });
}

test('favorites view uses the same card grid as All Collections', async ({ ext }) => {
  await ext.storage.local.set(favoritesSeed());
  const page = await openFullPage(ext);
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator('.fp-collection-card')).toHaveCount(3);

  const allCards = await cardMetrics(page);
  const allCardWidth = allCards[0].w;

  await page.locator('.fp-sidebar-nav-item', { hasText: 'Favorites' }).click();
  await expect(page.locator('.fp-collection-card')).toHaveCount(2);

  const favCards = await cardMetrics(page);

  // Same card width as the main grid.
  expect(favCards[0].w).toBe(allCardWidth);
  expect(favCards[1].w).toBe(allCardWidth);
  // Cards flow across the grid row, not stacked in one column.
  expect(favCards[0].y).toBe(favCards[1].y);
  expect(favCards[1].x).toBeGreaterThan(favCards[0].x);
});

test('favorites view shows the empty hint when nothing is starred', async ({ ext }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] }));
  const page = await openFullPage(ext);
  await page.locator('.fp-sidebar-nav-item', { hasText: 'Favorites' }).click();
  await expect(page.locator('.fp-favorites-empty-hint')).toHaveText('Star a collection to pin it here');
});
