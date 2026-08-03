import { getDb, dbAll, dbRun } from '../lib/db.js';
import { SCHEMA_SQL, SCHEMA_DOWN_SQL } from './schema.js';

const MIGRATIONS_TABLE = 'schema_migrations';

const MIGRATIONS = [
  {
    version: '001_initial',
    up: SCHEMA_SQL,
    down: SCHEMA_DOWN_SQL,
  },
];

export function getMigrations() {
  return MIGRATIONS;
}

export async function ensureMigrationsTable() {
  const db = getDb();
  dbRun(db, `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version TEXT PRIMARY KEY, applied_at INTEGER DEFAULT (unixepoch()))`);
}

export async function getAppliedMigrations() {
  const db = getDb();
  return dbAll(db, `SELECT version FROM ${MIGRATIONS_TABLE}`).map(r => r.version);
}

export async function recordMigration(version) {
  const db = getDb();
  dbRun(db, `INSERT INTO ${MIGRATIONS_TABLE} (version) VALUES (?)`, [version]);
}

export async function runMigrations() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  for (const migration of MIGRATIONS) {
    if (applied.includes(migration.version)) continue;
    console.log(`[Migration] اجرای ${migration.version}...`);
    try {
      const db = getDb();
      dbRun(db, migration.up);
      await recordMigration(migration.version);
      console.log(`[Migration] ${migration.version} اعمال شد.`);
    } catch (err) {
      console.error(`[Migration] خطا در اجرای ${migration.version}:`, err);
      throw err;
    }
  }
}

export async function rollbackLastMigration() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  if (applied.length === 0) {
    console.log('[Migration] هیچ مهاجره‌ای برای بازگشت وجود ندارد.');
    return false;
  }
  const lastVersion = applied[applied.length - 1];
  const migration = MIGRATIONS.find(m => m.version === lastVersion);
  if (!migration) {
    console.log(`[Migration] مهاجره ${lastVersion} یافت نشد.`);
    return false;
  }
  console.log(`[Migration] بازگشت ${lastVersion}...`);
  const db = getDb();
  dbRun(db, migration.down);
  dbRun(db, `DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`, [lastVersion]);
  console.log(`[Migration] ${lastVersion} بازگردانده شد.`);
  return true;
}
