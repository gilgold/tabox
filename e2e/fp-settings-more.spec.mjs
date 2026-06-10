import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Batch E — remaining settings toggles + theme persistence.

async function openSettings(page) {
  await page.locator('.settings-button').click();
  await expect(page.locator('.fp-settings-modal')).toBeVisible();
}

test('Performance Mode toggle persists chkPerformanceMode and adds the body class', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }));
  const page = await openFullPage(ext);
  await openSettings(page);

  await page.locator('label[for="chkPerformanceMode"]').click();

  await expect.poll(async () => await ext.storage.local.get('chkPerformanceMode')).toBe(true);
  // handlePerformanceMode reflects the setting on <html> as a class.
  await expect.poll(() => page.locator('html').evaluate((el) => el.classList.contains('performance-mode'))).toBe(true);
});

test('Toolbar launch mode toggle persists chkToolbarIconOpensFullPage', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }));
  const page = await openFullPage(ext);
  await openSettings(page);

  await page.locator('label[for="chkToolbarIconOpensFullPage"]').click();

  await expect.poll(async () => await ext.storage.local.get('chkToolbarIconOpensFullPage')).toBe(true);
});

test('a seeded dark theme persists across load (switch reflects stored state)', async ({ ext, context }) => {
  await ext.storage.local.set({
    ...buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }),
    theme: 'dark',
    darkModeToggle: true,
  });
  const page = await openFullPage(ext);
  await openSettings(page);

  // The Switch initializes its checked state from storage[darkModeToggle].
  await expect(page.locator('#darkModeToggle')).toBeChecked();
});
