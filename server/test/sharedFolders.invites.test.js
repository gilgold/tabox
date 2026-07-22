import { describe, it, expect } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import { createSharedFolder, inviteMember, listInvites, respondInvite, MAX_MEMBERS_PER_FOLDER } from '../src/sharedFolders.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const GUEST = { googleId: 'g-guest', email: 'Guest@X.com' }; // mixed case on purpose
const NOW = 1000;

async function seed(db) {
  await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [{ uid: 'c1', data: { name: 'A' } }] }, NOW);
}

describe('invites', () => {
  it('owner invites; guest sees it (case-insensitive email)', async () => {
    const db = makeDB();
    await seed(db);
    const inv = await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, NOW);
    expect(inv.ok).toBe(true);
    const list = await listInvites(db, GUEST);
    expect(list.data.invites).toEqual([{ folderId: 'f1', folderName: 'Team', ownerEmail: 'owner@x.com', role: 'read', invitedAt: NOW }]);
  });
  it('non-member cannot invite (and cannot learn the folder exists)', async () => {
    const db = makeDB();
    await seed(db);
    // GUEST has not accepted any invite yet, so they are a stranger -> 404
    expect(await inviteMember(db, GUEST, 'f1', { email: 'z@x.com', role: 'read' }, NOW)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });
  it('rejects invalid role and self-invite', async () => {
    const db = makeDB();
    await seed(db);
    expect(await inviteMember(db, OWNER, 'f1', { email: 'a@x.com', role: 'admin' }, NOW)).toEqual({ ok: false, status: 400, error: 'invalid_role' });
    expect(await inviteMember(db, OWNER, 'f1', { email: 'OWNER@x.com', role: 'read' }, NOW)).toEqual({ ok: false, status: 400, error: 'cannot_invite_self' });
  });
  it('enforces the 20-member cap', async () => {
    const db = makeDB();
    await seed(db);
    for (let i = 0; i < MAX_MEMBERS_PER_FOLDER; i++) {
      expect((await inviteMember(db, OWNER, 'f1', { email: `u${i}@x.com`, role: 'read' }, NOW)).ok).toBe(true);
    }
    expect(await inviteMember(db, OWNER, 'f1', { email: 'overflow@x.com', role: 'read' }, NOW)).toEqual({ ok: false, status: 409, error: 'member_limit' });
  });
  it('accept returns a full snapshot and activates membership', async () => {
    const db = makeDB();
    await seed(db);
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'write' }, NOW);
    const res = await respondInvite(db, GUEST, 'f1', true, NOW + 5, { isPro: true });
    expect(res.data.accepted).toBe(true);
    expect(res.data.roleDowngraded).toBeUndefined();
    expect(res.data.folder).toMatchObject({ folderId: 'f1', name: 'Team', role: 'write', revision: 1 });
    expect(res.data.collections).toEqual([{ uid: 'c1', data: { name: 'A' } }]);
    expect((await listInvites(db, GUEST)).data.invites).toEqual([]);
  });
  it('free (non-Pro) user accepting a write invite is downgraded to read', async () => {
    const db = makeDB();
    await seed(db);
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'write' }, NOW);
    const res = await respondInvite(db, GUEST, 'f1', true, NOW + 5); // isPro defaults to false
    expect(res.data.accepted).toBe(true);
    expect(res.data.roleDowngraded).toBe(true);
    expect(res.data.folder).toMatchObject({ folderId: 'f1', role: 'read' });
    const row = await db.prepare("SELECT role, status FROM shared_members WHERE folder_id='f1' AND email='guest@x.com'").bind().first();
    expect(row).toMatchObject({ role: 'read', status: 'active' });
  });
  it('free user accepting a read invite is unaffected (no downgrade flag)', async () => {
    const db = makeDB();
    await seed(db);
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, NOW);
    const res = await respondInvite(db, GUEST, 'f1', true, NOW + 5);
    expect(res.data.roleDowngraded).toBeUndefined();
    expect(res.data.folder).toMatchObject({ role: 'read' });
  });
  it('decline marks declined; stranger cannot respond', async () => {
    const db = makeDB();
    await seed(db);
    await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, NOW);
    expect((await respondInvite(db, GUEST, 'f1', false, NOW)).data).toEqual({ accepted: false });
    expect(await respondInvite(db, { googleId: 'gx', email: 'nobody@x.com' }, 'f1', true, NOW)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });
});
