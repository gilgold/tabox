/* eslint-disable no-undef */
// Background-side shared-folders API client + share message handlers.
// Loaded via importScripts in background.js after background-utils.js
// (getAuthToken) and pro-config.js (PRO_API_BASE), mirroring the existing
// chrome/pro-entitlement.js pattern. `require`/`globalThis` guards below let
// this same file be pulled in directly via `require()` in Jest (where
// `jest.mock('./background-utils', ...)` can intercept it) while still
// working as a plain classic script in the real service worker.

const sharedFoldersBgUtils = typeof require === 'function'
  ? require('./background-utils')
  : globalThis.TaboxBackgroundUtils;
const { getAuthToken } = sharedFoldersBgUtils;

// pro-config.js only exposes PRO_API_BASE via module.exports (no globalThis
// hook) — in the browser it's picked up as a bare global, exactly like
// chrome/pro-entitlement.js already does.
const SHARED_API_BASE = typeof require === 'function'
  ? require('./pro-config').PRO_API_BASE
  : PRO_API_BASE;

const SHARED_SYNC_STATE_KEY = 'shared_sync_state';
const SHARED_PENDING_INVITES_KEY = 'shared_pending_invites';
const SHARED_EVENTS_KEY = 'shared_folder_events';

// Task 9: shared folders/collections must never enter the Google Drive sync payload.
// isSharedFolderRecord identifies a folder carrying the Task 8 `shared` marker;
// partitionSharedUids derives the shared folder/collection uid sets from a snapshot's
// foldersArray/collectionsArray so callers (prepareSyncDataForUpload) can filter them out.
function isSharedFolderRecord(folder) {
  return Boolean(folder && folder.shared && folder.shared.folderId);
}

function partitionSharedUids(foldersArray = [], collectionsArray = []) {
  const sharedFolderUids = new Set((foldersArray || []).filter(isSharedFolderRecord).map((f) => f.uid));
  const sharedCollectionUids = new Set(
    (collectionsArray || []).filter((c) => c && sharedFolderUids.has(c.parentId)).map((c) => c.uid)
  );
  return { sharedFolderUids, sharedCollectionUids };
}

async function sharedApiFetch(path, { method = 'GET', body } = {}) {
  const token = await getAuthToken();
  if (!token) return { ok: false, status: 0, error: 'not_signed_in' };
  try {
    const res = await fetch(`${SHARED_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, status: res.status, data }
      : { ok: false, status: res.status, error: data.error || 'request_failed' };
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
}

async function getSyncState() {
  const { [SHARED_SYNC_STATE_KEY]: state } = await browser.storage.local.get(SHARED_SYNC_STATE_KEY);
  return state || {};
}

// Task 10 (reviewer-mandated on Task 8's review): every read-modify-write mutation
// of the aggregate storage keys (shared_sync_state, folders_index, collections_index,
// shared_folder_events) is serialized through this module-level promise-chain mutex,
// so a popup-triggered `sharedSyncNow` racing the 5-minute alarm's own sync pass can
// never interleave with another writer and clobber its update. Each locked function
// below acquires/releases independently (none nest an inner lock acquisition inside
// an outer one — that would deadlock, since the inner `.then` would depend on the
// outer promise resolving, which itself is waiting on the inner call).
let storageChain = Promise.resolve();
function withStorageLock(fn) {
  const p = storageChain.then(fn);
  storageChain = p.catch(() => {});
  return p;
}

async function setFolderSyncState(folderId, patch) {
  return withStorageLock(async () => {
    const state = await getSyncState();
    state[folderId] = { lastRev: 0, lastSyncedAt: 0, knownUids: [], ...(state[folderId] || {}), ...patch };
    await browser.storage.local.set({ [SHARED_SYNC_STATE_KEY]: state });
  });
}

async function clearFolderSyncState(folderId) {
  return withStorageLock(async () => {
    const state = await getSyncState();
    delete state[folderId];
    await browser.storage.local.set({ [SHARED_SYNC_STATE_KEY]: state });
  });
}

async function markLocalFolderShared(folderId, shared) {
  return withStorageLock(async () => {
    const key = `folder_${folderId}`;
    const got = await browser.storage.local.get([key, 'folders_index']);
    const record = got[key];
    if (!record) return;
    const updated = { ...record, shared };
    const index = got.folders_index || {};
    if (index[folderId]) index[folderId] = { ...index[folderId], shared };
    await browser.storage.local.set({ [key]: updated, folders_index: index });
  });
}

async function unmarkLocalFolderShared(folderId) {
  await withStorageLock(async () => {
    const key = `folder_${folderId}`;
    const got = await browser.storage.local.get([key, 'folders_index', SHARED_SYNC_STATE_KEY]);
    if (!got[key]) return;
    const { shared, ...rest } = got[key];
    const index = got.folders_index || {};
    if (index[folderId]) {
      const { shared: removedShared, ...restIdx } = index[folderId];
      index[folderId] = restIdx;
    }
    // Inline the sync-state clear (rather than calling the locked
    // clearFolderSyncState helper) so this whole operation is ONE lock
    // acquisition — nesting withStorageLock calls would deadlock.
    const state = got[SHARED_SYNC_STATE_KEY] || {};
    delete state[folderId];
    await browser.storage.local.set({ [key]: rest, folders_index: index, [SHARED_SYNC_STATE_KEY]: state });
  });
  // The extension may have just lost its last shared folder (or gained back
  // sign-in state elsewhere) — let background.js decide whether the sync alarm
  // still needs to exist. Guarded because shared-folders.js is also loaded
  // standalone under Jest, where background.js's alarm helper isn't defined.
  if (typeof ensureSharedSyncAlarm === 'function') await ensureSharedSyncAlarm();
}

async function appendEvents(events) {
  if (!events.length) return;
  return withStorageLock(async () => {
    const { [SHARED_EVENTS_KEY]: existing = [] } = await browser.storage.local.get(SHARED_EVENTS_KEY);
    await browser.storage.local.set({ [SHARED_EVENTS_KEY]: [...existing, ...events].slice(-20) });
  });
}

async function loadLocalSharedFolders() {
  const { folders_index: index = {} } = await browser.storage.local.get('folders_index');
  const uids = Object.keys(index).filter((uid) => index[uid]?.shared?.folderId);
  if (!uids.length) return [];
  const got = await browser.storage.local.get(uids.map((u) => `folder_${u}`));
  return uids.map((u) => got[`folder_${u}`]).filter(Boolean);
}

// Applies one folder's pulled delta to local storage: upserts/removes collections
// changed by OTHER users, refreshes folder meta/role/members (every pull, regardless
// of who changed them), and records timeline events for changes made by others.
// The get -> compute -> ONE storage.local.set (updates) -> storage.local.remove
// (deletions) sequence is wrapped in a single lock acquisition so it can never
// interleave with another writer (e.g. a concurrent sharedSyncNow on a different
// folder still touches the same collections_index/folders_index/events keys).
async function applyDeltaLocally(folder, delta, myEmail) {
  return withStorageLock(async () => {
    const folderId = folder.uid;
    const keys = ['collections_index', `folder_${folderId}`, 'folders_index', SHARED_EVENTS_KEY];
    const got = await browser.storage.local.get(keys);
    const index = { ...(got.collections_index || {}) };
    const updates = {};
    const removals = [];
    const events = [];
    const normalizedMyEmail = (myEmail || '').toLowerCase();

    for (const row of delta.collections || []) {
      const isOther = Boolean(row.updatedBy) && row.updatedBy.toLowerCase() !== normalizedMyEmail;
      if (row.deleted) {
        if (index[row.uid]) {
          delete index[row.uid];
          removals.push(`collection_${row.uid}`);
          if (isOther) {
            events.push({
              folderId, folderName: delta.folder.name, actorEmail: row.updatedBy,
              kind: 'deleted', collectionName: null, at: row.updatedAt,
            });
          }
        }
      } else if (isOther) {
        const record = { ...row.data, uid: row.uid, parentId: folderId, lastUpdated: row.updatedAt };
        updates[`collection_${row.uid}`] = record;
        index[row.uid] = { uid: row.uid, name: record.name, parentId: folderId, lastUpdated: row.updatedAt };
        events.push({
          folderId, folderName: delta.folder.name, actorEmail: row.updatedBy,
          kind: 'updated', collectionName: record.name, at: row.updatedAt,
        });
      }
    }

    // Folder meta + role + members refresh on every pull, regardless of who last touched it.
    const localFolder = got[`folder_${folderId}`] || folder;
    const updatedShared = { ...localFolder.shared, role: delta.role, members: delta.members };
    updates[`folder_${folderId}`] = {
      ...localFolder,
      name: delta.folder.name,
      color: delta.folder.color ?? localFolder.color,
      shared: updatedShared,
    };
    if (delta.folder.name !== localFolder.name && delta.folder.updatedBy && delta.folder.updatedBy.toLowerCase() !== normalizedMyEmail) {
      events.push({
        folderId, folderName: delta.folder.name, actorEmail: delta.folder.updatedBy,
        kind: 'renamed', collectionName: null, at: Date.now(),
      });
    }

    const fIndex = { ...(got.folders_index || {}) };
    if (fIndex[folderId]) fIndex[folderId] = { ...fIndex[folderId], name: delta.folder.name, shared: updatedShared };
    updates.collections_index = index;
    updates.folders_index = fIndex;
    if (events.length) {
      const existingEvents = got[SHARED_EVENTS_KEY] || [];
      updates[SHARED_EVENTS_KEY] = [...existingEvents, ...events].slice(-20);
    }

    await browser.storage.local.set(updates); // ONE atomic set for upserts + meta refresh
    if (removals.length) await browser.storage.local.remove(removals); // deletions
  });
}

// Placeholder stub — Task 11/12 replaces this body with the real invite-response
// implementation. Once implemented, an accepted invite gains the caller its first
// shared folder, so that success path should also call
// `if (typeof ensureSharedSyncAlarm === 'function') await ensureSharedSyncAlarm();`
// (same guarded call used by sharedCreateShare above and unmarkLocalFolderShared).
async function respondToInvite() {
  return { ok: false, error: 'not_implemented' };
}
// Task 12 replaces this stub with the real invite-poll implementation.
async function pollInvites() {
  return { ok: false, error: 'not_implemented' };
}

// Task 10: background sync engine. For every locally-shared folder: pull the
// server's delta since our last known revision and apply it, then (write/owner
// roles only) push locally-dirty collections and local deletions back. A pull
// that comes back 403/404 means our access was revoked (or the folder itself
// was deleted) — convert the folder back to a plain local folder and record a
// 'revoked' event for Task 15's toasts. Network/auth errors on pull just skip
// that folder for this cycle; the next alarm tick tries again.
async function syncSharedFolders() {
  const { googleUser } = await browser.storage.local.get('googleUser');
  const myEmail = (googleUser?.emailAddress || '').toLowerCase();
  const folders = await loadLocalSharedFolders();
  let pulled = 0;
  let pushed = 0;
  let revoked = 0;

  for (const folder of folders) {
    const folderId = folder.uid;
    const state = (await getSyncState())[folderId] || { lastRev: 0, lastSyncedAt: 0, knownUids: [] };

    // PULL
    const pull = await sharedApiFetch(`/shared/folders/${folderId}?sinceRev=${state.lastRev}`);
    if (!pull.ok) {
      if (pull.status === 403 || pull.status === 404) {
        await unmarkLocalFolderShared(folderId);
        await appendEvents([{ folderId, folderName: folder.name, actorEmail: null, kind: 'revoked', collectionName: null, at: Date.now() }]);
        revoked += 1;
      }
      continue; // network/auth errors: try again next cycle
    }
    await applyDeltaLocally(folder, pull.data, myEmail);
    pulled += (pull.data.collections || []).length;
    let lastRev = pull.data.revision;

    // PUSH (write/owner only — read-role members never write back)
    if (pull.data.role !== 'read') {
      const { collections_index: cIndex = {} } = await browser.storage.local.get('collections_index');
      const currentUids = Object.keys(cIndex).filter((uid) => cIndex[uid].parentId === folderId);
      const dirty = currentUids.filter((uid) => (cIndex[uid].lastUpdated || 0) > state.lastSyncedAt);
      const recs = await browser.storage.local.get(dirty.map((u) => `collection_${u}`));
      for (const uid of dirty) {
        const rec = recs[`collection_${uid}`];
        if (!rec) continue;
        const { parentId, ...data } = rec;
        const r = await sharedApiFetch(`/shared/folders/${folderId}/collections/${uid}`, {
          method: 'PUT', body: { data, baseRev: lastRev },
        });
        if (r.ok) {
          lastRev = r.data.revision;
          pushed += 1;
        }
        // 409 (conflict): the server has a newer revision for this collection than
        // our baseRev — skip it silently. The next cycle's pull reconciles (or, if
        // our local edit is still newer after that, we simply re-push it then).
        // Never throw: one folder's conflict must not abort the rest of the loop.
      }
      for (const uid of state.knownUids.filter((u) => !currentUids.includes(u))) {
        const r = await sharedApiFetch(`/shared/folders/${folderId}/collections/${uid}`, { method: 'DELETE' });
        if (r.ok) {
          lastRev = r.data.revision;
          pushed += 1;
        }
      }
      await setFolderSyncState(folderId, { lastRev, lastSyncedAt: Date.now(), knownUids: currentUids });
    } else {
      await setFolderSyncState(folderId, { lastRev, lastSyncedAt: Date.now(), knownUids: state.knownUids });
    }
  }

  return { ok: true, data: { pulled, pushed, revoked } };
}

async function handleSharedMessage(request) {
  switch (request.type) {
    case 'sharedCreateShare': {
      const { folder, collections, invites = [] } = request;
      const created = await sharedApiFetch('/shared/folders', {
        method: 'POST',
        body: { folderId: folder.uid, name: folder.name, color: folder.color, collections },
      });
      if (!created.ok) return created;
      let members = [];
      for (const inv of invites) {
        const r = await sharedApiFetch(`/shared/folders/${folder.uid}/invites`, { method: 'POST', body: inv });
        if (r.ok) members = r.data.members;
      }
      await markLocalFolderShared(folder.uid, { folderId: folder.uid, role: 'owner', ownerEmail: null, members });
      await setFolderSyncState(folder.uid, {
        lastRev: created.data.revision, lastSyncedAt: Date.now(), knownUids: collections.map((c) => c.uid),
      });
      // The extension may have just gained its first shared folder — let
      // background.js's alarm helper decide whether the sync alarm needs
      // creating. Guarded: not defined when shared-folders.js loads standalone
      // under Jest.
      if (typeof ensureSharedSyncAlarm === 'function') await ensureSharedSyncAlarm();
      return { ok: true, data: { members } };
    }
    case 'sharedInvite': {
      const r = await sharedApiFetch(`/shared/folders/${request.folderId}/invites`, {
        method: 'POST', body: { email: request.email, role: request.role },
      });
      if (r.ok) {
        const key = `folder_${request.folderId}`;
        const got = await browser.storage.local.get(key);
        if (got[key]?.shared) await markLocalFolderShared(request.folderId, { ...got[key].shared, members: r.data.members });
      }
      return r;
    }
    case 'sharedGetMembers':
      return sharedApiFetch(`/shared/folders/${request.folderId}/members`);
    case 'sharedUpdateMemberRole':
      return sharedApiFetch(`/shared/folders/${request.folderId}/members/${encodeURIComponent(request.email)}`, {
        method: 'PATCH', body: { role: request.role },
      });
    case 'sharedRemoveMember':
      return sharedApiFetch(`/shared/folders/${request.folderId}/members/${encodeURIComponent(request.email)}`, { method: 'DELETE' });
    case 'sharedLeaveFolder': {
      const { googleUser } = await browser.storage.local.get('googleUser');
      const email = googleUser?.emailAddress;
      if (!email) return { ok: false, error: 'not_signed_in' };
      const r = await sharedApiFetch(`/shared/folders/${request.folderId}/members/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (r.ok || r.status === 403 || r.status === 404) await unmarkLocalFolderShared(request.folderId);
      return r;
    }
    case 'sharedUnshareFolder': {
      const r = await sharedApiFetch(`/shared/folders/${request.folderId}`, { method: 'DELETE' });
      if (r.ok) await unmarkLocalFolderShared(request.folderId);
      return r;
    }
    case 'sharedGetInvites':
      return sharedApiFetch('/shared/invites');
    case 'sharedRespondInvite':
      return respondToInvite(request);
    case 'sharedSyncNow':
      return syncSharedFolders();
    default:
      return null;
  }
}

const sharedFoldersApi = {
  SHARED_SYNC_STATE_KEY,
  SHARED_PENDING_INVITES_KEY,
  SHARED_EVENTS_KEY,
  isSharedFolderRecord,
  partitionSharedUids,
  sharedApiFetch,
  setFolderSyncState,
  clearFolderSyncState,
  unmarkLocalFolderShared,
  respondToInvite,
  syncSharedFolders,
  pollInvites,
  handleSharedMessage,
};

if (typeof globalThis !== 'undefined') {
  globalThis.TaboxSharedFolders = sharedFoldersApi;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedFoldersApi;
}
