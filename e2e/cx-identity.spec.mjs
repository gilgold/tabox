import { test, expect } from 'crxbox';

// crxbox gap-closure: identity primitives (ext.id, ext.url) and the best-effort
// popup.openForTab() contract.

test('ext.id and ext.url expose the loaded extension identity', async ({ ext }) => {
  // Chrome extension ids are 32 chars in a–p.
  expect(ext.id).toMatch(/^[a-p]{32}$/);
  expect(ext.url('fullpage.html')).toBe(`chrome-extension://${ext.id}/fullpage.html`);
  expect(ext.url('index.html')).toBe(`chrome-extension://${ext.id}/index.html`);
});

test('popup.openForTab() either binds to the active tab or reports popup/no-active-tab', async ({ ext, context }) => {
  // openForTab is documented best-effort (needs Chrome 127+, a focused window; flaky in new
  // headless). We assert the documented contract: it resolves to the popup page, or throws a
  // CrxboxError with the popup/no-active-tab diagnostic — never anything else.
  const tab = await context.newPage();
  await tab.goto(ext.url('index.html'));

  let popup;
  let error;
  try {
    popup = await ext.popup.openForTab(tab);
  } catch (e) {
    error = e;
  }

  if (popup) {
    expect(popup.url()).toContain('index.html');
  } else {
    expect(error?.diagnostic?.code).toBe('popup/no-active-tab');
  }
});
