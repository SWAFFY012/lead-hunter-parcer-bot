import { Router } from 'express';
import {
  getParserStatus,
  startGoogleMapsParsing,
  stopParsing,
} from '../modules/parser/googleMapsParser.js';
import { normalizeMapLeadFilters } from '../utils/mapLeadFilter.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({ ok: true, ...getParserStatus() });
});

router.post('/start', (req, res) => {
  if (getParserStatus().isRunning) {
    return res.status(409).json({ ok: false, error: 'Парсер Google Карт уже работает в другой вкладке.' });
  }
  const query = String(req.body?.query || '').trim();
  const targetCount = Math.min(100, Math.max(1, Number(req.body?.targetCount) || 30));
  const filters = normalizeMapLeadFilters(req.body?.filters);
  if (query.length < 3) {
    return res.status(400).json({
      ok: false,
      error: 'Введите поисковую фразу: например, Москва натяжные потолки.',
    });
  }
  const url = /^https?:\/\//i.test(query)
    ? query
    : `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=ru`;
  void startGoogleMapsParsing({ url, targetCount, filters });
  return res.json({ ok: true, query, url, targetCount, filters });
});

router.post('/stop', (_req, res) => {
  stopParsing();
  res.json({ ok: true });
});

export default router;
