import cron from 'node-cron';
import { getDb, getSetting } from '../../db/database.js';
import { sendMessage } from '../accounts/accountManager.js';

let monitorTask = null;
let monitorRunning = false;

async function buildReport() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const [{ c: sentToday }] = await db`
    SELECT COUNT(*)::int as c FROM messages WHERE direction='out' AND sent_at::date = ${today}::date
  `;

  const [{ c: repliedToday }] = await db`
    SELECT COUNT(DISTINCT lead_id)::int as c FROM messages WHERE direction='in' AND sent_at::date = ${today}::date
  `;

  const [{ c: errors }] = await db`
    SELECT COUNT(*)::int as c FROM messages WHERE status='failed' AND sent_at::date = ${today}::date
  `;

  const [{ c: onlineAccounts }] = await db`
    SELECT COUNT(*)::int as c FROM accounts WHERE status='online'
  `;

  const convRate = sentToday > 0 ? ((repliedToday / sentToday) * 100).toFixed(1) : '0';

  return `📊 *LeadHunter Report*\n\n` +
    `📤 Отправлено: ${sentToday}\n` +
    `💬 Ответили: ${repliedToday}\n` +
    `📈 Конверсия: ${convRate}%\n` +
    `❌ Ошибок: ${errors}\n` +
    `⚡ Аккаунтов онлайн: ${onlineAccounts}\n\n` +
    `🕐 ${new Date().toLocaleTimeString('ru-RU')}`;
}

export async function startMonitor() {
  const intervalMin = Number((await getSetting('monitor_interval_min')) || 60);
  const monitorPhone = await getSetting('monitor_phone');

  if (!monitorPhone) {
    console.log('[Monitor] No monitor phone configured, skipping');
    return { ok: false, message: 'No monitor phone configured' };
  }

  if (monitorTask) monitorTask.stop();

  const cronExpr = `*/${intervalMin} * * * *`;

  monitorTask = cron.schedule(cronExpr, async () => {
    try {
      const db = getDb();
      const report = await buildReport();

      const [onlineAccount] = await db`SELECT id FROM accounts WHERE status='online' LIMIT 1`;
      if (!onlineAccount) return;

      await sendMessage(onlineAccount.id, monitorPhone, report);
      console.log('[Monitor] Report sent to', monitorPhone);
    } catch (err) {
      console.error('[Monitor] Failed to send report:', err.message);
    }
  });

  monitorRunning = true;
  console.log(`[Monitor] Started — reporting every ${intervalMin} minutes to ${monitorPhone}`);
  return { ok: true, message: `Monitor started, reporting every ${intervalMin} min` };
}

export function stopMonitor() {
  if (monitorTask) { monitorTask.stop(); monitorTask = null; }
  monitorRunning = false;
  return { ok: true };
}

export async function getMonitorStatus() {
  return {
    running: monitorRunning,
    phone: await getSetting('monitor_phone'),
    interval: await getSetting('monitor_interval_min'),
    lastReport: monitorRunning ? await buildReport() : null
  };
}
