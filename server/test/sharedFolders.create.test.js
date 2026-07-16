import { describe, it, expect } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import { createSharedFolder, listSharedFolders, requireFolderAccess } from '../src/sharedFolders.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const NOW = 1000;
const COLS = [{ uid: 'c1', data: { name: 'Tabs', tabs: [] } }];

describe('createSharedFolder', () => {
  it('creates folder + collection rows at revision 1', async () => {
    const db = makeDB();
    const res = await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', color: '#f00', collections: COLS }, NOW);
    expect(res).toEqual({ ok: true, data: { folderId: 'f1', revision: 1 } });
    const rows = (await db.prepare('SELECT uid, rev FROM shared_collections WHERE folder_id = ?').bind('f1').all()).results;
    expect(rows).toEqual([{ uid: 'c1', rev: 1 }]);
  });
  it('rejects duplicate folder ids', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [] }, NOW);
    const res = await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Again', collections: [] }, NOW);
    expect(res).toEqual({ ok: false, status: 409, error: 'already_shared' });
  });
  it('rejects oversized collections', async () => {
    const db = makeDB();
    const big = [{ uid: 'c1', data: { blob: 'x'.repeat(600 * 1024) } }];
    const res = await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: big }, NOW);
    expect(res).toEqual({ ok: false, status: 413, error: 'collection_too_large' });
  });
});

describe('listSharedFolders / requireFolderAccess', () => {
  it('owner sees the folder with role owner and member list', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: COLS }, NOW);
    const res = await listSharedFolders(db, OWNER);
    expect(res.data.folders[0]).toMatchObject({ folderId: 'f1', role: 'owner', ownerEmail: 'owner@x.com', revision: 1, members: [] });
  });
  it('hides folder existence from strangers (404, not 403)', async () => {
    const db = makeDB();
    await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'Team', collections: [] }, NOW);
    const res = await requireFolderAccess(db, { googleId: 'g2', email: 'b@x.com' }, 'f1', 'read');
    expect(res).toEqual({ ok: false, status: 404, error: 'not_found' });
  });
});
