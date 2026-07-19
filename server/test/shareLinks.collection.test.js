import { describe, it, expect, beforeEach } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import { createSharedFolder } from '../src/sharedFolders.js';
import {
  createOrRotateFolderLink, upsertCollectionLink, listCollectionLinks,
  deleteCollectionLink, getPublicLinkInfo, MAX_COLLECTION_LINKS_PER_OWNER,
} from '../src/shareLinks.js';

const owner = { googleId: 'g-owner', email: 'owner@x.com' };
const SNAP = { name: 'Research', tabs: [{ url: 'https://a.com' }, { url: 'https://b.com' }] };

describe('collection links', () => {
  let db;
  beforeEach(() => { db = makeDB(); });

  it('upsert creates then updates in place with a stable token', async () => {
    const created = await upsertCollectionLink(db, owner, { uid: 'c1', name: 'Research', data: SNAP }, 1000);
    expect(created.ok).toBe(true);
    const updated = await upsertCollectionLink(db, owner, { uid: 'c1', name: 'Research v2', data: { ...SNAP, tabs: [] } }, 2000);
    expect(updated.data.token).toBe(created.data.token);
    const info = await getPublicLinkInfo(db, created.data.token);
    expect(info.data).toMatchObject({ kind: 'collection', name: 'Research v2', ownerEmail: 'owner@x.com', tabCount: 0 });
    expect(info.data.data).toEqual({ ...SNAP, tabs: [] });
  });

  it('validates input and enforces size + per-owner caps', async () => {
    expect((await upsertCollectionLink(db, owner, { uid: '', name: 'x', data: {} }, 1000)).error).toBe('invalid_request');
    expect((await upsertCollectionLink(db, owner, { uid: 'c1', name: '', data: {} }, 1000)).error).toBe('invalid_request');
    const huge = { name: 'big', tabs: [{ url: 'x'.repeat(600 * 1024) }] };
    expect((await upsertCollectionLink(db, owner, { uid: 'c1', name: 'big', data: huge }, 1000)).error).toBe('collection_too_large');
    for (let i = 0; i < MAX_COLLECTION_LINKS_PER_OWNER; i += 1) {
      await db.prepare(
        'INSERT INTO collection_links (owner_google_id, collection_uid, token, name, owner_email, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).bind('g-owner', `seed${i}`, `tokseed${i}`, 'n', 'owner@x.com', '{}', 1, 1).run();
    }
    expect((await upsertCollectionLink(db, owner, { uid: 'c-new', name: 'n', data: {} }, 1000)).error).toBe('link_limit');
  });

  it('list and delete are scoped to the owner', async () => {
    await upsertCollectionLink(db, owner, { uid: 'c1', name: 'Research', data: SNAP }, 1000);
    const list = await listCollectionLinks(db, owner);
    expect(list.data.links).toHaveLength(1);
    expect(list.data.links[0]).toMatchObject({ uid: 'c1', name: 'Research' });
    expect((await listCollectionLinks(db, { googleId: 'g-other', email: 'o@x.com' })).data.links).toHaveLength(0);
    expect((await deleteCollectionLink(db, { googleId: 'g-other', email: 'o@x.com' }, 'c1')).status).toBe(404);
    expect((await deleteCollectionLink(db, owner, 'c1')).ok).toBe(true);
    expect((await listCollectionLinks(db, owner)).data.links).toHaveLength(0);
  });

  it('getPublicLinkInfo resolves folder links without leaking contents', async () => {
    await createSharedFolder(db, owner, { folderId: 'f1', name: 'Team', collections: [{ uid: 'c1', data: { name: 'A' } }] }, 1000);
    const { data: { token } } = await createOrRotateFolderLink(db, owner, 'f1', { role: 'write' }, 2000);
    const info = await getPublicLinkInfo(db, token);
    expect(info.data).toEqual({ kind: 'folder', name: 'Team', ownerEmail: 'owner@x.com', role: 'write', collectionCount: 1 });
    expect(JSON.stringify(info.data)).not.toContain('"tabs"');
    expect((await getPublicLinkInfo(db, 'unknown')).status).toBe(404);
  });
});
