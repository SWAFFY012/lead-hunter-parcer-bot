import { getDb, getSetting } from '../../db/database.js';
import { sendWarmupMessage, sleep } from '../accounts/accountManager.js';
import { io } from '../../server.js';
import { generateOllamaText } from '../ai/ollamaClient.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

let warmupTimer = null;
let isRunning = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LIBRARY_PATH = path.join(__dirname, 'warmupLibrary.json');

async function generateWarmupScenario() {
  try {
    const rawData = fs.readFileSync(LIBRARY_PATH, 'utf-8');
    const library = JSON.parse(rawData);
    const scenarioIndex = Math.floor(Math.random() * library.length);
    const scenarioTemplate = library[scenarioIndex];
    const messages = [];
    for (const stepVariations of scenarioTemplate) {
      const variationIndex = Math.floor(Math.random() * stepVariations.length);
      messages.push(stepVariations[variationIndex]);
    }
    return messages;
  } catch (err) {
    console.error('[Warmup] Failed to load Spintax library, fallback used:', err);
    return ['Привет!', 'Привет, как дела?', 'Всё хорошо, спасибо.', 'Понятно, удачи!'];
  }
}

async function runWarmupCycle() {
  const db = getDb();
  const minDelay = Number((await getSetting('warmup_min_delay_sec')) || 100) * 1000;
  const maxDelay = Number((await getSetting('warmup_max_delay_sec')) || 250) * 1000;

  const onlineAccounts = await db`SELECT * FROM accounts WHERE status='online' AND warmup_active=true AND allow_warmup=true`;

  if (onlineAccounts.length < 2) {
    io.emit('warmup:log', { message: 'Not enough online accounts for warmup (need at least 2)', type: 'warn' });
    return;
  }

  let accA, accB;
  const trusted = onlineAccounts.filter(a => a.is_trusted);
  const normal = onlineAccounts.filter(a => !a.is_trusted);

  if (trusted.length > 0 && normal.length > 0) {
    accA = trusted[Math.floor(Math.random() * trusted.length)];
    accB = normal[Math.floor(Math.random() * normal.length)];
    if (Math.random() > 0.5) [accA, accB] = [accB, accA];
  } else {
    const shuffled = [...onlineAccounts].sort(() => Math.random() - 0.5);
    accA = shuffled[0];
    accB = shuffled[1];
  }

  const today = new Date().toISOString().slice(0, 10);
  const [{ c }] = await db`
    SELECT COUNT(*)::int as c FROM warmup_log WHERE from_account=${accA.id} AND sent_at::date = ${today}::date
  `;
  const sentToday = c;

  const day = Math.min(accA.warmup_day, 7);
  const minTarget = 3 + (50 - 3) * (day / 7);
  const maxTarget = 10 + (70 - 10) * (day / 7);
  const dynamicTarget = Math.round((minTarget + maxTarget) / 2);

  if (sentToday >= dynamicTarget) {
    io.emit('warmup:log', { message: `${accA.id}: daily warmup limit reached (${sentToday}/${dynamicTarget})`, type: 'info' });
    return;
  }

  const messages = await generateWarmupScenario();

  io.emit('warmup:log', {
    message: `Starting warmup conversation: ${accA.id} ↔ ${accB.id} (Day ${accA.warmup_day}, Target: ${dynamicTarget})`,
    type: 'info',
    accounts: [accA.id, accB.id]
  });

  let sender = accA;
  let receiver = accB;

  for (const msgText of messages) {
    if (!isRunning) break;

    try {
      await sendWarmupMessage(sender.id, receiver.id, msgText);

      await db`
        INSERT INTO warmup_log (from_account, to_account, message, scenario)
        VALUES (${sender.id}, ${receiver.id}, ${msgText}, 'spintax-generated')
      `;

      await db`UPDATE accounts SET warmup_msgs_today = warmup_msgs_today + 1 WHERE id=${sender.id}`;

      io.emit('warmup:message', {
        from: sender.id,
        to: receiver.id,
        message: msgText,
        timestamp: new Date().toISOString()
      });

      const delay = Math.round(minDelay + Math.random() * (maxDelay - minDelay));
      io.emit('warmup:log', { message: `Waiting ${Math.round(delay/1000)}s before next message...`, type: 'info' });
      await sleep(minDelay, maxDelay);

      [sender, receiver] = [receiver, sender];
    } catch (err) {
      io.emit('warmup:log', { message: `Warmup error: ${err.message}`, type: 'error' });
    }
  }

  const newDay = Math.min(accA.warmup_day + 1, accA.warmup_total_days);
  await db`UPDATE accounts SET warmup_day=${newDay} WHERE id=${accA.id}`;

  io.emit('warmup:progress', {
    accountId: accA.id,
    day: newDay,
    totalDays: accA.warmup_total_days
  });
}

export function startWarmup() {
  if (isRunning) return { ok: false, message: 'Already running' };

  isRunning = true;
  io.emit('warmup:status', { running: true });

  const resetCron = () => {
    const now = new Date();
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
    setTimeout(async () => {
      await getDb()`UPDATE accounts SET warmup_msgs_today=0`;
      resetCron();
    }, msUntilMidnight);
  };
  resetCron();

  const scheduleCycle = async () => {
    if (!isRunning) return;
    try {
      await runWarmupCycle();
    } catch (err) {
      console.error('[Warmup] Cycle error:', err);
    }

    if (isRunning) {
      const waitMs = (30 + Math.random() * 60) * 60 * 1000;
      warmupTimer = setTimeout(scheduleCycle, waitMs);
      io.emit('warmup:log', {
        message: `Next warmup cycle in ${Math.round(waitMs / 60000)} minutes`,
        type: 'info'
      });
    }
  };

  scheduleCycle();
  return { ok: true, message: 'Warmup started' };
}

export function stopWarmup() {
  isRunning = false;
  if (warmupTimer) { clearTimeout(warmupTimer); warmupTimer = null; }
  io.emit('warmup:status', { running: false });
  return { ok: true, message: 'Warmup stopped' };
}

export async function getWarmupStatus() {
  const db = getDb();
  const accounts = await db`
    SELECT id, name, warmup_active, warmup_day, warmup_total_days, warmup_msgs_today, warmup_msgs_target
    FROM accounts
  `;
  return { running: isRunning, accounts };
}

export async function setAccountWarmup(accountId, active, totalDays, msgsTarget) {
  const db = getDb();
  await db`
    UPDATE accounts 
    SET warmup_active=${!!active}, warmup_total_days=${totalDays || 14}, warmup_msgs_target=${msgsTarget || 10}
    WHERE id=${accountId}
  `;
}
