import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import worker from '../src/index.js';
import {
  createSharedFolder, inviteMember, respondInvite, deleteSharedFolder,
} from '../src/sharedFolders.js';
import {
  listComments, postComment, deleteComment, MAX_COMMENT_LENGTH, MAX_COMMENTS_PER_THREAD,
} from '../src/sharedActivity.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const GUEST = { googleId: 'g-guest', email: 'guest@x.com' };
const STRANGER = { googleId: 'g-str', email: 'stranger@x.com' };
const PRO = { isPro: true };

async function seed() {
  const db = makeDB();
  await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [{ uid: 'c1', data: { name: 'A' } }] }, 1000);
  await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, 1000);
  await respondInvite(db, GUEST, 'f1', true, 1001, { isPro: false }); // free READ member
  return db;
}

const commentRows = (db) => db._raw.prepare('SELECT COUNT(*) AS n FROM shared_comments').get().n;

describe('postComment', () => {
  it('membership is checked first: non-members get 404 even before the Pro gate', async () => {
    const db = await seed();
    expect(await postComment(db, STRANGER, 'f1', { body: 'hi' }, 2000, { isPro: false })).toEqual({ ok: false, status: 404, error: 'not_found' });
    expect(await postComment(db, STRANGER, 'f1', { body: 'hi' }, 2000, PRO)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('active free member (any role) gets 403 pro_required', async () => {
    const db = await seed();
    expect(await postComment(db, GUEST, 'f1', { body: 'hi' }, 2000, { isPro: false })).toEqual({ ok: false, status: 403, error: 'pro_required' });
  });

  it('a Pro READ member can post; response echoes the trimmed comment', async () => {
    const db = await seed();
    const res = await postComment(db, GUEST, 'f1', { collectionUid: 'c1', body: '  hello there  ' }, 2000, PRO);
    expect(res.ok).toBe(true);
    expect(res.data.comment).toMatchObject({ collectionUid: 'c1', authorEmail: 'guest@x.com', body: 'hello there', createdAt: 2000 });
    expect(typeof res.data.comment.id).toBe('string');
    expect(res.data.comment.id.length).toBeGreaterThan(10);
  });

  it('body validation: empty/whitespace/non-string/oversized -> 400; exactly 2000 chars ok', async () => {
    const db = await seed();
    for (const body of [undefined, null, '', '   ', 42, {}, 'x'.repeat(MAX_COMMENT_LENGTH + 1)]) {
      expect(await postComment(db, OWNER, 'f1', { body }, 2000, PRO)).toEqual({ ok: false, status: 400, error: 'invalid_request' });
    }
    expect((await postComment(db, OWNER, 'f1', { body: 'x'.repeat(MAX_COMMENT_LENGTH) }, 2000, PRO)).ok).toBe(true);
    expect(await postComment(db, OWNER, 'f1', { collectionUid: 42, body: 'hi' }, 2000, PRO)).toEqual({ ok: false, status: 400, error: 'invalid_request' });
  });

  it('thread cap: 200 non-deleted comments per thread, 409 thread_full beyond; soft-deleting frees a slot', async () => {
    const db = await seed();
    for (let i = 0; i < MAX_COMMENTS_PER_THREAD; i++) {
      expect((await postComment(db, OWNER, 'f1', { body: `m${i}` }, 2000 + i, PRO)).ok).toBe(true);
    }
    expect(await postComment(db, OWNER, 'f1', { body: 'overflow' }, 9000, PRO)).toEqual({ ok: false, status: 409, error: 'thread_full' });
    // the cap is per thread: the c1 thread is still open
    expect((await postComment(db, OWNER, 'f1', { collectionUid: 'c1', body: 'ok' }, 9001, PRO)).ok).toBe(true);
    // deleting one folder-thread comment frees a slot
    const { data } = await listComments(db, OWNER, 'f1', { limit: 1 });
    await deleteComment(db, OWNER, 'f1', data.comments[0].id);
    expect((await postComment(db, OWNER, 'f1', { body: 'fits now' }, 9002, PRO)).ok).toBe(true);
  });
});

describe('listComments', () => {
  it('non-members get 404; free READ member can read everything', async () => {
    const db = await seed();
    await postComment(db, OWNER, 'f1', { body: 'folder note' }, 2000, PRO);
    expect(await listComments(db, STRANGER, 'f1', {})).toEqual({ ok: false, status: 404, error: 'not_found' });
    const res = await listComments(db, GUEST, 'f1', {});
    expect(res.ok).toBe(true);
    expect(res.data.comments[0]).toMatchObject({ authorEmail: 'owner@x.com', body: 'folder note' });
  });

  it('one thread per call; counts cover ALL non-deleted threads in the folder', async () => {
    const db = await seed();
    await postComment(db, OWNER, 'f1', { body: 'folder 1' }, 2000, PRO);
    await postComment(db, OWNER, 'f1', { body: 'folder 2' }, 2001, PRO);
    const c1 = await postComment(db, OWNER, 'f1', { collectionUid: 'c1', body: 'on c1' }, 2002, PRO);
    await postComment(db, OWNER, 'f1', { collectionUid: 'c1', body: 'on c1 again' }, 2003, PRO);

    const folderThread = await listComments(db, GUEST, 'f1', {});
    expect(folderThread.data.comments.map((c) => c.body)).toEqual(['folder 2', 'folder 1']); // newest first
    expect(folderThread.data.comments.every((c) => c.collectionUid === null)).toBe(true);
    expect(folderThread.data.counts).toEqual(expect.arrayContaining([
      { collectionUid: null, n: 2 },
      { collectionUid: 'c1', n: 2 },
    ]));

    const c1Thread = await listComments(db, GUEST, 'f1', { collectionUid: 'c1' });
    expect(c1Thread.data.comments).toHaveLength(2);
    expect(c1Thread.data.comments.every((c) => c.collectionUid === 'c1')).toBe(true);

    // deleted comments vanish from both the thread and the counts
    await deleteComment(db, OWNER, 'f1', c1.data.comment.id);
    const after = await listComments(db, GUEST, 'f1', { collectionUid: 'c1' });
    expect(after.data.comments.map((c) => c.body)).toEqual(['on c1 again']);
    expect(after.data.counts).toEqual(expect.arrayContaining([{ collectionUid: 'c1', n: 1 }]));
  });

  it('pages older comments via the numeric beforeId (createdAt) cursor; default and max limit 50', async () => {
    const db = await seed();
    for (let i = 0; i < 60; i++) {
      await postComment(db, OWNER, 'f1', { body: `m${i}` }, 10_000 + i, PRO);
    }
    const page1 = await listComments(db, OWNER, 'f1', {});
    expect(page1.data.comments).toHaveLength(50);
    expect(page1.data.comments[0].body).toBe('m59');
    const oldestLoaded = page1.data.comments[49];
    expect(oldestLoaded.body).toBe('m10');
    const page2 = await listComments(db, OWNER, 'f1', { beforeId: oldestLoaded.createdAt });
    expect(page2.data.comments.map((c) => c.body)).toEqual(['m9', 'm8', 'm7', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1', 'm0']);
    expect((await listComments(db, OWNER, 'f1', { limit: 5 })).data.comments).toHaveLength(5);
    expect((await listComments(db, OWNER, 'f1', { limit: 500 })).data.comments).toHaveLength(50);
  });

  it('garbage beforeId/limit -> 400', async () => {
    const db = await seed();
    for (const opts of [{ beforeId: 'abc' }, { limit: 'abc' }, { limit: 0 }]) {
      expect(await listComments(db, OWNER, 'f1', opts)).toEqual({ ok: false, status: 400, error: 'invalid_request' });
    }
  });
});

describe('deleteComment', () => {
  it('only the author deletes their own; everyone else gets 404 (no existence leak)', async () => {
    const db = await seed();
    const own = await postComment(db, GUEST, 'f1', { body: 'mine' }, 2000, PRO);
    const owners = await postComment(db, OWNER, 'f1', { body: 'owner note' }, 2001, PRO);

    // another member cannot delete someone else's comment — indistinguishable from missing
    expect(await deleteComment(db, GUEST, 'f1', owners.data.comment.id)).toEqual({ ok: false, status: 404, error: 'not_found' });
    // author deletes own
    expect(await deleteComment(db, GUEST, 'f1', own.data.comment.id)).toEqual({ ok: true, data: { deleted: true } });
    // the folder owner cannot delete other people's comments either
    const guest2 = await postComment(db, GUEST, 'f1', { body: 'mine 2' }, 2002, PRO);
    expect(await deleteComment(db, OWNER, 'f1', guest2.data.comment.id)).toEqual({ ok: false, status: 404, error: 'not_found' });
    // already-deleted and unknown ids 404; non-members 404
    expect(await deleteComment(db, GUEST, 'f1', own.data.comment.id)).toEqual({ ok: false, status: 404, error: 'not_found' });
    expect(await deleteComment(db, OWNER, 'f1', 'nope')).toEqual({ ok: false, status: 404, error: 'not_found' });
    expect(await deleteComment(db, STRANGER, 'f1', owners.data.comment.id)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('is a soft delete: the row survives with deleted = 1', async () => {
    const db = await seed();
    const posted = await postComment(db, OWNER, 'f1', { body: 'bye' }, 2000, PRO);
    await deleteComment(db, OWNER, 'f1', posted.data.comment.id);
    const row = db._raw.prepare('SELECT deleted, body FROM shared_comments WHERE id = ?').get(posted.data.comment.id);
    expect(row).toEqual({ deleted: 1, body: 'bye' });
  });
});

describe('lifecycle', () => {
  it('folder deletion cascades to shared_comments', async () => {
    const db = await seed();
    await postComment(db, OWNER, 'f1', { body: 'a' }, 2000, PRO);
    await postComment(db, OWNER, 'f1', { collectionUid: 'c1', body: 'b' }, 2001, PRO);
    expect(commentRows(db)).toBe(2);
    await deleteSharedFolder(db, OWNER, 'f1');
    expect(commentRows(db)).toBe(0);
  });
});

// ---- route layer ----------------------------------------------------------

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
});
const PRO_RECORD = { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' };
const env = (kvStore, db) => ({ GOOGLE_CLIENT_ID: 'cid', JWT_SECRET: 's', ENTITLEMENTS: makeKV(kvStore), SHARED_DB: db });
function mockGoogle(identities) {
  globalThis.fetch = vi.fn(async (url, opts) => {
    const token = String(url).includes('tokeninfo')
      ? new URL(url).searchParams.get('access_token')
      : (opts?.headers?.Authorization || '').replace('Bearer ', '');
    const id = identities[token];
    if (!id) return { ok: false };
    if (String(url).includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
    return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
  });
}
const req = (method, path, token, body) => new Request(`https://api${path}`, {
  method, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
});

describe('/shared/folders/:id/comments routes', () => {
  let db, e;
  beforeEach(async () => {
    db = await seed();
    e = env({ 'ent:g-owner': PRO_RECORD }, db); // guest has NO entitlement (free member)
    mockGoogle({
      't-owner': { googleId: 'g-owner', email: 'owner@x.com' },
      't-guest': { googleId: 'g-guest', email: 'guest@x.com' },
      't-stranger': { googleId: 'g-str', email: 'stranger@x.com' },
    });
  });

  it('free member POST -> 403 pro_required; the same free member can still GET', async () => {
    const post = await worker.fetch(req('POST', '/shared/folders/f1/comments', 't-guest', { body: 'hi' }), e);
    expect(post.status).toBe(403);
    expect(await post.json()).toEqual({ error: 'pro_required' });
    const get = await worker.fetch(req('GET', '/shared/folders/f1/comments', 't-guest'), e);
    expect(get.status).toBe(200);
  });

  it('Pro member posts, everyone reads, author deletes via the DELETE route', async () => {
    const post = await worker.fetch(req('POST', '/shared/folders/f1/comments', 't-owner', { collectionUid: 'c1', body: 'route note' }), e);
    expect(post.status).toBe(200);
    const { comment } = await post.json();
    expect(comment).toMatchObject({ collectionUid: 'c1', authorEmail: 'owner@x.com', body: 'route note' });

    const get = await worker.fetch(req('GET', '/shared/folders/f1/comments?collectionUid=c1', 't-guest'), e);
    const listed = await get.json();
    expect(listed.comments).toHaveLength(1);
    expect(listed.counts).toEqual([{ collectionUid: 'c1', n: 1 }]);
    // absent collectionUid = the folder thread (empty here)
    const folderGet = await (await worker.fetch(req('GET', '/shared/folders/f1/comments', 't-guest'), e)).json();
    expect(folderGet.comments).toHaveLength(0);

    const del = await worker.fetch(req('DELETE', `/shared/folders/f1/comments/${comment.id}`, 't-owner'), e);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });
  });

  it('garbage query params -> 400; stranger -> 404 on every verb', async () => {
    const bad = await worker.fetch(req('GET', '/shared/folders/f1/comments?limit=abc', 't-owner'), e);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_request' });
    for (const r of [
      req('GET', '/shared/folders/f1/comments', 't-stranger'),
      req('POST', '/shared/folders/f1/comments', 't-stranger', { body: 'hi' }),
      req('DELETE', '/shared/folders/f1/comments/some-id', 't-stranger'),
    ]) {
      expect((await worker.fetch(r, e)).status).toBe(404);
    }
  });
});
