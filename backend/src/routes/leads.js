import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET leads with filters
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { status, campaign_id, account_id, search, limit = 100, offset = 0 } = req.query;

    // Build dynamic query using postgres.js fragment approach
    let conditions = db`1=1`;
    if (status) conditions = db`${conditions} AND status = ${status}`;
    if (campaign_id) conditions = db`${conditions} AND campaign_id = ${campaign_id}`;
    if (account_id) conditions = db`${conditions} AND assigned_account = ${account_id}`;
    if (search) conditions = db`${conditions} AND (name ILIKE ${'%' + search + '%'} OR phone ILIKE ${'%' + search + '%'} OR title ILIKE ${'%' + search + '%'})`;

    const [{ count }] = await db`SELECT COUNT(*)::int as count FROM leads WHERE ${conditions}`;
    const leads = await db`SELECT * FROM leads WHERE ${conditions} ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

    res.json({ leads, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET dashboard stats  
router.get('/stats/dashboard', async (_req, res) => {
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const [totals] = await db`
      SELECT 
        COUNT(*)::int as total,
        SUM(CASE WHEN status='new' THEN 1 ELSE 0 END)::int as new_leads,
        SUM(CASE WHEN status='ready_to_send' THEN 1 ELSE 0 END)::int as ready_to_send,
        SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END)::int as sent,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int as failed,
        SUM(CASE WHEN status='invalid_number' THEN 1 ELSE 0 END)::int as invalid_number,
        SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END)::int as replied,
        SUM(CASE WHEN status='interested' THEN 1 ELSE 0 END)::int as interested,
        SUM(CASE WHEN status='deal' THEN 1 ELSE 0 END)::int as deals,
        SUM(CASE WHEN status='refused' THEN 1 ELSE 0 END)::int as refused
      FROM leads
    `;

    const [todayStats] = await db`
      SELECT COUNT(*)::int as sent_today FROM messages 
      WHERE direction='out' AND sent_at::date = ${today}::date
    `;

    const [repliedToday] = await db`
      SELECT COUNT(DISTINCT lead_id)::int as replied_today FROM messages 
      WHERE direction='in' AND sent_at::date = ${today}::date
    `;

    const weekActivity = await db`
      SELECT sent_at::date as day, 
             SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END)::int as sent,
             SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END)::int as received
      FROM messages
      WHERE sent_at >= NOW() - INTERVAL '7 days'
      GROUP BY sent_at::date ORDER BY sent_at::date ASC
    `;

    res.json({ totals, todayStats, repliedToday, weekActivity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET export as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const db = getDb();
    const { campaign_id, status, replied_only } = req.query;

    let conditions = db`1=1`;
    if (campaign_id) conditions = db`${conditions} AND campaign_id = ${campaign_id}`;
    if (status) conditions = db`${conditions} AND status = ${status}`;
    if (replied_only === 'true') conditions = db`${conditions} AND status IN ('replied','interested','deal')`;

    const leads = await db`SELECT * FROM leads WHERE ${conditions}`;

    const headers = ['id', 'phone', 'name', 'title', 'status', 'city', 'ai_message', 'notes', 'created_at', 'last_contact_at'];
    const csv = [
      headers.join(','),
      ...leads.map(l => headers.map(h => `"${(l[h] || '').toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET lead messages
router.get('/:id/messages', async (req, res) => {
  try {
    const db = getDb();
    const messages = await db`SELECT * FROM messages WHERE lead_id = ${req.params.id} ORDER BY sent_at ASC`;
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET lead by id with messages
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const [lead] = await db`SELECT * FROM leads WHERE id = ${req.params.id}`;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    
    const messages = await db`SELECT * FROM messages WHERE lead_id = ${lead.id} ORDER BY sent_at ASC`;
    res.json({ ...lead, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update lead (status, notes, tags)
router.patch('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { status, notes, tags } = req.body;
    const updates = {};

    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = JSON.stringify(tags);

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const [lead] = await db`UPDATE leads SET ${db(updates)} WHERE id = ${req.params.id} RETURNING *`;
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE lead
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM leads WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST reply to lead
import { sendMessage } from '../modules/accounts/accountManager.js';

router.post('/:id/reply', async (req, res) => {
  try {
    const db = getDb();
    const [lead] = await db`SELECT * FROM leads WHERE id = ${req.params.id}`;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.assigned_account) return res.status(400).json({ error: 'Lead has no assigned account to reply from' });

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    await sendMessage(lead.assigned_account, lead.phone, text);

    const [savedMsg] = await db`
      INSERT INTO messages (lead_id, account_id, direction, content, status)
      VALUES (${lead.id}, ${lead.assigned_account}, 'out', ${text}, 'sent')
      RETURNING *
    `;

    await db`UPDATE leads SET last_contact_at = NOW() WHERE id = ${lead.id}`;

    res.json(savedMsg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

import { generateOllamaText } from '../modules/ai/ollamaClient.js';

// POST generate AI reply based on chat history
router.post('/:id/generate_reply', async (req, res) => {
  try {
    const db = getDb();
    const [lead] = await db`SELECT * FROM leads WHERE id = ${req.params.id}`;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const messages = await db`SELECT * FROM messages WHERE lead_id = ${req.params.id} ORDER BY sent_at DESC LIMIT 5`;
    messages.reverse();

    if (messages.length === 0) return res.status(400).json({ error: 'No message history to generate reply from' });

    const historyText = messages.map(m => `${m.direction === 'in' ? 'Клиент' : 'Менеджер'}: ${m.content}`).join('\n');

    const ollamaRows = await db`SELECT value FROM settings WHERE key = 'ollama_url'`;
    const modelRows = await db`SELECT value FROM settings WHERE key = 'ollama_model'`;
    const sUrl = ollamaRows[0]?.value || 'http://localhost:11434';
    const sModel = modelRows[0]?.value || 'qwen2.5:1.5b';

    const systemPrompt = `Ты - опытный B2B менеджер по продажам.`;
    const promptText = `История переписки:\n${historyText}\n\nНапиши следующий ответ менеджера:`;

    const generatedText = await generateOllamaText(sUrl, sModel, promptText, systemPrompt);
    const cleanText = generatedText.replace(/^Менеджер:\s*/i, '').replace(/^"|"$/g, '').trim();

    res.json({ text: cleanText });
  } catch (err) {
    console.error('generate_reply error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
