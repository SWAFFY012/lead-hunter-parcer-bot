-- LeadHunter SQLite Schema
-- Created automatically on first run

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Leads (лиды из OLX)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  title TEXT,
  ad_text TEXT,
  source_url TEXT,
  olxUserId TEXT,
  wa_phone TEXT,
  city TEXT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  platform TEXT DEFAULT 'olx',
  ig_username TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','ready_to_send','sent','invalid_number','failed','replied','interested','deal','refused')),
  tags TEXT DEFAULT '[]',       -- JSON array of strings
  notes TEXT DEFAULT '',
  assigned_account TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  ai_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_contact_at TEXT,
  followup_count INTEGER DEFAULT 0,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
);

-- Аккаунты WhatsApp
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,           -- 'acc_1', 'acc_2', ...
  phone TEXT,
  name TEXT,
  avatar TEXT,                   -- base64 or file path
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK(status IN ('offline','online','banned','connecting')),
  warmup_active INTEGER NOT NULL DEFAULT 0,
  warmup_day INTEGER NOT NULL DEFAULT 0,
  warmup_total_days INTEGER NOT NULL DEFAULT 14,
  warmup_msgs_today INTEGER NOT NULL DEFAULT 0,
  warmup_msgs_target INTEGER NOT NULL DEFAULT 10,
  daily_limit INTEGER NOT NULL DEFAULT 50,
  sent_today INTEGER NOT NULL DEFAULT 0,
  allow_sender BOOLEAN NOT NULL DEFAULT 1,
  allow_warmup BOOLEAN NOT NULL DEFAULT 1,
  is_trusted BOOLEAN NOT NULL DEFAULT 0,
  last_seen TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- История сообщений
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK(direction IN ('out','in')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sent','delivered','read','failed')),
  wa_message_id TEXT,            -- WhatsApp message ID для трекинга
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Кампании (рассылки)
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL,
  source_url TEXT,               -- URL OLX/Instagram для парсинга
  platform TEXT DEFAULT 'olx',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','parsing','generating','ready','running','paused','done')),
  total_leads INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

-- Промпты для AI
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  model_name TEXT NOT NULL DEFAULT 'llama3',
  system_prompt TEXT NOT NULL DEFAULT '',
  message_template TEXT NOT NULL DEFAULT '',  -- поддерживает spintax + {{vars}}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Лог прогрева
CREATE TABLE IF NOT EXISTS warmup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account TEXT REFERENCES accounts(id),
  to_account TEXT REFERENCES accounts(id),
  message TEXT,
  scenario TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Настройки приложения
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Дефолтные настройки
INSERT OR IGNORE INTO settings VALUES ('monitor_phone', '');
INSERT OR IGNORE INTO settings VALUES ('monitor_interval_min', '60');
INSERT OR IGNORE INTO settings VALUES ('ollama_url', 'http://127.0.0.1:11434');
INSERT OR IGNORE INTO settings VALUES ('ollama_model', 'llama3');
INSERT OR IGNORE INTO settings VALUES ('openai_api_key', '');
INSERT OR IGNORE INTO settings VALUES ('sender_min_delay_sec', '120');
INSERT OR IGNORE INTO settings VALUES ('sender_max_delay_sec', '300');
INSERT OR IGNORE INTO settings VALUES ('sender_daily_limit', '50');
INSERT OR IGNORE INTO settings VALUES ('warmup_min_delay_sec', '100');
INSERT OR IGNORE INTO settings VALUES ('warmup_max_delay_sec', '250');

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL, -- 'parser', 'sender', 'ai', 'system'
  level TEXT NOT NULL DEFAULT 'error', -- 'error', 'warn', 'info'
  message TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);
