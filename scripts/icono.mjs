// Draws the app icon (build/icon.png and the window's favicon) from the same robot component the interface uses.
// Needs a Chromium for Playwright (CHROMIUM_PATH, or Playwright's own).
import { build } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('node_modules/.cache/orb-icono');
await build({ configFile: path.resolve('scripts/icono/vite.config.mjs') });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.route('http://icono.local/**', (route) => {
  const p = new URL(route.request().url()).pathname;
  const file = path.join(out, p === '/' ? 'index.html' : p);
  route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] ?? 'application/octet-stream' });
});
await page.goto('http://icono.local/');
await page.waitForFunction(() => window.done);
await page.waitForTimeout(300);
fs.mkdirSync('build', { recursive: true });
await page.locator('#icon').screenshot({ path: 'build/icon.png', omitBackground: true });
fs.copyFileSync('build/icon.png', 'src/ui/public/icon.png');
await browser.close();
console.log('✔ build/icon.png y src/ui/public/icon.png');
