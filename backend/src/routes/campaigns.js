import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET all campaigns
router.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const campaigns = await db`
      SELECT c.*, p.name as prompt_name,
      (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id) as "leadsCount"
      FROM campaigns c
      LEFT JOIN prompts p ON c.prompt_id = p.id
      ORDER BY c.created_at DESC
    `;
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create campaign
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { name, prompt_id, source_url, is_manual } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    let finalName = name;
    if (is_manual && !name.startsWith('(+)')) {
      finalName = `(+) ${name}`;
    }

    const [campaign] = await db`
      INSERT INTO campaigns (name, prompt_id, source_url)
      VALUES (${finalName}, ${prompt_id || null}, ${source_url || null})
      RETURNING *
    `;
    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single campaign
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const [campaign] = await db`SELECT * FROM campaigns WHERE id = ${req.params.id}`;
    if (!campaign) return res.status(404).json({ error: 'not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET campaign stats
router.get('/:id/stats', async (req, res) => {
  try {
    const db = getDb();
    const [stats] = await db`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) as interested,
        SUM(CASE WHEN status = 'deal' THEN 1 ELSE 0 END) as deals,
        SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) as refused
      FROM leads WHERE campaign_id = ${req.params.id}
    `;
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update campaign
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { prompt_id } = req.body;
    const [campaign] = await db`
      UPDATE campaigns SET prompt_id = ${prompt_id || null}
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE campaign and its leads
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM leads WHERE campaign_id = ${req.params.id}`;
    await db`DELETE FROM campaigns WHERE id = ${req.params.id}`;
    res.json({ ok: true, message: 'Campaign deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
