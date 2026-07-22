const presenceValues = new Set(['all', 'with', 'without']);

function normalizePresence(value) {
  return presenceValues.has(value) ? value : 'all';
}

function matchesPresence(filter, hasValue) {
  if (filter === 'with') return hasValue;
  if (filter === 'without') return !hasValue;
  return true;
}

export function normalizeMapLeadFilters(filters = {}) {
  return {
    website: normalizePresence(filters.website),
    phone: normalizePresence(filters.phone),
    socials: normalizePresence(filters.socials),
  };
}

export function matchesMapLeadFilters(lead, filters) {
  const normalized = normalizeMapLeadFilters(filters);
  return matchesPresence(normalized.website, Boolean(lead.website))
    && matchesPresence(normalized.phone, Boolean(lead.phone))
    && matchesPresence(normalized.socials, Boolean(lead.socialLinks?.length));
}

export function hasActiveMapLeadFilters(filters) {
  const normalized = normalizeMapLeadFilters(filters);
  return Object.values(normalized).some((value) => value !== 'all');
}
