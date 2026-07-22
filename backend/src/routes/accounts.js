import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, existsSync } from 'fs';

import { getDb } from '../db/database.js';
import { connectAccount, disconnectAccount } from '../modules/accounts/accountManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '../../sessions');

const router = Router();

// GET all accounts
router.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const accounts = await db`SELECT * FROM accounts ORDER BY added_at ASC`;
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new account (triggers QR)
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required (e.g. acc_1)' });

    const existing = await db`SELECT id FROM accounts WHERE id = ${id}`;
    if (existing.length > 0) return res.status(409).json({ error: 'Account ID already exists' });

    await db`INSERT INTO accounts (id, status) VALUES (${id}, 'offline')`;

    connectAccount(id).catch(err => console.error('[Accounts] Connect error:', err));
    res.status(201).json({ id, status: 'connecting', message: 'QR will be sent via WebSocket' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE account
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    await disconnectAccount(id);

    const sessionPath = join(SESSIONS_DIR, id);
    if (existsSync(sessionPath)) rmSync(sessionPath, { recursive: true, force: true });

    await db`DELETE FROM accounts WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST reconnect account
router.post('/:id/reconnect', async (req, res) => {
  try {
    await connectAccount(req.params.id);
    res.json({ ok: true, message: 'Reconnecting...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update account settings (daily_limit, etc.)
router.patch('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { daily_limit } = req.body;
    if (daily_limit !== undefined) {
      await db`UPDATE accounts SET daily_limit = ${Number(daily_limit)} WHERE id = ${req.params.id}`;
    }
    const [acc] = await db`SELECT * FROM accounts WHERE id = ${req.params.id}`;
    res.json(acc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update account permissions
router.patch('/:id/permissions', async (req, res) => {
  try {
    const db = getDb();
    const { allow_sender, allow_warmup, is_trusted } = req.body;
    const updates = {};
    if (allow_sender !== undefined) updates.allow_sender = !!allow_sender;
    if (allow_warmup !== undefined) updates.allow_warmup = !!allow_warmup;
    if (is_trusted !== undefined) updates.is_trusted = !!is_trusted;

    if (Object.keys(updates).length > 0) {
      await db`UPDATE accounts SET ${db(updates)} WHERE id = ${req.params.id}`;
    }

    const [acc] = await db`SELECT * FROM accounts WHERE id = ${req.params.id}`;
    res.json(acc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
