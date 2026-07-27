import { decideEntitlement } from './entitlement.js';
import { recordActivity } from './sharedActivity.js';

export const MAX_MEMBERS_PER_FOLDER = 20;
export const MAX_COLLECTION_BYTES = 512 * 1024;
const ROLES = ['read', 'write'];
const err = (status, error) => ({ ok: false, status, error });

export async function isProUser(env, googleId) {
  const raw = await env.ENTITLEMENTS.get(`ent:${googleId}`);
  let record = null;
  try { record = raw ? JSON.parse(raw) : null; } catch { record = null; }
  return decideEntitlement(record).entitled;
}

// B3 fix: JSON.stringify is recursive and can blow the call stack on a
// pathologically deep (but otherwise small) structure well before any byte
// cap is reached — a RangeError from here used to propagate uncaught past
// this point to handleShared's generic try/catch, surfacing as a 500. Every
// caller below treats a throw here as a clean validation failure (400), not
// a size violation, so `ok:false` (rather than a size number) always means
// "reject with invalid_request".
export function safeCollectionSize(data) {
  try {
    return { ok: true, size: JSON.stringify(data ?? null).length };
  } catch {
    return { ok: false };
  }
}

// B1 fix: `baseRev` is optional (absent/undefined legitimately means "no
// conflict check, LWW") but any PRESENT value that isn't a finite JS number —
// a non-numeric string, Infinity/-Infinity, NaN, an object, or null — used to
// silently disable the conflict check entirely (Number(x) is NaN for all of
// these, and Number.isFinite(NaN) is false, so `row.rev > Number(baseRev)`
// was just skipped). Treat any such present-but-garbage value as a hard
// validation error instead of a quietly-degraded LWW write.
function isGarbageBaseRev(baseRev) {
  return baseRev !== undefined && !(typeof baseRev === 'number' && Number.isFinite(baseRev));
}

// Display-name snapshot for activity `detail` — history should read well even
// after the collection is gone. Collections store their label as `name` (or
// legacy `title`); anything else yields a null detail.
function collectionNameDetail(data) {
  if (!data || typeof data !== 'object') return null;
  const name = typeof data.name === 'string' ? data.name : typeof data.title === 'string' ? data.title : null;
  return name == null ? null : { name };
}

export async function createSharedFolder(db, identity, { folderId, name, color = null, collections = [] }, nowMs) {
  if (!folderId || !name) return err(400, 'invalid_request');
  if (name.length > MAX_NAME_LENGTH) return err(400, 'invalid_request');
  if (collections.length > MAX_COLLECTIONS_PER_FOLDER) return err(413, 'too_many_collections');
  // B2 fix: validate the collections array BEFORE any DB write. Without this,
  // a payload with a duplicate uid threw an uncaught UNIQUE-constraint error
  // mid-insert-loop, after the shared_folders row (inserted first, no
  // transaction) was already committed — leaving a half-built folder row with
  // only the first of the duplicate pair's collection row written. Also
  // folds in the B3 deep-JSON guard so both checks happen in one pass, still
  // strictly before the folder INSERT below.
  const seenUids = new Set();
  for (const c of collections) {
    if (!c || typeof c.uid !== 'string' || !c.uid) return err(400, 'invalid_request');
    if (seenUids.has(c.uid)) return err(400, 'invalid_request');
    seenUids.add(c.uid);
    const sized = safeCollectionSize(c.data);
    if (!sized.ok) return err(400, 'invalid_request');
    if (sized.size > MAX_COLLECTION_BYTES) return err(413, 'collection_too_large');
  }
  const owned = await db.prepare('SELECT COUNT(*) AS n FROM shared_folders WHERE owner_google_id = ?').bind(identity.googleId).first();
  if (owned.n >= MAX_FOLDERS_PER_OWNER) return err(409, 'folder_limit');
  const existing = await db.prepare('SELECT id FROM shared_folders WHERE id = ?').bind(folderId).first();
  if (existing) return err(409, 'already_shared');
  await db.prepare(
    'INSERT INTO shared_folders (id, owner_google_id, owner_email, name, color, revision, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,1,?,?,?)'
  ).bind(folderId, identity.googleId, identity.email.toLowerCase(), name, color, nowMs, nowMs, identity.email.toLowerCase()).run();
  for (const c of collections) {
    await db.prepare(
      'INSERT INTO shared_collections (folder_id, uid, data, rev, deleted, updated_at, updated_by) VALUES (?,?,?,1,0,?,?)'
    ).bind(folderId, c.uid, JSON.stringify(c.data ?? null), nowMs, identity.email.toLowerCase()).run();
  }
  return { ok: true, data: { folderId, revision: 1 } };
}

async function membersOf(db, folderId) {
  // Declined members are INCLUDED (status:'declined') so the owner sees who declined
  // and can re-invite; only the member cap excludes them (see inviteMember).
  const { results } = await db.prepare(
    'SELECT email, role, status FROM shared_members WHERE folder_id = ? ORDER BY invited_at'
  ).bind(folderId).all();
  return results;
}

export async function listSharedFolders(db, identity) {
  const email = identity.email.toLowerCase();
  const { results } = await db.prepare(
    `SELECT f.*, CASE WHEN f.owner_google_id = ?1 THEN 'owner' ELSE m.role END AS role
       FROM shared_folders f
       LEFT JOIN shared_members m ON m.folder_id = f.id AND m.email = ?2 AND m.status = 'active'
      WHERE f.owner_google_id = ?1 OR m.email IS NOT NULL`
  ).bind(identity.googleId, email).all();
  const folders = [];
  for (const f of results) {
    folders.push({
      folderId: f.id, name: f.name, color: f.color, revision: f.revision,
      role: f.role, ownerEmail: f.owner_email, members: await membersOf(db, f.id),
    });
  }
  return { ok: true, data: { folders } };
}

const ROLE_RANK = { read: 1, write: 2, owner: 3 };

export async function requireFolderAccess(db, identity, folderId, minRole) {
  const folder = await db.prepare('SELECT * FROM shared_folders WHERE id = ?').bind(folderId).first();
  if (!folder) return err(404, 'not_found');
  let role = null;
  if (folder.owner_google_id === identity.googleId) role = 'owner';
  else {
    const m = await db.prepare(
      "SELECT role FROM shared_members WHERE folder_id = ? AND email = ? AND status = 'active'"
    ).bind(folderId, identity.email.toLowerCase()).first();
    role = m ? m.role : null;
  }
  if (!role) return err(404, 'not_found'); // non-members must not learn the folder exists
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) return err(403, 'forbidden');
  return { folder, role };
}

export async function inviteMember(db, identity, folderId, { email, role }, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'owner');
  if (access.ok === false) return access;
  if (!ROLES.includes(role)) return err(400, 'invalid_role');
  const target = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return err(400, 'invalid_email');
  if (target === identity.email.toLowerCase()) return err(400, 'cannot_invite_self');
  const { results } = await db.prepare(
    "SELECT COUNT(*) AS n FROM shared_members WHERE folder_id = ? AND status != 'declined'"
  ).bind(folderId).all();
  const existing = await db.prepare('SELECT status FROM shared_members WHERE folder_id = ? AND email = ?').bind(folderId, target).first();
  if (!existing || existing.status === 'declined') {
    if (results[0].n >= MAX_MEMBERS_PER_FOLDER) return err(409, 'member_limit');
  }
  await db.prepare(
    `INSERT INTO shared_members (folder_id, email, role, status, invited_at) VALUES (?,?,?,'invited',?)
     ON CONFLICT(folder_id, email) DO UPDATE SET role = excluded.role,
       via_link = 0,
       status = CASE WHEN shared_members.status = 'active' THEN 'active' ELSE 'invited' END,
       invited_at = excluded.invited_at, responded_at = NULL`
  ).bind(folderId, target, role, nowMs).run();
  return { ok: true, data: { members: await membersOf(db, folderId) } };
}

export async function listInvites(db, identity) {
  const { results } = await db.prepare(
    `SELECT m.folder_id AS folderId, f.name AS folderName, f.owner_email AS ownerEmail, m.role, m.invited_at AS invitedAt
       FROM shared_members m JOIN shared_folders f ON f.id = m.folder_id
      WHERE m.email = ? AND m.status = 'invited' ORDER BY m.invited_at`
  ).bind(identity.email.toLowerCase()).all();
  return { ok: true, data: { invites: results } };
}

// Entitlement gate on the RECIPIENT: a non-Pro user can only ever hold 'read'.
// A 'write' invite accepted by a free user is downgraded to 'read' at accept
// time (the grant point) — the caller passes the joiner's live Pro status.
export async function respondInvite(db, identity, folderId, accept, nowMs, { isPro = false } = {}) {
  const email = identity.email.toLowerCase();
  const invite = await db.prepare(
    "SELECT * FROM shared_members WHERE folder_id = ? AND email = ? AND status = 'invited'"
  ).bind(folderId, email).first();
  if (!invite) return err(404, 'not_found');
  const status = accept ? 'active' : 'declined';
  const effectiveRole = accept && invite.role === 'write' && !isPro ? 'read' : invite.role;
  await db.prepare(
    'UPDATE shared_members SET status = ?, role = ?, google_id = ?, responded_at = ? WHERE folder_id = ? AND email = ?'
  ).bind(status, effectiveRole, identity.googleId, nowMs, folderId, email).run();
  if (!accept) return { ok: true, data: { accepted: false } };
  await recordActivity(db, folderId, email, 'member_joined', email, { role: effectiveRole }, nowMs);
  const f = await db.prepare('SELECT * FROM shared_folders WHERE id = ?').bind(folderId).first();
  const { results } = await db.prepare(
    'SELECT uid, data FROM shared_collections WHERE folder_id = ? AND deleted = 0'
  ).bind(folderId).all();
  return {
    ok: true,
    data: {
      accepted: true,
      folder: {
        folderId: f.id, name: f.name, color: f.color, revision: f.revision,
        role: effectiveRole, ownerEmail: f.owner_email, members: await membersOf(db, folderId),
      },
      collections: results.map((r) => ({ uid: r.uid, data: JSON.parse(r.data) })),
      ...(effectiveRole !== invite.role ? { roleDowngraded: true } : {}),
    },
  };
}

export async function bumpRevision(db, folderId, identity, nowMs) {
  await db.prepare('UPDATE shared_folders SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(nowMs, identity.email.toLowerCase(), folderId).run();
  const row = await db.prepare('SELECT revision FROM shared_folders WHERE id = ?').bind(folderId).first();
  return row.revision;
}

export async function getFolderDelta(db, identity, folderId, sinceRev = 0) {
  const access = await requireFolderAccess(db, identity, folderId, 'read');
  if (access.ok === false) return access;
  const { folder, role } = access;
  const { results } = await db.prepare(
    'SELECT uid, data, rev, deleted, updated_by, updated_at FROM shared_collections WHERE folder_id = ? AND rev > ? ORDER BY rev'
  ).bind(folderId, Number(sinceRev) || 0).all();
  // Additive: high-water mark of the folder's activity feed, used by the
  // client purely for an "unread" dot — no activity rows ride the delta.
  const lastAct = await db.prepare('SELECT MAX(id) AS m FROM shared_activity WHERE folder_id = ?').bind(folderId).first();
  return {
    ok: true,
    data: {
      revision: folder.revision,
      role,
      lastActivityId: (lastAct && lastAct.m) || 0,
      folder: { name: folder.name, color: folder.color, updatedBy: folder.updated_by },
      members: await membersOf(db, folderId),
      collections: results.map((r) => ({
        uid: r.uid, data: r.data == null || r.deleted ? null : JSON.parse(r.data),
        rev: r.rev, deleted: r.deleted, updatedBy: r.updated_by, updatedAt: r.updated_at,
      })),
    },
  };
}

export async function putCollection(db, identity, folderId, uid, { data, baseRev }, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'write');
  if (access.ok === false) return access;
  if (isGarbageBaseRev(baseRev)) return err(400, 'invalid_request');
  const sized = safeCollectionSize(data);
  if (!sized.ok) return err(400, 'invalid_request');
  if (sized.size > MAX_COLLECTION_BYTES) return err(413, 'collection_too_large');
  const row = await db.prepare('SELECT rev, deleted FROM shared_collections WHERE folder_id = ? AND uid = ?').bind(folderId, uid).first();
  if (row && baseRev !== undefined && row.rev > baseRev) return err(409, 'conflict');
  if (!row) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM shared_collections WHERE folder_id = ? AND deleted = 0').bind(folderId).first();
    if (count.n >= MAX_COLLECTIONS_PER_FOLDER) return err(413, 'too_many_collections');
  }
  const revision = await bumpRevision(db, folderId, identity, nowMs);
  await db.prepare(
    `INSERT INTO shared_collections (folder_id, uid, data, rev, deleted, updated_at, updated_by) VALUES (?,?,?,?,0,?,?)
     ON CONFLICT(folder_id, uid) DO UPDATE SET data = excluded.data, rev = excluded.rev, deleted = 0,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(folderId, uid, JSON.stringify(data ?? null), revision, nowMs, identity.email.toLowerCase()).run();
  // A row that only exists as a tombstone (deleted = 1) reads as "added" again.
  const action = row && !row.deleted ? 'collection_updated' : 'collection_added';
  await recordActivity(db, folderId, identity.email, action, uid, collectionNameDetail(data), nowMs);
  return { ok: true, data: { revision } };
}

// B5: `baseRev` is optional here too, mirroring putCollection — absent
// preserves the original unconditional "delete always wins" behavior (kept
// for backward compatibility with any caller that doesn't send one), while a
// present, valid baseRev opts into the same conflict protection: a row that
// moved on past what the deleting client last saw (row.rev > baseRev) 409s
// instead of silently destroying the newer, unseen write. A present but
// garbage baseRev (per isGarbageBaseRev, same as B1) is a 400.
export async function deleteCollection(db, identity, folderId, uid, nowMs, baseRev) {
  const access = await requireFolderAccess(db, identity, folderId, 'write');
  if (access.ok === false) return access;
  if (isGarbageBaseRev(baseRev)) return err(400, 'invalid_request');
  // Pre-delete snapshot: the activity `detail` keeps the collection's display
  // name so the feed still reads well after the data column is nulled below.
  const row = await db.prepare('SELECT rev, data, deleted FROM shared_collections WHERE folder_id = ? AND uid = ?').bind(folderId, uid).first();
  if (baseRev !== undefined && row && row.rev > baseRev) return err(409, 'conflict');
  let snapshot = null;
  if (row && !row.deleted && row.data != null) {
    try { snapshot = collectionNameDetail(JSON.parse(row.data)); } catch { snapshot = null; }
  }
  const revision = await bumpRevision(db, folderId, identity, nowMs);
  await db.prepare(
    `INSERT INTO shared_collections (folder_id, uid, data, rev, deleted, updated_at, updated_by) VALUES (?,?,NULL,?,1,?,?)
     ON CONFLICT(folder_id, uid) DO UPDATE SET data = NULL, rev = excluded.rev, deleted = 1,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(folderId, uid, revision, nowMs, identity.email.toLowerCase()).run();
  await recordActivity(db, folderId, identity.email, 'collection_deleted', uid, snapshot, nowMs);
  return { ok: true, data: { revision } };
}

export async function updateFolderMeta(db, identity, folderId, { name, color }, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'write');
  if (access.ok === false) return access;
  if (name != null && name.length > MAX_NAME_LENGTH) return err(400, 'invalid_request');
  const f = access.folder;
  await db.prepare('UPDATE shared_folders SET name = ?, color = ? WHERE id = ?')
    .bind(name ?? f.name, color === undefined ? f.color : color, folderId).run();
  const revision = await bumpRevision(db, folderId, identity, nowMs);
  if (name != null && name !== f.name) {
    await recordActivity(db, folderId, identity.email, 'folder_renamed', null, { from: f.name, to: name }, nowMs);
  }
  return { ok: true, data: { revision } };
}

export async function updateMemberRole(db, identity, folderId, email, role, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'owner');
  if (access.ok === false) return access;
  if (!ROLES.includes(role)) return err(400, 'invalid_role');
  // An explicit per-member grant detaches the member from the share link:
  // later link role changes must not clobber what the owner set by hand.
  const res = await db.prepare('UPDATE shared_members SET role = ?, via_link = 0 WHERE folder_id = ? AND email = ?')
    .bind(role, folderId, String(email).toLowerCase()).run();
  if (res.meta.changes === 0) return err(404, 'not_found');
  await bumpRevision(db, folderId, identity, nowMs);
  await recordActivity(db, folderId, identity.email, 'role_changed', String(email).toLowerCase(), { role }, nowMs);
  return { ok: true, data: { members: await membersOf(db, folderId) } };
}

export async function removeMember(db, identity, folderId, email, nowMs) {
  const target = String(email).toLowerCase();
  const isSelf = target === identity.email.toLowerCase();
  const access = await requireFolderAccess(db, identity, folderId, isSelf ? 'read' : 'owner');
  if (access.ok === false) return access;
  const res = await db.prepare('DELETE FROM shared_members WHERE folder_id = ? AND email = ?').bind(folderId, target).run();
  if (res.meta.changes === 0) return err(404, 'not_found');
  await bumpRevision(db, folderId, identity, nowMs);
  await recordActivity(db, folderId, identity.email, isSelf ? 'member_left' : 'member_removed', target, null, nowMs);
  return { ok: true, data: { members: await membersOf(db, folderId) } };
}

export async function deleteSharedFolder(db, identity, folderId) {
  const access = await requireFolderAccess(db, identity, folderId, 'owner');
  if (access.ok === false) return access;
  await db.prepare('DELETE FROM shared_folders WHERE id = ?').bind(folderId).run();
  return { ok: true, data: { deleted: true } };
}

export async function getMembers(db, identity, folderId) {
  const access = await requireFolderAccess(db, identity, folderId, 'read');
  if (access.ok === false) return access;
  return { ok: true, data: { members: await membersOf(db, folderId), role: access.role } };
}

export { ROLES };

export const MAX_COLLECTIONS_PER_FOLDER = 500;
export const MAX_FOLDERS_PER_OWNER = 50;
export const MAX_NAME_LENGTH = 200;
export const MAX_BODY_BYTES = 1_048_576;

export async function checkRateLimit(env, googleId, bucket, limit, windowSecs, nowMs) {
  const windowStart = Math.floor(nowMs / 1000 / windowSecs);
  const key = `rl:${googleId}:${bucket}:${windowStart}`;
  const current = Number((await env.ENTITLEMENTS.get(key)) || 0);
  if (current >= limit) return false;
  await env.ENTITLEMENTS.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSecs * 2) });
  return true;
}
