import { Router } from 'express';
import { startParsing, stopParsing, getParserStatus, launchOlxAuth, confirmOlxAuth, cancelOlxAuth, importCookies, getCookies } from '../modules/parser/olxParser.js';
import { getDb } from '../db/database.js';
import { io } from '../server.js';
import fs from 'fs';

import { startInstagramParsing, stopParsing as stopInstagramParsing, getParserStatus as getInstagramStatus, loginInstagram } from '../modules/parser/instagramParser.js';
import { startGoogleMapsParsing, stopParsing as stopGoogleMapsParsing, getParserStatus as getGoogleMapsStatus } from '../modules/parser/googleMapsParser.js';

const router = Router();

router.get('/status', (_req, res) => {
  try { 
    const olx = getParserStatus();
    const ig = getInstagramStatus();
    const gmaps = getGoogleMapsStatus();
    let platform = 'olx';
    if (ig.isRunning) platform = 'instagram';
    if (gmaps.isRunning) platform = 'google_maps';
    res.json({ isRunning: olx.isRunning || ig.isRunning || gmaps.isRunning, platform }); 
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auth-olx', async (req, res) => {
  try {
    const { profileId } = req.body;
    res.json({ ok: true, message: 'Browser opening for OLX auth...' });
    launchOlxAuth(profileId); // async, don't await
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auth-olx-confirm', async (req, res) => {
  try {
    const { profileId } = req.body;
    res.json({ ok: true, message: 'Confirming auth...' });
    confirmOlxAuth(profileId); // async
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auth-olx-cancel', async (req, res) => {
  try {
    const { profileId } = req.body;
    res.json({ ok: true, message: 'Cancelling auth...' });
    cancelOlxAuth(profileId); // async
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/import-cookies', async (req, res) => {
  try {
    const { profileId, cookies, userAgent } = req.body;
    if (!cookies || !Array.isArray(cookies)) {
      return res.status(400).json({ error: 'Valid cookies array required' });
    }
    await importCookies(profileId, cookies, userAgent);
    res.json({ ok: true, message: 'Cookies imported successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cookies', async (req, res) => {
  try {
    const cookies = await getCookies(req.query.profileId);
    res.json(cookies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/instagram-login', async (req, res) => {
  try {
    const { profileId } = req.body;
    res.json({ ok: true, message: 'Browser opening for Instagram auth...' });
    loginInstagram({ profileId }); // async, don't await
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/instagram/check-session/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;
    if (!profileId) return res.json({ active: false });
    
    const db = getDb();
    const [profile] = await db`SELECT session_path FROM browser_profiles WHERE id = ${profileId}`;
    
    if (profile && profile.session_path && fs.existsSync(profile.session_path)) {
      const state = JSON.parse(fs.readFileSync(profile.session_path, 'utf8'));
      const hasIgCookie = state.cookies?.some(c => c.domain.includes('instagram.com'));
      return res.json({ active: !!hasIgCookie });
    }
    res.json({ active: false });
  } catch(err) {
    res.json({ active: false });
  }
});

router.post('/start', async (req, res) => {
  try {
    const { url, pages, campaign_id, profile_id, platform, filterGeo, filterActive, minFollowers, maxFollowers, maxPostDays, takeScreenshots, taskId } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    
    const db = getDb();
    let currentTaskId = taskId;
    
    const filters = JSON.stringify({ filterGeo, filterActive, minFollowers, maxFollowers, maxPostDays, takeScreenshots });
    
    if (currentTaskId) {
      await db`UPDATE parsing_tasks SET pages = ${Number(pages) || 3}, filters = ${filters}, campaign_id = ${campaign_id || null}, profile_id = ${profile_id || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${currentTaskId}`;
    } else {
      const [existing] = await db`SELECT id FROM parsing_tasks WHERE url = ${url} AND platform = ${platform || 'instagram'}`;
      if (existing) {
        currentTaskId = existing.id;
        await db`UPDATE parsing_tasks SET pages = ${Number(pages) || 3}, filters = ${filters}, campaign_id = ${campaign_id || null}, profile_id = ${profile_id || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${currentTaskId}`;
      } else {
        const [resTask] = await db`
          INSERT INTO parsing_tasks (url, platform, campaign_id, profile_id, pages, filters) 
          VALUES (${url}, ${platform || 'instagram'}, ${campaign_id || null}, ${profile_id || null}, ${Number(pages) || 3}, ${filters})
          RETURNING id
        `;
        currentTaskId = resTask.id;
      }
    }
    
    if (platform === 'instagram') {
      startInstagramParsing({ 
        url, 
        pages: Number(pages) || 3, 
        campaignId: campaign_id, 
        profileId: profile_id, 
        filterGeo, 
        filterActive,
        minFollowers: Number(minFollowers) || 0,
        maxFollowers: Number(maxFollowers) || 0,
        maxPostDays: Number(maxPostDays) || 0,
        takeScreenshots: !!takeScreenshots,
        taskId: currentTaskId
      });
    } else if (platform === 'google_maps') {
      startGoogleMapsParsing({
        url,
        pages: Number(pages) || 3,
        campaignId: campaign_id,
        profileId: profile_id,
        taskId: currentTaskId
      });
    } else {
      startParsing({ url, pages: Number(pages) || 3, campaignId: campaign_id, profileId: profile_id });
    }
    
    res.json({ ok: true, message: 'Parsing started', taskId: currentTaskId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/start-instagram', async (req, res) => {
  try {
    const { url, pages, campaignId, profileId, filters, taskId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    startInstagramParsing({ 
      url, 
      pages: parseInt(pages, 10) || 3, 
      campaignId: parseInt(campaignId, 10) || null,
      profileId,
      filterGeo: filters?.geo,
      filterActive: filters?.active,
      minFollowers: parseInt(filters?.minFollowers, 10) || 0,
      maxFollowers: parseInt(filters?.maxFollowers, 10) || 0,
      maxPostDays: parseInt(filters?.maxPostDays, 10) || 0,
      takeScreenshots: filters?.takeScreenshots,
      taskId
    });
    
    res.json({ ok: true, message: 'Instagram parsing started in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/start-google', async (req, res) => {
  try {
    const { url, pages, campaignId, profileId, taskId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    startGoogleMapsParsing({ 
      url, 
      pages: parseInt(pages, 10) || 3, 
      campaignId: parseInt(campaignId, 10) || null,
      profileId,
      taskId
    });
    
    res.json({ ok: true, message: 'Google Maps parsing started in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop-google', (req, res) => {
  try {
    stopGoogleMapsParsing();
    res.json({ ok: true, message: 'Stopping Google Maps parser...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', (req, res) => {
  try {
    const { platform } = req.body;
    if (platform === 'instagram') {
      res.json(stopInstagramParsing());
    } else {
      res.json(stopParsing());
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tasks', async (req, res) => {
  try {
    const db = getDb();
    const tasks = await db`
      SELECT t.*, c.name as campaign_name,
        (SELECT COUNT(*) FROM instagram_visited_posts v WHERE v.task_id = t.id) as visited_count
      FROM parsing_tasks t
      LEFT JOIN campaigns c ON t.campaign_id = c.id
      ORDER BY t.updated_at DESC
    `;
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    const db = getDb();
    await db`DELETE FROM parsing_tasks WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/check-lead', async (req, res) => {
  try {
    const { url, userId } = req.query;
    if (!url && !userId) {
      return res.json({ duplicateType: null });
    }

    const db = getDb();
    
    if (url) {
      const [byUrl] = await db`SELECT id FROM leads WHERE source_url ILIKE ${'%' + url + '%'}`;
      if (byUrl) return res.json({ duplicateType: 'url' });
    }
    
    if (userId) {
      const [byUser] = await db`SELECT id FROM leads WHERE "olxUserId" ILIKE ${'%' + userId + '%'}`;
      if (byUser) return res.json({ duplicateType: 'user' });
    }

    res.json({ duplicateType: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/manual-leads', async (req, res) => {
  try {
    const { phone, title, url, name, ad_text, campaign_id, olxUserId } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    const db = getDb();
    
    const normalizePhone = (p) => {
      let n = p.replace(/[^\d+]/g, '');
      if (n.startsWith('0') && n.length === 10) n = '+38' + n;
      if (n.startsWith('38') && !n.startsWith('+')) n = '+' + n;
      return n;
    };
    const toWaPhone = (p) => normalizePhone(p).replace('+', '');
    const normalizedPhone = normalizePhone(phone);
    const waPhone = toWaPhone(phone);
    
    const [existing] = await db`
      SELECT * FROM leads 
      WHERE phone = ${phone} 
         OR phone = ${normalizedPhone} 
         OR phone = ${normalizedPhone.replace('+38', '')} 
         OR phone = ${normalizedPhone.replace('+', '')}
    `;
    
    let existingByUser = null;
    if (!existing && olxUserId) {
      const rows = await db`SELECT * FROM leads WHERE "olxUserId" ILIKE ${'%' + olxUserId + '%'}`;
      existingByUser = rows[0];
    }
    
    const target = existing || existingByUser;
    
    if (target) {
      let updatedSourceUrl = target.source_url || '';
      let updatedUserId = target.olxUserId || '';
      let modified = false;
      
      const campaignId = campaign_id || null;
      if (url && !updatedSourceUrl.includes(url)) {
        updatedSourceUrl = updatedSourceUrl ? `${updatedSourceUrl},${url}` : url;
        modified = true;
      }
      
      if (olxUserId && !updatedUserId.includes(olxUserId)) {
        updatedUserId = updatedUserId ? `${updatedUserId},${olxUserId}` : olxUserId;
        modified = true;
      }
      
      if (campaignId && target.campaign_id !== campaignId) {
        modified = true;
      }

      if (!target.wa_phone) modified = true;

      if (modified) {
        await db`
          UPDATE leads 
          SET source_url = ${updatedSourceUrl}, "olxUserId" = ${updatedUserId}, campaign_id = COALESCE(${campaignId}, campaign_id), wa_phone = COALESCE(wa_phone, ${waPhone})
          WHERE id = ${target.id}
        `;
      }
      
      const [updatedLead] = await db`SELECT * FROM leads WHERE id = ${target.id}`;
      if (io) {
        io.emit('manual_parser:lead', { lead: updatedLead }); 
      }
      return res.json({ ok: true, lead: updatedLead, appended: true });
    }

    const campaignId = campaign_id || null;

    const [newLead] = await db`
      INSERT INTO leads (campaign_id, phone, wa_phone, name, title, source_url, "olxUserId", ad_text, status, created_at)
      VALUES (${campaignId}, ${phone}, ${waPhone}, ${name || null}, ${title || null}, ${url || null}, ${olxUserId || null}, ${ad_text || null}, 'new', CURRENT_TIMESTAMP)
      RETURNING *
    `;
    
    if (io) {
        io.emit('manual_parser:lead', { lead: newLead });
    }

    res.json({ ok: true, lead: newLead });
  } catch (err) {
    if (err.message.includes('unique constraint') || err.message.includes('duplicate key value')) {
      return res.status(409).json({ error: 'Этот номер уже есть в базе!' });
    }
    console.error('Manual lead error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
