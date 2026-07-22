/**
 * Instagram Parser Module
 * Uses Playwright + stealth plugin to scrape Instagram.
 * Emits events matching olxParser for frontend compatibility.
 */
import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getDb } from '../../db/database.js';
import { io } from '../../server.js';
import { systemLog } from '../../utils/logger.js';
import { getProfile, buildContextOptions, applyFingerprintScripts } from '../fingerprint/profileManager.js';

// Stealth-enhanced playwright
const playwrightExtra = addExtra(chromium);
playwrightExtra.use(StealthPlugin());

let parserRunning = false;
let parserBrowser = null;
let shouldStop = false;

// ───────────────────────────────────────────
// Utility: random sleep
// ───────────────────────────────────────────
function sleep(min, max) {
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

// ───────────────────────────────────────────
// Random scroll to simulate reading
// ───────────────────────────────────────────
async function randomScroll(page) {
  const scrolls = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 300 + Math.random() * 500);
    await sleep(500, 1000);
  }
}

// ───────────────────────────────────────────
// Utility: parse Instagram numbers (e.g. 1.5M, 10K)
// ───────────────────────────────────────────
function normalize_number(text) {
  if (!text || text === 'N/A') return 0;
  let s = text.toLowerCase().replace(/followers|following|posts|follower|post/gi, '').trim();
  
  if (s.endsWith('k') || s.endsWith('m')) {
    const multiplier = s.endsWith('k') ? 1000 : 1000000;
    const numStr = s.slice(0, -1).replace(',', '.').replace(/\s/g, '');
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : Math.floor(num * multiplier);
  } else {
    const numStr = s.replace(/\D/g, '');
    return numStr ? parseInt(numStr, 10) : 0;
  }
}

// ───────────────────────────────────────────
// Utility: Check for Instagram Blocks / Captcha
// ───────────────────────────────────────────
async function checkForBlock(page) {
  try {
    const url = page.url();
    if (url.includes('/accounts/login')) {
      io.emit('parser:log', { message: '⛔ Инстаграм перенаправил на страницу входа. Сессия устарела или вас разлогинило.', type: 'error' });
      return true;
    }

    const isLoginPage = await page.$eval('input[name="username"]', () => true).catch(() => false);
    if (isLoginPage) {
      io.emit('parser:log', { message: '⛔ Инстаграм требует авторизацию (показана страница входа).', type: 'error' });
      return true;
    }

    const blockIndicators = [
      'text="Log in to continue"',
      'text="Suspicious activity"',
      'iframe[src*="captcha"]',
      'text="Try Again Later"',
      'text="Please wait a few minutes"',
      'text="Something went wrong"'
    ];
    for (const selector of blockIndicators) {
      const isBlocked = await page.$(selector).catch(() => null);
      if (isBlocked) return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

// ───────────────────────────────────────────
// Main Parsing Function
// ───────────────────────────────────────────
export async function startInstagramParsing(options) {
  const { url, pages = 3, campaignId = null, profileId = null, filterGeo = false, filterActive = false, minFollowers = 0, maxFollowers = 0, maxPostDays = 0, takeScreenshots = false, taskId = null } = options;
  if (parserRunning) {
    io.emit('parser:log', { message: 'Парсер уже запущен', type: 'warn' });
    return;
  }

  parserRunning = true;
  shouldStop = false;
  io.emit('parser:started', { platform: 'instagram' });
  systemLog('parser', 'info', `Started Instagram parsing: ${url} (Profile: ${profileId || 'default'})`);

  const db = getDb();
  if (campaignId) {
    await db`UPDATE campaigns SET status='parsing' WHERE id=${campaignId}`;
  }

  const profile = profileId ? await getProfile(profileId) : null;

  try {
    io.emit('parser:log', { message: 'Launching browser for Instagram...', type: 'info' });

    parserBrowser = await playwrightExtra.launch({
      headless: true, // we can run headless now since we have a separate login mode!
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const ctxOptions = profile
      ? buildContextOptions(profile)
      : {
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

    const ctx = await parserBrowser.newContext(ctxOptions);
    const page = await ctx.newPage();

    if (profile) await applyFingerprintScripts(page, profile);

    io.emit('parser:log', { message: 'Navigating to Instagram...', type: 'info' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Check if we are blocked by login wall
    await sleep(3000, 5000);
    const isLoginPage = await page.$eval('input[name="username"]', () => true).catch(() => false);
    if (isLoginPage && profile) {
      io.emit('parser:log', { message: 'WARNING: Instagram asks for login. Please use "Авторизация Instagram" first.', type: 'warn' });
    }

    let leadsFound = 0;

    io.emit('parser:log', { message: 'Collecting post links...', type: 'info' });
    const postLinks = new Set();
    
    // Scroll and collect links (pages limit how many times we scroll)
    for (let p = 1; p <= pages; p++) {
      if (shouldStop) break;
      io.emit('parser:progress', { currentPage: p, totalPages: pages });
      
      const links = await page.$$eval('a[href^="/p/"]', anchors => anchors.map(a => a.href));
      links.forEach(l => postLinks.add(l));
      
      io.emit('parser:log', { message: `Page ${p}: Found ${postLinks.size} total post links so far.`, type: 'info' });
      
      if (await checkForBlock(page)) {
        io.emit('parser:log', { message: `❌ INSTAGRAM BLOCK DETECTED. Stopping parser to protect account.`, type: 'error' });
        shouldStop = true;
        break;
      }

      await randomScroll(page);
      await sleep(2000, 4000);
    }

    // Filter out posts we've already visited for this task
    let postsToVisit = [];
    let skippedCount = 0;
    if (taskId) {
      for (const link of Array.from(postLinks)) {
        const [visited] = await db`SELECT post_url FROM instagram_visited_posts WHERE post_url = ${link} AND task_id = ${taskId}`;
        if (visited) {
          skippedCount++;
        } else {
          postsToVisit.push(link);
        }
      }
      if (skippedCount > 0) {
        io.emit('parser:log', { message: `Skipped ${skippedCount} posts already visited in this task.`, type: 'info' });
      }
    } else {
      postsToVisit = Array.from(postLinks);
    }

    io.emit('parser:log', { message: `Visiting ${postsToVisit.length} new posts to extract user profiles...`, type: 'info' });

    for (let i = 0; i < postsToVisit.length; i++) {
      if (shouldStop) break;
      
      const postUrl = postsToVisit[i];
      io.emit('parser:progress', { currentPage: pages, totalPages: pages, currentAccount: i + 1, totalAccounts: postsToVisit.length });
      io.emit('parser:log', { message: `[${i + 1}/${postsToVisit.length}] Analyzing post: ${postUrl}`, type: 'info' });
      
      if (taskId) {
        await db`INSERT INTO instagram_visited_posts (post_url, task_id) VALUES (${postUrl}, ${taskId}) ON CONFLICT DO NOTHING`;
      }
      
      try {
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000, 3000);

        if (await checkForBlock(page)) {
          io.emit('parser:log', { message: `❌ INSTAGRAM BLOCK DETECTED on post page. Stopping.`, type: 'error' });
          shouldStop = true;
          break;
        }
        
        // Extract author username using robust OpenGraph tags
        let username = await page.$eval('meta[property="og:url"]', el => {
          const content = el.getAttribute('content');
          if (content && content.includes('instagram.com/')) {
            const parts = content.split('instagram.com/')[1].split('?')[0].split('/');
            // Expected format: https://www.instagram.com/USERNAME/reel/...
            if (parts.length > 0 && parts[0] !== 'p' && parts[0] !== 'reel' && parts[0] !== 'tv') {
              return parts[0];
            }
          }
          return null;
        }).catch(() => null);
        
        if (!username) {
          username = await page.$eval('meta[property="og:title"], meta[name="twitter:title"]', el => {
            // Expected format: "Name (@username) • Instagram..."
            const match = el.getAttribute('content').match(/@([a-zA-Z0-9_.-]+)/);
            return match ? match[1] : null;
          }).catch(() => null);
        }
        
        // Fallbacks for older DOM
        if (!username) {
          username = await page.$eval('header a.x1i10hfl', el => el.textContent.trim()).catch(() => null);
        }
        
        if (!username) {
          if (takeScreenshots) {
            const debugPath = `./debug_post_${i}.png`;
            await page.screenshot({ path: debugPath }).catch(() => null);
            io.emit('parser:log', { message: `[${i + 1}] Could not find author username on post. Saved screenshot to backend/${debugPath}. Skipping.`, type: 'warn' });
          } else {
            io.emit('parser:log', { message: `[${i + 1}] Could not find author username on post. Skipping. (Screenshots disabled)`, type: 'warn' });
          }
          continue;
        }
        
        if (taskId) {
          const [visitedUser] = await db`SELECT username FROM instagram_visited_users WHERE username = ${username} AND task_id = ${taskId}`;
          if (visitedUser) {
            io.emit('parser:log', { message: `[${i + 1}] Skip @${username} (already checked in this task)`, type: 'info' });
            continue;
          }
          // Mark user as visited for this task
          await db`INSERT INTO instagram_visited_users (username, task_id) VALUES (${username}, ${taskId}) ON CONFLICT DO NOTHING`;
        }

        // Skip if already in DB
        const [exists] = await db`SELECT id FROM leads WHERE ig_username=${username}`;
        if (exists) {
          io.emit('parser:log', { message: `[${i + 1}] Skip @${username} (already in DB)`, type: 'info' });
          continue;
        }

        // Visit profile to get Bio and Name
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000, 4000);

        if (await checkForBlock(page)) {
          io.emit('parser:log', { message: `❌ INSTAGRAM BLOCK DETECTED on profile. Stopping parser to protect account.`, type: 'error' });
          shouldStop = true;
          break;
        }

        const fullName = await page.$eval('header section span[dir="auto"]', el => el.textContent.trim()).catch(() => '');
        // Bio logic - Instagram DOM changes, but header section contains the bio string
        const bioText = await page.$$eval('header section span[dir="auto"]', els => els.map(e => e.textContent).join('\n')).catch(() => '');
        
        // Followers check - robust extraction from og:description
        // Format is usually "960 Followers, 872 Following, 25 Posts - See Instagram..."
        const ogDescription = await page.$eval('meta[property="og:description"], meta[name="description"]', el => el.getAttribute('content')).catch(() => '');
        let followersText = '0';
        if (ogDescription) {
          const match = ogDescription.match(/^([0-9.,\s]+[KkMm]?)\s+(Followers|Abonnenten|podpis|followers|subscribers)/i);
          if (match) {
            followersText = match[1].replace(/\s/g, ''); // Remove spaces inside the number (like "1 500")
          } else {
            // Let's try matching just any number followed by Followers
            const looseMatch = ogDescription.match(/([0-9.,\s]+[KkMm]?)\s+(Followers|Abonnenten)/i);
            if (looseMatch) followersText = looseMatch[1].replace(/\s/g, '');
          }
        }
        
        // Fallback to DOM if og:description fails or isn't formatted right
        if (followersText === '0') {
          followersText = await page.$eval('header section ul li:nth-of-type(2) span, header section ul li:nth-child(2) span', el => el.getAttribute('title') || el.textContent).catch(() => '0');
        }
        
        const followers = normalize_number(followersText);
        io.emit('parser:log', { message: `[DEBUG] @${username} ogDescription: "${ogDescription.substring(0, 50)}..." -> Extracted text: "${followersText}" -> Final number: ${followers}`, type: 'info' });

        if (minFollowers > 0 && followers < minFollowers) {
          io.emit('parser:log', { message: `Skipped @${username} (${followers} followers < ${minFollowers})`, type: 'info' });
          continue;
        }

        if (maxFollowers > 0 && followers > maxFollowers) {
          io.emit('parser:log', { message: `Skipped @${username} (${followers} followers > ${maxFollowers})`, type: 'info' });
          continue;
        }

        // --- SMART FILTERING ---
        const bioLower = bioText.toLowerCase() + ' ' + fullName.toLowerCase();
        
        if (filterGeo) {
          const geoRegex = /(ukraine|украина|україна|київ|киев|kyiv|kiev|львів|львов|lviv|одеса|одесса|odesa|odessa|днепр|dnipro|харьков|харків|kharkiv|ua|\+380)/i;
          const ukrainianCharsRegex = /[їієґ]/i;
          if (!geoRegex.test(bioLower) && !ukrainianCharsRegex.test(bioLower)) {
            io.emit('parser:log', { message: `Filtered out @${username} (No UA geo and no Ukrainian letters)`, type: 'info' });
            continue;
          }
        }

        if (filterActive) {
          let isActive = false;
          // Check for stories ring (canvas element inside header)
          const hasStory = await page.$eval('header canvas', () => true).catch(() => false);
          if (hasStory) {
            isActive = true;
          } else if (maxPostDays > 0) {
            // Check post date as fallback
            try {
              // Check up to 5 posts to bypass pinned old posts
              const posts = await page.$$('a[href^="/p/"]');
              const postsToCheck = posts.slice(0, 5);
              
              for (const post of postsToCheck) {
                await post.click();
                await page.waitForSelector('time[datetime]', { timeout: 5000 }).catch(() => null);
                const postDateStr = await page.$eval('time[datetime]', el => el.getAttribute('datetime')).catch(() => null);
                if (postDateStr) {
                  const postDate = new Date(postDateStr);
                  const diffDays = (new Date() - postDate) / (1000 * 60 * 60 * 24);
                  if (diffDays <= maxPostDays) {
                    isActive = true;
                    // Close modal
                    await page.keyboard.press('Escape');
                    await sleep(500, 1000);
                    break;
                  }
                }
                // Close modal and try next post
                await page.keyboard.press('Escape');
                await sleep(500, 1000);
              }
              
              if (!isActive) {
                io.emit('parser:log', { message: `@${username} top 5 posts are all older than ${maxPostDays} days`, type: 'info' });
              }
            } catch(err) {
              // ignore
            }
          }

          if (!isActive) {
            io.emit('parser:log', { message: `Filtered out @${username} (Not active: no recent stories or posts)`, type: 'info' });
            continue;
          }
        }

        // Extract Email and Phone
        const emailMatch = bioText.match(/[\w\.-]+@[\w\.-]+\.\w+/);
        const email = emailMatch ? emailMatch[0] : null;
        const phoneMatch = bioText.match(/(?:\+380|0)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/);
        const extractedPhone = phoneMatch ? phoneMatch[0].replace(/\s/g, '') : `ig_${username}`;

        // Save to DB
        const result = await db`
          INSERT INTO leads (phone, ig_username, name, title, ad_text, source_url, platform, campaign_id, status)
          VALUES (${extractedPhone}, ${username}, ${fullName || username}, ${fullName}, ${bioText + (email ? `\nEmail: ${email}` : '')}, ${`https://instagram.com/${username}`}, 'instagram', ${campaignId || null}, 'new')
          RETURNING *
        `;

        const newLead = {
          id: result[0]?.id,
          phone: `@${username}`, // UI mapping
          name: fullName || username,
          title: 'Instagram Profile',
          platform: 'instagram'
        };

        io.emit('parser:lead', { lead: newLead });
        io.emit('parser:log', { message: `Saved lead: @${username}`, type: 'success' });
        leadsFound++;

        if (campaignId) {
          await db`UPDATE campaigns SET total_leads = total_leads + 1 WHERE id = ${campaignId}`;
        }
        
        if (taskId) {
          await db`UPDATE parsing_tasks SET total_leads = total_leads + 1 WHERE id = ${taskId}`;
        }

      } catch (err) {
        io.emit('parser:log', { message: `Error parsing post: ${err.message}`, type: 'error' });
      }
      
      await sleep(1000, 3000);
    }

    io.emit('parser:log', { message: `Finished! Extracted ${leadsFound} new Instagram leads.`, type: 'info' });

  } catch (err) {
    console.error('Instagram Parser Error:', err);
    io.emit('parser:log', { message: `Fatal error: ${err.message}`, type: 'error' });
    systemLog('parser', 'error', `Instagram parser error: ${err.message}`);
  } finally {
    if (parserBrowser) {
      await parserBrowser.close();
      parserBrowser = null;
    }
    parserRunning = false;
    io.emit('parser:done');
    if (campaignId) {
      await db`UPDATE campaigns SET status='draft' WHERE id=${campaignId}`;
    }
  }
}

export function stopParsing() {
  if (!parserRunning) return { ok: false, message: 'Not running' };
  shouldStop = true;
  io.emit('parser:log', { message: 'Stopping Instagram parser...', type: 'warn' });
  return { ok: true, message: 'Stop signal sent' };
}

export function getParserStatus() {
  return { isRunning: parserRunning };
}

// ───────────────────────────────────────────
// Login Function
// ───────────────────────────────────────────
export async function loginInstagram({ profileId }) {
  if (parserRunning) {
    return { error: 'Parser is currently running. Stop it first.' };
  }

  const profile = await getProfile(profileId);
  if (!profile) return { error: 'Profile not found' };

  systemLog('parser', 'info', `Launching Instagram login for profile: ${profile.name}`);

  try {
    const browser = await playwrightExtra.launch({
      headless: false, // Must be visible for user to log in
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const ctxOptions = buildContextOptions(profile);
    const ctx = await browser.newContext(ctxOptions);
    const page = await ctx.newPage();

    await applyFingerprintScripts(page, profile);

    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
    
    // Wait until the user closes the page or browser
    page.on('close', async () => {
      systemLog('parser', 'info', `Saving session for profile: ${profile.name}`);
      if (profile.session_path) {
        await ctx.storageState({ path: profile.session_path });
      }
      await browser.close();
    });

    return { ok: true, message: 'Browser launched. Please log in and close the browser window.' };
  } catch (err) {
    systemLog('parser', 'error', `Instagram login error: ${err.message}`);
    return { error: err.message };
  }
}
