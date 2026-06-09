import { test, expect } from 'crxbox';

// Exercises crxbox's background/service-worker helpers against Tabox's real MV3 worker:
//   ext.background.sendMessage / evaluate / waitForReady / kill
//
// Two themes: (1) the SW responds to runtime messages, and code runs in its context;
// (2) an MV3 worker that is force-killed restarts on demand and data survives.

const T = 1_710_000_000_000;

const collection = (uid, name) => ({
  uid,
  name,
  color: '#4fc3f7',
  parentId: null,
  tabs: [{ title: `${name} tab`, url: `https://${uid}.example.com` }],
  chromeGroups: [],
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
});

const indexEntry = (name) => ({
  name,
  type: 'collection',
  tabCount: 1,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color: '#4fc3f7',
  size: 0,
  parentId: null,
});

const AUTO_BACKUP = {
  timestamp: T + 1,
  reason: 'Test auto backup',
  tabsArray: [
    { uid: 'b1', name: 'Backup One', color: '#ff9800', parentId: null, tabs: [{ title: 't', url: 'https://b1.example.com' }], chromeGroups: [] },
    { uid: 'b2', name: 'Backup Two', color: '#2196f3', parentId: null, tabs: [{ title: 't', url: 'https://b2.example.com' }], chromeGroups: [] },
  ],
  foldersArray: [],
};

test.describe('background / service worker helpers', () => {
  test('sendMessage round-trips through the SW (getBackupOptions)', async ({ ext }) => {
    await ext.storage.local.set({ autoBackups: [AUTO_BACKUP] });

    const res = await ext.background.sendMessage({ type: 'getBackupOptions' });

    // The SW reads storage and builds grouped descriptors.
    expect(res.autoBackups).toHaveLength(1);
    const autoGroup = res.groups.find((g) => g.key === 'auto');
    expect(autoGroup).toBeTruthy();
    expect(autoGroup.items[0]).toMatchObject({
      id: 'auto:0',
      collectionCount: 2,
      canOverwrite: true,
      previewType: 'full_export',
    });
  });

  test('evaluate runs inside the SW context (manifest + chrome.storage)', async ({ ext }) => {
    await ext.storage.local.set({ autoBackups: [AUTO_BACKUP] });

    const version = await ext.background.evaluate(() => chrome.runtime.getManifest().version);
    expect(version).toBe('4.1.2');

    // chrome.* APIs are reachable from the worker context.
    const backupCount = await ext.background.evaluate(async () => {
      const { autoBackups = [] } = await chrome.storage.local.get('autoBackups');
      return autoBackups.length;
    });
    expect(backupCount).toBe(1);
  });

  test('a force-killed SW restarts on demand and still serves messages', async ({ ext }) => {
    await ext.storage.local.set({ autoBackups: [AUTO_BACKUP] });
    await ext.background.waitForReady();

    await ext.background.kill();

    // After a forced kill the worker restarts on the next real event — sendMessage (sent
    // from a real extension page) is exactly such an event.
    const res = await ext.background.sendMessage({ type: 'getBackupOptions' });
    expect(res.autoBackups).toHaveLength(1);
  });

  test('collections written before a restart survive it (UI works after)', async ({ ext }) => {
    await ext.storage.local.set({
      collections_index: { 'col-a': indexEntry('Alpha'), 'col-b': indexEntry('Beta') },
      'collection_col-a': collection('col-a', 'Alpha'),
      'collection_col-b': collection('col-b', 'Beta'),
    });
    await ext.background.waitForReady();

    await ext.background.kill();

    // Opening the popup drives the worker awake again; the seeded data is intact.
    const popup = await ext.popup.open();
    await expect(popup.locator('[data-collection-drop-zone="true"]')).toHaveCount(2);
  });
});
