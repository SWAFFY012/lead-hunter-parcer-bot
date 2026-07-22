import { Router } from 'express';
import { listSavedMapLeads, removeSavedMapLead, saveMapLeads } from '../utils/mapLeadCache.js';

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

router.delete('/', asyncRoute(async (req, res) => {
  const platform = String(req.body?.platform || '');
  const sourceUrl = String(req.body?.sourceUrl || '');
  if (!platform || !sourceUrl) return res.status(400).json({ ok: false, error: 'Не указана компания.' });
  const savedLeads = await removeSavedMapLead(platform, sourceUrl);
  return res.json({ ok: true, leads: savedLeads });
}));

export default router;
