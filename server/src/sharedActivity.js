// Activity log + comments for shared folders.
// Same conventions as sharedFolders.js — every function takes (db, identity, …)
// and returns { ok:true, data } or { ok:false, status, error }.
import { requireFolderAccess } from './sharedFolders.js';

const err = (status, error) => ({ ok: false, status, error });

export const ACTIVITY_COALESCE_MS = 10 * 60 * 1000;
export const MAX_ACTIVITY_ROWS = 200;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENTS_PER_THREAD = 200;
export const DEFAULT_PAGE_LIMIT = 50;

// Mirrors the isGarbageBaseRev precedent: absent (undefined/null) is fine, but
// any PRESENT value must parse to a finite number — otherwise it's a hard 400
// at the caller, never a silently-degraded query.
function parseOptionalNumber(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (typeof raw === 'string' && raw.trim() === '') return { ok: false };
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

function parsePaging({ beforeId, limit } = {}) {
  const before = parseOptionalNumber(beforeId);
  if (!before.ok) return null;
  const lim = parseOptionalNumber(limit);
  if (!lim.ok) return null;
  if (lim.value !== undefined && lim.value < 1) return null;
  return {
    beforeId: before.value,
    limit: lim.value === undefined ? DEFAULT_PAGE_LIMIT : Math.min(Math.floor(lim.value), DEFAULT_PAGE_LIMIT),
  };
}

// Fire-and-forget append to the folder's activity feed, called from inside the
// existing mutators. MUST NEVER throw out of the parent mutation — an activity
// bookkeeping error must not turn a successful collection write into a 500, so
// everything (including statement preparation) is swallowed with a warn.
//
// Coalescing: if the folder's most recent row has the same
// (actor_email, action, subject) and is < 10 minutes old, bump its created_at
// and refresh detail instead of inserting ("updated × 12" noise killer).
// Retention: newest MAX_ACTIVITY_ROWS rows per folder, pruned on insert.
export async function recordActivity(db, folderId, actorEmail, action, subject, detail, nowMs) {
  try {
    const email = String(actorEmail || '').toLowerCase();
    const subj = subject ?? null;
    const detailJson = detail == null ? null : JSON.stringify(detail);
    const last = await db.prepare(
      'SELECT id, actor_email, action, subject, created_at FROM shared_activity WHERE folder_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(folderId).first();
    if (
      last && last.actor_email === email && last.action === action &&
      (last.subject ?? null) === subj && nowMs - last.created_at < ACTIVITY_COALESCE_MS
    ) {
      await db.prepare('UPDATE shared_activity SET created_at = ?, detail = ? WHERE id = ?')
        .bind(nowMs, detailJson, last.id).run();
      return;
    }
    await db.prepare(
      'INSERT INTO shared_activity (folder_id, actor_email, action, subject, detail, created_at) VALUES (?,?,?,?,?,?)'
    ).bind(folderId, email, action, subj, detailJson, nowMs).run();
    await db.prepare(
      'DELETE FROM shared_activity WHERE folder_id = ?1 AND id NOT IN (SELECT id FROM shared_activity WHERE folder_id = ?1 ORDER BY id DESC LIMIT ?2)'
    ).bind(folderId, MAX_ACTIVITY_ROWS).run();
  } catch (e) {
    console.warn('recordActivity failed:', e);
  }
}

export async function listActivity(db, identity, folderId, { beforeId, limit } = {}) {
  const access = await requireFolderAccess(db, identity, folderId, 'read');
  if (access.ok === false) return access;
  const paging = parsePaging({ beforeId, limit });
  if (!paging) return err(400, 'invalid_request');
  const bound = [folderId];
  let where = 'folder_id = ?';
  if (paging.beforeId !== undefined) {
    where += ' AND id < ?';
    bound.push(paging.beforeId);
  }
  bound.push(paging.limit);
  const { results } = await db.prepare(
    `SELECT id, actor_email, action, subject, detail, created_at FROM shared_activity WHERE ${where} ORDER BY id DESC LIMIT ?`
  ).bind(...bound).all();
  return {
    ok: true,
    data: {
      events: results.map((r) => {
        let detail = null;
        try { detail = r.detail == null ? null : JSON.parse(r.detail); } catch { detail = null; }
        return { id: r.id, actorEmail: r.actor_email, action: r.action, subject: r.subject, detail, createdAt: r.created_at };
      }),
    },
  };
}

// One thread per call: collectionUid string = that collection's thread,
// null/absent = the folder-level thread. `counts` always covers ALL non-deleted
// threads in the folder so the client can render the thread switcher.
// Paging: comment ids are UUIDs (no numeric order), so `beforeId` is a numeric
// createdAt cursor — pass the createdAt of the oldest comment already loaded.
export async function listComments(db, identity, folderId, { collectionUid = null, beforeId, limit } = {}) {
  const access = await requireFolderAccess(db, identity, folderId, 'read');
  if (access.ok === false) return access;
  if (collectionUid != null && typeof collectionUid !== 'string') return err(400, 'invalid_request');
  const paging = parsePaging({ beforeId, limit });
  if (!paging) return err(400, 'invalid_request');
  const bound = [folderId, collectionUid ?? null];
  let where = 'folder_id = ? AND collection_uid IS ? AND deleted = 0';
  if (paging.beforeId !== undefined) {
    where += ' AND created_at < ?';
    bound.push(paging.beforeId);
  }
  bound.push(paging.limit);
  const { results } = await db.prepare(
    `SELECT id, collection_uid, author_email, body, created_at FROM shared_comments WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`
  ).bind(...bound).all();
  const { results: countRows } = await db.prepare(
    'SELECT collection_uid, COUNT(*) AS n FROM shared_comments WHERE folder_id = ? AND deleted = 0 GROUP BY collection_uid'
  ).bind(folderId).all();
  return {
    ok: true,
    data: {
      comments: results.map((r) => ({
        id: r.id, collectionUid: r.collection_uid, authorEmail: r.author_email, body: r.body, createdAt: r.created_at,
      })),
      counts: countRows.map((r) => ({ collectionUid: r.collection_uid, n: r.n })),
    },
  };
}

// Posting requires active membership (any role, read included) AND Pro.
// Membership is checked FIRST so non-members get the same 404 as everywhere
// else and never learn the folder exists (or that comments are Pro-gated).
export async function postComment(db, identity, folderId, { collectionUid = null, body } = {}, nowMs, { isPro = false } = {}) {
  const access = await requireFolderAccess(db, identity, folderId, 'read');
  if (access.ok === false) return access;
  if (!isPro) return err(403, 'pro_required');
  if (collectionUid != null && (typeof collectionUid !== 'string' || !collectionUid)) return err(400, 'invalid_request');
  if (typeof body !== 'string') return err(400, 'invalid_request');
  const text = body.trim();
  if (!text || text.length > MAX_COMMENT_LENGTH) return err(400, 'invalid_request');
  const uid = collectionUid ?? null;
  const count = await db.prepare(
    'SELECT COUNT(*) AS n FROM shared_comments WHERE folder_id = ? AND collection_uid IS ? AND deleted = 0'
  ).bind(folderId, uid).first();
  if (count.n >= MAX_COMMENTS_PER_THREAD) return err(409, 'thread_full');
  const id = crypto.randomUUID();
  const authorEmail = identity.email.toLowerCase();
  await db.prepare(
    'INSERT INTO shared_comments (id, folder_id, collection_uid, author_email, body, created_at, deleted) VALUES (?,?,?,?,?,?,0)'
  ).bind(id, folderId, uid, authorEmail, text, nowMs).run();
  return { ok: true, data: { comment: { id, collectionUid: uid, authorEmail, body: text, createdAt: nowMs } } };
}

// Only the author may delete their own comment. Everyone else gets the
// same 404 as a missing comment so existence is never leaked. Soft delete
// only — the row stays for audit.
export async function deleteComment(db, identity, folderId, commentId) {
  const access = await requireFolderAccess(db, identity, folderId, 'read');
  if (access.ok === false) return access;
  if (typeof commentId !== 'string' || !commentId) return err(404, 'not_found');
  const row = await db.prepare(
    'SELECT id, author_email FROM shared_comments WHERE folder_id = ? AND id = ? AND deleted = 0'
  ).bind(folderId, commentId).first();
  if (!row) return err(404, 'not_found');
  const isAuthor = row.author_email === identity.email.toLowerCase();
  if (!isAuthor) return err(404, 'not_found');
  await db.prepare('UPDATE shared_comments SET deleted = 1 WHERE folder_id = ? AND id = ?').bind(folderId, commentId).run();
  return { ok: true, data: { deleted: true } };
}
