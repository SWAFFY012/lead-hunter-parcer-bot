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
      ? parsed
      : { version: 1, leads: {} };
  } catch {
    return { version: 1, leads: {} };
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

export async function rememberMapLead(lead) {
  if (!lead?.platform || !lead?.sourceUrl) return;
  const cache = await getCache();
  cache.leads[cacheKey(lead.platform, lead.sourceUrl)] = {
    checkedAt: new Date().toISOString(),
    lead,
  };
  await persistCache(cache);
}

export async function listSavedMapLeads() {
  const cache = await getCache();
  return Object.values(cache.leads)
    .filter((entry) => entry.savedAt && entry.lead)
    .map((entry) => ({ ...entry.lead, savedAt: entry.savedAt }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
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
