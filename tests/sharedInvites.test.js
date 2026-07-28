// Task 12: invite polling (with Chrome notifications) + invite response
// (accept materializes the shared folder + collections locally; decline just
// drops the pending invite).
import { browser } from '../static/globals';
import { pollInvites, respondToInvite, SHARED_PENDING_INVITES_KEY, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn().mockResolvedValue('tok'),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as static
// jest.fn()s (no real backing store, no `.clear()`) — install a tiny in-memory
// store here, mirroring tests/sharedFoldersClient.test.js and
// tests/sharedSyncEngine.test.js.
function installStorageMock() {
  const store = {};
  browser.storage.local.get = jest.fn(async (keys) => {
    if (keys === undefined || keys === null) return { ...store };
    const names = Array.isArray(keys) ? keys : [keys];
    return names.reduce((acc, k) => ({ ...acc, [k]: store[k] }), {});
  });
  browser.storage.local.set = jest.fn(async (obj) => {
    Object.assign(store, obj);
  });
  browser.storage.local.remove = jest.fn(async (keys) => {
    const names = Array.isArray(keys) ? keys : [keys];
    names.forEach((k) => { delete store[k]; });
  });
  browser.storage.local.clear = jest.fn(async () => {
    Object.keys(store).forEach((k) => { delete store[k]; });
  });
  return store;
}

// jest-webextension-mock ships a `notifications` stub, but jest.setup.js's
// own hand-rolled `mockBrowser` (what `../static/globals`'s `browser` actually
// resolves to, via `jest.mock('webextension-polyfill', ...)`) does not define
// `notifications` at all. Define it here on the shared singleton.
if (!browser.notifications) {
  browser.notifications = {};
}
browser.notifications.create = jest.fn().mockResolvedValue('notif-id');

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  installStorageMock();
  browser.notifications.create = jest.fn().mockResolvedValue('notif-id');
});

test('pollInvites stores invites and notifies once per folder', async () => {
  const invite = { folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'read', invitedAt: 1 };
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });
  await pollInvites();
  await pollInvites(); // second poll must not re-notify
  const { [SHARED_PENDING_INVITES_KEY]: stored } = await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);
  expect(stored.invites).toEqual([invite]);
  expect(browser.notifications.create).toHaveBeenCalledTimes(1);
  // Verify icon path is correct
  expect(browser.notifications.create).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ iconUrl: 'icons/icon128.png' })
  );
});

test('declined-then-re-invited folder notifies a second time', async () => {
  const invite = { folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'read', invitedAt: 1 };

  // First poll: notify on new invite
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });
  await pollInvites();
  expect(browser.notifications.create).toHaveBeenCalledTimes(1);

  // Simulate user declining the invite
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: false }) });
  await respondToInvite({ folderId: 'f1', accept: false });

  // Second poll: no invites, notifiedFolderIds should be pruned (f1 drops out)
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [] }) });
  await pollInvites();
  let { [SHARED_PENDING_INVITES_KEY]: stored } = await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);
  expect(stored.notifiedFolderIds).not.toContain('f1');

  // Third poll: f1 is re-invited, should notify again
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });
  await pollInvites();
  expect(browser.notifications.create).toHaveBeenCalledTimes(2);

  stored = await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);
  expect(stored[SHARED_PENDING_INVITES_KEY].notifiedFolderIds).toContain('f1');
});

test('pollInvites no-ops the notification cleanly when browser.notifications is undefined', async () => {
  // `notifications` is an OPTIONAL permission since v4.2 — until the user
  // grants it (and the SW restarts) the namespace is entirely absent. The
  // poll must still store the invite (the in-app banner path) without throwing.
  const invite = { folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'read', invitedAt: 1 };
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });

  const savedNotifications = browser.notifications;
  delete browser.notifications;
  try {
    const res = await pollInvites();
    expect(res.ok).toBe(true);
  } finally {
    browser.notifications = savedNotifications;
  }

  const { [SHARED_PENDING_INVITES_KEY]: stored } = await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);
  expect(stored.invites).toEqual([invite]);
  expect(stored.notifiedFolderIds).toContain('f1');
  expect(browser.notifications.create).not.toHaveBeenCalled();
});

test('still-open invite across two polls notifies once', async () => {
  const invite = { folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'read', invitedAt: 1 };

  // First poll: notify on new invite
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });
  await pollInvites();
  expect(browser.notifications.create).toHaveBeenCalledTimes(1);

  // Second poll: same invite still pending, should not re-notify (f1 stays in intersection)
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ invites: [invite] }) });
  await pollInvites();
  expect(browser.notifications.create).toHaveBeenCalledTimes(1); // still only 1, not 2
});

test('accepting materializes folder + collections locally in one set and seeds sync state', async () => {
  await browser.storage.local.set({
    [SHARED_PENDING_INVITES_KEY]: { invites: [{ folderId: 'f1', folderName: 'Team', ownerEmail: 'o@x.com', role: 'write' }], notifiedFolderIds: ['f1'] },
  });
  global.fetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      accepted: true,
      folder: { folderId: 'f1', name: 'Team', color: '#f00', revision: 4, role: 'write', ownerEmail: 'o@x.com', members: [] },
      collections: [{ uid: 'c1', data: { name: 'A', tabs: [] } }],
    }),
  });
  const res = await respondToInvite({ folderId: 'f1', accept: true });
  expect(res.ok).toBe(true);
  const store = await browser.storage.local.get(['folder_f1', 'collection_c1', 'folders_index', 'collections_index', SHARED_SYNC_STATE_KEY, SHARED_PENDING_INVITES_KEY]);
  expect(store.folder_f1).toMatchObject({ uid: 'f1', name: 'Team', shared: { role: 'write', ownerEmail: 'o@x.com' } });
  expect(store.collection_c1).toMatchObject({ uid: 'c1', name: 'A', parentId: 'f1' });
  expect(store.folders_index.f1).toBeDefined();
  expect(store.collections_index.c1).toBeDefined();
  expect(store[SHARED_SYNC_STATE_KEY].f1).toMatchObject({ lastRev: 4, knownUids: ['c1'] });
  expect(store[SHARED_PENDING_INVITES_KEY].invites).toEqual([]);
});

test('declining removes the invite without creating anything', async () => {
  await browser.storage.local.set({ [SHARED_PENDING_INVITES_KEY]: { invites: [{ folderId: 'f1', folderName: 'Team' }], notifiedFolderIds: ['f1'] } });
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: false }) });
  await respondToInvite({ folderId: 'f1', accept: false });
  const store = await browser.storage.local.get(['folder_f1', SHARED_PENDING_INVITES_KEY]);
  expect(store.folder_f1).toBeUndefined();
  expect(store[SHARED_PENDING_INVITES_KEY].invites).toEqual([]);
});

// Edge case (self-review): accepting an invite for a folder that ALREADY exists
// locally (e.g. re-accepting after a stale local copy, or a race with a prior
// partial accept) must overwrite cleanly and keep both indexes consistent —
// no leftover fields from the old record, no duplicate index entries.
test('accepting overwrites an existing local folder/collection cleanly (indexes stay consistent)', async () => {
  await browser.storage.local.set({
    folder_f1: { uid: 'f1', name: 'Old Name', type: 'folder', color: '#000', stalePreExistingField: true },
    folders_index: { f1: { uid: 'f1', name: 'Old Name' }, other: { uid: 'other', name: 'Unrelated' } },
    collection_c1: { uid: 'c1', name: 'Old collection', parentId: 'f1', tabs: [{ url: 'https://old.example' }] },
    collections_index: { c1: { uid: 'c1', name: 'Old collection', parentId: 'f1' } },
  });
  global.fetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      accepted: true,
      folder: { folderId: 'f1', name: 'Team', color: '#f00', revision: 7, role: 'read', ownerEmail: 'o@x.com', members: [] },
      collections: [{ uid: 'c1', data: { name: 'A (fresh)', tabs: [] } }],
    }),
  });
  await respondToInvite({ folderId: 'f1', accept: true });
  const store = await browser.storage.local.get(['folder_f1', 'collection_c1', 'folders_index', 'collections_index']);
  expect(store.folder_f1).toEqual({
    uid: 'f1', name: 'Team', type: 'folder', color: '#f00',
    collapsed: false, order: 999999, collectionCount: 1,
    createdOn: expect.any(Number), lastUpdated: expect.any(Number),
    shared: { folderId: 'f1', role: 'read', ownerEmail: 'o@x.com', members: [] },
  });
  expect(store.folder_f1.stalePreExistingField).toBeUndefined();
  expect(store.collection_c1).toMatchObject({ uid: 'c1', name: 'A (fresh)', parentId: 'f1' });
  expect(store.collection_c1.tabs).toEqual([]);
  // Both indexes still have exactly one entry for f1/c1, and the unrelated
  // folder entry is untouched.
  expect(Object.keys(store.folders_index).sort()).toEqual(['f1', 'other']);
  expect(Object.keys(store.collections_index)).toEqual(['c1']);
});

// F2 (adversarial pre-release review): materialization must never destroy a local
// collection whose uid the server doesn't know — it may be the user's own local-only
// addition made while the folder was temporarily unshared (revoke → re-invite, or a
// transient 403/404 unmark). Instead of removing it, it is re-homed to the root
// (parentId: null, the same convention overwriteBackupSelection uses). Trade-off: a
// collection genuinely deleted server-side while this device was away resurfaces at
// root rather than staying deleted — preservation beats destruction here, and the
// normal delta path (applyDeltaLocally) still applies legitimate tombstones.
test('re-accept with shrunken collection set re-homes the server-unknown local collection to root', async () => {
  // Set up: folder f1 has collections c1, c2, c3 locally
  await browser.storage.local.set({
    folder_f1: { uid: 'f1', name: 'Team', type: 'folder', color: '#f00', shared: { folderId: 'f1', role: 'write' } },
    folders_index: { f1: { uid: 'f1', name: 'Team' } },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [] },
    collection_c2: { uid: 'c2', name: 'B', parentId: 'f1', tabs: [] },
    collection_c3: { uid: 'c3', name: 'C', parentId: 'f1', tabs: [] },
    collections_index: {
      c1: { uid: 'c1', name: 'A', parentId: 'f1' },
      c2: { uid: 'c2', name: 'B', parentId: 'f1' },
      c3: { uid: 'c3', name: 'C', parentId: 'f1' },
    },
  });

  // Server now only has c1 and c2 (c3 was deleted)
  global.fetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      accepted: true,
      folder: { folderId: 'f1', name: 'Team', color: '#f00', revision: 10, role: 'write', ownerEmail: 'o@x.com', members: [] },
      collections: [
        { uid: 'c1', data: { name: 'A (updated)', tabs: [] } },
        { uid: 'c2', data: { name: 'B (updated)', tabs: [] } },
      ],
    }),
  });

  await respondToInvite({ folderId: 'f1', accept: true });

  // Verify: c1/c2 overwritten with server content, c3 preserved but re-homed to root
  const store = await browser.storage.local.get(['collection_c1', 'collection_c2', 'collection_c3', 'collections_index']);
  expect(store.collection_c1).toMatchObject({ uid: 'c1', name: 'A (updated)', parentId: 'f1' });
  expect(store.collection_c2).toMatchObject({ uid: 'c2', name: 'B (updated)', parentId: 'f1' });
  expect(store.collection_c3).toMatchObject({ uid: 'c3', name: 'C', parentId: null }); // preserved, re-homed
  expect(Object.keys(store.collections_index).sort()).toEqual(['c1', 'c2', 'c3']);
  expect(store.collections_index.c3).toMatchObject({ parentId: null });
});
