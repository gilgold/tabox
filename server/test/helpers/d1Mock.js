import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations', '0001_shared_folders.sql');

function convertSqlParameters(sql, bound) {
  // Check if SQL uses numbered parameters (?1, ?2, etc.)
  const numberedParamMatches = [...sql.matchAll(/\?(\d+)/g)];

  if (numberedParamMatches.length > 0) {
    // Build a map of DISTINCT referenced numbered parameters: {1: bound[0], 2: bound[1], ...}
    const referencedNumbers = new Set(numberedParamMatches.map(m => parseInt(m[1], 10)));
    const paramMap = {};
    for (const num of referencedNumbers) {
      paramMap[String(num)] = bound[num - 1];
    }
    // Pass the ORIGINAL sql (no rewrite) with the object; better-sqlite3 binds ?N directly
    return { sql, params: paramMap };
  } else {
    // Use positional parameters (spread args)
    return { sql, params: bound };
  }
}

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
          const { sql: convertedSql, params } = convertSqlParameters(sql, bound);
          const info = Array.isArray(params)
            ? db.prepare(convertedSql).run(...params)
            : db.prepare(convertedSql).run(params);
          return { success: true, meta: { changes: info.changes } };
        },
        async all() {
          const { sql: convertedSql, params } = convertSqlParameters(sql, bound);
          return { results: Array.isArray(params)
            ? db.prepare(convertedSql).all(...params)
            : db.prepare(convertedSql).all(params) };
        },
        async first() {
          const { sql: convertedSql, params } = convertSqlParameters(sql, bound);
          return (Array.isArray(params)
            ? db.prepare(convertedSql).get(...params)
            : db.prepare(convertedSql).get(params)) ?? null;
        },
      };
    },
    _raw: db,
  };
}
