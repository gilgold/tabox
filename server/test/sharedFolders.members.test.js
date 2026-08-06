import { describe, it, expect } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import {
  createSharedFolder, inviteMember, respondInvite,
  updateMemberRole, removeMember, deleteSharedFolder, getFolderDelta, getMembers,
} from '../src/sharedFolders.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const GUEST = { googleId: 'g-guest', email: 'guest@x.com' };

async function seed() {
  const db = makeDB();
  await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [] }, 1000);
  await inviteMember(db, OWNER, 'f1', { email: 'guest@x.com', role: 'read' }, 1000);
  await respondInvite(db, GUEST, 'f1', true, 1001);
  return db;
}

describe('membership admin', () => {
  it('owner changes role read -> write; member sees it on next pull', async () => {
    const db = await seed();
    expect((await updateMemberRole(db, OWNER, 'f1', 'guest@x.com', 'write', 2000)).ok).toBe(true);
    expect((await getFolderDelta(db, GUEST, 'f1', 0)).data.role).toBe('write');
  });
  it('member cannot change roles', async () => {
    const db = await seed();
    expect(await updateMemberRole(db, GUEST, 'f1', 'guest@x.com', 'write', 2000)).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });
  it('owner revokes; member pull now 404s (revoked users become strangers)', async () => {
    const db = await seed();
    expect((await removeMember(db, OWNER, 'f1', 'guest@x.com', 2000)).ok).toBe(true);
    expect(await getFolderDelta(db, GUEST, 'f1', 0)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });
  it('getMembers shows every status (pending/active/declined) to the owner', async () => {
    const db = await seed();
    await inviteMember(db, OWNER, 'f1', { email: 'p@x.com', role: 'write' }, 1500);
    await inviteMember(db, OWNER, 'f1', { email: 'd@x.com', role: 'read' }, 1600);
    await respondInvite(db, { googleId: 'g-d', email: 'd@x.com' }, 'f1', false, 1700);
    const res = await getMembers(db, OWNER, 'f1');
    expect(res.data.members).toEqual([
      { email: 'guest@x.com', role: 'read', status: 'active' },
      { email: 'p@x.com', role: 'write', status: 'invited' },
      { email: 'd@x.com', role: 'read', status: 'declined' },
    ]);
  });
  it('member can leave (remove self) but not others', async () => {
    const db = await seed();
    expect(await removeMember(db, GUEST, 'f1', 'owner@x.com', 2000)).toEqual({ ok: false, status: 403, error: 'forbidden' });
    expect((await removeMember(db, GUEST, 'f1', 'guest@x.com', 2000)).ok).toBe(true);
  });
  it('owner deletes the share; everyone 404s', async () => {
    const db = await seed();
    expect(await deleteSharedFolder(db, GUEST, 'f1')).toEqual({ ok: false, status: 403, error: 'forbidden' });
    expect((await deleteSharedFolder(db, OWNER, 'f1')).ok).toBe(true);
    expect(await getFolderDelta(db, OWNER, 'f1', 0)).toEqual({ ok: false, status: 404, error: 'not_found' });
  });
});
