import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const playwrightExtra = addExtra(chromium);
playwrightExtra.use(StealthPlugin());

(async () => {
  const browser = await playwrightExtra.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: '../data/browser-profiles/2526bbee-3984-493c-aa24-a700a8e3244a/storageState.json' });
  const page = await ctx.newPage();
  await page.goto('https://www.instagram.com/denys_kuzmenyuk/');
  await page.waitForTimeout(3000);
  
  const metas = await page.$$eval('meta', els => els.map(e => ({ property: e.getAttribute('property'), name: e.getAttribute('name'), content: e.getAttribute('content') })).filter(m => m.property || m.name));
  console.log("METAS:", metas);

  await browser.close();
})();
