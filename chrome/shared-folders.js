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
const { getAuthToken, STORAGE_KEYS: sharedFoldersStorageKeys } = sharedFoldersBgUtils;
const { DELETED_COLLECTION_TOMBSTONES: DELETED_COLLECTION_TOMBSTONES_KEY, DELETED_FOLDER_TOMBSTONES: DELETED_FOLDER_TOMBSTONES_KEY } =
  sharedFoldersStorageKeys;

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
    const got = await browser.storage.local.get([
      key, 'folders_index', SHARED_SYNC_STATE_KEY,
      DELETED_COLLECTION_TOMBSTONES_KEY, DELETED_FOLDER_TOMBSTONES_KEY,
    ]);
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
    const folderState = state[folderId];
    delete state[folderId];

    // Task 9/15 review: shared_sync_state[folderId].knownUids is what
    // prepareSyncDataForUpload consults to keep a shared folder's tombstones out of the
    // Drive payload even after they're deleted-then-recreated locally. Once we clear
    // that state above, any tombstone left over from BEFORE this folder was shared (or
    // from a collection deleted while it was shared) would no longer be suppressed and
    // would leak into the next Drive upload. Purge them here, before the state is gone,
    // so this folder/its collections start "clean" as plain local data again.
    const collectionTombstones = { ...(got[DELETED_COLLECTION_TOMBSTONES_KEY] || {}) };
    for (const uid of (folderState?.knownUids || [])) {
      delete collectionTombstones[uid];
    }
    const folderTombstones = { ...(got[DELETED_FOLDER_TOMBSTONES_KEY] || {}) };
    delete folderTombstones[folderId];

    await browser.storage.local.set({
      [key]: rest,
      folders_index: index,
      [SHARED_SYNC_STATE_KEY]: state,
      [DELETED_COLLECTION_TOMBSTONES_KEY]: collectionTombstones,
      [DELETED_FOLDER_TOMBSTONES_KEY]: folderTombstones,
    });
  });
  // Task 12 wiring: the alarm now gates purely on sign-in state (googleRefreshToken),
  // not on shared-folder count — signed-in users keep polling invites every 5 minutes
  // even with zero shared folders — so losing this folder no longer changes whether
  // the alarm should exist. Kept as a harmless idempotent safety net in case sign-in
  // state also changed elsewhere. Guarded because shared-folders.js is also loaded
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
//
// Task 10 review (echo-push fix): returns the Set of collection uids it actually
// applied to local storage this cycle (upserts AND deletions). Every applied row's
// local lastUpdated is now newer than the stale pre-pull sync watermark, so the
// caller (syncSharedFolders' push phase) MUST exclude this set from whatever it
// considers "dirty" — otherwise a collection just pulled from another user gets
// immediately re-PUT to the server, reattributing updated_by/bumping revision and
// ping-ponging forever between writers.
async function applyDeltaLocally(folder, delta, myEmail) {
  return withStorageLock(async () => {
    const folderId = folder.uid;
    const keys = ['collections_index', `folder_${folderId}`, 'folders_index', SHARED_EVENTS_KEY];
    const got = await browser.storage.local.get(keys);
    const index = { ...(got.collections_index || {}) };
    const updates = {};
    const removals = [];
    const events = [];
    const appliedUids = new Set();
    const normalizedMyEmail = (myEmail || '').toLowerCase();

    // Compute sanitized folder name once, use everywhere (folder record, index, events)
    const localFolder = got[`folder_${folderId}`] || folder;
    const safeFolderName = String(delta.folder.name ?? localFolder.name).slice(0, 200) || localFolder.name;

    for (const row of delta.collections || []) {
      const isOther = Boolean(row.updatedBy) && row.updatedBy.toLowerCase() !== normalizedMyEmail;
      if (row.deleted) {
        if (index[row.uid]) {
          delete index[row.uid];
          removals.push(`collection_${row.uid}`);
          appliedUids.add(row.uid);
          if (isOther) {
            events.push({
              folderId, folderName: safeFolderName, actorEmail: row.updatedBy,
              kind: 'deleted', collectionName: null, at: row.updatedAt,
            });
          }
        }
      } else if (isOther) {
        const record = { ...sanitizeRemoteCollection(row.data), uid: row.uid, parentId: folderId, lastUpdated: row.updatedAt };
        updates[`collection_${row.uid}`] = record;
        index[row.uid] = { uid: row.uid, name: record.name, parentId: folderId, lastUpdated: row.updatedAt };
        appliedUids.add(row.uid);
        events.push({
          folderId, folderName: safeFolderName, actorEmail: row.updatedBy,
          kind: 'updated', collectionName: record.name, at: row.updatedAt,
        });
      }
    }

    // Folder meta + role + members refresh on every pull, regardless of who last touched it.
    const updatedShared = { ...localFolder.shared, role: delta.role, members: delta.members };
    updates[`folder_${folderId}`] = {
      ...localFolder,
      name: safeFolderName,
      color: delta.folder.color ?? localFolder.color,
      shared: updatedShared,
    };
    if (delta.folder.name !== localFolder.name && delta.folder.updatedBy && delta.folder.updatedBy.toLowerCase() !== normalizedMyEmail) {
      events.push({
        folderId, folderName: safeFolderName, actorEmail: delta.folder.updatedBy,
        kind: 'renamed', collectionName: null, at: Date.now(),
      });
    }

    const fIndex = { ...(got.folders_index || {}) };
    if (fIndex[folderId]) fIndex[folderId] = { ...fIndex[folderId], name: safeFolderName, shared: updatedShared };
    updates.collections_index = index;
    updates.folders_index = fIndex;
    if (events.length) {
      const existingEvents = got[SHARED_EVENTS_KEY] || [];
      updates[SHARED_EVENTS_KEY] = [...existingEvents, ...events].slice(-20);
    }

    await browser.storage.local.set(updates); // ONE atomic set for upserts + meta refresh
    if (removals.length) await browser.storage.local.remove(removals); // deletions
    return appliedUids;
  });
}

// Task 12: polls the server for pending invites addressed to the signed-in user,
// persists them under SHARED_PENDING_INVITES_KEY, and fires ONE Chrome notification
// per newly-seen folderId. After fetching the current invites, prune notifiedFolderIds
// to ONLY ids present in the current server invite list (intersection), then notify for
// ids in the list but not in the pruned set. Result: invite disappears (declined/
// accepted/expired) → id drops out → future re-invite notifies afresh. The network
// fetch happens outside the storage lock (it touches no local storage); only the
// get-then-set of the pending-invites record is serialized through withStorageLock,
// consistent with every other aggregate-key mutation in this file.
async function pollInvites() {
  const res = await sharedApiFetch('/shared/invites');
  if (!res.ok) return res;
  const invites = res.data.invites || [];
  return withStorageLock(async () => {
    const { [SHARED_PENDING_INVITES_KEY]: prev = { invites: [], notifiedFolderIds: [] } } =
      await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);

    // Prune notifiedFolderIds to only include ids present in current server invites (intersection)
    const currentFolderIds = new Set(invites.map((inv) => inv.folderId));
    const prunedNotifiedIds = new Set((prev.notifiedFolderIds || []).filter((id) => currentFolderIds.has(id)));

    const notifiedFolderIds = Array.from(prunedNotifiedIds);
    for (const inv of invites) {
      if (!prunedNotifiedIds.has(inv.folderId)) {
        notifiedFolderIds.push(inv.folderId);
        prunedNotifiedIds.add(inv.folderId);
        try {
          await browser.notifications.create(`shared-invite-${inv.folderId}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Tabox — shared folder invite',
            message: `${inv.ownerEmail} wants to share the folder "${inv.folderName}" with you`,
          });
        } catch { /* notifications may be unavailable; the in-app banner still shows */ }
      }
    }
    await browser.storage.local.set({ [SHARED_PENDING_INVITES_KEY]: { invites, notifiedFolderIds } });
  }).then(() => ({ ok: true, data: { invites } }));
}

// Task 12: responds to a pending invite. Declining (or a 404 — the invite is
// already gone server-side, e.g. revoked/expired) just drops it from the local
// pending list. Accepting materializes the shared folder + its collections as
// LOCAL records in one atomic storage.local.set (folder_<id>, collection_<uid>
// per collection, both indexes rewritten), seeds this folder's sync-state
// watermark so the next background sync cycle pulls only what's changed since,
// then removes the now-resolved invite from the pending list. On success it also
// ensures the background sync alarm exists — mirroring the exact guarded-call
// pattern already used by handleSharedMessage's sharedCreateShare case and by
// unmarkLocalFolderShared (`typeof ensureSharedSyncAlarm === 'function'`). Task 12
// wiring: the alarm now gates purely on sign-in state, so the caller was almost
// certainly already polling (an invite only reaches them signed in); this call is
// a harmless idempotent no-op in that case, and still matters for the moment
// sign-in state changed out from under them. shared-folders.js is loaded via
// importScripts AFTER background.js in the real service worker, so the bare
// identifier resolves there but is safely absent (typeof-guarded, no
// ReferenceError) when this module is required standalone under Jest.
// Materializes (creates or wholesale-overwrites) a shared folder + its
// non-deleted collections as LOCAL records: folder_<folderId>,
// collection_<uid> per collection, both indexes rewritten, in ONE atomic
// storage.local.set, followed by a remove() for any stale local collection
// that used to belong to this folder but is no longer in the fresh set
// (keeps collectionCount and the index from drifting). The whole record is
// treated as server-authoritative, so a clean overwrite is correct even when
// a stale local copy already exists (e.g. re-accepting an invite, or C2's
// multi-device rematerialization below finding a folder that was pruned/
// stripped of its marker by a Drive pull on this device).
//
// Shared by respondToInvite (Task 12: accepting an invite) and
// rematerializeMissingSharedFolders (C2 review: reconciling this device's
// local storage against the server's authoritative folder list so a shared
// folder created/accepted on ANOTHER device isn't pruned as stale here).
// Callers are responsible for their own setFolderSyncState call afterward —
// this helper only ever touches folder_*/collection_*/*_index keys, never
// SHARED_SYNC_STATE_KEY, and never appends timeline events (a rematerialized
// folder isn't a "change" a user needs toasted at them).
async function materializeSharedFolderLocally({ folderId, name, color, role, ownerEmail, members, collections, now = Date.now() }) {
  return withStorageLock(async () => {
    const got = await browser.storage.local.get(['folders_index', 'collections_index']);
    const fIndex = got.folders_index || {};
    const cIndex = { ...(got.collections_index || {}) };
    const updates = {};
    const removals = [];

    // Identify fresh collections from the server response
    const freshCollectionUids = new Set(collections.map((c) => c.uid));

    // Find and remove stale local collections (parentId matches this folder, but uid not in fresh response)
    for (const uid of Object.keys(cIndex)) {
      if (cIndex[uid].parentId === folderId && !freshCollectionUids.has(uid)) {
        delete cIndex[uid];
        removals.push(`collection_${uid}`);
      }
    }

    const shared = { folderId, role, ownerEmail, members };
    const safeName = String(name ?? 'Untitled').slice(0, 200) || 'Untitled';
    const folderRecord = {
      uid: folderId,
      name: safeName,
      type: 'folder',
      color,
      collapsed: false,
      order: 999999,
      collectionCount: collections.length,
      createdOn: now,
      lastUpdated: now,
      shared,
    };
    updates[`folder_${folderId}`] = folderRecord;
    fIndex[folderId] = { uid: folderId, name: safeName, type: 'folder', color, shared };
    for (const c of collections) {
      const record = { ...sanitizeRemoteCollection(c.data), uid: c.uid, parentId: folderId, lastUpdated: now };
      updates[`collection_${c.uid}`] = record;
      cIndex[c.uid] = { uid: c.uid, name: record.name, parentId: folderId, lastUpdated: now };
    }
    updates.folders_index = fIndex;
    updates.collections_index = cIndex;
    await browser.storage.local.set(updates); // one atomic set
    if (removals.length) await browser.storage.local.remove(removals);
  });
}

// C2 review fix (multi-device rematerialization): the Task 8 `shared` marker
// never travels via Drive sync (Task 9 deliberately excludes it from the
// upload payload), so when a folder is shared/accepted on one device, a
// SECOND device's next Drive pull sees a folder it has no local record of (or
// a record with the marker Drive-pruned as "not ours") and treats it as
// stale — pruning it, or leaving it un-rematerialized. Reconcile against the
// server's authoritative "folders I have access to" list BEFORE the normal
// per-folder pull/push loop in doSyncSharedFolders: anything the server says
// we should have, but that's missing locally OR present without a live
// `shared` marker, gets rematerialized (folder + all its non-deleted
// collections, regardless of which user authored them — this is a full
// resync, not a delta, so applyDeltaLocally's "isOther" author check does not
// apply here). A folder already present with a live marker is left
// completely untouched (the normal loop below already syncs it) — no extra
// network call for it. Failure of the list call itself is skipped silently;
// the next 5-minute cycle retries. A per-folder delta-fetch failure only
// skips THAT folder, same reasoning.
async function rematerializeMissingSharedFolders() {
  const listRes = await sharedApiFetch('/shared/folders');
  if (!listRes.ok) return; // network/auth error: skip silently, next cycle retries

  const { folders_index: localIndex = {} } = await browser.storage.local.get('folders_index');

  for (const entry of listRes.data.folders || []) {
    const localRecord = localIndex[entry.folderId];
    if (localRecord?.shared?.folderId) continue; // live locally already — normal loop covers it, no extra fetch

    const deltaRes = await sharedApiFetch(`/shared/folders/${entry.folderId}?sinceRev=0`);
    if (!deltaRes.ok) continue; // skip this one; retried next cycle

    const now = Date.now();
    const collections = (deltaRes.data.collections || []).filter((c) => !c.deleted);
    await materializeSharedFolderLocally({
      folderId: entry.folderId,
      name: deltaRes.data.folder.name,
      color: deltaRes.data.folder.color ?? entry.color,
      role: deltaRes.data.role,
      ownerEmail: entry.ownerEmail,
      members: deltaRes.data.members,
      collections: collections.map((c) => ({ uid: c.uid, data: c.data })),
      now,
    });
    await setFolderSyncState(entry.folderId, {
      lastRev: deltaRes.data.revision,
      lastSyncedAt: now,
      knownUids: collections.map((c) => c.uid),
    });
  }
}

async function respondToInvite({ folderId, accept }) {
  const res = await sharedApiFetch(`/shared/invites/${folderId}/respond`, { method: 'POST', body: { accept } });

  const removePending = () => withStorageLock(async () => {
    const { [SHARED_PENDING_INVITES_KEY]: prev = { invites: [], notifiedFolderIds: [] } } =
      await browser.storage.local.get(SHARED_PENDING_INVITES_KEY);
    await browser.storage.local.set({
      [SHARED_PENDING_INVITES_KEY]: {
        ...prev,
        invites: (prev.invites || []).filter((i) => i.folderId !== folderId),
        notifiedFolderIds: (prev.notifiedFolderIds || []).filter((id) => id !== folderId),
      },
    });
  });

  if (!res.ok) {
    if (res.status === 404) await removePending();
    return res;
  }
  if (!res.data.accepted) {
    await removePending();
    return res;
  }

  const { folder, collections } = res.data;
  const now = Date.now();

  // Materialization (folder_<id> + collection_<uid> per collection + both
  // indexes, overwriting any stale local copy wholesale) is shared with C2's
  // rematerializeMissingSharedFolders below — see materializeSharedFolderLocally.
  await materializeSharedFolderLocally({
    folderId: folder.folderId,
    name: folder.name,
    color: folder.color,
    role: folder.role,
    ownerEmail: folder.ownerEmail,
    members: folder.members,
    collections,
    now,
  });

  // Separate, sequential lock acquisitions (setFolderSyncState and
  // removePending each acquire/release their own) — never nested inside the
  // block above, which would deadlock.
  await setFolderSyncState(folder.folderId, { lastRev: folder.revision, lastSyncedAt: now, knownUids: collections.map((c) => c.uid) });
  await removePending();

  if (typeof ensureSharedSyncAlarm === 'function') await ensureSharedSyncAlarm();

  return { ok: true, data: { folderId: folder.folderId } };
}

// Task 10 review fix: re-entrancy guard. The 5-minute alarm and a popup-triggered
// `sharedSyncNow` can fire concurrently; without this, two overlapping runs would
// each pull/push independently, double-pushing dirty collections and racing each
// other's sync-state writes. If a run is already in flight, coalesce onto it —
// return the SAME promise rather than starting (or queueing) a second run.
// Deliberately NOT declared `async function`: an async wrapper would allocate a
// fresh Promise on every call (even one that just returns another promise), so
// two overlapping callers would each get a distinct-but-equivalent promise
// instead of the literal same one. Returning the raw promise here preserves
// reference identity, which is what callers rely on to detect coalescing.
let sharedSyncInFlight = null;
function syncSharedFolders() {
  if (sharedSyncInFlight) return sharedSyncInFlight;
  sharedSyncInFlight = doSyncSharedFolders().finally(() => {
    sharedSyncInFlight = null;
  });
  return sharedSyncInFlight;
}

// Task 10: background sync engine. For every locally-shared folder: pull the
// server's delta since our last known revision and apply it, then (write/owner
// roles only) push locally-dirty collections and local deletions back. A pull
// that comes back 403/404 means our access was revoked (or the folder itself
// was deleted) — convert the folder back to a plain local folder and record a
// 'revoked' event for Task 15's toasts. Network/auth errors on pull just skip
// that folder for this cycle; the next alarm tick tries again.
async function doSyncSharedFolders() {
  const { googleUser } = await browser.storage.local.get('googleUser');
  const myEmail = (googleUser?.emailAddress || '').toLowerCase();
  const folders = await loadLocalSharedFolders();

  // C2 review fix: reconcile against the server's authoritative "folders I
  // have access to" list BEFORE the per-folder loop below runs (`folders`,
  // captured just above, deliberately does NOT include anything
  // rematerialized here — a folder rematerialized this cycle is picked up by
  // the NEXT cycle's loadLocalSharedFolders() instead of being double-synced
  // within this same cycle). See rematerializeMissingSharedFolders' comment
  // for why this exists at all. Never allowed to abort the rest of the
  // cycle — the list/delta calls it makes already fail silently, but this
  // extra try/catch also guards against an unexpected local storage error.
  try {
    await rematerializeMissingSharedFolders();
  } catch (error) {
    console.error('Error rematerializing shared folders:', error);
  }

  let pulled = 0;
  let pushed = 0;
  let revoked = 0;

  for (const folder of folders) {
    const folderId = folder.uid;
    const state = (await getSyncState())[folderId] || { lastRev: 0, lastSyncedAt: 0, knownUids: [] };

    // Review fix (lost-dirty window): capture the watermark timestamp AND the
    // collections_index snapshot used for dirty computation BEFORE any network
    // I/O this cycle (pull or push). We store THIS timestamp as the new
    // lastSyncedAt (not Date.now() after the round-trip completes), so a local
    // edit that lands while the network call is in flight — timestamped after
    // this watermark — is never misclassified as "already synced": it simply
    // stays dirty and gets picked up next cycle instead of being silently and
    // permanently skipped.
    const cycleStartTs = Date.now();
    const { collections_index: preCycleIndex = {} } = await browser.storage.local.get('collections_index');

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
    const appliedUids = await applyDeltaLocally(folder, pull.data, myEmail);
    pulled += (pull.data.collections || []).length;
    let lastRev = pull.data.revision;

    // PUSH (write/owner only — read-role members never write back)
    if (pull.data.role !== 'read') {
      const { collections_index: cIndex = {} } = await browser.storage.local.get('collections_index');
      const currentUids = Object.keys(cIndex).filter((uid) => cIndex[uid].parentId === folderId);
      // Echo-push fix: judge "dirty" against the PRE-network snapshot (edits made
      // locally before this cycle's round-trip started) and explicitly exclude
      // anything applyDeltaLocally just applied this cycle — a row pulled from
      // another user must never be re-PUT in the same cycle it was pulled.
      const dirty = currentUids.filter((uid) =>
        !appliedUids.has(uid) && (preCycleIndex[uid]?.lastUpdated || 0) > state.lastSyncedAt
      );
      const recs = await browser.storage.local.get(dirty.map((u) => `collection_${u}`));
      for (const uid of dirty) {
        const rec = recs[`collection_${uid}`];
        if (!rec) continue;
        // I2 review fix (defense in depth): lastOpened is per-user local state
        // (which device last opened this collection) — it must never travel
        // to the server, let alone reach other members. Stripped alongside
        // parentId (already stripped: it's a local-storage relationship, not
        // shared-collection data). Built via delete rather than destructuring
        // both into discarded bindings, which would trip no-unused-vars.
        const data = { ...rec };
        delete data.parentId;
        delete data.lastOpened;
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
      // Same echo-push exclusion applies to deletions: a uid the pull itself just
      // removed locally (appliedUids) is already reflected server-side — don't
      // issue a redundant DELETE for it.
      const goneUids = state.knownUids.filter((u) => !currentUids.includes(u) && !appliedUids.has(u));
      for (const uid of goneUids) {
        const r = await sharedApiFetch(`/shared/folders/${folderId}/collections/${uid}`, { method: 'DELETE' });
        if (r.ok) {
          lastRev = r.data.revision;
          pushed += 1;
        }
      }
      await setFolderSyncState(folderId, { lastRev, lastSyncedAt: cycleStartTs, knownUids: currentUids });
    } else {
      await setFolderSyncState(folderId, { lastRev, lastSyncedAt: cycleStartTs, knownUids: state.knownUids });
    }
  }

  // Task 12 wiring: poll for pending invites at the end of EVERY cycle, even
  // when `folders` above was empty — that's exactly the state of an invitee
  // who hasn't accepted anything yet, and they still need their invites
  // checked every 5 minutes. pollInvites() already returns an { ok: false, ... }
  // tuple (never throws) for network/auth failures, but it's wrapped here too
  // so that an unexpected rejection (e.g. a storage.local call throwing) can
  // never crash a sync cycle that already successfully pulled/pushed above.
  try {
    await pollInvites();
  } catch {
    // Invite polling must never abort/crash the sync cycle.
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
      // Task 12 wiring: the alarm now gates purely on sign-in state, not on
      // shared-folder count, so creating a share no longer changes whether it
      // should exist (a signed-in owner was already being polled). Kept as a
      // harmless idempotent call. Guarded: not defined when shared-folders.js
      // loads standalone under Jest.
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
    // I1 review fix: folder rename/recolor was never pushed to the server —
    // a shared folder's name/color change silently reverted on the next pull
    // (applyDeltaLocally always refreshes folder meta from the server's
    // record, which never learned about the local edit). Called
    // fire-and-forget from app/utils/folderOperations.js's updateFolderDetails
    // after a successful LOCAL save of a shared folder the user can edit.
    case 'sharedUpdateFolderMeta': {
      const r = await sharedApiFetch(`/shared/folders/${request.folderId}`, {
        method: 'PATCH', body: { name: request.name, color: request.color },
      });
      if (r.ok) await setFolderSyncState(request.folderId, { lastRev: r.data.revision });
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
    case 'sharedDrainEvents':
      // Task 15 review: read-then-clear must be atomic so a popup drain can never race
      // another writer appending a new event between the read and the clear (which would
      // silently drop it). Locked read + reset-to-[] + return, all in one acquisition.
      return withStorageLock(async () => {
        const { [SHARED_EVENTS_KEY]: events = [] } = await browser.storage.local.get(SHARED_EVENTS_KEY);
        await browser.storage.local.set({ [SHARED_EVENTS_KEY]: [] });
        return { ok: true, data: { events } };
      });
    default:
      return null;
  }
}

const ALLOWED_TAB_SCHEMES = ['http:', 'https:', 'about:', 'chrome:'];
// I2 review fix: lastOpened is per-user local state (which device last opened
// this collection) and must never travel between devices/members — dropped
// from the whitelist so a stray inbound lastOpened (e.g. an older client that
// still pushed it) is never applied locally either.
const COLLECTION_FIELDS = ['name', 'tabs', 'chromeGroups', 'color', 'createdOn', 'lastUpdated', 'window', 'isFavorite', 'favoriteOrder', 'order'];

function sanitizeRemoteCollection(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { name: 'Untitled', tabs: [] };
  const clean = {};
  for (const field of COLLECTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) clean[field] = data[field];
  }
  clean.name = String(clean.name ?? 'Untitled').slice(0, 500) || 'Untitled';
  clean.tabs = Array.isArray(clean.tabs)
    ? clean.tabs.filter((tab) => {
        try { return ALLOWED_TAB_SCHEMES.includes(new URL(tab.url).protocol); } catch { return false; }
      })
      .map((tab) => {
        // Shallow-copy tab and sanitize favIconUrl: drop if not http(s)
        const sanitized = { ...tab };
        if (sanitized.favIconUrl) {
          try {
            const protocol = new URL(sanitized.favIconUrl).protocol;
            if (!['http:', 'https:'].includes(protocol)) delete sanitized.favIconUrl;
          } catch {
            // Invalid URL — drop the favIconUrl
            delete sanitized.favIconUrl;
          }
        }
        return sanitized;
      })
    : [];
  return clean;
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
  sanitizeRemoteCollection,
};

if (typeof globalThis !== 'undefined') {
  globalThis.TaboxSharedFolders = sharedFoldersApi;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedFoldersApi;
}
