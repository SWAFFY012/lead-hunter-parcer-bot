import { dbLog } from '../db/database.js';

export async function systemLog(module, level, message, details = null) {
  console.log(`[${module.toUpperCase()}] [${level}] ${message}`);
  await dbLog(module, level, message, details);
}
