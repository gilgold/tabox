import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Full-page settings modal (SettingsMenu variant="fullpage"): toggle General switches and
// verify each persists to its storage key. Switches are <input id> + <label htmlFor>; the
// label is the clickable surface (the dark-mode switch also writes `theme` via onMouseUp).

async function openSettings(page) {
  await page.locator('.settings-button').click();
  await expect(page.locator('.fp-settings-modal')).toBeVisible();
  // "General Settings" is the default active category.
}

test('Dark Mode toggle persists theme + darkModeToggle and sets the theme attribute', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }));
  const page = await openFullPage(ext);
  await openSettings(page);

  await page.locator('label[for="darkModeToggle"]').click();

  await expect
    .poll(async () => ({
      theme: await ext.storage.local.get('theme'),
      flag: await ext.storage.local.get('darkModeToggle'),
    }))
    .toEqual({ theme: 'dark', flag: true });

  // handleDarkModeToggle also reflects the theme on the document element.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Tab counter badge toggle persists chkShowBadge', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }));
  const page = await openFullPage(ext);
  await openSettings(page);

  await page.locator('label[for="chkShowBadge"]').click();

  await expect.poll(async () => await ext.storage.local.get('chkShowBadge')).toBe(true);
  await expect(ext.storage.local).toHaveStorageValue('chkShowBadge', true);
});
