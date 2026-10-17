import { dbGet, dbAll, dbRun, toJSON, fromJSON } from '../lib/db.js';
import { ALL_SERVICE_CODES, SERVICES_CATALOG } from '../lib/services.js';

function mapResult(res, fn) {
  if (res && typeof res.then === 'function') {
    return res.then(fn);
  }
  return fn(res);
}

function hydrateUser(row) {
  if (!row) return null;
  return {
    ...row,
    documents: fromJSON(row.documents, {}),
    temp_data: fromJSON(row.temp_data, {}),
  };
}

function hydrateJob(row) {
  if (!row) return null;
  return {
    ...row,
    payload: fromJSON(row.payload, {}),
    result_data: fromJSON(row.result_data, {}),
  };
}

function hydrateManager(row) {
  if (!row) return null;
  return {
    ...row,
    services_offered: fromJSON(row.services_offered, ALL_SERVICE_CODES),
    working_hours: fromJSON(row.working_hours, { start: '08:00', end: '20:00' }),
    temp_data: fromJSON(row.temp_data, {}),
    is_active: Boolean(row.is_active),
  };
}

function hydrateTicket(row) {
  if (!row) return null;
  return {
    ...row,
    messages: fromJSON(row.messages, []),
  };
}

export class UsersRepository {
  constructor(db) {
    this.db = db;
  }

  findById(telegramId) {
    return mapResult(
      dbGet(this.db, 'SELECT * FROM users WHERE telegram_id = ?', [String(telegramId)]),
      hydrateUser
    );
  }

  create(telegramId, username, role = 'user', fullName = null) {
    return mapResult(
      dbRun(
        this.db,
        `INSERT INTO users (telegram_id, username, full_name, role, state, documents, temp_data)
         VALUES (?, ?, ?, ?, 'START', '{}', '{}')`,
        [String(telegramId), username ?? 'ناشناس', fullName ?? username ?? 'کاربر', role]
      ),
      () => this.findById(telegramId)
    );
  }

  getOrCreate(telegramId, username, fullName = null) {
    return mapResult(this.findById(telegramId), (user) => {
      if (user) return user;
      return this.create(telegramId, username, 'user', fullName);
    });
  }

  updateState(telegramId, newState, tempData = null) {
    if (tempData !== null) {
      return dbRun(
        this.db,
        'UPDATE users SET state = ?, temp_data = ? WHERE telegram_id = ?',
        [newState, toJSON(tempData), String(telegramId)]
      );
    }
    return dbRun(
      this.db,
      'UPDATE users SET state = ? WHERE telegram_id = ?',
      [newState, String(telegramId)]
    );
  }

  updateRole(telegramId, role) {
    return dbRun(
      this.db,
      'UPDATE users SET role = ? WHERE telegram_id = ?',
      [role, String(telegramId)]
    );
  }

  updateDocuments(telegramId, documents) {
    return dbRun(
      this.db,
      'UPDATE users SET documents = ? WHERE telegram_id = ?',
      [toJSON(documents), String(telegramId)]
    );
  }

  count() {
    return mapResult(
      dbGet(this.db, 'SELECT COUNT(*) as c FROM users'),
      (row) => row?.c ?? 0
    );
  }
}

export class ScrapingJobsRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return mapResult(
      dbGet(this.db, 'SELECT * FROM scraping_jobs WHERE id = ?', [Number(id)]),
      hydrateJob
    );
  }

  findPending() {
    return mapResult(
      dbAll(this.db, "SELECT * FROM scraping_jobs WHERE status = 'PENDING' ORDER BY created_at ASC"),
      (rows) => rows.map(hydrateJob)
    );
  }

  findPendingForManager(managerId, servicesOffered = ALL_SERVICE_CODES) {
    return mapResult(
      dbAll(
        this.db,
        `SELECT * FROM scraping_jobs
         WHERE status = 'PENDING'
           AND (assigned_manager_id IS NULL OR assigned_manager_id = ?)
         ORDER BY created_at ASC LIMIT 25`,
        [String(managerId)]
      ),
      (rows) =>
        rows
          .map(hydrateJob)
          .filter(
            (j) =>
              j.assigned_manager_id === String(managerId) ||
              !Array.isArray(servicesOffered) ||
              servicesOffered.includes(j.task_type)
          )
    );
  }

  findByManager(managerId, status = null, limit = 20) {
    if (status) {
      return mapResult(
        dbAll(
          this.db,
          `SELECT * FROM scraping_jobs WHERE assigned_manager_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?`,
          [String(managerId), status, limit]
        ),
        (rows) => rows.map(hydrateJob)
      );
    }
    return mapResult(
      dbAll(
        this.db,
        `SELECT * FROM scraping_jobs WHERE assigned_manager_id = ? ORDER BY updated_at DESC LIMIT ?`,
        [String(managerId), limit]
      ),
      (rows) => rows.map(hydrateJob)
    );
  }

  findByUser(userId, limit = 15) {
    return mapResult(
      dbAll(
        this.db,
        `SELECT * FROM scraping_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [String(userId), limit]
      ),
      (rows) => rows.map(hydrateJob)
    );
  }

  findPendingByUserAndType(userId, taskType) {
    return mapResult(
      dbGet(
        this.db,
        `SELECT * FROM scraping_jobs WHERE user_id = ? AND task_type = ?
         ORDER BY created_at DESC LIMIT 1`,
        [String(userId), taskType]
      ),
      hydrateJob
    );
  }

  findRecent(limit = 20) {
    return mapResult(
      dbAll(this.db, 'SELECT * FROM scraping_jobs ORDER BY created_at DESC LIMIT ?', [limit]),
      (rows) => rows.map(hydrateJob)
    );
  }

  create(userId, taskType, payload, assignedManagerId = null, slotId = null) {
    return mapResult(
      dbRun(
        this.db,
        `INSERT INTO scraping_jobs (user_id, task_type, payload, status, assigned_manager_id, slot_id)
         VALUES (?, ?, ?, 'PENDING', ?, ?)`,
        [String(userId), taskType, toJSON(payload), assignedManagerId, slotId]
      ),
      (res) => {
        if (res?.lastInsertRowid) {
          return this.findById(res.lastInsertRowid);
        }
        return mapResult(
          dbGet(this.db, 'SELECT * FROM scraping_jobs WHERE user_id = ? ORDER BY id DESC LIMIT 1', [String(userId)]),
          hydrateJob
        );
      }
    );
  }

  updateStatus(id, status, errorMessage = null) {
    return dbRun(
      this.db,
      `UPDATE scraping_jobs SET status = ?, error_message = ?, updated_at = unixepoch() WHERE id = ?`,
      [status, errorMessage, Number(id)]
    );
  }

  claim(id, managerId = null) {
    return mapResult(
      dbRun(
        this.db,
        `UPDATE scraping_jobs
         SET status = 'PROCESSING',
             assigned_manager_id = COALESCE(?, assigned_manager_id),
             updated_at = unixepoch()
         WHERE id = ? AND status = 'PENDING'`,
        [managerId ? String(managerId) : null, Number(id)]
      ),
      (result) => (result?.changes ?? result?.rowsAffected ?? result?.meta?.changes ?? 0) > 0
    );
  }

  complete(id, resultData = null) {
    if (resultData !== null) {
      return dbRun(
        this.db,
        `UPDATE scraping_jobs
         SET status = 'COMPLETED', result_data = ?, error_message = NULL, updated_at = unixepoch()
         WHERE id = ?`,
        [toJSON(resultData), Number(id)]
      );
    }
    return dbRun(
      this.db,
      `UPDATE scraping_jobs SET status = 'COMPLETED', error_message = NULL, updated_at = unixepoch() WHERE id = ?`,
      [Number(id)]
    );
  }

  fail(id, errorMessage) {
    return dbRun(
      this.db,
      `UPDATE scraping_jobs SET status = 'FAILED', error_message = ?, updated_at = unixepoch() WHERE id = ?`,
      [errorMessage, Number(id)]
    );
  }

  rateJob(id, rating, reviewText = null) {
    return dbRun(
      this.db,
      `UPDATE scraping_jobs SET rating = ?, review_text = ?, updated_at = unixepoch() WHERE id = ?`,
      [Number(rating), reviewText, Number(id)]
    );
  }

  countByStatus(status) {
    return mapResult(
      dbGet(this.db, `SELECT COUNT(*) as c FROM scraping_jobs WHERE status = ?`, [status]),
      (row) => row?.c ?? 0
    );
  }

  findByStatus(status, limit = 50) {
    return mapResult(
      dbAll(this.db, 'SELECT * FROM scraping_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit]),
      (rows) => rows.map(hydrateJob)
    );
  }

  count() {
    return mapResult(
      dbGet(this.db, 'SELECT COUNT(*) as c FROM scraping_jobs'),
      (row) => row?.c ?? 0
    );
  }
}

export class ManagersRepository {
  constructor(db) {
    this.db = db;
  }

  findById(telegramId) {
    return mapResult(
      dbGet(this.db, 'SELECT * FROM managers WHERE telegram_id = ?', [String(telegramId)]),
      hydrateManager
    );
  }

  upsert(telegramId, username, displayName, servicesOffered = ALL_SERVICE_CODES) {
    return mapResult(this.findById(telegramId), (existing) => {
      if (existing) {
        return mapResult(
          dbRun(
            this.db,
            `UPDATE managers SET username = COALESCE(?, username), display_name = COALESCE(?, display_name), updated_at = unixepoch() WHERE telegram_id = ?`,
            [username, displayName, String(telegramId)]
          ),
          () => this.findById(telegramId)
        );
      }
      return mapResult(
        dbRun(
          this.db,
          `INSERT INTO managers (telegram_id, username, display_name, services_offered, is_active, state, temp_data)
           VALUES (?, ?, ?, ?, 1, 'IDLE', '{}')`,
          [String(telegramId), username ?? 'manager', displayName ?? username ?? 'کارشناس کافه', toJSON(servicesOffered)]
        ),
        () => this.findById(telegramId)
      );
    });
  }

  listActive(serviceCode = null) {
    return mapResult(
      dbAll(this.db, 'SELECT * FROM managers WHERE is_active = 1 ORDER BY completed_count DESC, created_at ASC'),
      (rows) => {
        const list = rows.map(hydrateManager);
        if (!serviceCode || serviceCode === 'ALL') return list;
        return list.filter(
          (m) => Array.isArray(m.services_offered) && m.services_offered.includes(serviceCode)
        );
      }
    );
  }

  listAll() {
    return mapResult(
      dbAll(this.db, 'SELECT * FROM managers ORDER BY is_active DESC, completed_count DESC'),
      (rows) => rows.map(hydrateManager)
    );
  }

  toggleActive(telegramId) {
    return mapResult(this.findById(telegramId), (mgr) => {
      if (!mgr) return null;
      const next = mgr.is_active ? 0 : 1;
      return mapResult(
        dbRun(
          this.db,
          'UPDATE managers SET is_active = ?, updated_at = unixepoch() WHERE telegram_id = ?',
          [next, String(telegramId)]
        ),
        () => this.findById(telegramId)
      );
    });
  }

  toggleService(telegramId, serviceCode) {
    return mapResult(this.findById(telegramId), (mgr) => {
      if (!mgr) return null;
      const current = Array.isArray(mgr.services_offered) ? [...mgr.services_offered] : [];
      const idx = current.indexOf(serviceCode);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(serviceCode);
      return mapResult(
        dbRun(
          this.db,
          'UPDATE managers SET services_offered = ?, updated_at = unixepoch() WHERE telegram_id = ?',
          [toJSON(current), String(telegramId)]
        ),
        () => this.findById(telegramId)
      );
    });
  }

  setServices(telegramId, servicesArray) {
    return mapResult(
      dbRun(
        this.db,
        'UPDATE managers SET services_offered = ?, updated_at = unixepoch() WHERE telegram_id = ?',
        [toJSON(servicesArray), String(telegramId)]
      ),
      () => this.findById(telegramId)
    );
  }

  updateWorkingHours(telegramId, workingHours) {
    return mapResult(
      dbRun(
        this.db,
        'UPDATE managers SET working_hours = ?, updated_at = unixepoch() WHERE telegram_id = ?',
        [toJSON(workingHours), String(telegramId)]
      ),
      () => this.findById(telegramId)
    );
  }

  updateState(telegramId, state, tempData = null) {
    if (tempData !== null) {
      return dbRun(
        this.db,
        'UPDATE managers SET state = ?, temp_data = ?, updated_at = unixepoch() WHERE telegram_id = ?',
        [state, toJSON(tempData), String(telegramId)]
      );
    }
    return dbRun(
      this.db,
      'UPDATE managers SET state = ?, updated_at = unixepoch() WHERE telegram_id = ?',
      [state, String(telegramId)]
    );
  }

  recordCompletion(telegramId) {
    return dbRun(
      this.db,
      'UPDATE managers SET completed_count = completed_count + 1, updated_at = unixepoch() WHERE telegram_id = ?',
      [String(telegramId)]
    );
  }

  recordRating(telegramId, stars) {
    return dbRun(
      this.db,
      'UPDATE managers SET rating_sum = rating_sum + ?, rating_count = rating_count + 1, updated_at = unixepoch() WHERE telegram_id = ?',
      [Number(stars), String(telegramId)]
    );
  }

  count() {
    return mapResult(
      dbGet(this.db, 'SELECT COUNT(*) as c FROM managers'),
      (row) => row?.c ?? 0
    );
  }
}

export class TimeSlotsRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return dbGet(
      this.db,
      `SELECT s.*, m.display_name as manager_name, m.username as manager_username
       FROM time_slots s
       LEFT JOIN managers m ON m.telegram_id = s.manager_id
       WHERE s.id = ?`,
      [Number(id)]
    );
  }

  createSlot(managerId, slotDate, startTime, endTime, serviceType = 'ALL', capacity = 1) {
    return mapResult(
      dbRun(
        this.db,
        `INSERT INTO time_slots (manager_id, service_type, slot_date, start_time, end_time, capacity, booked_count, status)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'OPEN')`,
        [String(managerId), serviceType, slotDate, startTime, endTime, Number(capacity)]
      ),
      (res) => {
        if (res?.lastInsertRowid) return this.findById(res.lastInsertRowid);
        return dbGet(
          this.db,
          'SELECT * FROM time_slots WHERE manager_id = ? ORDER BY id DESC LIMIT 1',
          [String(managerId)]
        );
      }
    );
  }

  listOpenSlots(serviceType = null, limit = 20) {
    return mapResult(
      dbAll(
        this.db,
        `SELECT s.*, m.display_name as manager_name, m.username as manager_username, m.services_offered
         FROM time_slots s
         LEFT JOIN managers m ON m.telegram_id = s.manager_id
         WHERE s.status = 'OPEN' AND s.booked_count < s.capacity
           AND (m.is_active IS NULL OR m.is_active = 1)
         ORDER BY s.slot_date ASC, s.start_time ASC LIMIT ?`,
        [limit]
      ),
      (rows) => {
        if (!serviceType || serviceType === 'ALL') return rows;
        return rows.filter((r) => {
          if (r.service_type !== 'ALL' && r.service_type !== serviceType) return false;
          const offered = fromJSON(r.services_offered, ALL_SERVICE_CODES);
          return !Array.isArray(offered) || offered.includes(serviceType);
        });
      }
    );
  }

  listByManager(managerId, limit = 20) {
    return dbAll(
      this.db,
      `SELECT * FROM time_slots WHERE manager_id = ? AND status != 'CANCELLED'
       ORDER BY slot_date ASC, start_time ASC LIMIT ?`,
      [String(managerId), limit]
    );
  }

  reserveSlot(slotId, userId, jobId = null) {
    return mapResult(this.findById(slotId), (slot) => {
      if (!slot || slot.status !== 'OPEN' || slot.booked_count >= slot.capacity) {
        return false;
      }
      const nextCount = (slot.booked_count ?? 0) + 1;
      const nextStatus = nextCount >= slot.capacity ? 'FULL' : 'OPEN';
      return mapResult(
        dbRun(
          this.db,
          `UPDATE time_slots
           SET booked_count = ?, status = ?, booked_by_user_id = ?, job_id = COALESCE(?, job_id)
           WHERE id = ? AND status = 'OPEN'`,
          [nextCount, nextStatus, String(userId), jobId, Number(slotId)]
        ),
        (res) => (res?.changes ?? res?.rowsAffected ?? res?.meta?.changes ?? 0) > 0
      );
    });
  }

  completeSlot(slotId) {
    return dbRun(
      this.db,
      `UPDATE time_slots SET status = 'COMPLETED' WHERE id = ?`,
      [Number(slotId)]
    );
  }

  deleteSlot(slotId, managerId) {
    return mapResult(
      dbRun(
        this.db,
        `UPDATE time_slots SET status = 'CANCELLED' WHERE id = ? AND manager_id = ?`,
        [Number(slotId), String(managerId)]
      ),
      (res) => (res?.changes ?? res?.rowsAffected ?? res?.meta?.changes ?? 0) > 0
    );
  }
}

export class SupportTicketsRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return mapResult(
      dbGet(this.db, 'SELECT * FROM support_tickets WHERE id = ?', [Number(id)]),
      hydrateTicket
    );
  }

  create(userId, subject, initialMessageText, jobId = null, managerId = null) {
    const messages = [
      {
        sender: 'user',
        sender_id: String(userId),
        text: initialMessageText,
        ts: Math.floor(Date.now() / 1000),
      },
    ];
    return mapResult(
      dbRun(
        this.db,
        `INSERT INTO support_tickets (user_id, job_id, manager_id, subject, status, messages)
         VALUES (?, ?, ?, ?, 'OPEN', ?)`,
        [String(userId), jobId, managerId, subject, toJSON(messages)]
      ),
      (res) => {
        if (res?.lastInsertRowid) return this.findById(res.lastInsertRowid);
        return mapResult(
          dbGet(
            this.db,
            'SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC LIMIT 1',
            [String(userId)]
          ),
          hydrateTicket
        );
      }
    );
  }

  addMessage(ticketId, senderRole, senderId, text, newStatus = null) {
    return mapResult(this.findById(ticketId), (ticket) => {
      if (!ticket) return null;
      const msgs = Array.isArray(ticket.messages) ? [...ticket.messages] : [];
      msgs.push({
        sender: senderRole,
        sender_id: String(senderId),
        text,
        ts: Math.floor(Date.now() / 1000),
      });
      const status = newStatus ?? (senderRole === 'manager' ? 'ANSWERED' : 'OPEN');
      const managerId = senderRole === 'manager' ? String(senderId) : ticket.manager_id;
      return mapResult(
        dbRun(
          this.db,
          `UPDATE support_tickets
           SET messages = ?, status = ?, manager_id = COALESCE(?, manager_id), updated_at = unixepoch()
           WHERE id = ?`,
          [toJSON(msgs), status, managerId, Number(ticketId)]
        ),
        () => this.findById(ticketId)
      );
    });
  }

  close(ticketId) {
    return mapResult(
      dbRun(
        this.db,
        `UPDATE support_tickets SET status = 'CLOSED', updated_at = unixepoch() WHERE id = ?`,
        [Number(ticketId)]
      ),
      () => this.findById(ticketId)
    );
  }

  listOpen(limit = 20) {
    return mapResult(
      dbAll(
        this.db,
        `SELECT * FROM support_tickets WHERE status IN ('OPEN', 'ANSWERED') ORDER BY updated_at DESC LIMIT ?`,
        [limit]
      ),
      (rows) => rows.map(hydrateTicket)
    );
  }

  listByUser(userId, limit = 10) {
    return mapResult(
      dbAll(
        this.db,
        `SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
        [String(userId), limit]
      ),
      (rows) => rows.map(hydrateTicket)
    );
  }
}

export class LinkedChatsRepository {
  constructor(db) {
    this.db = db;
  }

  findByUserAndChat(userId, chatId) {
    return dbGet(
      this.db,
      'SELECT * FROM linked_chats WHERE user_id = ? AND chat_id = ?',
      [userId, chatId]
    );
  }

  upsert(userId, chatId, chatTitle) {
    return mapResult(this.findByUserAndChat(userId, chatId), (existing) => {
      if (existing) {
        return dbRun(
          this.db,
          'UPDATE linked_chats SET chat_title = ?, verified = 1 WHERE user_id = ? AND chat_id = ?',
          [chatTitle, userId, chatId]
        );
      }
      return dbRun(
        this.db,
        'INSERT INTO linked_chats (user_id, chat_id, chat_title, verified) VALUES (?, ?, ?, 1)',
        [userId, chatId, chatTitle]
      );
    });
  }
}
