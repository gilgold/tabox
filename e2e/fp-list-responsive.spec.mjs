import { test, expect } from 'crxbox';
import { buildSeed, openFullPage, tab } from './support/fixtures.mjs';

// List-view rows must keep collection names readable when the detail panel
// (45vw) squeezes the content area on smaller screens: favicons and secondary
// metadata drop out before the title loses its minimum width.

const manyTabs = (prefix) =>
  Array.from({ length: 20 }, (_, i) => tab(`${prefix}-t${i}`, `${prefix} tab ${i}`));

const SEED = buildSeed({
  collections: [
    { uid: 'col-a', name: 'Selected Collection', order: 0, tabs: manyTabs('a') },
    { uid: 'col-b', name: 'Squeezed Collection Name', order: 1, tabs: manyTabs('b') },
  ],
});

test('list rows keep the collection name visible when the detail panel opens on a narrow window', async ({ ext }) => {
  await ext.storage.local.set({ ...SEED, fpViewMode: 'list' });
  const page = await openFullPage(ext);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('.fp-collection-card')).toHaveCount(2);

  const squeezedCard = page.locator('.fp-collection-card', { hasText: 'Squeezed Collection Name' });

  // Wide state (no panel): the favicon strip is part of the row.
  await expect(squeezedCard.locator('.fp-card-favicons')).toBeVisible();

  // Open the detail panel — the content area narrows to ~half the window.
  await page.getByRole('button', { name: 'Open collection Selected Collection' }).click();
  await expect(page.locator('.fp-detail-panel.open')).toBeVisible();

  // The favicon strip yields (container query) instead of crushing the title…
  await expect(squeezedCard.locator('.fp-card-favicons')).toBeHidden();

  // …so the name keeps its guaranteed minimum width and stays readable.
  const titleRow = squeezedCard.locator('.fp-card-title-row');
  await expect(titleRow).toBeVisible();
  const box = await titleRow.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(140);
  await expect(squeezedCard.locator('.fp-card-title')).toHaveText('Squeezed Collection Name');
});
