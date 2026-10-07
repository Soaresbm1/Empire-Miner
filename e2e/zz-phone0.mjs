import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 874, height: 282 }, deviceScaleFactor: 2.29, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
try {
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 62, bottom: 21, right: 62 } });
  console.log('safe-area override ok');
} catch (e) { console.log('no safe-area override:', e.message); }
await page.goto('http://localhost:4201/?debug');
await page.waitForTimeout(800);
console.log(await page.evaluate(() => JSON.stringify({ iw: innerWidth, ih: innerHeight, sl: getComputedStyle(document.documentElement).getPropertyValue('--sl'), touch: document.body.classList.contains('touch'), coarse: matchMedia('(pointer: coarse)').matches })));
await page.screenshot({ path: '/tmp/claude-0/-home-user-public/a8bc2e5d-cc7f-587c-89bc-d3e0960e8c9e/scratchpad/p0-menu.png' });
await page.evaluate(() => window.__EM.newGame(7));
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/claude-0/-home-user-public/a8bc2e5d-cc7f-587c-89bc-d3e0960e8c9e/scratchpad/p0-game.png' });
await browser.close();
