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
  await page.waitForTimeout(3000);
  const title = await page.title();
  console.log("TITLE:", title);
  const html = await page.content();
  console.log("HTML length:", html.length);
  if (html.includes('input name="username"')) {
    console.log("LOGIN PAGE DETECTED");
  } else if (html.includes('Log In')) {
    console.log("LOGIN TEXT DETECTED");
  }
  
  const meta = await page.$eval('meta[property="al:android:url"]', el => el.getAttribute('content')).catch(() => 'NO META');
  console.log("META URL:", meta);
  
  await browser.close();
})();
