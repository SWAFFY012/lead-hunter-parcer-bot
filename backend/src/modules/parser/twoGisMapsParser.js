import { io } from '../../server.js';
import { collectSocialLinks, crawlWebsiteSocialLinks, mergeSocialLinks } from '../../utils/socialExtractor.js';
import {
  hasMapLeadSocialPlatform,
  matchesMapLeadFilters,
  normalizeMapLeadFilters,
  shouldCrawlMapLeadWebsiteSocials,
} from '../../utils/mapLeadFilter.js';
import {
  getCachedMapLeadState,
  markMapLeadsPresented,
  rememberMapLead,
} from '../../utils/mapLeadCache.js';
import {
  finishMapParserRun,
  getMapParserRun,
  recordMapParserLead,
  recordMapParserProgress,
  startMapParserRun,
} from '../../utils/mapParserRunStore.js';

const PLATFORM = 'two_gis_maps';
const REQUEST_HEADERS = {
  // 2GIS serves its complete server-rendered directory to this compatibility UA.
  'User-Agent': 'Mozilla/5.0',
  'Accept-Language': 'ru-RU,ru;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
};

const cityAliases = [
  ['санкт-петербург', 'spb'],
  ['санкт петербург', 'spb'],
  ['нижний новгород', 'n_novgorod'],
  ['ростов-на-дону', 'rostov'],
  ['ростов на дону', 'rostov'],
  ['набережные челны', 'nabchelny'],
  ['москва', 'moscow'],
  ['новосибирск', 'novosibirsk'],
  ['екатеринбург', 'ekaterinburg'],
  ['казань', 'kazan'],
  ['челябинск', 'chelyabinsk'],
  ['самара', 'samara'],
  ['омск', 'omsk'],
  ['уфа', 'ufa'],
  ['красноярск', 'krasnoyarsk'],
  ['воронеж', 'voronezh'],
  ['пермь', 'perm'],
  ['волгоград', 'volgograd'],
  ['краснодар', 'krasnodar'],
  ['саратов', 'saratov'],
  ['тюмень', 'tyumen'],
  ['тольятти', 'togliatti'],
  ['ижевск', 'izhevsk'],
  ['барнаул', 'barnaul'],
  ['ульяновск', 'ulyanovsk'],
  ['иркутск', 'irkutsk'],
  ['хабаровск', 'khabarovsk'],
  ['махачкала', 'mahachkala'],
  ['владивосток', 'vladivostok'],
  ['ярославль', 'yaroslavl'],
  ['оренбург', 'orenburg'],
  ['кемерово', 'kemerovo'],
  ['новокузнецк', 'novokuznetsk'],
  ['рязань', 'ryazan'],
  ['астрахань', 'astrakhan'],
  ['пенза', 'penza'],
  ['липецк', 'lipetsk'],
  ['киров', 'kirov'],
  ['чебоксары', 'cheboksary'],
  ['калининград', 'kaliningrad'],
  ['тула', 'tula'],
  ['курск', 'kursk'],
  ['ставрополь', 'stavropol'],
  ['сочи', 'sochi'],
  ['белгород', 'belgorod'],
  ['архангельск', 'arkhangelsk'],
  ['владимир', 'vladimir'],
  ['смоленск', 'smolensk'],
  ['сургут', 'surgut'],
  ['томск', 'tomsk'],
];

let parserRunning = false;
let shouldStop = false;
let activeQuery = '';
let matchedCount = 0;
let candidatesChecked = 0;
const activeControllers = new Set();

function failsFixedFilters(lead, filters) {
  if (filters.website === 'with' && !lead.website) return true;
  if (filters.website === 'without' && lead.website) return true;
  if (filters.phone === 'with' && !lead.phone) return true;
  if (filters.phone === 'without' && lead.phone) return true;
  return false;
}

function shouldRefreshCachedLead(cachedState, filters) {
  if (!cachedState?.lead) return false;
  if (cachedState.socialScanAt) return false;
  if (filters.socialPlatform !== 'all' && !hasMapLeadSocialPlatform(cachedState.lead, filters.socialPlatform)) {
    return !failsFixedFilters(cachedState.lead, filters);
  }
  if (filters.socials !== 'with') return false;
  if (cachedState.lead.socialLinks?.length) return false;
  return !failsFixedFilters(cachedState.lead, filters);
}

function emitParserEvent(event, payload = {}) {
  if (event === 'parser:lead' && payload.lead) recordMapParserLead(PLATFORM, payload.lead);
  if (event === 'parser:progress') recordMapParserProgress(PLATFORM, payload);
  io.emit(event, { platform: PLATFORM, ...payload });
}

function emitParserLog(message, type = 'info') {
  emitParserEvent('parser:log', { message, type });
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanHtmlText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)="${escapedName}"[^>]+content="([^"]*)"`, 'i'));
  return decodeHtml(match?.[1] || '');
}

function transliterate(value) {
  const letters = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  return normalizeText(value)
    .split('')
    .map((letter) => letters[letter] ?? letter)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildTwoGisSearchUrl(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (/^https?:\/\//i.test(query)) {
    const url = new URL(query);
    if (!/(^|\.)2gis\.ru$/i.test(url.hostname) || !url.pathname.includes('/search/')) {
      throw new Error('Вставьте ссылку именно на результаты поиска 2ГИС.');
    }
    return url.href;
  }

  const normalized = normalizeText(query);
  const knownCity = cityAliases.find(([city]) => normalized === city || normalized.startsWith(`${city} `));
  const queryWords = query.split(/\s+/).filter(Boolean);
  const cityWordCount = knownCity ? knownCity[0].split(/\s+/).length : 1;
  const searchTerm = queryWords.slice(cityWordCount).join(' ') || query;
  const firstWord = normalized.split(' ')[0];
  const cityAlias = knownCity?.[1] || transliterate(firstWord);
  if (!cityAlias) {
    throw new Error('Не удалось определить город. Введите город первым словом или вставьте ссылку поиска 2ГИС.');
  }
  return `https://2gis.ru/${cityAlias}/search/${encodeURIComponent(searchTerm)}`;
}

async function fetchHtml(url) {
  if (shouldStop) throw new Error('PARSER_STOPPED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  activeControllers.add(controller);
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status === 403) {
      throw new Error('2ГИС временно ограничил запросы. Подождите минуту и запустите снова.');
    }
    if (!response.ok) throw new Error(`2ГИС вернул HTTP ${response.status}.`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
    activeControllers.delete(controller);
  }
}

export function extractTwoGisFirmLinks(html) {
  const links = new Set();
  const normalizedHtml = decodeHtml(String(html || ''))
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&quot;/gi, '"');

  const addPath = (rawPath) => {
    const cleanPath = decodeHtml(rawPath)
      .replace(/^https?:\/\/(?:www\.)?2gis\.ru/i, '')
      .split(/[?#]/)[0];
    const path = cleanPath.match(/^\/([^/]+)\/firm\/(\d+)/i);
    if (path) links.add(`https://2gis.ru/${path[1]}/firm/${path[2]}`);
  };

  for (const match of normalizedHtml.matchAll(/href=["'](\/[^"']+\/firm\/\d+[^"']*)["']/gi)) {
    addPath(match[1]);
  }
  for (const match of normalizedHtml.matchAll(/["'](\/[^"'\\]+\/firm\/\d+[^"'\\]*)["']/gi)) {
    addPath(match[1]);
  }
  for (const match of normalizedHtml.matchAll(/https?:\/\/(?:www\.)?2gis\.ru(\/[^"'\s\\<>]+\/firm\/\d+[^"'\s\\<>]*)/gi)) {
    addPath(match[1]);
  }
  return [...links];
}

function extractSearchCenter(html) {
  const match = String(html || '').match(/center=([-.\d]+)%2C([-.\d]+)/i);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? { longitude, latitude }
    : null;
}

function buildViewportCenters(center) {
  if (!center) return [];
  const centers = [];
  const longitudeStep = 0.12;
  const latitudeStep = 0.09;

  for (let radius = 1; radius <= 4; radius++) {
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
        centers.push({
          longitude: center.longitude + x * longitudeStep,
          latitude: center.latitude + y * latitudeStep,
        });
      }
    }
  }
  return centers;
}

function buildTwoGisPageUrl(searchUrl, pageNumber) {
  const url = new URL(searchUrl);
  url.pathname = url.pathname.replace(/\/page\/\d+\/?$/i, '').replace(/\/$/, '');
  if (pageNumber > 1) url.pathname += `/page/${pageNumber}`;
  return url.href;
}

function extractWebsite(hrefs) {
  for (const rawHref of hrefs) {
    const href = decodeHtml(rawHref);
    if (/^(?:tel:|https?:\/\/(?:t\.me|telegram\.me|wa\.me|whatsapp\.com|(?:www\.)?instagram\.com))/i.test(href)) continue;

    let candidate = href;
    const redirectedTargetIndex = href.lastIndexOf('?http');
    if (/^https?:\/\/link\.2gis\.ru/i.test(href) && redirectedTargetIndex >= 0) {
      candidate = href.slice(redirectedTargetIndex + 1);
    }

    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (/(^|\.)2gis\.(?:ru|com)$/i.test(url.hostname) || /(^|\.)max\.ru$/i.test(url.hostname)) continue;
      return url.href;
    } catch {
      // Malformed advertising and service links are ignored.
    }
  }
  return '';
}

export function parseTwoGisCompanyHtml(html, sourceUrl) {
  const headingIndex = html.indexOf('<h1');
  const relatedIndex = html.indexOf('Похожие организации', headingIndex);
  const companyHtml = headingIndex >= 0
    ? html.slice(headingIndex, relatedIndex > headingIndex ? relatedIndex : html.length)
    : html;
  const headingMatch = companyHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const categoryMatch = companyHtml.match(/<\/h1>\s*<div[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i);
  const addressMatch = companyHtml.match(/<a[^>]+href="\/[^"]+\/geo\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i);
  const hrefs = [...companyHtml.matchAll(/href="([^"]+)"/gi)].map((match) => decodeHtml(match[1]));
  const inlineUrls = [...companyHtml.matchAll(/https?:\/\/(?:t\.me|telegram\.me|wa\.me|whatsapp\.com|(?:www\.)?instagram\.com)\/[^\s"'<>\\]+/gi)]
    .map((match) => decodeHtml(match[0]));
  const phoneHref = hrefs.find((href) => href.startsWith('tel:')) || '';
  const socialLinks = collectSocialLinks([...hrefs, ...inlineUrls]);
  const ratingDescription = metaContent(html, 'og:description');

  return {
    name: cleanHtmlText(headingMatch?.[1]),
    title: cleanHtmlText(categoryMatch?.[1]),
    phone: phoneHref.replace(/^tel:/i, ''),
    website: extractWebsite(hrefs),
    rating: (ratingDescription.match(/Оценка\s*([\d.,]+)/i)?.[1] || '').replace(/[.,]+$/, ''),
    address: cleanHtmlText(addressMatch?.[1]),
    description: metaContent(html, 'description'),
    socialLinks,
    sourceUrl,
    isClaimed: true,
    platform: PLATFORM,
  };
}

export async function startTwoGisMapsParsing({ query, targetCount = 30, filters: rawFilters = {} }) {
  if (parserRunning) return { success: false, error: 'Парсер 2ГИС уже запущен.' };

  const filters = normalizeMapLeadFilters(rawFilters);
  const searchUrl = buildTwoGisSearchUrl(query);
  parserRunning = true;
  shouldStop = false;
  activeQuery = query;
  matchedCount = 0;
  candidatesChecked = 0;
  const previousRun = getMapParserRun(PLATFORM, false);
  await markMapLeadsPresented(previousRun.leads);
  startMapParserRun(PLATFORM, { query, targetCount, filters });
  emitParserEvent('parser:started', { targetCount, filters, query });
  emitParserEvent('parser:status', { isRunning: true, targetCount, query });

  try {
    emitParserLog(`Открываем 2ГИС: ${query}`);
    emitParserLog(`Ищем ${targetCount} компаний, подходящих под выбранные фильтры.`);
    const seenFirms = new Set();
    let duplicatesSkipped = 0;
    let cachedMatchesReused = 0;
    let cachedRejected = 0;
    let consecutiveEmptyPages = 0;
    let searchHtml = await fetchHtml(buildTwoGisPageUrl(searchUrl, 1));

    for (let pageNumber = 1; matchedCount < targetCount && !shouldStop; pageNumber++) {
      const pageUrl = buildTwoGisPageUrl(searchUrl, pageNumber);
      if (pageNumber > 1) {
        searchHtml = await fetchHtml(pageUrl);
      }
      const pageLinks = extractTwoGisFirmLinks(searchHtml);
      emitParserLog(`2ГИС страница ${pageNumber}: найдено карточек в выдаче ${pageLinks.length}.`);
      const newLinks = pageLinks.filter((sourceUrl) => {
        if (seenFirms.has(sourceUrl)) return false;
        seenFirms.add(sourceUrl);
        return true;
      });
      if (!pageLinks.length) {
        emitParserLog(`2ГИС не отдал карточки на странице ${pageNumber}: ${pageUrl}`, 'warn');
      }
      consecutiveEmptyPages = newLinks.length ? 0 : consecutiveEmptyPages + 1;

      for (const sourceUrl of newLinks) {
        if (shouldStop || matchedCount >= targetCount) break;
        const cachedState = await getCachedMapLeadState(PLATFORM, sourceUrl);
        if (cachedState && !shouldRefreshCachedLead(cachedState, filters)) {
          candidatesChecked++;
          if (cachedState.presentedAt) {
            duplicatesSkipped++;
          } else if (matchesMapLeadFilters(cachedState.lead, filters)) {
            matchedCount++;
            cachedMatchesReused++;
            await markMapLeadsPresented([cachedState.lead]);
            emitParserEvent('parser:lead', { lead: cachedState.lead });
            emitParserLog(
              `[${matchedCount}/${targetCount}] Из памяти: ${cachedState.lead.name || 'Компания без названия'}`,
              'success'
            );
          } else {
            cachedRejected++;
          }
          emitParserEvent('parser:progress', {
            currentPage: pageNumber,
            totalPages: 0,
            matchedCount,
            candidatesChecked,
            duplicatesSkipped,
            cachedMatchesReused,
            cachedRejected,
            targetCount,
          });
          continue;
        }

        try {
          const companyHtml = await fetchHtml(sourceUrl);
          const card = parseTwoGisCompanyHtml(companyHtml, sourceUrl);
          const socialLinks = !failsFixedFilters(card, filters) && shouldCrawlMapLeadWebsiteSocials(card.socialLinks, card.website, filters)
            ? mergeSocialLinks(card.socialLinks, await crawlWebsiteSocialLinks(card.website))
            : card.socialLinks;
          const lead = { ...card, socialLinks };
          await rememberMapLead(lead, { socialScanAt: true });
          candidatesChecked++;

          if (matchesMapLeadFilters(lead, filters)) {
            matchedCount++;
            await markMapLeadsPresented([lead]);
            emitParserEvent('parser:lead', { lead });
            emitParserLog(`[${matchedCount}/${targetCount}] Подходит: ${lead.name || 'Компания без названия'}`, 'success');
          }
        } catch (error) {
          if (!shouldStop) {
            const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
            emitParserLog(`Не удалось прочитать карточку: ${message}`, 'error');
          }
        }

        emitParserEvent('parser:progress', {
          currentPage: pageNumber,
          totalPages: 0,
          matchedCount,
          candidatesChecked,
          duplicatesSkipped,
          cachedMatchesReused,
          cachedRejected,
          targetCount,
        });
      }

      emitParserLog(
        `Страница ${pageNumber}: проверено карточек ${candidatesChecked}, выдано из памяти ${cachedMatchesReused}, уже показано ${duplicatesSkipped}, не подошло из памяти ${cachedRejected}, подходит ${matchedCount}.`
      );
      if (consecutiveEmptyPages >= 5) {
        emitParserLog('2ГИС пять страниц подряд не вернул новых компаний — выдача действительно закончилась.', 'warn');
        break;
      }
    }

    emitParserLog(
      matchedCount >= targetCount
        ? `Готово: найдено ${matchedCount}, из них быстро взято из памяти ${cachedMatchesReused}; уже показанных пропущено ${duplicatesSkipped}.`
        : `Выдача закончилась: найдено ${matchedCount} из ${targetCount}, проверено карточек ${candidatesChecked}, из памяти выдано ${cachedMatchesReused}, уже показанных пропущено ${duplicatesSkipped}.`,
      matchedCount >= targetCount ? 'success' : 'warn'
    );
  } catch (error) {
    if (!shouldStop) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      emitParserLog(`Ошибка 2ГИС: ${message}`, 'error');
    }
  } finally {
    parserRunning = false;
    activeQuery = '';
    finishMapParserRun(PLATFORM);
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
    emitParserEvent('parser:status', { isRunning: false });
    emitParserEvent('parser:done');
    emitParserLog(shouldStop ? 'Парсер 2ГИС остановлен.' : 'Парсер 2ГИС завершён.');
  }

  return { success: true };
}

export function stopTwoGisMapsParsing() {
  shouldStop = true;
  for (const controller of activeControllers) controller.abort();
  emitParserLog('Останавливаем парсер 2ГИС…', 'warn');
}

export function getTwoGisMapsStatus() {
  return getMapParserRun(PLATFORM, parserRunning);
}
