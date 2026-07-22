import { chromium } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const playwrightExtra = addExtra(chromium);
playwrightExtra.use(StealthPlugin());

(async () => {
  const browser = await playwrightExtra.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: '../data/browser-profiles/2526bbee-3984-493c-aa24-a700a8e3244a/storageState.json' });
  const page = await ctx.newPage();
  await page.goto('https://www.instagram.com/p/DAT77QsNtCi/');
  await page.waitForTimeout(5000);
  
  // Let's try to extract username by finding ALL 'a' tags with href matching /USERNAME/
  const links = await page.$$eval('a', els => els.map(e => e.getAttribute('href')).filter(h => h && h.startsWith('/') && h.length > 2 && !h.includes('/p/') && !h.includes('/explore/')));
  console.log("LINKS:", [...new Set(links)]);
  
  const title2 = await page.title();
  console.log("TITLE AFTER 5s:", title2);

  await browser.close();
})();
