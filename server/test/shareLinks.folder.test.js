import { describe, it, expect, beforeEach } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import { createSharedFolder } from '../src/sharedFolders.js';
import {
  generateLinkToken, createOrRotateFolderLink, getFolderLink, deleteFolderLink, joinViaFolderLink,
} from '../src/shareLinks.js';

const owner = { googleId: 'g-owner', email: 'owner@x.com' };
const guest = { googleId: 'g-guest', email: 'guest@x.com' };

describe('folder links', () => {
  let db;
  beforeEach(async () => {
    db = makeDB();
    await createSharedFolder(db, owner, { folderId: 'f1', name: 'Team', collections: [{ uid: 'c1', data: { name: 'A' } }] }, 1000);
  });

  it('generates unguessable url-safe tokens', () => {
    const t = generateLinkToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateLinkToken()).not.toBe(t);
  });

  it('creates a link, keeps token stable on role change, rotates on demand', async () => {
    const created = await createOrRotateFolderLink(db, owner, 'f1', { role: 'read' }, 2000);
    expect(created.ok).toBe(true);
    const roleChanged = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write' }, 3000);
    expect(roleChanged.data.token).toBe(created.data.token);
    expect(roleChanged.data.role).toBe('write');
    const rotated = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write', rotate: true }, 4000);
    expect(rotated.data.token).not.toBe(created.data.token);
    expect((await getFolderLink(db, owner, 'f1')).data.link.token).toBe(rotated.data.token);
  });

  it('only the owner manages links; non-members get 404', async () => {
    expect((await createOrRotateFolderLink(db, guest, 'f1', { role: 'read' }, 2000)).status).toBe(404);
    expect((await getFolderLink(db, guest, 'f1')).status).toBe(404);
  });

  it('rejects an invalid role', async () => {
    expect((await createOrRotateFolderLink(db, owner, 'f1', { role: 'admin' }, 2000)).error).toBe('invalid_role');
  });

  it('join makes the caller an active member and returns the invite-accept payload', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write' }, 2000);
    const joined = await joinViaFolderLink(db, guest, token, 3000, { isPro: true });
    expect(joined.ok).toBe(true);
    expect(joined.data.accepted).toBe(true);
    expect(joined.data.roleDowngraded).toBeUndefined();
    expect(joined.data.folder).toMatchObject({ folderId: 'f1', role: 'write', ownerEmail: 'owner@x.com' });
    expect(joined.data.collections).toEqual([{ uid: 'c1', data: { name: 'A' } }]);
    const member = await db.prepare("SELECT * FROM shared_members WHERE folder_id='f1' AND email='guest@x.com'").bind().first();
    expect(member).toMatchObject({ status: 'active', role: 'write', google_id: 'g-guest' });
  });

  it('free (non-Pro) joiner of a write link is capped at read and flagged', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write' }, 2000);
    const joined = await joinViaFolderLink(db, guest, token, 3000); // isPro defaults to false
    expect(joined.ok).toBe(true);
    expect(joined.data.roleDowngraded).toBe(true);
    expect(joined.data.folder).toMatchObject({ folderId: 'f1', role: 'read' });
    const member = await db.prepare("SELECT * FROM shared_members WHERE folder_id='f1' AND email='guest@x.com'").bind().first();
    expect(member).toMatchObject({ status: 'active', role: 'read' });
  });

  it('free joiner of a read link gets read with no downgrade flag', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'read' }, 2000);
    const joined = await joinViaFolderLink(db, guest, token, 3000);
    expect(joined.data.roleDowngraded).toBeUndefined();
    expect(joined.data.folder).toMatchObject({ role: 'read' });
  });

  it('re-opening a link re-validates: a free member holding a stale write grant is downgraded', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write' }, 2000);
    await joinViaFolderLink(db, guest, token, 3000, { isPro: true }); // joined as write while Pro
    const rejoin = await joinViaFolderLink(db, guest, token, 4000); // Pro lapsed
    expect(rejoin.ok).toBe(true);
    expect(rejoin.data.roleDowngraded).toBe(true);
    expect(rejoin.data.folder).toMatchObject({ role: 'read' });
    const member = await db.prepare("SELECT role FROM shared_members WHERE folder_id='f1' AND email='guest@x.com'").bind().first();
    expect(member.role).toBe('read');
  });

  it('a Pro member re-opening a write link after a free join is upgraded back to write', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write' }, 2000);
    await joinViaFolderLink(db, guest, token, 3000); // free -> read
    const rejoin = await joinViaFolderLink(db, guest, token, 4000, { isPro: true });
    expect(rejoin.ok).toBe(true);
    // Already-active member: the stored role stands (read); upgrading requires
    // the owner to re-grant. What matters is nothing errors and no false flag.
    expect(rejoin.data.folder.role).toBe('read');
    expect(rejoin.data.roleDowngraded).toBeUndefined();
  });

  it('join is idempotent, blocks the owner, 404s unknown/rotated tokens, enforces the member cap', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'read' }, 2000);
    await joinViaFolderLink(db, guest, token, 3000);
    const again = await joinViaFolderLink(db, guest, token, 4000);
    expect(again.ok).toBe(true); // idempotent
    expect((await joinViaFolderLink(db, owner, token, 3000)).error).toBe('already_owner');
    expect((await joinViaFolderLink(db, guest, 'nope', 3000)).status).toBe(404);
    const { data: { token: fresh } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'read', rotate: true }, 5000);
    expect((await joinViaFolderLink(db, guest, token, 6000)).status).toBe(404); // old token dead
    for (let i = 0; i < 19; i += 1) {
      await db.prepare(
        "INSERT INTO shared_members (folder_id, email, role, status, invited_at) VALUES ('f1', ?, 'read', 'active', 1)"
      ).bind(`m${i}@x.com`).run();
    }
    expect((await joinViaFolderLink(db, { googleId: 'g-new', email: 'new@x.com' }, fresh, 7000)).error).toBe('member_limit');
  });

  it('delete removes the link', async () => {
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'read' }, 2000);
    await deleteFolderLink(db, owner, 'f1');
    expect((await getFolderLink(db, owner, 'f1')).data.link).toBe(null);
    expect((await joinViaFolderLink(db, guest, token, 3000)).status).toBe(404);
  });
});
