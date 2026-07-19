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

export async function upsertCollectionLink(db, identity, { uid, name, data } = {}, nowMs) {
  if (typeof uid !== 'string' || !uid || typeof name !== 'string' || !name) return err(400, 'invalid_request');
  if (name.length > MAX_NAME_LENGTH) return err(400, 'invalid_request');
  const sized = safeCollectionSize(data);
  if (!sized.ok) return err(400, 'invalid_request');
  if (sized.size > MAX_COLLECTION_BYTES) return err(413, 'collection_too_large');
  const existing = await db.prepare(
    'SELECT token FROM collection_links WHERE owner_google_id = ? AND collection_uid = ?'
  ).bind(identity.googleId, uid).first();
  if (existing) {
    await db.prepare(
      'UPDATE collection_links SET name = ?, data = ?, updated_at = ? WHERE owner_google_id = ? AND collection_uid = ?'
    ).bind(name, JSON.stringify(data ?? null), nowMs, identity.googleId, uid).run();
    return { ok: true, data: { token: existing.token } };
  }
  const count = await db.prepare(
    'SELECT COUNT(*) AS n FROM collection_links WHERE owner_google_id = ?'
  ).bind(identity.googleId).first();
  if (count.n >= MAX_COLLECTION_LINKS_PER_OWNER) return err(409, 'link_limit');
  const token = generateLinkToken();
  await db.prepare(
    'INSERT INTO collection_links (owner_google_id, collection_uid, token, name, owner_email, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(identity.googleId, uid, token, name, identity.email.toLowerCase(), JSON.stringify(data ?? null), nowMs, nowMs).run();
  return { ok: true, data: { token } };
}

export async function listCollectionLinks(db, identity) {
  const { results } = await db.prepare(
    'SELECT collection_uid, token, name, created_at, updated_at FROM collection_links WHERE owner_google_id = ? ORDER BY created_at'
  ).bind(identity.googleId).all();
  return {
    ok: true,
    data: { links: results.map((r) => ({ uid: r.collection_uid, token: r.token, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at })) },
  };
}

export async function deleteCollectionLink(db, identity, uid) {
  const res = await db.prepare(
    'DELETE FROM collection_links WHERE owner_google_id = ? AND collection_uid = ?'
  ).bind(identity.googleId, uid).run();
  if (res.meta.changes === 0) return err(404, 'not_found');
  return { ok: true, data: { deleted: true } };
}

// Public (unauthenticated) token resolution. Folder links expose metadata ONLY —
// never collection contents; joining requires auth. Collection links return the
// snapshot itself: for them this call IS the redeem.
export async function getPublicLinkInfo(db, token) {
  if (typeof token !== 'string' || !token) return err(404, 'not_found');
  const fl = await db.prepare(
    `SELECT fl.role, f.id, f.name, f.owner_email FROM folder_links fl
       JOIN shared_folders f ON f.id = fl.folder_id WHERE fl.token = ?`
  ).bind(token).first();
  if (fl) {
    const count = await db.prepare(
      'SELECT COUNT(*) AS n FROM shared_collections WHERE folder_id = ? AND deleted = 0'
    ).bind(fl.id).first();
    return { ok: true, data: { kind: 'folder', name: fl.name, ownerEmail: fl.owner_email, role: fl.role, collectionCount: count.n } };
  }
  const cl = await db.prepare('SELECT name, owner_email, data FROM collection_links WHERE token = ?').bind(token).first();
  if (!cl) return err(404, 'not_found');
  const data = JSON.parse(cl.data);
  const tabCount = Array.isArray(data?.tabs) ? data.tabs.length : 0;
  return { ok: true, data: { kind: 'collection', name: cl.name, ownerEmail: cl.owner_email, tabCount, data } };
}
