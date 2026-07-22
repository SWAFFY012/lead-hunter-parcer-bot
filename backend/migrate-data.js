import 'dotenv/config';
import Database from 'better-sqlite3';
import postgres from 'postgres';
import path from 'path';

const CONNECTION_STRING = process.env.SUPABASE_DB_URL;

if (!CONNECTION_STRING) {
  throw new Error('SUPABASE_DB_URL is not configured.');
}

const sql = postgres(CONNECTION_STRING, { ssl: 'require' });

// Use the old sqlite db
const dbPath = path.resolve('../data/leads.db');
const sqlite = new Database(dbPath, { readonly: true });

async function migrateTable(tableName, orderByCol = 'id') {
  console.log(`Migrating table: ${tableName}...`);
  try {
    const rows = sqlite.prepare(`SELECT * FROM ${tableName} ORDER BY ${orderByCol}`).all();
    if (rows.length === 0) {
      console.log(`  No data in ${tableName}.`);
      return;
    }

    // Convert stringified booleans if necessary, and handle sqlite's 0/1 for booleans
    // Since sqlite stores booleans as 0/1, postgres will complain if we insert 0/1 into boolean columns
    // We don't have schema info readily available, so we just let postgres figure out types unless we strictly know.
    // Actually, postgres.js handles basic types. For booleans stored as 1/0, we might get errors.
    
    // Some tables have specific boolean columns. Let's map them.
    const boolColumns = {
      'accounts': ['allow_sender', 'allow_warmup', 'warmup_active', 'is_trusted'],
      'settings': [],
    };
    
    const formattedRows = rows.map(row => {
      const newRow = { ...row };
      if (newRow.olxUserId !== undefined) {
        newRow.olxuserid = newRow.olxUserId;
        delete newRow.olxUserId;
      }
      if (boolColumns[tableName]) {
        for (const col of boolColumns[tableName]) {
          if (newRow[col] !== null && newRow[col] !== undefined) {
            newRow[col] = !!newRow[col];
          }
        }
      }
      return newRow;
    });

    // Chunk the inserts (e.g., 500 rows at a time)
    const chunkSize = 500;
    for (let i = 0; i < formattedRows.length; i += chunkSize) {
      const chunk = formattedRows.slice(i, i + chunkSize);
      await sql`INSERT INTO ${sql(tableName)} ${sql(chunk)} ON CONFLICT DO NOTHING`;
    }

    console.log(`  ✅ Migrated ${rows.length} rows to ${tableName}.`);
    
    // Fix sequences if the table has an auto-incrementing ID
    if (formattedRows[0].id && typeof formattedRows[0].id === 'number') {
      try {
        await sql`SELECT setval(pg_get_serial_sequence(${tableName}, 'id'), (SELECT MAX(id) FROM ${sql(tableName)}))`;
      } catch (e) {
         // ignore if no sequence
      }
    }
  } catch (err) {
    console.error(`  ❌ Failed to migrate ${tableName}:`, err.message);
  }
}

async function runMigration() {
  console.log('--- Starting Data Migration from SQLite to Supabase ---');

  // Clear existing data (optional, but since we recreate it's better to just ensure it's empty)
  // Disable triggers if needed, but we can just use ON CONFLICT DO NOTHING above.

  const tables = [
    { name: 'settings', orderCol: 'key' },
    { name: 'prompts', orderCol: 'id' },
    { name: 'accounts', orderCol: 'id' },
    { name: 'campaigns', orderCol: 'id' },
    { name: 'browser_profiles', orderCol: 'id' },
    { name: 'parsing_tasks', orderCol: 'id' },
    { name: 'leads', orderCol: 'id' },
    { name: 'messages', orderCol: 'id' },
    { name: 'warmup_log', orderCol: 'id' },
    { name: 'system_logs', orderCol: 'id' },
    { name: 'instagram_visited_posts', orderCol: 'post_url' },
    { name: 'instagram_visited_users', orderCol: 'username' }
  ];

  for (const table of tables) {
    await migrateTable(table.name, table.orderCol);
  }

  console.log('--- Migration Complete ---');
  await sql.end();
  sqlite.close();
}

runMigration().catch(console.error);
