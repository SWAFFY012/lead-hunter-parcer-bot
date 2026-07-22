import { Router } from 'express';
import { getDb, getSetting } from '../db/database.js';
import { generateOllamaText, checkOllamaStatus } from '../modules/ai/ollamaClient.js';
import { startGeminiWorkerPool } from '../modules/ai/geminiWorkerPool.js';
import { resolveSpintax, substituteVars } from '../modules/ai/spintax.js';
import { io } from '../server.js';

const router = Router();

// ── Prompt CRUD ──
router.get('/prompts', async (_req, res) => {
  try {
    const db = getDb();
    res.json(await db`SELECT * FROM prompts ORDER BY created_at DESC`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/prompts', async (req, res) => {
  try {
    const db = getDb();
    const { name, system_prompt, message_template, model_name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const [prompt] = await db`
      INSERT INTO prompts (name, system_prompt, message_template, model_name)
      VALUES (${name}, ${system_prompt || ''}, ${message_template || ''}, ${model_name || 'llama3'})
      RETURNING *
    `;
    res.status(201).json(prompt);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/prompts/:id', async (req, res) => {
  try {
    const db = getDb();
    const { name, system_prompt, message_template, model_name } = req.body;
    const [prompt] = await db`
      UPDATE prompts SET name=${name}, system_prompt=${system_prompt}, message_template=${message_template}, 
      model_name=${model_name || 'llama3'}, updated_at=NOW()
      WHERE id=${req.params.id}
      RETURNING *
    `;
    res.json(prompt);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/prompts/:id', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM prompts WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Ollama status ──
router.get('/status', async (_req, res) => {
  try {
    const ollamaUrl = (await getSetting('ollama_url')) || 'http://127.0.0.1:11434';
    const status = await checkOllamaStatus(ollamaUrl);
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Generate batch of messages ──
router.post('/generate', async (req, res) => {
  try {
    const db = getDb();
    const { leadIds, promptId } = req.body;
    if (!leadIds?.length) return res.status(400).json({ error: 'leadIds required' });
    if (!promptId) return res.status(400).json({ error: 'promptId required' });

    const [prompt] = await db`SELECT * FROM prompts WHERE id = ${promptId}`;
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const aiProvider = (await getSetting('ai_provider')) || 'ollama';

    // Clear ai_message for these leads
    await db`UPDATE leads SET ai_message = '' WHERE id = ANY(${leadIds}::bigint[]) AND status != 'ready_to_send'`;

    const poolId = Date.now().toString();
    global.aiGenPoolId = poolId;
    global.aiGenStatus = { total: leadIds.length, done: 0, errors: 0, active: true };
    io.emit('ai:started', global.aiGenStatus);

    res.json({ ok: true, message: 'Generation started, follow via WebSocket' });

    if (aiProvider === 'gemini') {
      const geminiKey = await getSetting('gemini_api_key');
      if (!geminiKey) {
        io.emit('ai:error', { error: 'Gemini API key is not set in settings' });
        global.aiGenStatus.active = false;
        return;
      }
      startGeminiWorkerPool(leadIds, prompt, geminiKey, poolId).catch(err => {
        console.error('Gemini Pool Error:', err);
        if (global.aiGenPoolId === poolId) global.aiGenStatus.active = false;
      });
    } else {
      (async () => {
        const ollamaUrl = (await getSetting('ollama_url')) || 'http://127.0.0.1:11434';
        const model = prompt.model_name || (await getSetting('ollama_model')) || 'llama3';
        const ollamaAvailable = (await checkOllamaStatus(ollamaUrl)).available;

        const results = [];

        for (const leadId of leadIds) {
          const [lead] = await db`SELECT * FROM leads WHERE id = ${leadId}`;
          if (!lead || lead.status === 'ready_to_send') continue;

          let message;
          try {
            if (ollamaAvailable) {
              const filledSystem = substituteVars(prompt.system_prompt, lead);
              const userPrompt = substituteVars(
                `Оголошення:\nЗаголовок: ${lead.title || ''}\nТелефон/Ник: ${lead.ig_username ? '@' + lead.ig_username : (lead.phone || '')}\nТекст: ${(lead.ad_text || '').substring(0, 500)}\nМісто: ${lead.city || 'невідоме'}\n\n${prompt.message_template}`,
                lead
              );
              const rawMessage = await generateOllamaText(ollamaUrl, model, userPrompt, filledSystem);
              message = resolveSpintax(rawMessage);
            } else {
              message = resolveSpintax(substituteVars(prompt.message_template, lead));
            }

            await db`UPDATE leads SET ai_message = ${message}, status = 'ready_to_send' WHERE id = ${lead.id}`;
            if (global.aiGenStatus) global.aiGenStatus.done++;
            results.push({ leadId: lead.id, leadName: lead.name, leadPhone: lead.phone, message });
            io.emit('ai:generated', { leadId: lead.id, message });
          } catch (err) {
            if (global.aiGenStatus) global.aiGenStatus.errors++;
            io.emit('ai:error', { leadId, error: err.message });
          }
        }

        if (global.aiGenStatus) {
          global.aiGenStatus.active = false;
          setTimeout(() => { if (global.aiGenStatus && !global.aiGenStatus.active) global.aiGenStatus = null; }, 3000);
        }
        io.emit('ai:batch-done', { results });
      })();
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET AI generation status
router.get('/gen-status', (req, res) => {
  res.json(global.aiGenStatus || null);
});

// ── Single Lead Update ──
router.post('/update-lead-message', async (req, res) => {
  try {
    const db = getDb();
    const { leadId, ai_message, status } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId required' });

    const updates = {};
    if (ai_message !== undefined) updates.ai_message = ai_message;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length > 0) {
      await db`UPDATE leads SET ${db(updates)} WHERE id = ${leadId}`;
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Approve batch ──
router.post('/approve-batch', async (req, res) => {
  try {
    const db = getDb();
    const { items } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'items required' });

    for (const { leadId, message } of items) {
      await db`UPDATE leads SET ai_message = ${message}, status = 'ready_to_send' WHERE id = ${leadId}`;
    }
    res.json({ ok: true, updated: items.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
