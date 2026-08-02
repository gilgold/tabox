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
const { getAuthToken: sharedFoldersGetAuthToken, STORAGE_KEYS: sharedFoldersStorageKeys } = sharedFoldersBgUtils;
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
const SHARED_PENDING_LINK_JOIN_KEY = 'shared_pending_link_join';

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
  const token = await sharedFoldersGetAuthToken();
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
    const rest = { ...got[key] };
    delete rest.shared;
    const index = got.folders_index || {};
    if (index[folderId]) {
      const restIdx = { ...index[folderId] };
      delete restIdx.shared;
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
// regardless of who authored them, refreshes folder meta/role/members (every pull),
// and records timeline events ONLY for changes made by others.
//
// Same-account multi-device fix: upserts used to be gated on isOther
// (row.updatedBy !== myEmail) as an echo guard, which silently left a second
// device signed into the SAME account stale forever for own-authored rows.
// The revision watermark already prevents echo — a device's own push advances
// state.lastRev to the returned revision, so its own row never reappears in a
// later sinceRev delta; an own-authored row in a delta can therefore only come
// from ANOTHER device (or a failed watermark persist, where re-applying the
// identical row is harmless). Storage writes now ignore the author entirely;
// `isOther` only gates timeline events. The B4 (pendingLocalRemovals) and I3
// (dirty-defer) guards below apply to own-authored rows exactly as to others':
// a device-B dirty edit must race a device-A row fairly, not be clobbered by
// it just because both were authored by the same email.
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
//
// B4 fix (own-pending-delete/move-out swallowed by a same-cycle pull):
// `pendingLocalRemovals` is a Set of uids the caller has already determined
// were removed from this folder LOCALLY (deleted, or moved to a different
// parentId) before this cycle's pull ran (computed from the pre-pull
// collections_index snapshot — see doSyncSharedFolders). Before this fix, an
// incoming upsert for such a uid (e.g. another member's edit landing in the
// same delta) was applied unconditionally, silently resurrecting the row
// locally with `parentId` reset back to this folder — undoing the user's own
// local action. Because the push phase's `goneUids` used to be computed from
// the POST-pull collections_index, the just-reverted uid then looked
// "still present", so the user's delete/move-out was never even pushed as a
// DELETE, and (knownUids being rewritten to the post-revert state at the end
// of the cycle) never retried on a later cycle either — a total, silent loss
// of the user's action.
//
// Fix chosen (of the two documented in the task brief): skip applying the
// upsert entirely for any uid in `pendingLocalRemovals`, rather than letting
// it land and then reverting/re-deleting it afterward. This is the cleaner
// semantics — the local removal simply wins for this cycle, local storage is
// never touched for that uid, and the caller's `goneUids` computation (also
// diffed against the same pre-pull snapshot, not the post-pull index) still
// sees it as absent and pushes the real DELETE this same cycle. Net effect:
// the local move-out/delete survives, the server row still gets deleted, and
// (for a move-out) the user's own moved-out local copy is left completely
// untouched rather than being overwritten with the other member's content.
//
// I3 fix (conflict-aware pull — dirty local edits race fairly instead of
// being silently clobbered): collections sync at WHOLE-DOCUMENT granularity
// (a tab add/remove/reorder is just an edit to the `tabs` array), so
// unconditionally overwriting a locally-DIRTY row the instant a same-uid
// remote row arrives was silently destroying a user's unsynced tab changes
// whenever another member's edit to the SAME collection landed first — with
// zero signal. "Dirty" here means the SAME thing the push phase's own dirty
// diff already means: `preCycleIndex[uid].lastUpdated > lastSyncedAt` (the
// two watermarks the caller already captures before any network I/O this
// cycle — see doSyncSharedFolders' `cycleStartTs`/`preCycleIndex` comment).
// Rather than overwrite such a row (upsert) or destroy it outright (delete
// tombstone), stash the remote row in `deferredRemotes` (keyed by uid) and do
// NOT add the uid to `appliedUids` — leaving local storage untouched for it.
// The caller's push phase then races fairly: the uid is still "dirty" (not
// excluded via appliedUids) so it still gets pushed, but with baseRev pinned
// to the PRE-pull revision watermark (state.lastRev) rather than the
// just-pulled one — since the deferred row, by construction, has a server
// rev newer than that stale watermark (that's why it appeared in this
// cycle's delta at all), the push 409s unless this device's own write
// somehow still lands first (see doSyncSharedFolders' M3 scenario). A 409
// means the local edit LOST the race: the caller applies the deferred remote
// (upsert or deletion) and records a 'conflict' timeline event so the user is
// told. A successful push means this device raced ahead; the deferred remote
// is simply discarded, never applied.
async function applyDeltaLocally(folder, delta, myEmail, pendingLocalRemovals = new Set(), preCycleIndex = {}, lastSyncedAt = 0) {
  return withStorageLock(async () => {
    const folderId = folder.uid;
    const keys = ['collections_index', `folder_${folderId}`, 'folders_index', SHARED_EVENTS_KEY];
    const got = await browser.storage.local.get(keys);
    const index = { ...(got.collections_index || {}) };
    const updates = {};
    const removals = [];
    const events = [];
    const appliedUids = new Set();
    const deferredRemotes = new Map();
    const normalizedMyEmail = (myEmail || '').toLowerCase();

    // Compute sanitized folder name once, use everywhere (folder record, index, events)
    const localFolder = got[`folder_${folderId}`] || folder;
    const safeFolderName = String(delta.folder.name ?? localFolder.name).slice(0, 200) || localFolder.name;

    for (const row of delta.collections || []) {
      const isOther = Boolean(row.updatedBy) && row.updatedBy.toLowerCase() !== normalizedMyEmail;
      // I3 fix: is THIS uid's local copy an unsynced edit made before this
      // cycle's pull started? Same formula the push phase's own dirty diff
      // uses (see doSyncSharedFolders) — deliberately NOT gated on
      // pendingLocalRemovals here (a pending-removed uid is handled by its
      // own dedicated check below/above, same as before this fix).
      const isLocallyDirty = ((preCycleIndex[row.uid] && preCycleIndex[row.uid].lastUpdated) || 0) > lastSyncedAt;
      if (row.deleted) {
        if (index[row.uid]) {
          if (isLocallyDirty) {
            // I3 fix: a remote deletion raced a local dirty edit — defer
            // rather than silently destroying the unsynced edit. Applies to
            // own-authored tombstones too (same-account multi-device fix):
            // a device-A deletion must race a device-B dirty edit fairly.
            // This device's OWN deletion can't reach here — the uid is gone
            // from the local index already, so index[row.uid] is falsy. See
            // the header comment above applyDeltaLocally.
            deferredRemotes.set(row.uid, row);
            continue;
          }
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
      } else {
        // B4 fix: this uid was already removed from this folder locally
        // (deleted, or moved to a different parent) before this cycle's pull
        // ran — do not resurrect it, whoever authored the incoming row. See
        // the pendingLocalRemovals doc comment above applyDeltaLocally.
        if (pendingLocalRemovals.has(row.uid)) continue;
        if (isLocallyDirty) {
          // I3 fix: don't overwrite a locally-dirty (unsynced) edit — defer
          // the remote row for the push phase to resolve fairly. Applies to
          // own-authored rows too (same-account multi-device fix). See the
          // header comment above applyDeltaLocally for the full reasoning.
          deferredRemotes.set(row.uid, row);
          continue;
        }
        const record = { ...sanitizeRemoteCollection(row.data), uid: row.uid, parentId: folderId, lastUpdated: row.updatedAt };
        updates[`collection_${row.uid}`] = record;
        // Order-consistency: loadAllCollections treats the INDEX entry's
        // `order` as authoritative (an index entry without one strips the
        // record's own order at load time), so a synced order only renders
        // if it is mirrored here too.
        index[row.uid] = {
          uid: row.uid, name: record.name, parentId: folderId, lastUpdated: row.updatedAt,
          ...(record.order !== undefined && record.order !== null ? { order: record.order } : {}),
        };
        appliedUids.add(row.uid);
        // Timeline events stay others-only: the user doesn't need a toast
        // about a change they made themselves on another device.
        if (isOther) {
          events.push({
            folderId, folderName: safeFolderName, actorEmail: row.updatedBy,
            kind: 'updated', collectionName: record.name, at: row.updatedAt,
          });
        }
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
    return { appliedUids, deferredRemotes };
  });
}

// I3 fix: called from the push phase when a uid that had a `deferredRemotes`
// entry comes back 409 — the local dirty edit lost the fair race against the
// remote row applyDeltaLocally chose not to apply. Applies that deferred
// remote row (upsert or deletion) locally now, and records a 'conflict'
// timeline event (distinct from 'updated'/'deleted', which are for changes
// the local device was never fighting over) so the user is told their change
// was replaced. Locked, like every other aggregate-key mutation in this file.
async function applyDeferredRemoteConflict(folder, deferredRow) {
  return withStorageLock(async () => {
    const folderId = folder.uid;
    const uid = deferredRow.uid;
    const keys = ['collections_index', `folder_${folderId}`, `collection_${uid}`, SHARED_EVENTS_KEY];
    const got = await browser.storage.local.get(keys);
    const index = { ...(got.collections_index || {}) };
    const localFolder = got[`folder_${folderId}`] || folder;
    const localRecord = got[`collection_${uid}`];
    const updates = {};
    const removals = [];

    // collectionName for the toast: the local (about-to-be-replaced) name if
    // we have one, else — for an upsert — the incoming remote name.
    let collectionName = localRecord?.name ?? null;
    if (deferredRow.deleted) {
      if (index[uid]) {
        delete index[uid];
        removals.push(`collection_${uid}`);
      }
    } else {
      const record = { ...sanitizeRemoteCollection(deferredRow.data), uid, parentId: folderId, lastUpdated: deferredRow.updatedAt };
      updates[`collection_${uid}`] = record;
      // Mirror `order` into the index — see applyDeltaLocally's upsert.
      index[uid] = {
        uid, name: record.name, parentId: folderId, lastUpdated: deferredRow.updatedAt,
        ...(record.order !== undefined && record.order !== null ? { order: record.order } : {}),
      };
      collectionName = collectionName ?? record.name;
    }
    updates.collections_index = index;

    const existingEvents = got[SHARED_EVENTS_KEY] || [];
    updates[SHARED_EVENTS_KEY] = [...existingEvents, {
      folderId, folderName: localFolder.name, actorEmail: deferredRow.updatedBy,
      kind: 'conflict', collectionName, at: deferredRow.updatedAt,
    }].slice(-20);

    await browser.storage.local.set(updates);
    if (removals.length) await browser.storage.local.remove(removals);
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
          // `notifications` is an optional permission — the namespace itself is
          // undefined until the user grants it (and the SW restarts), so check
          // availability explicitly. The in-app banner is the guaranteed path.
          if (browser.notifications?.create) {
            await browser.notifications.create(`shared-invite-${inv.folderId}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'Tabox — shared folder invite',
              message: `${inv.ownerEmail} wants to share the folder "${inv.folderName}" with you`,
            });
          }
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
// storage.local.set. A local collection still parented to this folder whose
// uid is NOT in the fresh server set is re-homed to the root rather than
// removed (see the F2 comment in the body — it may be the user's local-only
// data). The whole record is
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

    // F2 data-loss fix: a local collection still parented to this folder whose uid
    // the server does NOT know is not ours to destroy — it can be the user's own
    // local-only addition made while the folder was temporarily plain-local
    // (member revoked then re-invited, or a transient Worker 403/404 on a pull
    // unmarking the folder before the next cycle rematerializes it). Re-home it to
    // the root (parentId: null — the exact convention overwriteBackupSelection in
    // chrome/background.js uses to "never orphan or destroy user data") instead of
    // removing it. Uids the server DOES know are still wholesale-overwritten with
    // server content below. Legitimate server-side deletions are handled by
    // applyDeltaLocally's tombstones, never by this materialization path. The
    // re-homed record's lastUpdated is bumped so Drive sync treats it as dirty and
    // uploads it; with parentId now null it is naturally outside
    // excludeSharedFromSyncData's shared-collection partition.
    const rehomeUids = Object.keys(cIndex).filter(
      (uid) => cIndex[uid].parentId === folderId && !freshCollectionUids.has(uid)
    );
    if (rehomeUids.length) {
      const rehomeGot = await browser.storage.local.get(rehomeUids.map((uid) => `collection_${uid}`));
      for (const uid of rehomeUids) {
        const record = rehomeGot[`collection_${uid}`];
        if (!record) {
          // Index entry with no backing record — nothing to preserve.
          delete cIndex[uid];
          removals.push(`collection_${uid}`);
          continue;
        }
        updates[`collection_${uid}`] = { ...record, parentId: null, lastUpdated: now };
        cIndex[uid] = { ...cIndex[uid], parentId: null, lastUpdated: now };
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
      // Mirror `order` into the index — see applyDeltaLocally's upsert.
      cIndex[c.uid] = {
        uid: c.uid, name: record.name, parentId: folderId, lastUpdated: now,
        ...(record.order !== undefined && record.order !== null ? { order: record.order } : {}),
      };
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
// resync, not a delta, so none of applyDeltaLocally's per-row guards apply
// here). A folder already present with a live marker is left
// completely untouched (the normal loop below already syncs it) — no extra
// network call for it. Failure of the list call itself is skipped silently;
// the next 5-minute cycle retries. A per-folder delta-fetch failure only
// skips THAT folder, same reasoning.
// Returns the raw `/shared/folders` list response's `folders` array on success
// (also reused by doSyncSharedFolders' revision short-circuit, below — one
// network call serves both purposes), or `null` if the list call itself
// failed (network/auth error: skip silently, next cycle retries; the caller's
// short-circuit falls back to the old always-fetch-the-delta behavior for
// every folder this cycle when this returns null).
async function rematerializeMissingSharedFolders() {
  const listRes = await sharedApiFetch('/shared/folders');
  if (!listRes.ok) return null; // network/auth error: skip silently, next cycle retries

  const { folders_index: localIndex = {} } = await browser.storage.local.get('folders_index');
  const listedFolders = listRes.data.folders || [];

  for (const entry of listedFolders) {
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
      // Same delta endpoint as the normal sync loop — seed the activity
      // watermark too (0 when the server predates the field).
      lastActivityId: typeof deltaRes.data.lastActivityId === 'number' ? deltaRes.data.lastActivityId : 0,
    });
  }

  return listedFolders;
}

// Perf (revision short-circuit): refreshes a locally-shared folder's cached
// role/members from a `/shared/folders` LIST-response entry, but only writes
// when either actually differs from what's stored locally. Called exclusively
// from doSyncSharedFolders' short-circuit branch — when the listed revision
// matches our watermark, the per-folder delta GET (whose response is the
// normal source of a role/members refresh, via applyDeltaLocally) is skipped
// entirely this cycle, so this is the only path a role/member change could
// reach local storage through while short-circuited. In practice
// updateMemberRole/removeMember/inviteMember all bump the folder's revision
// (see server/src/sharedFolders.js), so a real role/member change should also
// change `revision` and take the normal delta path instead — this exists as a
// defensive fallback for that invariant, not a commonly-hit path. Deliberately
// does not append a timeline event or touch SHARED_SYNC_STATE_KEY — a
// role/member sync isn't a "change" the user needs toasted at them, mirroring
// materializeSharedFolderLocally's reasoning.
async function refreshFolderMarkerFromList(folderId, listedEntry) {
  return withStorageLock(async () => {
    const key = `folder_${folderId}`;
    const got = await browser.storage.local.get([key, 'folders_index']);
    const record = got[key];
    if (!record || !record.shared) return;
    const roleChanged = record.shared.role !== listedEntry.role;
    const membersChanged = JSON.stringify(record.shared.members || []) !== JSON.stringify(listedEntry.members || []);
    if (!roleChanged && !membersChanged) return;
    const shared = { ...record.shared, role: listedEntry.role, members: listedEntry.members };
    const index = got.folders_index || {};
    if (index[folderId]) index[folderId] = { ...index[folderId], shared };
    await browser.storage.local.set({ [key]: { ...record, shared }, folders_index: index });
  });
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
  // Perf (revision short-circuit): the SAME `/shared/folders` list call
  // rematerializeMissingSharedFolders already makes also tells us, for every
  // folder we DO have locally, the server's current revision — reuse it below
  // so a folder whose listed revision matches our watermark can skip its
  // per-folder delta GET entirely this cycle. `null` (list call itself
  // failed) means every folder falls back to the old always-fetch-the-delta
  // behavior for this cycle; see the loop below.
  let listByFolderId = null;
  try {
    const listedFolders = await rematerializeMissingSharedFolders();
    if (listedFolders) listByFolderId = new Map(listedFolders.map((f) => [f.folderId, f]));
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

    // B4 fix: uids this device already removed from this folder — deleted, or
    // moved to a different parent — BEFORE this cycle's pull runs, computed
    // from the SAME pre-pull snapshot the dirty-edit diff above already uses
    // (preCycleIndex), not the post-pull collections_index. A uid only lands
    // here if it was previously known to be part of this folder (knownUids)
    // and is no longer there pre-pull. Passed into applyDeltaLocally so an
    // incoming upsert for it (e.g. another member's edit) doesn't resurrect
    // it, and reused below for goneUids so the local removal still gets
    // pushed as a real DELETE this same cycle — see applyDeltaLocally's doc
    // comment for the full reasoning and the interaction this fixes.
    const pendingLocalRemovals = new Set(
      state.knownUids.filter((uid) => !(preCycleIndex[uid] && preCycleIndex[uid].parentId === folderId))
    );

    // Revision short-circuit: the list call captured above already told us
    // this folder's CURRENT server revision. If it matches our watermark
    // exactly, nothing has changed for this folder since our last successful
    // cycle — skip the per-folder delta GET entirely (this is what makes
    // fast/frequent polling cheap). A folder absent from the list (the query
    // only returns folders we still have access to — i.e. revoked/deleted)
    // falls through to the normal delta fetch below, which 404s and converts
    // it exactly as before this optimization existed.
    const listedEntry = listByFolderId ? listByFolderId.get(folderId) : undefined;
    const canShortCircuit = Boolean(listedEntry) && listedEntry.revision === state.lastRev;

    let role;
    let lastRev = state.lastRev;
    // Activity & comments (2026-07-21 design): the delta response now carries
    // lastActivityId (max shared_activity.id for the folder). Persist it into
    // this folder's shared_sync_state entry so the UI can diff it against its
    // own shared_activity_seen map for the unread dot. Additive only: a
    // response without the field (older server) leaves the stored value
    // unchanged; a folder that never had one reads as 0.
    let lastActivityId = state.lastActivityId || 0;
    let appliedUids = new Set();
    let deferredRemotes = new Map();

    if (canShortCircuit) {
      role = listedEntry.role;
      try {
        await refreshFolderMarkerFromList(folderId, listedEntry);
      } catch (error) {
        console.error('Error refreshing shared folder marker from list:', error);
      }
    } else {
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
      // I3 fix: applyDeltaLocally now also returns `deferredRemotes` — uids
      // whose local copy was DIRTY (an unsynced edit made before this cycle's
      // pull) when a same-uid remote row arrived. Those rows were deliberately
      // NOT applied to local storage; the push phase below races them fairly
      // instead (see applyDeltaLocally's header comment for the full design).
      ({ appliedUids, deferredRemotes } = await applyDeltaLocally(folder, pull.data, myEmail, pendingLocalRemovals, preCycleIndex, state.lastSyncedAt));
      pulled += (pull.data.collections || []).length;
      lastRev = pull.data.revision;
      role = pull.data.role;
      if (typeof pull.data.lastActivityId === 'number') lastActivityId = pull.data.lastActivityId;
    }

    // PUSH (write/owner only — read-role members never write back)
    if (role !== 'read') {
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
        // I3 fix: a uid with a deferred remote races fairly against the
        // PRE-pull revision watermark (state.lastRev), not the just-pulled
        // `lastRev` — the deferred row is, by construction, newer than
        // state.lastRev (that's why it showed up in this cycle's delta at
        // all), so this correctly 409s unless our own write somehow still
        // lands first (a genuinely simultaneous cross-device race — neither
        // side's pull would have seen the other's row yet, so neither would
        // have a deferred remote in that case; see the M3 test scenario). A
        // plain dirty uid with no deferred remote keeps using the current
        // (post-pull, possibly already-advanced-by-this-loop) `lastRev`,
        // unchanged from before this fix.
        const deferred = deferredRemotes.get(uid);
        const baseRevForPush = deferred ? state.lastRev : lastRev;
        const r = await sharedApiFetch(`/shared/folders/${folderId}/collections/${uid}`, {
          method: 'PUT', body: { data, baseRev: baseRevForPush },
        });
        if (r.ok) {
          lastRev = r.data.revision;
          pushed += 1;
        } else if (r.status === 409 && deferred) {
          // I3 fix: the local edit LOST the fair race — apply the deferred
          // remote (upsert or deletion) locally now and record a 'conflict'
          // event so the user is told their change was replaced.
          await applyDeferredRemoteConflict(folder, deferred);
        }
        // 409 (conflict) with no deferred remote: the server has a newer
        // revision for this collection than our baseRev — skip it silently.
        // The next cycle's pull reconciles (or, if our local edit is still
        // newer after that, we simply re-push it then). Never throw: one
        // folder's conflict must not abort the rest of the loop.
      }
      // B4 fix: goneUids is now diffed against the PRE-pull snapshot
      // (pendingLocalRemovals, computed above from preCycleIndex) rather than
      // the post-pull collections_index (`currentUids`). Before this fix, a
      // uid this device deleted/moved-out locally could get silently
      // resurrected by this very cycle's pull (another member's edit landing
      // for the same uid), which made the post-pull collections_index look
      // "still present" — so the DELETE below was never even attempted, and
      // (knownUids being rewritten to the post-revert state further down)
      // never retried on a later cycle either. pendingLocalRemovals is
      // already restricted to state.knownUids, so no separate `.includes`
      // check is needed here. Same echo-push exclusion as before applies: a
      // uid the pull itself deleted server-side (appliedUids) is already
      // reflected server-side — don't issue a redundant DELETE for it.
      const goneUids = [...pendingLocalRemovals].filter((u) => !appliedUids.has(u));
      for (const uid of goneUids) {
        // B5: pass this device's current knowledge of the folder's revision
        // counter as baseRev, opting into deleteCollection's conflict check —
        // a row someone else updated more recently than what we've seen
        // (row.rev > baseRev) 409s instead of unconditionally destroying it.
        const r = await sharedApiFetch(`/shared/folders/${folderId}/collections/${uid}?baseRev=${lastRev}`, { method: 'DELETE' });
        if (r.ok) {
          lastRev = r.data.revision;
          pushed += 1;
        }
        // 409 (conflict): someone updated this collection more recently than
        // our baseRev — skip, do NOT retry. The next cycle's pull will bring
        // the fresher row back (its rev is now > our stale lastRev, so it's
        // included in the delta and, since this uid is no longer in
        // knownUids after this cycle's setFolderSyncState call below, it's no
        // longer a "pending local removal" either — applyDeltaLocally applies
        // it as a normal upsert). Never throw: one conflict must not abort
        // the rest of the loop.
      }
      // I3 fix: re-read collections_index fresh here rather than reusing the
      // `currentUids` snapshot captured before this push loop ran — a 409'd
      // deferred-remote DELETE conflict (applyDeferredRemoteConflict, above)
      // can remove a uid from local storage mid-loop, and knownUids must
      // reflect that or the next cycle's pendingLocalRemovals computation
      // would wrongly treat an already-server-deleted uid as a fresh local
      // removal to push again.
      const { collections_index: postPushIndex = {} } = await browser.storage.local.get('collections_index');
      const finalKnownUids = Object.keys(postPushIndex).filter((uid) => postPushIndex[uid].parentId === folderId);
      await setFolderSyncState(folderId, { lastRev, lastSyncedAt: cycleStartTs, knownUids: finalKnownUids, lastActivityId });
    } else {
      await setFolderSyncState(folderId, { lastRev, lastSyncedAt: cycleStartTs, knownUids: state.knownUids, lastActivityId });
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

// Public (unauthenticated) share-link metadata fetch — /links/:token needs no
// Google token, so this deliberately bypasses sharedApiFetch's auth gate.
async function publicLinkFetch(token) {
  try {
    const res = await fetch(`${SHARED_API_BASE}/links/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, status: res.status, data }
      : { ok: false, status: res.status, error: data.error || 'request_failed' };
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
}

// Import a collection-link snapshot as a plain LOCAL collection. Always a
// FRESH uid: the same link can be redeemed repeatedly (and the sharer's own
// uid must never be reused), so each redeem is an independent copy. Loose
// collection on purpose — parentId is stripped by sanitizeRemoteCollection's
// whitelist. Mirrors materializeSharedFolderLocally's index bookkeeping.
async function addLocalCollectionFromSnapshot(info) {
  return withStorageLock(async () => {
    // Same guarded generator as background-utils' generateUid (crypto.randomUUID
    // is missing in some test environments).
    const uid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const now = Date.now();
    const { collections_index: got = {} } = await browser.storage.local.get('collections_index');
    const cIndex = { ...got };
    const record = { ...sanitizeRemoteCollection(info.data), uid, createdOn: now, lastUpdated: now };
    cIndex[uid] = { uid, name: record.name, parentId: null, lastUpdated: now };
    await browser.storage.local.set({ [`collection_${uid}`]: record, collections_index: cIndex });
    return record.name;
  });
}

// Entry point for the join page's externally_connectable message
// ({ type: 'taboxShareLink', token }). Resolves the token publicly first (so
// we never trust the page's own claims about what the token is), then either
// imports the snapshot or joins the folder. A signed-out folder join stashes
// a pending join for the popup to offer after sign-in.
async function handleShareLinkRedeem(token) {
  if (typeof token !== 'string' || !token) return { ok: false, status: 'invalid', error: 'invalid_request' };
  const info = await publicLinkFetch(token);
  if (!info.ok) {
    return { ok: false, status: info.status === 404 ? 'invalid' : 'error', error: info.error };
  }
  if (info.data.kind === 'collection') {
    const name = await addLocalCollectionFromSnapshot(info.data);
    return { ok: true, status: 'added', name };
  }
  // kind === 'folder'
  const joined = await sharedApiFetch('/shared/join-link', { method: 'POST', body: { token } });
  if (!joined.ok && joined.error === 'not_signed_in') {
    await browser.storage.local.set({
      [SHARED_PENDING_LINK_JOIN_KEY]: {
        token, name: info.data.name, ownerEmail: info.data.ownerEmail, role: info.data.role, stashedAt: Date.now(),
      },
    });
    return { ok: false, status: 'sign_in_required', name: info.data.name };
  }
  if (!joined.ok) return { ok: false, status: 'error', error: joined.error };
  const { folder, collections } = joined.data;
  const now = Date.now();
  await materializeSharedFolderLocally({
    folderId: folder.folderId, name: folder.name, color: folder.color, role: folder.role,
    ownerEmail: folder.ownerEmail, members: folder.members, collections, now,
  });
  await setFolderSyncState(folder.folderId, {
    lastRev: folder.revision, lastSyncedAt: now, knownUids: collections.map((c) => c.uid),
  });
  await browser.storage.local.remove(SHARED_PENDING_LINK_JOIN_KEY);
  if (typeof ensureSharedSyncAlarm === 'function') await ensureSharedSyncAlarm();
  // role/roleDowngraded let the join page tell a free user why a "can edit"
  // link landed them in view-only (server caps non-Pro joiners at 'read').
  return {
    ok: true, status: 'joined', name: folder.name, role: folder.role,
    roleDowngraded: joined.data.roleDowngraded === true,
  };
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
      // NOTE: we deliberately do NOT advance lastRev to the PATCH response's
      // revision. PATCH has no baseRev conflict semantics, so bumping lastRev
      // here would silently skip any collection rows other members wrote in the
      // window before this rename, excluding them from all future sinceRev deltas.
      // The next unconditional folder-meta refresh (during the normal pull cycle)
      // harmlessly re-fetches this own meta change; rename events only fire for
      // changes by other authors anyway.
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
    case 'sharedGetFolderLink':
      return sharedApiFetch(`/shared/folders/${request.folderId}/link`);
    case 'sharedCreateFolderLink':
      return sharedApiFetch(`/shared/folders/${request.folderId}/link`, {
        method: 'POST', body: { role: request.role, ...(request.rotate ? { rotate: true } : {}) },
      });
    case 'sharedDeleteFolderLink':
      return sharedApiFetch(`/shared/folders/${request.folderId}/link`, { method: 'DELETE' });
    case 'sharedCreateCollectionLink':
      return sharedApiFetch('/shared/collection-link', {
        method: 'PUT', body: { uid: request.uid, name: request.name, data: request.data },
      });
    case 'sharedGetCollectionLinks':
      return sharedApiFetch('/shared/collection-links');
    case 'sharedDeleteCollectionLink':
      return sharedApiFetch(`/shared/collection-link/${encodeURIComponent(request.uid)}`, { method: 'DELETE' });
    case 'sharedJoinLink':
      // handleShareLinkRedeem clears SHARED_PENDING_LINK_JOIN_KEY on success.
      return handleShareLinkRedeem(request.token);
    // Activity & comments (2026-07-21 design): thin wrappers over sharedApiFetch,
    // returning its envelope UNCHANGED so server errors (pro_required, thread_full,
    // 404 on revoked access, ...) flow through to the UI exactly like every other
    // handler in this switch. Query params are appended only when present;
    // everything interpolated into a path/query is encodeURIComponent'd.
    case 'sharedGetActivity': {
      const params = new URLSearchParams();
      if (request.beforeId !== undefined && request.beforeId !== null) params.set('beforeId', request.beforeId);
      if (request.limit !== undefined && request.limit !== null) params.set('limit', request.limit);
      const qs = params.toString();
      return sharedApiFetch(`/shared/folders/${encodeURIComponent(request.folderId)}/activity${qs ? `?${qs}` : ''}`);
    }
    case 'sharedGetComments': {
      const params = new URLSearchParams();
      if (typeof request.collectionUid === 'string' && request.collectionUid) params.set('collectionUid', request.collectionUid);
      if (request.beforeId !== undefined && request.beforeId !== null) params.set('beforeId', request.beforeId);
      if (request.limit !== undefined && request.limit !== null) params.set('limit', request.limit);
      const qs = params.toString();
      return sharedApiFetch(`/shared/folders/${encodeURIComponent(request.folderId)}/comments${qs ? `?${qs}` : ''}`);
    }
    case 'sharedPostComment': {
      const body = { body: request.body };
      if (typeof request.collectionUid === 'string' && request.collectionUid) body.collectionUid = request.collectionUid;
      return sharedApiFetch(`/shared/folders/${encodeURIComponent(request.folderId)}/comments`, { method: 'POST', body });
    }
    case 'sharedDeleteComment':
      return sharedApiFetch(
        `/shared/folders/${encodeURIComponent(request.folderId)}/comments/${encodeURIComponent(request.commentId)}`,
        { method: 'DELETE' }
      );
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
  SHARED_PENDING_LINK_JOIN_KEY,
  handleShareLinkRedeem,
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
