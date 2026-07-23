import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { io } from '../../server.js';
import { collectSocialLinks, crawlWebsiteSocialLinks } from '../../utils/socialExtractor.js';
import { matchesMapLeadFilters, normalizeMapLeadFilters } from '../../utils/mapLeadFilter.js';
import { getCachedMapLead, rememberMapLead } from '../../utils/mapLeadCache.js';

const playwrightExtra = addExtra(chromium);
playwrightExtra.use(StealthPlugin());

let parserRunning = false;
let parserBrowser = null;
let shouldStop = false;

const socialNames = ['telegram', 'whatsapp', 'instagram'];
const allowedSocialUrl = /(?:t\.me|telegram\.me|wa\.me|whatsapp\.com|instagram\.com)/i;

function sleep(min, max) {
  const delay = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function collectOrganizationLinks(page) {
  return page.locator('a[href*="/maps/org/"]')
    .evaluateAll((links) => [...new Set(links.map((link) => {
      try {
        const url = new URL(link.href);
        const basePath = url.pathname.match(/^\/maps\/org\/[^/]+\/\d+/)?.[0];
        return basePath ? `${url.origin}${basePath}/` : '';
      } catch {
        return '';
      }
    }).filter(Boolean))]);
}

async function collectCardSocials(page) {
  const collectedUrls = [];
  for (const name of socialNames) {
    const button = page.getByRole('button', { name: new RegExp(`Соцсети, ${name}`, 'i') }).first();
    if (await button.count() === 0) continue;

    const embeddedUrls = await button.evaluate((element) => [
      ...Array.from(element.attributes).map((attribute) => attribute.value),
      element.textContent || '',
    ]).catch(() => []);
    const embeddedLinks = collectSocialLinks(embeddedUrls.filter((value) => allowedSocialUrl.test(value)));
    if (embeddedLinks.length) {
      collectedUrls.push(embeddedLinks[0].url);
      continue;
    }

    const context = page.context();
    const requestedUrls = [];
    const captureSocialRequest = (request) => {
      if (allowedSocialUrl.test(request.url())) requestedUrls.push(request.url());
    };
    context.on('request', captureSocialRequest);
    const popupPromise = page.waitForEvent('popup', { timeout: 2500 }).catch(() => null);
    let popup = null;

    try {
      const clicked = await button.click({ timeout: 1500 }).then(() => true).catch(() => false);
      if (!clicked) continue;
      popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded', { timeout: 1800 }).catch(() => {});
        await sleep(80, 140);
        requestedUrls.push(popup.url());
      }

      const interceptedUrls = await page.evaluate(() => window.__leadHunterOpenedUrls?.splice(0) || []);
      requestedUrls.push(...interceptedUrls);
      const socialLinks = collectSocialLinks(
        requestedUrls.filter((url) => allowedSocialUrl.test(url) && !/t\.me\/mapsyandex/i.test(url))
      );
      if (socialLinks.length) collectedUrls.push(socialLinks[0].url);
    } finally {
      context.off('request', captureSocialRequest);
      await popup?.close().catch(() => {});
    }
  }
  return collectSocialLinks(collectedUrls);
}

async function extractCard(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const pageText = document.body.innerText;
    const phone = pageText.match(/\+\d[\d\s()-]{8,}\d/)?.[0] || '';
    const websiteElement = document.querySelector('a.business-contacts-view__website')
      || Array.from(document.querySelectorAll('a[href^="http"]')).find((link) => {
        try {
          const host = new URL(link.href).hostname;
          return !/(?:^|\.)(?:yandex\.|ya\.)/i.test(host) && /\.[a-zа-я]{2,}/i.test(link.textContent || '');
        } catch {
          return false;
        }
      });
    const addressElement = document.querySelector('.business-contacts-view__address-link')
      || document.querySelector('a[href*="/house/"]');
    const ratingElement = document.querySelector('.business-summary-rating-badge-view__rating-text')
      || Array.from(document.querySelectorAll('*')).find((element) => element.textContent?.trim() === 'Рейтинг')?.nextElementSibling;
    return {
      name: clean(document.querySelector('h1')?.textContent),
      title: clean(document.querySelector('a[href*="/category/"]')?.textContent),
      phone: clean(phone),
      website: websiteElement?.href || '',
      rating: clean(ratingElement?.textContent),
      address: clean(addressElement?.textContent),
      description: clean(document.querySelector('meta[name="description"]')?.getAttribute('content')),
    };
  });
}

export async function startYandexMapsParsing({ query, targetCount = 30, filters: rawFilters = {} }) {
  if (parserRunning) return { success: false, error: 'Парсер Яндекс Карт уже запущен.' };
  const filters = normalizeMapLeadFilters(rawFilters);
  parserRunning = true;
  shouldStop = false;
  io.emit('parser:started', { platform: 'yandex_maps', targetCount, filters });
  io.emit('parser:status', { isRunning: true, platform: 'yandex_maps' });

  try {
    parserBrowser = await playwrightExtra.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1366,850'],
    });
    const context = await parserBrowser.newContext({
      viewport: { width: 1366, height: 850 },
      locale: 'ru-RU',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const searchPage = await context.newPage();
    await searchPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) route.abort();
      else route.continue();
    });

    const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(query)}`;
    io.emit('parser:log', { platform: 'yandex_maps', message: `Открываем Яндекс Карты: ${query}`, type: 'info' });
    await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await searchPage.getByRole('button', { name: /Разрешить все|Принять все|Согласен/i }).first().click({ timeout: 2500 }).catch(() => {});
    await searchPage.waitForSelector('a[href*="/maps/org/"]', { timeout: 20_000 });

    const firstResultsUrl = searchPage.url();
    const paginationUrls = await searchPage.locator('a[href*="/search/"][href*="page="]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.href))]);
    const paginationTemplate = paginationUrls[0] || firstResultsUrl;
    const detailsPage = await context.newPage();
    await detailsPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) route.abort();
      else route.continue();
    });

    const organizations = new Set();
    let matchedCount = 0;
    let candidatesChecked = 0;
    let duplicatesSkipped = 0;
    let consecutiveEmptyPages = 0;
    io.emit('parser:log', { platform: 'yandex_maps', message: `Ищем ${targetCount} компаний, подходящих под выбранные фильтры.`, type: 'info' });

    for (let pageIndex = 0; matchedCount < targetCount; pageIndex++) {
      if (shouldStop) break;
      if (pageIndex > 0) {
        const nextPageUrl = new URL(paginationTemplate);
        nextPageUrl.searchParams.set('page', String(pageIndex + 1));
        await searchPage.goto(nextPageUrl.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await searchPage.waitForSelector('a[href*="/maps/org/"]', { timeout: 15_000 }).catch(() => {});
      }

      const pageLinks = await collectOrganizationLinks(searchPage);
      const newLinks = pageLinks.filter((link) => {
        if (organizations.has(link)) return false;
        organizations.add(link);
        return true;
      });
      consecutiveEmptyPages = newLinks.length ? 0 : consecutiveEmptyPages + 1;

      for (const sourceUrl of newLinks) {
        if (shouldStop || matchedCount >= targetCount) break;
        try {
          const cachedLead = await getCachedMapLead('yandex_maps', sourceUrl);
          if (cachedLead) {
            duplicatesSkipped++;
            continue;
          }

          await detailsPage.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 });
          await detailsPage.waitForSelector('h1', { timeout: 12_000 });
          await sleep(500, 900);
          const card = await extractCard(detailsPage);
          const cardSocialLinks = await collectCardSocials(detailsPage);
          const socialLinks = cardSocialLinks.length
            ? cardSocialLinks
            : await crawlWebsiteSocialLinks(card.website);
          const lead = {
            ...card,
            socialLinks,
            sourceUrl,
            isClaimed: true,
            platform: 'yandex_maps',
          };
          await rememberMapLead(lead);
          candidatesChecked++;
          if (matchesMapLeadFilters(lead, filters)) {
            matchedCount++;
            io.emit('parser:lead', { lead });
            io.emit('parser:log', { platform: 'yandex_maps', message: `[${matchedCount}/${targetCount}] Подходит: ${card.name}`, type: 'success' });
          }
        } catch (error) {
          io.emit('parser:log', { platform: 'yandex_maps', message: `Не удалось прочитать карточку: ${error.message}`, type: 'error' });
        }
      }

      io.emit('parser:progress', {
        platform: 'yandex_maps',
        currentPage: pageIndex + 1,
        totalPages: 0,
        matchedCount,
        candidatesChecked,
        duplicatesSkipped,
        targetCount,
      });
      io.emit('parser:log', {
        platform: 'yandex_maps',
        message: `Страница ${pageIndex + 1}: проверено новых ${candidatesChecked}, пропущено из памяти ${duplicatesSkipped}, подходит ${matchedCount}.`,
        type: 'info',
      });
      if (consecutiveEmptyPages >= 2) break;
    }

    io.emit('parser:log', {
      platform: 'yandex_maps',
      message: matchedCount >= targetCount
        ? `Готово: найдено ${matchedCount} новых подходящих компаний, пропущено из памяти ${duplicatesSkipped}.`
        : `Выдача закончилась: найдено ${matchedCount} из ${targetCount} новых подходящих компаний, проверено ${candidatesChecked}, пропущено из памяти ${duplicatesSkipped}.`,
      type: matchedCount >= targetCount ? 'success' : 'warn',
    });
  } catch (error) {
    io.emit('parser:log', { platform: 'yandex_maps', message: `Ошибка Яндекс Карт: ${error.message}`, type: 'error' });
  } finally {
    await cleanup();
  }
}

export function stopYandexMapsParsing() {
  shouldStop = true;
}

export function getYandexMapsStatus() {
  return { isRunning: parserRunning };
}

async function cleanup() {
  if (parserBrowser) await parserBrowser.close().catch(() => {});
  parserBrowser = null;
  parserRunning = false;
  io.emit('parser:status', { isRunning: false, platform: 'yandex_maps' });
  io.emit('parser:done', { platform: 'yandex_maps' });
  io.emit('parser:log', { platform: 'yandex_maps', message: 'Парсер Яндекс Карт завершён.', type: 'info' });
}
