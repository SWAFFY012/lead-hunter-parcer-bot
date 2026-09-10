/**
 * Supabase Database Client
 * Replaces local SQLite (better-sqlite3) with cloud Postgres (Supabase via postgres.js)
 */
import 'dotenv/config';
import postgres from 'postgres';

const CONNECTION_STRING = process.env.SUPABASE_DB_URL;

let sql;

export function hasDatabaseConfig() {
  return Boolean(CONNECTION_STRING);
}

export function getDb() {
  if (!CONNECTION_STRING) {
    throw new Error('SUPABASE_DB_URL is not configured. Copy .env.example to .env and add your database URL.');
  }

  if (!sql) {
    const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(CONNECTION_STRING);
    sql = postgres(CONNECTION_STRING, {
      ssl: isLocal ? false : 'require',
      max: 10, // connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });
    console.log(`[DB] PostgreSQL connected (${isLocal ? 'local' : 'remote/SSL'})`);
  }
  return sql;
}

// Run auto-migrations to ensure new columns exist
export async function runMigrations() {
  const db = getDb();
  try {
    // Add reaction_timestamp column for Instagram workflow if not exists
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS reaction_timestamp TIMESTAMPTZ
    `;
    
    // Add website column for Google Maps parser
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT
    `;
    // Ensure ai_ready and message_sent statuses exist in check constraint
    // Note: Supabase/PG doesn't support ALTER CHECK constraint easily,
    // so we drop and re-add
    await db`
      ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check
    `;
    await db`
      ALTER TABLE leads ADD CONSTRAINT leads_status_check
      CHECK (status IN ('new','ai_ready','reaction_sent','message_sent','ready_to_send','sent','invalid_number','failed','replied','interested','deal','refused','contact','call','meeting_scheduled','meeting_done','proposal'))
    `;

    // Ручное добавление лидов: помечаем источник, чтобы отличать от парсера
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'parser'
    `;

    // История заметок по лиду (раньше было одно поле leads.notes, теперь список с датами)
    await db`
      CREATE TABLE IF NOT EXISTS lead_notes (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id)
    `;

    // Задачи по лидам (Связаться / Встреча) — ежедневник СРМ
    await db`
      CREATE TABLE IF NOT EXISTS lead_tasks (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'call' CHECK (type IN ('call','meeting')),
        due_date DATE NOT NULL,
        time_start TEXT,
        time_end TEXT,
        note TEXT,
        result TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        done_at TIMESTAMPTZ
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead ON lead_tasks(lead_id)`;
    await db`CREATE INDEX IF NOT EXISTS idx_lead_tasks_due_date ON lead_tasks(due_date)`;

    // Пометка лида зелёным (согласен) / красным (не согласен) — СРМ
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS agreement_status TEXT
      CHECK (agreement_status IN ('green','red'))
    `;

    // Ниша лида (авто/стройка/адвокаты и т.д.) — для канбана по воронкам
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS niche TEXT
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_leads_niche ON leads(niche)
    `;

    // Ответственный менеджер за лида (Сергей/Александр)
    await db`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner TEXT
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner)
    `;

    console.log('[DB] Migrations applied successfully');
  } catch (err) {
    // Constraint may already be correct — safe to ignore
    console.log('[DB] Migration note:', err.message);
  }
}

// ── Settings helpers ──
export async function getSetting(key) {
  const db = getDb();
  const rows = await db`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  const db = getDb();
  await db`
    INSERT INTO settings (key, value) VALUES (${key}, ${String(value)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function getAllSettings() {
  const db = getDb();
  const rows = await db`SELECT key, value FROM settings`;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── System logger ──
export async function dbLog(module, level, message, details = null) {
  try {
    const db = getDb();
    await db`
      INSERT INTO system_logs (module, level, message, details)
      VALUES (${module}, ${level}, ${message}, ${details ? JSON.stringify(details) : null})
    `;
  } catch (err) {
    console.error('[DB Log Error]', err.message);
  }
}
