// Activity & comments (2026-07-21 design): the four new handleSharedMessage
// cases are thin wrappers over sharedApiFetch, and the sync pass persists the
// delta's lastActivityId into shared_sync_state for the UI's unread dot.
// Harness mirrors tests/sharedLinkMessages.test.js / tests/sharedSyncEngine.test.js.
import { browser } from '../static/globals';
import { handleSharedMessage, syncSharedFolders, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
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
  browser.storage.local.clear = jest.fn(async () => {
    Object.keys(store).forEach((k) => delete store[k]);
  });
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  bgUtils.getAuthToken.mockResolvedValue('tok-auth');
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  installStorageMock();
});

const lastFetchCall = () => {
  const [url, opts = {}] = global.fetch.mock.calls[0];
  return { url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined };
};

describe('activity & comment message handlers', () => {
  test('sharedGetActivity without paging params hits GET .../activity with no query string', async () => {
    await handleSharedMessage({ type: 'sharedGetActivity', folderId: 'f1' });
    const { url, method } = lastFetchCall();
    expect(method).toBe('GET');
    expect(url.endsWith('/shared/folders/f1/activity')).toBe(true);
    expect(url).not.toContain('?');
  });

  test('sharedGetActivity appends beforeId and limit only when present', async () => {
    await handleSharedMessage({ type: 'sharedGetActivity', folderId: 'f1', beforeId: 42, limit: 25 });
    const { url } = lastFetchCall();
    expect(url).toContain('/shared/folders/f1/activity?');
    expect(url).toContain('beforeId=42');
    expect(url).toContain('limit=25');
  });

  test('sharedGetActivity encodes a folderId with special characters', async () => {
    await handleSharedMessage({ type: 'sharedGetActivity', folderId: 'f/1 x?' });
    const { url } = lastFetchCall();
    expect(url).toContain(`/shared/folders/${encodeURIComponent('f/1 x?')}/activity`);
    expect(url).not.toContain('/shared/folders/f/1');
  });

  test('sharedGetComments omits collectionUid when absent (folder-level thread)', async () => {
    await handleSharedMessage({ type: 'sharedGetComments', folderId: 'f1' });
    const { url, method } = lastFetchCall();
    expect(method).toBe('GET');
    expect(url.endsWith('/shared/folders/f1/comments')).toBe(true);
    expect(url).not.toContain('collectionUid');
  });

  test('sharedGetComments omits an empty-string collectionUid', async () => {
    await handleSharedMessage({ type: 'sharedGetComments', folderId: 'f1', collectionUid: '' });
    const { url } = lastFetchCall();
    expect(url).not.toContain('collectionUid');
  });

  test('sharedGetComments appends and encodes collectionUid + paging params when present', async () => {
    await handleSharedMessage({ type: 'sharedGetComments', folderId: 'f 1', collectionUid: 'c&1', beforeId: 'cm-9', limit: 10 });
    const { url } = lastFetchCall();
    expect(url).toContain(`/shared/folders/${encodeURIComponent('f 1')}/comments?`);
    expect(url).toContain(`collectionUid=${encodeURIComponent('c&1')}`);
    expect(url).toContain('beforeId=cm-9');
    expect(url).toContain('limit=10');
  });

  test('sharedPostComment POSTs {body} for the folder-level thread', async () => {
    await handleSharedMessage({ type: 'sharedPostComment', folderId: 'f1', body: 'hello team' });
    const { url, method, body } = lastFetchCall();
    expect(method).toBe('POST');
    expect(url.endsWith('/shared/folders/f1/comments')).toBe(true);
    expect(body).toEqual({ body: 'hello team' });
  });

  test('sharedPostComment includes collectionUid when a non-empty string', async () => {
    await handleSharedMessage({ type: 'sharedPostComment', folderId: 'f1', collectionUid: 'c1', body: 'note' });
    const { body } = lastFetchCall();
    expect(body).toEqual({ collectionUid: 'c1', body: 'note' });
  });

  test('sharedDeleteComment DELETEs the encoded comment id', async () => {
    await handleSharedMessage({ type: 'sharedDeleteComment', folderId: 'f1', commentId: 'cm/1 x' });
    const { url, method } = lastFetchCall();
    expect(method).toBe('DELETE');
    expect(url.endsWith(`/shared/folders/f1/comments/${encodeURIComponent('cm/1 x')}`)).toBe(true);
  });

  test('handlers return the sharedApiFetch envelope unchanged on success', async () => {
    const payload = { comments: [{ id: 'cm1', collectionUid: null, authorEmail: 'a@x.com', body: 'hi', createdAt: 1 }], counts: [] };
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
    const res = await handleSharedMessage({ type: 'sharedGetComments', folderId: 'f1' });
    expect(res).toEqual({ ok: true, status: 200, data: payload });
  });

  test('server errors (pro_required) flow through the envelope untouched', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'pro_required' }) });
    const res = await handleSharedMessage({ type: 'sharedPostComment', folderId: 'f1', body: 'x' });
    expect(res).toEqual({ ok: false, status: 403, error: 'pro_required' });
  });

  test('signed-out short-circuit envelope also flows through', async () => {
    bgUtils.getAuthToken.mockResolvedValueOnce(null);
    const res = await handleSharedMessage({ type: 'sharedGetActivity', folderId: 'f1' });
    expect(res).toEqual({ ok: false, status: 0, error: 'not_signed_in' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('sync pass persists lastActivityId into shared_sync_state', () => {
  const SHARED_FOLDER = { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'write', ownerEmail: 'o@x.com' } };

  function seedLocal(syncState) {
    return browser.storage.local.set({
      googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
      folders_index: { f1: { uid: 'f1', name: 'Team', shared: SHARED_FOLDER.shared } },
      folder_f1: SHARED_FOLDER,
      collections_index: { c1: { uid: 'c1', parentId: 'f1', lastUpdated: 100 } },
      collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [], lastUpdated: 100 },
      [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 100, knownUids: ['c1'], ...syncState } },
    });
  }

  const deltaResponse = (deltaOverrides = {}) => ({
    ok: true, status: 200,
    json: async () => ({
      revision: 2, role: 'write',
      folder: { name: 'Team', color: null, updatedBy: 'o@x.com' },
      members: [],
      collections: [],
      ...deltaOverrides,
    }),
  });

  // The list call (/shared/folders) runs before the per-folder delta; return an
  // empty-but-ok list so no short-circuit fires and no rematerialization happens.
  function mockFetchWithDelta(deltaOverrides) {
    global.fetch.mockImplementation(async (url, opts = {}) => {
      const method = opts.method || 'GET';
      if (method === 'GET' && /\/shared\/folders$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ folders: [] }) };
      }
      if (method === 'GET' && url.includes('/shared/folders/f1?sinceRev=')) {
        return deltaResponse(deltaOverrides);
      }
      if (method === 'GET' && url.includes('/shared/invites')) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
    });
  }

  test('delta carrying lastActivityId lands in the folder sync-state entry (alongside lastRev)', async () => {
    await seedLocal();
    mockFetchWithDelta({ lastActivityId: 17 });
    await syncSharedFolders();
    const store = await browser.storage.local.get(SHARED_SYNC_STATE_KEY);
    expect(store[SHARED_SYNC_STATE_KEY].f1).toMatchObject({ lastRev: 2, lastActivityId: 17, knownUids: ['c1'] });
  });

  test('delta WITHOUT lastActivityId leaves a previously-stored value unchanged', async () => {
    await seedLocal({ lastActivityId: 5 });
    mockFetchWithDelta({});
    await syncSharedFolders();
    const store = await browser.storage.local.get(SHARED_SYNC_STATE_KEY);
    expect(store[SHARED_SYNC_STATE_KEY].f1.lastActivityId).toBe(5);
    expect(store[SHARED_SYNC_STATE_KEY].f1.lastRev).toBe(2);
  });

  test('delta WITHOUT lastActivityId on a folder that never had one stores 0', async () => {
    await seedLocal();
    mockFetchWithDelta({});
    await syncSharedFolders();
    const store = await browser.storage.local.get(SHARED_SYNC_STATE_KEY);
    expect(store[SHARED_SYNC_STATE_KEY].f1.lastActivityId).toBe(0);
  });

  test('read-role folders also persist lastActivityId (non-push branch)', async () => {
    await seedLocal();
    mockFetchWithDelta({ role: 'read', lastActivityId: 9 });
    await syncSharedFolders();
    const store = await browser.storage.local.get(SHARED_SYNC_STATE_KEY);
    expect(store[SHARED_SYNC_STATE_KEY].f1).toMatchObject({ lastActivityId: 9, knownUids: ['c1'] });
  });
});
