/**
 * Sender Module - async Supabase version
 */
import { getDb, getSetting } from '../../db/database.js';
import { sendMessage, sleep } from '../accounts/accountManager.js';
import { io } from '../../server.js';
import { systemLog } from '../../utils/logger.js';

let senderRunning = false;
let shouldStop = false;
let currentStats = { sent: 0, errors: 0, skipped: 0, total: 0 };

function distributeLeads(leads, accounts) {
  const chunks = accounts.map(() => []);
  leads.forEach((lead, i) => { chunks[i % accounts.length].push(lead); });
  return chunks;
}

async function sendChunk(account, leads, minDelaySec, maxDelaySec) {
  const db = getDb();

  for (const lead of leads) {
    if (shouldStop) break;

    const message = lead.ai_message;
    if (!message) {
      io.emit('sender:log', { message: `Skipped ${lead.phone}: no AI message`, type: 'skip' });
      currentStats.skipped++;
      continue;
    }

    const today = new Date().toISOString().slice(0, 10);
    const [{ c }] = await db`
      SELECT COUNT(*)::int as c FROM messages
      WHERE account_id = ${account.id} AND direction = 'out' AND sent_at::date = ${today}::date
    `;

    if (c >= account.daily_limit) {
      io.emit('sender:log', {
        message: `Account ${account.id} hit daily limit (${c}/${account.daily_limit})`,
        type: 'warn'
      });
      break;
    }

    if (currentStats.sent > 0 || currentStats.errors > 0) {
      await sleep(minDelaySec * 1000, maxDelaySec * 1000);
    }

    try {
      await sendMessage(account.id, lead.phone, message);

      await db`
        INSERT INTO messages (lead_id, account_id, direction, content, status)
        VALUES (${lead.id}, ${account.id}, 'out', ${message}, 'sent')
      `;

      await db`
        UPDATE leads SET status = 'sent', assigned_account = ${account.id}, last_contact_at = NOW()
        WHERE id = ${lead.id}
      `;

      currentStats.sent++;
      io.emit('sender:log', {
        message: `✓ Sent to ${lead.name || lead.phone} via ${account.id}`,
        type: 'success',
        leadId: lead.id,
        phone: lead.phone
      });
      io.emit('sender:stats', { ...currentStats });

    } catch (err) {
      console.error(`[Sender] Error sending to ${lead.phone}:`, err);
      let newStatus = 'failed';

      if (err.message && err.message.toLowerCase().includes('not on whatsapp')) {
        newStatus = 'invalid_number';
        io.emit('sender:log', { message: `⚠️ Number ${lead.phone} not on WhatsApp. Skipping.`, type: 'warn' });
        await systemLog('sender', 'warn', `Number not on WhatsApp: ${lead.phone}`);
      } else {
        io.emit('sender:log', { message: `❌ Error sending to ${lead.phone}: ${err.message}`, type: 'error' });
        await systemLog('sender', 'error', `Error sending to ${lead.phone}`, { error: err.message, account: account.id });
      }

      await db`UPDATE leads SET status = ${newStatus}, notes = ${err.message.substring(0, 200)} WHERE id = ${lead.id}`;
      await db`INSERT INTO messages (lead_id, account_id, direction, content, status) VALUES (${lead.id}, ${account.id}, 'out', ${message}, 'failed')`;

      currentStats.errors++;
      io.emit('sender:stats', { ...currentStats });
    }
  }
}

export async function startSending({ campaignId, accountIds }) {
  if (senderRunning) return { ok: false, message: 'Sender already running' };

  const db = getDb();

  let leads;
  if (campaignId) {
    leads = await db`SELECT * FROM leads WHERE ai_message IS NOT NULL AND status = 'ready_to_send' AND campaign_id = ${campaignId}`;
  } else {
    leads = await db`SELECT * FROM leads WHERE ai_message IS NOT NULL AND status = 'ready_to_send'`;
  }
  if (!leads.length) return { ok: false, message: 'No leads with AI messages ready to send' };

  let accounts;
  if (accountIds?.length) {
    accounts = await db`SELECT * FROM accounts WHERE status = 'online' AND allow_sender = true AND id = ANY(${accountIds})`;
  } else {
    accounts = await db`SELECT * FROM accounts WHERE status = 'online' AND allow_sender = true`;
  }
  if (!accounts.length) return { ok: false, message: 'No online accounts available' };

  senderRunning = true;
  shouldStop = false;
  currentStats = { sent: 0, errors: 0, skipped: 0, total: leads.length };

  const minDelaySec = Number((await getSetting('sender_min_delay_sec')) || 120);
  const maxDelaySec = Number((await getSetting('sender_max_delay_sec')) || 300);

  io.emit('sender:started', { total: leads.length, accounts: accounts.length });

  if (campaignId) {
    await db`UPDATE campaigns SET status = 'running', started_at = NOW() WHERE id = ${campaignId}`;
  }

  (async () => {
    try {
      const chunks = distributeLeads(leads, accounts);
      await Promise.all(chunks.map((chunk, i) => sendChunk(accounts[i], chunk, minDelaySec, maxDelaySec)));
    } catch (err) {
      io.emit('sender:error', { message: err.message });
    } finally {
      senderRunning = false;

      if (campaignId) {
        const [stats] = await db`
          SELECT COUNT(*)::int as sent FROM messages
          WHERE direction = 'out' AND lead_id IN (
            SELECT id FROM leads WHERE campaign_id = ${campaignId}
          )
        `;
        await db`UPDATE campaigns SET status = 'done', sent = ${stats.sent}, finished_at = NOW() WHERE id = ${campaignId}`;
      }

      io.emit('sender:done', currentStats);
    }
  })();

  return { ok: true, message: `Sending ${leads.length} messages via ${accounts.length} accounts` };
}

export function pauseSending() {
  shouldStop = true;
  senderRunning = false;
  io.emit('sender:paused', currentStats);
  return { ok: true };
}

export function getSenderStatus() {
  return { running: senderRunning, stats: currentStats };
}
