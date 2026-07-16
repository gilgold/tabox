import { decideEntitlement } from './entitlement.js';

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

function tooLarge(collections) {
  return collections.some((c) => JSON.stringify(c.data ?? null).length > MAX_COLLECTION_BYTES);
}

export async function createSharedFolder(db, identity, { folderId, name, color = null, collections = [] }, nowMs) {
  if (!folderId || !name) return err(400, 'invalid_request');
  if (tooLarge(collections)) return err(413, 'collection_too_large');
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

export async function respondInvite(db, identity, folderId, accept, nowMs) {
  const email = identity.email.toLowerCase();
  const invite = await db.prepare(
    "SELECT * FROM shared_members WHERE folder_id = ? AND email = ? AND status = 'invited'"
  ).bind(folderId, email).first();
  if (!invite) return err(404, 'not_found');
  const status = accept ? 'active' : 'declined';
  await db.prepare(
    'UPDATE shared_members SET status = ?, google_id = ?, responded_at = ? WHERE folder_id = ? AND email = ?'
  ).bind(status, identity.googleId, nowMs, folderId, email).run();
  if (!accept) return { ok: true, data: { accepted: false } };
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
        role: invite.role, ownerEmail: f.owner_email, members: await membersOf(db, folderId),
      },
      collections: results.map((r) => ({ uid: r.uid, data: JSON.parse(r.data) })),
    },
  };
}

async function bumpRevision(db, folderId, identity, nowMs) {
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
  return {
    ok: true,
    data: {
      revision: folder.revision,
      role,
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
  if (JSON.stringify(data ?? null).length > MAX_COLLECTION_BYTES) return err(413, 'collection_too_large');
  const row = await db.prepare('SELECT rev FROM shared_collections WHERE folder_id = ? AND uid = ?').bind(folderId, uid).first();
  if (row && Number.isFinite(Number(baseRev)) && row.rev > Number(baseRev)) return err(409, 'conflict');
  const revision = await bumpRevision(db, folderId, identity, nowMs);
  await db.prepare(
    `INSERT INTO shared_collections (folder_id, uid, data, rev, deleted, updated_at, updated_by) VALUES (?,?,?,?,0,?,?)
     ON CONFLICT(folder_id, uid) DO UPDATE SET data = excluded.data, rev = excluded.rev, deleted = 0,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(folderId, uid, JSON.stringify(data ?? null), revision, nowMs, identity.email.toLowerCase()).run();
  return { ok: true, data: { revision } };
}

export async function deleteCollection(db, identity, folderId, uid, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'write');
  if (access.ok === false) return access;
  const revision = await bumpRevision(db, folderId, identity, nowMs);
  await db.prepare(
    `INSERT INTO shared_collections (folder_id, uid, data, rev, deleted, updated_at, updated_by) VALUES (?,?,NULL,?,1,?,?)
     ON CONFLICT(folder_id, uid) DO UPDATE SET data = NULL, rev = excluded.rev, deleted = 1,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(folderId, uid, revision, nowMs, identity.email.toLowerCase()).run();
  return { ok: true, data: { revision } };
}

export async function updateFolderMeta(db, identity, folderId, { name, color }, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'write');
  if (access.ok === false) return access;
  const f = access.folder;
  await db.prepare('UPDATE shared_folders SET name = ?, color = ? WHERE id = ?')
    .bind(name ?? f.name, color === undefined ? f.color : color, folderId).run();
  const revision = await bumpRevision(db, folderId, identity, nowMs);
  return { ok: true, data: { revision } };
}

export { ROLES };
