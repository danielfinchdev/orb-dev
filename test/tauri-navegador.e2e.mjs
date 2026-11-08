// 3.8.1 (D7, D8): the agents' browser and dropped files in the real Tauri app, with nobody at the PC. Runs the e2e build
// (npm run tauri:build:e2e) with its window never shown (ORB_HIDDEN_WINDOW=1), app data and workspace in %TEMP% and the
// fake agents (test/fixtures/fake-live.mjs): never the real C:\Orb, %APPDATA%\Orb.dev or the installed app.
//   node test/tauri-navegador.e2e.mjs [--exe <Orb.exe>] [--trampa]
// --trampa (only with someone at the PC: if a protection failed, a native dialog would show on the desktop): a page that
// tries every native picker on a click of the agent (a transparent file input over a button, a color input, a select,
// showSaveFilePicker) and checks that no window of the agents' browser ever becomes visible.
// A fake Claude drives the agents' browser through Orb's real MCP server (NAVEGA_GUION) against a local test site, and
// this script checks, from outside, what Rust promised (src-tauri/src/browser.rs):
//   - the pages work (type, click, screenshot) and the little window gets its pictures (kept hidden here);
//   - a new window is refused before it exists (window.open() gets null, no window appears, no other page stays) and its
//     address opens in the same page;
//   - downloads, permissions, HTTP sign-in prompts, file: and another app's protocol are refused, and the agent is told;
//   - the agents' browser is another browser process, with no DevTools port and no visible window, and Orb's window is
//     not in it; its pages cannot reach Orb (no Tauri IPC, no Orb pages); the user agent is Edge's;
//   - the browser process ends when its last page closes;
//   - D8: a file dropped from disk on a conversation's box arrives with its real path;
//   - review D7–D8: a page has no clipboard writing, File System Access pickers, share or WebAuthn; a page flooding
//     events (huge console errors, pushState and titles in a loop) neither freezes Orb nor grows its memory, and the
//     agent learns events were dropped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argExe = process.argv.indexOf('--exe');
const EXE = argExe > 0 ? process.argv[argExe + 1] : path.join(ROOT, 'src-tauri', 'target-e2e', 'release', 'Orb.exe');
if (!fs.existsSync(EXE)) { console.error(`no existe ${EXE} (npm run tauri:build:e2e)`); process.exit(2); }

const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-live.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-navegador-'));
const USER_DATA = path.join(tmp, 'datos-app');
const SANDBOX = { ORB_NO_ADB: '1', ORB_NO_UPDATE: '1', ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: path.join(tmp, 'copias'), ORB_BRIDGE_DIR: path.join(tmp, 'puente'), ORB_USER_DATA: USER_DATA, ORB_MODELS_DELAY_MS: '600000' };
Object.assign(process.env, { ORB_FAKE_AGENTS: FAKE, ORB_BACKUP_ROOT: SANDBOX.ORB_BACKUP_ROOT, ORB_BRIDGE_DIR: SANDBOX.ORB_BRIDGE_DIR, ORB_NO_ADB: '1' });
const { createHome, loadConfig, writeJson, merge, paths } = await import('../src/core/home.mjs');
const { useHome } = await import('../src/core/context.mjs');
const { throughStart } = await import('./fixtures/e2e-flows.mjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000, every = 100) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const results = [];
const check = (name, fn) => { try { fn(); results.push(['✔', name]); } catch (error) { results.push(['✖', name, error.message.split('\n')[0]]); } };

// ---- the workspace, with one project for the fake Claude to work in
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { userName: 'Ana' });
const OFF = Object.fromEntries(['cursor', 'gemini', 'opencode', 'qwen', 'copilot'].map((a) => [a, { enabled: false }]));
writeJson(paths(home).config, merge(loadConfig(home), { ui: { tourDone: true }, agents: OFF, autoRun: false }));
fs.mkdirSync(USER_DATA, { recursive: true });
fs.writeFileSync(path.join(USER_DATA, 'ubicacion.json'), JSON.stringify({ home }));
useHome(home);
const project = path.join(home, 'web', 'navegador');
fs.mkdirSync(project, { recursive: true });
{ const { Board } = await import('../src/core/board.mjs'); const { syncProjects } = await import('../src/core/projects.mjs'); const b = new Board(); syncProjects(b); b.db.close(); }

// ---- the test site
const DOWNLOAD = `orb-e2e-${process.pid}-${Date.now()}.zip`;
const hits = [];
const SITE = {
  '/': '<!doctype html><title>Prueba</title><h1>Web de prueba</h1><input id=q placeholder="Escribe aquí"><button onclick="r.textContent=\'Recibido: \'+q.value">Enviar</button><p id=r></p>',
  '/emergente': '<!doctype html><title>Emergente</title><a href="/dos" target="_blank">Abrir en otra ventana</a> <button onclick="const w = window.open(\'/tres\'); fetch(\'/log?abrio=\' + (w ? \'ventana\' : \'null\'))">window.open</button>',
  '/dos': '<!doctype html><title>Dos</title><p>segunda página</p>',
  '/tres': '<!doctype html><title>Tres</title><p>tercera página</p>',
  '/descarga': `<!doctype html><title>Descarga</title><a href="/${DOWNLOAD}">Bajar el archivo</a>`,
  '/permisos': '<!doctype html><title>Permisos</title><button onclick="navigator.geolocation.getCurrentPosition(() => out.textContent = \'geo concedida\', (e) => out.textContent = \'geo denegada \' + e.code)">Ubicación</button> <button onclick="navigator.mediaDevices.getUserMedia({audio:true}).then(() => out2.textContent = \'micro concedido\', (e) => out2.textContent = \'micro denegado \' + e.name)">Micrófono</button><p id=out></p><p id=out2></p>',
  '/salidas': '<!doctype html><title>Salidas</title><a href="file:///C:/Windows/win.ini">Archivo local</a> <a href="orb-prueba-inexistente:abrir">Otra app</a> <a href="http://tauri.localhost/index.html">Orb</a>',
  '/aislamiento': `<!doctype html><title>Aislamiento</title><pre id=out>...</pre><script>(async () => {
    const r = { tauri: typeof window.__TAURI_INTERNALS__, ipcGlobal: typeof window.__TAURI__ };
    try { window.chrome.webview.postMessage('orb-file:1'); r.webMessage = 'enviado'; } catch (e) { r.webMessage = 'no: ' + e.name; }
    for (const [k, u] of [['ipc', 'http://ipc.localhost/engine_call'], ['ui', 'http://tauri.localhost/index.html']]) {
      try { const res = await fetch(u, { method: k === 'ipc' ? 'POST' : 'GET', body: k === 'ipc' ? '{}' : undefined, signal: AbortSignal.timeout(2500) }); r[k] = 'respuesta ' + res.status + ' ' + (await res.text()).slice(0, 40); } catch (e) { r[k] = 'sin acceso (' + e.name + ')'; }
    }
    r.ua = navigator.userAgent;
    out.textContent = 'RESULTADO ' + JSON.stringify(r);
  })()</script>`,
  '/capacidades': `<!doctype html><title>Capacidades</title><pre id=out>...</pre><script>
    const native = (f) => typeof f === 'function' && /native code/.test(Function.prototype.toString.call(f));
    out.textContent = 'RESULTADO ' + JSON.stringify({ clipboardWrite: native(navigator.clipboard?.writeText), execCopy: native(document.execCommand),
      fsPicker: typeof window.showSaveFilePicker, share: typeof navigator.share, credentials: native(navigator.credentials?.create), displayMedia: native(navigator.mediaDevices?.getDisplayMedia) });
  </script>`,
  '/inunda': '<!doctype html><title>Inunda</title><p>inunda</p><script>const big = "x".repeat(2e6); let n = 0; setInterval(() => { for (let i = 0; i < 20; i++) { console.error(big + n); try { null.x; } catch (e) {} history.pushState({}, "", "#" + (n++)); document.title = "t" + n + big.slice(0, 5000); } }, 0);</script>',
  '/trampa': '<!doctype html><title>Trampa</title><div style="position:relative"><button id=b style="width:300px;height:80px">Continuar</button><input type=file style="position:absolute;inset:0;opacity:0;width:300px;height:80px"></div><input type=color id=c><select id=s><option>uno</option><option>dos</option></select><button onclick="window.showSaveFilePicker?.().catch(()=>{})">Guardar</button>',
  '/anima': '<!doctype html><title>Anima</title><div id=b style="width:400px;height:300px;background:red"></div><script>let i=0;setInterval(()=>{b.style.background="hsl("+(i++*15)+",80%,50%)"},30)</script>'
};
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); hits.push(u.pathname + u.search);
  if (u.pathname === '/auth') { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="prueba"', 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Sin acceso</title><p>hace falta iniciar sesión</p>'); return; }
  if (u.pathname === `/${DOWNLOAD}`) { res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${DOWNLOAD}"` }); res.end(Buffer.alloc(2048, 1)); return; }
  if (u.pathname === '/log') { res.writeHead(204); res.end(); return; }
  const body = SITE[u.pathname]; res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(body ?? 'no');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${site.address().port}`;

// ---- Orb, hidden
const port = 9400 + Math.floor(Math.random() * 500);
const app = spawn(EXE, [], { env: { ...process.env, ...SANDBOX, ORB_E2E_CDP_PORT: String(port), ORB_HIDDEN_WINDOW: '1' }, stdio: 'ignore' });
const exited = new Promise((r) => app.once('exit', r));
let cdp = null;
const agentsDir = path.join(USER_DATA, 'navegador-agente');
// The agents' browser processes: WebView2 processes started with that data folder.
const agentProcesses = () => JSON.parse(ps(`Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${agentsDir.replace(/'/g, "''")}*' } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`) || '[]');
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
// Visible top-level windows of some processes.
const visibleWindows = (pids) => {
  if (!pids.length) return [];
  const out = ps(`Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class W { public delegate bool P(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
 public static List<string> Of(uint[] pids) { var r = new List<string>(); var set = new HashSet<uint>(pids);
  EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (set.Contains(p) && IsWindowVisible(h)) { var s = new StringBuilder(256); GetClassName(h, s, 256); r.Add(p + ":" + s); } return true; }, IntPtr.Zero); return r; } }
"@
[W]::Of(@(${pids.join(',')})) -join "\`n"`);
  return out.split(/\r?\n/).filter(Boolean);
};
try {
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana (CDP)', 60000, 250);
  cdp = browser;
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => /tauri\.localhost\/?(index\.html)?$/.test(p.url())), 'la página principal', 60000, 250);
  await throughStart(page, { timeout: 120000 }); // the master password, the layout of the folders…
  const call = (method, params) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);

  // ---- the agents' browser: a fake Claude follows a script through Orb's MCP tools
  const steps = [
    ['orb_browser_open', { url: `${B}/` }],
    ['orb_browser_type', { ref: 1, text: 'Hola, navegador' }],
    ['orb_browser_click', { ref: 2 }],
    ['orb_browser_screenshot', {}],
    ['orb_browser_open', { url: `${B}/anima` }],
    ['sleep', { ms: 2500 }],
    ['orb_browser_open', { url: `${B}/emergente` }],
    ['orb_browser_click', { ref: 1 }],
    ['sleep', { ms: 1500 }],
    ['orb_browser_snapshot', {}],
    ['orb_browser_back', {}],
    ['orb_browser_click', { ref: 2 }],
    ['sleep', { ms: 1500 }],
    ['orb_browser_snapshot', {}],
    ['orb_browser_open', { url: `${B}/descarga` }],
    ['orb_browser_click', { ref: 1 }],
    ['sleep', { ms: 1500 }],
    ['orb_browser_console', {}],
    ['orb_browser_open', { url: `${B}/permisos` }],
    ['orb_browser_click', { ref: 1 }],
    ['orb_browser_click', { ref: 2 }],
    ['sleep', { ms: 1000 }],
    ['orb_browser_snapshot', {}],
    ['orb_browser_console', {}],
    ['orb_browser_open', { url: `${B}/salidas` }],
    ['orb_browser_click', { ref: 1 }],
    ['orb_browser_click', { ref: 2 }],
    ['orb_browser_click', { ref: 3 }],
    ['sleep', { ms: 1000 }],
    ['orb_browser_snapshot', {}],
    ['orb_browser_console', {}],
    ['orb_browser_open', { url: 'file:///C:/Windows/win.ini' }],
    ['orb_browser_open', { url: `${B}/auth` }],
    ['orb_browser_console', {}],
    ['orb_browser_open', { url: `${B}/aislamiento` }],
    ['orb_browser_wait', { text: 'RESULTADO', ms: 8000 }],
    ['orb_browser_open', { url: `${B}/capacidades` }],
    ['orb_browser_wait', { text: 'RESULTADO', ms: 8000 }],
    ['orb_browser_open', { url: `${B}/inunda` }],
    ['sleep', { ms: 4000 }],
    ['orb_browser_console', {}],
    ['orb_browser_open', { url: `${B}/` }],
    ...(process.argv.includes('--trampa') ? [['orb_browser_open', { url: `${B}/trampa` }], ['orb_browser_click', { ref: 1 }], ['sleep', { ms: 1500 }], ['orb_browser_click', { ref: 2 }], ['sleep', { ms: 1500 }], ['orb_browser_click', { ref: 3 }], ['sleep', { ms: 1500 }], ['orb_browser_click', { ref: 4 }], ['sleep', { ms: 1500 }], ['orb_browser_console', {}]] : [])
  ];
  const scriptFile = path.join(tmp, 'guion.json');
  fs.writeFileSync(scriptFile, JSON.stringify(steps));
  const s = await call('sessions.create', { agent: 'claude', project: 'navegador', permission: 'editar', title: 'Navegador' });
  // Meanwhile: the agents' browser processes, their ports and windows (while pages are open).
  let seen = null;
  const watcher = (async () => {
    const procs = asList(await until(() => { const l = asList(agentProcesses()); return l.length ? l : null; }, 'el navegador de los agentes arranca', 60000, 500));
    await wait(1500);
    const all = asList(agentProcesses());
    const pids = all.map((p) => p.ProcessId);
    const listening = ps(`Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { @(${pids.join(',')}) -contains $_.OwningProcess } | Select-Object -ExpandProperty LocalPort`).split(/\r?\n/).filter(Boolean);
    seen = { procs: all.length ? all : procs, listening, windows: visibleWindows([...pids, app.pid]), devtoolsFile: fs.existsSync(path.join(agentsDir, 'DevToolsActivePort')) };
  })().catch((error) => { seen = { error: error.message }; });
  // While the flooding page is open: Orb's window keeps answering, and the memory of Orb.exe is watched.
  // Measured without blocking this script's event loop (a synchronous PowerShell call would make a call look slow).
  let slowest = 0; let peakMB = 0; const times = []; const calls = [];
  const floodWatch = setInterval(async () => {
    const t0 = performance.now();
    try { await call('app.state', {}); } catch { /* closing */ }
    const ms = Math.round(performance.now() - t0); times.push(ms); slowest = Math.max(slowest, ms);
    calls.push({ at: Date.now() - ms, ms }); // when it started (wall clock, as ORB_TRACE's marks), to set slow ones beside them
  }, 250);
  const memWatch = setInterval(() => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${app.pid}).PrivateMemorySize64`], (error, out) => { if (!error) peakMB = Math.max(peakMB, Number(out.trim()) / 1048576); });
  }, 1000);
  let trapWindows = [];
  const trapWatch = process.argv.includes('--trampa') ? setInterval(() => { try { const pids = asList(agentProcesses()).map((p) => p.ProcessId); trapWindows.push(...visibleWindows([...pids, app.pid]).filter((w) => !/Tao Thread Event Target/.test(w))); } catch { /* none */ } }, 700) : null;
  await call('sessions.send', { id: s.id, text: `NAVEGA_GUION ${scriptFile}` });
  const outFile = path.join(project, 'navegador-guion.json');
  const out = JSON.parse(await until(() => fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8'), 'el guion del agente', 240000, 500));
  await watcher;
  clearInterval(floodWatch); clearInterval(memWatch); if (trapWatch) clearInterval(trapWatch);
  const at = (i) => String(out[i] ?? '');
  fs.writeFileSync(path.join(tmp, 'guion-respuestas.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(tmp, 'app-state-llamadas.json'), JSON.stringify(calls));

  check('abre, escribe, pulsa y captura', () => {
    assert.match(at(0), /Página: Prueba/);
    assert.match(at(2), /Recibido: Hola, navegador/);
    assert.match(at(3), /captura: [1-9]\d{3,}/);
  });
  check('ventana emergente (enlace): misma página, ninguna ventana', () => assert.match(at(9), /Página: Dos/, at(9)));
  check('window.open(): devuelve null y la dirección abre en la misma página', () => {
    assert.match(at(13), /Página: Tres/, at(13));
    assert.ok(hits.includes('/log?abrio=null'), `log: ${hits.filter((h) => h.startsWith('/log')).join(' ')}`);
    assert.ok(!hits.includes('/log?abrio=ventana'));
  });
  check('descarga rechazada y avisada; nada en Descargas', () => {
    assert.match(at(17), /refused a download/, at(17));
    const downloads = path.join(os.homedir(), 'Downloads', DOWNLOAD);
    const leaked = fs.existsSync(downloads);
    if (leaked) fs.rmSync(downloads, { force: true }); // ours (unique name), never left behind
    assert.ok(!leaked, 'el archivo llegó a Descargas');
  });
  check('permisos denegados (ubicación, micrófono) y avisados', () => {
    assert.match(at(22), /geo denegada 1/, at(22));
    assert.match(at(22), /micro denegado NotAllowedError/, at(22));
    assert.match(at(23), /denied a permission request \((geolocation|microphone)\)/, at(23));
  });
  check('file:, otra app y las páginas de Orb bloqueadas y avisadas', () => {
    assert.match(at(29), /Página: Salidas/, at(29));
    assert.match(at(30), /win\.ini/, at(30));
    assert.match(at(30), /orb-prueba-inexistente/, at(30));
    assert.match(at(30), /tauri\.localhost/, at(30));
    assert.match(at(31), /solo|http/i, `orb_browser_open file: ${at(31)}`);
  });
  check('inicio de sesión HTTP cancelado sin diálogo: se ve la página 401 y el agente lo sabe', () => {
    // No sign-in prompt (no window appeared: checked below); the server's 401 page shows, as with Electron.
    assert.match(at(32), /Página: Sin acceso/, at(32));
    assert.match(at(33), /cancelled an HTTP sign-in prompt/, at(33));
  });
  check('la página no alcanza a Orb (sin IPC de Tauri ni páginas de Orb) y el agente de usuario es el de Edge', () => {
    const r = JSON.parse(/RESULTADO (\{.*?\})\n/s.exec(`${at(35)}\n`)?.[1] ?? 'null');
    assert.ok(r, at(35));
    assert.equal(r.tauri, 'undefined'); assert.equal(r.ipcGlobal, 'undefined');
    assert.match(r.ipc, /^sin acceso/); assert.ok(!/<!doctype|Orb/i.test(r.ui), `ui: ${r.ui}`);
    assert.match(r.ua, /Edg\/\d+/); assert.doesNotMatch(r.ua, /orb|tauri|wry|webview2/i);
  });
  check('la página no puede escribir el portapapeles ni abrir selectores de archivos, compartir o WebAuthn', () => {
    const r = JSON.parse(/RESULTADO (\{.*?\})\n/s.exec(`${at(37)}\n`)?.[1] ?? 'null');
    assert.ok(r, at(37));
    assert.deepEqual(r, { clipboardWrite: false, execCopy: false, fsPicker: 'undefined', share: 'undefined', credentials: false, displayMedia: false });
  });
  check('una página que inunda de eventos no congela Orb ni dispara su memoria, y el agente lo sabe', () => {
    // Stopped by Orb (blanked, events dropped or cut) or closed by the engine because it stopped answering: either way gone.
    assert.match(`${at(38)}
${at(40)}`, /stopped this page|dropped \d+ events|no leído|no responde y se ha cerrado/, `${at(38)} | ${at(40)}`.slice(0, 400));
    const sorted = [...times].sort((a, b) => a - b); const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    console.error(`app.state durante el guion (${times.length} llamadas): p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, máx ${slowest} ms; memoria privada máx de Orb.exe ${Math.round(peakMB)} MB`);
    assert.ok(slowest < 1000, `app.state tardó ${slowest} ms`);
    assert.ok(p(0.95) < 200, `app.state p95 ${p(0.95)} ms`);
    assert.ok(peakMB < 1500, `memoria privada de Orb.exe: ${Math.round(peakMB)} MB`);
  });
  if (process.argv.includes('--trampa')) {
    check('trampa: ningún selector nativo visible (archivo, color, desplegable, guardar) y el agente lo sabe', () => {
      assert.deepEqual([...new Set(trapWindows)], [], `ventanas visibles: ${[...new Set(trapWindows)]}`);
      assert.match(String(out.at(-1) ?? ''), /file chooser/, String(out.at(-1)).slice(0, 400));
    });
  }
  check('otro proceso de navegador, sin puerto de depuración ni ventanas visibles', () => {
    assert.ok(seen && !seen.error, seen?.error);
    assert.ok(seen.procs.length > 0);
    for (const p of seen.procs) assert.doesNotMatch(p.CommandLine, /remote-debugging/);
    assert.deepEqual(seen.listening, [], `puertos: ${seen.listening}`);
    assert.equal(seen.devtoolsFile, false);
    // Tao's own message window («Tao Thread Event Target», Tauri's, invisible in practice) is not one of ours.
    assert.deepEqual(seen.windows.filter((w) => !/Tao Thread Event Target/.test(w)), [], `ventanas visibles: ${seen.windows}`);
  });
  check('la interfaz de Orb no está en el navegador de los agentes (ni sus páginas en el de Orb)', () => {
    const ui = asList(JSON.parse(ps(`Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${path.join(USER_DATA, 'webview').replace(/'/g, "''")}*' -and $_.CommandLine -like '*--type=*' -eq $false } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`) || '[]'));
    for (const p of ui) assert.doesNotMatch(p.CommandLine, /navegador-agente/);
    const urls = browser.contexts().flatMap((c) => c.pages()).map((p) => p.url());
    assert.ok(!urls.some((u) => u.startsWith(B)), `páginas en el CDP de Orb: ${urls.join(' ')}`);
  });
  check('la ventanita recibe fotogramas (oculta en esta prueba) y su página los muestra', () => {
    const lines = fs.readFileSync(path.join(USER_DATA, 'pip-e2e.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.show === 'normal' && l.visible === false), 'mostrar (sin ventana visible)');
    assert.ok(lines.filter((l) => l.frame > 1000).length >= 3, `fotogramas: ${lines.filter((l) => l.frame).length}`);
    assert.ok(lines.some((l) => l.state?.agent === 'Claude'), 'estado con el agente');
  });
  const pip = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('pip.html'));
  if (pip) {
    const img = await pip.locator('[data-testid=pip] img').count().catch(() => 0);
    check('la página de la ventanita pinta la imagen', () => assert.ok(img > 0));
  } else check('la página de la ventanita existe', () => assert.fail('sin pip.html'));

  // ---- the browser process ends with its last page (the task's pages close when it is closed; here the agent's 'close')
  fs.writeFileSync(path.join(tmp, 'cerrar.json'), JSON.stringify([['orb_browser_close', {}]]));
  await call('sessions.send', { id: s.id, text: `NAVEGA_GUION ${path.join(tmp, 'cerrar.json')}` }).catch(() => {});
  const gone = await until(() => asList(agentProcesses()).length === 0, 'el proceso del navegador termina', 30000, 1000).catch(() => false);
  check('sin páginas, el navegador de los agentes termina', () => assert.ok(gone, `quedan ${asList(agentProcesses()).length}`));

  // ---- D8: a file of the disk dropped on a conversation's box arrives with its real path
  const picture = path.join(tmp, 'captura-soltada.png');
  fs.writeFileSync(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  const item = page.locator(`[data-testid=item-s${s.id}]`);
  if (!(await item.isVisible().catch(() => false))) await page.click('[data-testid=project-head-navegador]').catch(() => {});
  await item.click();
  const box = await page.waitForSelector('[data-testid=session-input]', { timeout: 15000 });
  const r = await box.boundingBox();
  const session = await page.context().newCDPSession(page);
  const data = { items: [], files: [picture], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await session.send('Input.dispatchDragEvent', { type, x: r.x + r.width / 2, y: r.y + r.height / 2, data });
  const chip = await page.waitForSelector('text=captura-soltada.png', { timeout: 10000 }).then(() => true).catch(() => false);
  check('D8: soltar un archivo en el chat de una sesión lo adjunta con su ruta real', () => assert.ok(chip));
  // The same path the page gets from WebView2 for a dropped file, through window.orb.pathForFile.
  await page.evaluate(() => {
    const zone = document.createElement('div'); zone.style.cssText = 'position:fixed;inset:0;z-index:99999'; document.body.append(zone);
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; window.__dropped = (await window.orb.pathForFile(f)) ?? 'null'; zone.remove(); });
  });
  for (const type of ['dragEnter', 'dragOver', 'drop']) await session.send('Input.dispatchDragEvent', { type, x: 200, y: 200, data });
  const real = await until(() => page.evaluate(() => window.__dropped), 'la ruta del archivo soltado', 8000).catch((e) => e.message);
  check('D8: pathForFile da la ruta real del archivo soltado', () => assert.equal(real, picture));
} catch (error) {
  results.push(['✖', 'la prueba', error.stack ?? error.message]);
} finally {
  try { await (cdp?.contexts()[0]?.pages().find((p) => /tauri\.localhost/.test(p.url())))?.evaluate(() => window.orb?.windowControls?.act('close')); } catch { /* closing */ }
  const done = await Promise.race([exited.then(() => true), wait(15000).then(() => false)]);
  if (!done) { try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  try { await cdp?.close(); } catch { /* gone */ }
  site.close();
}
for (const [mark, name, why] of results) console.log(`${mark} ${name}${why ? `\n    ${why}` : ''}`);
console.log(`\n${results.filter((r) => r[0] === '✔').length}/${results.length} · datos en ${tmp}`);
process.exitCode = results.some((r) => r[0] === '✖') ? 1 : 0;
