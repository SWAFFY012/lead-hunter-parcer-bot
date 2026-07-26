import { Router } from 'express';
import {
  listSavedMapLeads,
  listOutreachMapLeads,
  ignoreMapLeadName,
  queueMapLeadForOutreach,
  removeMapLeadFromOutreach,
  removeAllSavedMapLeads,
  removeSavedMapLead,
  saveMapLeads,
  setMapLeadOutreachDraft,
  setMapLeadContacted,
} from '../utils/mapLeadCache.js';
import { io } from '../server.js';
import { recordMapParserContacted, removeMapParserLeadsByName } from '../utils/mapParserRunStore.js';
import { getSetting } from '../db/database.js';
import { checkOllamaStatus, generateOllamaText } from '../modules/ai/ollamaClient.js';

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

router.get('/outreach', asyncRoute(async (_req, res) => {
  res.json({ ok: true, leads: await listOutreachMapLeads() });
}));

router.post('/outreach', asyncRoute(async (req, res) => {
  const lead = req.body?.lead;
  const telegram = lead?.socialLinks?.find((item) => String(item?.platform).toLowerCase() === 'telegram');
  if (!lead?.platform || !lead?.sourceUrl || !telegram?.url) {
    return res.status(400).json({ ok: false, error: 'Для рассылки нужна найденная ссылка Telegram.' });
  }
  return res.json({ ok: true, leads: await queueMapLeadForOutreach(lead) });
}));

router.patch('/outreach/draft', asyncRoute(async (req, res) => {
  const lead = await setMapLeadOutreachDraft(
    String(req.body?.platform || ''),
    String(req.body?.sourceUrl || ''),
    String(req.body?.outreachDraft || ''),
  );
  if (!lead) return res.status(404).json({ ok: false, error: 'Контакт не найден в очереди.' });
  return res.json({ ok: true, lead });
}));

router.post('/outreach/generate-drafts', asyncRoute(async (_req, res) => {
  const leads = await listOutreachMapLeads();
  if (!leads.length) return res.status(400).json({ ok: false, error: 'Очередь рассылки пуста.' });

  const ollamaUrl = (await getSetting('ollama_url')) || 'http://127.0.0.1:11434';
  const model = (await getSetting('ollama_model')) || 'llama3';
  const ollamaAvailable = (await checkOllamaStatus(ollamaUrl)).available;
  const fallbackStarts = ['Здравствуйте!', 'Добрый день!', 'Приветствую!', 'Здравствуйте, коллеги!'];
  const generated = [];

  for (const [index, lead] of leads.entries()) {
    let outreachDraft = `${fallbackStarts[index % fallbackStarts.length]} Нашёл компанию «${lead.name}» на картах. Хотел коротко обсудить возможное сотрудничество. Если предложение неактуально, просто сообщите — больше писать не буду.`;
    if (ollamaAvailable) {
      const prompt = [
        'Напиши одно короткое персональное первое сообщение компании в Telegram на русском языке.',
        'Тон: вежливый, деловой, без давления и ложных обещаний.',
        'Не выдумывай факты. Не используй больше 350 символов.',
        'Обязательно добавь возможность вежливо отказаться от дальнейших сообщений.',
        `Компания: ${lead.name || 'не указана'}`,
        `Категория: ${lead.title || 'не указана'}`,
        `Город/адрес: ${lead.address || 'не указан'}`,
      ].join('\n');
      outreachDraft = (await generateOllamaText(ollamaUrl, model, prompt, 'Ты помощник по подготовке деловой переписки.')).trim();
    }
    const updated = await setMapLeadOutreachDraft(lead.platform, lead.sourceUrl, outreachDraft);
    if (updated) generated.push(updated);
  }

  return res.json({ ok: true, leads: generated, aiAvailable: ollamaAvailable });
}));

router.delete('/outreach', asyncRoute(async (req, res) => {
  const platform = String(req.body?.platform || '');
  const sourceUrl = String(req.body?.sourceUrl || '');
  if (!platform || !sourceUrl) return res.status(400).json({ ok: false, error: 'Не указан контакт.' });
  return res.json({ ok: true, leads: await removeMapLeadFromOutreach(platform, sourceUrl) });
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

router.delete('/all', asyncRoute(async (_req, res) => {
  const savedLeads = await removeAllSavedMapLeads();
  return res.json({ ok: true, leads: savedLeads });
}));

export default router;
