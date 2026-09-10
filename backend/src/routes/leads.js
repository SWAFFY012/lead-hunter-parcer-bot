import { Router } from 'express';
import { getDb, getSetting, setSetting } from '../db/database.js';

const router = Router();
const DEFAULT_NICHES = ['Авто', 'Стройка', 'Адвокаты', 'Агентство недвижимости', 'Банкротство'];
const DEFAULT_OWNERS = ['Сергей', 'Александр'];

function parseLeadTags(lead) {
  if (!lead) return lead;
  let tags = lead.tags;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  return { ...lead, tags: Array.isArray(tags) ? tags : [] };
}

// GET leads with filters
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { status, campaign_id, account_id, search, niche, owner, limit = 100, offset = 0 } = req.query;

    // Build dynamic query using postgres.js fragment approach
    let conditions = db`1=1`;
    if (status) conditions = db`${conditions} AND status = ${status}`;
    if (campaign_id) conditions = db`${conditions} AND campaign_id = ${campaign_id}`;
    if (account_id) conditions = db`${conditions} AND assigned_account = ${account_id}`;
    if (search) conditions = db`${conditions} AND (name ILIKE ${'%' + search + '%'} OR phone ILIKE ${'%' + search + '%'} OR title ILIKE ${'%' + search + '%'})`;
    if (niche) conditions = db`${conditions} AND niche = ${niche}`;
    if (owner) conditions = db`${conditions} AND owner = ${owner}`;

    const [{ count }] = await db`SELECT COUNT(*)::int as count FROM leads WHERE ${conditions}`;
    const leads = await db`SELECT * FROM leads WHERE ${conditions} ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

    res.json({ leads: leads.map(parseLeadTags), total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create lead manually
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { name, phone, city, status, note, niche, owner } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    const [lead] = await db`
      INSERT INTO leads (name, phone, city, status, source, niche, owner, created_at)
      VALUES (${name || ''}, ${phone}, ${city || ''}, ${status || 'new'}, 'manual', ${niche || null}, ${owner || null}, NOW())
      ON CONFLICT (phone) DO NOTHING
      RETURNING *
    `;

    if (!lead) return res.status(409).json({ error: 'Lead with this phone already exists' });

    if (note && note.trim()) {
      await db`INSERT INTO lead_notes (lead_id, text) VALUES (${lead.id}, ${note.trim()})`;
    }

    res.status(201).json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST bulk import leads from map parser (Google/Yandex/2GIS)
router.post('/import', async (req, res) => {
  try {
    const db = getDb();
    const items = Array.isArray(req.body?.leads) ? req.body.leads : [];
    if (!items.length) return res.status(400).json({ error: 'Передайте хотя бы одного лида' });
    const batchNiche = req.body?.niche || null;
    const batchOwner = req.body?.owner || null;
    const batchRegion = req.body?.region || DEFAULT_REGION;

    let imported = 0;
    let skipped = 0;
    let updated = 0;

    for (const item of items) {
      // Номер приводим к E.164: из Карт он приходит в местном формате.
      const phone = normalizePhone(item?.phone, item?.region || batchRegion);
      if (!phone) { skipped++; continue; }

      const niche = item.niche || batchNiche;
      const owner = item.owner || batchOwner;

      const [lead] = await db`
        INSERT INTO leads (name, phone, title, city, website, source_url, platform, status, source, niche, owner, created_at)
        VALUES (
          ${item.name || ''}, ${phone}, ${item.title || ''}, ${item.address || ''},
          ${item.website || ''}, ${item.sourceUrl || ''}, ${item.platform || 'parser'},
          'new', 'map_parser', ${niche}, ${owner}, NOW()
        )
        ON CONFLICT (phone) DO NOTHING
        RETURNING id
      `;

      if (lead) {
        imported++;
        continue;
      }

      // Телефон уже есть: переносим существующего лида в выбранную воронку и/или на ответственного
      if (niche || owner) {
        const patch = {};
        if (niche) patch.niche = niche;
        if (owner) patch.owner = owner;

        const [moved] = await db`
          UPDATE leads SET ${db(patch)}
          WHERE phone = ${phone}
            AND (
              ${niche ? db`niche IS DISTINCT FROM ${niche}` : db`false`}
              OR ${owner ? db`owner IS DISTINCT FROM ${owner}` : db`false`}
            )
          RETURNING id
        `;
        if (moved) { updated++; continue; }
      }

      skipped++;
    }

    res.status(201).json({ imported, updated, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET niche presets (список для канбана: сохранённые + встречающиеся в БД)
router.get('/niches', async (_req, res) => {
  try {
    const db = getDb();
    const raw = await getSetting('niche_presets');
    let presets = [];
    if (raw) {
      try { presets = JSON.parse(raw); } catch { presets = []; }
    }
    if (!Array.isArray(presets) || presets.length === 0) presets = DEFAULT_NICHES;

    const rows = await db`SELECT DISTINCT niche FROM leads WHERE niche IS NOT NULL AND niche <> '' ORDER BY niche`;
    const used = rows.map(r => r.niche);

    const all = Array.from(new Set([...presets, ...used]));
    res.json({ niches: all, presets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT save niche presets list
router.put('/niches', async (req, res) => {
  try {
    const { niches } = req.body;
    if (!Array.isArray(niches)) return res.status(400).json({ error: 'niches must be an array' });
    const cleaned = niches.map(n => String(n).trim()).filter(Boolean);
    await setSetting('niche_presets', JSON.stringify(cleaned));
    res.json({ presets: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET owners (ответственные менеджеры: сохранённые + встречающиеся в БД)
router.get('/owners', async (_req, res) => {
  try {
    const db = getDb();
    const raw = await getSetting('owner_presets');
    let presets = [];
    if (raw) {
      try { presets = JSON.parse(raw); } catch { presets = []; }
    }
    if (!Array.isArray(presets) || presets.length === 0) presets = DEFAULT_OWNERS;

    const rows = await db`SELECT DISTINCT owner FROM leads WHERE owner IS NOT NULL AND owner <> '' ORDER BY owner`;
    const used = rows.map(r => r.owner);

    const all = Array.from(new Set([...presets, ...used]));
    res.json({ owners: all, presets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT save owners list
router.put('/owners', async (req, res) => {
  try {
    const { owners } = req.body;
    if (!Array.isArray(owners)) return res.status(400).json({ error: 'owners must be an array' });
    const cleaned = owners.map(o => String(o).trim()).filter(Boolean);
    await setSetting('owner_presets', JSON.stringify(cleaned));
    res.json({ presets: cleaned });
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
    const { campaign_id, status, replied_only, niche } = req.query;

    let conditions = db`1=1`;
    if (campaign_id) conditions = db`${conditions} AND campaign_id = ${campaign_id}`;
    if (status) conditions = db`${conditions} AND status = ${status}`;
    if (niche) conditions = db`${conditions} AND niche = ${niche}`;
    if (replied_only === 'true') conditions = db`${conditions} AND status IN ('replied','interested','deal')`;

    const leads = await db`SELECT * FROM leads WHERE ${conditions}`;

    const headers = ['id', 'phone', 'name', 'title', 'status', 'niche', 'city', 'ai_message', 'notes', 'created_at', 'last_contact_at'];
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
    res.json({ ...parseLeadTags(lead), messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update lead (name, status, notes, tags)
router.patch('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { name, status, notes, tags, agreement_status, niche, owner } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = JSON.stringify(tags);
    if (niche !== undefined) updates.niche = niche;
    if (owner !== undefined) updates.owner = owner;
    if (agreement_status !== undefined) {
      if (agreement_status !== 'green' && agreement_status !== 'red' && agreement_status !== null) {
        return res.status(400).json({ error: 'Invalid agreement_status' });
      }
      updates.agreement_status = agreement_status;
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const [lead] = await db`UPDATE leads SET ${db(updates)} WHERE id = ${req.params.id} RETURNING *`;
    res.json(parseLeadTags(lead));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET lead notes history
router.get('/:id/notes', async (req, res) => {
  try {
    const db = getDb();
    const notes = await db`SELECT * FROM lead_notes WHERE lead_id = ${req.params.id} ORDER BY created_at DESC`;
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add note to lead
router.post('/:id/notes', async (req, res) => {
  try {
    const db = getDb();
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

    const [lead] = await db`SELECT id FROM leads WHERE id = ${req.params.id}`;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const [note] = await db`
      INSERT INTO lead_notes (lead_id, text) VALUES (${req.params.id}, ${text.trim()})
      RETURNING *
    `;
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH edit note
router.patch('/:id/notes/:noteId', async (req, res) => {
  try {
    const db = getDb();
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

    const [note] = await db`
      UPDATE lead_notes SET text = ${text.trim()}
      WHERE id = ${req.params.noteId} AND lead_id = ${req.params.id}
      RETURNING *
    `;
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE note
router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM lead_notes WHERE id = ${req.params.noteId} AND lead_id = ${req.params.id}`;
    res.json({ ok: true });
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
import { normalizePhone, DEFAULT_REGION } from '../utils/phoneNormalizer.js';

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
