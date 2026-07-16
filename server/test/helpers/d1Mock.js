import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations', '0001_shared_folders.sql');

export function makeDB() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  return {
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async run() {
          const info = db.prepare(sql).run(...bound);
          return { success: true, meta: { changes: info.changes } };
        },
        async all() { return { results: db.prepare(sql).all(...bound) }; },
        async first() { return db.prepare(sql).get(...bound) ?? null; },
      };
    },
    _raw: db,
  };
}
