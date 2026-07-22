/**
 * OLX Parser Module
 * Uses Playwright + stealth plugin to scrape OLX.ua listings.
 * Saves auth via storageState.json for persistent sessions.
 */
import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

import { getDb } from '../../db/database.js';
import { io } from '../../server.js';
import { systemLog } from '../../utils/logger.js';
import { getProfile, buildContextOptions, applyFingerprintScripts } from '../fingerprint/profileManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../../data');
const OLX_SESSION_PATH = join(DATA_DIR, 'olx-sessions', 'storageState.json');

// Stealth-enhanced playwright
const playwrightExtra = addExtra(chromium);
playwrightExtra.use(StealthPlugin());

let parserRunning = false;
let parserBrowser = null;
let shouldStop = false;

let authBrowser = null;
let authCtx = null;

// ───────────────────────────────────────────
// Utility: random sleep
// ───────────────────────────────────────────
function sleep(min, max) {
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

// ───────────────────────────────────────────
// Utility: human-like mouse movement
// ───────────────────────────────────────────
async function humanClick(page, selector) {
  const element = await page.$(selector);
  if (!element) return false;

  const box = await element.boundingBox();
  if (!box) return false;

  // Move to random position within element
  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);

  await page.mouse.move(x - 50, y - 30, { steps: 5 });
  await sleep(100, 300);
  await page.mouse.move(x, y, { steps: 3 });
  await sleep(50, 150);
  await element.click();
  return true;
}

// ───────────────────────────────────────────
// Random scroll to simulate reading
// ───────────────────────────────────────────
async function randomScroll(page) {
  const scrolls = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 200 + Math.random() * 400);
    await sleep(500, 1500);
  }
}

// ───────────────────────────────────────────
// Launch OLX auth session (first time)
// ───────────────────────────────────────────
export async function launchOlxAuth(profileId) {
  if (parserRunning || authBrowser) throw new Error('Parser or Auth already running');

  const profile = profileId ? await getProfile(profileId) : null;

  try {
    authBrowser = await playwrightExtra.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const ctxOptions = profile
      ? { ...buildContextOptions(profile), storageState: undefined } // don't pre-load session for fresh auth
      : {
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

    authCtx = await authBrowser.newContext(ctxOptions);
    const page = await authCtx.newPage();

    if (profile) await applyFingerprintScripts(page, profile);

    await page.goto('https://www.olx.ua/uk/', { timeout: 30000 });

    io.emit('parser:auth', {
      message: 'Окно открыто. Авторизуйтесь и нажмите "Я вошел" в приложении.' + (profile ? ' [Профиль: ' + profile.name + ']' : ''),
      status: 'waiting_manual',
      profileId: profileId || null,
    });

    // Detect manual close
    authBrowser.on('disconnected', () => {
      if (authBrowser) { // If not closed by cancel/confirm intentionally
        console.log('[Parser] Auth browser was manually closed.');
        cancelOlxAuth(profileId);
      }
    });

    // Autonomous test for DataDome block
    // We check the page text repeatedly in the background
    const checkBlockInterval = setInterval(async () => {
      if (!authBrowser || !authCtx) {
        clearInterval(checkBlockInterval);
        return;
      }
      try {
        const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (bodyText.includes('Неможливо продовжити, оскільки ми виявили підозрілу активність') ||
            bodyText.includes('Подозрительная активность')) {
          clearInterval(checkBlockInterval);
          console.log('[Parser] Block detected! Auto-canceling session...');
          io.emit('parser:auth', { message: 'Блокировка. Сессия удалена. Нужен другой прокси', status: 'error' });
          await cancelOlxAuth(profileId);
        }
      } catch (err) {
        // Ignored, might fail if page is navigating or closed
      }
    }, 2000);

  } catch (err) {
    console.error('[Parser Auth Error]:', err);
    io.emit('parser:error', { message: err.message });
    io.emit('parser:auth', { message: 'Ошибка при запуске браузера.', status: 'error' });
    if (authBrowser) {
      await authBrowser.close();
      authBrowser = null;
      authCtx = null;
    }
  }

  return true;
}

export async function confirmOlxAuth(profileId) {
  if (!authBrowser || !authCtx) throw new Error('No auth browser running');

  const profile = profileId ? await getProfile(profileId) : null;
  const savePath = (profile && profile.session_path) ? profile.session_path : OLX_SESSION_PATH;

  try {
    const sessionDir = dirname(savePath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    await authCtx.storageState({ path: savePath });
    io.emit('parser:auth', { 
      message: 'OLX сессия успешно сохранена!' + (profile ? ' [Профиль: ' + profile.name + ']' : ''),
      status: 'done'
    });
  } catch (err) {
    console.error('[Parser Auth Confirm Error]:', err);
    io.emit('parser:error', { message: err.message });
    io.emit('parser:auth', { message: 'Ошибка сохранения сессии.', status: 'error' });
  } finally {
    if (authBrowser) {
      await authBrowser.close();
      authBrowser = null;
      authCtx = null;
    }
  }
  return existsSync(savePath);
}

export async function cancelOlxAuth(profileId) {
  const profile = profileId ? await getProfile(profileId) : null;
  const savePath = (profile && profile.session_path) ? profile.session_path : OLX_SESSION_PATH;

  try {
    if (existsSync(savePath)) {
      import('fs').then(fs => fs.unlinkSync(savePath)).catch(() => {});
    }
    io.emit('parser:auth', { message: 'Авторизация отменена. Сессия удалена.', status: 'canceled' });
  } catch (err) {
    console.error('[Parser Auth Cancel Error]:', err);
  } finally {
    if (authBrowser) {
      await authBrowser.close().catch(() => {});
      authBrowser = null;
      authCtx = null;
    }
  }
  return true;
}

export async function importCookies(profileId, cookiesData) {
  const profile = profileId ? await getProfile(profileId) : null;
  const savePath = (profile && profile.session_path) ? profile.session_path : OLX_SESSION_PATH;

  try {
    const sessionDir = dirname(savePath);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const formattedCookies = cookiesData.map(c => {
      const cookie = { ...c };
      if (cookie.expirationDate) {
        cookie.expires = cookie.expirationDate;
        delete cookie.expirationDate;
      }
      if (cookie.hostOnly !== undefined) delete cookie.hostOnly;
      if (cookie.session !== undefined) delete cookie.session;
      if (cookie.storeId !== undefined) delete cookie.storeId;
      if (cookie.id !== undefined) delete cookie.id;
      if (cookie.sameSite !== undefined) {
        if (typeof cookie.sameSite === 'string') {
           const s = cookie.sameSite.toLowerCase();
           if (s === 'no_restriction' || s === 'none') cookie.sameSite = 'None';
           else if (s === 'lax') cookie.sameSite = 'Lax';
           else if (s === 'strict') cookie.sameSite = 'Strict';
           else delete cookie.sameSite;
        } else {
           delete cookie.sameSite;
        }
      }
      return cookie;
    });


    writeFileSync(savePath, JSON.stringify({ cookies: formattedCookies }));
    
    if (userAgent) {
      writeFileSync(join(sessionDir, 'custom_ua.txt'), userAgent, 'utf8');
    }
    
    io.emit('parser:auth', { message: 'Куки успешно импортированы!', status: 'done' });
    return true;
  } catch (err) {
    console.error('[Parser Import Cookies Error]:', err);
    throw new Error('Failed to import cookies: ' + err.message);
  }
}

export async function getCookies(profileId) {
  const profile = profileId ? await getProfile(profileId) : null;
  const savePath = (profile && profile.session_path) ? profile.session_path : OLX_SESSION_PATH;
  try {
    if (existsSync(savePath)) {
      const data = import('fs').then(fs => JSON.parse(fs.readFileSync(savePath, 'utf8')));
      return (await data).cookies || [];
    }
  } catch (err) {
    console.error('[Parser Get Cookies Error]:', err);
  }
  return [];
}

// ───────────────────────────────────────────
// Scrape a single listing page
// ───────────────────────────────────────────
async function scrapeListing(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    
  // Track all requests to debug
  const allRequests = [];
  page.on('response', resp => {
    const status = resp.status();
    const reqUrl = resp.url();
    allRequests.push({ url: reqUrl, status });
    if (status === 403 || status === 401) {
      resp.text().then(text => {
        console.log(`[NETWORK ERROR] ${status} on ${reqUrl}\nHEADERS:`, resp.headers(), `\nBODY:`, text.substring(0, 500));
      }).catch(()=>{});
    }
  });

  // Wait 5 seconds before attempting click
  await page.waitForTimeout(5000);
  await randomScroll(page);

  let phone = null;
  let name = null;
  let title = null;
  let adText = null;
  let city = null;

  try {
    // Title
    title = await page.$eval(
      'h4.css-1juynto, h1[data-cy="ad_title"]',
      el => el.textContent?.trim()
    ).catch(() => null);

    // Description text
    adText = await page.$eval(
      'div[data-cy="ad_description"] > div',
      el => el.textContent?.trim()
    ).catch(() => null);

    // City/location
    city = await page.$eval(
      'p[data-testid="location-date"]',
      el => el.textContent?.split(',')[0]?.trim()
    ).catch(() => null);

    // Seller name
    name = await page.$eval(
      'h2.css-u8481b, [data-cy="seller_name"]',
      el => el.textContent?.trim()
    ).catch(() => null);

    // --- BLOCK ANALYSIS ---
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (pageText.includes('Неможливо продовжити') || pageText.includes('Подозрительная активность')) {
      throw new Error('BLOCK_DETECTED');
    }

    // --- Click "Show phone" button ---
    try {
      // Set up network interception BEFORE click to catch the API call
      const phoneApiPromise = page.waitForResponse(
        (resp) => resp.status() === 200 && (
          /api\.olx\.(ua|kz|pl)|phone|reveal|contact/i.test(resp.url())
        ),
        { timeout: 8000 }
      ).catch(() => null);

      let clicked = false;
      try {
        const btns = page.locator('button', { hasText: /(показати|показать)/i });
        const count = await btns.count();
        if (count > 0) {
          const btn = btns.nth(count - 1);
          // Scroll it into view
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await sleep(500, 1000);
          
          const box = await btn.boundingBox();
          if (box) {
            // Emulate human mouse movements
            const x = box.x + box.width * (0.3 + Math.random() * 0.4);
            const y = box.y + box.height * (0.3 + Math.random() * 0.4);
            
            await page.mouse.move(x - 50, y - 30, { steps: 5 });
            await sleep(100, 300);
            await page.mouse.move(x, y, { steps: 3 });
            await sleep(50, 150);
            await page.mouse.click(x, y);
            clicked = true;
          } else {
            await btn.click({ force: true });
            clicked = true;
          }
        }
      } catch (e) {
        console.log('[Parser] Error clicking phone button:', e.message);
      }

      if (clicked) {
        // Wait for either network response or DOM change
        const [apiResp] = await Promise.all([phoneApiPromise]);
        await page.waitForTimeout(2000);

        if (apiResp) {
          try {
            const body = await apiResp.json();
            console.log('[Parser] Phone API response:', JSON.stringify(body).substring(0, 200));
            // OLX API returns phone in different paths, try common ones
            phone = body?.phone || body?.data?.phone || body?.phones?.[0] || null;
          } catch(e) {
            // Not JSON, ignore
          }
        }

        if (!phone) {
          // DOM fallback: after click OLX replaces button with a link containing tel:
          phone = await page.$$eval('a[href^="tel:"]', els => {
            const el = els[0];
            return el ? el.href.replace('tel:', '') : null;
          }).catch(() => null);
        }

        if (!phone) {
          // DOM fallback 2: Regex search across common elements
          phone = await page.evaluate(() => {
            const regex = /(\+?38)?\s?\(?0\d{2}\)?[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}/;
            const elements = Array.from(document.querySelectorAll('button, a, span, div, p'));
            for (const el of elements) {
              const text = el.innerText || '';
              if (regex.test(text) && text.length < 50) { // Keep it specific to elements that mostly just contain the phone
                const match = text.match(regex);
                return match ? match[0].trim() : null;
              }
            }
            return null;
          });
        }



        if (!phone) {
          const ts = Date.now();
          import('fs').then(fs => {
            if (!fs.existsSync('../data/debug_screenshots')) {
              fs.mkdirSync('../data/debug_screenshots', { recursive: true });
            }
            page.screenshot({ path: `../data/debug_screenshots/error_${ts}.png`, fullPage: true }).catch(() => {});
          });
          console.log('[Parser] No phone found after click, screenshot saved');
          console.log('[NETWORK CAPTURES IN LAST 5 SECONDS]:');
          allRequests.slice(-30).forEach(r => console.log(` - [${r.status}] ${r.url.substring(0, 150)}`));
        }
      } else {
        // Button not found, save screenshot for debug
        import('fs').then(fs => {
          if (!fs.existsSync('../data/debug_screenshots')) {
            fs.mkdirSync('../data/debug_screenshots', { recursive: true });
          }
          const ts = Date.now();
          page.screenshot({ path: `../data/debug_screenshots/error_${ts}.png`, fullPage: true }).catch(() => {});
          console.log(`[Parser] Phone button not found on ${url}, screenshot: error_${ts}.png`);
        });
        const htmlDump = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
        console.log(`[Parser Debug HTML]: ${htmlDump}`);
      }

    } catch (e) {
      console.log('[Parser] Failed to extract phone:', e.message);
    }

    // Normalization
    if (phone) {
      phone = phone.replace(/[\s\-\(\)]/g, '').replace(/\D/g, '');
      if (phone.length === 9) {
        phone = '0' + phone;
      } else if (phone.length !== 10 || !phone.startsWith('0')) {
        console.log('[Parser] Unrecognized phone format, saving as is:', phone);
      }
    }

  } catch (err) {
    if (err.message === 'BLOCK_DETECTED') throw err;
    console.error('[Parser] Scrape error on', url, ':', err.message);
  }

  return { phone, name, title, adText, city, url };
}

// ───────────────────────────────────────────
// Main parse function
// ───────────────────────────────────────────
export async function startParsing({ url, pages = 3, campaignId, profileId }) {
  if (parserRunning) return { ok: false, message: 'Parser already running' };

  const profile = profileId ? await getProfile(profileId) : null;
  const sessionPath = (profile && profile.session_path) ? profile.session_path : OLX_SESSION_PATH;

  if (!existsSync(sessionPath)) {
    return { ok: false, message: 'OLX session not found. Please authorize first.' };
  }

  parserRunning = true;
  shouldStop = false;

  const db = getDb();
  let collected = 0;
  let duplicates = 0;
  let errors = 0;
  const listingLinks = [];

  try {
    parserBrowser = await playwrightExtra.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    let customUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    try {
      const uaPath = join(dirname(sessionPath), 'custom_ua.txt');
      if (existsSync(uaPath)) {
        customUa = readFileSync(uaPath, 'utf8').trim();
      }
    } catch(e) {}

    const ctxOptions = profile
      ? buildContextOptions(profile)
      : {
          storageState: sessionPath,
          viewport: { width: 1920, height: 1080 },
          userAgent: customUa,
          locale: 'uk-UA',
        };

    const ctx = await parserBrowser.newContext(ctxOptions);
    const page = await ctx.newPage();

    io.emit('parser:started', { url, pages, campaignId });

    // ── Collect listing links across pages ──
    for (let pageNum = 1; pageNum <= pages; pageNum++) {
      if (shouldStop) break;

      const pageUrl = pageNum === 1 ? url : `${url}?page=${pageNum}`;
      io.emit('parser:progress', {
        phase: 'collecting',
        currentPage: pageNum,
        totalPages: pages,
        links: listingLinks.length
      });

      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000, 5000);
        await randomScroll(page);

        // Get all listing links on this page
        const links = await page.$$eval(
          'a[data-cy="listing-ad-title"], div[data-cy="l-card"] a[class*="css"]',
          els => els
            .map(el => el.href)
            .filter(href => href && href.includes('/d/') && !href.includes('promote'))
            .filter((v, i, a) => a.indexOf(v) === i) // unique
        );

        listingLinks.push(...links);
        io.emit('parser:log', { message: `Page ${pageNum}: found ${links.length} listings`, type: 'info' });

        await sleep(3000, 7000); // delay between pages
      } catch (err) {
        io.emit('parser:log', { message: `Page ${pageNum} error: ${err.message}`, type: 'error' });
        errors++;
      }
    }

    io.emit('parser:log', { message: `Total links collected: ${listingLinks.length}`, type: 'info' });

    // ── Scrape each listing ──
    // ── Scrape each listing ──

    for (let i = 0; i < listingLinks.length; i++) {
      if (shouldStop) break;

      const link = listingLinks[i];
      io.emit('parser:progress', {
        phase: 'scraping',
        current: i + 1,
        total: listingLinks.length,
        collected, duplicates, errors
      });

      // Delay between listings (2-7 seconds)
      if (i > 0) await sleep(2000, 7000);

      try {
        const data = await scrapeListing(page, link);

        if (!data.phone) {
          io.emit('parser:log', { message: `No phone found at ${link}`, type: 'warn' });
          errors++;
          continue;
        }

        // Check for duplicate
        const [existing] = await db`SELECT id FROM leads WHERE phone=${data.phone}`;
        if (existing) {
          duplicates++;
          io.emit('parser:log', { message: `Duplicate: ${data.phone}`, type: 'skip' });
          continue;
        }

        const result = await db`
          INSERT INTO leads (phone, name, title, ad_text, source_url, city, campaign_id)
          VALUES (${data.phone}, ${data.name}, ${data.title}, ${data.adText}, ${data.url}, ${data.city}, ${campaignId || null})
          ON CONFLICT (phone) DO NOTHING
          RETURNING *
        `;

        if (result.length > 0) {
          collected++;
          const lead = result[0];
          io.emit('parser:lead', { lead });
          io.emit('parser:log', {
            message: `✓ ${data.name || 'Unknown'} | ${data.phone} | ${data.title?.substring(0, 40)}`,
            type: 'success'
          });
        }

      } catch (err) {
        if (err.message.includes('DataDome')) {
          io.emit('parser:log', { message: 'DataDome block detected! Stopping parser.', type: 'error' });
          systemLog('parser', 'error', 'DataDome block detected', { url: link });
          break; // Stop parsing
        }
        errors++;
        io.emit('parser:log', { message: `Error on ${link}: ${err.message}`, type: 'error' });
        systemLog('parser', 'warn', `Error parsing item`, { url: link, error: err.message });
      }
    }

    // Update campaign stats
    if (campaignId) {
      await db`UPDATE campaigns SET total_leads = total_leads + ${collected}, status = 'ready' WHERE id = ${campaignId}`;
    }

  } catch (err) {
    io.emit('parser:error', { message: err.message });
    console.error('[Parser] Fatal error:', err);
  } finally {
    if (parserBrowser) { await parserBrowser.close(); parserBrowser = null; }
    parserRunning = false;

    io.emit('parser:done', { collected, duplicates, errors });
    io.emit('parser:log', {
      message: `✅ Done! Collected: ${collected} | Duplicates: ${duplicates} | Errors: ${errors}`,
      type: 'done'
    });
  }

  return { ok: true, collected, duplicates, errors };
}

export function stopParsing() {
  shouldStop = true;
  return { ok: true, message: 'Parser stopping...' };
}

export function getParserStatus() {
  return { running: parserRunning, hasSession: existsSync(OLX_SESSION_PATH) };
}
