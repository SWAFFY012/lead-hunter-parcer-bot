import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { io } from '../../server.js';
import { collectSocialLinks, crawlWebsiteSocialLinks } from '../../utils/socialExtractor.js';
import { hasActiveMapLeadFilters, matchesMapLeadFilters, normalizeMapLeadFilters } from '../../utils/mapLeadFilter.js';

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
  const urls = [];
  for (const name of socialNames) {
    const button = page.getByRole('button', { name: new RegExp(`Соцсети, ${name}`, 'i') }).first();
    if (await button.count() === 0) continue;

    const embeddedUrls = await button.evaluate((element) => [
      ...Array.from(element.attributes).map((attribute) => attribute.value),
      element.textContent || '',
    ]).catch(() => []);
    urls.push(...embeddedUrls.filter((value) => allowedSocialUrl.test(value)));

    const clicked = await button.click({ timeout: 1500 }).then(() => true).catch(() => false);
    if (!clicked) continue;
    await sleep(40, 90);
    const interceptedUrls = await page.evaluate(() => window.__leadHunterOpenedUrls?.splice(0) || []);
    urls.push(...interceptedUrls.filter((url) => allowedSocialUrl.test(url)));

    const found = await page.locator('a[href]')
      .evaluateAll((links) => links
        .map((link) => link.href)
        .filter((href) => /(?:t\.me|telegram\.me|wa\.me|whatsapp\.com|instagram\.com)/i.test(href)));
    urls.push(...found.filter((url) => !/t\.me\/mapsyandex/i.test(url)));
  }
  return collectSocialLinks(urls);
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
    await context.addInitScript(() => {
      window.__leadHunterOpenedUrls = [];
      window.open = (url) => {
        if (url) window.__leadHunterOpenedUrls.push(String(url));
        return null;
      };
    });
    const searchPage = await context.newPage();
    await searchPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) route.abort();
      else route.continue();
    });

    const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(query)}`;
    io.emit('parser:log', { message: `Открываем Яндекс Карты: ${query}`, type: 'info' });
    await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await searchPage.getByRole('button', { name: /Разрешить все|Принять все|Согласен/i }).first().click({ timeout: 2500 }).catch(() => {});
    await searchPage.waitForSelector('a[href*="/maps/org/"]', { timeout: 20_000 });

    const firstResultsUrl = searchPage.url();
    const paginationUrls = await searchPage.locator('a[href*="/search/"][href*="page="]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.href))]);
    const paginationTemplate = paginationUrls[0] || firstResultsUrl;
    const maxPages = Math.min(50, Math.max(5, Math.ceil(targetCount * (hasActiveMapLeadFilters(filters) ? 1.5 : 0.7))));
    const detailsPage = await context.newPage();
    await detailsPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) route.abort();
      else route.continue();
    });

    const organizations = new Set();
    let matchedCount = 0;
    let candidatesChecked = 0;
    let consecutiveEmptyPages = 0;
    io.emit('parser:log', { message: `Ищем ${targetCount} компаний, подходящих под выбранные фильтры.`, type: 'info' });

    for (let pageIndex = 0; pageIndex < maxPages && matchedCount < targetCount; pageIndex++) {
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
          candidatesChecked++;
          if (matchesMapLeadFilters(lead, filters)) {
            matchedCount++;
            io.emit('parser:lead', { lead });
            io.emit('parser:log', { message: `[${matchedCount}/${targetCount}] Подходит: ${card.name}`, type: 'success' });
          }
        } catch (error) {
          io.emit('parser:log', { message: `Не удалось прочитать карточку: ${error.message}`, type: 'error' });
        }
      }

      io.emit('parser:progress', {
        platform: 'yandex_maps',
        currentPage: pageIndex + 1,
        totalPages: maxPages,
        matchedCount,
        candidatesChecked,
        targetCount,
      });
      io.emit('parser:log', {
        message: `Страница ${pageIndex + 1}: проверено ${candidatesChecked}, подходит ${matchedCount}.`,
        type: 'info',
      });
      if (consecutiveEmptyPages >= 2) break;
    }

    io.emit('parser:log', {
      message: matchedCount >= targetCount
        ? `Готово: найдено ${matchedCount} подходящих компаний.`
        : `Выдача закончилась: найдено ${matchedCount} из ${targetCount} подходящих компаний, проверено ${candidatesChecked}.`,
      type: matchedCount >= targetCount ? 'success' : 'warn',
    });
  } catch (error) {
    io.emit('parser:log', { message: `Ошибка Яндекс Карт: ${error.message}`, type: 'error' });
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
  io.emit('parser:log', { message: 'Парсер Яндекс Карт завершён.', type: 'info' });
}
