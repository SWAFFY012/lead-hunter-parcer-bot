import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const cacheFile = fileURLToPath(new URL('../../../data/map-lead-cache.json', import.meta.url));
let cachePromise;
let writeQueue = Promise.resolve();

function cacheKey(platform, sourceUrl) {
  return `${platform}:${String(sourceUrl || '').split('?')[0].replace(/\/$/, '')}`;
}

async function loadCache() {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.leads
      ? { ...parsed, ignoredNames: parsed.ignoredNames || {} }
      : { version: 2, leads: {}, ignoredNames: {} };
  } catch {
    return { version: 2, leads: {}, ignoredNames: {} };
  }
}

function getCache() {
  cachePromise ||= loadCache();
  return cachePromise;
}

async function persistCache(cache) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  });
  await writeQueue;
}

export async function getCachedMapLead(platform, sourceUrl) {
  const cache = await getCache();
  return cache.leads[cacheKey(platform, sourceUrl)]?.lead || null;
}

// Повторный обход пропускает только те карточки, что уже попали в CRM или в
// сохранённые. Просто просмотренная компания могла не подойти под прошлые
// фильтры — при новых условиях её нужно проверить заново.
export async function isMapLeadAlreadyTaken(platform, sourceUrl) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  return Boolean(entry?.savedAt || entry?.contactedAt);
}

export async function getCachedMapLeadState(platform, sourceUrl) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  return entry?.lead
    ? {
        lead: entry.lead,
        socialScanAt: entry.socialScanAt || '',
        presentedAt: entry.presentedAt || entry.savedAt || entry.contactedAt || '',
      }
    : null;
}

export async function rememberMapLead(lead, options = {}) {
  if (!lead?.platform || !lead?.sourceUrl) return;
  const cache = await getCache();
  const key = cacheKey(lead.platform, lead.sourceUrl);
  cache.leads[key] = {
    ...(cache.leads[key] || {}),
    checkedAt: new Date().toISOString(),
    socialScanAt: options.socialScanAt
      ? new Date().toISOString()
      : cache.leads[key]?.socialScanAt || '',
    lead,
  };
  await persistCache(cache);
}

export async function markMapLeadsPresented(leads) {
  if (!Array.isArray(leads) || !leads.length) return;
  const cache = await getCache();
  const presentedAt = new Date().toISOString();
  let changed = false;
  for (const lead of leads) {
    if (!lead?.platform || !lead?.sourceUrl) continue;
    const entry = cache.leads[cacheKey(lead.platform, lead.sourceUrl)];
    if (!entry?.lead || entry.presentedAt) continue;
    entry.presentedAt = presentedAt;
    changed = true;
  }
  if (changed) await persistCache(cache);
}

export async function listSavedMapLeads() {
  const cache = await getCache();
  return Object.values(cache.leads)
    .filter((entry) => entry.savedAt && entry.lead)
    .map((entry) => ({
      ...entry.lead,
      savedAt: entry.savedAt,
      contactedAt: entry.contactedAt || '',
      agreementStatus: entry.agreementStatus || null,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function listOutreachMapLeads() {
  const cache = await getCache();
  return Object.values(cache.leads)
    .filter((entry) => entry.queuedAt && entry.lead)
    .map((entry) => ({
      ...entry.lead,
      queuedAt: entry.queuedAt,
      outreachDraft: entry.outreachDraft || '',
      agreementStatus: entry.agreementStatus || null,
    }))
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
}

export async function queueMapLeadForOutreach(lead) {
  if (!lead?.platform || !lead?.sourceUrl) return listOutreachMapLeads();
  const cache = await getCache();
  const key = cacheKey(lead.platform, lead.sourceUrl);
  const queuedAt = new Date().toISOString();
  cache.leads[key] = {
    ...(cache.leads[key] || {}),
    checkedAt: cache.leads[key]?.checkedAt || queuedAt,
    queuedAt: cache.leads[key]?.queuedAt || queuedAt,
    lead,
  };
  await persistCache(cache);
  return listOutreachMapLeads();
}

export async function removeMapLeadFromOutreach(platform, sourceUrl) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  if (entry) {
    delete entry.queuedAt;
    delete entry.outreachDraft;
  }
  await persistCache(cache);
  return listOutreachMapLeads();
}

export async function setMapLeadOutreachDraft(platform, sourceUrl, outreachDraft) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  if (!entry?.lead || !entry.queuedAt) return null;
  entry.outreachDraft = String(outreachDraft || '').trim();
  await persistCache(cache);
  return { ...entry.lead, queuedAt: entry.queuedAt, outreachDraft: entry.outreachDraft };
}

export async function saveMapLeads(leads) {
  const cache = await getCache();
  const savedAt = new Date().toISOString();
  for (const lead of leads) {
    if (!lead?.platform || !lead?.sourceUrl) continue;
    const key = cacheKey(lead.platform, lead.sourceUrl);
    cache.leads[key] = {
      ...(cache.leads[key] || {}),
      checkedAt: cache.leads[key]?.checkedAt || savedAt,
      savedAt: cache.leads[key]?.savedAt || savedAt,
      lead,
    };
  }
  await persistCache(cache);
  return listSavedMapLeads();
}

export async function removeSavedMapLead(platform, sourceUrl) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  if (entry) delete entry.savedAt;
  await persistCache(cache);
  return listSavedMapLeads();
}

export async function removeAllSavedMapLeads() {
  const cache = await getCache();
  let changed = false;
  for (const entry of Object.values(cache.leads)) {
    if (!entry?.savedAt) continue;
    delete entry.savedAt;
    changed = true;
  }
  if (changed) await persistCache(cache);
  return listSavedMapLeads();
}

export async function setMapLeadContacted(platform, sourceUrl, contacted) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  if (!entry?.lead) return null;

  if (contacted) entry.contactedAt ||= new Date().toISOString();
  else delete entry.contactedAt;

  await persistCache(cache);
  return {
    ...entry.lead,
    savedAt: entry.savedAt || '',
    contactedAt: entry.contactedAt || '',
    agreementStatus: entry.agreementStatus || null,
  };
}

export async function setMapLeadAgreementStatus(platform, sourceUrl, agreementStatus) {
  const cache = await getCache();
  const entry = cache.leads[cacheKey(platform, sourceUrl)];
  if (!entry?.lead) return null;

  if (agreementStatus === 'green' || agreementStatus === 'red') entry.agreementStatus = agreementStatus;
  else delete entry.agreementStatus;

  await persistCache(cache);
  return {
    ...entry.lead,
    savedAt: entry.savedAt || '',
    contactedAt: entry.contactedAt || '',
    agreementStatus: entry.agreementStatus || null,
  };
}

function normalizeCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'.,()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ignoredNameKey(platform, name) {
  return `${platform}:${normalizeCompanyName(name)}`;
}

export async function isMapLeadNameIgnored(platform, name) {
  const cache = await getCache();
  return Boolean(cache.ignoredNames[ignoredNameKey(platform, name)]);
}

export async function ignoreMapLeadName(platform, name) {
  const normalizedName = normalizeCompanyName(name);
  if (!platform || !normalizedName) return '';
  const cache = await getCache();
  cache.ignoredNames[ignoredNameKey(platform, normalizedName)] = {
    name: String(name).trim(),
    ignoredAt: new Date().toISOString(),
  };
  await persistCache(cache);
  return normalizedName;
}
