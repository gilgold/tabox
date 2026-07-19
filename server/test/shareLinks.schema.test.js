import { describe, it, expect } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';

describe('0002_share_links migration', () => {
  it('creates folder_links cascading from shared_folders', async () => {
    const db = makeDB();
    await db.prepare(
      "INSERT INTO shared_folders (id, owner_google_id, owner_email, name, revision, created_at, updated_at, updated_by) VALUES ('f1','g1','o@x.com','T',1,1,1,'o@x.com')"
    ).bind().run();
    await db.prepare(
      "INSERT INTO folder_links (folder_id, token, role, created_at) VALUES ('f1','tok1','read',1)"
    ).bind().run();
    await db.prepare("DELETE FROM shared_folders WHERE id = 'f1'").bind().run();
    const row = await db.prepare("SELECT * FROM folder_links WHERE token = 'tok1'").bind().first();
    expect(row).toBeFalsy();
  });

  it('creates collection_links with a unique token and composite PK', async () => {
    const db = makeDB();
    await db.prepare(
      "INSERT INTO collection_links (owner_google_id, collection_uid, token, name, owner_email, data, created_at, updated_at) VALUES ('g1','c1','tokA','My tabs','o@x.com','{}',1,1)"
    ).bind().run();
    await expect(db.prepare(
      "INSERT INTO collection_links (owner_google_id, collection_uid, token, name, owner_email, data, created_at, updated_at) VALUES ('g2','c9','tokA','Other','p@x.com','{}',1,1)"
    ).bind().run()).rejects.toThrow();
  });
});
