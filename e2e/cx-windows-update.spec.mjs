import { test, expect } from 'crxbox';
import { T } from './support/fixtures.mjs';

// Probe of crxbox 0.1.0 additions against the two boundaries flagged in the assessment:
//   §6.5 #1 — a real window seeded with known tabs (ext.windows / ext.tabs)
//   §6.5 #2 — update-gated migration becomes reachable (ext.simulateUpdate)

test('ext.windows.create seeds a real window with known tabs; ext.tabs.query sees them', async ({ ext }) => {
  const win = await ext.windows.create({
    tabs: [ext.url('index.html'), ext.url('fullpage.html')],
  });

  expect(win.id).toBeGreaterThan(0);
  expect(win.tabs).toHaveLength(2);

  const urls = (await ext.tabs.query({ windowId: win.id })).map((t) => t.url);
  expect(urls).toEqual(
    expect.arrayContaining([ext.url('index.html'), ext.url('fullpage.html')]),
  );
});

test('ext.simulateUpdate unlocks update-gated migration (deferred-URL repair)', async ({ ext }) => {
  // Previously UNTESTABLE (assessment §6.5 #2): Tabox's data-repair migration only runs when
  // the SW's onInstalled fires with reason "update" (sets extensionUpdated) — which storage
  // seeding alone can't trigger.
  const real = 'https://real.example.com/page';
  const wrapped = `${ext.url('deferedLoading.html')}?url=${encodeURIComponent(real)}`;
  await ext.storage.local.set({
    collections_index: {
      'col-a': { name: 'Alpha', type: 'collection', tabCount: 1, lastUpdated: T, lastOpened: null, createdOn: T, color: 'blue', size: 0, parentId: null, order: 0 },
    },
    'collection_col-a': {
      uid: 'col-a', name: 'Alpha', color: 'blue', parentId: null, order: 0,
      lastUpdated: T, lastOpened: null, createdOn: T,
      tabs: [{ title: 'Real', url: wrapped }], chromeGroups: [],
    },
  });

  await ext.simulateUpdate({ reason: 'update', previousVersion: '4.0.0' });

  // Tabox's SW should have recorded the update…
  await expect.poll(async () => await ext.storage.local.get('extensionUpdated')).toBe(true);

  // …so opening the app now runs the update-gated migration, which unwraps the deferred URL.
  const popup = await ext.popup.open();
  await expect(popup.locator('[data-collection-drop-zone="true"]')).toHaveCount(1);
  await expect
    .poll(async () => (await ext.storage.local.get('collection_col-a')).tabs[0].url)
    .toBe(real);
});

test('save-current-tabs: openInWindow lets the popup capture a seeded window\'s tabs', async ({ ext }) => {
  // THE boundary (assessment §6.5 #1): Tabox's "Add Collection" saves the CURRENT window's tabs
  // via { currentWindow: true }. Previously untestable because popup-as-page lived in its own
  // window. 0.2.0's `popup.openInWindow()` opens the popup as a tab inside a chosen window, so
  // current-window queries resolve to THAT window.
  // Seed two distinct tabs. (crxbox 0.2.1 fixed `windows.create` hanging on data: URLs, so
  // we can use clean, distinguishable data: URLs here.)
  const tabA = 'data:text/html,<title>Tab A</title>';
  const tabB = 'data:text/html,<title>Tab B</title>';
  const win = await ext.windows.create({ tabs: [tabA, tabB] });

  const popup = await ext.popup.openInWindow(win);

  await popup.locator('#new_setting_title').fill('Saved From Window');
  await popup.locator('#add_new_setting').click();

  // A collection was saved capturing the seeded window's tabs.
  await expect
    .poll(async () => Object.keys((await ext.storage.local.get('collections_index')) || {}).length)
    .toBe(1);

  const idx = await ext.storage.local.get('collections_index');
  const uid = Object.keys(idx)[0];
  expect(idx[uid].name).toBe('Saved From Window');
  const saved = await ext.storage.local.get(`collection_${uid}`);
  const urls = saved.tabs.map((t) => t.url);
  expect(urls).toEqual(expect.arrayContaining([tabA, tabB]));
});
