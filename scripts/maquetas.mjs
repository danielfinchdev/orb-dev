// Design mockups of ENCARGOS item 9 (Orb as a messaging app): shoots docs/diseno/maquetas/mensajeria.html headless
// (Edge without a window on Windows) into test-results/maquetas/. Mockups only: nothing of the app is involved.
// Run: node scripts/maquetas.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results', 'maquetas'); fs.mkdirSync(OUT, { recursive: true });
const page0 = pathToFileURL(path.join(ROOT, 'docs', 'diseno', 'maquetas', 'mensajeria.html')).href;
const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const SIZE = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, deviceScaleFactor: 2 }, glass: { width: 390, height: 844, deviceScaleFactor: 2 } };
const shots = [];
for (const d of ['desktop', 'phone', 'glass']) {
  const { width, height, deviceScaleFactor } = SIZE[d];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, locale: 'es-ES' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
  for (const z of ['bots', 'orb']) {
    const screens = d === 'desktop' ? ['chat', 'info', ...(z === 'bots' ? ['create'] : [])] : ['list', 'chat', 'info', ...(z === 'bots' ? ['create'] : [])];
    for (const s of screens) for (const t of ['light', 'dark']) {
      await page.goto(`${page0}?d=${d}&z=${z}&s=${s}&t=${t}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const file = path.join(OUT, `${d}-${z}-${s}-${t}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`✔ ${shots.length} maquetas en ${OUT}`);
