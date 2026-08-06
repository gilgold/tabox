import { test, expect } from 'crxbox';
import { buildSeed, openFullPage } from './support/fixtures.mjs';

// Auto-Arrange live-update regression: after the SW-side writes (createFoldersBG +
// moveCollectionsToFoldersBG + updateFolderCountsBG) — and after an aiUndo — every
// open Tabox surface must reflect the change WITHOUT a manual reload.

const SEED = {
  collections: [
    { uid: 'c1', name: 'Alpha News' },
    { uid: 'c2', name: 'Beta Docs' },
  ],
  folders: [{ uid: 'f1', name: 'Work', order: 0 }],
};

// The same write sequence chrome/ai-task-auto-arrange.js performs in the SW.
// `collapsed: false` in the fullpage tests keeps the moved cards rendered inside
// the new folder's grouped section so their location can be asserted.
async function runArrangeWrites(ext, { collapsed = true } = {}) {
  return ext.background.evaluate(async (isCollapsed) => {
    const s = globalThis.TaboxAIStorage;
    const [created] = await s.createFoldersBG([{ name: 'AI Folder', color: '#4facfe', collapsed: isCollapsed }]);
    await s.moveCollectionsToFoldersBG([
      { uid: 'c1', parentId: created.uid },
      { uid: 'c2', parentId: created.uid },
    ]);
    await s.updateFolderCountsBG([created.uid]);
    return created.uid;
  }, collapsed);
}

function stubModel(ext, folders) {
  return ext.background.evaluate((plan) => {
    globalThis.TaboxAIClient = {
      createAISession: async () => ({ destroy() {} }),
      promptForJSON: async () => plan,
    };
  }, { folders });
}

test('full page updates live after SW-side auto-arrange writes', async ({ ext }) => {
  await ext.storage.local.set(buildSeed(SEED));
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();

  await runArrangeWrites(ext, { collapsed: false });

  // New folder in the sidebar, its grouped-section header shows both moved
  // collections ("AI Folder 2"), and the card renders under it.
  await expect(page.locator('.fp-sidebar-folder-item', { hasText: 'AI Folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI Folder 2' }).last()).toBeVisible();
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();
});

test('popup updates live after SW-side auto-arrange writes', async ({ ext }) => {
  await ext.storage.local.set(buildSeed(SEED));
  const popup = await ext.popup.open();
  await expect(popup.getByText('Alpha News')).toBeVisible();

  await runArrangeWrites(ext); // collapsed folder → moved items leave the visible list

  await expect(popup.getByText('AI Folder')).toBeVisible();
  await expect(popup.getByText('Alpha News')).toHaveCount(0);
});

test('REAL auto-arrange run (stubbed model) updates the open full page', async ({ ext }) => {
  await ext.storage.local.set(buildSeed(SEED));
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();

  // Stub only the Gemini client; everything else is the production path
  // (aiRun message → engine → task → storage writes → triggerSync).
  await stubModel(ext, [{ newFolderName: 'AI Folder', collectionIndexes: [1, 2] }]);
  const result = await ext.background.sendMessage({ type: 'aiRun', task: 'auto-arrange' });
  expect(result.status).toBe('done');
  const createdUid = result.undo.createdFolderUids[0];

  await expect(page.locator('.fp-sidebar-folder-item', { hasText: 'AI Folder' })).toBeVisible();
  const cIndex = await ext.storage.local.get('collections_index');
  expect(cIndex.c1.parentId).toBe(createdUid);
  expect(cIndex.c2.parentId).toBe(createdUid);
});

test('undo after a real run reverts the open full page without a reload', async ({ ext }) => {
  await ext.storage.local.set(buildSeed(SEED));
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();

  await stubModel(ext, [{ newFolderName: 'AI Folder', collectionIndexes: [1, 2] }]);
  const run = await ext.background.sendMessage({ type: 'aiRun', task: 'auto-arrange' });
  expect(run.status).toBe('done');
  await expect(page.locator('.fp-sidebar-folder-item', { hasText: 'AI Folder' })).toBeVisible();

  // Undo exactly as the modal's Undo button / toast dispatches it.
  await ext.background.sendMessage({ type: 'aiUndo' });

  // The created folder disappears and the collections render loose again.
  await expect(page.locator('.fp-sidebar-folder-item', { hasText: 'AI Folder' })).toHaveCount(0);
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();
  await expect(page.locator('.fp-collection-card', { hasText: 'Beta Docs' })).toBeVisible();
  const cIndex = await ext.storage.local.get('collections_index');
  expect(cIndex.c1.parentId).toBeNull();
  expect(cIndex.c2.parentId).toBeNull();
});

test('REAL run never files into a shared folder even if the model asks for it', async ({ ext }) => {
  const seed = buildSeed({
    ...SEED,
    folders: [
      { uid: 'f1', name: 'Work', order: 0 },
      { uid: 'sf1', name: 'Team Shared', order: 1 },
    ],
  });
  const shared = { folderId: 'srv-1', role: 'owner', ownerEmail: 'me@example.com', members: [] };
  seed.folders_index.sf1.shared = shared;
  seed.folder_sf1.shared = shared;
  await ext.storage.local.set(seed);
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();

  // Model tries to file everything into the shared folder — must be rejected.
  await stubModel(ext, [{ existingFolderId: 'sf1', collectionIndexes: [1, 2] }]);
  const result = await ext.background.sendMessage({ type: 'aiRun', task: 'auto-arrange' });
  expect(result.status).toBe('done');

  const index = await ext.storage.local.get('collections_index');
  expect(index.c1.parentId).not.toBe('sf1');
  expect(index.c2.parentId).not.toBe('sf1');
});

test('backgrounded full-page tab catches up after writes without a reload', async ({ ext, context }) => {
  await ext.storage.local.set(buildSeed(SEED));
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card', { hasText: 'Alpha News' })).toBeVisible();

  // Background the full-page tab behind a new active tab, then write.
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await runArrangeWrites(ext, { collapsed: false });
  await other.waitForTimeout(1000);

  await page.bringToFront();
  await expect(page.locator('.fp-sidebar-folder-item', { hasText: 'AI Folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI Folder 2' }).last()).toBeVisible();
});
