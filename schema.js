// ─────────────────────────────────────────────
// schema.js — تعریف جداول پایگاه داده
// با استفاده از SDK tgcloud (Drizzle-like DSL)
// ─────────────────────────────────────────────

import { table, integer, text, boolean, json } from 'sdk/db';

// ══════════════════════════════════════════════
// کاربران — کاربران ثبت‌شده ربات
// ══════════════════════════════════════════════
export const users = table('users', {
  telegramId: text('telegram_id').primaryKey(),
  username:   text('username'),
  role:       text('role').default('user'),        // 'user' | 'admin'
  state:      text('state').default('START'),      // 'START' | 'AI_COLLECTING_SANA' | 'AI_COLLECTING_GICA' | 'AI_COLLECTING_MYGOV' | 'AI_COLLECTING_TAX' | 'AI_COLLECTING_INSURANCE' | 'AI_COLLECTING_MOJAVEZ' | 'AI_COLLECTING_AMLAK' | 'AI_COLLECTING_KHODNEWIS' | 'AI_COLLECTING_SAMAN'
  documents:  json('documents').default({}),       // { passport: '...', national_id: '...' }
  tempData:   json('temp_data').default({}),       // داده موقت جلسه جاری
  createdAt:  integer('created_at', { mode: 'timestamp' }),
});

// ══════════════════════════════════════════════
// چت‌های متصل — گروه‌ها و کانال‌های کاربر
// ══════════════════════════════════════════════
export const linkedChats = table('linked_chats', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    text('user_id').notNull(),
  chatId:    text('chat_id').notNull(),
  chatTitle: text('chat_title'),
  verified:  boolean('verified').default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// ══════════════════════════════════════════════
// کارهای پردازش — صف ثبت درخواست سانا/گیکا
// ══════════════════════════════════════════════
export const scrapingJobs = table('scraping_jobs', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  userId:       text('user_id').notNull(),
  taskType:     text('task_type').notNull(),        // 'SANA' | 'GICA' | 'MYGOV' | 'TAX' | 'INSURANCE' | 'MOJAVEZ' | 'AMLAK' | 'KHODNEWIS' | 'SAMAN'
  payload:      json('payload').default({}),        // اطلاعات فرم جمع‌آوری‌شده
  status:       text('status').default('PENDING'),  // 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  errorMessage: text('error_message'),
  updatedAt:    integer('updated_at', { mode: 'timestamp' }),
  createdAt:    integer('created_at', { mode: 'timestamp' }),
});
