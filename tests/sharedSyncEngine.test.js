import { browser } from '../static/globals';
import { syncSharedFolders, handleSharedMessage, SHARED_EVENTS_KEY, SHARED_SYNC_STATE_KEY } from '../chrome/shared-folders';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn().mockResolvedValue('tok'),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as static
// jest.fn()s (no real backing store, no `.clear()`/`.remove()`), so install a tiny
// in-memory store here — mirrors tests/sharedFoldersClient.test.js (Task 8) and
// tests/sharedDriveSyncExclusion.test.js (Task 9).
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

const SHARED_FOLDER = { uid: 'f1', name: 'Team', type: 'folder', shared: { folderId: 'f1', role: 'write', ownerEmail: 'o@x.com' } };

function seedLocal(extra = {}) {
  return browser.storage.local.set({
    googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
    folders_index: { f1: { uid: 'f1', name: 'Team', shared: SHARED_FOLDER.shared } },
    folder_f1: SHARED_FOLDER,
    collections_index: { c1: { uid: 'c1', parentId: 'f1', lastUpdated: 100 } },
    collection_c1: { uid: 'c1', name: 'A', parentId: 'f1', tabs: [], lastUpdated: 100 },
    [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 100, knownUids: ['c1'] } },
    ...extra,
  });
}
const deltaResponse = (overrides = {}) => ({
  ok: true, status: 200,
  json: async () => ({
    revision: 2, role: 'write',
    folder: { name: 'Team', color: null, updatedBy: 'o@x.com' },
    members: [],
    collections: [{ uid: 'c2', data: { name: 'B', tabs: [] }, rev: 2, deleted: 0, updatedBy: 'o@x.com', updatedAt: 200 }],
    ...overrides,
  }),
});

beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(); installStorageMock(); });

test('pull applies remote upsert locally and records an event for the other user\'s change', async () => {
  await seedLocal();
  global.fetch.mockResolvedValue(deltaResponse());
  const res = await syncSharedFolders();
  expect(res.ok).toBe(true);
  const store = await browser.storage.local.get(['collection_c2', 'collections_index', SHARED_EVENTS_KEY, SHARED_SYNC_STATE_KEY]);
  expect(store.collection_c2).toMatchObject({ uid: 'c2', name: 'B', parentId: 'f1' });
  expect(store.collections_index.c2).toBeDefined();
  expect(store[SHARED_EVENTS_KEY][0]).toMatchObject({ folderId: 'f1', actorEmail: 'o@x.com', kind: 'updated' });
  expect(store[SHARED_SYNC_STATE_KEY].f1.lastRev).toBe(2);
});

test('push sends locally-updated collections with baseRev and local deletions as DELETE', async () => {
  await seedLocal({ [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 50, knownUids: ['c1', 'gone'] } } });
  global.fetch.mockImplementation(async (url, opts = {}) => {
    if (!opts.method || opts.method === 'GET') return deltaResponse({ collections: [] });
    return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
  });
  await syncSharedFolders();
  const calls = global.fetch.mock.calls.map(([url, opts]) => `${(opts && opts.method) || 'GET'} ${url}`);
  expect(calls.some((c) => c.startsWith('PUT') && c.includes('/collections/c1'))).toBe(true);   // lastUpdated 100 > lastSyncedAt 50
  expect(calls.some((c) => c.startsWith('DELETE') && c.includes('/collections/gone'))).toBe(true); // knownUid vanished locally
});

test('403 on pull converts the folder to a local unshared folder and records a revoked event', async () => {
  await seedLocal();
  global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
  await syncSharedFolders();
  const store = await browser.storage.local.get(['folder_f1', SHARED_EVENTS_KEY]);
  expect(store.folder_f1.shared).toBeUndefined();
  expect(store[SHARED_EVENTS_KEY][0]).toMatchObject({ kind: 'revoked', folderId: 'f1' });
});

// Task 10 follow-up review: three protocol bugs in the push phase.
// (1) echo-push: a collection just pulled from another user carries a
//     post-pull lastUpdated newer than the stale pre-pull watermark, so the
//     old dirty check re-PUT it right back in the same cycle.
// (2) lost-dirty window: lastSyncedAt used to be stamped with Date.now()
//     AFTER the push round-trip, so a local edit landing during the network
//     window was permanently misclassified as already-synced.
// (3) re-entrancy: the 5-minute alarm and popup sharedSyncNow could overlap.
describe('syncSharedFolders echo-push / watermark / re-entrancy fixes', () => {
  test('a collection pulled from another user is never re-pushed in the same cycle, while a genuine local edit is', async () => {
    await seedLocal({
      collections_index: {
        c1: { uid: 'c1', parentId: 'f1', lastUpdated: 100 },
        c3: { uid: 'c3', parentId: 'f1', lastUpdated: 500 },
      },
      collection_c3: { uid: 'c3', name: 'Local edit', parentId: 'f1', tabs: [], lastUpdated: 500 },
      [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 100, knownUids: ['c1', 'c3'] } },
    });
    // c1 is updated by ANOTHER user in this pull (updatedAt 999 >> stale watermark
    // 100) - the pre-fix dirty check `lastUpdated > lastSyncedAt` would wrongly
    // treat it as locally dirty and re-PUT it. c3 was genuinely edited locally
    // before this cycle started (lastUpdated 500 > lastSyncedAt 100) and is
    // untouched by the delta, so it must still be pushed.
    global.fetch.mockImplementation(async (url, opts = {}) => {
      if (!opts.method || opts.method === 'GET') {
        return deltaResponse({
          collections: [{ uid: 'c1', data: { name: 'Updated by owner', tabs: [] }, rev: 2, deleted: 0, updatedBy: 'o@x.com', updatedAt: 999 }],
        });
      }
      return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
    });

    await syncSharedFolders();

    const putCalls = global.fetch.mock.calls.filter(([, opts]) => opts && opts.method === 'PUT');
    expect(putCalls.some(([url]) => url.includes('/collections/c1'))).toBe(false); // echoed pull - must NOT be re-pushed
    expect(putCalls.some(([url]) => url.includes('/collections/c3'))).toBe(true);  // genuine local edit - must be pushed
  });

  test('lastSyncedAt is stamped with the pre-network watermark, so an edit landing during the push round-trip stays dirty next cycle', async () => {
    await seedLocal({ [SHARED_SYNC_STATE_KEY]: { f1: { lastRev: 1, lastSyncedAt: 50, knownUids: ['c1'] } } });
    // seedLocal's default collection_c1/collections_index.c1 has lastUpdated: 100,
    // which is > this cycle's lastSyncedAt (50), so it's genuinely dirty and its
    // PUT fires - that's the hook we use to simulate a concurrent edit landing
    // mid-network.
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1000); // this cycle's pre-network watermark

    let midCycleEditWritten = false;
    global.fetch.mockImplementation(async (url, opts = {}) => {
      if (!opts.method || opts.method === 'GET') return deltaResponse({ collections: [], revision: 2 });
      if (!midCycleEditWritten) {
        midCycleEditWritten = true;
        // Simulate a local edit landing WHILE this push network call is in
        // flight, timestamped well after the cycle's pre-network watermark.
        const { collections_index: idx } = await browser.storage.local.get('collections_index');
        await browser.storage.local.set({
          collections_index: { ...idx, c1: { ...idx.c1, lastUpdated: 1500 } },
          collection_c1: { uid: 'c1', name: 'Mid-cycle edit', parentId: 'f1', tabs: [], lastUpdated: 1500 },
        });
      }
      return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
    });

    await syncSharedFolders();

    const stateAfterCycle1 = (await browser.storage.local.get(SHARED_SYNC_STATE_KEY))[SHARED_SYNC_STATE_KEY];
    // Stored lastSyncedAt is the PRE-network watermark (1000), never a
    // post-round-trip Date.now() that would sit after the mid-cycle edit.
    expect(stateAfterCycle1.f1.lastSyncedAt).toBe(1000);

    // Cycle 2: nothing changed server-side; the mid-cycle-1 edit (lastUpdated
    // 1500) is still > the stored watermark (1000), so it must be pushed now.
    now.mockReturnValue(2000);
    global.fetch.mockClear();
    global.fetch.mockImplementation(async (url, opts = {}) => {
      if (!opts.method || opts.method === 'GET') return deltaResponse({ collections: [], revision: 4 });
      return { ok: true, status: 200, json: async () => ({ revision: 5 }) };
    });

    await syncSharedFolders();
    const putCalls = global.fetch.mock.calls.filter(([, opts]) => opts && opts.method === 'PUT');
    expect(putCalls.some(([url]) => url.includes('/collections/c1'))).toBe(true);

    now.mockRestore();
  });

  test('two concurrent syncSharedFolders() calls coalesce into a single execution (pull fetched once, invites polled once)', async () => {
    await seedLocal();
    global.fetch.mockImplementation(async (url, opts = {}) => {
      // Task 12 wiring: doSyncSharedFolders() now also polls /shared/invites at
      // the end of its cycle - distinguish it by URL rather than lumping every
      // GET into the folder-delta response.
      if (url.includes('/shared/invites')) return { ok: true, status: 200, json: async () => ({ invites: [] }) };
      if (!opts.method || opts.method === 'GET') return deltaResponse({ collections: [] });
      return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
    });

    // Fired back-to-back, synchronously, exactly like the 5-minute alarm and a
    // popup-triggered sharedSyncNow could overlap in the real service worker.
    const first = syncSharedFolders();
    const second = syncSharedFolders();
    // The guard check/assignment happens synchronously (before any await), so
    // the second call observes the in-flight run and returns the literal SAME
    // promise - not merely an equivalent one - rather than starting/queueing
    // a second run.
    expect(second).toBe(first);

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual(r2);

    // Coalescing property: only one pull round-trip happened across both calls, not two.
    // (Matched on the sinceRev query param so this can't accidentally also match a
    // /shared/folders/f1/collections/<uid> push URL.)
    const pullCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/shared/folders/f1?sinceRev='));
    expect(pullCalls.length).toBe(1);
    // Coalescing property, invite side: exactly one /shared/invites GET across
    // both calls too - the second caller coalesced onto the first run's single
    // end-of-cycle poll rather than triggering its own.
    const invitesCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/shared/invites'));
    expect(invitesCalls.length).toBe(1);
  });
});

// Task 12 wiring: doSyncSharedFolders() must poll invites at the end of EVERY
// cycle, even for a signed-in user with zero locally-shared folders - that's
// exactly the state of an invitee who hasn't accepted anything yet.
describe('doSyncSharedFolders invite polling (Task 12 wiring)', () => {
  test('signed-in user with zero shared folders still polls invites and does not error', async () => {
    await browser.storage.local.set({
      googleUser: { emailAddress: 'me@x.com', permissionId: 'g-me' },
      folders_index: {},
    });
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/shared/invites')) return { ok: true, status: 200, json: async () => ({ invites: [] }) };
      throw new Error(`unexpected fetch in zero-shared-folders test: ${url}`);
    });

    const res = await syncSharedFolders();

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ pulled: 0, pushed: 0, revoked: 0 });
    const invitesCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/shared/invites'));
    expect(invitesCalls.length).toBe(1);
  });
});

// Sanitization: folder-name truncation must happen consistently in the folder
// record, folders_index entry, and event folderName fields. If delta.folder.name
// exceeds 200 chars, all three must be truncated to 200.
describe('applyDeltaLocally folder-name truncation', () => {
  test('truncates oversized folder name to 200 chars in folder record, index, and event fields', async () => {
    await seedLocal();
    const longName = 'x'.repeat(500);
    global.fetch.mockResolvedValue(deltaResponse({
      folder: { name: longName, color: null, updatedBy: 'o@x.com' },
      collections: [],
    }));
    await syncSharedFolders();
    const store = await browser.storage.local.get(['folder_f1', 'folders_index', SHARED_EVENTS_KEY]);
    // Folder record name is truncated
    expect(store.folder_f1.name).toHaveLength(200);
    expect(store.folder_f1.name).toBe('x'.repeat(200));
    // Folders index entry name is also truncated (not raw delta.folder.name)
    expect(store.folders_index.f1.name).toHaveLength(200);
    expect(store.folders_index.f1.name).toBe('x'.repeat(200));
    // All folderName values in events are also truncated to 200 chars max
    const eventsWithFolderName = store[SHARED_EVENTS_KEY].filter((e) => e.folderName);
    eventsWithFolderName.forEach((event) => {
      expect(event.folderName.length).toBeLessThanOrEqual(200);
    });
    // At least one event should carry the renamed folder
    expect(eventsWithFolderName.length).toBeGreaterThan(0);
  });
});

// Task 15 review: the popup previously drained shared_folder_events with a plain
// storage.local.get followed by a separate storage.local.set([]) - a read-then-clear
// that can race a concurrent event append and silently drop it. sharedDrainEvents reads
// and resets the key under the SAME withStorageLock acquisition, so the two are atomic
// from the caller's point of view.
describe('sharedDrainEvents', () => {
  test('(d) returns the current events and clears the key atomically - a second sequential drain returns []', async () => {
    const events = [
      { folderId: 'f1', folderName: 'Team', actorEmail: 'o@x.com', kind: 'updated', collectionName: 'A', at: 1 },
      { folderId: 'f1', folderName: 'Team', actorEmail: 'o@x.com', kind: 'deleted', collectionName: null, at: 2 },
    ];
    await browser.storage.local.set({ [SHARED_EVENTS_KEY]: events });

    const first = await handleSharedMessage({ type: 'sharedDrainEvents' });
    expect(first).toEqual({ ok: true, data: { events } });
    expect((await browser.storage.local.get(SHARED_EVENTS_KEY))[SHARED_EVENTS_KEY]).toEqual([]);

    const second = await handleSharedMessage({ type: 'sharedDrainEvents' });
    expect(second).toEqual({ ok: true, data: { events: [] } });
  });

  test('drains an empty/missing events key as []', async () => {
    const res = await handleSharedMessage({ type: 'sharedDrainEvents' });
    expect(res).toEqual({ ok: true, data: { events: [] } });
  });
});
