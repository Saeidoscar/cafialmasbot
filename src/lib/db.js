// ─────────────────────────────────────────────
// lib/db.js — wrapper برای better-sqlite3 (Render.com)
// ─────────────────────────────────────────────

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SCHEMA_SQL } from '../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.env.DB_PATH ?? join(__dirname, '../../data/cafe.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(SCHEMA_SQL);

  return _db;
}

/**
 * دریافت یک سطر
 */
export function dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params) ?? null;
}

/**
 * دریافت چند سطر
 */
export function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params) ?? [];
}

/**
 * اجرای دستور نوشتن (INSERT / UPDATE / DELETE)
 */
export function dbRun(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/**
 * تبدیل شیء به رشته JSON برای ذخیره در پایگاه داده
 */
export function toJSON(obj) {
  return JSON.stringify(obj ?? {});
}

/**
 * تبدیل رشته JSON به شیء هنگام خواندن از پایگاه داده
 */
export function fromJSON(str) {
  try { return JSON.parse(str || '{}') ?? {}; }
  catch { return {}; }
}
