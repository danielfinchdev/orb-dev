// A real update of the INSTALLED app, before publishing a version (Windows, by hand):
//   1. install the current version with its installer (dist/Orb.dev-<v>-instalador.exe /S);
//   2. build a newer one into a folder: npx electron-builder --win nsis -c.extraMetadata.version=<v+1> -c.directories.output=<carpeta>
//   3. ORB_E2E_EXE=%LOCALAPPDATA%\Programs\Orb.dev\Orb.dev.exe ORB_UPDATE_FEED=<carpeta> node test/update.e2e.mjs
// The feed is served on 127.0.0.1 (ORB_UPDATE_URL); the app, with its own throwaway data, finds the new version, downloads
// it, restarts into it and the installed program ends up being the new version. Afterwards reinstall the real version.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.ORB_E2E_EXE; const feed = process.env.ORB_UPDATE_FEED;
if (!exe || !fs.existsSync(exe) || !feed || !fs.existsSync(path.join(feed, 'latest.yml'))) { console.error('Faltan ORB_E2E_EXE (app instalada) y ORB_UPDATE_FEED (carpeta con latest.yml)'); process.exit(2); }
const target = /^version:\s*(\S+)/m.exec(fs.readFileSync(path.join(feed, 'latest.yml'), 'utf8'))[1];
// While the installer replaces the program the file is briefly missing: '' until it is back.
const fileVersion = () => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}' -ErrorAction Stop).VersionInfo.ProductVersion`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const before = fileVersion();
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-actualizar-'));
// A throwaway Orb folder, so the app opens straight into its main screen (the card lives there, not in the welcome).
const { home } = createHome(tmp, { assistantName: 'Orb', userName: 'Ana' });
const userData = path.join(tmp, 'datos-app'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));

const server = http.createServer((req, res) => {
  const file = path.join(feed, path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feedUrl = `http://127.0.0.1:${server.address().port}/`;

const port = 9300 + Math.floor(Math.random() * 500);
const app = spawn(exe, [`--remote-debugging-port=${port}`], { env: { ...process.env, ORB_USER_DATA: userData, ORB_UPDATE_URL: feedUrl, ORB_NO_ADB: '1' }, stdio: 'ignore' });
const until = async (fn, what, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`no llegó: ${what}`); };
const killAll = () => { try { execFileSync('taskkill', ['/IM', path.basename(exe), '/T', '/F'], { stdio: 'ignore' }); } catch { /* none */ } };

let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana de la app');
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('index.html')), 'la página principal');
  await page.waitForSelector('text=Hola, Ana. Soy Orb.', { timeout: 60000 });
  const st = () => page.evaluate(() => window.orb.update.get());
  assert.equal((await st()).current, before.replace(/\.0$/, ''));
  await page.evaluate(() => window.orb.update.check());
  await until(async () => (await st()).state === 'available', `aviso de la ${target}`);
  assert.equal((await st()).version, target);
  await page.waitForSelector(`[data-testid=update-card] >> text=(${target})`);
  await page.screenshot({ path: path.join(OUT, 'actualizar-1-aviso.png') });
  await page.click('[data-testid=update-now]');
  await until(async () => (await st()).state === 'downloaded', 'descarga', 300000);
  await page.waitForSelector('[data-testid=update-restart]');
  await page.screenshot({ path: path.join(OUT, 'actualizar-2-lista.png') });
  await page.click('[data-testid=update-restart]').catch(() => { /* the app closes while clicking */ });
  try { await browser.close(); } catch { /* gone */ }
  await until(() => fileVersion().startsWith(target), `programa instalado en la ${target}`, 300000);
  console.log(`✔ actualización real: ${before} → ${fileVersion()} (aviso, descarga, reiniciar e instalar)`);
} finally {
  await new Promise((r) => setTimeout(r, 5000)); // the new version opens by itself after installing
  killAll(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* temp */ }
}
