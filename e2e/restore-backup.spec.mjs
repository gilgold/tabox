import { test, expect } from 'crxbox';

// E2E: Settings → "Sync Debug & Recovery" → Restore an auto backup → collections updated.
//
// Flow (verified against the source):
//  - The popup's "Sync Debug & Recovery" button only renders when logged into sync
//    (`isVisible: isLoggedIn`, app/SettingsMenu.js). `isLoggedIn` is derived from the
//    cached `syncSessionState` (app/App.js checkSyncStatus → isSyncSessionEnabled), so we
//    seed `syncSessionState.isEnabled = true` to boot the popup "logged in".
//  - That button opens the simple SyncDebugModal (popup variant), which lists `autoBackups`
//    and renders a `.sync-debug-backup-btn` "Restore" per backup.
//  - Restore → `recoverFromBackup` message → background `updateAllCollectionsBG(tabsArray)`
//    which MERGES the backup's collections into indexed storage (`collections_index` +
//    `collection_<uid>`), preserving each collection's `uid`.

const T = 1_710_000_000_000;

// Two collections that exist BEFORE the restore.
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
  // Make the popup boot "logged in" so the Sync Debug & Recovery item is rendered.
  // isEnabled:true short-circuits isSyncSessionEnabled; hasRefreshToken:false makes
  // checkSyncStatus skip the background re-check that could flip it back.
  syncSessionState: {
    isEnabled: true,
    status: 'active',
    user: { email: 'tester@example.com' },
    hasRefreshToken: false,
    error: null,
    lastCheckedAt: 0,
  },

  // Initial collections (the "before" state).
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

  // A single auto backup whose collections DIFFER from the current ones.
  autoBackups: [
    {
      timestamp: T + 1,
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

test('restoring an auto backup updates the stored collections', async ({ ext }) => {
  await ext.storage.local.set(SEED);

  const popup = await ext.popup.open();

  // Sanity: before restore, the backup's collections are not present yet.
  const indexBefore = await ext.storage.local.get('collections_index');
  expect(Object.keys(indexBefore)).toEqual(
    expect.arrayContaining(['col-old-1', 'col-old-2']),
  );
  expect(Object.keys(indexBefore)).not.toContain('col-restore-1');

  // Open Settings.
  await popup.locator('.settings-button').click();
  await expect(popup.locator('.custom-drawer.open')).toBeVisible();

  // Open "Sync Debug & Recovery" (visible only because we seeded a logged-in session).
  await popup.getByRole('button', { name: 'Sync Debug & Recovery' }).click();

  // The modal lists the seeded auto backup with a Restore button. Scope to the
  // "Auto Backups" group so we don't accidentally match a pre-sync/version restore.
  const autoGroup = popup
    .locator('.sync-debug-backup-group')
    .filter({ hasText: 'Auto Backups' });
  const restoreButton = autoGroup.getByRole('button', { name: 'Restore' });
  await expect(restoreButton).toBeVisible();
  await restoreButton.click();

  // The restore round-trips through the service worker and writes asynchronously,
  // so poll the index rather than reading once (per crxbox guidance).
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('collections_index')))
    .toEqual(expect.arrayContaining(['col-restore-1', 'col-restore-2']));

  // The restored collection matches the backup's contents.
  const restored = await ext.storage.local.get('collection_col-restore-1');
  expect(restored).toMatchObject({
    uid: 'col-restore-1',
    name: 'Restored Collection X',
    color: '#ff9800',
  });
  expect(restored.tabs).toHaveLength(3);
  expect(restored.tabs.map((tab) => tab.url)).toEqual([
    'https://new1.example.com',
    'https://new2.example.com',
    'https://new3.example.com',
  ]);

  // The pre-existing collections are untouched (recover merges, it does not wipe).
  expect(Object.keys(await ext.storage.local.get('collections_index'))).toEqual(
    expect.arrayContaining(['col-old-1', 'col-old-2']),
  );
});
