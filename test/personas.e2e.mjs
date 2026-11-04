// 3.6 «Personas», end to end without any window: the PC's own interface (the built renderer in headless Edge, with a
// stand-in for Electron's bridge that talks to the engine like the app does), Leo's phone and Leo's browser (linked with
// a QR made «para Leo») and Leo's terminal client. Ana (the admin) goes through the welcome wizard (adds Leo, applies
// «Casa»), has her own bot, project and chat; Leo, on every channel, sees nothing of hers. Also the person
// menu, switching with a PIN, the engine's lock, Ajustes › Personas / Mi perfil / Datos, «¿Para quién?», the share dialog
// and «Prestar a…». Screenshots: test-results/personas-*.png. The engine runs with the fake agents in a throwaway folder.
// Run: npm run build && node test/personas.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fork, spawn } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const RENDERER = path.join(ROOT, 'src', 'renderer');
if (!fs.existsSync(path.join(RENDERER, 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ mobile: { enabled: true, port, name: 'Portátil' } });
const termDir = fs.mkdtempSync(path.join(t.base, 'terminal-'));
const engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_BACKUP_DELAY_MS: '999999999' }, windowsHide: true });
let n = 0; const pending = new Map(); const streams = new Set();
engine.on('message', (m) => {
  if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
  if (m.type === 'event') for (const res of streams) res.write(`data: ${JSON.stringify({ e: m.event, p: m.payload })}\n\n`);
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
await until(async () => (await call('remote.status')).running, 'acceso del Orb');

// ---- the PC's window: the renderer served here, and Electron's bridge (preload.cjs) as fetch calls to the engine.
let setupDone = false;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm' };
const shim = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__call') {
    let body = ''; for await (const c of req) body += c;
    const { method, params } = JSON.parse(body);
    try { const result = await call(method, params); res.end(JSON.stringify({ ok: true, result })); } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
    return;
  }
  if (url.pathname === '/__events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hola\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return; }
  if (url.pathname === '/__info') { res.end(JSON.stringify({ version: 'test', home: setupDone ? t.home : null, needsSetup: !setupDone, platform: 'linux', defaultBase: 'C:\\Users\\ana\\Documentos' })); return; }
  // createHome() of the real app keeps the name in the settings (userName): the same here.
  if (url.pathname === '/__setup') { let body = ''; for await (const c of req) body += c; const { userName } = JSON.parse(body || '{}'); if (userName) await call('config.save', { patch: { userName } }); setupDone = true; res.end('{}'); return; }
  const file = path.join(RENDERER, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => shim.listen(0, '127.0.0.1', r));
const pcUrl = `http://127.0.0.1:${shim.address().port}/`;
const desktopBridge = () => {
  const listeners = new Map();
  const es = new EventSource('/__events');
  es.onmessage = (m) => { const { e, p } = JSON.parse(m.data); for (const fn of listeners.get(e) ?? []) fn(p); for (const fn of listeners.get('*') ?? []) fn(e, p); };
  const post = async (url, body) => (await fetch(url, { method: 'POST', body: JSON.stringify(body ?? {}) })).json();
  window.orb = {
    call: async (method, params) => { const r = await post('/__call', { method, params: params ?? {} }); if (!r.ok) throw new Error(r.error); return r.result; },
    on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    info: async () => (await fetch('/__info')).json(),
    setup: async (p) => post('/__setup', p),
    pickFolder: async () => 'C:\\Users\\ana\\Documentos', pickImages: async () => [], pickFiles: async () => null, pickProgram: async () => null,
    openPath: async () => {}, openExternal: async () => {}, showBrowser: async () => {}, zoom: async () => 1, openTerminal: async () => 'terminal',
    editors: async () => ({}), moreApps: async () => [], pathForFile: () => null,
    update: { get: async () => ({ state: 'idle' }), check: async () => null, download: async () => null, install: async () => null },
    feedback: { capture: async () => null, images: async () => [], send: async () => true }
  };
};

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
const watch = (page, who) => { page.on('pageerror', (e) => errors.push(`${who}: ${e.message} ${String(e.stack).split(String.fromCharCode(10)).slice(1, 4).join(' / ')}`)); page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404|426)|Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`); }); };
const shots = [];
const shotOf = (page) => async (name) => { const file = path.join(OUT, `personas-${name}.png`); await page.waitForTimeout(350); await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important; }' }); await page.screenshot({ path: file }); shots.push(file); };
// Ana's things: none of these words may reach Leo, on any channel (also the bots «Casa» made for her in the wizard).
const CASA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'core', 'templates', 'es', 'casa.json'), 'utf8')).bots.map((b) => b.name);
const ANA = ['ana-web-secreta', 'Diario de Ana', 'Mensaje privado de Ana', 'Regar las plantas de Ana', ...CASA];
const leaks = (text) => ANA.filter((w) => String(text).includes(w));
const p2 = (x) => String(x).padStart(2, '0');
const at = (d, h, m) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(h)}:${p2(m)}`;

let step = 'inicio';
const pcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
await pcCtx.addInitScript(desktopBridge);
const pc = await pcCtx.newPage(); watch(pc, 'pc');
const shot = shotOf(pc);
// The person menu (Radix opens it on pointer down; after Escape a second click may only move the focus: Enter then).
const menu = async (item) => {
  await pc.click('[data-testid=person-menu]');
  if (!(await pc.locator(`[data-testid=${item}]`).isVisible().catch(() => false))) { await pc.waitForTimeout(300); if (!(await pc.locator(`[data-testid=${item}]`).isVisible())) { await pc.focus('[data-testid=person-menu]'); await pc.keyboard.press('Enter'); } }
  await pc.click(`[data-testid=${item}]`);
};
try {
  // ---- 1. the welcome wizard: three screens. Her name, «¿Lo usará alguien más?» (Ana adds Leo), «Casa».
  step = 'asistente';
  await pc.goto(pcUrl);
  await pc.waitForSelector('[data-testid=wizard-nombre]');
  await pc.fill('[data-testid=setup-name]', 'Ana');
  await shot('01-asistente-nombre');
  await pc.click('[data-testid=setup-create]');
  await pc.waitForSelector('[data-testid=wizard-quien]');
  await pc.click('[data-testid=wizard-more-people]');
  await pc.fill('[data-testid=wizard-person-0]', 'Leo');
  await shot('02-asistente-quien');
  await pc.click('[data-testid=wizard-next]');
  await pc.waitForSelector('[data-testid=wizard-para]');
  await shot('03-asistente-para');
  await pc.click('[data-testid=wizard-use-home]');
  await pc.waitForSelector('[data-testid=chat-input]', { timeout: 30000 });
  const people = await call('persons.list');
  const leo = people.find((p) => p.name === 'Leo'); const ana = people.find((p) => p.role === 'owner');
  assert.ok(leo && ana, 'Leo creado desde el asistente');
  assert.equal(ana.name, 'Ana', 'el nombre de la primera pantalla es el del admin');
  const botNames = (await call('bots.list')).bots.map((b) => b.name);
  assert.ok(CASA.every((n) => botNames.includes(n)), `la plantilla «Casa», tal cual: ${botNames.join(', ')}`);
  assert.ok((await call('backup.status')).enabled, 'copias activas sin preguntar');

  // ---- 2. Ana's own things (this window is Ana's).
  step = 'cosas de Ana';
  await call('config.save', { patch: { ui: { tourDone: true } } }); // the guided tour, seen
  await call('projects.create', { name: 'ana-web-secreta' });
  const diario = await call('bots.create', { name: 'Diario de Ana', icon: '📓', role_text: 'Llevas mi diario.', tools: ['recordatorios'] });
  await call('bots.reminders.create', { id: diario.id, text: 'Regar las plantas de Ana', when: at(new Date(Date.now() + 26 * 3_600_000), 10, 0) });
  await call('chat.send', { text: 'Mensaje privado de Ana' });
  await until(async () => (await call('conversations.list')).length > 0, 'conversación de Ana');
  await pc.reload(); await pc.waitForSelector('[data-testid=person-menu]');

  step = 'menú de usuario';
  // Nothing of the user next to the robot at the top; the user is at the bottom of the sidebar.
  assert.equal(await pc.locator('.side-band [data-testid=person-menu]').count(), 0, 'nada del usuario en la cabecera');
  assert.match(await pc.textContent('[data-testid=sidebar-footer] [data-testid=person-menu]'), /Ana/);
  await pc.click('[data-testid=person-menu]');
  await pc.waitForSelector('[data-testid=person-switch]');
  await shot('06-menu-usuario');
  await pc.keyboard.press('Escape');

  step = 'ajustes';
  await menu('person-profile');
  await pc.waitForSelector('[data-testid=profile-card]');
  await shot('07-mi-perfil');
  // 3.6: «Mi perfil» opens on its own (it is not a section of Ajustes); Usuarios is inside Magic Link.
  assert.equal(await pc.locator('[data-testid=profile-dialog] [data-testid^=settings-nav-]').count(), 0, 'Mi perfil, sin las secciones de Ajustes');
  await pc.keyboard.press('Escape');
  await pc.click('[data-testid=nav-settings]');
  await pc.waitForSelector('[data-testid=settings-dialog]');
  assert.deepEqual(await pc.locator('[data-testid^=settings-nav-]').evaluateAll((els) => els.map((e) => e.dataset.testid.slice(13))), ['general', 'magiclink', 'agentes', 'datos', 'avanzado', 'acerca'], 'seis secciones');
  await shot('08a-ajustes-secciones');
  await pc.click('[data-testid=settings-nav-magiclink]');
  await pc.waitForSelector('[data-testid=settings-sub-usuarios]');
  await pc.waitForSelector('[data-testid=person-row-Leo]');
  const row = await pc.textContent('[data-testid=person-row-Leo]');
  assert.ok(!leaks(row).length, 'Ajustes › Magic Link › Usuarios: solo números');
  assert.doesNotMatch(row, /turno|Dueño|1 (bots|chats|proyectos|grupos)/, 'sin jerga ni plurales mal');
  await shot('08-personas');
  await pc.click('[data-testid=settings-nav-datos]');
  await pc.waitForSelector('[data-testid=backups-card]');
  await shot('09-datos');
  await pc.click('[data-testid=settings-nav-magiclink]');
  await pc.waitForSelector('[data-testid=link-for-who]');
  await pc.click('[data-testid=link-for-who]'); await pc.getByRole('option', { name: 'Leo' }).click();
  await pc.click('[data-testid=link-make]');
  await pc.waitForSelector('[data-testid=link-qr]');
  await shot('10-para-quien');
  await pc.keyboard.press('Escape');

  step = 'compartir y prestar';
  await pc.click('[data-testid=mode-bots]');
  await pc.click('[data-testid=nav-bots]');
  await pc.click('[data-testid="bot-edit-Diario de Ana"]');
  await pc.waitForSelector('[data-testid=bot-spend]');
  await pc.click('[data-testid=share-bot]');
  await pc.waitForSelector('[data-testid=share-row-Leo]');
  await shot('11-compartir');
  await pc.keyboard.press('Escape');
  await pc.click('[data-testid=mode-orb]');
  if (!(await pc.locator('[data-testid=nav-agents]:visible').count())) await pc.click('[data-testid=sidebar-footer-toggle]');
  await pc.click('[data-testid=nav-agents]');
  await pc.waitForSelector('[data-testid=usage-by-person]');
  const lend = pc.locator('[data-testid^=lend-]').filter({ hasText: 'Prestar' }).first();
  if (await lend.count()) { await lend.click(); await pc.waitForSelector('[data-testid=lend-terms]'); await shot('12-prestar'); await pc.keyboard.press('Escape'); }
  else await shot('12-uso');

  // ---- 3. Leo sits at this PC (no PIN yet), gets his own things and a PIN; he sees nothing of Ana.
  step = 'cambiar a Leo';
  await call('persons.setCaps', { id: leo.id, caps: { dev: true } }); // Ana lets Leo program (Ajustes › Usuarios › Permisos)
  await menu('person-switch');
  await pc.waitForSelector('[data-testid=lock-screen]');
  await pc.waitForSelector('[data-testid=lock-person-Leo][aria-checked=true]');
  await shot('13-cambiar-usuario');
  await pc.click('[data-testid=lock-unlock]');
  await until(async () => (await call('persons.me')).person?.id === leo.id, 'la ventana es de Leo');
  // The home greeting says Leo, never Ana (the phrase changes each time: some have no name).
  step = 'saludo de Leo';
  await pc.waitForSelector('[data-testid=person-menu-name] >> text=Leo');
  let greeting = '';
  for (let i = 0; i < 12 && !greeting.includes('Leo'); i++) {
    if (i) { await pc.reload(); await pc.waitForSelector('[data-testid=chat-input]'); }
    await pc.click('[data-testid=new-conversation]');
    greeting = await pc.textContent('[data-testid=chat-greeting]');
    assert.doesNotMatch(greeting, /Ana/, 'el saludo de Leo no dice Ana');
  }
  assert.match(greeting, /Leo/, 'el saludo nombra a Leo');
  assert.equal((await pc.evaluate(() => window.orb.call('app.state'))).config.userName, 'Leo', 'userName de la ventana de Leo');
  await shot('13b-saludo-leo');
  await call('persons.setPin', { pin: '2468' });
  await call('projects.create', { name: 'leo-deberes' });
  await call('bots.create', { name: 'Agenda de Leo', icon: '📅', role_text: 'Mi agenda.' });
  await call('chat.send', { text: 'Hola soy Leo' });
  await pc.reload(); await pc.waitForSelector('[data-testid=chat-input]');
  await pc.waitForTimeout(800);
  assert.deepEqual(leaks(await pc.textContent('body')), [], 'el PC como Leo');
  for (const m of ['projects.list', 'conversations.list', 'bots.list', 'tasks.list', 'bots.reminders.list', 'app.state', 'shares.list', 'usage.get']) {
    const r = JSON.stringify(await pc.evaluate((x) => window.orb.call(x).catch((e) => ({ error: e.message })), m));
    assert.deepEqual(leaks(r), [], `${m} en el PC como Leo`);
  }
  await shot('13c-pc-leo');
  await pc.click('[data-testid=mode-bots]'); await pc.click('[data-testid=nav-bots]');
  await pc.waitForSelector('[data-testid="bot-Agenda de Leo"]');
  assert.deepEqual(leaks(await pc.textContent('body')), [], 'los bots de Leo');
  await shot('14-pc-leo-bots');
  await pc.click('[data-testid=mode-orb]');

  step = 'bloqueo';
  await menu('person-lock');
  await pc.waitForSelector('[data-testid=lock-screen]');
  await assert.rejects(call('projects.list'), /bloquead/i, 'el motor no contesta con la ventana bloqueada');
  assert.deepEqual(leaks(await pc.textContent('body')), []);
  await shot('15-bloqueo');
  await pc.click('[data-testid=lock-person-Ana]');
  await pc.click('[data-testid=lock-unlock]');
  await pc.waitForSelector('[data-testid=chat-input]');
  await until(async () => (await call('persons.me')).person?.id === ana.id, 'vuelve Ana');
  step = 'cambiar con PIN';
  await menu('person-switch');
  await pc.waitForSelector('[data-testid=lock-pin]');
  await pc.fill('[data-testid=lock-pin]', '1111'); await pc.keyboard.press('Enter');
  await pc.waitForSelector('[data-testid=lock-error]');
  await assert.rejects(call('projects.list'), /bloquead/i, 'un PIN mal no entra');
  await shot('16-pin');
  await pc.fill('[data-testid=lock-pin]', '2468'); await pc.keyboard.press('Enter');
  await until(async () => (await call('persons.me')).person?.id === leo.id, 'con su PIN, Leo');
  await call('persons.switch', { id: ana.id });
  await pc.waitForTimeout(500);

  // ---- 4. Leo's phone (a QR «para Leo»): its PIN first, Leo at the top of «Más», nothing of Ana.
  step = 'móvil de Leo';
  const qr = await call('link.qr', { person: leo.id });
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
  const phone = await phoneCtx.newPage(); watch(phone, 'móvil');
  const pshot = shotOf(phone);
  await phone.goto(`http://127.0.0.1:${port}/${new URL(qr.url).hash}`);
  await phone.waitForSelector('[data-testid=phone-lock]');
  await pshot('17-movil-pin');
  await phone.fill('[data-testid=lock-pin]', '2468'); await phone.click('[data-testid=lock-unlock]');
  await phone.waitForSelector('[data-testid=mobile-tabs]');
  const dev = (await call('link.devices')).find((d) => d.person === leo.id);
  assert.ok(dev, 'el móvil es de Leo');
  await phone.click('[data-testid=nav-chats]'); await phone.waitForTimeout(500);
  assert.deepEqual(leaks(await phone.textContent('body')), [], 'los chats del móvil de Leo');
  await pshot('18-movil-leo');
  await phone.click('[data-testid=nav-more]');
  await phone.waitForSelector('[data-testid=person-card]');
  assert.equal((await phone.textContent('[data-testid=person-card-name]')).trim(), 'Leo');
  await pshot('18b-movil-mas');
  await phone.click('[data-testid=nav-profile]');
  await phone.waitForSelector('[data-testid=profile-card]');
  await pshot('19-movil-perfil');
  await phone.click('[data-testid=mode-bots]'); await phone.click('[data-testid=nav-bots]');
  await phone.waitForSelector('[data-testid="bot-Agenda de Leo"]');
  assert.deepEqual(leaks(await phone.textContent('body')), [], 'los bots del móvil de Leo');
  for (const m of ['projects.list', 'conversations.list', 'bots.list', 'tasks.list', 'bots.reminders.list', 'app.state', 'link.status', 'shares.list']) {
    const r = JSON.stringify(await phone.evaluate((x) => window.orb.call(x).catch((e) => ({ error: e.message })), m));
    assert.deepEqual(leaks(r), [], `${m} desde el móvil de Leo`);
  }
  // Leo cannot make a QR for Ana nor read her bot.
  await assert.rejects(phone.evaluate((id) => window.orb.call('bots.get', { id }), diario.id), 'el bot de Ana');

  // ---- 5. Leo's browser on a computer.
  step = 'navegador de Leo';
  const qb = await call('link.qr', { person: leo.id, device: 'browser' });
  const webCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
  const web = await webCtx.newPage(); watch(web, 'navegador');
  await web.goto(`http://127.0.0.1:${port}/${new URL(qb.url).hash}`);
  await web.waitForSelector('[data-testid=phone-lock]');
  await web.fill('[data-testid=lock-pin]', '2468'); await web.click('[data-testid=lock-unlock]');
  await web.waitForSelector('[data-testid=chat-input]');
  await web.waitForTimeout(800);
  assert.deepEqual(leaks(await web.textContent('body')), [], 'el navegador de Leo');
  await shotOf(web)('20-navegador-leo');

  // ---- 6. Leo's terminal client.
  step = 'terminal de Leo';
  const qt = await call('link.qr', { person: leo.id, device: 'terminal' });
  const cli = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'terminal', 'orb-cli.mjs'), ...args], { env: { ...process.env, ORB_TERMINAL_HOME: termDir, ORB_LANG: 'es', NO_COLOR: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`tiempo agotado: ${args.join(' ')}\n${out}`)); }, 60_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin.end();
  });
  const linked = await cli(['enlazar', qt.code, `127.0.0.1:${port}`]);
  assert.equal(linked.code, 0, linked.out);
  // (a message would wait for an answer: Leo has no account of his own nor a loan, so his assistant does not run)
  for (const args of [['estado', '--json'], ['estado'], ['dispositivos'], ['enlaces']]) {
    const r = await cli(args);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(leaks(r.out), [], `orb ${args.join(' ')}`);
  }
  assert.ok((await call('link.devices')).some((d) => d.person === leo.id && d.kind === 'terminal'), 'la terminal es de Leo');

  assert.deepEqual(errors, [], `errores: ${errors.join(' | ')}`);
  console.log(`✔ personas de punta a punta (PC, móvil, navegador y terminal de Leo sin nada de Ana):\n${shots.join('\n')}`);
} catch (error) {
  await pc.screenshot({ path: path.join(OUT, 'personas-fallo.png') }).catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack}\nerrores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  shim.close();
  engine.send({ type: 'shutdown' });
  setTimeout(() => { t.cleanup(); process.exit(); }, 800);
}
