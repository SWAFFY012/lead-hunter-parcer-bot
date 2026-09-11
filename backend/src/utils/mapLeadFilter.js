import { normalizeMapLeadCategoryFilter } from './mapLeadCategory.js';

const presenceValues = new Set(['all', 'with', 'without']);
const socialPlatformValues = new Set(['all', 'telegram']);

function normalizePresence(value) {
  return presenceValues.has(value) ? value : 'all';
}

function matchesPresence(filter, hasValue) {
  if (filter === 'with') return hasValue;
  if (filter === 'without') return !hasValue;
  return true;
}

function normalizeSocialPlatform(value) {
  return socialPlatformValues.has(value) ? value : 'all';
}

export function hasMapLeadSocialPlatform(lead, platform) {
  if (platform === 'all') return true;
  return (lead.socialLinks || []).some((social) => (
    String(social?.platform || '').toLowerCase() === platform
  ));
}

export function shouldCrawlMapLeadWebsiteSocials(socialLinks, website, filters) {
  if (!website) return false;
  const normalized = normalizeMapLeadFilters(filters);
  if (!socialLinks?.length) return true;
  return normalized.socialPlatform !== 'all'
    && !hasMapLeadSocialPlatform({ socialLinks }, normalized.socialPlatform);
}

// Рейтинг приходит строкой из интерфейса Карт и в части локалей
// использует запятую как разделитель («4,3»), поэтому нормализуем вручную.
export function parseMapLeadRating(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function normalizeMinRating(value) {
  const num = parseMapLeadRating(value);
  if (num === null || num <= 0) return 0;
  return Math.min(num, 5);
}

// Карточка без единого отзыва рейтинга не имеет. Такие компании при
// заданном пороге отсеиваем: подтвердить оценку нечем.
export function matchesMapLeadRating(lead, minRating) {
  if (!minRating) return true;
  const rating = parseMapLeadRating(lead.rating);
  if (rating === null) return false;
  return rating >= minRating;
}

export function normalizeMapLeadFilters(filters = {}) {
  const category = normalizeMapLeadCategoryFilter(filters);
  return {
    website: normalizePresence(filters.website),
    phone: normalizePresence(filters.phone),
    socials: normalizePresence(filters.socials),
    socialPlatform: normalizeSocialPlatform(filters.socialPlatform),
    minRating: normalizeMinRating(filters.minRating),
    // Списки целевых слов переживают нормализацию: парсер прогоняет через неё
    // фильтры повторно, и раньше отсев по рубрике здесь терялся.
    includeKeywords: category.include,
    excludeKeywords: category.exclude,
  };
}

export function matchesMapLeadFilters(lead, filters) {
  const normalized = normalizeMapLeadFilters(filters);
  return matchesPresence(normalized.website, Boolean(lead.website))
    && matchesPresence(normalized.phone, Boolean(lead.phone))
    && matchesPresence(normalized.socials, Boolean(lead.socialLinks?.length))
    && hasMapLeadSocialPlatform(lead, normalized.socialPlatform)
    && matchesMapLeadRating(lead, normalized.minRating);
}

// Проверка только по website/phone — до сбора соцсетей, чтобы не тратить
// время на карточки, которые заведомо не пройдут фильтр (например, сайт
// есть, а фильтр требует "без сайта").
export function matchesMapLeadPresenceFilters(card, filters) {
  const normalized = normalizeMapLeadFilters(filters);
  return matchesPresence(normalized.website, Boolean(card.website))
    && matchesPresence(normalized.phone, Boolean(card.phone));
}

export function hasActiveMapLeadFilters(filters) {
  const { minRating, includeKeywords, excludeKeywords, ...presence } = normalizeMapLeadFilters(filters);
  return minRating > 0
    || includeKeywords.length > 0
    || excludeKeywords.length > 0
    || Object.values(presence).some((value) => value !== 'all');
}
