-- schema.sql — ساختار پایگاه داده D1 (Cloudflare)
-- اجرا با: npx wrangler d1 execute smart-cafe-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  telegram_id  TEXT PRIMARY KEY,
  username     TEXT,
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

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL,
  task_type      TEXT    NOT NULL,
  payload        TEXT    DEFAULT '{}',
  status         TEXT    DEFAULT 'PENDING',
  error_message  TEXT,
  updated_at     INTEGER DEFAULT (unixepoch()),
  created_at     INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_jobs_status   ON scraping_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user     ON scraping_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_users_state   ON users(state);
