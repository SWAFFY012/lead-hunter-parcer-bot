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
  
  const description = await page.$eval('meta[property="og:description"], meta[name="description"]', el => el.getAttribute('content')).catch(() => null);
  console.log("DESCRIPTION:", description);

  // also let's check ul li
  const counts = await page.$$eval('header ul li span', els => els.map(e => e.getAttribute('title') || e.textContent).filter(Boolean));
  console.log("COUNTS FROM UL LI:", counts);
  
  await browser.close();
})();
