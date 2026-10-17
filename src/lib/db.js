// ─────────────────────────────────────────────
// src/lib/db.js — لایه یکپارچه پایگاه داده (SQLite / node:sqlite / Cloudflare D1)
// ─────────────────────────────────────────────

import { SCHEMA_SQL, SCHEMA_ALTER_STATEMENTS } from '../db/schema.js';

let _db = null;

function resolveDbPath() {
  if (typeof process !== 'undefined' && process.env?.DB_PATH) {
    return process.env.DB_PATH;
  }
  return './data/cafe.db';
}

export function getDb() {
  if (_db) return _db;

  try {
    // Use Node's createRequire to load synchronous SQLite driver without breaking Cloudflare Workers bundling
    const { createRequire } = globalThis.process?.getBuiltinModule?.('node:module') ?? {};
    const fs = globalThis.process?.getBuiltinModule?.('node:fs');
    const path = globalThis.process?.getBuiltinModule?.('node:path');

    const dbPath = resolveDbPath();
    if (fs && path && dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(dir, { recursive: true });
    }

    if (createRequire) {
      const req = createRequire(import.meta.url);
      let DatabaseDriver;
      try {
        DatabaseDriver = req('better-sqlite3');
        _db = new DatabaseDriver(dbPath);
        _db.pragma('journal_mode = WAL');
        _db.pragma('foreign_keys = ON');
      } catch {
        const { DatabaseSync } = req('node:sqlite');
        _db = new DatabaseSync(dbPath);
        _db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      }
    }
  } catch (err) {
    console.error('[DB] خطا در راه‌اندازی SQLite محلی:', err.message);
    throw err;
  }

  _db.exec(SCHEMA_SQL);
  for (const stmt of SCHEMA_ALTER_STATEMENTS) {
    try { _db.exec(stmt); } catch { /* ستون از قبل وجود دارد */ }
  }

  return _db;
}

/**
 * دریافت یک سطر (سازگار با SQLite همگام و Cloudflare D1 ناهمگام)
 */
export function dbGet(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (typeof stmt.get === 'function') {
    const row = stmt.get(...params);
    return row ? { ...row } : null;
  }
  // Cloudflare D1
  const bound = params.length ? stmt.bind(...params) : stmt;
  return bound.first().then((row) => (row ? { ...row } : null));
}

/**
 * دریافت چند سطر (سازگار با SQLite همگام و Cloudflare D1 ناهمگام)
 */
export function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (typeof stmt.all === 'function' && typeof stmt.get === 'function') {
    const rows = stmt.all(...params) ?? [];
    return rows.map((r) => (r && typeof r === 'object' ? { ...r } : r));
  }
  // Cloudflare D1
  const bound = params.length ? stmt.bind(...params) : stmt;
  return bound.all().then((res) => (res?.results ?? []).map((r) => ({ ...r })));
}

/**
 * اجرای دستور نوشتن (INSERT / UPDATE / DELETE / DDL)
 */
export function dbRun(db, sql, params = []) {
  if (params.length === 0 && typeof db.exec === 'function' && sql.trim().includes(';\n')) {
    db.exec(sql);
    return { changes: 1 };
  }
  const stmt = db.prepare(sql);
  if (typeof stmt.run === 'function' && typeof stmt.get === 'function') {
    return stmt.run(...params);
  }
  // Cloudflare D1
  const bound = params.length ? stmt.bind(...params) : stmt;
  return bound.run().then((res) => ({
    changes: res?.meta?.changes ?? 0,
    lastInsertRowid: res?.meta?.last_row_id ?? null,
    meta: res?.meta,
  }));
}

/**
 * تبدیل شیء به رشته JSON برای ذخیره در پایگاه داده
 */
export function toJSON(obj) {
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj ?? {});
}

/**
 * تبدیل رشته JSON به شیء هنگام خواندن از پایگاه داده
 */
export function fromJSON(str, fallback = {}) {
  if (str && typeof str === 'object') return str;
  try { return JSON.parse(str || JSON.stringify(fallback)) ?? fallback; }
  catch { return fallback; }
}
