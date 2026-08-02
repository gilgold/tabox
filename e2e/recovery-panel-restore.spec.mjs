import { test, expect } from 'crxbox';

// E2E (full-page variant): fullpage.html → Settings → "Recovery" category →
// rich SyncDebugRecoveryPanel → Restore an auto backup → collections updated.
//
// This exercises the full-page recovery path:
//  - Rendered only in the full-page settings (app/fullpage/FPTopBar.js renders
//    <SettingsMenu variant="fullpage">; the "Recovery" category renders
//    <SyncDebugRecoveryPanel mode="recovery">).
//  - Restore button is `.sync-recovery-primary-action` (aria-label "Restore backup auto:0"),
//    enabled when the backup is a full snapshot (tabsArray[0].tabs is an array).
//  - Clicking it shows a window.confirm() — Playwright auto-DISMISSES dialogs, so we must
//    register an accept handler or the restore aborts.
//  - Confirm → getBackupPreview → restoreBackupSelection {mode:'overwrite'} →
//    overwriteBackupSelection() saves each backup collection via saveSingleCollectionBG
//    (uid preserved) and creates an emergency auto backup of the prior state.

const T = 1_710_000_000_000;

const indexEntry = (name, color, tabCount) => ({
  name,
  type: 'collection',
  tabCount,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color,
  size: 0,
  parentId: null,
});

const SEED = {
  // Seed a logged-in session (harmless here; keeps parity with the popup test and avoids
  // any sync-gated UI surprises).
  syncSessionState: {
    isEnabled: true,
    status: 'active',
    user: { email: 'tester@example.com' },
    hasRefreshToken: false,
    error: null,
    lastCheckedAt: 0,
  },

  collections_index: {
    'col-old-1': indexEntry('Old Collection A', '#4fc3f7', 2),
    'col-old-2': indexEntry('Old Collection B', '#aed581', 1),
  },
  'collection_col-old-1': {
    uid: 'col-old-1',
    name: 'Old Collection A',
    color: '#4fc3f7',
    parentId: null,
    tabs: [
      { title: 'Old Tab 1', url: 'https://old1.example.com' },
      { title: 'Old Tab 2', url: 'https://old2.example.com' },
    ],
    chromeGroups: [],
    lastUpdated: T,
    lastOpened: null,
    createdOn: T,
  },
  'collection_col-old-2': {
    uid: 'col-old-2',
    name: 'Old Collection B',
    color: '#aed581',
    parentId: null,
    tabs: [{ title: 'Old Tab 3', url: 'https://old3.example.com' }],
    chromeGroups: [],
    lastUpdated: T,
    lastOpened: null,
    createdOn: T,
  },

  autoBackups: [
    {
      timestamp: T + 1,
      label: 'Snapshot before test',
      reason: 'Test auto backup',
      tabsArray: [
        {
          uid: 'col-restore-1',
          name: 'Restored Collection X',
          color: '#ff9800',
          parentId: null,
          tabs: [
            { title: 'New Tab 1', url: 'https://new1.example.com' },
            { title: 'New Tab 2', url: 'https://new2.example.com' },
            { title: 'New Tab 3', url: 'https://new3.example.com' },
          ],
          chromeGroups: [],
        },
        {
          uid: 'col-restore-2',
          name: 'Restored Collection Y',
          color: '#2196f3',
          parentId: null,
          tabs: [{ title: 'New Tab 4', url: 'https://new4.example.com' }],
          chromeGroups: [],
        },
      ],
      foldersArray: [],
    },
  ],
};

test('full-page Recovery panel restores an auto backup via the confirm dialog', async ({ ext, context }) => {
  await ext.storage.local.set(SEED);

  const page = await context.newPage();

  // Auto-accept the window.confirm() that the rich panel shows before restoring.
  // Without this, Playwright dismisses it (returns false) and the restore aborts.
  ext.acceptDialogs(page);

  await page.goto(ext.url('fullpage.html'));

  // Before restore, the backup's collections aren't present.
  expect(Object.keys(await ext.storage.local.get('collections_index'))).not.toContain(
    'col-restore-1',
  );

  // Open full-page Settings (same .settings-button trigger; opens the fp settings modal).
  await page.locator('.settings-button').click();
  const settingsModal = page.locator('.fp-settings-modal');
  await expect(settingsModal).toBeVisible();

  // Switch to the "Recovery" category — this mounts the rich panel and loads backups.
  await settingsModal.getByRole('button', { name: 'Recovery' }).click();

  // The auto backup renders a restorable row; restore it (aria-label is "Restore backup <id>").
  const restoreButton = page.getByRole('button', { name: 'Restore backup auto:0' });
  await expect(restoreButton).toBeEnabled();
  await restoreButton.click();

  // Restore round-trips through the service worker (preview → overwrite) and writes
  // asynchronously — poll the index for the restored collections.
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('collections_index')))
    .toEqual(expect.arrayContaining(['col-restore-1', 'col-restore-2']));

  const restored = await ext.storage.local.get('collection_col-restore-1');
  expect(restored).toMatchObject({
    uid: 'col-restore-1',
    name: 'Restored Collection X',
    color: '#ff9800',
  });
  expect(restored.tabs).toHaveLength(3);

  // Overwrite restore leaves unrelated existing collections in place.
  expect(Object.keys(await ext.storage.local.get('collections_index'))).toEqual(
    expect.arrayContaining(['col-old-1', 'col-old-2']),
  );
});
