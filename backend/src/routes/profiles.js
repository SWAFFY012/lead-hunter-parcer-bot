import { Router } from 'express';
import { createProfile, listProfiles, getProfile, deleteProfile, updateProfileProxy } from '../modules/fingerprint/profileManager.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const profiles = await listProfiles();
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    const profile = await createProfile(name);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/proxy', async (req, res) => {
  try {
    await updateProfileProxy(req.params.id, req.body.proxy);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteProfile(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
