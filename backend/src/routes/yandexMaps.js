import { Router } from 'express';
import {
  getYandexMapsStatus,
  startYandexMapsParsing,
  stopYandexMapsParsing,
} from '../modules/parser/yandexMapsParser.js';
import { normalizeMapLeadFilters } from '../utils/mapLeadFilter.js';

const router = Router();

router.get('/status', (_req, res) => res.json({ ok: true, ...getYandexMapsStatus() }));

router.post('/start', (req, res) => {
  const query = String(req.body?.query || '').trim();
  const targetCount = Math.min(100, Math.max(1, Number(req.body?.targetCount) || 30));
  const filters = normalizeMapLeadFilters(req.body?.filters);
  if (query.length < 3) {
    return res.status(400).json({ ok: false, error: 'Введите город и нишу для поиска.' });
  }
  startYandexMapsParsing({ query, targetCount, filters });
  return res.json({ ok: true, query, targetCount, filters });
});

router.post('/stop', (_req, res) => {
  stopYandexMapsParsing();
  res.json({ ok: true });
});

export default router;
