// 3.8.3: the window of a test build (cargo feature `e2e`, the only one with a DevTools port), shared by the measuring
// scripts (medir-fluidez, medir-animaciones, medir-reflejo). Everything lives in a throwaway folder in %TEMP%: the
// workspace, the app data, the backups and the bridge folder, with the fake agents (test/fixtures/fake-live.mjs) and
// the test master password. Never the real C:\Orb, %APPDATA%\Orb* or the installed app; only the process started here
// (its exact PID and its children) is ever stopped. The window is shown: frames are only drawn for a visible window.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const until = async (fn, what, ms = 60000, every = 50) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };
export const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
export const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// → { exe, home, configure(patch), launch(), quit(run) }. configure merges into the workspace's config (written before
// a start, so the next start reads it).
export async function sandbox({ name, defaultExe = 'Orb.exe' }) {
  const exe = path.resolve(arg('exe', path.join(ROOT, 'src-tauri', 'target-e2e', 'release', defaultExe)));
  if (!fs.existsSync(exe)) { console.error(`no existe ${exe} (npm run tauri:build:e2e o pasa --exe)`); process.exit(2); }
  const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs');
  process.env.ORB_FAKE_AGENTS = FAKE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `orb-${name}-`));
  let current = null;
  process.on('exit', () => {
    if (current) { try { execFileSync('taskkill', ['/PID', String(current.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp folder */ }
  });
  for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error(e?.stack ?? e); process.exit(1); });
  const SANDBOX = { ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_USER_DATA: path.join(tmp, 'datos-app'), ORB_MODELS_DELAY_MS: '600000' };
  Object.assign(process.env, { ORB_BACKUP_ROOT: SANDBOX.ORB_BACKUP_ROOT, ORB_BRIDGE_DIR: SANDBOX.ORB_BRIDGE_DIR, ORB_NO_ADB: '1' });
  const { createHome, loadConfig, writeJson, merge, paths } = await import('../../src/core/home.mjs');

  const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  const { home } = createHome(base, { userName: 'Ana' });
  const OFF = Object.fromEntries(['codex', 'cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));
  const configure = (patch = {}) => writeJson(paths(home).config, merge(loadConfig(home), { agents: OFF, autoRun: false, ...patch, ui: { tourDone: true, ...(patch.ui ?? {}) } }));
  configure();
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
  return { exe, home, configure, launch, quit };
}
