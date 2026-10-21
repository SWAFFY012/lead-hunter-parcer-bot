import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET tasks with filters (date range, lead)
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { date_from, date_to, lead_id } = req.query;

    let conditions = db`1=1`;
    if (date_from) conditions = db`${conditions} AND t.due_date >= ${date_from}`;
    if (date_to) conditions = db`${conditions} AND t.due_date <= ${date_to}`;
    if (lead_id) conditions = db`${conditions} AND t.lead_id = ${lead_id}`;

    const rows = await db`
      SELECT t.*,
        COALESCE(l.name, t.contact_name) AS lead_name,
        COALESCE(l.phone, t.contact_phone) AS lead_phone,
        l.title AS company_name
      FROM lead_tasks t
      LEFT JOIN leads l ON l.id = t.lead_id
      WHERE ${conditions}
      ORDER BY t.due_date ASC, t.time_start ASC
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create task
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { lead_id, contact_name, contact_phone, type, due_date, time_start, time_end, note } = req.body;

    if (!due_date) return res.status(400).json({ error: 'due_date обязателен' });

    const name = (contact_name || '').trim();
    const phone = (contact_phone || '').trim();
    if (!lead_id && !name && !phone) return res.status(400).json({ error: 'Укажите имя или телефон' });

    if (lead_id) {
      const [lead] = await db`SELECT id FROM leads WHERE id = ${lead_id}`;
      if (!lead) return res.status(404).json({ error: 'Лид не найден' });
    }

    const [task] = await db`
      INSERT INTO lead_tasks (lead_id, contact_name, contact_phone, type, due_date, time_start, time_end, note)
      VALUES (${lead_id || null}, ${name || null}, ${phone || null}, ${type || 'call'}, ${due_date}, ${time_start || null}, ${time_end || null}, ${note || null})
      RETURNING *
    `;
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update task
router.patch('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { type, due_date, time_start, time_end, note, result, status, contact_name, contact_phone } = req.body;
    const updates = {};

    if (contact_name !== undefined) updates.contact_name = (contact_name || '').trim() || null;
    if (contact_phone !== undefined) updates.contact_phone = (contact_phone || '').trim() || null;
    if (type !== undefined) updates.type = type;
    if (due_date !== undefined) updates.due_date = due_date;
    if (time_start !== undefined) updates.time_start = time_start;
    if (time_end !== undefined) updates.time_end = time_end;
    if (note !== undefined) updates.note = note;
    if (result !== undefined) updates.result = result;
    if (status !== undefined) {
      updates.status = status;
      if (status === 'done') updates.done_at = new Date();
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

    const [task] = await db`UPDATE lead_tasks SET ${db(updates)} WHERE id = ${req.params.id} RETURNING *`;
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE task
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM lead_tasks WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
