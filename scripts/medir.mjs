// Measures a build of Orb the same way for every version (3.8.0 Electron is the baseline, 3.8.1 Tauri must beat it):
// start time, memory, sizes and how smooth the interface scrolls. Everything runs on a throwaway workspace and app-data
// folder in %TEMP% with the fake agents: never the real C:\Orb, %APPDATA%\Orb.dev or the installed app.
//
//   node scripts/medir.mjs [--exe src-tauri/target-e2e/release/Orb.exe] [--shell tauri|electron] [--runs 5] [--idle 30]
//                          [--installer <setup.exe>] [--apk <file.apk>] [--out <results.json>] [--hidden] [--profile <dir>]
//
// Tauri: measures a build with the `e2e` cargo feature (npm run tauri:build:e2e), the only one that opens the window's
// DevTools port (ORB_E2E_CDP_PORT; a normal build ignores it and every WEBVIEW2_* variable). --hidden keeps its window
// hidden the whole time (ORB_HIDDEN_WINDOW=1: nobody at the PC; the numbers are then of a window never shown).
// Electron honours ORB_HIDDEN_WINDOW too (an offscreen window that still draws 60 frames a second; its frames are copied
// to the main process, whose memory is then not comparable with a shown window's). --profile: on the last start, a CPU
// profile of the start, a trace and a CPU profile of the long conversation's scrolling, the compositor's layers and
// a heap snapshot after the views, saved in <dir> (open them in Chrome's DevTools). cpuIdle: the CPU all the processes
// used at rest, from 5 s after the start until the idle memory point.
//
// Fair between shells (review T0–D2 A3/A4/M5): the DevTools port is 0 (the app picks a free one and writes it to
// DevToolsActivePort in the throwaway data folder: never another Orb's port); the main screen is the page's own mark
// (performance.mark('orb:ready'), src/ui/main.jsx), so a late DevTools connection changes nothing; the throwaway data
// folder is checked to really hold the window's profile; the private working set (what Task Manager shows) is given
// next to the working set and private bytes; and the commit, the exe's date, the window's size, its devicePixelRatio and
// the monitors' refresh rates are recorded. The installed size of Tauri is that of what the installer puts in the
// install folder (Orb.exe, node\, app\), measured next to the exe: installing the real installer, even in a temporary
// folder, would register an Orb in this user's Windows (uninstall entry, shortcuts) over the one installed.
// Start: from spawning the process to the first paint (the page's own paint timing), to the engine being ready (its
// «motor arrancado» line in motor.log, written with the system clock) and to the main screen being drawn (the sidebar).
// Run 1 is the first timed start (start 0, the workspace's first, is not timed) (Windows' file cache may still hold it: a true cold start needs a reboot and
// is not done here); runs 2..n are warm. RAM: working set and private bytes of the whole process tree (Win32_Process by
// ParentProcessId) after --idle seconds and after opening chats, tasks, projects and other views. Smoothness:
// requestAnimationFrame deltas and long animation frames while scrolling the long chat list and a long conversation.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// --shell electron: Orb 3.8.0, the baseline (--exe of a copy of an installed 3.8.0; Electron is no longer in this repository).
const shell = arg('shell', 'tauri');
const exe = path.resolve(arg('exe', shell === 'tauri' ? path.join(ROOT, 'src-tauri', 'target-e2e', 'release', 'Orb.exe') : path.join(ROOT, 'dist', 'win-unpacked', `${PKG.productName}.exe`)));
const RUNS = Number(arg('runs', 5));
const IDLE_S = Number(arg('idle', 30));
const installer = arg('installer', path.join(ROOT, 'dist', `Orb-${PKG.version}-instalador.exe`));
const apk = arg('apk');
const hidden = process.argv.includes('--hidden');
const profileDir = arg('profile') ? path.resolve(arg('profile')) : null;
if (profileDir) fs.mkdirSync(profileDir, { recursive: true });
if (!fs.existsSync(exe)) { console.error(`no existe ${exe} (compila antes o pasa --exe)`); process.exit(2); }

// The test environment before any module of Orb loads (the fake agents are read when src/agents loads).
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs');
process.env.ORB_FAKE_AGENTS = FAKE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-medir-'));
// Whatever happens, the app this script started is closed (by its pid) and the throwaway folder goes.
let current = null;
process.on('exit', () => {
  if (current) { try { execFileSync('taskkill', ['/PID', String(current.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp folder */ }
});
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error(e?.stack ?? e); process.exit(1); });
const SANDBOX = { ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_USER_DATA: path.join(tmp, 'datos-app'), ORB_MODELS_DELAY_MS: '600000' };
Object.assign(process.env, { ORB_BACKUP_ROOT: SANDBOX.ORB_BACKUP_ROOT, ORB_BRIDGE_DIR: SANDBOX.ORB_BRIDGE_DIR, ORB_NO_ADB: '1' });
const { createHome, loadConfig, writeJson, merge, paths } = await import('../src/core/home.mjs');
const { useHome } = await import('../src/core/context.mjs');
const { throughStart } = await import('../test/fixtures/e2e-flows.mjs');

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000, every = 50) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };

// ---- the workspace: an assistant folder with a long chat list, tasks and projects
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { userName: 'Ana' });
const OFF = Object.fromEntries(['cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));
writeJson(paths(home).config, merge(loadConfig(home), { ui: { tourDone: true }, agents: OFF, autoRun: false }));
fs.mkdirSync(SANDBOX.ORB_USER_DATA, { recursive: true });
fs.writeFileSync(path.join(SANDBOX.ORB_USER_DATA, 'ubicacion.json'), JSON.stringify({ home }));
useHome(home);
const LONG = 400; // messages in the long conversation
{
  const { Board } = await import('../src/core/board.mjs');
  const { syncProjects } = await import('../src/core/projects.mjs');
  for (let p = 1; p <= 6; p++) fs.mkdirSync(path.join(home, 'web', `proyecto-${p}`), { recursive: true });
  const board = new Board();
  syncProjects(board);
  const lorem = 'Revisa el componente, ajusta los estilos y comprueba que las pruebas siguen en verde antes de seguir con la siguiente parte del trabajo.';
  for (let i = 1; i <= 300; i++) {
    const c = board.createConversation({ title: `Conversación de prueba ${i}`, project: i % 3 ? `proyecto-${(i % 6) + 1}` : null });
    for (let m = 0; m < 4; m++) board.addChat(m % 2 ? 'orb' : 'user', `${lorem} (${i}.${m})`, null, c.id);
  }
  const long = board.createConversation({ title: 'Conversación larga' });
  for (let m = 0; m < LONG; m++) board.addChat(m % 2 ? 'orb' : 'user', `**Mensaje ${m}.** ${lorem}\n\n- punto uno\n- punto dos\n\n\`\`\`js\nconst x = ${m};\n\`\`\``, null, long.id);
  for (let i = 1; i <= 40; i++) {
    const t = board.createTask({ project: `proyecto-${(i % 6) + 1}`, title: `Tarea ${i}`, description: lorem, agent: 'claude' }, 'usuario');
    board.patch(t.id, { status: 'done' }, 'usuario');
  }
  board.db.close();
}
const runsDir = path.join(home, 'core', 'ejecuciones');

// ---- the app's processes
function processTree(rootPid) {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime | ConvertTo-Json -Compress';
  let all = null;
  for (let i = 0; all == null; i++) { try { all = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })); } catch (e) { if (i >= 3) throw e; } } // now and then the list comes cut
  const kids = new Map(); for (const p of all) { if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []); kids.get(p.ParentProcessId).push(p); }
  const out = []; const stack = all.filter((p) => p.ProcessId === rootPid);
  while (stack.length) { const p = stack.pop(); out.push(p); stack.push(...(kids.get(p.ProcessId) ?? []).filter((k) => k.ProcessId !== p.ProcessId)); }
  return out;
}
// The private working set of each process (Task Manager's «Memory»): not in Win32_Process.
function privateWs(pids) {
  try {
    const ps = `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { @(${pids.join(',')}) -contains $_.IDProcess } | Select-Object IDProcess,WorkingSetPrivate | ConvertTo-Json -Compress`;
    const rows = [JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) || '[]')].flat();
    return new Map(rows.map((r) => [r.IDProcess, Number(r.WorkingSetPrivate)]));
  } catch { return new Map(); }
}
function memory(rootPid) {
  const tree = processTree(rootPid);
  const pws = privateWs(tree.map((p) => p.ProcessId));
  // What each process is: Chromium's --type (renderer, gpu-process, utility…), a Node script, or the app itself.
  const kind = (p) => {
    const cl = String(p.CommandLine ?? ''); const t = /--type=([\w-]+)/.exec(cl)?.[1]; const u = /--utility-sub-type=([\w.-]+)/.exec(cl)?.[1]; const s = /([\w.-]+\.m?js)\b/i.exec(cl)?.[1];
    return `${p.Name} ${t ? (u ? `${t}:${u}` : t) : s ? `node:${s}` : 'main'}`;
  };
  const by = {}; for (const p of tree) { const k = kind(p); by[k] ??= { n: 0, ws: 0, priv: 0, cpu: 0 }; by[k].n++; by[k].ws += p.WorkingSetSize; by[k].priv += p.PrivatePageCount; by[k].cpu += (Number(p.KernelModeTime) + Number(p.UserModeTime)) / 1e7; }
  return { at: Date.now(), privateWsMB: pws.size ? MB(tree.reduce((s, p) => s + (pws.get(p.ProcessId) ?? 0), 0)) : null, cpuSec: tree.reduce((n, p) => n + (Number(p.KernelModeTime) + Number(p.UserModeTime)) / 1e7, 0), processes: tree.length, wsMB: MB(tree.reduce((s, p) => s + p.WorkingSetSize, 0)), privateMB: MB(tree.reduce((s, p) => s + p.PrivatePageCount, 0)),
    byName: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.n, wsMB: MB(v.ws), privateMB: MB(v.priv), cpuSec: Math.round(v.cpu * 100) / 100 }])),
    largestWsMB: MB(Math.max(...tree.map((p) => p.WorkingSetSize))) };
}

// The engine's own clock: the newest «motor arrancado» line written after the start.
function engineReadyAt(since) {
  let text = ''; try { text = fs.readFileSync(path.join(runsDir, 'motor.log'), 'utf8'); } catch { return null; }
  const stamps = text.split('\n').filter((l) => l.includes('motor arrancado')).map((l) => Date.parse(l.slice(0, 24))).filter((t) => t >= since);
  return stamps.at(-1) ?? null;
}

// Where each shell writes the port it picked (--remote-debugging-port=0): its data folder in the throwaway one.
const portFile = () => (shell === 'tauri' ? path.join(SANDBOX.ORB_USER_DATA, 'webview', 'EBWebView', 'DevToolsActivePort') : path.join(SANDBOX.ORB_USER_DATA, 'DevToolsActivePort'));
async function launch() {
  fs.rmSync(portFile(), { force: true });
  // The window's occlusion tracking could pause the frames of a window behind another one: off, the same for every shell.
  const args = shell === 'electron' ? ['--remote-debugging-port=0', '--disable-features=CalculateNativeWinOcclusion'] : [];
  const env = { ...process.env, ...SANDBOX, ...(shell === 'tauri' ? { ORB_E2E_CDP_PORT: '0' } : {}), ...(hidden ? { ORB_HIDDEN_WINDOW: '1' } : {}) };
  const t0 = Date.now();
  const app = spawn(exe, args, { env, stdio: 'ignore' });
  current = app;
  const exited = new Promise((r) => app.once('exit', r));
  const port = await until(() => { const n = Number(fs.readFileSync(portFile(), 'utf8').split(/\r?\n/)[0]); return n > 0 ? n : null; }, 'DevToolsActivePort', 60000, 25);
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana (CDP)', 60000, 25);
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => /index\.html|tauri\.localhost\/?$/.test(p.url())), 'la página principal', 60000, 25);
  return { app, t0, browser, page, exited };
}
async function quit(run) {
  try { await run.page.evaluate(() => window.orb?.windowControls?.act('close')); } catch { /* closing */ }
  const gone = await Promise.race([run.exited.then(() => true), wait(15000).then(() => false)]);
  if (!gone) { run.forced = true; try { execFileSync('taskkill', ['/PID', String(run.app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } await run.exited; }
  current = null;
  try { await run.browser.close(); } catch { /* gone */ }
  await wait(1500); // the engine's last writes and the database closing
}

// The page's own times, in the system clock (timeOrigin is the navigation's start).
const READY = '[data-testid=sidebar-home]';
const pageTimes = (page) => page.evaluate(async (sel) => {
  const at = (ms) => performance.timeOrigin + ms;
  const ready = await new Promise((resolve) => {
    // The page's own mark of its first main-screen frame (src/ui/main.jsx): exact however late this script arrives.
    const mark = () => performance.getEntriesByName('orb:ready')[0];
    if (mark()) return resolve({ t: performance.timeOrigin + mark().startTime, late: false });
    const seen = () => document.querySelector(sel);
    const poll = setInterval(() => { if (mark()) { clearInterval(poll); resolve({ t: performance.timeOrigin + mark().startTime, late: false }); } }, 20);
    if (seen()) { setTimeout(() => { clearInterval(poll); resolve(mark() ? { t: performance.timeOrigin + mark().startTime, late: false } : { t: Date.now(), late: true }); }, 1000); return; }
    const mo = new MutationObserver(() => { if (seen() && !mark()) { mo.disconnect(); clearInterval(poll); resolve({ t: performance.timeOrigin + performance.now(), late: false }); } });
    mo.observe(document, { childList: true, subtree: true });
  });
  // The whole chat list drawn: the main screen draws its first rows and the rest while idle (views/orb/inbox.jsx ›
  // useGrowing); the moment the last row was added (none added for 1.5 s, 20 s at most).
  const fullList = await new Promise((resolve) => {
    const rows = () => document.querySelectorAll('.lazy-row').length;
    let n = rows(); let last = performance.timeOrigin + performance.now();
    const id = setInterval(() => { const m = rows(); const now = performance.timeOrigin + performance.now(); if (m !== n) { n = m; last = now; } else if (now - last > 1500 || now - ready.t > 20000) { clearInterval(id); resolve({ t: last, rows: n }); } }, 10);
  });
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, at(e.startTime)]));
  // A hidden window paints nothing: the page's scripts loaded and ran (DOMContentLoaded) is the next best mark.
  const nav = performance.getEntriesByType('navigation')[0];
  return { navStart: performance.timeOrigin, fp: paint['first-paint'] ?? null, fcp: paint['first-contentful-paint'] ?? null, dcl: nav ? at(nav.domContentLoadedEventEnd) : null, ready: ready.t, readyLate: ready.late, fullList: fullList.t, fullListRows: fullList.rows };
}, READY);

// rAF deltas while an element scrolls down and back up by `px`, `step` px a frame; plus long animation frames.
const scrollFrames = (page, selector, px = 2000, step = 40) => page.evaluate(async ({ selector, px, step }) => {
  const pick = () => {
    if (selector) return document.querySelector(selector);
    // the biggest scrolling area outside the chat list: the conversation's messages
    const inbox = document.querySelector('[data-testid=orb-inbox]');
    let best = null; let room = 0;
    for (const el of document.querySelectorAll('*')) { if (inbox?.contains(el)) continue; const r = el.scrollHeight - el.clientHeight; const o = getComputedStyle(el).overflowY; if (r > room && /(auto|scroll)/.test(o)) { best = el; room = r; } }
    return best;
  };
  const el = pick(); if (!el) return null;
  const loaf = []; let obs = null;
  try { obs = new PerformanceObserver((l) => loaf.push(...l.getEntries().map((e) => e.duration))); obs.observe({ type: 'long-animation-frame' }); } catch { /* not supported */ }
  const deltas = []; let last = null; const total = Math.min(px, el.scrollHeight - el.clientHeight);
  const start = el.scrollTop;
  await new Promise((resolve) => {
    let moved = 0; let dir = 1; let rounds = 0;
    const frame = (t) => {
      if (last != null) deltas.push(t - last); last = t;
      el.scrollTop = start + (dir > 0 ? moved : total - moved) * (start > 0 ? -1 : 1);
      moved += step;
      if (moved > total) { moved = 0; dir = -dir; rounds++; }
      if (rounds >= 4) return resolve();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setTimeout(resolve, 60000); // a window that draws no frames: give up instead of waiting forever
  });
  await new Promise((r) => setTimeout(r, 200)); obs?.disconnect();
  return { element: `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : el.className ? `.${String(el.className).split(' ')[0]}` : ''}`, scrolled: total, deltas, loaf };
}, { selector, px, step });
const frameStats = (s) => (s ? { element: s.element, px: s.scrolled, frames: s.deltas.length, p50: r1(pct(s.deltas, 50)), p95: r1(pct(s.deltas, 95)), max: r1(Math.max(...s.deltas)), // % of frames that took longer than one frame at 60 Hz with margin (25 ms: at least one frame dropped) and than 50 ms
    dropped: r1((100 * s.deltas.filter((d) => d > 25).length) / s.deltas.length), over50: r1((100 * s.deltas.filter((d) => d > 50).length) / s.deltas.length), longFrames: s.loaf.length, longFramesMax: r1(s.loaf.length ? Math.max(...s.loaf) : 0) } : null);

// The page's own memory: the JavaScript heap (used / total) and the DOM's nodes and listeners, from DevTools.
async function pageMemory(page, gc = false) {
  try {
    const cdp = await page.context().newCDPSession(page);
    if (gc) await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage'); const dom = await cdp.send('Memory.getDOMCounters');
    await cdp.detach();
    return { jsHeapUsedMB: MB(heap.usedSize), jsHeapTotalMB: MB(heap.totalSize), domNodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
  } catch { return null; }
}
async function heapSnapshot(page, file) {
  const cdp = await page.context().newCDPSession(page);
  const out = fs.createWriteStream(file);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => out.write(e.chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await new Promise((r) => out.end(r)); await cdp.detach();
}
let windowInfo = null;
const results = { target: { exe, shell, version: PKG.version, hiddenWindow: hidden, ...(shell === 'tauri' ? { build: 'e2e feature' } : {}) }, starts: [], memory: {}, frames: {}, sizes: {}, machine: {} };

// ---- 0: the first start of this workspace (master password, folders' review): not timed
{
  const run = await launch();
  await throughStart(run.page, { ready: READY, timeout: 120000 });
  await wait(3000);
  await quit(run);
  // The window's WebView2 profile must be the throwaway one (Tauri puts it in ORB_USER_DATAwebview), never the PC's.
  if (shell === 'tauri' && !fs.existsSync(path.join(SANDBOX.ORB_USER_DATA, 'webview', 'EBWebView'))) { console.error('el perfil de WebView2 no está en la carpeta de prueba: abortado'); process.exit(3); }
}

// ---- 1..n: the start
for (let i = 1; i <= RUNS; i++) {
  const run = await launch();
  // --profile: the last start's JavaScript, from the moment DevTools reaches the page until the main screen is drawn
  let startCdp = null;
  if (profileDir && i === RUNS) { try { startCdp = await run.page.context().newCDPSession(run.page); await startCdp.send('Profiler.enable'); await startCdp.send('Profiler.setSamplingInterval', { interval: 200 }); await startCdp.send('Profiler.start'); } catch { startCdp = null; } }
  const pt = await pageTimes(run.page);
  if (startCdp) { const { profile } = await startCdp.send('Profiler.stop'); fs.writeFileSync(path.join(profileDir, 'arranque.cpuprofile'), JSON.stringify(profile)); await startCdp.detach(); }
  const engine = await until(() => engineReadyAt(run.t0), 'motor arrancado en motor.log', 60000, 100);
  results.starts.push({ run: i, toNavStartMs: Math.round(pt.navStart - run.t0), toFirstPaintMs: pt.fcp ? Math.round(pt.fcp - run.t0) : null, toScriptsReadyMs: pt.dcl ? Math.round(pt.dcl - run.t0) : null, toEngineReadyMs: Math.round(engine - run.t0), toMainScreenMs: Math.round(pt.ready - run.t0), mainScreenLate: pt.readyLate, toFullListMs: Math.round(pt.fullList - run.t0), fullListRows: pt.fullListRows });
  console.error(`arranque ${i}: ${JSON.stringify(results.starts.at(-1))}`);
  if (i < RUNS) { await quit(run); continue; }

  // ---- memory and smoothness on the last start
  windowInfo = await run.page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio, screen: { width: screen.width, height: screen.height } })).catch(() => null);
  await wait(Math.min(5, IDLE_S) * 1000);
  const settled = memory(run.app.pid);
  await wait(Math.max(0, IDLE_S - 5) * 1000);
  const { page } = run;
  results.memory.idle = { ...memory(run.app.pid), page: await pageMemory(page) };
  // the CPU the app used while nobody touched it (all its processes, % of one core), from 5 s after the start to now
  const busy = (a, b, k) => { const x = k ? a.byName[k]?.cpuSec ?? 0 : a.cpuSec; const y = k ? b.byName[k]?.cpuSec ?? 0 : b.cpuSec; return Math.round((1000 * (y - x)) / (b.at - a.at)) / 10; };
  results.cpuIdle = { seconds: Math.round((results.memory.idle.at - settled.at) / 1000), percentOfOneCore: busy(settled, results.memory.idle), byName: Object.fromEntries(Object.keys(results.memory.idle.byName).map((k) => [k, busy(settled, results.memory.idle, k)])) };
  const click = async (sel) => { try { await page.click(sel, { timeout: 5000 }); await wait(700); return true; } catch { return false; } };
  const opened = [];
  // chats of the list (the newest ones on top), the tasks, the projects' info, then the other views
  const items = await page.$$eval('[data-testid^=item-c]', (els) => els.slice(0, 6).map((e) => e.dataset.testid));
  for (const t of items) if (await click(`[data-testid=${t}]`)) opened.push(t);
  const groups = await page.$$eval('[data-testid^=orb-row-]', (els) => els.filter((e) => e.dataset.kind === 'task').slice(0, 3).map((e) => e.dataset.testid));
  for (const t of groups) if (await click(`[data-testid="${t}"] button`)) opened.push(t);
  // the tasks and projects views have no button of their own on the PC: opened as the window restores its last view
  for (const view of ['tasks', 'projects']) {
    try {
      await page.evaluate((v) => { localStorage.setItem('orb.route', JSON.stringify({ view: v })); location.reload(); }, view);
      await page.waitForSelector(READY, { timeout: 30000 }); await wait(1500); opened.push(`view:${view}`);
    } catch { /* not this one */ }
  }
  // (not «Agentes»: the fake agents' version check starts the app's own executable, which a real agent never is)
  for (const t of ['nav-memories', 'nav-tutorials', 'nav-settings']) if (await click(`[data-testid=${t}]`)) opened.push(t);
  await page.keyboard.press('Escape').catch(() => {});
  await wait(10000);
  results.memory.afterViews = { ...memory(run.app.pid), opened, page: await pageMemory(page), pageAfterGc: await pageMemory(page, true) };
  if (profileDir) await heapSnapshot(page, path.join(profileDir, 'vistas.heapsnapshot'));

  // the long chat list (the sidebar's inbox) and the long conversation
  await click(READY);
  results.frames.chatList = frameStats(await scrollFrames(page, '[data-testid=mobile-chats]'));
  const longId = await page.evaluate(async () => (await window.orb.call('conversations.list')).find?.((c) => c.title === 'Conversación larga')?.id ?? null).catch(() => null);
  const longItem = longId ? `[data-testid=item-c${longId}]` : null;
  if (longItem && await click(longItem)) {
    await wait(1500);
    // the biggest scrolling area now is the conversation's messages
    results.frames.longChat = frameStats(await scrollFrames(page, null));
    if (profileDir) {
      // the same scrolling again, recorded: a trace (what each frame spent its time on) and the JavaScript's CPU profile
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
      await run.browser.startTracing(page, { path: path.join(profileDir, 'chat-largo.trace.json'), categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8.execute', 'blink', 'cc', 'gpu', 'viz', 'benchmark', 'latencyInfo'] });
      await scrollFrames(page, null);
      await run.browser.stopTracing();
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(path.join(profileDir, 'chat-largo.cpuprofile'), JSON.stringify(profile));
      // the compositor's layers and why each one exists (too many layers make every scrolled frame slow)
      const layers = await new Promise((resolve) => { cdp.on('LayerTree.layerTreeDidChange', (e) => { if (e.layers) resolve(e.layers); }); cdp.send('LayerTree.enable'); setTimeout(() => resolve([]), 5000); });
      const reasons = {}; const owners = {};
      await cdp.send('DOM.enable').catch(() => {});
      for (const l of layers) {
        let why = [];
        try { const r = await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId }); why = r.compositingReasonIds ?? r.compositingReasons ?? []; } catch { /* gone */ }
        for (const k of why) reasons[k] = (reasons[k] ?? 0) + 1;
        let who = '?';
        if (l.backendNodeId) { try { const { node } = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }); const a = Object.fromEntries((node.attributes ?? []).reduce((acc, v, i, all) => (i % 2 ? acc : [...acc, [v, all[i + 1]]]), [])); who = `${node.localName}${a['data-testid'] ? `[${a['data-testid']}]` : a.class ? `.${a.class.split(' ').slice(0, 2).join('.')}` : ''}`; } catch { /* gone */ } }
        const key = `${who} ← ${why.join('+') || '-'}`; owners[key] = (owners[key] ?? 0) + 1;
      }
      // the elements that can scroll (each one a layer of its own): which and how many
      const scrollers = await page.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el); const x = /(auto|scroll|hidden)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth; const y = /(auto|scroll|hidden)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
          if (!x && !y) continue;
          const k = `${el.localName}.${String(el.className?.baseVal ?? el.className).split(' ').slice(0, 2).join('.')} ${cs.overflowX}/${cs.overflowY} ${x ? 'x' : ''}${y ? 'y' : ''}`; out[k] = (out[k] ?? 0) + 1;
        }
        return out;
      });
      fs.writeFileSync(path.join(profileDir, 'capas.json'), JSON.stringify({ layers: layers.length, reasons, scrollers, owners: Object.fromEntries(Object.entries(owners).sort((a, b) => b[1] - a[1])) }, null, 1));
      await cdp.detach();
    }
  }
  results.memory.afterScroll = { ...memory(run.app.pid), page: await pageMemory(page) };
  await quit(run);
}

// ---- sizes
const dirSize = (dir) => { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size; } return n; };
const assets = path.join(ROOT, 'src', 'renderer', 'assets');
const js = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f))) : [];
const entry = (() => { try { const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8'); const m = /assets\/(index-[^"]+\.js)/.exec(html); return m ? fs.statSync(path.join(assets, m[1])).size : null; } catch { return null; } })();
results.sizes = {
  installerMB: fs.existsSync(installer) ? MB(fs.statSync(installer).size) : null, installer: fs.existsSync(installer) ? installer : null,
  // Electron: win-unpacked. Tauri: what the installer puts next to Orb.exe (the exe and its resources), not the whole
  // cargo target folder.
  ...(() => {
    if (shell !== 'tauri') return { appFolderMB: MB(dirSize(path.dirname(exe))), appFolder: path.dirname(exe) };
    const parts = [exe, ...['node', 'app'].map((d) => path.join(path.dirname(exe), d)).filter((d) => fs.existsSync(d))];
    return { appFolderMB: MB(parts.reduce((n, p) => n + (fs.statSync(p).isDirectory() ? dirSize(p) : fs.statSync(p).size), 0)), appFolder: parts };
  })(),
  apkMB: apk && fs.existsSync(apk) ? MB(fs.statSync(apk).size) : null, apk: apk ?? null,
  jsBundle: { files: js.length, totalMB: MB(js.reduce((s, b) => s + b.length, 0)), gzipMB: MB(js.reduce((s, b) => s + zlib.gzipSync(b, { level: 9 }).length, 0)), entryKB: entry ? Math.round(entry / 1024) : null },
  rendererMB: fs.existsSync(path.join(ROOT, 'src', 'renderer')) ? MB(dirSize(path.join(ROOT, 'src', 'renderer'))) : null
};

// ---- summary and machine
const warm = results.starts.slice(1);
const summary = (k) => ({ first: results.starts[0]?.[k] ?? null, warmMedian: median(warm.map((s) => s[k])), warmP95: pct(warm.map((s) => s[k]), 95) });
results.summary = { firstPaint: summary('toFirstPaintMs'), scriptsReady: summary('toScriptsReadyMs'), engineReady: summary('toEngineReadyMs'), mainScreen: summary('toMainScreenMs'), fullList: summary('toFullListMs') };
let windows = os.release(); try { windows = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Caption + " " + (Get-CimInstance Win32_OperatingSystem).BuildNumber'], { encoding: 'utf8' }).trim(); } catch { /* the release number */ }
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
let monitors = null; try { monitors = [JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json -Compress'], { encoding: 'utf8' }) || '[]')].flat(); } catch { /* not known */ }
results.target.commit = git('rev-parse', 'HEAD'); results.target.dirty = Boolean(git('status', '--porcelain', '--untracked-files=no'));
results.target.exeDate = fs.statSync(exe).mtime.toISOString();
// The bundle measured (sizes.jsBundle) is this checkout's src/renderer: said when the exe is older than its last commit.
results.target.exeOlderThanCommit = (() => { const t = Date.parse(git('log', '-1', '--format=%cI') ?? ''); return Number.isFinite(t) ? fs.statSync(exe).mtimeMs < t : null; })();
results.target.startsLate = results.starts.filter((x) => x.mainScreenLate).length;
results.machine = { monitors, window: windowInfo, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), windows, node: process.version, date: new Date().toISOString() };
const out = arg('out');
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp folder */ }
process.exit(0);
