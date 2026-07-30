import { Router } from 'express';
import {
  buildTwoGisSearchUrl,
  getTwoGisMapsStatus,
  startTwoGisMapsParsing,
  stopTwoGisMapsParsing,
} from '../modules/parser/twoGisMapsParser.js';
import { normalizeMapLeadFilters } from '../utils/mapLeadFilter.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({ ok: true, ...getTwoGisMapsStatus() });
});

router.post('/start', (req, res) => {
  if (getTwoGisMapsStatus().isRunning) {
    return res.status(409).json({ ok: false, error: 'Парсер 2ГИС уже работает в другой вкладке.' });
  }

  const query = String(req.body?.query || '').trim();
  const targetCount = Math.min(100, Math.max(1, Number(req.body?.targetCount) || 30));
  const filters = normalizeMapLeadFilters(req.body?.filters);
  if (query.length < 3) {
    return res.status(400).json({ ok: false, error: 'Введите город и нишу или вставьте ссылку поиска 2ГИС.' });
  }

  try {
    buildTwoGisSearchUrl(query);
    void startTwoGisMapsParsing({ query, targetCount, filters });
    return res.json({ ok: true, query, targetCount, filters });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось запустить парсер 2ГИС.';
    return res.status(400).json({ ok: false, error: message });
  }
});

router.post('/stop', (_req, res) => {
  stopTwoGisMapsParsing();
  res.json({ ok: true });
});

export default router;
