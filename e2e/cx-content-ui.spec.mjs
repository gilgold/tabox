import { test, expect } from 'crxbox';

// crxbox gap-closure: ext.contentUi(). Tabox ships no content script, so we simulate the
// injected-UI shape by setting page content with a known root, then assert crxbox scopes
// locators into it. We also cover the failure diagnostic when the root never appears.

test('contentUi scopes locators into an injected root', async ({ ext, context }) => {
  const page = await context.newPage();
  await page.setContent(`
    <div id="other"><button>Decoy</button></div>
    <div data-ext-root>
      <h2>Injected Panel</h2>
      <button>Save</button>
    </div>
  `);

  const ui = await ext.contentUi(page, { root: '[data-ext-root]' });

  await expect(ui.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(ui.getByText('Injected Panel')).toBeVisible();
  // Scoped: the decoy button outside the root is not matched.
  await expect(ui.getByRole('button', { name: 'Decoy' })).toHaveCount(0);
});

test('contentUi reports content-ui/not-injected when the root never appears', async ({ ext, context }) => {
  const page = await context.newPage();
  await page.setContent('<div>no injected root here</div>');

  let error;
  try {
    await ext.contentUi(page, { root: '[data-ext-root]', timeout: 600 });
  } catch (e) {
    error = e;
  }

  expect(error).toBeTruthy();
  expect(error.diagnostic?.code).toBe('content-ui/not-injected');
});
