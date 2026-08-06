// handleShareLinkRedeem: the onMessageExternal entry point for share links.
// - collection tokens import a sanitized local copy under a FRESH uid
// - folder tokens join via /shared/join-link and materialize like an accepted invite
// - signed-out folder joins stash a pending join and report sign_in_required
import { browser } from '../static/globals';
import {
  handleShareLinkRedeem, SHARED_PENDING_LINK_JOIN_KEY, SHARED_SYNC_STATE_KEY,
} from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn(),
}));

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
    names.forEach((k) => delete store[k]);
  });
  return store;
}

const COLLECTION_INFO = {
  kind: 'collection', name: 'Research', ownerEmail: 'owner@x.com', tabCount: 1,
  data: { name: 'Research', tabs: [{ url: 'https://a.com' }], parentId: 'evil-parent', lastOpened: 123 },
};
const FOLDER_INFO = { kind: 'folder', name: 'Team', ownerEmail: 'owner@x.com', role: 'write', collectionCount: 1 };
const JOIN_PAYLOAD = {
  accepted: true,
  folder: { folderId: 'f1', name: 'Team', color: null, revision: 3, role: 'write', ownerEmail: 'owner@x.com', members: [] },
  collections: [{ uid: 'c1', data: { name: 'A', tabs: [] } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  installStorageMock();
});

test('imports a collection snapshot under a fresh uid, sanitized, as a loose collection', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => COLLECTION_INFO });
  const res = await handleShareLinkRedeem('tok1');
  expect(res).toMatchObject({ ok: true, status: 'added', name: 'Research' });
  // The public /links lookup must NOT require sign-in.
  expect(bgUtils.getAuthToken).not.toHaveBeenCalled();
  const store = await browser.storage.local.get(null);
  const uids = Object.keys(store.collections_index || {});
  expect(uids).toHaveLength(1);
  const record = store[`collection_${uids[0]}`];
  expect(record.uid).toBe(uids[0]);
  expect(record.name).toBe('Research');
  expect(record.parentId).toBeUndefined(); // never inherits the sharer's folder
  expect(record.lastOpened).toBeUndefined(); // sanitizeRemoteCollection drops it
});

test('re-redeeming mints ANOTHER fresh uid (no collision, no overwrite)', async () => {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => COLLECTION_INFO });
  await handleShareLinkRedeem('tok1');
  await handleShareLinkRedeem('tok1');
  const store = await browser.storage.local.get(null);
  expect(Object.keys(store.collections_index)).toHaveLength(2);
});

test('joins a folder link when signed in: materializes + seeds sync state', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-auth');
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => FOLDER_INFO })   // public /links lookup
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => JOIN_PAYLOAD }); // authed join
  const res = await handleShareLinkRedeem('tok2');
  expect(res).toMatchObject({ ok: true, status: 'joined', name: 'Team', role: 'write', roleDowngraded: false });
  expect(global.fetch.mock.calls[1][0]).toContain('/shared/join-link');
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ token: 'tok2' });
  const store = await browser.storage.local.get(null);
  expect(store.folder_f1).toMatchObject({ uid: 'f1', shared: { folderId: 'f1', role: 'write' } });
  expect(store.collection_c1).toMatchObject({ uid: 'c1', parentId: 'f1' });
  expect(store[SHARED_SYNC_STATE_KEY].f1).toMatchObject({ lastRev: 3, knownUids: ['c1'] });
});

test('free-user join of a write link: server-downgraded read role and flag flow through to the reply', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-auth');
  const downgraded = {
    ...JOIN_PAYLOAD,
    folder: { ...JOIN_PAYLOAD.folder, role: 'read' },
    roleDowngraded: true,
  };
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => FOLDER_INFO })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => downgraded });
  const res = await handleShareLinkRedeem('tok2');
  expect(res).toMatchObject({ ok: true, status: 'joined', role: 'read', roleDowngraded: true });
  const store = await browser.storage.local.get(null);
  // Materialized locally as read-only — the UI's isReadOnlySharedFolder gate keys off this.
  expect(store.folder_f1).toMatchObject({ shared: { folderId: 'f1', role: 'read' } });
});

test('stashes a pending join and reports sign_in_required when signed out', async () => {
  bgUtils.getAuthToken.mockResolvedValue(false); // sharedApiFetch -> not_signed_in
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => FOLDER_INFO });
  const res = await handleShareLinkRedeem('tok3');
  expect(res).toMatchObject({ ok: false, status: 'sign_in_required', name: 'Team' });
  const store = await browser.storage.local.get(SHARED_PENDING_LINK_JOIN_KEY);
  expect(store[SHARED_PENDING_LINK_JOIN_KEY]).toMatchObject({ token: 'tok3', name: 'Team', role: 'write' });
});

test('maps a 404 to status invalid', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) });
  const res = await handleShareLinkRedeem('gone');
  expect(res).toMatchObject({ ok: false, status: 'invalid' });
});

test('propagates server errors (e.g. member_limit) as status error with the code', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-auth');
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => FOLDER_INFO })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'member_limit' }) });
  const res = await handleShareLinkRedeem('tok4');
  expect(res).toEqual({ ok: false, status: 'error', error: 'member_limit' });
});
