import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getDb } from '../../db/database.js';
import { io } from '../../server.js';
import { systemLog } from '../../utils/logger.js';
import { getProfile, buildContextOptions, applyFingerprintScripts } from '../fingerprint/profileManager.js';

const playwrightExtra = addExtra(chromium);
playwrightExtra.use(StealthPlugin());

let parserRunning = false;
let parserBrowser = null;
let shouldStop = false;

function sleep(min, max) {
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

export async function startGoogleMapsParsing(options) {
  const { url, pages = 3, campaignId = null, profileId = null, taskId = null } = options;
  if (parserRunning) {
    io.emit('parser:log', { message: 'Парсер Google Maps уже запущен', type: 'warn' });
    return { success: false, error: 'Already running' };
  }

  parserRunning = true;
  shouldStop = false;
  io.emit('parser:status', { isRunning: true, platform: 'google_maps' });
  systemLog('parser', 'info', `Starting Google Maps parser for URL: ${url}`);

  try {
    const db = await getDb();
    const profile = profileId ? await getProfile(profileId) : null;
    const contextOptions = profile 
      ? buildContextOptions(profile)
      : {
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    
    io.emit('parser:log', { message: 'Launching browser for Google Maps...', type: 'info' });
    
    parserBrowser = await playwrightExtra.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800',
        '--disable-dev-shm-usage',
      ]
    });

    const context = await parserBrowser.newContext({
      ...contextOptions,
      viewport: { width: 1280, height: 800 }
    });
    
    const page = await context.newPage();
    if (profile) {
      await applyFingerprintScripts(page, profile);
    }

    // Optimization: Intercept and block unnecessary resources
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    io.emit('parser:log', { message: `Navigating to: ${url}`, type: 'info' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Wait for the main results list to appear
    await page.waitForSelector('[role="feed"]', { timeout: 15000 }).catch(() => {});
    
    io.emit('parser:log', { message: 'Collecting places from the list...', type: 'info' });
    
    let totalPlacesFound = new Set();
    let placeLinks = [];
    
    // Scroll the feed to load results (simulate pagination)
    for (let p = 0; p < pages; p++) {
      if (shouldStop) break;
      
      const feedLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
        return links.map(a => a.href);
      });
      
      for (const link of feedLinks) {
        if (!totalPlacesFound.has(link)) {
          totalPlacesFound.add(link);
          placeLinks.push(link);
        }
      }
      
      io.emit('parser:log', { message: `Scroll ${p + 1}/${pages}: Found ${totalPlacesFound.size} total places so far.`, type: 'info' });
      
      // Scroll the feed element down
      const scrolled = await page.evaluate(async () => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) {
          feed.scrollTop = feed.scrollHeight;
          return true;
        }
        return false;
      });
      
      if (!scrolled) {
        io.emit('parser:log', { message: 'Feed not found or cannot scroll further.', type: 'warn' });
        break;
      }
      
      await sleep(2000, 4000); // Wait for new items to load
    }
    
    if (shouldStop) {
      io.emit('parser:log', { message: 'Stopped collecting places.', type: 'info' });
      return cleanup();
    }
    
    // Filter out visited places
    let placesToVisit = [];
    let skippedCount = 0;
    if (taskId) {
      for (const link of placeLinks) {
        // We use the Place ID or the full URL as place_id
        const placeId = link.split('?')[0]; 
        const [visited] = await db`SELECT place_id FROM google_visited_places WHERE place_id = ${placeId} AND task_id = ${taskId}`;
        if (visited) {
          skippedCount++;
        } else {
          placesToVisit.push(link);
        }
      }
      if (skippedCount > 0) {
        io.emit('parser:log', { message: `Skipped ${skippedCount} places already visited in this task.`, type: 'info' });
      }
    } else {
      placesToVisit = placeLinks;
    }
    
    io.emit('parser:log', { message: `Visiting ${placesToVisit.length} new places to extract contacts...`, type: 'info' });
    
    let leadsExtracted = 0;
    
    for (let i = 0; i < placesToVisit.length; i++) {
      if (shouldStop) break;
      const placeUrl = placesToVisit[i];
      io.emit('parser:log', { message: `[${i + 1}/${placesToVisit.length}] Analyzing: ${placeUrl.substring(0, 80)}...`, type: 'info' });
      
      try {
        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1500, 3000);
        
        // Extract data
        const extractedData = await page.evaluate(() => {
          const nameEl = document.querySelector('h1');
          const name = nameEl ? nameEl.innerText.trim() : '';
          
          // The category is usually a button below the rating
          const categoryBtn = document.querySelector('button[jsaction="pane.rating.category"]');
          const title = categoryBtn ? categoryBtn.innerText.trim() : '';
          
          // Phones usually have data-item-id starting with 'phone:tel:'
          let phone = '';
          const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
          if (phoneBtn) {
            const dataItemId = phoneBtn.getAttribute('data-item-id');
            if (dataItemId) {
              phone = dataItemId.replace('phone:tel:', ''); // Extracts clean phone directly from attribute!
            }
            if (!phone) {
              const phoneDiv = phoneBtn.querySelector('.fontBodyMedium');
              if (phoneDiv) phone = phoneDiv.innerText.trim();
            }
          }
          
          let website = '';
          const websiteBtn = document.querySelector('a[data-item-id="authority"]');
          if (websiteBtn) {
            website = websiteBtn.href;
          }
          
          let rating = '';
          const ratingSpan = document.querySelector('span[aria-label*="stars"]');
          if (ratingSpan) {
            rating = ratingSpan.innerText.trim();
          }
          
          let address = '';
          const addressBtn = document.querySelector('button[data-item-id="address"]');
          if (addressBtn) {
            const addrDiv = addressBtn.querySelector('.fontBodyMedium') || addressBtn;
            if (addrDiv) address = addrDiv.innerText.trim();
          }

          let isClaimed = true;
          if (document.querySelector('a[href*="business.google.com/add"]')) {
            isClaimed = false;
          }

          let socialLinks = [];
          document.querySelectorAll('a[href*="instagram.com"]').forEach(a => socialLinks.push('Insta'));
          document.querySelectorAll('a[href*="facebook.com"]').forEach(a => socialLinks.push('FB'));
          
          return { name, title, phone, website, rating, address, isClaimed, socialLinks };
        });
        
        const { name, title, phone, website, rating, address, isClaimed, socialLinks } = extractedData;
        
        // Clean phone
        const rawPhone = phone || '';
        let cleanPhone = rawPhone.replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          // Valid phone found!
          let enrichedAdText = rating ? `Рейтинг: ${rating}. ` : '';
          if (address) enrichedAdText += `Адрес: ${address}. `;
          if (!isClaimed) enrichedAdText += `Статус: ТОЧКА НЕ ПОДТВЕРЖДЕНА ВЛАДЕЛЬЦЕМ (UNCLAIMED). `;
          if (socialLinks.length > 0) enrichedAdText += `Соцсети: ${socialLinks.join(', ')}. `;
          
          const ad_text = enrichedAdText.trim();
          
          // Insert into database
          try {
            await db`
              INSERT INTO leads (phone, name, title, ad_text, source_url, website, platform, campaign_id, status)
              VALUES (${cleanPhone}, ${name}, ${title}, ${ad_text}, ${placeUrl}, ${website}, 'google_maps', ${campaignId}, 'new')
              ON CONFLICT (phone) DO NOTHING
            `;
            leadsExtracted++;
            io.emit('parser:log', { message: `Saved lead: ${name} (${cleanPhone})`, type: 'success' });
          } catch (dbErr) {
            io.emit('parser:log', { message: `DB Error saving ${name}: ${dbErr.message}`, type: 'error' });
          }
        } else {
          io.emit('parser:log', { message: `No valid phone for: ${name}`, type: 'warn' });
        }
        
        // Mark as visited
        if (taskId) {
          const placeId = placeUrl.split('?')[0];
          await db`
            INSERT INTO google_visited_places (place_id, task_id)
            VALUES (${placeId}, ${taskId})
            ON CONFLICT DO NOTHING
          `;
        }
        
      } catch (err) {
        io.emit('parser:log', { message: `Error parsing place: ${err.message}`, type: 'error' });
      }
    }
    
    io.emit('parser:log', { message: `Finished! Extracted ${leadsExtracted} new Google Maps leads.`, type: 'success' });

  } catch (err) {
    systemLog('parser', 'error', 'Google Maps parser crashed', err);
    io.emit('parser:log', { message: `Критическая ошибка: ${err.message}`, type: 'error' });
  } finally {
    await cleanup();
  }
}

export function stopParsing() {
  shouldStop = true;
  io.emit('parser:log', { message: 'Остановка парсера...', type: 'warn' });
}

export function getParserStatus() {
  return { isRunning: parserRunning };
}

async function cleanup() {
  if (parserBrowser) {
    try {
      await parserBrowser.close();
    } catch (e) {}
    parserBrowser = null;
  }
  parserRunning = false;
  io.emit('parser:status', { isRunning: false, platform: 'google_maps' });
  io.emit('parser:log', { message: 'Парсер завершен!', type: 'info' });
}
