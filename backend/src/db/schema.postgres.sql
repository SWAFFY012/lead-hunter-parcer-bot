-- Базовая схема LeadHunter для PostgreSQL (Supabase).
-- Выполняется при старте бэкенда (runMigrations), все команды идемпотентны:
-- на пустой базе создаёт таблицы, на существующей ничего не меняет.
-- Дальнейшие колонки (leads.niche, lead_tasks и т.д.) добавляет runMigrations.

CREATE TABLE IF NOT EXISTS prompts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  model_name TEXT NOT NULL DEFAULT 'llama3',
  system_prompt TEXT NOT NULL DEFAULT '',
  message_template TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL,
  source_url TEXT,
  platform TEXT DEFAULT 'olx',
  status TEXT NOT NULL DEFAULT 'draft',
  total_leads INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  phone TEXT,
  name TEXT,
  avatar TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  warmup_active BOOLEAN NOT NULL DEFAULT FALSE,
  warmup_day INTEGER NOT NULL DEFAULT 0,
  warmup_total_days INTEGER NOT NULL DEFAULT 14,
  warmup_msgs_today INTEGER NOT NULL DEFAULT 0,
  warmup_msgs_target INTEGER NOT NULL DEFAULT 10,
  daily_limit INTEGER NOT NULL DEFAULT 50,
  sent_today INTEGER NOT NULL DEFAULT 0,
  allow_sender BOOLEAN NOT NULL DEFAULT TRUE,
  allow_warmup BOOLEAN NOT NULL DEFAULT TRUE,
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen TIMESTAMPTZ,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  title TEXT,
  ad_text TEXT,
  source_url TEXT,
  "olxUserId" TEXT,
  wa_phone TEXT,
  city TEXT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  platform TEXT DEFAULT 'olx',
  ig_username TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  tags TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  assigned_account TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  ai_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ,
  followup_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  wa_message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warmup_log (
  id SERIAL PRIMARY KEY,
  from_account TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  to_account TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  message TEXT,
  scenario TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  module TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS browser_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  viewport_width INTEGER DEFAULT 1366,
  viewport_height INTEGER DEFAULT 768,
  locale TEXT DEFAULT 'uk-UA',
  timezone TEXT DEFAULT 'Europe/Kiev',
  platform TEXT DEFAULT 'MacIntel',
  hardware_concurrency INTEGER DEFAULT 4,
  device_memory INTEGER DEFAULT 8,
  webgl_vendor TEXT DEFAULT 'Google Inc.',
  webgl_renderer TEXT DEFAULT 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
  canvas_noise REAL DEFAULT 0.01,
  session_path TEXT,
  proxy TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parsing_tasks (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  platform TEXT DEFAULT 'instagram',
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  profile_id TEXT,
  pages INTEGER DEFAULT 3,
  filters TEXT,
  total_leads INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instagram_visited_posts (
  post_url TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES parsing_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (post_url, task_id)
);

CREATE TABLE IF NOT EXISTS instagram_visited_users (
  username TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES parsing_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (username, task_id)
);

CREATE TABLE IF NOT EXISTS google_visited_places (
  place_id TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES parsing_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (place_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);

INSERT INTO settings (key, value) VALUES
  ('monitor_phone', ''),
  ('monitor_interval_min', '60'),
  ('ollama_url', 'http://127.0.0.1:11434'),
  ('ollama_model', 'llama3'),
  ('openai_api_key', ''),
  ('sender_min_delay_sec', '120'),
  ('sender_max_delay_sec', '300'),
  ('sender_daily_limit', '50'),
  ('warmup_min_delay_sec', '100'),
  ('warmup_max_delay_sec', '250')
ON CONFLICT (key) DO NOTHING;
