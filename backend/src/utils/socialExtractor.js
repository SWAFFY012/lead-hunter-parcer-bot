import { lookup } from 'dns/promises';
import { isIP } from 'net';

const platformRules = [
  ['Telegram', /(?:^|\.)t\.me$|(?:^|\.)telegram\.me$|^tg:/i],
  ['WhatsApp', /(?:^|\.)wa\.me$|(?:^|\.)whatsapp\.com$|^whatsapp:/i],
  ['Instagram', /(?:^|\.)instagram\.com$/i],
];

function comparableAddress(address) {
  const value = address.toLowerCase();
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  if (!isIP(value) || value.includes(':')) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function validatePublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Local address');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => comparableAddress(address))) throw new Error('Private address');
  return url;
}

export function identifySocialPlatform(rawUrl) {
  try {
    const schemeMatch = rawUrl.match(/^[a-z]+:/i)?.[0] || '';
    const hostname = /^https?:/i.test(rawUrl) ? new URL(rawUrl).hostname.replace(/^www\./, '') : schemeMatch;
    return platformRules.find(([, pattern]) => pattern.test(hostname))?.[0] || '';
  } catch {
    return '';
  }
}

export function collectSocialLinks(urls) {
  const result = new Map();
  for (const rawUrl of urls) {
    let url = String(rawUrl || '').replace(/&amp;/g, '&').trim();
    const platform = identifySocialPlatform(url);
    if (!platform) continue;
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (platform === 'WhatsApp') {
        const phone = (parsed.hostname.includes('wa.me') ? parsed.pathname : parsed.searchParams.get('phone') || '').replace(/\D/g, '');
        if (phone) url = `https://wa.me/${phone}`;
      } else if (['Telegram', 'Instagram'].includes(platform) && segments[0]) {
        url = `https://${hostname}/${segments[0]}`;
      } else if (['Telegram', 'Instagram'].includes(platform)) {
        url = `https://${hostname}${parsed.pathname}`.replace(/\/$/, '');
      }
    } catch {
      // Unsupported or malformed links are ignored by platform detection.
    }
    const key = `${platform}:${url.toLowerCase()}`;
    if (result.has(key)) continue;
    result.set(key, { platform, url });
  }
  return [...result.values()];
}

export function mergeSocialLinks(...groups) {
  return collectSocialLinks(groups.flat().map((item) => typeof item === 'string' ? item : item.url));
}

async function fetchPublicPage(rawUrl, redirectsLeft = 3) {
  const url = await validatePublicUrl(rawUrl);
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(2500),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadHunter/1.0)' },
  });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location') && redirectsLeft > 0) {
    return fetchPublicPage(new URL(response.headers.get('location'), url).href, redirectsLeft - 1);
  }
  if (!response.ok) return '';
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return '';
  return (await response.text()).slice(0, 2_000_000);
}

export async function crawlWebsiteSocialLinks(website) {
  if (!website) return [];
  try {
    const html = await fetchPublicPage(website);
    const urls = [];
    for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) urls.push(match[1]);
    for (const match of html.matchAll(/(?:https?:\/\/)?(?:t\.me|wa\.me)\/[a-zA-Z0-9_+/-]+/gi)) {
      urls.push(match[0].startsWith('http') ? match[0] : `https://${match[0]}`);
    }
    return collectSocialLinks(urls);
  } catch {
    return [];
  }
}
