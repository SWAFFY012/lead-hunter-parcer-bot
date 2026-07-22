import 'dotenv/config';
import postgres from 'postgres';

if (!process.env.SUPABASE_DB_URL) {
  throw new Error('SUPABASE_DB_URL is not configured.');
}

const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: 'require' });

async function test() {
  try {
    const result = await sql`SELECT 1 as result`;
    console.log('Connection successful:', result);
  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    process.exit();
  }
}
test();
