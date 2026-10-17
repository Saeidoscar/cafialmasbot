// ─────────────────────────────────────────────
// schema.js — تعریف جداول پایگاه داده
// با استفاده از SDK tgcloud (Drizzle-like DSL)
// ─────────────────────────────────────────────

import { table, integer, text, boolean, json } from 'sdk/db';

// ══════════════════════════════════════════════
// کاربران — مشتریان و کاربران ثبت‌شده ربات
// ══════════════════════════════════════════════
export const users = table('users', {
  telegramId: text('telegram_id').primaryKey(),
  username:   text('username'),
  fullName:   text('full_name'),
  phone:      text('phone'),
  role:       text('role').default('user'),        // 'user' | 'manager' | 'admin'
  state:      text('state').default('START'),      // 'START' | 'AI_COLLECTING_*' | 'SUPPORT_*'
  documents:  json('documents').default({}),       // { national_id: '...', mobile_number: '...' }
  tempData:   json('temp_data').default({}),       // داده موقت جلسه جاری
  createdAt:  integer('created_at', { mode: 'timestamp' }),
});

// ══════════════════════════════════════════════
// مدیران / ارائه‌دهندگان خدمات (Manager End Bot)
// ══════════════════════════════════════════════
export const managers = table('managers', {
  telegramId:      text('telegram_id').primaryKey(),
  username:        text('username'),
  displayName:     text('display_name').notNull(),
  phone:           text('phone'),
  bio:             text('bio').default(''),
  servicesOffered: json('services_offered').default([
    'SANA', 'GICA', 'MYGOV', 'TAX', 'INSURANCE', 'MOJAVEZ', 'AMLAK', 'KHODNEWIS', 'SAMAN'
  ]),
  isActive:        boolean('is_active').default(true),
  maxConcurrent:   integer('max_concurrent').default(5),
  workingHours:    json('working_hours').default({ start: '08:00', end: '20:00' }),
  ratingSum:       integer('rating_sum').default(0),
  ratingCount:     integer('rating_count').default(0),
  completedCount:  integer('completed_count').default(0),
  state:           text('state').default('IDLE'),
  tempData:        json('temp_data').default({}),
  createdAt:       integer('created_at', { mode: 'timestamp' }),
  updatedAt:       integer('updated_at', { mode: 'timestamp' }),
});

// ══════════════════════════════════════════════
// نوبت‌های زمانی مدیران (Time Slots)
// ══════════════════════════════════════════════
export const timeSlots = table('time_slots', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  managerId:      text('manager_id').notNull(),
  serviceType:    text('service_type').default('ALL'),
  slotDate:       text('slot_date').notNull(),
  startTime:      text('start_time').notNull(),
  endTime:        text('end_time').notNull(),
  capacity:       integer('capacity').default(1),
  bookedCount:    integer('booked_count').default(0),
  status:         text('status').default('OPEN'), // 'OPEN' | 'FULL' | 'COMPLETED' | 'CANCELLED'
  bookedByUserId: text('booked_by_user_id'),
  jobId:          integer('job_id'),
  createdAt:      integer('created_at', { mode: 'timestamp' }),
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
// کارهای پردازش — صف ثبت درخواست ۹ سرویس دولتی و کافه‌نت
// ══════════════════════════════════════════════
export const scrapingJobs = table('scraping_jobs', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  userId:            text('user_id').notNull(),
  taskType:          text('task_type').notNull(),        // 'SANA' | 'GICA' | 'MYGOV' | 'TAX' | 'INSURANCE' | 'MOJAVEZ' | 'AMLAK' | 'KHODNEWIS' | 'SAMAN'
  payload:           json('payload').default({}),        // اطلاعات فرم جمع‌آوری‌شده
  status:            text('status').default('PENDING'),  // 'PENDING' | 'PROCESSING' | 'WAITING_USER' | 'COMPLETED' | 'FAILED'
  assignedManagerId: text('assigned_manager_id'),
  slotId:            integer('slot_id'),
  resultData:        json('result_data').default({}),
  errorMessage:      text('error_message'),
  rating:            integer('rating'),
  reviewText:        text('review_text'),
  updatedAt:         integer('updated_at', { mode: 'timestamp' }),
  createdAt:         integer('created_at', { mode: 'timestamp' }),
});

// ══════════════════════════════════════════════
// تیکت‌های پشتیبانی (Support Tickets)
// ══════════════════════════════════════════════
export const supportTickets = table('support_tickets', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    text('user_id').notNull(),
  jobId:     integer('job_id'),
  managerId: text('manager_id'),
  subject:   text('subject').notNull(),
  status:    text('status').default('OPEN'), // 'OPEN' | 'ANSWERED' | 'CLOSED'
  messages:  json('messages').default([]),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});
