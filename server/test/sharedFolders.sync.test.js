import { describe, it, expect } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import {
  createSharedFolder, inviteMember, respondInvite,
  getFolderDelta, putCollection, deleteCollection, updateFolderMeta,
} from '../src/sharedFolders.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const WRITER = { googleId: 'g-w', email: 'w@x.com' };
const READER = { googleId: 'g-r', email: 'r@x.com' };

async function seed() {
  const db = makeDB();
  await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [{ uid: 'c1', data: { name: 'A' } }] }, 1000);
  await inviteMember(db, OWNER, 'f1', { email: 'w@x.com', role: 'write' }, 1000);
  await inviteMember(db, OWNER, 'f1', { email: 'r@x.com', role: 'read' }, 1000);
  await respondInvite(db, WRITER, 'f1', true, 1001, { isPro: true });
  await respondInvite(db, READER, 'f1', true, 1001);
  return db;
}

describe('putCollection / revision protocol', () => {
  it('write member upserts; revision bumps; delta returns only newer rows', async () => {
    const db = await seed();
    const put = await putCollection(db, WRITER, 'f1', 'c2', { data: { name: 'B' }, baseRev: 1 }, 2000);
    expect(put).toEqual({ ok: true, data: { revision: 2 } });
    const delta = await getFolderDelta(db, OWNER, 'f1', 1);
    expect(delta.data.revision).toBe(2);
    expect(delta.data.collections).toEqual([
      { uid: 'c2', data: { name: 'B' }, rev: 2, deleted: 0, updatedBy: 'w@x.com', updatedAt: 2000 },
    ]);
  });
  it('stale baseRev conflicts with 409', async () => {
    const db = await seed();
    await putCollection(db, WRITER, 'f1', 'c1', { data: { name: 'A2' }, baseRev: 1 }, 2000); // rev now 2
    const res = await putCollection(db, OWNER, 'f1', 'c1', { data: { name: 'A3' }, baseRev: 1 }, 2001);
    expect(res).toEqual({ ok: false, status: 409, error: 'conflict' });
  });
  it('read member cannot write or delete', async () => {
    const db = await seed();
    expect(await putCollection(db, READER, 'f1', 'c9', { data: {}, baseRev: 1 }, 2000)).toEqual({ ok: false, status: 403, error: 'forbidden' });
    expect(await deleteCollection(db, READER, 'f1', 'c1', 2000)).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });
  it('delete tombstones and shows in delta with data null', async () => {
    const db = await seed();
    const del = await deleteCollection(db, WRITER, 'f1', 'c1', 2000);
    expect(del).toEqual({ ok: true, data: { revision: 2 } });
    const delta = await getFolderDelta(db, READER, 'f1', 1);
    expect(delta.data.collections).toEqual([
      { uid: 'c1', data: null, rev: 2, deleted: 1, updatedBy: 'w@x.com', updatedAt: 2000 },
    ]);
  });
  it('updateFolderMeta renames for write role, forbidden for read', async () => {
    const db = await seed();
    expect((await updateFolderMeta(db, WRITER, 'f1', { name: 'Renamed' }, 2000)).data.revision).toBe(2);
    expect((await getFolderDelta(db, READER, 'f1', 0)).data.folder.name).toBe('Renamed');
    expect(await updateFolderMeta(db, READER, 'f1', { name: 'Nope' }, 2001)).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });
});
