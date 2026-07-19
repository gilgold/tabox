// handleSharedMessage cases that proxy the share-link REST endpoints for the popup.
import { browser } from '../static/globals';
import { handleSharedMessage, SHARED_PENDING_LINK_JOIN_KEY } from '../chrome/shared-folders';
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

beforeEach(() => {
  jest.clearAllMocks();
  bgUtils.getAuthToken.mockResolvedValue('tok-auth');
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  installStorageMock();
});

test.each([
  [{ type: 'sharedGetFolderLink', folderId: 'f1' }, 'GET', '/shared/folders/f1/link'],
  [{ type: 'sharedCreateFolderLink', folderId: 'f1', role: 'read' }, 'POST', '/shared/folders/f1/link'],
  [{ type: 'sharedDeleteFolderLink', folderId: 'f1' }, 'DELETE', '/shared/folders/f1/link'],
  [{ type: 'sharedCreateCollectionLink', uid: 'c1', name: 'R', data: { name: 'R' } }, 'PUT', '/shared/collection-link'],
  [{ type: 'sharedGetCollectionLinks' }, 'GET', '/shared/collection-links'],
  [{ type: 'sharedDeleteCollectionLink', uid: 'c1' }, 'DELETE', '/shared/collection-link/c1'],
])('%o hits %s %s', async (msg, method, path) => {
  await handleSharedMessage(msg);
  const [calledUrl, opts] = global.fetch.mock.calls[0];
  expect(calledUrl).toContain(path);
  expect(opts.method || 'GET').toBe(method);
});

test('sharedCreateFolderLink forwards role and rotate in the body', async () => {
  await handleSharedMessage({ type: 'sharedCreateFolderLink', folderId: 'f1', role: 'write', rotate: true });
  const [, opts] = global.fetch.mock.calls[0];
  expect(JSON.parse(opts.body)).toEqual({ role: 'write', rotate: true });
});

test('sharedCreateCollectionLink forwards uid, name and data in the body', async () => {
  await handleSharedMessage({ type: 'sharedCreateCollectionLink', uid: 'c1', name: 'R', data: { name: 'R', tabs: [] } });
  const [, opts] = global.fetch.mock.calls[0];
  expect(JSON.parse(opts.body)).toEqual({ uid: 'c1', name: 'R', data: { name: 'R', tabs: [] } });
});

test('sharedJoinLink redeems and clears the pending stash', async () => {
  await browser.storage.local.set({
    [SHARED_PENDING_LINK_JOIN_KEY]: { token: 'tok', name: 'Team' },
  });
  // public lookup -> folder; authed join -> accept payload
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: 'folder', name: 'Team', ownerEmail: 'o@x.com', role: 'read', collectionCount: 0 }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
      accepted: true,
      folder: { folderId: 'f1', name: 'Team', color: null, revision: 1, role: 'read', ownerEmail: 'o@x.com', members: [] },
      collections: [],
    }) });
  const res = await handleSharedMessage({ type: 'sharedJoinLink', token: 'tok' });
  expect(res).toMatchObject({ ok: true, status: 'joined' });
  const store = await browser.storage.local.get(SHARED_PENDING_LINK_JOIN_KEY);
  expect(store[SHARED_PENDING_LINK_JOIN_KEY]).toBeUndefined();
});
