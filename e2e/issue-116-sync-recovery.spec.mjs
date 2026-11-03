import { test, expect } from 'crxbox';
import { NO_ONBOARDING, seedStorage } from './support/fixtures.mjs';

// Exercise the built UI and real service-worker message path with simulated
// withheld host access. No Google account or live network request is used.
for (const view of ['index.html', 'fullpage.html']) {
  test(`${view}: missing access fails recovery without changing local sync state`, async ({ ext, context }) => {
    await seedStorage(ext, {
      ...NO_ONBOARDING,
      googleUser: { displayName: 'Test User', emailAddress: 'test@example.com' },
      googleRefreshToken: 'test-refresh-token',
      localTimestamp: 123,
    });
    await ext.storage.sync.set({ syncFileId: 'existing-file' });
    await ext.background.evaluate(() => {
      globalThis.__originalSyncContains = browser.permissions.contains;
      globalThis.__originalSyncFetch = fetch;
      browser.permissions.contains = async () => false;
      globalThis.fetch = async () => { throw new Error('Network disabled in sync recovery test'); };
    });
    try {
      const page = await context.newPage();
      await page.goto(ext.url(view));
      await page.locator('.settings-button').click();
      await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
      const download = page.getByRole('button', { name: 'Force Download from Server' });
      await download.click();
      await expect(page.getByText('Download failed. Check sync status and try again.')).toBeVisible();
      await expect(download).toBeEnabled();
      await expect(page.getByText('Sync download completed', { exact: true })).toHaveCount(0);
      ext.acceptDialogs(page);
      await page.getByRole('button', { name: 'Reset Sync State' }).click();
      await expect(page.getByText('Sync reset failed', { exact: true })).toBeVisible();
      await expect(page.getByText('Sync reset completed', { exact: true })).toHaveCount(0);
      expect(await ext.storage.local.get('localTimestamp')).toBe(123);
      expect(await ext.storage.sync.get('syncFileId')).toBe('existing-file');
      const state = await ext.storage.local.get('syncSessionState');
      expect(state.error).toContain('Google site access');
    } finally {
      await ext.background.evaluate(() => {
        browser.permissions.contains = globalThis.__originalSyncContains;
        globalThis.fetch = globalThis.__originalSyncFetch;
      });
    }
  });
}
