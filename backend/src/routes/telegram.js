import { Router } from 'express';
import {
  connectTelegram,
  disconnectTelegram,
  getTelegramStatus,
  parseTelegramChat,
  searchTelegramChats,
  submitTelegramCode,
  submitTelegramPassword,
} from '../modules/parser/telegramParser.js';

const router = Router();

function sendError(res, error) {
  console.error('[Telegram]', error);
  res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

router.get('/status', (_req, res) => res.json({ ok: true, ...getTelegramStatus() }));

router.post('/connect', async (req, res) => {
  try {
    res.json({ ok: true, ...(await connectTelegram(req.body || {})) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/code', async (req, res) => {
  try {
    res.json({ ok: true, ...(await submitTelegramCode(req.body?.code)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/password', async (req, res) => {
  try {
    res.json({ ok: true, ...(await submitTelegramPassword(req.body?.password)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/disconnect', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await disconnectTelegram()) });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/search', async (req, res) => {
  try {
    const channelsOnly = String(req.query.channelsOnly || '').toLowerCase() === 'true';
    res.json({ ok: true, chats: await searchTelegramChats(req.query.q, req.query.limit, channelsOnly) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/parse', async (req, res) => {
  try {
    res.json({ ok: true, ...(await parseTelegramChat(req.body || {})) });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
