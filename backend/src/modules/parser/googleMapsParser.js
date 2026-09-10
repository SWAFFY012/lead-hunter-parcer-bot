import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getDb, hasDatabaseConfig } from '../../db/database.js';
import { io } from '../../server.js';
import { systemLog } from '../../utils/logger.js';
import { getProfile, buildContextOptions, applyFingerprintScripts } from '../fingerprint/profileManager.js';
import { collectSocialLinks, crawlWebsiteSocialLinks, mergeSocialLinks } from '../../utils/socialExtractor.js';
import { matchesMapLeadFilters, normalizeMapLeadFilters, shouldCrawlMapLeadWebsiteSocials } from '../../utils/mapLeadFilter.js';
import { getCachedMapLead, rememberMapLead } from '../../utils/mapLeadCache.js';
import { normalizePhone, DEFAULT_REGION } from '../../utils/phoneNormalizer.js';
import {
  finishMapParserRun,
  getMapParserRun,
  recordMapParserLead,
  recordMapParserProgress,
  startMapParserRun,
} from '../../utils/mapParserRunStore.js';

const PLATFORM = 'google_maps';
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
  const {
    url,
    query = url,
    targetCount = 30,
    campaignId = null,
    profileId = null,
    taskId = null,
    region = DEFAULT_REGION,
    niche = null,
  } = options;
  const filters = normalizeMapLeadFilters(options.filters);
  if (parserRunning) {
    io.emit('parser:log', { platform: 'google_maps', message: 'Парсер Google Maps уже запущен', type: 'warn' });
    return { success: false, error: 'Already running' };
  }

  parserRunning = true;
  shouldStop = false;
  startMapParserRun(PLATFORM, { query, targetCount, filters, region, niche });
  io.emit('parser:started', { platform: 'google_maps', targetCount, filters });
  io.emit('parser:status', { isRunning: true, platform: 'google_maps' });
  systemLog('parser', 'info', `Starting Google Maps parser for URL: ${url}`);

  try {
    const db = hasDatabaseConfig() ? getDb() : null;
    const profile = db && profileId ? await getProfile(profileId) : null;
    const contextOptions = profile 
      ? buildContextOptions(profile)
      : {
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    
    io.emit('parser:log', { platform: 'google_maps', message: 'Запускаем браузер Google Карт…', type: 'info' });
    
    // На сервере нет X-сервера, окно браузера показать негде.
    // PARSER_HEADLESS=false включает видимый режим на локальной машине.
    parserBrowser = await playwrightExtra.launch({
      headless: process.env.PARSER_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800',
        '--disable-gpu',
        '--disable-software-rasterizer',
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

    io.emit('parser:log', { platform: 'google_maps', message: `Открываем Google Карты: ${url}`, type: 'info' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // A clean browser profile may receive a Google consent screen first.
    await page.getByRole('button', { name: /Принять все|Accept all|I agree|Согласен/i })
      .first()
      .click({ timeout: 3000 })
      .then(() => page.waitForLoadState('domcontentloaded'))
      .catch(() => {});

    // Wait for the main results list to appear
    const feedFound = await page.waitForSelector('[role="feed"]', { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!feedFound) {
      io.emit('parser:log', {
        platform: 'google_maps',
        message: `Список результатов не найден. Страница: ${await page.title()} (${page.url()})`,
        type: 'error',
      });
    }
    
    io.emit('parser:log', { platform: 'google_maps', message: 'Собираем компании из выдачи…', type: 'info' });
    
    const detailsPage = await context.newPage();
    await detailsPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) route.abort();
      else route.continue();
    });
    const totalPlacesFound = new Set();
    let matchedCount = 0;
    let candidatesChecked = 0;
    let duplicatesSkipped = 0;
    let consecutiveEmptyScrolls = 0;

    io.emit('parser:log', {
      platform: 'google_maps',
      message: `Ищем ${targetCount} компаний, подходящих под выбранные фильтры.`,
      type: 'info',
    });

    for (let scrollIndex = 0; matchedCount < targetCount; scrollIndex++) {
      if (shouldStop) break;
      const feedLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).map((link) => link.href));
      const newLinks = feedLinks.filter((link) => {
        const key = link.split('?')[0];
        if (totalPlacesFound.has(key)) return false;
        totalPlacesFound.add(key);
        return true;
      });
      consecutiveEmptyScrolls = newLinks.length ? 0 : consecutiveEmptyScrolls + 1;

      for (const placeUrl of newLinks) {
        if (shouldStop || matchedCount >= targetCount) break;
        const placeId = placeUrl.split('?')[0];
        if (db && taskId) {
          const [visited] = await db`SELECT place_id FROM google_visited_places WHERE place_id = ${placeId} AND task_id = ${taskId}`;
          if (visited) continue;
        }

        try {
          const cachedLead = await getCachedMapLead('google_maps', placeUrl);
          if (cachedLead) {
            duplicatesSkipped++;
            continue;
          }

          await detailsPage.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(900, 1600);
        
        // Extract data
        const extractedData = await detailsPage.evaluate(() => {
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
          const ratingSpan = document.querySelector('div.F7nice span[aria-hidden="true"]')
            || document.querySelector('span[aria-label*="stars"], span[aria-label*="звезд"]');
          if (ratingSpan) {
            rating = ratingSpan.innerText.trim()
              || (ratingSpan.getAttribute('aria-label') || '').match(/[\d,.]+/)?.[0]
              || '';
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

          const socialUrls = Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => /(?:t\.me|telegram\.me|wa\.me|whatsapp\.com|instagram\.com)/i.test(href));
          
          return { name, title, phone, website, rating, address, isClaimed, socialUrls };
        });
        
        const { name, title, phone, website, rating, address, isClaimed, socialUrls } = extractedData;
        const cardSocialLinks = collectSocialLinks(socialUrls);
        const socialLinks = shouldCrawlMapLeadWebsiteSocials(cardSocialLinks, website, filters)
          ? mergeSocialLinks(cardSocialLinks, await crawlWebsiteSocialLinks(website))
          : cardSocialLinks;
        
        const rawPhone = phone || '';
        const cleanPhone = normalizePhone(rawPhone, region);
        const lead = {
          name,
          title,
          phone: rawPhone,
          website,
          rating,
          address,
          sourceUrl: placeUrl,
          isClaimed,
          socialLinks,
          platform: 'google_maps',
        };
        await rememberMapLead(lead);
        candidatesChecked++;
        const isMatch = matchesMapLeadFilters(lead, filters);
        if (isMatch) {
          matchedCount++;
          recordMapParserLead(PLATFORM, lead);
          io.emit('parser:lead', { lead });
          io.emit('parser:log', { platform: 'google_maps', message: `[${matchedCount}/${targetCount}] Подходит: ${name}`, type: 'success' });
        }

        if (isMatch && db && !cleanPhone) {
          io.emit('parser:log', { platform: 'google_maps', message: `Не сохранён ${name}: не разобран номер «${rawPhone}»`, type: 'warn' });
        }

        if (isMatch && db && cleanPhone) {
          let enrichedAdText = rating ? `Рейтинг: ${rating}. ` : '';
          if (address) enrichedAdText += `Адрес: ${address}. `;
          if (!isClaimed) enrichedAdText += 'Статус: карточка не подтверждена владельцем. ';
          if (socialLinks.length > 0) enrichedAdText += `Соцсети: ${socialLinks.map((item) => item.platform).join(', ')}. `;
          const ad_text = enrichedAdText.trim();

          try {
            await db`
              INSERT INTO leads (phone, name, title, ad_text, city, source_url, website, platform, campaign_id, status, source, niche)
              VALUES (${cleanPhone}, ${name}, ${title}, ${ad_text}, ${address || ''}, ${placeUrl}, ${website}, 'google_maps', ${campaignId}, 'new', 'map_parser', ${niche})
              ON CONFLICT (phone) DO NOTHING
            `;
            io.emit('parser:log', { platform: 'google_maps', message: `Сохранено в CRM: ${name} (${cleanPhone})`, type: 'success' });
          } catch (dbErr) {
            io.emit('parser:log', { platform: 'google_maps', message: `Ошибка сохранения ${name}: ${dbErr.message}`, type: 'error' });
          }
        }
        
        // Mark as visited
        if (db && taskId) {
          await db`
            INSERT INTO google_visited_places (place_id, task_id)
            VALUES (${placeId}, ${taskId})
            ON CONFLICT DO NOTHING
          `;
        }
        
        } catch (err) {
          io.emit('parser:log', { platform: 'google_maps', message: `Не удалось прочитать карточку: ${err.message}`, type: 'error' });
        }

        const progress = {
          platform: 'google_maps',
          currentPage: scrollIndex + 1,
          totalPages: 0,
          matchedCount,
          candidatesChecked,
          duplicatesSkipped,
          targetCount,
        };
        recordMapParserProgress(PLATFORM, progress);
        io.emit('parser:progress', progress);
      }

      if (matchedCount >= targetCount || consecutiveEmptyScrolls >= 3) break;
      const scrolled = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (!feed) return false;
        feed.scrollTop = feed.scrollHeight;
        return true;
      });
      if (!scrolled) break;
      await sleep(1300, 2300);
    }

    const finishType = matchedCount >= targetCount ? 'success' : 'warn';
    io.emit('parser:log', {
      platform: 'google_maps',
      message: matchedCount >= targetCount
        ? `Готово: найдено ${matchedCount} новых подходящих компаний, пропущено из памяти ${duplicatesSkipped}.`
        : `Выдача закончилась: найдено ${matchedCount} из ${targetCount} новых подходящих компаний, проверено ${candidatesChecked}, пропущено из памяти ${duplicatesSkipped}.`,
      type: finishType,
    });

  } catch (err) {
    systemLog('parser', 'error', 'Google Maps parser crashed', err);
    io.emit('parser:log', { platform: 'google_maps', message: `Критическая ошибка: ${err.message}`, type: 'error' });
  } finally {
    await cleanup();
  }
}

export function stopParsing() {
  shouldStop = true;
  io.emit('parser:log', { platform: 'google_maps', message: 'Остановка парсера...', type: 'warn' });
}

export function getParserStatus() {
  return getMapParserRun(PLATFORM, parserRunning);
}

async function cleanup() {
  if (parserBrowser) {
    try {
      await parserBrowser.close();
    } catch (e) {}
    parserBrowser = null;
  }
  parserRunning = false;
  finishMapParserRun(PLATFORM);
  io.emit('parser:status', { isRunning: false, platform: 'google_maps' });
  io.emit('parser:done', { platform: 'google_maps' });
  io.emit('parser:log', { platform: 'google_maps', message: 'Парсер Google Карт завершён.', type: 'info' });
}
