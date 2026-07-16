import { describe, it, expect } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';

describe('d1Mock', () => {
  it('applies the schema and round-trips a folder row', async () => {
    const db = makeDB();
    await db.prepare(
      'INSERT INTO shared_folders (id, owner_google_id, owner_email, name, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)'
    ).bind('f1', 'g1', 'a@x.com', 'Research', 1, 1, 'a@x.com').run();
    const row = await db.prepare('SELECT * FROM shared_folders WHERE id = ?').bind('f1').first();
    expect(row.name).toBe('Research');
    expect(row.revision).toBe(1);
  });
  it('reports meta.changes for conditional updates', async () => {
    const db = makeDB();
    const res = await db.prepare('UPDATE shared_folders SET name = ? WHERE id = ?').bind('x', 'missing').run();
    expect(res.meta.changes).toBe(0);
  });
});
