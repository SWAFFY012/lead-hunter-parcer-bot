/**
 * Browser Profile Manager - Anti-detect fingerprints for Playwright
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { getDb } from '../../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '../../../../data/browser-profiles');

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const WEBGL_PROFILES = [
  { vendor: 'Google Inc. (Apple)',  renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' },
  { vendor: 'Google Inc. (Apple)',  renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
  { vendor: 'Google Inc. (Apple)',  renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080, D3D11)' },
  { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel UHD Graphics 630, D3D11)' },
  { vendor: 'Google Inc. (AMD)',    renderer: 'ANGLE (AMD, AMD Radeon RX 6600, D3D11)' },
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

const TIMEZONES = ['Europe/Kiev', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/Bucharest', 'Asia/Almaty'];
const LOCALES = ['uk-UA', 'ru-RU', 'pl-PL', 'de-DE'];
const CONCURRENCY = [2, 4, 6, 8, 10, 12];
const MEMORY = [4, 8, 8, 8, 16, 16];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function generateFingerprint(name) {
  const ua = pick(USER_AGENTS);
  const webgl = pick(WEBGL_PROFILES);
  const viewport = pick(VIEWPORTS);
  return {
    id: randomUUID(),
    name: name || ('Profile ' + new Date().toLocaleDateString('uk-UA')),
    user_agent: ua,
    viewport_width: viewport.width,
    viewport_height: viewport.height,
    locale: pick(LOCALES),
    timezone: pick(TIMEZONES),
    platform: ua.includes('Windows') ? 'Win32' : 'MacIntel',
    hardware_concurrency: pick(CONCURRENCY),
    device_memory: pick(MEMORY),
    webgl_vendor: webgl.vendor,
    webgl_renderer: webgl.renderer,
    canvas_noise: 0.005 + Math.random() * 0.01,
    session_path: null,
    proxy: null,
  };
}

export async function createProfile(name) {
  const db = getDb();
  const p = generateFingerprint(name);
  const sessionDir = join(SESSIONS_DIR, p.id);
  mkdirSync(sessionDir, { recursive: true });
  p.session_path = join(sessionDir, 'storageState.json');
  
  await db`
    INSERT INTO browser_profiles (
      id, name, user_agent, viewport_width, viewport_height, locale, timezone, platform, 
      hardware_concurrency, device_memory, webgl_vendor, webgl_renderer, canvas_noise, session_path, proxy
    ) VALUES (
      ${p.id}, ${p.name}, ${p.user_agent}, ${p.viewport_width}, ${p.viewport_height}, ${p.locale}, 
      ${p.timezone}, ${p.platform}, ${p.hardware_concurrency}, ${p.device_memory}, ${p.webgl_vendor}, 
      ${p.webgl_renderer}, ${p.canvas_noise}, ${p.session_path}, ${p.proxy}
    )
  `;
  return p;
}

export async function listProfiles() {
  const db = getDb();
  return await db`SELECT * FROM browser_profiles ORDER BY created_at DESC`;
}

export async function getProfile(id) {
  const db = getDb();
  const rows = await db`SELECT * FROM browser_profiles WHERE id = ${id}`;
  return rows[0] || null;
}

export async function deleteProfile(id) {
  const db = getDb();
  await db`DELETE FROM browser_profiles WHERE id = ${id}`;
  return { ok: true };
}

export async function updateProfileProxy(id, proxy) {
  const db = getDb();
  await db`UPDATE browser_profiles SET proxy = ${proxy || null} WHERE id = ${id}`;
}

export function buildContextOptions(profile) {
  const opts = {
    viewport: { width: profile.viewport_width, height: profile.viewport_height },
    userAgent: profile.user_agent,
    locale: profile.locale,
    timezoneId: profile.timezone,
    extraHTTPHeaders: { 'Accept-Language': profile.locale + ',' + profile.locale.split('-')[0] + ';q=0.9,en;q=0.8' },
  };
  if (profile.session_path && existsSync(profile.session_path)) opts.storageState = profile.session_path;
  if (profile.proxy) opts.proxy = { server: profile.proxy };
  return opts;
}

export async function applyFingerprintScripts(page, profile) {
  const noise = Number(profile.canvas_noise) || 0.01;
  const hc = Number(profile.hardware_concurrency) || 4;
  const dm = Number(profile.device_memory) || 8;
  const vw = Number(profile.viewport_width) || 1366;
  const vh = Number(profile.viewport_height) || 768;
  const platform = String(profile.platform || 'MacIntel');
  const vendor = String(profile.webgl_vendor || 'Google Inc.');
  const renderer = String(profile.webgl_renderer || 'ANGLE (Apple, Apple M1, OpenGL 4.1)');
  const locale = String(profile.locale || 'uk-UA');
  const lang = locale.split('-')[0];

  const script =
    '(function() {' +
    'var nav=navigator;' +
    'Object.defineProperty(nav,"platform",{get:function(){return "' + platform + '";}});' +
    'Object.defineProperty(nav,"hardwareConcurrency",{get:function(){return ' + hc + ';}});' +
    'Object.defineProperty(nav,"deviceMemory",{get:function(){return ' + dm + ';}});' +
    'Object.defineProperty(nav,"languages",{get:function(){return ["' + locale + '","' + lang + '","en"];}});' +
    'Object.defineProperty(nav,"webdriver",{get:function(){return undefined;}});' +
    'var _gc=HTMLCanvasElement.prototype.getContext;' +
    'HTMLCanvasElement.prototype.getContext=function(t){var a=Array.prototype.slice.call(arguments,1);var c=_gc.apply(this,[t].concat(a));if(!c||t!=="2d")return c;var _g=c.getImageData.bind(c);c.getImageData=function(x,y,w,h){var img=_g(x,y,w,h);var n=' + noise + ';for(var i=0;i<img.data.length;i+=4){var d=Math.floor((Math.random()-0.5)*n*255);img.data[i]=Math.min(255,Math.max(0,img.data[i]+d));img.data[i+1]=Math.min(255,Math.max(0,img.data[i+1]+d));img.data[i+2]=Math.min(255,Math.max(0,img.data[i+2]+d));}return img;};return c;};' +
    'var _w=WebGLRenderingContext.prototype.getParameter;' +
    'WebGLRenderingContext.prototype.getParameter=function(p){if(p===37445)return "' + vendor + '";if(p===37446)return "' + renderer + '";return _w.call(this,p);};' +
    'try{var _w2=WebGL2RenderingContext.prototype.getParameter;WebGL2RenderingContext.prototype.getParameter=function(p){if(p===37445)return "' + vendor + '";if(p===37446)return "' + renderer + '";return _w2.call(this,p);};}catch(e){}' +
    'Object.defineProperty(screen,"width",{get:function(){return ' + vw + ';}});' +
    'Object.defineProperty(screen,"height",{get:function(){return ' + vh + ';}});' +
    'Object.defineProperty(screen,"availWidth",{get:function(){return ' + vw + ';}});' +
    'Object.defineProperty(screen,"availHeight",{get:function(){return ' + (vh - 40) + ';}});' +
    'Object.defineProperty(screen,"colorDepth",{get:function(){return 24;}});' +
    'Object.defineProperty(screen,"pixelDepth",{get:function(){return 24;}});' +
    'window.chrome={runtime:{},loadTimes:function(){return {};},csi:function(){return {};}};' +
    '})();';

  await page.addInitScript({ content: script });
}
