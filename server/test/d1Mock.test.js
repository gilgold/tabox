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

  it('binds numbered parameters with repeated placeholders', async () => {
    const db = makeDB();
    // Insert a folder with numbered params: ?1 (id), ?2 (email), ?1 (repeated)
    await db.prepare(
      'INSERT INTO shared_folders (id, owner_google_id, owner_email, name, created_at, updated_at, updated_by) VALUES (?1, ?1, ?2, ?1, 1, 1, ?2)'
    ).bind('f2', 'a@x.com').run();
    const row = await db.prepare('SELECT * FROM shared_folders WHERE id = ?1').bind('f2').first();
    expect(row.id).toBe('f2');
    expect(row.owner_google_id).toBe('f2');
    expect(row.owner_email).toBe('a@x.com');
    expect(row.name).toBe('f2');
    expect(row.updated_by).toBe('a@x.com');
  });

  it('handles numbered params with gaps (e.g., ?1 and ?3 without ?2)', async () => {
    const db = makeDB();
    // Insert using only ?1 and ?3 (skipping ?2 index, all numbered)
    await db.prepare(
      'INSERT INTO shared_folders (id, owner_google_id, owner_email, name, created_at, updated_at, updated_by) VALUES (?1, ?3, ?2, ?1, 1, 1, ?1)'
    ).bind('f3', 'a@x.com', 'g3').run();
    const row = await db.prepare('SELECT * FROM shared_folders WHERE id = ?1').bind('f3').first();
    expect(row.id).toBe('f3');
    expect(row.owner_google_id).toBe('g3');
    expect(row.owner_email).toBe('a@x.com');
    expect(row.name).toBe('f3');
    expect(row.updated_by).toBe('f3');
  });

  it('positional parameters still work correctly', async () => {
    const db = makeDB();
    // Test positional params with multiple args
    await db.prepare(
      'INSERT INTO shared_folders (id, owner_google_id, owner_email, name, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)'
    ).bind('f4', 'g4', 'b@x.com', 'Archive', 2, 2, 'b@x.com').run();
    const row = await db.prepare('SELECT * FROM shared_folders WHERE id = ?').bind('f4').first();
    expect(row.id).toBe('f4');
    expect(row.owner_google_id).toBe('g4');
    expect(row.owner_email).toBe('b@x.com');
    expect(row.name).toBe('Archive');
  });
});
