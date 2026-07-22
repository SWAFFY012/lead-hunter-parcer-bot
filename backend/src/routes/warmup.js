import { Router } from 'express';
import { getDb } from '../db/database.js';
import {
  startWarmup, stopWarmup, getWarmupStatus, setAccountWarmup
} from '../modules/warmup/warmupManager.js';

const router = Router();

router.get('/status', async (_req, res) => {
  try { res.json(await getWarmupStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/start', (_req, res) => {
  try { res.json(startWarmup()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/stop', (_req, res) => {
  try { res.json(stopWarmup()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Configure warmup for specific account
router.patch('/accounts/:id', async (req, res) => {
  try {
    const { active, total_days, msgs_target } = req.body;
    await setAccountWarmup(req.params.id, active, total_days, msgs_target);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get warmup logs
router.get('/logs', async (req, res) => {
  try {
    const db = getDb();
    const { limit = 50 } = req.query;
    const logs = await db`
      SELECT wl.*, a1.name as from_name, a2.name as to_name
      FROM warmup_log wl
      LEFT JOIN accounts a1 ON wl.from_account = a1.id
      LEFT JOIN accounts a2 ON wl.to_account = a2.id
      ORDER BY wl.sent_at DESC LIMIT ${Number(limit)}
    `;
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message }); }
});

export default router;
