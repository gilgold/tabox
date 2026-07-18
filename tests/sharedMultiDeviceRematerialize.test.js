// C2 (final-review): the Task 8 `shared` marker never travels via Drive sync
// (Task 9 deliberately excludes shared folders/collections from the upload
// payload). Consequence: a folder shared/accepted on device A is invisible to
// device B's Drive pull, which then treats the folder as stale local data and
// prunes it, or simply never materializes it locally to begin with. This
// exercises doSyncSharedFolders' rematerialization step, which reconciles
// against the server's authoritative "folders I have access to" list at the
// start of every sync cycle.
import { browser } from '../static/globals';
import { syncSharedFolders, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn().mockResolvedValue('tok'),
}));

// Same tiny in-memory storage mock used by tests/sharedSyncEngine.test.js and
// tests/sharedInvites.test.js (jest.setup.js's shared `browser` mock only
// stubs storage.local.get/set as static jest.fn()s with no backing store).
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
  return store;
}

const invitesResponse = { ok: true, status: 200, json: async () => ({ invites: [] }) };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  installStorageMock();
});

test('(a) server lists a folder absent locally — it is materialized with its collections (incl. own-authored rows), marker, and sync state', async () => {
  await browser.storage.local.set({
    googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
    folders_index: {},
    collections_index: {},
  });

  global.fetch.mockImplementation(async (url) => {
    if (url.includes('/shared/invites')) return invitesResponse;
    if (url.endsWith('/shared/folders')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          folders: [{ folderId: 'f1', name: 'Team', color: '#f00', revision: 3, role: 'write', ownerEmail: 'owner@x.com', members: [{ email: 'me@x.com', role: 'write' }] }],
        }),
      };
    }
    if (url.includes('/shared/folders/f1')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          revision: 3, role: 'write',
          folder: { name: 'Team', color: '#f00', updatedBy: 'owner@x.com' },
          members: [{ email: 'me@x.com', role: 'write' }],
          // Own-authored row: updatedBy === myEmail. A plain delta-apply
          // (applyDeltaLocally's isOther check) would SKIP this row entirely —
          // rematerialization must apply it regardless of author.
          collections: [{ uid: 'c1', data: { name: 'Mine', tabs: [] }, rev: 1, deleted: 0, updatedBy: 'me@x.com', updatedAt: 100 }],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const res = await syncSharedFolders();
  expect(res.ok).toBe(true);

  const store = await browser.storage.local.get(['folder_f1', 'collection_c1', 'folders_index', 'collections_index', SHARED_SYNC_STATE_KEY]);
  expect(store.folder_f1).toMatchObject({ uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'write', ownerEmail: 'owner@x.com' } });
  expect(store.collection_c1).toMatchObject({ uid: 'c1', name: 'Mine', parentId: 'f1' });
  expect(store.folders_index.f1).toBeDefined();
  expect(store.collections_index.c1).toBeDefined();
  expect(store[SHARED_SYNC_STATE_KEY].f1).toMatchObject({ lastRev: 3, knownUids: ['c1'] });
});

test('(b) folder present locally WITH a live marker is left untouched by rematerialization — and, since the list revision matches our watermark, the revision short-circuit means the normal per-folder loop issues NO delta fetch either', async () => {
  await browser.storage.local.set({
    googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
    folders_index: { f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'write', ownerEmail: 'owner@x.com' } } },
    folder_f1: { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'write', ownerEmail: 'owner@x.com' } },
    collections_index: { c1: { uid: 'c1', parentId: 'f1', lastUpdated: 100 } },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [], lastUpdated: 100 },
    [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 100, knownUids: ['c1'] } },
  });

  let folderDeltaFetches = 0;
  global.fetch.mockImplementation(async (url) => {
    if (url.includes('/shared/invites')) return invitesResponse;
    if (url.endsWith('/shared/folders')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          folders: [{ folderId: 'f1', name: 'Team', color: null, revision: 1, role: 'write', ownerEmail: 'owner@x.com', members: [] }],
        }),
      };
    }
    if (url.includes('/shared/folders/f1')) {
      folderDeltaFetches += 1;
      return {
        ok: true, status: 200,
        json: async () => ({
          revision: 1, role: 'write',
          folder: { name: 'Team', color: null, updatedBy: 'owner@x.com' },
          members: [],
          collections: [],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const res = await syncSharedFolders();

  // Perf (revision short-circuit): the list call above already reported f1's
  // revision (1) as matching our watermark (1) — the normal per-folder loop
  // must not have issued its own delta GET for it this cycle.
  expect(folderDeltaFetches).toBe(0);
  expect(res.data).toEqual({ pulled: 0, pushed: 0, revoked: 0 });
});

test('(c) the /shared/folders list call failing does not abort the sync cycle', async () => {
  await browser.storage.local.set({
    googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
    folders_index: { f1: { uid: 'f1', name: 'Team', shared: { folderId: 'f1', role: 'write', ownerEmail: 'owner@x.com' } } },
    folder_f1: { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'write', ownerEmail: 'owner@x.com' } },
    collections_index: {},
    [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 100, knownUids: [] } },
  });

  global.fetch.mockImplementation(async (url) => {
    if (url.includes('/shared/invites')) return invitesResponse;
    if (url.endsWith('/shared/folders')) {
      return { ok: false, status: 500, json: async () => ({ error: 'server_error' }) };
    }
    if (url.includes('/shared/folders/f1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ revision: 1, role: 'write', folder: { name: 'Team', color: null, updatedBy: null }, members: [], collections: [] }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const res = await syncSharedFolders();

  // The normal per-folder loop still ran to completion despite the list call failing.
  expect(res.ok).toBe(true);
  expect(res.data).toEqual({ pulled: 0, pushed: 0, revoked: 0 });
});
