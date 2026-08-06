import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

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
    // Pass the original SQL with the object; node:sqlite binds ?N directly.
    return { sql, params: paramMap };
  } else {
    // Use positional parameters (spread args)
    return { sql, params: bound };
  }
}

export function makeDB() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
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
