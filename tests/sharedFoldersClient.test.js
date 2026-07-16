import { browser } from '../static/globals';
import { sharedApiFetch, handleSharedMessage, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn(),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as
// static jest.fn()s (no real backing store, no `.clear()`), so we install a
// tiny in-memory store here rather than relying on `browser.storage.local.clear()`.
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
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  installStorageMock();
});

test('sharedApiFetch attaches Bearer token and parses JSON', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-1');
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ folders: [] }) });
  const res = await sharedApiFetch('/shared/folders');
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/shared/folders'),
    expect.objectContaining({ headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' } }));
  expect(res).toEqual({ ok: true, status: 200, data: { folders: [] } });
});

test('sharedApiFetch without sign-in returns not_signed_in and never fetches', async () => {
  bgUtils.getAuthToken.mockResolvedValue(false);
  const res = await sharedApiFetch('/shared/folders');
  expect(res).toEqual({ ok: false, status: 0, error: 'not_signed_in' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('sharedCreateShare POSTs folder + collections + invites, marks local folder shared', async () => {
  bgUtils.getAuthToken.mockResolvedValue('tok-1');
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ folderId: 'f1', revision: 1 }) })   // create
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ members: [{ email: 'g@x.com', role: 'read', status: 'invited' }] }) }); // invite
  await browser.storage.local.set({
    folders_index: { f1: { uid: 'f1', name: 'Team' } },
    folder_f1: { uid: 'f1', name: 'Team', type: 'folder' },
  });
  const res = await handleSharedMessage({
    type: 'sharedCreateShare',
    folder: { uid: 'f1', name: 'Team', color: '#f00' },
    collections: [{ uid: 'c1', data: { name: 'A' } }],
    invites: [{ email: 'g@x.com', role: 'read' }],
  });
  expect(res.ok).toBe(true);
  const { folder_f1, [SHARED_SYNC_STATE_KEY]: state } = await browser.storage.local.get(['folder_f1', SHARED_SYNC_STATE_KEY]);
  expect(folder_f1.shared).toMatchObject({ folderId: 'f1', role: 'owner' });
  expect(state.f1).toMatchObject({ lastRev: 1, knownUids: ['c1'] });
});
