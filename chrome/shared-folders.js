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

async function setFolderSyncState(folderId, patch) {
  const state = await getSyncState();
  state[folderId] = { lastRev: 0, lastSyncedAt: 0, knownUids: [], ...(state[folderId] || {}), ...patch };
  await browser.storage.local.set({ [SHARED_SYNC_STATE_KEY]: state });
}

async function clearFolderSyncState(folderId) {
  const state = await getSyncState();
  delete state[folderId];
  await browser.storage.local.set({ [SHARED_SYNC_STATE_KEY]: state });
}

async function markLocalFolderShared(folderId, shared) {
  const key = `folder_${folderId}`;
  const got = await browser.storage.local.get([key, 'folders_index']);
  const record = got[key];
  if (!record) return;
  const updated = { ...record, shared };
  const index = got.folders_index || {};
  if (index[folderId]) index[folderId] = { ...index[folderId], shared };
  await browser.storage.local.set({ [key]: updated, folders_index: index });
}

async function unmarkLocalFolderShared(folderId) {
  const key = `folder_${folderId}`;
  const got = await browser.storage.local.get([key, 'folders_index']);
  if (!got[key]) return;
  const { shared, ...rest } = got[key];
  const index = got.folders_index || {};
  if (index[folderId]) {
    const { shared: removedShared, ...restIdx } = index[folderId];
    index[folderId] = restIdx;
  }
  await browser.storage.local.set({ [key]: rest, folders_index: index });
  await clearFolderSyncState(folderId);
}

// Placeholder stubs so this task compiles and tests pass; Tasks 11-12 replace
// their bodies with the real sync engine / invite-response implementations.
async function respondToInvite() {
  return { ok: false, error: 'not_implemented' };
}
async function syncSharedFolders() {
  return { ok: false, error: 'not_implemented' };
}
async function pollInvites() {
  return { ok: false, error: 'not_implemented' };
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
