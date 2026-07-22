import { getDb, getSetting } from '../../db/database.js';
import { sendMessage } from '../accounts/accountManager.js';
import { io } from '../../server.js';

let intervalId = null;

const DEFAULT_FOLLOWUP_TEXT = 'Здравствуйте! Подскажите, удалось ли ознакомиться с моим предыдущим сообщением? Буду рад ответить на любые вопросы.';

export function startFollowupManager() {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    try {
      const db = getDb();
      const enabled = (await getSetting('enable_followups')) !== 'false';
      if (!enabled) return;

      const leads = await db`
        SELECT * FROM leads 
        WHERE status = 'sent' 
          AND followup_count = 0 
          AND last_contact_at <= NOW() - INTERVAL '24 hours'
      `;

      for (const lead of leads) {
        if (!lead.assigned_account) continue;

        console.log(`[Followup] Sending follow-up to ${lead.phone} (Lead ID: ${lead.id})`);
        
        try {
          await sendMessage(lead.assigned_account, lead.phone, DEFAULT_FOLLOWUP_TEXT);

          await db`
            UPDATE leads 
            SET followup_count = 1, last_contact_at = NOW() 
            WHERE id = ${lead.id}
          `;

          await db`
            INSERT INTO messages (lead_id, account_id, direction, content, status)
            VALUES (${lead.id}, ${lead.assigned_account}, 'out', ${DEFAULT_FOLLOWUP_TEXT}, 'sent')
          `;

          io.emit('sender:log', { 
            message: `Отправлен follow-up (дожим) лиду ${lead.name || lead.phone}`, 
            type: 'info' 
          });
        } catch (err) {
          console.error(`[Followup] Failed to send follow-up to ${lead.phone}:`, err);
        }

        const delay = Math.floor(Math.random() * 20000) + 10000;
        await new Promise(res => setTimeout(res, delay));
      }
    } catch (err) {
      console.error('[Followup] Manager error:', err);
    }
  }, 10 * 60 * 1000);
  
  console.log('[Followup] Manager started (runs every 10 min)');
}

export function stopFollowupManager() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Followup] Manager stopped');
  }
}
