import { test, expect } from 'crxbox';
import { openFullPage } from './support/fixtures.mjs';

// Quick tab switcher: Ctrl/Cmd+Shift+S palette listing all open tabs.
// The in-app listener accepts ctrlKey OR metaKey, so Control+Shift+S works on every OS.

const pageUrl = (title) => `data:text/html,<title>${title}</title><h1>${title}</h1>`;

const openSwitcher = async (page) => {
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.tab-switcher-card')).toBeVisible();
  // Focus lands on the search input after a double-rAF; keyboard interaction
  // (arrows/Enter/Escape bubble to the overlay) needs it settled first.
  await expect(page.locator('.tab-switcher-input')).toBeFocused();
};

// data: URLs may round-trip through tabs.query encoded or raw depending on the
// browser build — normalize before matching.
const activeTabUrl = async (ext, windowId) => {
  const tabs = await ext.tabs.query({ windowId, active: true });
  return decodeURIComponent(tabs[0]?.url || '');
};

test.describe('quick tab switcher', () => {
  test('Ctrl+Shift+S opens the switcher in the popup and lists tabs from other windows', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Alpha Page'), pageUrl('Beta Page')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await expect(popup.locator('.tab-switcher-row', { hasText: 'Alpha Page' })).toBeVisible();
    await expect(popup.locator('.tab-switcher-row', { hasText: 'Beta Page' })).toBeVisible();
    // window labels are rendered on rows
    await expect(popup.locator('.tab-switcher-window-badge').first()).toBeVisible();
  });

  test('the shortcut also works in the full-page view, and Escape closes it', async ({ ext }) => {
    const page = await openFullPage(ext);
    await openSwitcher(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tab-switcher-card')).toHaveCount(0);
  });

  test('header buttons open the switcher in both views', async ({ ext }) => {
    const popup = await ext.popup.open();
    await popup.locator('[data-testid="tab-switcher-button"]').click();
    await expect(popup.locator('.tab-switcher-card')).toBeVisible();

    const page = await openFullPage(ext);
    await page.locator('[data-testid="tab-switcher-button"]').click();
    await expect(page.locator('.tab-switcher-card')).toBeVisible();
  });

  test('typing filters across windows by title and highlights the match', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Unique Zebra Tab'), pageUrl('Plain Tab')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-input').fill('zebra');
    await expect(popup.locator('.tab-switcher-row')).toHaveCount(1);
    await expect(popup.locator('.tab-switcher-row')).toContainText('Unique Zebra Tab');
    await expect(popup.locator('.tab-switcher-match').first()).toBeVisible();
  });

  test('filtering by URL works too', async ({ ext }) => {
    await ext.windows.create({ tabs: ['data:text/html,<title>By Url</title>findme-in-url'] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-input').fill('findme-in-url');
    await expect(popup.locator('.tab-switcher-row')).toHaveCount(1);
  });

  test('Enter activates the selected tab and focuses its window', async ({ ext }) => {
    // windows.create activates the LAST seeded tab, so Target Beta (first)
    // starts inactive — switching to it is a real state change.
    const win = await ext.windows.create({ tabs: [pageUrl('Target Beta'), pageUrl('Target Alpha')] });
    expect(await activeTabUrl(ext, win.id)).toContain('Target Alpha');
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-input').fill('target beta');
    await expect(popup.locator('.tab-switcher-row')).toHaveCount(1);
    await popup.keyboard.press('Enter');
    await expect.poll(() => activeTabUrl(ext, win.id)).toContain('Target Beta');
  });

  test('clicking a row activates that tab', async ({ ext }) => {
    const win = await ext.windows.create({ tabs: [pageUrl('Click Beta'), pageUrl('Click Alpha')] });
    expect(await activeTabUrl(ext, win.id)).toContain('Click Alpha');
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-row', { hasText: 'Click Beta' }).click();
    await expect.poll(() => activeTabUrl(ext, win.id)).toContain('Click Beta');
  });

  test('right-click opens the live-tab context menu and Close tab closes the tab', async ({ ext }) => {
    const win = await ext.windows.create({ tabs: [pageUrl('Keep Me'), pageUrl('Close Me')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    const row = popup.locator('.tab-switcher-row', { hasText: 'Close Me' });
    await row.click({ button: 'right' });
    await expect(popup.locator('.context-menu')).toBeVisible();
    // full live-tab action set
    for (const item of ['Switch to tab', 'Copy URL', 'Pin tab', 'Mute tab', 'Move to new window', 'Close tab']) {
      await expect(popup.locator('.context-menu-item', { hasText: item })).toBeVisible();
    }
    await popup.locator('.context-menu-item', { hasText: 'Close tab' }).click();
    // The popup itself is a tab in this window in e2e, so assert on the
    // specific tabs rather than an absolute count.
    const windowUrls = async () =>
      (await ext.tabs.query({ windowId: win.id })).map((t) => decodeURIComponent(t.url || ''));
    await expect.poll(async () => (await windowUrls()).some((u) => u.includes('Close Me'))).toBe(false);
    expect((await windowUrls()).some((u) => u.includes('Keep Me'))).toBe(true);
    // the switcher stays open and drops the closed row
    await expect(popup.locator('.tab-switcher-card')).toBeVisible();
    await expect(popup.locator('.tab-switcher-row', { hasText: 'Close Me' })).toHaveCount(0);
  });

  test('without the optional permission the preview pane shows the fallback card and enable button', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Preview Target')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await expect(popup.locator('.tab-switcher-preview')).toBeVisible();
    await expect(popup.locator('.tab-switcher-preview-card')).toBeVisible();
    await expect(popup.locator('.tab-switcher-enable-previews')).toHaveText('Enable tab previews');
  });

  test('arrow keys move the selection', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Nav One'), pageUrl('Nav Two')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    const selectedTitle = popup.locator('.tab-switcher-row.selected .tab-switcher-row-title');
    // Initial selection mirrors Cmd+Tab: the most recently used tab that isn't
    // the one the switcher was opened from — here, Nav Two (active in the
    // seeded window). Waiting for it also settles the async initial-select.
    await expect(selectedTitle).toHaveText('Nav Two');
    await popup.keyboard.press('ArrowDown');
    await expect(selectedTitle).not.toHaveText('Nav Two');
  });

  test('search row stays fixed in the popup while arrowing through a long list', async ({ ext }) => {
    // Regression: in the popup's column layout the results list — not the
    // card — must be the scroll container, or scrollIntoView drags the
    // search input out of view (the fullpage row layout never had the bug).
    const manyTabs = Array.from({ length: 25 }, (_, i) => pageUrl(`Bulk Tab ${i + 1}`));
    await ext.windows.create({ tabs: manyTabs });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await expect(popup.locator('.tab-switcher-row').first()).toBeVisible();

    const inputBefore = await popup.locator('.tab-switcher-input').boundingBox();
    for (let i = 0; i < 18; i++) {
      await popup.keyboard.press('ArrowDown');
    }
    // The selected row scrolled into view inside the results container...
    await expect(popup.locator('.tab-switcher-row.selected')).toBeInViewport();
    const scrollTop = await popup.locator('.tab-switcher-results').evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    // ...while the search input did not move (small tolerance: favicon loads
    // settle row heights by ~1px; the bug this guards against scrolls the
    // input dozens of pixels up and out of the card) and stays usable.
    const inputAfter = await popup.locator('.tab-switcher-input').boundingBox();
    expect(Math.abs(inputAfter.y - inputBefore.y)).toBeLessThan(5);
    await expect(popup.locator('.tab-switcher-input')).toBeInViewport();
    await expect(popup.locator('.tab-switcher-input')).toBeFocused();
  });
});
