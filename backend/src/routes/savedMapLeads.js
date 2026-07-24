import { Router } from 'express';
import {
  listSavedMapLeads,
  ignoreMapLeadName,
  removeSavedMapLead,
  saveMapLeads,
  setMapLeadContacted,
} from '../utils/mapLeadCache.js';
import { io } from '../server.js';
import { recordMapParserContacted, removeMapParserLeadsByName } from '../utils/mapParserRunStore.js';

const router = Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

router.get('/', asyncRoute(async (_req, res) => {
  res.json({ ok: true, leads: await listSavedMapLeads() });
}));

router.post('/', asyncRoute(async (req, res) => {
  const leads = Array.isArray(req.body?.leads) ? req.body.leads : [];
  if (!leads.length) return res.status(400).json({ ok: false, error: 'Передайте хотя бы одну компанию.' });
  const savedLeads = await saveMapLeads(leads);
  return res.json({ ok: true, leads: savedLeads });
}));

router.patch('/contacted', asyncRoute(async (req, res) => {
  const platform = String(req.body?.platform || '');
  const sourceUrl = String(req.body?.sourceUrl || '');
  const contacted = Boolean(req.body?.contacted);
  if (!platform || !sourceUrl) return res.status(400).json({ ok: false, error: 'Не указана компания.' });

  const lead = await setMapLeadContacted(platform, sourceUrl, contacted);
  if (!lead) return res.status(404).json({ ok: false, error: 'Компания не найдена в памяти парсера.' });
  recordMapParserContacted(platform, sourceUrl, lead.contactedAt);
  return res.json({ ok: true, lead });
}));

router.post('/ignore-name', asyncRoute(async (req, res) => {
  const platform = String(req.body?.platform || '');
  const name = String(req.body?.name || '').trim();
  if (!platform || !name) return res.status(400).json({ ok: false, error: 'Не указана компания.' });

  const ignoredName = await ignoreMapLeadName(platform, name);
  const removedCount = removeMapParserLeadsByName(platform, ignoredName);
  io.emit('parser:lead-removed', { platform, normalizedName: ignoredName });
  return res.json({ ok: true, ignoredName, removedCount });
}));

router.delete('/', asyncRoute(async (req, res) => {
  const platform = String(req.body?.platform || '');
  const sourceUrl = String(req.body?.sourceUrl || '');
  if (!platform || !sourceUrl) return res.status(400).json({ ok: false, error: 'Не указана компания.' });
  const savedLeads = await removeSavedMapLead(platform, sourceUrl);
  return res.json({ ok: true, leads: savedLeads });
}));

export default router;
