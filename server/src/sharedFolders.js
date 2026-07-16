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

export { ROLES };
