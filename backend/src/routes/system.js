import { Router } from 'express';
import { getSenderStatus, pauseSending } from '../modules/sender/senderManager.js';
import { getParserStatus, stopParsing } from '../modules/parser/olxParser.js';
import { getDb } from '../db/database.js';

const router = Router();

// Get overall system status
router.get('/status', (req, res) => {
  try {
    const sender = getSenderStatus();
    const parser = getParserStatus();
    res.json({
      ok: true,
      senderRunning: sender.running,
      parserRunning: parser.running
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Safe shutdown
router.post('/shutdown', async (req, res) => {
  try {
    const sender = getSenderStatus();
    if (sender.running) {
      return res.status(403).json({ 
        ok: false, 
        error: 'Остановка запрещена: Идет рассылка сообщений. Сначала поставьте ее на паузу в интерфейсе.' 
      });
    }
    const parser = getParserStatus();
    if (parser.running) {
      return res.status(403).json({ 
        ok: false, 
        error: 'Остановка запрещена: Идет процесс парсинга. Остановите его перед закрытием сервера.' 
      });
    }

    if (global.aiGenStatus && global.aiGenStatus.active) {
      return res.status(403).json({ 
        ok: false, 
        error: 'Остановка запрещена: Идет генерация ИИ сообщений. Дождитесь окончания или отмените задачу.' 
      });
    }

    res.json({ ok: true, message: 'Shutting down safely...' });
    setTimeout(() => {
      console.log('[System] Safe shutdown requested from UI.');
      process.exit(0);
    }, 500);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get system logs
router.get('/logs', async (req, res) => {
  try {
    const db = getDb();
    const logs = await db`SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 500`;
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear system logs
router.delete('/logs', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM system_logs`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
