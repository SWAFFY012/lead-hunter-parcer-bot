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
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  });
  await writeQueue;
}
