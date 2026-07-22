import 'dotenv/config';
import postgres from 'postgres';
const CONNECTION_STRING = process.env.SUPABASE_DB_URL;

if (!CONNECTION_STRING) {
  throw new Error('SUPABASE_DB_URL is not configured.');
}

const sql = postgres(CONNECTION_STRING, { ssl: 'require' });

async function fix() {
  await sql`
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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
    );
  `;
  console.log('browser_profiles created');
  process.exit();
}
fix();
