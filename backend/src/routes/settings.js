import { Router } from 'express';
import { getAllSettings, setSetting } from '../db/database.js';

const router = Router();

// GET all settings
router.get('/', async (_req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update settings
router.put('/', async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await setSetting(key, value);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
