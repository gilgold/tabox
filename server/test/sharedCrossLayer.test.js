// Cross-layer, multi-device conflict-resolution harness for Shared Folders.
//
// Unlike server/test/sharedFolders.*.test.js (server routes only) and
// tests/sharedFoldersClient.test.js (client only, network mocked), this file
// drives the REAL client engine (chrome/shared-folders.js) against the REAL
// worker (server/src/index.js) and REAL D1-mock schema, simulating multiple
// independent devices polling a shared folder and racing each other's edits.
// See server/test/helpers/sharedFoldersHarness.js for the harness design and
// why vitest + createRequire + require-cache injection was used.
//
// Every scenario below is run "sequentially" — each device's sync/action is
// fully awaited before the next device's turn starts — mirroring the real
// polling protocol (nothing here is truly concurrent within one process).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import { createHarness, makeDevice } from './helpers/sharedFoldersHarness.js';

const PRO_RECORD = { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' };

function tab(url, title) {
  return { url, title };
}

describe('shared folders: cross-layer multi-device conflict harness', () => {
  let db;
  let harness;
  let ownerA;
  let memberB;

  // A fully-controlled clock: every meaningful step (a local edit, a sync
  // cycle) explicitly advances it by a full second via advanceTime() below,
  // so the source's own Date.now() calls (cycleStartTs, lastSyncedAt,
  // lastUpdated, server updated_at/created_at) and the timestamps we stamp
  // onto local edits always land in a deterministic, strictly-increasing
  // order — real wall-clock Date.now() calls a few lines apart in a
  // synchronous test can otherwise collide on the same millisecond and break
  // the `lastUpdated > lastSyncedAt` dirty-diff the client relies on.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  function advanceTime(ms = 1000) {
    vi.advanceTimersByTime(ms);
  }

  beforeEach(async () => {
    db = makeDB();
    ownerA = makeDevice({ label: 'A', googleId: 'g-owner', email: 'owner@x.com', token: 't-owner' });
    memberB = makeDevice({ label: 'B', googleId: 'g-guest', email: 'guest@x.com', token: 't-guest' });
    harness = createHarness({
      db,
      kvStore: { 'ent:g-owner': PRO_RECORD },
      identities: {
        't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
        't-owner-a2': { googleId: 'g-owner', email: 'owner@x.com' },
        't-guest': { googleId: 'g-guest', email: 'guest@x.com' },
        't-reader': { googleId: 'g-reader', email: 'reader@x.com' },
        't-c3': { googleId: 'g-c3', email: 'c3@x.com' },
      },
    });
  });

  // Shared fixture: A shares folder F1 (two collections, c1/c2) with B
  // (write role); B accepts. Used as the common starting point for most
  // scenarios below.
  async function shareAndAccept({ folderId = 'F1', role = 'write' } = {}) {
    const now = Date.now();
    Object.assign(ownerA.browserMock._store, {
      folders_index: { [folderId]: { uid: folderId, name: 'Team', type: 'folder' } },
      [`folder_${folderId}`]: {
        uid: folderId, name: 'Team', type: 'folder', color: '#f00', collapsed: false, order: 1,
        createdOn: now, lastUpdated: now,
      },
      collections_index: {
        c1: { uid: 'c1', name: 'Alpha', parentId: folderId, lastUpdated: now },
        c2: { uid: 'c2', name: 'Beta', parentId: folderId, lastUpdated: now },
      },
      collection_c1: { uid: 'c1', name: 'Alpha', parentId: folderId, lastUpdated: now, tabs: [tab('https://a.example', 'A')] },
      collection_c2: { uid: 'c2', name: 'Beta', parentId: folderId, lastUpdated: now, tabs: [tab('https://b.example', 'B')] },
    });

    const created = await harness.asDevice(ownerA, (c) => c.handleSharedMessage({
      type: 'sharedCreateShare',
      folder: { uid: folderId, name: 'Team', color: '#f00' },
      collections: [
        { uid: 'c1', data: { name: 'Alpha', tabs: [tab('https://a.example', 'A')] } },
        { uid: 'c2', data: { name: 'Beta', tabs: [tab('https://b.example', 'B')] } },
      ],
      invites: [{ email: memberB.email, role }],
    }));
    expect(created.ok).toBe(true);

    const invites = await harness.asDevice(memberB, (c) => c.pollInvites());
    expect(invites.data.invites).toHaveLength(1);

    const accepted = await harness.asDevice(memberB, (c) => c.handleSharedMessage({
      type: 'sharedRespondInvite', folderId, accept: true,
    }));
    expect(accepted.ok).toBe(true);

    return { folderId };
  }

  function editCollection(device, uid, patch) {
    advanceTime();
    const at = Date.now();
    const key = `collection_${uid}`;
    const rec = device.browserMock._store[key];
    device.browserMock._store[key] = { ...rec, ...patch, lastUpdated: at };
    const idx = device.browserMock._store.collections_index || {};
    idx[uid] = { ...idx[uid], ...patch, lastUpdated: at };
    device.browserMock._store.collections_index = idx;
  }

  function deleteCollectionLocally(device, uid) {
    advanceTime();
    delete device.browserMock._store[`collection_${uid}`];
    const idx = { ...(device.browserMock._store.collections_index || {}) };
    delete idx[uid];
    device.browserMock._store.collections_index = idx;
  }

  function moveCollectionOut(device, uid, newParentId = 'ROOT') {
    editCollection(device, uid, { parentId: newParentId });
  }

  // Every sync gets its own tick, guaranteeing a sync cycle's `cycleStartTs`
  // (and the `lastSyncedAt` watermark it becomes) is always strictly after
  // any edit that preceded it, and strictly before any edit that follows.
  async function syncDevice(device) {
    advanceTime();
    return harness.asDevice(device, (c) => c.syncSharedFolders());
  }

  function rawFolder(folderId) {
    return db._raw.prepare('SELECT * FROM shared_folders WHERE id = ?').get(folderId);
  }
  function rawCollection(folderId, uid) {
    return db._raw.prepare('SELECT * FROM shared_collections WHERE folder_id = ? AND uid = ?').get(folderId, uid);
  }
  function rawMembers(folderId) {
    return db._raw.prepare('SELECT * FROM shared_members WHERE folder_id = ?').all(folderId);
  }

  // ---------------------------------------------------------------------
  // 1. Disjoint edits converge, no echo-PUTs, correct attribution.
  // ---------------------------------------------------------------------
  it('1. disjoint edits on different collections converge with no echo-PUTs', async () => {
    const { folderId } = await shareAndAccept();

    editCollection(ownerA, 'c1', { name: 'Alpha (A edit)' });
    editCollection(memberB, 'c2', { name: 'Beta (B edit)' });

    const syncA1 = await syncDevice(ownerA);
    expect(syncA1.data.pushed).toBe(1);

    const syncB1 = await syncDevice(memberB);
    expect(syncB1.data.pulled).toBeGreaterThanOrEqual(1); // pulled A's c1
    expect(syncB1.data.pushed).toBe(1); // pushed own c2

    const syncA2 = await syncDevice(ownerA);
    expect(syncA2.data.pushed).toBe(0); // nothing new to push — no echo

    // Convergence: both devices agree on both collections' content.
    expect(ownerA.browserMock._store.collection_c1.name).toBe('Alpha (A edit)');
    expect(ownerA.browserMock._store.collection_c2.name).toBe('Beta (B edit)');
    expect(memberB.browserMock._store.collection_c1.name).toBe('Alpha (A edit)');
    expect(memberB.browserMock._store.collection_c2.name).toBe('Beta (B edit)');

    // Server attribution.
    expect(rawCollection(folderId, 'c1').updated_by).toBe('owner@x.com');
    expect(rawCollection(folderId, 'c2').updated_by).toBe('guest@x.com');

    // No echo-PUTs: c1 was PUT exactly once (by A); c2 exactly once (by B).
    expect(harness.putCollectionCalls('c1')).toHaveLength(1);
    expect(harness.putCollectionCalls('c1')[0].device).toBe('A');
    expect(harness.putCollectionCalls('c2')).toHaveLength(1);
    expect(harness.putCollectionCalls('c2')[0].device).toBe('B');
  });

  // ---------------------------------------------------------------------
  // 2. Same-collection conflict: 409 stale baseRev, documented LWW, no
  //    revision runaway.
  // ---------------------------------------------------------------------
  it('2. same-collection conflicting edits (I3 fix): B wins the fair race; A\'s dirty edit is deferred, 409s, and A gets a conflict event instead of a silent overwrite', async () => {
    const { folderId } = await shareAndAccept();

    editCollection(ownerA, 'c1', { name: 'A version' });
    editCollection(memberB, 'c1', { name: 'B version' });

    // B syncs first: pushes c1 successfully.
    const syncB1 = await syncDevice(memberB);
    expect(syncB1.data.pushed).toBe(1);
    expect(rawCollection(folderId, 'c1').data).toContain('B version');
    const revAfterB = rawFolder(folderId).revision;

    // A syncs: pull first. A's own c1 copy is locally DIRTY (an unsynced edit
    // made before this cycle's pull, per the preCycleIndex/lastSyncedAt
    // watermark) — applyDeltaLocally (I3 fix) does NOT overwrite it; it
    // stashes B's row as a deferred remote instead and does not mark c1 as
    // "applied" this cycle, so A's edit is still sitting in local storage.
    const syncA1 = await syncDevice(ownerA);
    expect(syncA1.data.pulled).toBeGreaterThanOrEqual(1);

    // A's push phase still considers c1 dirty (deferred, not applied) and
    // attempts a real PUT — racing fairly against the PRE-pull revision
    // watermark, which is stale relative to B's already-landed write, so it
    // 409s. Unlike the old silent-overwrite behavior (where A never even
    // attempted a push), the attempt now genuinely happens and genuinely
    // loses.
    expect(syncA1.data.pushed).toBe(0);
    expect(harness.putCollectionCalls('c1')).toHaveLength(2); // B's success + A's 409'd attempt
    expect(harness.putCollectionCalls('c1')[1].device).toBe('A');

    // Revision must not have run away: exactly one bump (B's write) — A's
    // 409'd attempt never bumped anything server-side.
    expect(rawFolder(folderId).revision).toBe(revAfterB);

    // A lost the fair race: the deferred remote (B's version) is applied
    // locally now, and both devices converge on it.
    expect(ownerA.browserMock._store.collection_c1.name).toBe('B version');
    expect(memberB.browserMock._store.collection_c1.name).toBe('B version');
    expect(rawCollection(folderId, 'c1').data).toContain('B version');

    // A is NOT left in the dark (I3 fix): a 'conflict' timeline event records
    // whose change won and what A's own (replaced) collection was called.
    const aEvents = ownerA.browserMock._store.shared_folder_events || [];
    const conflictEvent = aEvents.find((e) => e.kind === 'conflict' && e.folderId === folderId);
    expect(conflictEvent).toBeDefined();
    expect(conflictEvent.actorEmail).toBe('guest@x.com');
    expect(conflictEvent.collectionName).toBe('A version'); // A's own (about-to-be-replaced) name

    // A further sync pushes nothing new — no runaway, no retry loop.
    const syncA2 = await syncDevice(ownerA);
    expect(syncA2.data.pushed).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 2b. A genuine 409: A's edit is pushed in the SAME cycle it pulls (edit
  //     made after the pre-cycle snapshot), racing a baseRev that's already
  //     stale by the time of the PUT.
  // ---------------------------------------------------------------------
  it('2b. a real stale-baseRev 409 is surfaced when both sides push in overlapping cycles', async () => {
    const { folderId } = await shareAndAccept();

    // Simulate A and B both having pushed once already (rev=2 known to both),
    // then both edit c1 concurrently without an intervening pull.
    await syncDevice(ownerA); // no-op baseline
    editCollection(ownerA, 'c1', { name: 'A racing' });
    editCollection(memberB, 'c1', { name: 'B racing' });

    // B pushes first via a raw client call (bypassing the pull phase) to
    // force the exact interleaving: manually drive sharedApiFetch so we can
    // inspect the raw 409 response A gets when its baseRev is stale.
    const bPush = await harness.asDevice(memberB, (c) => c.sharedApiFetch(
      `/shared/folders/${folderId}/collections/c1`,
      { method: 'PUT', body: { data: { name: 'B racing' }, baseRev: 1 } },
    ));
    expect(bPush.ok).toBe(true);

    const aPush = await harness.asDevice(ownerA, (c) => c.sharedApiFetch(
      `/shared/folders/${folderId}/collections/c1`,
      { method: 'PUT', body: { data: { name: 'A racing' }, baseRev: 1 } }, // stale baseRev
    ));
    expect(aPush.ok).toBe(false);
    expect(aPush.status).toBe(409);
    expect(aPush.error).toBe('conflict');

    // Converged state: B's write stands; A's is discarded server-side.
    expect(rawCollection(folderId, 'c1').data).toContain('B racing');
  });

  // ---------------------------------------------------------------------
  // 3. Delete-vs-edit.
  // ---------------------------------------------------------------------
  it('3a (I3 fix). A deletes X and syncs first; B has an unsynced edit to X: B\'s push 409s against the tombstone, the deletion is applied, and B gets a conflict event (not a silent \'deleted\')', async () => {
    const { folderId } = await shareAndAccept();

    deleteCollectionLocally(ownerA, 'c1');
    const syncA = await syncDevice(ownerA);
    expect(syncA.data.pushed).toBe(1); // the DELETE
    expect(rawCollection(folderId, 'c1').deleted).toBe(1);

    // B, unaware, made a local edit to c1 before this sync — c1 is locally
    // DIRTY for B, so the incoming tombstone is deferred rather than applied
    // immediately; B's push phase races it and 409s against the tombstone.
    editCollection(memberB, 'c1', { name: 'B late edit' });
    const syncB = await syncDevice(memberB);
    expect(syncB.data.pulled).toBeGreaterThanOrEqual(1);
    expect(syncB.data.pushed).toBe(0); // B's push attempt lost the race
    expect(harness.putCollectionCalls('c1').some((c) => c.device === 'B')).toBe(true);

    // Converged: no ghost row on either side.
    expect(ownerA.browserMock._store.collection_c1).toBeUndefined();
    expect(memberB.browserMock._store.collection_c1).toBeUndefined();
    expect(ownerA.browserMock._store.collections_index.c1).toBeUndefined();
    expect(memberB.browserMock._store.collections_index.c1).toBeUndefined();
    expect(rawCollection(folderId, 'c1').deleted).toBe(1);

    // I3 fix: B gets a 'conflict' event (its own dirty edit was actually in
    // the running and lost), not the plain 'deleted' event a bystander with
    // no local edit would get.
    const events = memberB.browserMock._store.shared_folder_events || [];
    const conflictEvent = events.find((e) => e.kind === 'conflict' && e.folderId === folderId);
    expect(conflictEvent).toBeDefined();
    expect(conflictEvent.actorEmail).toBe('owner@x.com');
    expect(conflictEvent.collectionName).toBe('B late edit'); // B's own (about-to-be-replaced) name
    expect(events.some((e) => e.kind === 'deleted')).toBe(false);
  });

  it('3b. deleteCollection with NO baseRev preserves the original unconditional delete-wins behavior (B5 compatibility path)', async () => {
    const { folderId } = await shareAndAccept();

    // B edits and syncs: c1 gets a real revision bump.
    editCollection(memberB, 'c1', { name: 'B fresh edit' });
    const syncB = await syncDevice(memberB);
    expect(syncB.data.pushed).toBe(1);
    const revAfterBEdit = rawCollection(folderId, 'c1').rev;

    // A, never having pulled B's edit, issues a raw DELETE directly with NO
    // baseRev query param (isolating the finding from the client's
    // pull-then-push cycle ordering, which has its own, separately-documented
    // same-cycle-revival issue — see 4b). B5 gave deleteCollection() an
    // OPTIONAL baseRev, mirroring putCollection's; a caller that omits it
    // (as here) deliberately keeps the original "delete always wins"
    // semantics for backward compatibility — see 3c below for the
    // conflict-protected path a baseRev-aware caller now gets.
    const del = await harness.asDevice(ownerA, (c) => c.sharedApiFetch(
      `/shared/folders/${folderId}/collections/c1`, { method: 'DELETE' },
    ));
    expect(del.ok).toBe(true); // succeeds unconditionally — no baseRev was sent, so no conflict check ran

    const finalRow = rawCollection(folderId, 'c1');
    expect(finalRow.deleted).toBe(1);
    expect(finalRow.rev).toBeGreaterThan(revAfterBEdit);

    // Both devices converge on "gone" on their next full sync — B's fresh
    // edit is destroyed with no signal that anything was clobbered.
    await syncDevice(ownerA);
    await syncDevice(memberB);
    expect(ownerA.browserMock._store.collection_c1).toBeUndefined();
    expect(memberB.browserMock._store.collection_c1).toBeUndefined();
  });

  it('3c (B5). a DELETE that DOES send a stale baseRev 409s instead of clobbering a fresher unseen edit; the fresh edit survives and reappears on both devices', async () => {
    const { folderId } = await shareAndAccept();

    // A edits X and syncs: a real revision bump, rev now known server-side.
    editCollection(ownerA, 'c1', { name: 'A fresh edit' });
    const syncA = await syncDevice(ownerA);
    expect(syncA.data.pushed).toBe(1);
    const revAfterAEdit = rawCollection(folderId, 'c1').rev;

    // B syncs once BEFORE A's edit lands, so B's baseline lastRev is stale
    // (captured via a raw delta fetch at rev 1, i.e. before A's push above —
    // simulating a device whose last real sync predates the other side's
    // edit). B then issues a raw DELETE with that stale baseRev, exactly
    // mirroring how doSyncSharedFolders' goneUids loop calls
    // `?baseRev=${lastRev}` — except here `lastRev` is deliberately stale
    // rather than post-pull-fresh, to force the genuine race this scenario
    // needs (see 4b for why a normal same-cycle pull already reconciles this
    // before the push phase runs, which would otherwise mask the conflict).
    const staleBaseRev = revAfterAEdit - 1;
    const del = await harness.asDevice(memberB, (c) => c.sharedApiFetch(
      `/shared/folders/${folderId}/collections/c1?baseRev=${staleBaseRev}`, { method: 'DELETE' },
    ));
    expect(del.ok).toBe(false);
    expect(del.status).toBe(409);
    expect(del.error).toBe('conflict');

    // A's edit survived the stale delete attempt entirely.
    const rowAfterConflict = rawCollection(folderId, 'c1');
    expect(rowAfterConflict.deleted).toBe(0);
    expect(rowAfterConflict.rev).toBe(revAfterAEdit);

    // Next cycles: both devices converge with A's edit alive (not B's
    // rejected delete).
    await syncDevice(ownerA);
    await syncDevice(memberB);
    expect(ownerA.browserMock._store.collection_c1.name).toBe('A fresh edit');
    expect(memberB.browserMock._store.collection_c1.name).toBe('A fresh edit');
  });

  // ---------------------------------------------------------------------
  // 4. Move-out-vs-edit.
  // ---------------------------------------------------------------------
  it('4a. B moves X out (delete-on-server) then syncs first; A edits X and syncs: A\'s edit is discarded, B keeps a local copy', async () => {
    const { folderId } = await shareAndAccept();

    moveCollectionOut(memberB, 'c1');
    const syncB = await syncDevice(memberB);
    expect(syncB.data.pushed).toBe(1); // goneUids DELETE for c1
    expect(rawCollection(folderId, 'c1').deleted).toBe(1);
    // B keeps its own local copy of c1 (just outside the shared folder).
    expect(memberB.browserMock._store.collection_c1).toBeDefined();
    expect(memberB.browserMock._store.collection_c1.parentId).toBe('ROOT');

    editCollection(ownerA, 'c1', { name: 'A edits moved-out collection' });
    const syncA = await syncDevice(ownerA);
    expect(syncA.data.pushed).toBe(0); // A's edit is never pushed

    // A's local copy of c1 is wiped entirely by the incoming tombstone
    // (deletions apply unconditionally regardless of isOther/local edits).
    expect(ownerA.browserMock._store.collection_c1).toBeUndefined();
  });

  it('4b. A edits X and syncs first (fresh write lands); B moves X out afterward: B\'s move-out intent survives the same-cycle pull (B4 fix)', async () => {
    const { folderId } = await shareAndAccept();

    editCollection(ownerA, 'c1', { name: 'A fresh edit' });
    const syncA = await syncDevice(ownerA);
    expect(syncA.data.pushed).toBe(1);

    // B has NOT pulled A's edit yet — B's own local copy of c1 still reads
    // whatever B had before (the original 'Alpha').
    expect(memberB.browserMock._store.collection_c1.name).toBe('Alpha');
    moveCollectionOut(memberB, 'c1');
    const syncB = await syncDevice(memberB);

    // FIX (B4): B's sync still pulls A's fresh c1 edit FIRST in the same
    // cycle, but applyDeltaLocally now recognizes c1 as a uid B already
    // removed from this folder (moved to a different parent) BEFORE this
    // cycle's pull ran — computed from the pre-pull collections_index
    // snapshot, the same one the dirty-edit diff already relies on — and
    // skips applying the incoming upsert for it entirely. B's local move-out
    // is therefore left completely untouched (never reverted), AND the push
    // phase's goneUids (diffed against that same pre-pull snapshot, not the
    // post-pull index) still correctly treats c1 as gone and issues the
    // DELETE this same cycle. Net effect: local move-out survives, the
    // server row is deleted, and B keeps its own moved-out copy of c1 (not
    // A's edit) locally.
    expect(syncB.data.pushed).toBe(1); // the DELETE for c1 fires
    expect(memberB.browserMock._store.collection_c1.parentId).toBe('ROOT'); // NOT reverted
    expect(memberB.browserMock._store.collection_c1.name).toBe('Alpha'); // B's own copy, not A's edit
    expect(rawCollection(folderId, 'c1').deleted).toBe(1); // server DOES see the delete

    // knownUids no longer includes c1 after this cycle — B's move-out is
    // fully resolved, not merely delayed, and won't be redundantly re-DELETEd
    // on a later cycle.
    const syncedState = memberB.browserMock._store.shared_sync_state;
    expect(syncedState[folderId].knownUids).not.toContain('c1');
  });

  // ---------------------------------------------------------------------
  // 5. Rename-during-edits (the N1 scenario).
  // ---------------------------------------------------------------------
  it('5. folder rename does not advance lastRev past a concurrently-pushed collection edit', async () => {
    const { folderId } = await shareAndAccept();

    // B pushes a collection edit first (bumps the folder's revision counter).
    editCollection(memberB, 'c1', { name: 'B edit before rename' });
    const syncB = await syncDevice(memberB);
    expect(syncB.data.pushed).toBe(1);
    const revAfterBEdit = rawFolder(folderId).revision;

    // A (unaware, hasn't pulled yet) renames the folder — this bumps the
    // revision AGAIN, past B's edit.
    const rename = await harness.asDevice(ownerA, (c) => c.handleSharedMessage({
      type: 'sharedUpdateFolderMeta', folderId, name: 'Team Renamed', color: '#0f0',
    }));
    expect(rename.ok).toBe(true);
    expect(rawFolder(folderId).revision).toBeGreaterThan(revAfterBEdit);

    // If A's client had (wrongly) advanced its local lastRev to the rename's
    // own PATCH response revision, A's next pull (sinceRev=thatRevision)
    // would permanently skip B's edit (its rev is LOWER than the rename's).
    // Confirm A's next pull still receives B's row.
    const syncA = await syncDevice(ownerA);
    expect(syncA.data.pulled).toBeGreaterThanOrEqual(1);
    expect(ownerA.browserMock._store.collection_c1.name).toBe('B edit before rename');

    // Folder name converges on both sides.
    expect(ownerA.browserMock._store.folder_F1.name).toBe('Team Renamed');
    const syncB2 = await syncDevice(memberB);
    void syncB2;
    expect(memberB.browserMock._store.folder_F1.name).toBe('Team Renamed');
  });

  // ---------------------------------------------------------------------
  // 6. Revocation mid-flight.
  // ---------------------------------------------------------------------
  it('6. revoking B mid-flight converts B\'s folder to local (data kept incl. unsynced edit); B never touches the server for it again; A unaffected', async () => {
    const { folderId } = await shareAndAccept();

    // B has an unsynced local edit at the moment of revocation.
    editCollection(memberB, 'c2', { name: 'B unsynced edit' });

    const removed = await harness.asDevice(ownerA, (c) => c.handleSharedMessage({
      type: 'sharedRemoveMember', folderId, email: memberB.email,
    }));
    expect(removed.ok).toBe(true);
    expect(rawMembers(folderId)).toHaveLength(0);

    const syncB1 = await syncDevice(memberB);
    expect(syncB1.data.revoked).toBe(1);

    // Folder converts to local: marker gone, data (incl. the unsynced edit) kept.
    expect(memberB.browserMock._store.folder_F1.shared).toBeUndefined();
    expect(memberB.browserMock._store.collection_c2.name).toBe('B unsynced edit');
    expect(memberB.browserMock._store.collection_c1).toBeDefined();
    const events = memberB.browserMock._store.shared_folder_events || [];
    expect(events.some((e) => e.kind === 'revoked')).toBe(true);

    // B's subsequent syncs never touch the server for this folder again
    // (loadLocalSharedFolders no longer finds a live `shared` marker on it).
    const fetchCountBefore = harness.fetchLog.filter((e) => e.device === 'B').length;
    await syncDevice(memberB);
    const folderCallsAfter = harness.fetchLog
      .filter((e) => e.device === 'B')
      .slice(fetchCountBefore)
      .filter((e) => e.pathname.includes(`/shared/folders/${folderId}`));
    expect(folderCallsAfter).toHaveLength(0);

    // A's data unaffected.
    expect(rawFolder(folderId)).toBeTruthy();
    expect(rawCollection(folderId, 'c1').deleted).toBe(0);
    expect(rawCollection(folderId, 'c2').deleted).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 7. Rematerialization on a second device with the same identity.
  // ---------------------------------------------------------------------
  it('7. a second device (A2, same identity as A, empty storage) rematerializes the folder incl. A\'s own-authored rows', async () => {
    await shareAndAccept();
    editCollection(ownerA, 'c1', { name: 'A owns this edit' });
    await syncDevice(ownerA);

    const ownerA2 = makeDevice({ label: 'A2', googleId: 'g-owner', email: 'owner@x.com', token: 't-owner-a2' });

    const sync = await syncDevice(ownerA2);
    void sync;

    expect(ownerA2.browserMock._store.folders_index.F1).toBeTruthy();
    expect(ownerA2.browserMock._store.folders_index.F1.shared.folderId).toBe('F1');
    expect(ownerA2.browserMock._store.folder_F1.shared.role).toBe('owner');
    expect(ownerA2.browserMock._store.collection_c1.name).toBe('A owns this edit');
    expect(ownerA2.browserMock._store.collection_c2).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // 8. Invite lifecycle race: unshare while an invite is pending.
  // ---------------------------------------------------------------------
  it('8. owner unshares while B has a pending (un-accepted) invite: B\'s accept 404s, invite is dropped, nothing materializes, no crash', async () => {
    const now = Date.now();
    Object.assign(ownerA.browserMock._store, {
      folders_index: { F1: { uid: 'F1', name: 'Team', type: 'folder' } },
      folder_F1: { uid: 'F1', name: 'Team', type: 'folder', color: '#f00', createdOn: now, lastUpdated: now },
      collections_index: { c1: { uid: 'c1', name: 'Alpha', parentId: 'F1', lastUpdated: now } },
      collection_c1: { uid: 'c1', name: 'Alpha', parentId: 'F1', lastUpdated: now, tabs: [] },
    });
    await harness.asDevice(ownerA, (c) => c.handleSharedMessage({
      type: 'sharedCreateShare',
      folder: { uid: 'F1', name: 'Team', color: '#f00' },
      collections: [{ uid: 'c1', data: { name: 'Alpha', tabs: [] } }],
      invites: [{ email: memberB.email, role: 'write' }],
    }));

    // B polls and caches the invite locally, but does not respond yet.
    const polled = await harness.asDevice(memberB, (c) => c.pollInvites());
    expect(polled.data.invites).toHaveLength(1);

    // Owner unshares before B responds.
    const unshared = await harness.asDevice(ownerA, (c) => c.handleSharedMessage({ type: 'sharedUnshareFolder', folderId: 'F1' }));
    expect(unshared.ok).toBe(true);
    expect(rawFolder('F1')).toBeUndefined();

    // B (unaware) tries to accept the now-stale cached invite.
    const respond = await harness.asDevice(memberB, (c) => c.handleSharedMessage({
      type: 'sharedRespondInvite', folderId: 'F1', accept: true,
    }));
    expect(respond.ok).toBe(false);
    expect(respond.status).toBe(404);

    // Nothing materialized; pending invite dropped; no crash.
    expect(memberB.browserMock._store.folder_F1).toBeUndefined();
    expect(memberB.browserMock._store.folders_index?.F1).toBeUndefined();
    const pending = memberB.browserMock._store.shared_pending_invites;
    expect(pending.invites).toHaveLength(0);

    // A subsequent pollInvites also converges cleanly (no stale entries).
    const repoll = await harness.asDevice(memberB, (c) => c.pollInvites());
    expect(repoll.data.invites).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // 9 (own scenario). Defense in depth: the sync engine itself must never
  // push a read-role member's edit, even if one somehow exists locally
  // (the UI is expected to prevent this, but the engine is the last line
  // of defense against a stale/buggy UI or a directly-forged storage write).
  // ---------------------------------------------------------------------
  it('9 (own). a read-role member\'s sync engine never pushes, even if a local edit is present', async () => {
    const { folderId } = await shareAndAccept();

    const readerC = makeDevice({ label: 'C-reader', googleId: 'g-reader', email: 'reader@x.com', token: 't-reader' });
    const invited = await harness.asDevice(ownerA, (c) => c.handleSharedMessage({
      type: 'sharedInvite', folderId, email: readerC.email, role: 'read',
    }));
    expect(invited.ok).toBe(true);
    const polled = await harness.asDevice(readerC, (c) => c.pollInvites());
    expect(polled.data.invites).toHaveLength(1);
    const accepted = await harness.asDevice(readerC, (c) => c.handleSharedMessage({
      type: 'sharedRespondInvite', folderId, accept: true,
    }));
    expect(accepted.ok).toBe(true);
    expect(readerC.browserMock._store.folder_F1.shared.role).toBe('read');

    // Illegitimate local edit — as if a UI bug let a read-only view slip an
    // edit through anyway.
    editCollection(readerC, 'c1', { name: 'C should never be able to push this' });
    const sync = await syncDevice(readerC);
    expect(sync.data.pushed).toBe(0);

    expect(rawCollection(folderId, 'c1').updated_by).not.toBe('reader@x.com');
    expect(harness.putCollectionCalls('c1').every((call) => call.device !== 'C-reader')).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 10 (own scenario). Three independent writers, three disjoint edits:
  // convergence holds beyond the 2-writer case, and revision growth is
  // bounded to exactly the number of real writes (no runaway from
  // redundant/echo pushes across more than one other peer).
  // ---------------------------------------------------------------------
  it('10 (own). three concurrent writers on three collections converge with bounded revision growth', async () => {
    const folderId = 'F3';
    const now = Date.now();
    Object.assign(ownerA.browserMock._store, {
      folders_index: { [folderId]: { uid: folderId, name: 'Trio', type: 'folder' } },
      [`folder_${folderId}`]: { uid: folderId, name: 'Trio', type: 'folder', color: '#00f', createdOn: now, lastUpdated: now },
      collections_index: {
        c1: { uid: 'c1', name: 'One', parentId: folderId, lastUpdated: now },
        c2: { uid: 'c2', name: 'Two', parentId: folderId, lastUpdated: now },
        c3: { uid: 'c3', name: 'Three', parentId: folderId, lastUpdated: now },
      },
      collection_c1: { uid: 'c1', name: 'One', parentId: folderId, lastUpdated: now, tabs: [] },
      collection_c2: { uid: 'c2', name: 'Two', parentId: folderId, lastUpdated: now, tabs: [] },
      collection_c3: { uid: 'c3', name: 'Three', parentId: folderId, lastUpdated: now, tabs: [] },
    });

    const created = await harness.asDevice(ownerA, (c) => c.handleSharedMessage({
      type: 'sharedCreateShare',
      folder: { uid: folderId, name: 'Trio', color: '#00f' },
      collections: [
        { uid: 'c1', data: { name: 'One', tabs: [] } },
        { uid: 'c2', data: { name: 'Two', tabs: [] } },
        { uid: 'c3', data: { name: 'Three', tabs: [] } },
      ],
      invites: [{ email: memberB.email, role: 'write' }],
    }));
    expect(created.ok).toBe(true);
    await harness.asDevice(memberB, (c) => c.pollInvites());
    await harness.asDevice(memberB, (c) => c.handleSharedMessage({ type: 'sharedRespondInvite', folderId, accept: true }));

    const memberC = makeDevice({ label: 'C3', googleId: 'g-c3', email: 'c3@x.com', token: 't-c3' });
    await harness.asDevice(ownerA, (c) => c.handleSharedMessage({ type: 'sharedInvite', folderId, email: memberC.email, role: 'write' }));
    await harness.asDevice(memberC, (c) => c.pollInvites());
    await harness.asDevice(memberC, (c) => c.handleSharedMessage({ type: 'sharedRespondInvite', folderId, accept: true }));

    editCollection(ownerA, 'c1', { name: 'One (A)' });
    editCollection(memberB, 'c2', { name: 'Two (B)' });
    editCollection(memberC, 'c3', { name: 'Three (C)' });

    // Two full rounds guarantee every device has both pushed its own edit
    // and pulled the other two's, regardless of turn order.
    await syncDevice(ownerA);
    await syncDevice(memberB);
    await syncDevice(memberC);
    await syncDevice(ownerA);
    await syncDevice(memberB);
    await syncDevice(memberC);

    // Bounded revision growth: create (1) + exactly 3 real pushes, no more.
    expect(rawFolder(folderId).revision).toBe(1 + 3);

    for (const dev of [ownerA, memberB, memberC]) {
      expect(dev.browserMock._store.collection_c1.name).toBe('One (A)');
      expect(dev.browserMock._store.collection_c2.name).toBe('Two (B)');
      expect(dev.browserMock._store.collection_c3.name).toBe('Three (C)');
    }
    expect(harness.putCollectionCalls('c1')).toHaveLength(1);
    expect(harness.putCollectionCalls('c2')).toHaveLength(1);
    expect(harness.putCollectionCalls('c3')).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // 11. Perf: revision short-circuit against the REAL worker/DB. The
  // `/shared/folders` LIST call (made every cycle for rematerialization)
  // reports each folder's current revision; when it matches the device's own
  // watermark, the per-folder delta GET is skipped entirely.
  // ---------------------------------------------------------------------
  it('11. revision short-circuit: an idle second sync issues no per-folder delta GET; a real remote edit is still picked up on the next sync', async () => {
    const { folderId } = await shareAndAccept();

    // A's first sync after sharing: nothing changed since the share itself,
    // but this establishes A's watermark against the real server revision.
    await syncDevice(ownerA);

    const fetchCountBefore = harness.fetchLog.length;
    const idleSync = await syncDevice(ownerA);
    expect(idleSync.data.pulled).toBe(0);
    expect(idleSync.data.pushed).toBe(0);

    const callsDuringIdleSync = harness.fetchLog.slice(fetchCountBefore);
    // The list call still happens every cycle...
    expect(callsDuringIdleSync.some((e) => e.pathname === '/shared/folders')).toBe(true);
    // ...but the per-folder delta GET does not, since nothing changed.
    expect(callsDuringIdleSync.some((e) => e.method === 'GET' && e.pathname === `/shared/folders/${folderId}`)).toBe(false);

    // B makes a real edit and pushes it — bumping the folder's revision.
    editCollection(memberB, 'c2', { name: 'Beta (B edit)' });
    await syncDevice(memberB);

    // A's next sync must now see the listed revision has moved and fetch the
    // real delta rather than short-circuiting.
    const fetchCountBeforeRealSync = harness.fetchLog.length;
    const realSync = await syncDevice(ownerA);
    expect(realSync.data.pulled).toBeGreaterThanOrEqual(1);
    const callsDuringRealSync = harness.fetchLog.slice(fetchCountBeforeRealSync);
    expect(callsDuringRealSync.some((e) => e.method === 'GET' && e.pathname === `/shared/folders/${folderId}`)).toBe(true);
    expect(ownerA.browserMock._store.collection_c2.name).toBe('Beta (B edit)');
  });

  // ---------------------------------------------------------------------
  // I3 fix matrix: same-collection concurrent mutations.
  //
  // Multiple members editing the SAME collection at the same time — drag/
  // drop, tab add/remove/reorder, or a delete racing an edit — all reduce to
  // the same underlying question, since collections sync at WHOLE-DOCUMENT
  // granularity: does a locally-dirty (unsynced) edit ever get silently
  // destroyed when a same-uid remote row arrives? Before the I3 fix,
  // applyDeltaLocally overwrote it unconditionally the instant a remote row
  // showed up, and the echo-push exclusion (appliedUids) then prevented the
  // local edit from ever being attempted as a push — total, silent loss. The
  // fix: defer the remote row instead of applying it, let the local edit
  // still race via the push phase (baseRev pinned to the PRE-pull revision
  // watermark), and on a 409 loss, apply the deferred remote AND record a
  // 'conflict' timeline event so the user is told.
  // ---------------------------------------------------------------------
  describe('same-collection concurrent mutations', () => {
    it('M1. A adds a tab and syncs; B (stale) adds a different tab to the same collection: B loses the fair race, gets a conflict event, converges on A\'s version — then B redoes the edit and it lands clean (recovery path)', async () => {
      const { folderId } = await shareAndAccept();

      // A adds tab T1 to c1 and syncs first.
      editCollection(ownerA, 'c1', { tabs: [tab('https://a.example', 'A'), tab('https://t1.example', 'T1')] });
      const syncA1 = await syncDevice(ownerA);
      expect(syncA1.data.pushed).toBe(1);

      // B, unaware of A's edit (stale), independently adds a DIFFERENT tab T2
      // to the SAME collection.
      editCollection(memberB, 'c1', { tabs: [tab('https://a.example', 'A'), tab('https://t2.example', 'T2')] });
      const syncB1 = await syncDevice(memberB);

      // B's pull picks up A's fresher row; B's own edit is locally dirty, so
      // it's deferred (not overwritten) rather than silently discarded. B's
      // push phase still attempts to push it (races fairly against the
      // pre-pull watermark) and 409s, since A's write already landed.
      expect(syncB1.data.pushed).toBe(0);
      expect(harness.putCollectionCalls('c1').some((c) => c.device === 'B')).toBe(true);

      // Convergence: both devices now have A's version (T1, no T2).
      const bUrls = memberB.browserMock._store.collection_c1.tabs.map((t) => t.url);
      expect(bUrls).toContain('https://t1.example');
      expect(bUrls).not.toContain('https://t2.example');
      expect(ownerA.browserMock._store.collection_c1.tabs.map((t) => t.url)).toEqual(bUrls);

      // B gets a conflict event (its toast).
      const bEvents = memberB.browserMock._store.shared_folder_events || [];
      const conflictEvent = bEvents.find((e) => e.kind === 'conflict' && e.folderId === folderId);
      expect(conflictEvent).toBeDefined();
      expect(conflictEvent.actorEmail).toBe('owner@x.com');

      // Recovery path: B re-adds T2 (now working from A's converged version)
      // and syncs — this time cleanly, since B is no longer stale.
      editCollection(memberB, 'c1', {
        tabs: [...memberB.browserMock._store.collection_c1.tabs, tab('https://t2.example', 'T2 retry')],
      });
      const syncB2 = await syncDevice(memberB);
      expect(syncB2.data.pushed).toBe(1);

      await syncDevice(ownerA);
      const finalUrls = ownerA.browserMock._store.collection_c1.tabs.map((t) => t.url);
      expect(finalUrls).toContain('https://t1.example');
      expect(finalUrls).toContain('https://t2.example');
      expect(memberB.browserMock._store.collection_c1.tabs.map((t) => t.url)).toEqual(finalUrls);
    });

    it('M2a. A removes a tab and syncs first; B reorders tabs in the same collection and syncs after: B loses, gets a conflict event, converges on A\'s tab-removed version', async () => {
      const { folderId } = await shareAndAccept();
      editCollection(ownerA, 'c1', { tabs: [tab('https://a.example', 'A'), tab('https://b2.example', 'B2')] });
      await syncDevice(ownerA);
      await syncDevice(memberB); // B catches up so both start from the same 2-tab baseline

      // A removes the second tab and syncs.
      editCollection(ownerA, 'c1', { tabs: [tab('https://a.example', 'A')] });
      const syncA = await syncDevice(ownerA);
      expect(syncA.data.pushed).toBe(1);

      // B (stale, still on the 2-tab baseline) reorders the two tabs.
      editCollection(memberB, 'c1', { tabs: [tab('https://b2.example', 'B2'), tab('https://a.example', 'A')] });
      const syncB = await syncDevice(memberB);
      expect(syncB.data.pushed).toBe(0); // B's reorder lost the race

      const revAfterAll = rawFolder(folderId).revision;

      expect(memberB.browserMock._store.collection_c1.tabs).toHaveLength(1);
      expect(ownerA.browserMock._store.collection_c1.tabs).toHaveLength(1);

      const bEvents = memberB.browserMock._store.shared_folder_events || [];
      expect(bEvents.some((e) => e.kind === 'conflict' && e.folderId === folderId)).toBe(true);

      // No crash, no revision runaway: one more round pushes nothing new.
      const syncA2 = await syncDevice(ownerA);
      const syncB2 = await syncDevice(memberB);
      expect(syncA2.data.pushed).toBe(0);
      expect(syncB2.data.pushed).toBe(0);
      expect(rawFolder(folderId).revision).toBe(revAfterAll);
    });

    it('M2b. B reorders tabs and syncs first; A removes a tab in the same collection and syncs after: A loses, gets a conflict event, converges on B\'s reordered version', async () => {
      const { folderId } = await shareAndAccept();
      editCollection(ownerA, 'c1', { tabs: [tab('https://a.example', 'A'), tab('https://b2.example', 'B2')] });
      await syncDevice(ownerA);
      await syncDevice(memberB);

      // B reorders first and syncs.
      editCollection(memberB, 'c1', { tabs: [tab('https://b2.example', 'B2'), tab('https://a.example', 'A')] });
      const syncB = await syncDevice(memberB);
      expect(syncB.data.pushed).toBe(1);

      // A (stale) removes a tab afterward.
      editCollection(ownerA, 'c1', { tabs: [tab('https://a.example', 'A')] });
      const syncA = await syncDevice(ownerA);
      expect(syncA.data.pushed).toBe(0); // A's removal lost the race

      const revAfterAll = rawFolder(folderId).revision;

      expect(ownerA.browserMock._store.collection_c1.tabs.map((t) => t.url)).toEqual(['https://b2.example', 'https://a.example']);
      expect(memberB.browserMock._store.collection_c1.tabs.map((t) => t.url)).toEqual(['https://b2.example', 'https://a.example']);

      const aEvents = ownerA.browserMock._store.shared_folder_events || [];
      expect(aEvents.some((e) => e.kind === 'conflict' && e.folderId === folderId)).toBe(true);

      const syncA2 = await syncDevice(ownerA);
      const syncB2 = await syncDevice(memberB);
      expect(syncA2.data.pushed).toBe(0);
      expect(syncB2.data.pushed).toBe(0);
      expect(rawFolder(folderId).revision).toBe(revAfterAll);
    });

    it('M3. simultaneous-cycle race (both push before either pulls, raw-409 technique): exactly one conflict event once the loser runs a real sync afterward, no revision runaway', async () => {
      const { folderId } = await shareAndAccept();

      // Both A and B edit c1 independently, with neither having synced since
      // the shared baseline — simulating truly overlapping pushes within the
      // SAME round-trip window (neither's pull would have seen the other's
      // row yet).
      editCollection(ownerA, 'c1', { name: 'A racing' });
      editCollection(memberB, 'c1', { name: 'B racing' });

      const revBefore = rawFolder(folderId).revision;

      // B wins the raw race.
      const bPush = await harness.asDevice(memberB, (c) => c.sharedApiFetch(
        `/shared/folders/${folderId}/collections/c1`,
        { method: 'PUT', body: { data: { name: 'B racing', tabs: [] }, baseRev: revBefore } },
      ));
      expect(bPush.ok).toBe(true);

      // A's push, using the SAME stale baseRev, 409s — exactly one conflict
      // at the protocol layer for this initial race.
      const aPush = await harness.asDevice(ownerA, (c) => c.sharedApiFetch(
        `/shared/folders/${folderId}/collections/c1`,
        { method: 'PUT', body: { data: { name: 'A racing', tabs: [] }, baseRev: revBefore } },
      ));
      expect(aPush.ok).toBe(false);
      expect(aPush.status).toBe(409);

      // A's local storage is untouched by that raw call — A's own edit is
      // still sitting there, dirty, exactly as a genuinely simultaneous
      // real-world race would leave it. A's next REAL sync now runs the full
      // conflict-aware pull+push flow: pull picks up B's now-server-side row
      // (isOther), A's copy is locally dirty -> deferred; push re-attempts
      // with the (still stale) pre-pull watermark -> 409 again -> deferred
      // remote applied + a SINGLE conflict event recorded.
      const syncA = await syncDevice(ownerA);
      expect(syncA.data.pushed).toBe(0);

      expect(ownerA.browserMock._store.collection_c1.name).toBe('B racing');
      const aEvents = ownerA.browserMock._store.shared_folder_events || [];
      const conflictEvents = aEvents.filter((e) => e.kind === 'conflict' && e.folderId === folderId);
      expect(conflictEvents).toHaveLength(1);

      // Converges — B's own local copy already reads 'B racing' (it's B's
      // own edit, pushed via the raw call above; no further sync needed on
      // B's side to observe it) — and no revision runaway: the initial
      // failed raw PUT from A never bumped anything server-side, and A's
      // real-sync conflict resolution is a local-only apply (never a
      // successful write), so only B's one real write ever bumped the
      // folder's revision counter.
      expect(memberB.browserMock._store.collection_c1.name).toBe('B racing');
      expect(rawFolder(folderId).revision).toBe(revBefore + 1); // only B's one real write
    });

    it('M4. user 1 deletes the collection and syncs; user 2 (dirty edit) syncs after: user 2\'s push 409s against the tombstone, the deletion is applied locally, user 2 gets a conflict event, and the collection is gone on both devices', async () => {
      const { folderId } = await shareAndAccept();

      deleteCollectionLocally(ownerA, 'c1');
      const syncA = await syncDevice(ownerA);
      expect(syncA.data.pushed).toBe(1); // the DELETE
      expect(rawCollection(folderId, 'c1').deleted).toBe(1);

      // B, unaware, has an unsynced local edit to c1.
      editCollection(memberB, 'c1', { name: 'B dirty edit' });
      const syncB = await syncDevice(memberB);

      // B's push attempts to save its edit, races against the pre-pull
      // watermark, and 409s against A's tombstone (the deferred remote is
      // the deletion itself).
      expect(syncB.data.pushed).toBe(0);
      expect(harness.putCollectionCalls('c1').some((c) => c.device === 'B')).toBe(true);

      // Converged: no ghost row, gone on both devices.
      expect(ownerA.browserMock._store.collection_c1).toBeUndefined();
      expect(memberB.browserMock._store.collection_c1).toBeUndefined();
      expect(ownerA.browserMock._store.collections_index.c1).toBeUndefined();
      expect(memberB.browserMock._store.collections_index.c1).toBeUndefined();

      // B was told: a 'conflict' event, not a silent 'deleted' one, since
      // B's OWN unsynced edit was actually in the running.
      const bEvents = memberB.browserMock._store.shared_folder_events || [];
      const conflictEvent = bEvents.find((e) => e.kind === 'conflict' && e.folderId === folderId);
      expect(conflictEvent).toBeDefined();
      expect(conflictEvent.actorEmail).toBe('owner@x.com');
      expect(conflictEvent.collectionName).toBe('B dirty edit'); // B's own (about-to-be-replaced) name
    });

    it('M5. user 2\'s edit syncs first; user 1\'s (now stale) delete 409s (B5); user 1\'s next sync restores user 2\'s edit and the collection stays alive on both devices', async () => {
      const { folderId } = await shareAndAccept();

      // B (user 2) edits c1's tabs and syncs first — a real revision bump.
      editCollection(memberB, 'c1', { tabs: [tab('https://b.example', 'B'), tab('https://b2.example', 'B2')] });
      const syncB = await syncDevice(memberB);
      expect(syncB.data.pushed).toBe(1);
      const revAfterBEdit = rawCollection(folderId, 'c1').rev;

      // A (user 1), never having pulled B's edit, issues a raw DELETE with a
      // stale baseRev (same B5 technique as "3c", with the actor roles the
      // M5 narrative calls for) — this simulates A's delete having been
      // decided before A knew about B's edit, without touching A's local
      // storage (so A's subsequent real sync below isn't confused by a local
      // pendingLocalRemoval).
      const staleBaseRev = revAfterBEdit - 1;
      const del = await harness.asDevice(ownerA, (c) => c.sharedApiFetch(
        `/shared/folders/${folderId}/collections/c1?baseRev=${staleBaseRev}`, { method: 'DELETE' },
      ));
      expect(del.ok).toBe(false);
      expect(del.status).toBe(409);

      // B's edit survived entirely.
      const rowAfterConflict = rawCollection(folderId, 'c1');
      expect(rowAfterConflict.deleted).toBe(0);
      expect(rowAfterConflict.rev).toBe(revAfterBEdit);

      // A's next REAL sync (through the full conflict-aware engine) pulls
      // B's edit and restores it locally — A has no dirty edit of its own
      // fighting over c1, so this is a normal isOther upsert, not a conflict.
      await syncDevice(ownerA);
      expect(ownerA.browserMock._store.collection_c1.tabs.map((t) => t.url)).toEqual(['https://b.example', 'https://b2.example']);
      await syncDevice(memberB);
      expect(memberB.browserMock._store.collection_c1.tabs.map((t) => t.url)).toEqual(['https://b.example', 'https://b2.example']);
    });

    it('M6a. B moves a collection out of the shared folder and syncs; A (with a dirty, unsynced edit) syncs after: A\'s edit loses to the tombstone, A gets a conflict event, and A\'s local copy is removed while B keeps its own moved-out copy', async () => {
      const { folderId } = await shareAndAccept();

      moveCollectionOut(memberB, 'c1');
      const syncB = await syncDevice(memberB);
      expect(syncB.data.pushed).toBe(1); // goneUids DELETE for c1
      expect(rawCollection(folderId, 'c1').deleted).toBe(1);
      expect(memberB.browserMock._store.collection_c1).toBeDefined();
      expect(memberB.browserMock._store.collection_c1.parentId).toBe('ROOT');

      editCollection(ownerA, 'c1', { name: 'A edits moved-out collection' });
      const syncA = await syncDevice(ownerA);

      // A's edit was locally dirty when B's tombstone arrived — it's
      // deferred, raced fairly (still 0 pushed, since B's delete already
      // landed), and A gets a conflict event instead of the change silently
      // vanishing (contrast with the pre-I3-fix "4a" behavior, still
      // asserted unchanged in its own final-state outcome below).
      expect(syncA.data.pushed).toBe(0);
      expect(harness.putCollectionCalls('c1').some((c) => c.device === 'A')).toBe(true);
      expect(ownerA.browserMock._store.collection_c1).toBeUndefined();

      const aEvents = ownerA.browserMock._store.shared_folder_events || [];
      const conflictEvent = aEvents.find((e) => e.kind === 'conflict' && e.folderId === folderId);
      expect(conflictEvent).toBeDefined();
      expect(conflictEvent.actorEmail).toBe('guest@x.com');
    });

    it('M6b. A edits and syncs first; B moves the same collection out afterward: B4 pendingLocalRemovals still wins over the new I3 deferred-remote logic — no regression', async () => {
      const { folderId } = await shareAndAccept();

      editCollection(ownerA, 'c1', { name: 'A fresh edit' });
      const syncA = await syncDevice(ownerA);
      expect(syncA.data.pushed).toBe(1);

      expect(memberB.browserMock._store.collection_c1.name).toBe('Alpha');
      moveCollectionOut(memberB, 'c1');
      const syncB = await syncDevice(memberB);

      // B4 still applies: B's local move-out (a pendingLocalRemoval) is
      // checked BEFORE the new I3 dirty-check, so A's incoming edit is
      // skipped entirely (never even considered for deferral) — B's
      // move-out survives untouched, exactly as before this fix, and no
      // conflict event is recorded for B.
      expect(syncB.data.pushed).toBe(1); // the DELETE for c1 still fires
      expect(memberB.browserMock._store.collection_c1.parentId).toBe('ROOT');
      expect(memberB.browserMock._store.collection_c1.name).toBe('Alpha'); // B's own copy, not A's edit
      expect(rawCollection(folderId, 'c1').deleted).toBe(1);

      const bEvents = memberB.browserMock._store.shared_folder_events || [];
      expect(bEvents.some((e) => e.kind === 'conflict')).toBe(false);

      const syncedState = memberB.browserMock._store.shared_sync_state;
      expect(syncedState[folderId].knownUids).not.toContain('c1');
    });
  });
});
