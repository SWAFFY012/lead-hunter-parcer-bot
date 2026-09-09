import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { io } from '../../server.js';
import { collectSocialLinks, crawlWebsiteSocialLinks, mergeSocialLinks } from '../../utils/socialExtractor.js';
import { matchesMapLeadFilters, matchesMapLeadPresenceFilters, normalizeMapLeadFilters, shouldCrawlMapLeadWebsiteSocials } from '../../utils/mapLeadFilter.js';
import { getCachedMapLead, isMapLeadNameIgnored, rememberMapLead } from '../../utils/mapLeadCache.js';
import {
  finishMapParserRun,
  getMapParserRun,
  recordMapParserLead,
  recordMapParserProgress,
  startMapParserRun,
} from '../../utils/mapParserRunStore.js';

const PLATFORM = 'yandex_maps';
const EMPTY_PAGES_THRESHOLD = 4;
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

function emitLog(payload) {
  console.log(`[YandexMapsParser] ${payload.message}`);
  io.emit('parser:log', payload);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Таймаут: ${label} не уложился в ${ms}мс`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const MOSCOW_OBLAST_CITIES = [
  'Москва',
  'Химки',
  'Балашиха',
  'Подольск',
  'Мытищи',
  'Королёв',
  'Люберцы',
  'Одинцово',
  'Красногорск',
  'Реутов',
  'Долгопрудный',
  'Домодедово',
  'Щёлково',
  'Жуковский',
  'Электросталь',
  'Ногинск',
  'Пушкино',
  'Раменское',
  'Видное',
  'Серпухов',
  'Орехово-Зуево',
  'Сергиев Посад',
  'Ивантеевка',
  'Дзержинский',
  'Наро-Фоминск',
  'Чехов',
  'Воскресенск',
  'Клин',
  'Коломна',
  'Солнечногорск',
];

const NICHE_SYNONYM_GROUPS = [
  [/строительн\w*\s+компани\w*/i, ['строительная компания', 'строительно-монтажные работы', 'генеральный подрядчик', 'прораб', 'ремонт квартир', 'отделочные работы', 'кровельные работы']],
  [/ремонт\s+(?:кровли|крыши)|кровельн\w*/i, ['кровельные работы', 'ремонт крыши', 'монтаж кровли']],
  [/ремонт\s+квартир/i, ['ремонт квартир', 'отделочные работы', 'ремонт под ключ']],
  [/отделочн\w*/i, ['отделочные работы', 'ремонт квартир', 'ремонт под ключ']],
  [/электрик/i, ['электромонтажные работы', 'услуги электрика']],
  [/сантехник/i, ['сантехнические работы', 'услуги сантехника']],
  [/дизайн\s+интерьер\w*/i, ['дизайн интерьера', 'дизайн-студия']],
  [/клининг|уборк\w*/i, ['клининговая компания', 'уборка помещений']],
  [/юридическ\w*|юрист/i, ['юридическая компания', 'юридические услуги']],
  [/бухгалтер\w*/i, ['бухгалтерские услуги', 'бухгалтерская компания']],
];

function extractQueryParts(query) {
  const words = query.trim().split(/\s+/);
  const knownCity = MOSCOW_OBLAST_CITIES.find((city) => query.toLowerCase().includes(city.toLowerCase()));
  if (knownCity) {
    const niche = query.replace(new RegExp(knownCity, 'i'), '').trim() || words.slice(1).join(' ');
    return { city: knownCity, niche: niche || words.slice(1).join(' ') || query };
  }
  if (words.length >= 2) {
    return { city: words[0], niche: words.slice(1).join(' ') };
  }
  return { city: 'Москва', niche: query };
}

function buildNicheSynonyms(niche) {
  for (const [pattern, synonyms] of NICHE_SYNONYM_GROUPS) {
    if (pattern.test(niche)) return [...new Set([niche, ...synonyms])];
  }
  return [niche];
}

function buildQueryVariants(query) {
  const { city, niche } = extractQueryParts(query);
  const niches = buildNicheSynonyms(niche);
  const cities = [...new Set([city, ...MOSCOW_OBLAST_CITIES])];

  const variants = [query];
  for (const c of cities) {
    for (const n of niches) {
      variants.push(`${c} ${n}`);
    }
  }
  return [...new Set(variants)];
}

async function openCleanYandexSearch(page, query) {
  const words = query.trim().split(/\s+/);
  let queryVariants = [query];
  if (words.length >= 3) {
    const city = words[0];
    const service = words.slice(1).join(' ');
    const categoryService = service
      .replace(/ремонт\s+(?:кровли|крыши)/i, 'кровельные работы')
      .replace(/починить\s+(?:кровлю|крышу)/i, 'кровельные работы');
    if (categoryService !== service) {
      queryVariants = [`${city} ${categoryService}`, `${categoryService}, ${city}`, query];
    }
    queryVariants.push(`${service}, ${city}`);
  }
  const searchUrls = [...new Set(queryVariants)].map((searchQuery) => (
    `https://yandex.ru/maps/?mode=search&text=${encodeURIComponent(searchQuery)}`
  ));
  const hasCategoryAlias = queryVariants.length > 2;

  for (const [searchIndex, searchUrl] of searchUrls.entries()) {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: /Разрешить все|Принять все|Согласен/i })
      .first().click({ timeout: 2500 }).catch(() => {});
    const organizations = page.locator('a[href*="/maps/org/"]');
    await organizations.first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
    if (await organizations.count()) return true;

    const resetFilters = page.getByText(/сбросить фильтры/i).first();
    if (await resetFilters.isVisible().catch(() => false)) {
      await resetFilters.click({ timeout: 5000 }).catch(() => {});
      await organizations.first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
      if (await organizations.count()) return true;
    }

    // Yandex can move the map to the requested city but treat the full phrase
    // as an organization name. Keep the resulting viewport and search the
    // service part separately inside that city.
    if (searchIndex === 0 && words.length >= 3 && !hasCategoryAlias) {
      const serviceQuery = words.slice(1).join(' ');
      const searchInput = page.locator('input[placeholder*="Поиск"], input[aria-label*="Поиск"]').first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill(serviceQuery);
        await searchInput.press('Enter');
        await organizations.first().waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
        if (await organizations.count()) return true;
      }
    }
  }

  return false;
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
    const reviewsAmountElement = document.querySelector('.business-rating-amount-view')
      || document.querySelector('.business-header-rating-view__text');
    const reviewsAmountText = reviewsAmountElement?.textContent || pageText;
    const reviewsCount = Number(reviewsAmountText.match(/(\d[\d\s]*)\s*(?:оцен|отзыв|rating|review)/i)?.[1]?.replace(/\s+/g, '')) || 0;
    return {
      name: clean(document.querySelector('h1')?.textContent),
      title: clean(document.querySelector('a[href*="/category/"]')?.textContent),
      phone: clean(phone),
      website: websiteElement?.href || '',
      rating: clean(ratingElement?.textContent),
      reviewsCount,
      address: clean(addressElement?.textContent),
      description: clean(document.querySelector('meta[name="description"]')?.getAttribute('content')),
    };
  });
}

export async function startYandexMapsParsing({ query, targetCount = 30, filters: rawFilters }) {
  if (parserRunning) return { success: false, error: 'Парсер Яндекс Карт уже запущен.' };
  const filters = normalizeMapLeadFilters(rawFilters);
  parserRunning = true;
  shouldStop = false;
  startMapParserRun(PLATFORM, { query, targetCount, filters });
  io.emit('parser:started', { platform: 'yandex_maps', targetCount, filters });
  io.emit('parser:status', { isRunning: true, platform: 'yandex_maps' });

  try {
    parserBrowser = await playwrightExtra.launch({
      headless: process.env.PARSER_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,850',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--mute-audio',
      ],
    });
    const context = await parserBrowser.newContext({
      viewport: { width: 1366, height: 850 },
      locale: 'ru-RU',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    let searchPage = await context.newPage();
    await searchPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) route.abort();
      else route.continue();
    });

    let detailsPage = await context.newPage();
    const routeDetailsPage = async (targetPage) => {
      await targetPage.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) route.abort();
        else route.continue();
      });
    };
    await routeDetailsPage(detailsPage);

    const recreateSearchPage = async (staleSearchPage, lastSearchUrl) => {
      emitLog({ platform: 'yandex_maps', message: 'Пересоздаём вкладку поиска после зависания.', type: 'warn' });
      withTimeout(staleSearchPage.close(), 5000, 'закрытие зависшей вкладки поиска').catch(() => {});
      const freshSearchPage = await context.newPage();
      await freshSearchPage.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) route.abort();
        else route.continue();
      });
      if (lastSearchUrl) {
        await freshSearchPage.goto(lastSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      }
      return freshSearchPage;
    };

    const organizations = new Set();
    let matchedCount = 0;
    let candidatesChecked = 0;
    let duplicatesSkipped = 0;
    let consecutiveEmptyPages = 0;
    const queryVariants = buildQueryVariants(query);
    emitLog({ platform: 'yandex_maps', message: `Собираем ${targetCount} подходящих компаний. Вариантов запроса для перебора: ${queryVariants.length}.`, type: 'info' });

    let anyVariantHadResults = false;

    variantLoop:
    for (const [variantIndex, variantQuery] of queryVariants.entries()) {
      if (shouldStop || matchedCount >= targetCount) break;

      emitLog({ platform: 'yandex_maps', message: `Запрос [${variantIndex + 1}/${queryVariants.length}]: ${variantQuery}`, type: 'info' });
      const hasResults = await openCleanYandexSearch(searchPage, variantQuery);
      if (!hasResults) {
        emitLog({ platform: 'yandex_maps', message: `Пропускаем «${variantQuery}» — Яндекс Карты не вернули компаний.`, type: 'info' });
        continue;
      }
      anyVariantHadResults = true;
      consecutiveEmptyPages = 0;

    for (let pageIndex = 0; matchedCount < targetCount; pageIndex++) {
      if (shouldStop) break variantLoop;
      let lastSearchPageUrl = null;
      if (pageIndex > 0) {
        let scrolled = false;
        console.log(`[YandexMapsParser][trace] page=${pageIndex} before-url-read`);
        try {
          lastSearchPageUrl = searchPage.url();
          console.log(`[YandexMapsParser][trace] page=${pageIndex} before-scroll-evaluate`);
          const linksBefore = await withTimeout(
            searchPage.evaluate(() => document.querySelectorAll('a[href*="/maps/org/"]').length),
            5_000,
            'подсчёт ссылок до скролла',
          );
          for (let attempt = 0; attempt < 6; attempt++) {
            await withTimeout(
              searchPage.evaluate(() => {
                const target = document.querySelector('.scroll__container') || document.scrollingElement;
                if (target) {
                  target.scrollTop = target.scrollHeight;
                  target.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000, bubbles: true }));
                }
              }),
              15_000,
              'скролл списка результатов',
            );
            await searchPage.waitForTimeout(700);
          }
          const linksAfter = await withTimeout(
            searchPage.evaluate(() => document.querySelectorAll('a[href*="/maps/org/"]').length),
            5_000,
            'подсчёт ссылок после скролла',
          );
          console.log(`[YandexMapsParser][trace] page=${pageIndex} scroll-debug before=${linksBefore} after=${linksAfter}`);
          scrolled = linksAfter > linksBefore;
        } catch (error) {
          console.log(`[YandexMapsParser][trace] page=${pageIndex} scroll-caught: ${error.message}`);
          if (/^Таймаут:/.test(error.message)) {
            searchPage = await recreateSearchPage(searchPage, lastSearchPageUrl);
          }
        }
        console.log(`[YandexMapsParser][trace] page=${pageIndex} after-scroll scrolled=${scrolled}`);
        if (!scrolled) {
          consecutiveEmptyPages += 1;
          if (consecutiveEmptyPages >= EMPTY_PAGES_THRESHOLD) {
            emitLog({
              platform: 'yandex_maps',
              message: `Яндекс Карты ${EMPTY_PAGES_THRESHOLD} подгрузки подряд не вернули новых компаний — выдача действительно закончилась.`,
              type: 'warn',
            });
            break;
          }
          continue;
        }
        await searchPage.waitForTimeout(1500);
      }

      console.log(`[YandexMapsParser][trace] page=${pageIndex} before-collect-links`);
      let pageLinks = [];
      try {
        pageLinks = await withTimeout(collectOrganizationLinks(searchPage), 15_000, 'сбор ссылок на компании');
      } catch (error) {
        console.log(`[YandexMapsParser][trace] page=${pageIndex} collect-links-caught: ${error.message}`);
        if (/^Таймаут:/.test(error.message)) {
          searchPage = await recreateSearchPage(searchPage, lastSearchPageUrl);
        }
      }
      console.log(`[YandexMapsParser][trace] page=${pageIndex} after-collect-links count=${pageLinks.length}`);
      const newLinks = pageLinks.filter((link) => {
        if (organizations.has(link)) return false;
        organizations.add(link);
        return true;
      });
      consecutiveEmptyPages = newLinks.length ? 0 : consecutiveEmptyPages + 1;

      for (const sourceUrl of newLinks) {
        if (shouldStop || matchedCount >= targetCount) break;
        console.log(`[YandexMapsParser][trace] card start ${sourceUrl}`);
        try {
          await withTimeout((async () => {
            const cachedLead = await getCachedMapLead('yandex_maps', sourceUrl);
            if (cachedLead) {
              duplicatesSkipped++;
              return;
            }

            console.log(`[YandexMapsParser][trace] card before-goto ${sourceUrl}`);
            await detailsPage.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 });
            console.log(`[YandexMapsParser][trace] card before-waitForSelector ${sourceUrl}`);
            await detailsPage.waitForSelector('h1', { timeout: 12_000 });
            console.log(`[YandexMapsParser][trace] card before-extractCard ${sourceUrl}`);
            const card = await extractCard(detailsPage);
            console.log(`[YandexMapsParser][trace] card after-extractCard name=${card.name} website=${Boolean(card.website)} reviewsCount=${card.reviewsCount}`);

            if (card.reviewsCount < 1) {
              candidatesChecked++;
              duplicatesSkipped++;
              emitLog({ platform: 'yandex_maps', message: `Пропуск без отзывов: ${card.name}`, type: 'info' });
              return;
            }

            if (!matchesMapLeadPresenceFilters(card, filters)) {
              candidatesChecked++;
              return;
            }

            console.log(`[YandexMapsParser][trace] card before-collectCardSocials ${sourceUrl}`);
            const cardSocialLinks = await collectCardSocials(detailsPage);
            console.log(`[YandexMapsParser][trace] card after-collectCardSocials count=${cardSocialLinks.length}`);
            const socialLinks = shouldCrawlMapLeadWebsiteSocials(cardSocialLinks, card.website, filters)
              ? mergeSocialLinks(cardSocialLinks, await crawlWebsiteSocialLinks(card.website))
              : cardSocialLinks;
            console.log(`[YandexMapsParser][trace] card before-rememberMapLead ${sourceUrl}`);
            const lead = {
              ...card,
              socialLinks,
              sourceUrl,
              isClaimed: true,
              platform: 'yandex_maps',
            };
            await rememberMapLead(lead);
            console.log(`[YandexMapsParser][trace] card after-rememberMapLead ${sourceUrl}`);
            candidatesChecked++;
            if (await isMapLeadNameIgnored(PLATFORM, lead.name)) {
              duplicatesSkipped++;
              emitLog({ platform: PLATFORM, message: `Скрытая компания пропущена: ${lead.name}`, type: 'info' });
              return;
            }
            if (matchesMapLeadFilters(lead, filters)) {
              matchedCount++;
              recordMapParserLead(PLATFORM, lead);
              io.emit('parser:lead', { lead });
              emitLog({ platform: 'yandex_maps', message: `[${matchedCount}/${targetCount}] Подходит: ${card.name}`, type: 'success' });
            }
          })(), 60_000, `обработка карточки ${sourceUrl}`);
        } catch (error) {
          emitLog({ platform: 'yandex_maps', message: `Не удалось прочитать карточку: ${error.message}`, type: 'error' });
          if (/^Таймаут:/.test(error.message)) {
            emitLog({ platform: 'yandex_maps', message: 'Пересоздаём вкладку после зависания.', type: 'warn' });
            const staleDetailsPage = detailsPage;
            detailsPage = await context.newPage();
            await routeDetailsPage(detailsPage);
            withTimeout(staleDetailsPage.close(), 5000, 'закрытие зависшей вкладки').catch(() => {});
          }
        }
      }

      const progress = {
        platform: 'yandex_maps',
        currentPage: pageIndex + 1,
        totalPages: 0,
        matchedCount,
        candidatesChecked,
        duplicatesSkipped,
        targetCount,
      };
      recordMapParserProgress(PLATFORM, progress);
      io.emit('parser:progress', progress);
      emitLog({
        platform: 'yandex_maps',
        message: `Страница ${pageIndex + 1}: проверено новых ${candidatesChecked}, пропущено из памяти ${duplicatesSkipped}, подходит ${matchedCount}.`,
        type: 'info',
      });
      if (consecutiveEmptyPages >= EMPTY_PAGES_THRESHOLD) {
        emitLog({
          platform: 'yandex_maps',
          message: `Выдача по запросу «${variantQuery}» закончилась — переходим к следующему варианту.`,
          type: 'warn',
        });
        break;
      }
    }
    }

    if (!anyVariantHadResults) {
      throw new Error(`Яндекс Карты не вернули компании ни по одному из ${queryVariants.length} вариантов запроса «${query}».`);
    }

    emitLog({
      platform: 'yandex_maps',
      message: matchedCount >= targetCount
        ? `Готово: найдено ${matchedCount} новых подходящих компаний, пропущено из памяти ${duplicatesSkipped}.`
        : `Все варианты запроса перебраны: найдено ${matchedCount} из ${targetCount} новых подходящих компаний, проверено ${candidatesChecked}, пропущено из памяти ${duplicatesSkipped}.`,
      type: matchedCount >= targetCount ? 'success' : 'warn',
    });
  } catch (error) {
    emitLog({ platform: 'yandex_maps', message: `Ошибка Яндекс Карт: ${error.message}`, type: 'error' });
  } finally {
    await cleanup();
  }
}

export function stopYandexMapsParsing() {
  shouldStop = true;
}

export function getYandexMapsStatus() {
  return getMapParserRun(PLATFORM, parserRunning);
}

async function cleanup() {
  if (parserBrowser) await parserBrowser.close().catch(() => {});
  parserBrowser = null;
  parserRunning = false;
  finishMapParserRun(PLATFORM);
  io.emit('parser:status', { isRunning: false, platform: 'yandex_maps' });
  io.emit('parser:done', { platform: 'yandex_maps' });
  emitLog({ platform: 'yandex_maps', message: 'Парсер Яндекс Карт завершён.', type: 'info' });
}
