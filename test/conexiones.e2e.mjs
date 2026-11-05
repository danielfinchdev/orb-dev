// 3.7 (WS9): «Conexiones», headless (no window): the PC's own interface (the built renderer in headless Edge with a
// stand-in for Electron's bridge, as test/personas.e2e.mjs), a phone's browser (390x844) and the Android build (glass).
// Two users (Ana, the admin, and Leo); the linked devices, an Android phone over Wi-Fi (the cached list: adb never runs),
// Tailscale and Home Assistant are written straight into the throwaway folder (fake Tailscale, no network). Opened from
// the user menu (PC) and the menu ☰ (phone); a «Revocar» asks first. Screenshots → test-results/ws9/*.png.
// Run: npm run build && node test/conexiones.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { openDb } from '../src/core/db.mjs';

const OUT = path.join(ROOT, 'test-results', 'ws9'); fs.mkdirSync(OUT, { recursive: true });
const RENDERER = path.join(ROOT, 'src', 'renderer');
if (!fs.existsSync(path.join(RENDERER, 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-conexiones-'));
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'android', '--outDir', www, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });

const FAKE_ENV = { ORB_FAKE_TAILSCALE: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'portatil.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103'] } }), ORB_FAKE_HA: 'online' };
const engines = [];
async function engineWith(env = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port, name: 'Portátil' }, ui: { tourDone: true }, bots: { homeAssistant: { url: 'http://homeassistant.local:8123' } } });
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_BACKUP_DELAY_MS: '999999999', ...FAKE_ENV, ...env }, windowsHide: true });
  let n = 0; const pending = new Map(); const streams = new Set();
  child.on('message', (m) => {
    if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
    if (m.type === 'event') for (const res of streams) res.write(`data: ${JSON.stringify({ e: m.event, p: m.payload })}\n\n`);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params }); });
  await new Promise((resolve, reject) => { child.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); child.send({ type: 'start', home: t.home, version: '3.7.0' }); });
  await until(async () => (await call('remote.status')).running, 'acceso del Orb');
  const e = { port, call, child, t, streams }; engines.push(e); return e;
}

// The sample: Leo, the linked devices, the Android phone of the last «Buscar dispositivos» and Home Assistant's token.
async function sample(call) {
  const leo = await call('persons.create', { name: 'Leo' });
  const board = new Board(openDb());
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const dev = (id, name, kind, person, min, extra = {}) => board.run('INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, kind, role, ip, person_id, kind_ok, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, `hash-${id}`, ago(min + 600), ago(min), `pk-${id}`, kind, extra.role ?? null, extra.ip ?? null, person, extra.kindOk ?? 1, JSON.stringify(extra.meta ?? {}));
  dev('dev-ana-tab', 'Tableta del salón', 'phone', null, 50, { ip: '192.168.1.24' });
  dev('dev-ana-term', 'Terminal del portátil', 'terminal', null, 60 * 26);
  dev('dev-taller', 'PC del estudio', 'orb', null, 12, { role: 'taller', kindOk: 0, meta: { version: '3.7.0', host: 'estudio' } });
  dev('dev-leo-phone', 'Móvil de Leo', 'phone', leo.id, 8, { ip: '192.168.1.31' });
  dev('dev-leo-web', 'Navegador de Leo', 'browser', leo.id, 60 * 5);
  board.settingJson('connections.adb', { at: ago(90), devices: [{ serial: '192.168.1.40:5555', state: 'device', model: 'Android TV del salón' }] });
  board.setting('secret:ha_token', 'token-de-prueba'); board.setting('secret:ha_token_url', 'http://homeassistant.local:8123');
  return { leo };
}

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
const shots = [];
let step = 'inicio';
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`[${step}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404|426)|favicon|Failed to load resource/.test(m.text())) errors.push(`[${step}] ${m.text()}`); });
};
const shooter = (page, prefix) => async (name, target = null) => {
  const file = path.join(OUT, `${prefix}-${name}.png`);
  await page.waitForTimeout(450);
  await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important; }' }).then((h) => h.evaluate((el) => { el.id = 'no-toasts'; }));
  await (target ? page.locator(target).screenshot({ path: file }) : page.screenshot({ path: file })); shots.push(file);
  await page.evaluate(() => document.getElementById('no-toasts')?.remove());
};
const theme = async (page, dark) => { await page.evaluate((d) => { localStorage.setItem('orb.theme', d ? 'oscuro' : 'claro'); }, dark); };
const rowOf = (name) => `[data-testid=conn-row]:has-text("${name}")`;

// What the list must show (both layouts): the groups, the states and that Android is the cached one.
async function checkList(page, { admin = true } = {}) {
  await page.waitForSelector(`${rowOf('Tableta del salón')}`);
  for (const g of ['orbs', 'devices', 'bridges', 'services']) assert.equal(await page.locator(`[data-testid=conn-group-${g}]`).count(), 1, g);
  assert.equal(await page.getAttribute(rowOf('PC del estudio'), 'data-status'), 'attention', 'un Orb sin confirmar');
  assert.equal(await page.getAttribute(rowOf('Android TV del salón'), 'data-status'), 'offline', 'Android: lo guardado, adb no corre');
  assert.equal(await page.locator(`${rowOf('Android TV del salón')} [data-testid=conn-disconnectAdb]`).count(), 0, 'sin «Desconectar ADB» si adb no está en marcha');
  assert.equal(await page.getAttribute(rowOf('Tailscale'), 'data-status'), 'online');
  assert.equal(await page.getAttribute(rowOf('Home Assistant'), 'data-status'), 'online');
  if (admin) {
    assert.match(await page.textContent(`${rowOf('Móvil de Leo')} [data-testid=conn-meta]`), /Leo/);
    assert.doesNotMatch(await page.textContent('[data-testid=connections]'), /192\.168\.1\.31/, 'de Leo, solo el nombre');
  }
}

try {
  // ---------------- PC: the app's own window (renderer + bridge stand-in) ----------------
  step = 'PC: motor';
  const pc = await engineWith();
  await sample(pc.call);
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm' };
  const shim = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__call') {
      let body = ''; for await (const c of req) body += c;
      const { method, params } = JSON.parse(body);
      try { const result = await pc.call(method, params); res.end(JSON.stringify({ ok: true, result })); } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }
    if (url.pathname === '/__events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hola\n\n'); pc.streams.add(res); req.on('close', () => pc.streams.delete(res)); return; }
    if (url.pathname === '/__info') { res.end(JSON.stringify({ version: '3.7.0', home: pc.t.home, needsSetup: false, platform: 'win32', defaultBase: 'C:\\Users\\ana\\Documentos' })); return; }
    const file = path.join(RENDERER, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => shim.listen(0, '127.0.0.1', r));
  const desktopBridge = () => {
    const listeners = new Map();
    const es = new EventSource('/__events');
    es.onmessage = (m) => { const { e, p } = JSON.parse(m.data); for (const fn of listeners.get(e) ?? []) fn(p); for (const fn of listeners.get('*') ?? []) fn(e, p); };
    const post = async (url, body) => (await fetch(url, { method: 'POST', body: JSON.stringify(body ?? {}) })).json();
    window.orb = {
      call: async (method, params) => { const r = await post('/__call', { method, params: params ?? {} }); if (!r.ok) throw new Error(r.error); return r.result; },
      on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
      info: async () => (await fetch('/__info')).json(), setup: async () => ({}),
      pickFolder: async () => null, pickImages: async () => [], pickFiles: async () => null, pickProgram: async () => null,
      openPath: async () => {}, openExternal: async () => {}, showBrowser: async () => {}, zoom: async () => 1, openTerminal: async () => 'terminal',
      editors: async () => ({}), moreApps: async () => [], pathForFile: () => null,
      update: { get: async () => ({ state: 'idle' }), check: async () => null, download: async () => null, install: async () => null },
      feedback: { capture: async () => null, images: async () => [], send: async () => true }
    };
  };
  const pcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
  await pcCtx.addInitScript(desktopBridge);
  const page = await pcCtx.newPage(); watch(page);
  await page.goto(`http://127.0.0.1:${shim.address().port}/`);
  await page.waitForSelector('[data-testid=person-menu]', { timeout: 30000 });
  for (const dark of [false, true]) {
    const scheme = dark ? 'dark' : 'light';
    const shot = shooter(page, `pc-${scheme}`);
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await page.reload(); // the PC follows the system's theme by default
    step = `PC ${scheme}: menú del usuario`;
    await page.waitForSelector('[data-testid=person-menu]');
    await page.click('[data-testid=person-menu]');
    await page.waitForSelector('[data-testid=person-connections]');
    await shot('01-menu-usuario');
    await page.click('[data-testid=person-connections]');
    step = `PC ${scheme}: Ajustes › Magic Link › Conexiones`;
    await page.waitForSelector('[data-testid=settings-dialog] [data-testid=connections]');
    assert.equal(await page.getAttribute('[data-testid=settings-sub-conexiones]', 'aria-current'), 'location', 'la parte Conexiones, marcada');
    await checkList(page);
    await page.locator('[data-testid=connections]').scrollIntoViewIfNeeded();
    await shot('02-conexiones');
    await shot('03-lista', '[data-testid=connections]');
    step = `PC ${scheme}: revocar pide confirmación`;
    await page.click(`${rowOf('Móvil de Leo')} [data-testid=conn-revoke]`);
    await page.waitForSelector('[role=dialog]:has-text("¿Revocar el acceso de «Móvil de Leo»?")');
    await shot('04-confirmar');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await page.locator(rowOf('Móvil de Leo')).count(), 1, 'cancelado: sigue ahí');
    await page.keyboard.press('Escape');
  }
  // Revoking for real: the row goes (connections:changed or the answer reloads it).
  step = 'PC: revocar';
  await page.reload(); await page.waitForSelector('[data-testid=person-menu]');
  await page.click('[data-testid=person-menu]'); await page.click('[data-testid=person-connections]');
  await page.waitForSelector(rowOf('Navegador de Leo'));
  await page.click(`${rowOf('Navegador de Leo')} [data-testid=conn-revoke]`);
  await page.click('[role=dialog] button:has-text("Revocar")');
  await until(async () => (await page.locator(rowOf('Navegador de Leo')).count()) === 0, 'revocado', 10000);
  await pcCtx.close();
  shim.close();

  // ---------------- phones: the web (390x844) and the Android build (glass) ----------------
  for (const [kind, env] of [['movil', {}], ['glass', { ORB_RENDERER: www }]]) {
    step = `${kind}: motor`;
    const ph = await engineWith(env);
    await sample(ph.call);
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const p = await pctx.newPage(); watch(p);
    if (kind === 'glass') { const cdp = await pctx.newCDPSession(p); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] }); }
    const { url } = await ph.call('remote.pair');
    await p.goto(`http://127.0.0.1:${ph.port}/${new URL(url).hash}`);
    await p.waitForSelector('[data-testid=nav-menu]', { timeout: 30000 });
    for (const dark of kind === 'glass' ? [false, true] : [false]) {
      const scheme = dark ? 'dark' : 'light';
      const shot = shooter(p, `${kind}-${scheme}`);
      await theme(p, dark);
      await p.evaluate(() => localStorage.removeItem('orb.route'));
      await p.reload();
      step = `${kind} ${scheme}: menú ☰`;
      await p.click('[data-testid=nav-menu]:visible');
      await p.waitForSelector('[data-testid=mobile-menu] [data-testid=nav-connections]');
      await p.waitForTimeout(350);
      await shot('01-menu');
      await p.click('[data-testid=mobile-menu] [data-testid=nav-connections]');
      step = `${kind} ${scheme}: Conexiones`;
      await p.waitForSelector('[data-testid=connections]');
      await checkList(p);
      // the browser looking is online (it is linked as a browser)
      await until(async () => (await p.locator('[data-testid=conn-group-devices] [data-testid=conn-row][data-status=online]').count()) >= 1, 'este navegador, conectado', 10000);
      assert.doesNotMatch(await p.textContent(`${rowOf('Tableta del salón')} [data-testid=conn-meta]`), /Ana/, 'lo propio, sin el nombre');
      await shot('02-conexiones');
      await p.mouse.wheel(0, 900); await p.waitForTimeout(300);
      await shot('03-conexiones-abajo');
      step = `${kind} ${scheme}: confirmar`;
      await p.click(`${rowOf('Terminal del portátil')} [data-testid=conn-revoke]`);
      await p.waitForSelector('[role=dialog]:has-text("¿Revocar el acceso de «Terminal del portátil»?")');
      await p.waitForTimeout(400);
      await shot('04-confirmar');
      await p.keyboard.press('Escape');
    }
    await pctx.close();
  }
  assert.deepEqual(errors, [], `errores: ${errors.join(' | ')}`);
  console.log(shots.join('\n'));
  console.log(`✔ conexiones: ${shots.length} capturas en test-results/ws9`);
} catch (error) {
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(OUT, 'fallo.png') }).catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack ?? error}\nerrores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  for (const e of engines) e.child.send({ type: 'shutdown' });
  setTimeout(() => { for (const e of engines) e.t.cleanup(); fs.rmSync(www, { recursive: true, force: true }); process.exit(); }, 800);
}
