// Share-link module: folder join links + collection snapshot links.
// Same conventions as sharedFolders.js — every function takes (db, identity, …)
// and returns { ok:true, data } or { ok:false, status, error }.
import {
  requireFolderAccess, MAX_MEMBERS_PER_FOLDER, ROLES,
  safeCollectionSize, MAX_COLLECTION_BYTES, MAX_NAME_LENGTH,
} from './sharedFolders.js';

const err = (status, error) => ({ ok: false, status, error });

export const MAX_COLLECTION_LINKS_PER_OWNER = 100;

export function generateLinkToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createOrRotateFolderLink(db, identity, folderId, { role, rotate = false } = {}, nowMs) {
  const access = await requireFolderAccess(db, identity, folderId, 'owner');
  if (access.ok === false) return access;
  if (!ROLES.includes(role)) return err(400, 'invalid_role');
  const existing = await db.prepare('SELECT * FROM folder_links WHERE folder_id = ?').bind(folderId).first();
  if (existing && !rotate) {
    if (existing.role !== role) {
      await db.prepare('UPDATE folder_links SET role = ? WHERE folder_id = ?').bind(role, folderId).run();
    }
    return { ok: true, data: { token: existing.token, role } };
  }
  const token = generateLinkToken();
  await db.prepare(
    `INSERT INTO folder_links (folder_id, token, role, created_at) VALUES (?,?,?,?)
     ON CONFLICT(folder_id) DO UPDATE SET token = excluded.token, role = excluded.role, created_at = excluded.created_at`
  ).bind(folderId, token, role, nowMs).run();
  return { ok: true, data: { token, role } };
}

export async function getFolderLink(db, identity, folderId) {
  const access = await requireFolderAccess(db, identity, folderId, 'owner');
  if (access.ok === false) return access;
  const row = await db.prepare('SELECT token, role, created_at FROM folder_links WHERE folder_id = ?').bind(folderId).first();
  return { ok: true, data: { link: row ? { token: row.token, role: row.role, createdAt: row.created_at } : null } };
}

export async function deleteFolderLink(db, identity, folderId) {
  const access = await requireFolderAccess(db, identity, folderId, 'owner');
  if (access.ok === false) return access;
  await db.prepare('DELETE FROM folder_links WHERE folder_id = ?').bind(folderId).run();
  return { ok: true, data: { deleted: true } };
}

// Instant join. Mirrors respondInvite(accept:true)'s response shape exactly so
// the extension client can reuse its invite-accept materialization path.
export async function joinViaFolderLink(db, identity, token, nowMs) {
  if (typeof token !== 'string' || !token) return err(400, 'invalid_request');
  const link = await db.prepare(
    `SELECT fl.folder_id, fl.role AS link_role, f.owner_google_id, f.owner_email, f.name, f.color, f.revision
       FROM folder_links fl JOIN shared_folders f ON f.id = fl.folder_id WHERE fl.token = ?`
  ).bind(token).first();
  if (!link) return err(404, 'not_found');
  if (link.owner_google_id === identity.googleId) return err(409, 'already_owner');
  const email = identity.email.toLowerCase();
  const existing = await db.prepare(
    'SELECT status FROM shared_members WHERE folder_id = ? AND email = ?'
  ).bind(link.folder_id, email).first();
  if (!existing || existing.status === 'declined') {
    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM shared_members WHERE folder_id = ? AND status != 'declined'"
    ).bind(link.folder_id).first();
    if (count.n >= MAX_MEMBERS_PER_FOLDER) return err(409, 'member_limit');
  }
  if (!existing || existing.status !== 'active') {
    await db.prepare(
      `INSERT INTO shared_members (folder_id, email, google_id, role, status, invited_at, responded_at)
       VALUES (?,?,?,?,'active',?,?)
       ON CONFLICT(folder_id, email) DO UPDATE SET role = excluded.role, status = 'active',
         google_id = excluded.google_id, responded_at = excluded.responded_at`
    ).bind(link.folder_id, email, identity.googleId, link.link_role, nowMs, nowMs).run();
  }
  const memberRow = await db.prepare(
    'SELECT role FROM shared_members WHERE folder_id = ? AND email = ?'
  ).bind(link.folder_id, email).first();
  const { results: members } = await db.prepare(
    'SELECT email, role, status FROM shared_members WHERE folder_id = ? ORDER BY invited_at'
  ).bind(link.folder_id).all();
  const { results: collections } = await db.prepare(
    'SELECT uid, data FROM shared_collections WHERE folder_id = ? AND deleted = 0'
  ).bind(link.folder_id).all();
  return {
    ok: true,
    data: {
      accepted: true,
      folder: {
        folderId: link.folder_id, name: link.name, color: link.color, revision: link.revision,
        role: memberRow.role, ownerEmail: link.owner_email, members,
      },
      collections: collections.map((r) => ({ uid: r.uid, data: JSON.parse(r.data) })),
    },
  };
}
