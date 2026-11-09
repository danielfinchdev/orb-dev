// 3.8.3: how a conversation feels, measured in the window itself (a build with the `e2e` cargo feature: the only one
// with a DevTools port). Everything runs on a throwaway workspace and app-data folder in %TEMP% with the fake agents
// (their STREAM_LARGO answer streams ~2 KB of Markdown for ~3 s, as a real agent does): never the real C:\Orb,
// %APPDATA%\Orb* or the installed app. The window is shown (frames are only drawn for a visible window).
//
//   node scripts/medir-fluidez.mjs [--exe src-tauri/target-e2e/release/OrbPrueba.exe] [--runs 3] [--out <results.json>]
//
// Per run, in a new chat and then twice in that same chat (each answer streams ~3 s):
//   ownMs      Enter → the first frame showing the user's own message
//   firstMs    Enter → the first frame showing streamed text of the answer
//   gapMs      after the answer first showed, the longest time no frame showed it (the streamed block gone and the
//              saved message not drawn yet; 0 = no gap)
//   keyMs      while it streams (third message), keydown → the next frame (p50 / p90 / max of 30 keys typed 60 ms apart)
//   longTasks  main-thread tasks over 50 ms while it streams, and their total ms
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const exe = path.resolve(arg('exe', path.join(ROOT, 'src-tauri', 'target-e2e', 'release', 'OrbPrueba.exe')));
const RUNS = Number(arg('runs', 3));
const out = arg('out');
if (!fs.existsSync(exe)) { console.error(`no existe ${exe} (npm run tauri:build:e2e o pasa --exe)`); process.exit(2); }

const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs');
process.env.ORB_FAKE_AGENTS = FAKE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-medir-fluidez-'));
let current = null;
process.on('exit', () => {
  if (current) { try { execFileSync('taskkill', ['/PID', String(current.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp folder */ }
});
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error(e?.stack ?? e); process.exit(1); });
const SANDBOX = { ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_USER_DATA: path.join(tmp, 'datos-app'), ORB_MODELS_DELAY_MS: '600000' };
Object.assign(process.env, { ORB_BACKUP_ROOT: SANDBOX.ORB_BACKUP_ROOT, ORB_BRIDGE_DIR: SANDBOX.ORB_BRIDGE_DIR, ORB_NO_ADB: '1' });
const { createHome, loadConfig, writeJson, merge, paths } = await import('../src/core/home.mjs');
const { throughStart } = await import('../test/fixtures/e2e-flows.mjs');

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000, every = 50) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };

// ---- the workspace: a few conversations (a list to draw) and the default theme
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { userName: 'Ana' });
const OFF = Object.fromEntries(['codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));
writeJson(paths(home).config, merge(loadConfig(home), { ui: { tourDone: true }, agents: OFF, autoRun: false }));
fs.mkdirSync(SANDBOX.ORB_USER_DATA, { recursive: true });
fs.writeFileSync(path.join(SANDBOX.ORB_USER_DATA, 'ubicacion.json'), JSON.stringify({ home }));

const portFile = () => path.join(SANDBOX.ORB_USER_DATA, 'webview', 'EBWebView', 'DevToolsActivePort');
async function launch() {
  fs.rmSync(portFile(), { force: true });
  const app = spawn(exe, [], { env: { ...process.env, ...SANDBOX, ORB_E2E_CDP_PORT: '0' }, stdio: 'ignore' });
  current = app;
  const exited = new Promise((r) => app.once('exit', r));
  const port = await until(() => { const n = Number(fs.readFileSync(portFile(), 'utf8').split(/\r?\n/)[0]); return n > 0 ? n : null; }, 'DevToolsActivePort', 60000, 25);
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana (CDP)', 60000, 25);
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => /index\.html|tauri\.localhost\/?$/.test(p.url())), 'la página principal', 60000, 25);
  return { app, browser, page, exited };
}
async function quit(run) {
  try { await run.page.evaluate(() => window.orb?.windowControls?.act('close')); } catch { /* closing */ }
  const gone = await Promise.race([run.exited.then(() => true), wait(15000).then(() => false)]);
  if (!gone) { try { execFileSync('taskkill', ['/PID', String(run.app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } await run.exited; }
  current = null;
  try { await run.browser.close(); } catch { /* gone */ }
  await wait(1500);
}

// In the page: every frame, whether the user's message (its text) and the answer (the nth «ZORRO») are on screen.
const watch = (page, mine, nth) => page.evaluate(({ mine, nth }) => {
  const w = { t0: null, frames: [], done: false, long: [] };
  window.__medida = w;
  const lines = () => document.querySelector('[data-testid=chat-lines]');
  const count = (s, x) => s.split(x).length - 1;
  const onKey = (e) => { if (e.key === 'Enter' && w.t0 == null) w.t0 = e.timeStamp; };
  document.addEventListener('keydown', onKey, true);
  try { const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.long.push(e.duration); }); po.observe({ type: 'longtask' }); w.po = po; } catch { /* no long tasks */ }
  const tick = (t) => {
    if (w.done) return;
    const text = lines()?.textContent ?? '';
    w.frames.push([t, [...document.querySelectorAll('.bg-bubble')].some((b) => b.textContent.includes(mine)), count(text, 'ZORRO') >= nth]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, { mine, nth });
const collect = (page) => page.evaluate(() => {
  const w = window.__medida; w.done = true; try { w.po?.disconnect(); } catch { /* none */ }
  const after = w.frames.filter(([t]) => t >= w.t0);
  const own = after.find((f) => f[1]); const first = after.find((f) => f[2]);
  let gap = 0;
  if (first) { let since = null; for (const [t, , a] of after.filter(([t]) => t >= first[0])) { if (!a && since == null) since = t; if (a && since != null) { gap = Math.max(gap, t - since); since = null; } } if (since != null) gap = Math.max(gap, after.at(-1)[0] - since); }
  return { ownMs: own ? own[0] - w.t0 : null, firstMs: first ? first[0] - w.t0 : null, gapMs: gap, longTasks: w.long.length, longMs: w.long.reduce((a, b) => a + b, 0) };
});
// The answer showed and the assistant is no longer working.
const idle = (page, nth) => until(() => page.evaluate((n) => (document.querySelector('[data-testid=chat-lines]')?.textContent ?? '').split('ZORRO').length - 1 >= n && !document.querySelector('[data-testid=chat-activity]'), nth), 'el asistente terminó', 60000, 100);

const zorros = (page) => page.evaluate(() => (document.querySelector('[data-testid=chat-lines]')?.textContent ?? '').split('ZORRO').length - 1);
async function send(page, text, { typing = false } = {}) {
  const nth = (await zorros(page)) + 1; // the answers already on screen, and this one
  const box = page.locator('[data-testid=chat-input]');
  await box.click(); await box.fill(text);
  await watch(page, text, nth);
  await page.keyboard.press('Enter');
  let keys = null;
  if (typing) {
    await until(() => page.evaluate((n) => (document.querySelector('[data-testid=chat-lines]')?.textContent ?? '').split('ZORRO').length - 1 >= n, nth), 'el streaming', 20000, 20);
    await page.evaluate(() => {
      const out = []; let last = null;
      const box = document.querySelector('[data-testid=chat-input]');
      const down = (e) => { last = e.timeStamp; };
      const input = () => { const at = last; requestAnimationFrame((t) => out.push(t - at)); };
      box.addEventListener('keydown', down); box.addEventListener('input', input);
      window.__teclas = { out, stop: () => { box.removeEventListener('keydown', down); box.removeEventListener('input', input); } };
    });
    for (let i = 0; i < 30; i++) { await page.keyboard.type('a'); await wait(60); }
    keys = await page.evaluate(() => { window.__teclas.stop(); return window.__teclas.out; });
  }
  await idle(page, nth);
  await wait(1500);
  const m = await collect(page);
  if (typing) { await page.locator('[data-testid=chat-input]').fill(''); }
  return { ...m, ...(keys ? { keyP50: pct(keys, 50), keyP90: pct(keys, 90), keyMax: Math.max(...keys), keys: keys.length } : {}) };
}

// ---- first start (master password, folders): not measured
{
  const run = await launch();
  await throughStart(run.page, { ready: '[data-testid=sidebar-home]', timeout: 120000 });
  await wait(2000);
  await quit(run);
}
const results = { exe, runs: [] };
for (let i = 1; i <= RUNS; i++) {
  const run = await launch();
  const { page } = run;
  await throughStart(page, { ready: '[data-testid=sidebar-home]', timeout: 120000 });
  await wait(4000); // the start settles
  await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]');
  await page.locator('[data-testid=chat-input]').waitFor({ timeout: 20000 });
  const nuevo = await send(page, `STREAM_LARGO hola ${i}a`);
  const abierto = await send(page, `STREAM_LARGO hola ${i}b`);
  const escribiendo = await send(page, `STREAM_LARGO hola ${i}c`, { typing: true });
  results.runs.push({ run: i, nuevo, abierto, escribiendo });
  console.error(`vuelta ${i}: ${JSON.stringify(results.runs.at(-1))}`);
  await quit(run);
}
const all = (k, f) => results.runs.map((r) => r[k][f]).filter((x) => x != null);
const sum = (k, f) => ({ p50: r1(pct(all(k, f), 50)), max: r1(Math.max(...all(k, f))) });
results.summary = {
  newChat: { ownMs: sum('nuevo', 'ownMs'), firstMs: sum('nuevo', 'firstMs'), gapMs: sum('nuevo', 'gapMs') },
  openChat: { ownMs: sum('abierto', 'ownMs'), firstMs: sum('abierto', 'firstMs'), gapMs: sum('abierto', 'gapMs') },
  typingWhileStreaming: { keyP50: sum('escribiendo', 'keyP50'), keyP90: sum('escribiendo', 'keyP90'), keyMax: sum('escribiendo', 'keyMax'), longTasks: sum('escribiendo', 'longTasks'), longMs: sum('escribiendo', 'longMs') }
};
console.log(JSON.stringify(results.summary, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
process.exit(0);
