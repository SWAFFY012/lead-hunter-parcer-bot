import { Router } from 'express';
import {
  getParserStatus,
  startGoogleMapsParsing,
  stopParsing,
} from '../modules/parser/googleMapsParser.js';
import { normalizeMapLeadFilters } from '../utils/mapLeadFilter.js';
import { listRegions, DEFAULT_REGION } from '../utils/phoneNormalizer.js';

// Язык выдачи Карт под регион: с русским hl турецкие карточки отдают
// переведённые названия рубрик, по которым потом неудобно фильтровать.
const REGION_LOCALE = { RU: 'ru', TR: 'tr' };

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
  const requestedRegion = String(req.body?.region || DEFAULT_REGION).toUpperCase();
  const region = listRegions().includes(requestedRegion) ? requestedRegion : DEFAULT_REGION;
  const niche = String(req.body?.niche || '').trim() || null;
  if (query.length < 3) {
    return res.status(400).json({
      ok: false,
      error: 'Введите поисковую фразу: например, Москва натяжные потолки.',
    });
  }
  const locale = REGION_LOCALE[region] || REGION_LOCALE[DEFAULT_REGION];
  const url = /^https?:\/\//i.test(query)
    ? query
    : `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=${locale}`;
  void startGoogleMapsParsing({ query, url, targetCount, filters, region, niche });
  return res.json({ ok: true, query, url, targetCount, filters, region, niche });
});

router.post('/stop', (_req, res) => {
  stopParsing();
  res.json({ ok: true });
});

export default router;
