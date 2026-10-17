-- schema.sql — ساختار پایگاه داده D1 (Cloudflare) و SQLite
-- اجرا با: npx wrangler d1 execute smart-cafe-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  telegram_id  TEXT PRIMARY KEY,
  username     TEXT,
  full_name    TEXT,
  phone        TEXT,
  role         TEXT    DEFAULT 'user',
  state        TEXT    DEFAULT 'START',
  documents    TEXT    DEFAULT '{}',
  temp_data    TEXT    DEFAULT '{}',
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS linked_chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  chat_id     TEXT    NOT NULL,
  chat_title  TEXT,
  verified    INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS managers (
  telegram_id      TEXT PRIMARY KEY,
  username         TEXT,
  display_name     TEXT    NOT NULL,
  phone            TEXT,
  bio              TEXT    DEFAULT '',
  services_offered TEXT    DEFAULT '["SANA","GICA","MYGOV","TAX","INSURANCE","MOJAVEZ","AMLAK","KHODNEWIS","SAMAN"]',
  is_active        INTEGER DEFAULT 1,
  max_concurrent   INTEGER DEFAULT 5,
  working_hours    TEXT    DEFAULT '{"start":"08:00","end":"20:00"}',
  rating_sum       INTEGER DEFAULT 0,
  rating_count     INTEGER DEFAULT 0,
  completed_count  INTEGER DEFAULT 0,
  state            TEXT    DEFAULT 'IDLE',
  temp_data        TEXT    DEFAULT '{}',
  created_at       INTEGER DEFAULT (unixepoch()),
  updated_at       INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS time_slots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id        TEXT    NOT NULL,
  service_type      TEXT    DEFAULT 'ALL',
  slot_date         TEXT    NOT NULL,
  start_time        TEXT    NOT NULL,
  end_time          TEXT    NOT NULL,
  capacity          INTEGER DEFAULT 1,
  booked_count      INTEGER DEFAULT 0,
  status            TEXT    DEFAULT 'OPEN',
  booked_by_user_id TEXT,
  job_id            INTEGER,
  created_at        INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              TEXT    NOT NULL,
  task_type            TEXT    NOT NULL,
  payload              TEXT    DEFAULT '{}',
  status               TEXT    DEFAULT 'PENDING',
  assigned_manager_id  TEXT,
  slot_id              INTEGER,
  result_data          TEXT    DEFAULT '{}',
  error_message        TEXT,
  rating               INTEGER,
  review_text          TEXT,
  updated_at           INTEGER DEFAULT (unixepoch()),
  created_at           INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  job_id      INTEGER,
  manager_id  TEXT,
  subject     TEXT    NOT NULL,
  status      TEXT    DEFAULT 'OPEN',
  messages    TEXT    DEFAULT '[]',
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS services_catalog (
  code              TEXT PRIMARY KEY,
  name_fa           TEXT    NOT NULL,
  name_en           TEXT    NOT NULL,
  category          TEXT    NOT NULL,
  icon              TEXT    DEFAULT '🔵',
  portal_url        TEXT,
  description       TEXT,
  required_fields   TEXT    DEFAULT '[]',
  price_toman       INTEGER DEFAULT 0,
  estimated_minutes INTEGER DEFAULT 15,
  is_active         INTEGER DEFAULT 1,
  created_at        INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_jobs_status   ON scraping_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user     ON scraping_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_manager  ON scraping_jobs(assigned_manager_id);
CREATE INDEX IF NOT EXISTS idx_users_state   ON users(state);
CREATE INDEX IF NOT EXISTS idx_slots_manager ON time_slots(manager_id, status);
CREATE INDEX IF NOT EXISTS idx_slots_status  ON time_slots(status, slot_date);
CREATE INDEX IF NOT EXISTS idx_tickets_user  ON support_tickets(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
