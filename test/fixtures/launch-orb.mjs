// 3.8.1 (D10): the e2e scripts drive the real Orb on Tauri. launchOrb() starts the TEST build of Orb.exe (cargo feature
// e2e: npm run tauri:build:e2e → src-tauri/target-e2e/release/Orb.exe; or --exe <file> / ORB_E2E_EXE) with its window
// never shown (ORB_HIDDEN_WINDOW) and a DevTools port of its own (ORB_E2E_CDP_PORT, only in that build), and connects
// Playwright to its WebView2 over CDP (chromium.connectOverCDP). Nothing opens on the desktop.
//   const orb = await launchOrb({ env, userData });
//   orb.page (Playwright Page of Orb's window), orb.call(method, params) (window.orb.call), orb.close(), orb.pid
// userData: the app's data folder for the test (ORB_USER_DATA: never the real profile). env: added to the process's.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argExe = process.argv.indexOf('--exe');
export const E2E_EXE = argExe > 0 ? process.argv[argExe + 1] : process.env.ORB_E2E_EXE || path.join(ROOT, 'src-tauri', 'target-e2e', 'release', 'Orb.exe');
// The test build has these names in it; the release build never does (scripts/tauri-check-release.mjs).
export const isTestBuild = (exe = E2E_EXE) => { try { return fs.readFileSync(exe).includes(Buffer.from('ORB_E2E_CDP_PORT')); } catch { return false; } };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms, every = 250) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };
const MAIN = /^http:\/\/tauri\.localhost\/?(index\.html)?([?#].*)?$/;

export async function launchOrb({ env = {}, userData, args = [], exe = E2E_EXE, timeout = 60000 } = {}) {
  if (!fs.existsSync(exe)) throw new Error(`no existe ${exe} (npm run tauri:build:e2e)`);
  if (!isTestBuild(exe)) throw new Error(`${exe} no es la build de pruebas (su ventana se vería): npm run tauri:build:e2e`);
  if (!userData) throw new Error('launchOrb: falta userData (nunca el perfil real)');
  fs.mkdirSync(userData, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 600);
  const child = spawn(exe, args, { env: { ...process.env, ORB_NO_UPDATE: '1', ...env, ORB_USER_DATA: userData, ORB_E2E_CDP_PORT: String(port), ORB_HIDDEN_WINDOW: '1' }, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  const kill = () => { if (child.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } } };
  let browser = null;
  try {
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana de Orb (CDP)', timeout);
    const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => MAIN.test(p.url())), 'la página principal', timeout);
    // A hidden window paints few frames: an action that waits for the page to settle fails in time instead of hanging.
    page.setDefaultTimeout(30000);
    const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
    // Closed as the user closes it (the window's own button: tasks are asked about, the engine stops cleanly), then by
    // its process id if it does not end in time.
    const close = async ({ wait: ms = 15000 } = {}) => {
      try { await page.evaluate(() => window.orb?.windowControls?.act('close')); } catch { /* closing */ }
      const done = await Promise.race([exited.then(() => true), wait(ms).then(() => false)]);
      if (!done) kill();
      try { await browser.close(); } catch { /* gone */ }
    };
    return { page, browser, call, close, kill, pid: child.pid, port, exited };
  } catch (error) {
    try { await browser?.close(); } catch { /* gone */ }
    kill();
    throw error;
  }
}
