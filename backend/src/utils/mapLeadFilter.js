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

export function normalizeMapLeadFilters(filters = {}) {
  return {
    website: normalizePresence(filters.website),
    phone: normalizePresence(filters.phone),
    socials: normalizePresence(filters.socials),
    socialPlatform: normalizeSocialPlatform(filters.socialPlatform),
  };
}

export function matchesMapLeadFilters(lead, filters) {
  const normalized = normalizeMapLeadFilters(filters);
  return matchesPresence(normalized.website, Boolean(lead.website))
    && matchesPresence(normalized.phone, Boolean(lead.phone))
    && matchesPresence(normalized.socials, Boolean(lead.socialLinks?.length))
    && hasMapLeadSocialPlatform(lead, normalized.socialPlatform);
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
  const normalized = normalizeMapLeadFilters(filters);
  return Object.values(normalized).some((value) => value !== 'all');
}
