import { test, expect } from 'crxbox';

// Smoke test for the crxbox UI-testing setup: open the popup and verify that
// clicking the gear button opens the Settings drawer.
//
// Popup is the manifest's action.default_popup (index.html). The settings trigger
// is a `.settings-button` div in app/SettingsMenu.js; opening it slides in a
// `.custom-drawer` whose header reads "Settings".
test.describe('popup settings menu', () => {
  test('opens the settings drawer from the gear button', async ({ ext }) => {
    const popup = await ext.popup.open();

    const settingsButton = popup.locator('.settings-button');
    await expect(settingsButton).toBeVisible();

    // Drawer starts closed.
    await expect(popup.locator('.custom-drawer.open')).toHaveCount(0);

    await settingsButton.click();

    // Drawer slides in and shows the "Settings" header.
    const drawer = popup.locator('.custom-drawer.open');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
});
