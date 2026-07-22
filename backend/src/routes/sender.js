import { Router } from 'express';
import { startSending, pauseSending, getSenderStatus } from '../modules/sender/senderManager.js';

const router = Router();

router.get('/status', (_req, res) => {
  try { res.json(getSenderStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/start', async (req, res) => {
  try {
    const { campaign_id, account_ids } = req.body;
    const result = await startSending({ campaignId: campaign_id, accountIds: account_ids });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pause', (_req, res) => {
  try { res.json(pauseSending()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
