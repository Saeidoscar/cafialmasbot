import { getDb, dbGet, dbAll, dbRun, toJSON, fromJSON } from '../lib/db.js';
import { maskSensitive } from '../logging/logger.js';
import { safeLog } from '../logging/logger.js';

export class UsersRepository {
  constructor(db) {
    this.db = db;
  }

  findById(telegramId) {
    const row = dbGet(this.db, 'SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    if (row) {
      row.documents = fromJSON(row.documents);
      row.temp_data = fromJSON(row.temp_data);
    }
    return row;
  }

  create(telegramId, username) {
    dbRun(this.db,
      `INSERT INTO users (telegram_id, username, role, state, documents, temp_data)
       VALUES (?, ?, 'user', 'START', '{}', '{}')`,
      [telegramId, username ?? 'ناشناس']);
    return this.findById(telegramId);
  }

  getOrCreate(telegramId, username) {
    let user = this.findById(telegramId);
    if (user) return user;
    return this.create(telegramId, username);
  }

  updateState(telegramId, newState, tempData = null) {
    if (tempData !== null) {
      dbRun(this.db,
        'UPDATE users SET state = ?, temp_data = ? WHERE telegram_id = ?',
        [newState, toJSON(tempData), telegramId]);
    } else {
      dbRun(this.db,
        'UPDATE users SET state = ? WHERE telegram_id = ?',
        [newState, telegramId]);
    }
  }

  updateDocuments(telegramId, documents) {
    dbRun(this.db, 'UPDATE users SET documents = ? WHERE telegram_id = ?',
      [toJSON(documents), telegramId]);
  }

  count() {
    const row = dbGet(this.db, 'SELECT COUNT(*) as c FROM users');
    return row?.c ?? 0;
  }
}

export class ScrapingJobsRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return dbGet(this.db, 'SELECT * FROM scraping_jobs WHERE id = ?', [id]);
  }

  findPending() {
    return dbAll(this.db, "SELECT * FROM scraping_jobs WHERE status = 'PENDING' ORDER BY created_at ASC");
  }

  findPendingByUserAndType(userId, taskType) {
    return dbGet(this.db,
      `SELECT * FROM scraping_jobs WHERE user_id = ? AND task_type = ?
       ORDER BY created_at DESC LIMIT 1`,
      [userId, taskType]);
  }

  findRecent(limit = 20) {
    return dbAll(this.db, 'SELECT * FROM scraping_jobs ORDER BY created_at DESC LIMIT ?', [limit]);
  }

  create(userId, taskType, payload) {
    dbRun(this.db,
      `INSERT INTO scraping_jobs (user_id, task_type, payload, status)
       VALUES (?, ?, ?, 'PENDING')`,
      [userId, taskType, toJSON(payload)]);
    const row = dbGet(this.db, 'SELECT * FROM scraping_jobs WHERE id = last_insert_rowid()');
    if (row) row.payload = fromJSON(row.payload);
    return row;
  }

  updateStatus(id, status, errorMessage = null) {
    dbRun(this.db,
      `UPDATE scraping_jobs SET status = ?, error_message = ?, updated_at = unixepoch() WHERE id = ?`,
      [status, errorMessage, id]);
  }

  claim(id) {
    const result = dbRun(this.db,
      `UPDATE scraping_jobs SET status = 'PROCESSING', updated_at = unixepoch() WHERE id = ? AND status = 'PENDING'`,
      [id]);
    return (result.changes ?? result.rowsAffected ?? 0) > 0;
  }

  complete(id) {
    dbRun(this.db,
      `UPDATE scraping_jobs SET status = 'COMPLETED', error_message = NULL, updated_at = unixepoch() WHERE id = ?`,
      [id]);
  }

  fail(id, errorMessage) {
    dbRun(this.db,
      `UPDATE scraping_jobs SET status = 'FAILED', error_message = ?, updated_at = unixepoch() WHERE id = ?`,
      [errorMessage, id]);
  }

  countByStatus(status) {
    const row = dbGet(this.db, `SELECT COUNT(*) as c FROM scraping_jobs WHERE status = ?`, [status]);
    return row?.c ?? 0;
  }

  findByStatus(status, limit = 50) {
    return dbAll(this.db, 'SELECT * FROM scraping_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit]);
  }

  count() {
    const row = dbGet(this.db, 'SELECT COUNT(*) as c FROM scraping_jobs');
    return row?.c ?? 0;
  }
}

export class LinkedChatsRepository {
  constructor(db) {
    this.db = db;
  }

  findByUserAndChat(userId, chatId) {
    return dbGet(this.db,
      'SELECT * FROM linked_chats WHERE user_id = ? AND chat_id = ?',
      [userId, chatId]);
  }

  upsert(userId, chatId, chatTitle) {
    const existing = this.findByUserAndChat(userId, chatId);
    if (existing) {
      dbRun(this.db,
        'UPDATE linked_chats SET chat_title = ?, verified = 1 WHERE user_id = ? AND chat_id = ?',
        [chatTitle, userId, chatId]);
    } else {
      dbRun(this.db,
        'INSERT INTO linked_chats (user_id, chat_id, chat_title, verified) VALUES (?, ?, ?, 1)',
        [userId, chatId, chatTitle]);
    }
  }
}
