// 3.6: a visual inventory of Orb for design reviews: every screen and important state, at PC size (1440x900) and phone
// size (390x844), in light and dark, with the default theme and the other visual themes (skins) → test-results/tour/
// NNN-area-screen-state-theme-device.png plus test-results/tour/INDEX.md (one line per picture and its component).
// No window ever opens: headless Edge (Chromium on Linux). The engine runs with the fake agents in a throwaway folder and
// serves on loopback; three kinds of "device" look at it:
//   pc    the PC's own window: the built renderer served here, with a stand-in for Electron's bridge (as personas.e2e).
//   web   a computer's browser linked with a QR (PC layout, linked-device features only).
//   phone a phone's browser linked with a QR (touch, 390x844).
// First the welcome wizard and a fresh, empty Orb; then sample data (generic: Ana, Leo, «mi-web»…) and every screen again.
// A screen that cannot be reached is listed at the end of INDEX.md with the reason; the run goes on.
// Run: npm run build && node test/tour.e2e.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results', 'tour');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|md)$/.test(f)) fs.rmSync(path.join(OUT, f));
const RENDERER = path.join(ROOT, 'src', 'renderer');
if (!fs.existsSync(path.join(RENDERER, 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
const SKINS = ['orb', 'vaporwave', 'retro', 'profesional', 'nube']; // src/core/appearance.mjs
const ONLY = process.env.TOUR_ONLY ? new Set(process.env.TOUR_ONLY.split(',')) : null; // e.g. TOUR_ONLY=pc,phone (debugging)

// ---- the engine
const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ mobile: { enabled: true, port, name: 'Portátil' } });
const engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_BACKUP_DELAY_MS: '999999999' }, windowsHide: true });
let n = 0; const pending = new Map(); const streams = new Set();
engine.on('message', (m) => {
  if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))); }
  if (m.type === 'event') for (const res of streams) res.write(`data: ${JSON.stringify({ e: m.event, p: m.payload })}\n\n`);
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: '3.6.0' }); });
await until(async () => (await call('remote.status')).running, 'acceso del Orb');

// ---- the PC's window: the renderer served here and Electron's bridge (src/main/preload.cjs) as calls to this process.
let needsSetup = true;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const shim = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__call') {
    let body = ''; for await (const c of req) body += c;
    const { method, params } = JSON.parse(body);
    try { const result = await call(method, params); res.end(JSON.stringify({ ok: true, result: result ?? null })); } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
    return;
  }
  if (url.pathname === '/__events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hola\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return; }
  if (url.pathname === '/__info') { res.end(JSON.stringify({ version: '3.6.0', home: needsSetup ? null : t.home, needsSetup, platform: 'win32', defaultBase: 'C:\\Users\\ana\\Documents' })); return; }
  if (url.pathname === '/__setup') { needsSetup = false; res.end('{}'); return; }
  const file = path.join(RENDERER, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => shim.listen(0, '127.0.0.1', r));
const pcUrl = `http://127.0.0.1:${shim.address().port}/`;
const desktopBridge = () => {
  const listeners = new Map();
  const fire = (e, p) => { for (const fn of listeners.get(e) ?? []) fn(p); for (const fn of listeners.get('*') ?? []) fn(e, p); };
  const es = new EventSource('/__events');
  es.onmessage = (m) => { const { e, p } = JSON.parse(m.data); fire(e, p); };
  const post = async (url, body) => (await fetch(url, { method: 'POST', body: JSON.stringify(body ?? {}) })).json();
  window.__orbFire = fire; // the test moves around like the engine does (ui:navigate)
  const update = () => { try { return JSON.parse(localStorage.getItem('tour.update') || 'null') ?? { state: 'idle' }; } catch { return { state: 'idle' }; } };
  window.orb = {
    call: async (method, params) => { const r = await post('/__call', { method, params: params ?? {} }); if (!r.ok) throw new Error(r.error); return r.result; },
    on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
    info: async () => (await fetch('/__info')).json(),
    setup: async () => post('/__setup'),
    light: false,
    switchHome: async () => null,
    pickFolder: async () => 'C:\\Users\\ana\\Documents', pickImages: async () => [], pickFiles: async () => null, pickProgram: async () => null,
    openPath: async () => {}, openExternal: async () => {}, showBrowser: async () => ({ tabs: [] }), zoom: async () => 1, openTerminal: async () => 'Windows Terminal',
    windowControls: { act: async () => ({ maximized: false }), onState: () => () => {} },
    editors: async () => ({ cursor: false, vscode: true }), openIn: async () => null, runAction: async () => null, moreApps: async () => [], pathForFile: () => null,
    update: { get: async () => update(), check: async () => update(), download: async () => null, install: async () => null },
    feedback: { capture: async () => null, images: async () => [], send: async () => true }
  };
};

// ---- the browser
const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
const meta = new Map(); // page → { device, dark, skin }
const hideToasts = () => { const s = document.createElement('style'); s.textContent = 'html.tour-no-toasts [data-sonner-toaster] { visibility: hidden !important; }'; const on = () => { document.head.append(s); document.documentElement.classList.add('tour-no-toasts'); }; if (document.head) on(); else document.addEventListener('DOMContentLoaded', on); };
async function newPage(device, { bridge = false } = {}) {
  const phone = device === 'phone';
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES', timezoneId: 'Europe/Madrid' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  if (bridge) await ctx.addInitScript(desktopBridge);
  await ctx.addInitScript(hideToasts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`${device}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404|426)|Failed to load resource|favicon|esm\.sh\/@excalidraw/.test(m.text())) errors.push(`${device}: ${m.text().slice(0, 300)}`); });
  meta.set(page, { device, dark: false, skin: 'orb' });
  return page;
}

// ---- pictures and the index
const index = []; const misses = [];
let seq = 0;
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const themeOf = (m) => `${m.skin === 'orb' ? '' : `${m.skin}-`}${m.dark ? 'dark' : 'light'}`;
// One picture: name, description and the component it shows. scroll: also the rest of a long screen (its biggest scroller).
async function shot(page, { area, screen, state = 'default', src, desc, toasts = false, scroll = false }) {
  const m = meta.get(page);
  await page.waitForTimeout(450);
  await page.evaluate((on) => document.documentElement.classList.toggle('tour-no-toasts', !on), toasts).catch(() => {});
  const take = async (st, d) => {
    const file = `${String(++seq).padStart(3, '0')}-${slug(area)}-${slug(screen)}-${slug(st)}-${themeOf(m)}-${m.device}.png`;
    await page.screenshot({ path: path.join(OUT, file), animations: 'disabled', caret: 'hide' });
    index.push({ file, desc: d, src });
  };
  await take(state, desc);
  if (!scroll) return;
  for (let i = 2; i <= 4; i++) {
    const moved = await page.evaluate((first) => {
      let el = first ? null : window.__tourScrolled;
      if (!el) {
        // Over a dialog, its own scroller (not the screen behind it); else the biggest one on screen.
        const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')].filter((e) => e.getClientRects().length);
        const root = dialogs.at(-1) ?? document;
        const all = [...root.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 60 && e.clientHeight > 150 && e.getClientRects().length; });
        el = all.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0];
      }
      window.__tourScrolled = el ?? null;
      if (!el || el.scrollTop + el.clientHeight >= el.scrollHeight - 4) return false;
      el.scrollTop += Math.round(el.clientHeight * 0.85); return true;
    }, i === 2);
    if (!moved) break;
    await page.waitForTimeout(250);
    await take(`${state}-p${i}`, `${desc} (scrolled, part ${i})`);
  }
  await page.evaluate(() => { if (window.__tourScrolled) window.__tourScrolled.scrollTop = 0; window.__tourScrolled = null; });
}
// A step that may fail without stopping the tour: noted as not reached.
async function attempt(page, label, fn) {
  try { await fn(); }
  catch (e) {
    const m = meta.get(page);
    misses.push(`${label} (${m ? `${themeOf(m)}, ${m.device}` : '-'}): ${String(e.message).split('\n')[0].slice(0, 200)}`);
    console.warn(`· no se pudo: ${label}: ${String(e.message).split('\n')[0]}`);
    for (let i = 0; i < 2; i++) await page.keyboard.press('Escape').catch(() => {});
  }
}
const quiet = (p) => p.catch(() => null);
const p2 = (x) => String(x).padStart(2, '0');
const at = (d, h, m) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(h)}:${p2(m)}`;

// ---- moving around
// 3.6: on the phone a conversation is a full screen of its own (a back arrow, no tabs).
const READY = '[data-testid=sidebar-footer], [data-testid=mobile-tabs], [data-testid=chat-back], [data-testid=lock-screen], [data-testid=phone-lock]';
async function loaded(page) { await page.waitForSelector(READY, { timeout: 20000 }); await page.waitForTimeout(500); }
// PC window: the engine's own ui:navigate. Linked devices: the route the page restores on load (localStorage orb.route).
async function nav(page, route) {
  const m = meta.get(page);
  if (m.device === 'pc') {
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate((r) => window.__orbFire('ui:navigate', r), route);
    await page.waitForTimeout(600);
    return;
  }
  await page.evaluate((r) => { localStorage.setItem('orb.route', JSON.stringify(r)); }, route);
  await page.reload(); await loaded(page);
}
async function setLook(page, { dark, skin = 'orb' }) {
  const m = meta.get(page);
  if (m.device === 'pc') await call('config.save', { patch: { ui: { theme: dark ? 'oscuro' : 'claro', skin } } });
  else await page.evaluate((d) => localStorage.setItem('orb.theme', d ? 'oscuro' : 'claro'), dark);
  m.dark = dark; m.skin = m.device === 'pc' ? skin : 'orb';
  await page.reload(); await loaded(page);
}
const menuItem = async (page, item) => {
  await page.click('[data-testid=person-menu]:visible');
  if (!(await page.locator(`[data-testid=${item}]`).isVisible().catch(() => false))) { await page.waitForTimeout(300); if (!(await page.locator(`[data-testid=${item}]`).isVisible())) { await page.focus('[data-testid=person-menu]:visible'); await page.keyboard.press('Enter'); } }
  await page.click(`[data-testid=${item}]`);
};
const dialog = (page) => page.waitForSelector('[role=dialog], [role=alertdialog]', { state: 'visible' });
const footerOpen = async (page) => { if ((await page.locator('[data-testid=sidebar-footer]').getAttribute('data-open')) !== 'true') await page.click('[data-testid=sidebar-footer-toggle]'); };

// What each view is (route view → [label, component]).
const SRC = {
  chat: ['Orb chat', 'src/ui/views/chat.jsx'], session: ['direct conversation with an agent', 'src/ui/views/session.jsx'],
  tasks: ['Tasks', 'src/ui/views/tasks.jsx'], projects: ['Projects', 'src/ui/views/projects.jsx'], agents: ['Agents (accounts, usage)', 'src/ui/views/agents.jsx'],
  logs: ['Bitácoras (project logs)', 'src/ui/views/memories.jsx + logs.jsx'], activity: ['Activity', 'src/ui/views/memories.jsx + activity.jsx'],
  schedules: ['Scheduled tasks', 'src/ui/views/schedules.jsx'], phone: ['This phone / mobile access', 'src/ui/views/settings.jsx (PhoneView)'],
  tutorials: ['Tutorials and help', 'src/ui/views/tutorials.jsx'], board: ['Whiteboard (Pizarra)', 'src/ui/views/whiteboard.jsx'],
  expert: ['God mode (expert)', 'src/ui/views/expert.jsx'], monitor: ['PC status / Opti', 'src/ui/views/monitor.jsx'],
  link: ['Magic Link', 'src/ui/views/magic-link.jsx'], profile: ['My profile', 'src/ui/views/persons.jsx (ProfileView)'],
  chats: ['Chats list', 'src/ui/main.jsx (ChatsView) + components/sidebar.jsx'], more: ['More menu', 'src/ui/components/mobile-tabs.jsx (MoreView)'],
  'bot-chat': ['Bots chat', 'src/ui/views/bots/chat.jsx'], 'bot-group': ['Bot group chat', 'src/ui/views/bots/chat.jsx'], bots: ['Bots list', 'src/ui/views/bots/list.jsx'],
  'bot-groups': ['Bot groups', 'src/ui/views/bots/more.jsx (BotGroupsView)'], 'bot-reminders': ['Reminders', 'src/ui/views/bots/more.jsx (BotRemindersView)'],
  'bot-memory': ['Bots memory', 'src/ui/views/bots/more.jsx (BotMemoryView)'], 'bot-home': ['Home (Home Assistant)', 'src/ui/views/bots/more.jsx (BotHomeView)'],
  'bot-server': ['Bots server', 'src/ui/views/bots/more.jsx (BotServerView)'], 'bot-settings': ['Bots settings', 'src/ui/views/bots/more.jsx (BotSettingsView)']
};
const PC_VIEWS = ['chat', 'tasks', 'projects', 'agents', 'logs', 'activity', 'schedules', 'phone', 'tutorials', 'board', 'expert', 'monitor', 'bot-chat', 'bots', 'bot-groups', 'bot-reminders', 'bot-memory', 'bot-home', 'bot-server', 'bot-settings'];
const PHONE_VIEWS = ['chat', 'chats', 'more', 'tasks', 'projects', 'logs', 'activity', 'schedules', 'phone', 'profile', 'tutorials', 'board', 'link', 'bot-chat', 'bots', 'bot-reminders', 'bot-home', 'bot-groups', 'bot-memory', 'bot-server', 'bot-settings'];
const WEB_VIEWS = ['chat', 'tasks', 'projects', 'link', 'logs', 'bot-chat', 'bots', 'bot-reminders'];
// 3.6: six sections (their parts are taken scrolling); «Mi perfil» is a window of its own (the user menu, 2+ users).
const SETTINGS = [['general', 'General (assistant, folder, appearance, updates)'], ['magiclink', 'Magic Link (users, devices, linked Orbs)'], ['agentes', 'Agents (chat, tasks, test)'], ['datos', 'Data and backups'], ['avanzado', 'Advanced (tools, God mode, PC status)'], ['acerca', 'About (contribute, more apps)'], ['perfil', 'My profile']];

async function views(page, list, state, { scroll = true } = {}) {
  for (const v of list) {
    await attempt(page, `${v} ${state}`, async () => {
      const route = { view: v };
      await nav(page, route);
      const area = v.startsWith('bot') ? 'bots' : 'orb';
      await shot(page, { area, screen: v, state, src: SRC[v][1], desc: `${SRC[v][0]} — ${state}`, scroll });
    });
  }
}
async function settings(page, state) {
  await nav(page, { view: 'chat' });
  for (const [id, label] of SETTINGS) {
    await attempt(page, `settings ${id} ${state}`, async () => {
      if (id === 'perfil') {
        await page.keyboard.press('Escape');
        if (!(await page.locator('[data-testid=person-menu]:visible').count())) { misses.push(`settings perfil ${state} (${themeOf(meta.get(page))}, ${meta.get(page).device}): only with several users`); return; }
        await menuItem(page, 'person-profile');
        await page.waitForSelector('[data-testid=profile-dialog]');
        await shot(page, { area: 'settings', screen: id, state, src: 'src/ui/views/settings.jsx (SettingsDialog, profile)', desc: `${label} — ${state}`, scroll: true });
        await page.keyboard.press('Escape');
        return;
      }
      if (!(await page.locator('[data-testid=settings-dialog]').isVisible().catch(() => false))) await page.evaluate(() => window.__orbFire('ui:navigate', { view: 'settings' }));
      await page.waitForSelector('[data-testid=settings-dialog]');
      const item = page.locator(`[data-testid=settings-nav-${id}]`);
      if (!(await item.count())) { misses.push(`settings ${id} ${state} (${themeOf(meta.get(page))}, ${meta.get(page).device}): this section only shows with several users`); return; }
      await item.click();
      await shot(page, { area: 'settings', screen: id, state, src: 'src/ui/views/settings.jsx (SettingsDialog)', desc: `Settings › ${label} — ${state}`, scroll: true });
    });
  }
  await page.keyboard.press('Escape');
}

let pc; let step = 'inicio';
try {
  // ================= 1. the welcome wizard (PC, light and dark) =================
  pc = await newPage('pc', { bridge: true });
  for (const dark of [false, true]) {
    step = `asistente ${dark ? 'oscuro' : 'claro'}`;
    needsSetup = true;
    meta.get(pc).dark = dark;
    await pc.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); // before the setup the theme follows the system
    await pc.goto(pcUrl);
    // 3.6: three screens, one question each (name; anyone else?; what for).
    await pc.waitForSelector('[data-testid=wizard-nombre]', { timeout: 20000 });
    const W = 'src/ui/views/setup.jsx';
    await pc.fill('[data-testid=setup-name]', 'Ana');
    await shot(pc, { area: 'wizard', screen: 'nombre', state: 'filled', src: W, desc: 'Welcome wizard 1/3: «¿Cómo te llamas?»' });
    if (await pc.locator('[data-testid=setup-folder]').count()) await pc.click('[data-testid=setup-folder]');
    await pc.click('[data-testid=setup-create]');
    await pc.waitForSelector('[data-testid=wizard-quien]', { timeout: 20000 });
    await shot(pc, { area: 'wizard', screen: 'quien', state: 'default', src: W, desc: 'Welcome wizard 2/3: «¿Lo usará alguien más?»' });
    await attempt(pc, 'wizard more people', async () => {
      await pc.click('[data-testid=wizard-more-people]');
      await pc.fill('[data-testid=wizard-person-0]', 'Leo');
      await shot(pc, { area: 'wizard', screen: 'quien', state: 'several-users', src: W, desc: 'Welcome wizard 2/3 with one more user' });
    });
    await pc.click('[data-testid=wizard-only-me]');
    await pc.waitForSelector('[data-testid=wizard-para]', { timeout: 20000 });
    await shot(pc, { area: 'wizard', screen: 'para', state: 'default', src: W, desc: 'Welcome wizard 3/3: «¿Para qué lo quieres?»' });
    await pc.click('[data-testid=wizard-use-later]');
    await loaded(pc);
    if (!dark) {
      // The guided tour, the first time the app opens.
      step = 'tour guiado';
      await attempt(pc, 'guided tour', async () => {
        await pc.waitForSelector('[data-testid=tour]', { timeout: 6000 });
        for (let i = 1; i <= 25; i++) {
          await shot(pc, { area: 'tour', screen: 'guided-tour', state: `step-${i}`, src: 'src/ui/components/tour.jsx', desc: `Guided tour, step ${i}` });
          const next = pc.locator('[data-testid=tour-next]');
          if (!(await next.isVisible().catch(() => false))) break;
          const label = await next.textContent();
          await next.click(); await pc.waitForTimeout(500);
          if (!(await pc.locator('[data-testid=tour]').isVisible().catch(() => false)) || /Empezar|Terminar|Listo/.test(label)) break;
        }
        if (await pc.locator('[data-testid=tour-skip]').isVisible().catch(() => false)) await pc.click('[data-testid=tour-skip]');
      });
    }
    await call('config.save', { patch: { ui: { tourDone: true } } });
  }

  // ================= 2. a fresh, empty Orb =================
  await call('config.save', { patch: { expert: { enabled: true }, monitor: { enabled: true } } });
  const phone = (!ONLY || ONLY.has('phone')) ? await newPage('phone') : null;
  const web = (!ONLY || ONLY.has('web')) ? await newPage('web') : null;
  const linkDevice = async (page, device) => {
    const qr = await call('link.qr', { admin: true, ...(device === 'browser' ? { device: 'browser' } : {}) });
    await page.goto(`http://127.0.0.1:${port}/${new URL(qr.url).hash}`);
    await loaded(page);
  };
  if (phone) { step = 'enlazar el móvil'; await linkDevice(phone, 'phone'); }
  if (web) { step = 'enlazar el navegador'; await linkDevice(web, 'browser'); for (const d of await call('link.devices')) if (d.kind === 'browser') await quiet(call('link.setAdmin', { id: d.id, admin: true })); await web.reload(); await loaded(web); }

  for (const dark of [false, true]) {
    step = `vacío ${dark ? 'oscuro' : 'claro'}`;
    if (!ONLY || ONLY.has('pc')) {
      await pc.emulateMedia({ colorScheme: 'light' });
      await setLook(pc, { dark });
      await views(pc, PC_VIEWS, 'empty');
      await settings(pc, 'empty');
    }
    if (phone) { await setLook(phone, { dark }); await views(phone, PHONE_VIEWS, 'empty'); }
  }

  // ================= 3. sample data =================
  step = 'datos de ejemplo';
  const leo = await call('persons.create', { name: 'Leo' });
  const ana = (await call('persons.list')).find((p) => p.role === 'owner');
  await call('persons.switch', { id: leo.id }); await quiet(call('persons.setPin', { pin: '2468' })); await call('persons.switch', { id: ana.id });
  await quiet(call('persons.setCaps', { id: leo.id, caps: { dev: true } }));
  await call('projects.create', { name: 'mi-web', notes: 'La web personal: portada, blog y contacto.' });
  await call('projects.create', { name: 'app-tienda', notes: 'Tienda online pequeña.' });
  await call('projects.create', { name: 'notas' });
  await call('projects.setActive', { name: 'mi-web' });
  const task = (title, description, extra = {}) => call('tasks.create', { project: 'mi-web', title, description, agent: 'claude', ...extra });
  await task('Portada nueva con un título bastante largo para ver cómo se corta en la lista', 'ESCRIBE la portada');
  await task('Arreglar el formulario de contacto', 'FALLA');
  await task('Publicar la web', 'haz push a producción', { agent: 'codex' });
  const slow = await task('Optimizar las imágenes del blog', 'DUERME');
  await task('Revisar los enlaces rotos', 'ESCRIBE la lista', { depends_on: [slow.id] });
  const cancel = await task('Traducir la web al inglés', 'LENTO');
  await quiet(call('tasks.cancel', { id: cancel.id }));
  await until(async () => (await call('tasks.list')).some((x) => x.status === 'done'), 'tarea hecha', 30000);
  await quiet(call('schedules.create', { project: 'mi-web', title: 'Copia del blog cada lunes', description: 'ESCRIBE una copia', agent: 'claude', every: 'weekly', at_time: '09:00', weekdays: [1] }));
  // Conversations with the assistant: long text and code, and a markdown answer.
  const long = 'Quiero rehacer la portada de mi-web. Tiene que cargar rápido, verse bien en el móvil y tener un título grande, tres tarjetas con lo que hago y un pie con el contacto. '.repeat(3);
  await call('chat.send', { text: `${long}\n\nAhora mismo el código es este:\n\n\`\`\`html\n<header class="hero">\n  <h1>Hola, soy Ana</h1>\n  <p>Hago webs sencillas.</p>\n</header>\n\`\`\`` });
  await until(async () => (await call('conversations.list')).length > 0, 'conversación');
  const conv = (await call('conversations.list'))[0];
  await new Promise((r) => setTimeout(r, 1500));
  await quiet(call('chat.send', { text: 'TABLA_MARKDOWN ¿Cómo lo repartimos?', conversation: conv.id }));
  await call('chat.send', { text: 'Recuérdame mañana llamar a Leo', conversation: null }).catch(() => {});
  // Direct conversations with agents: one with a picture, one waiting for permission.
  const s1 = await call('sessions.create', { agent: 'claude', project: 'mi-web', permission: 'editar', title: 'Charla con Claude' });
  const img = path.join(t.home, 'captura.png'); fs.copyFileSync(path.join(ROOT, 'src', 'ui', 'public', 'icon.png'), img);
  await quiet(call('sessions.send', { id: s1.id, text: 'Mira esta imagen y dime qué ves. CREA_IMAGEN', images: [img] }));
  await new Promise((r) => setTimeout(r, 1500));
  await quiet(call('sessions.send', { id: s1.id, text: 'TABLA_MARKDOWN' }));
  const s2 = await call('sessions.create', { agent: 'codex', project: 'mi-web', permission: 'editar', title: 'Publicar con Codex' });
  await quiet(call('sessions.send', { id: s2.id, text: 'Publica los cambios PIDE_PERMISO' }));
  // Bots, a group, reminders, a pending card.
  const jefe = await call('bots.create', { name: 'Jefe', icon: '🧠', role_text: 'Recibe lo que pido, lo reparte a los demás y me avisa cuando está.', is_chief: true, tools: ['internet', 'recordatorios'] });
  const agenda = await call('bots.create', { name: 'Agenda', icon: '📅', role_text: 'Llevas mi calendario y mis citas. Avísame la víspera de cada una.', tools: ['recordatorios', 'calendario'], exclusive: ['calendario'], agent: 'codex' });
  await call('bots.create', { name: 'Compras', icon: '🛒', role_text: 'Comparas precios y preparas la compra. Nunca compras sin mi OK.', tools: ['internet', 'navegador'], effort: 'high' });
  const when = new Date(Date.now() + 26 * 3_600_000);
  await call('bots.reminders.create', { id: agenda.id, text: 'Cita con el dentista', when: at(when, 10, 0) });
  await call('bots.reminders.create', { id: agenda.id, text: 'Revisar la semana', when: at(when, 18, 30), every: 'weekly' });
  await call('bots.reminders.create', { id: jefe.id, text: 'Pagar el alquiler', when: at(new Date(Date.now() + 5 * 86_400_000), 9, 0), every: 'monthly' });
  const casa = await call('bots.groups.create', { name: 'Casa', icon: '🏠', members: [jefe.id, agenda.id] });
  await quiet(call('bots.groups.send', { id: casa.id, text: '¿Qué tenemos mañana?' }));
  await quiet(call('bots.send', { id: jefe.id, text: 'Crea un bot para el correo\nBOT_CALL bot_create {"name":"Correo","icon":"✉️","role_text":"Mira el correo y me resume lo importante","tools":["correo"]}' }));
  await quiet(until(async () => JSON.stringify(await call('bots.cards', {})).includes('pending'), 'tarjeta pendiente', 20000));
  await quiet(call('bots.memory.set', { id: 'global', text: '- Ana prefiere los avisos por la mañana.\n- La compra se hace los sábados.' }));
  // Sharing and lending.
  await quiet(call('shares.set', { type: 'bot', id: agenda.id, person: leo.id, right: 'talk' }));
  await quiet(call('shares.set', { type: 'project', id: 'app-tienda', person: leo.id, right: 'view' }));
  await quiet(call('accounts.lend', { id: 'claude', person: leo.id, daily_turns: 50, dev: true }));
  await quiet(call('whiteboard.save', { project: 'mi-web', elements: [], appState: {} }));

  // A task that is running while the tasks screens are taken (DUERME lasts 30 s).
  const freshRunning = async () => { const r = await quiet(task('Comprimir las fotos de la galería', 'DUERME')); if (r) await quiet(task('Subir las fotos comprimidas', 'ESCRIBE', { depends_on: [r.id] })); return r; };
  const tasksDetail = async (page, state) => {
    await freshRunning();
    await nav(page, { view: 'tasks' });
    for (const [tab, label] of [['En curso', 'active'], ['Por aprobar', 'to-approve'], ['Completadas', 'done'], ['Incidencias', 'problems'], ['Todas', 'all']]) {
      await attempt(page, `tasks tab ${label}`, async () => {
        await page.getByRole('tab', { name: new RegExp(tab) }).click();
        await shot(page, { area: 'orb', screen: 'tasks', state: `tab-${label}`, src: 'src/ui/views/tasks.jsx', desc: `Tasks, tab «${tab}»`, scroll: true });
      });
    }
    for (const [title, label] of [['Portada nueva', 'done'], ['Arreglar el formulario', 'failed'], ['Publicar la web', 'awaiting-approval'], ['Comprimir las fotos', 'running'], ['Subir las fotos', 'queued'], ['Traducir la web', 'cancelled']]) {
      await attempt(page, `task detail ${label}`, async () => {
        await page.getByRole('tab', { name: /Todas/ }).click();
        await page.getByRole('button', { name: new RegExp(title) }).first().click();
        await page.waitForSelector('[data-testid=task-detail]');
        await shot(page, { area: 'orb', screen: 'task-detail', state: `${label}-${state}`, src: 'src/ui/views/tasks.jsx (detail) + components/task-approval.jsx', desc: `Task detail, status ${label}`, scroll: true });
        await nav(page, { view: 'tasks' });
      });
    }
  };

  // ================= 4. everything again, with things in it =================
  const looks = [{ dark: false }, { dark: true }];
  for (const look of looks) {
    const st = 'populated';
    if (!ONLY || ONLY.has('pc')) {
      step = `PC ${look.dark ? 'oscuro' : 'claro'}`;
      await setLook(pc, look);
      await views(pc, PC_VIEWS, st);
      await settings(pc, st);
      const P = pc;
      await attempt(P, 'chat conversation', async () => { await nav(P, { view: 'chat', id: conv.id }); await P.waitForSelector('[data-testid=chat-lines]'); await shot(P, { area: 'orb', screen: 'chat', state: 'conversation-long-code-table', src: 'src/ui/views/chat.jsx + components/markdown.jsx', desc: 'Orb chat, a conversation with long text, a code block and a markdown table', scroll: true }); });
      await attempt(P, 'session picture', async () => { await nav(P, { view: 'session', id: s1.id }); await P.waitForSelector('[data-testid=session-input]'); await shot(P, { area: 'orb', screen: 'session', state: 'image-and-table', src: 'src/ui/views/session.jsx + components/image-viewer.jsx', desc: 'Conversation with Claude: a picture sent, a generated image, tool calls, a table', scroll: true }); });
      await attempt(P, 'image preview', async () => { await P.locator('[data-testid=generated-image] img, [data-testid=session-lines] img, main img').last().click(); await P.waitForTimeout(500); await shot(P, { area: 'orb', screen: 'image-viewer', state: 'open', src: 'src/ui/components/image-viewer.jsx', desc: 'Image preview over the conversation' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'brain picker', async () => { await P.click('[data-testid=session-model]'); await P.waitForTimeout(400); await shot(P, { area: 'orb', screen: 'session', state: 'model-picker-open', src: 'src/ui/components/brain-picker.jsx', desc: 'Conversation, the model / brain picker open' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'session approval', async () => { await nav(P, { view: 'session', id: s2.id }); await P.waitForSelector('[data-testid=approval-card]', { timeout: 15000 }); await shot(P, { area: 'orb', screen: 'session', state: 'approval-card-pending', src: 'src/ui/views/session.jsx (ApprovalCard)', desc: 'Conversation with Codex waiting for permission (approval card)' }); });
      await tasksDetail(P, st);
      await attempt(P, 'project selected', async () => { await nav(P, { view: 'projects' }); await P.locator('main').getByText('mi-web', { exact: true }).first().click(); await shot(P, { area: 'orb', screen: 'projects', state: 'selected-mi-web', src: 'src/ui/views/projects.jsx', desc: 'Projects, «mi-web» selected (git, actions, share)', scroll: true }); });
      await attempt(P, 'share dialog', async () => { await P.click('[data-testid=share-project]'); await P.waitForSelector('[data-testid=share-dialog]'); await shot(P, { area: 'dialog', screen: 'share', state: 'project', src: 'src/ui/components/share-dialog.jsx', desc: 'Share dialog (view / talk / edit per user)' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'rename dialog', async () => { await P.locator('main').getByText('notas', { exact: true }).first().click(); await P.click('[data-testid=project-rename]'); await dialog(P); await shot(P, { area: 'dialog', screen: 'rename-project', state: 'open', src: 'src/ui/views/projects.jsx + components/dialogs.jsx (form)', desc: 'Rename project form' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'review dialog', async () => { await P.locator('main').getByText('mi-web', { exact: true }).first().click(); await P.click('[data-testid=project-review]'); await dialog(P); await shot(P, { area: 'dialog', screen: 'project-review', state: 'open', src: 'src/ui/views/projects.jsx (askReview) + components/dialogs.jsx', desc: 'Task Review of a project, who reviews' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'new project dialog', async () => { await nav(P, { view: 'chat' }); await P.click('[data-testid=chats-new]'); await P.click('[data-testid=sidebar-new-project]'); await dialog(P); await shot(P, { area: 'dialog', screen: 'new-project', state: 'empty', src: 'src/ui/components/project-actions.jsx (createProjectFlow)', desc: 'New project dialog (platforms, name, about)' });
        await P.locator('[role=dialog] input').first().fill('mi-web'); await P.waitForTimeout(300);
        await shot(P, { area: 'dialog', screen: 'new-project', state: 'name-taken', src: 'src/ui/components/project-actions.jsx', desc: 'New project dialog with a name that already exists (inline error)' });
        await P.locator('[role=dialog] button[type=submit]').click(); await P.waitForTimeout(600);
        await shot(P, { area: 'toast', screen: 'error', state: 'project-exists', src: 'src/ui/main.jsx (ThemedToaster, sonner) + lib/notify.js', desc: 'Error toast after trying to create a project that exists', toasts: true });
        await P.keyboard.press('Escape'); });
      await attempt(P, 'project picker', async () => { await nav(P, { view: 'chat' }); await P.click('[data-testid=project-picker]'); await P.waitForTimeout(400); await shot(P, { area: 'menu', screen: 'project-picker', state: 'open', src: 'src/ui/components/project-actions.jsx (ProjectPicker)', desc: 'Working-project picker in the composer' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'notice center', async () => { await P.click('[data-testid=bar-notices]'); await P.waitForSelector('[data-testid=notice-center]'); await shot(P, { area: 'menu', screen: 'notice-center', state: 'open', src: 'src/ui/components/notification-center.jsx', desc: 'Notification bell, past notices' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'person menu', async () => { await P.click('[data-testid=person-menu]:visible'); await P.waitForSelector('[data-testid=person-profile]'); await shot(P, { area: 'menu', screen: 'person-menu', state: 'open', src: 'src/ui/components/person-menu.jsx', desc: 'User menu (switch user, my profile, lock)' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'sidebar footer', async () => { await footerOpen(P); await shot(P, { area: 'menu', screen: 'sidebar-footer', state: 'expanded', src: 'src/ui/components/sidebar.jsx (footer)', desc: 'Sidebar footer expanded (settings, agents, bitácoras, tutorials)' }); await P.click('[data-testid=sidebar-footer-toggle]'); });
      await attempt(P, 'sidebar search', async () => { await P.fill('[data-testid=sidebar-search-input]', 'web'); await P.waitForTimeout(500); await shot(P, { area: 'menu', screen: 'sidebar-search', state: 'results', src: 'src/ui/components/sidebar.jsx (search)', desc: 'Sidebar search results for «web»' }); await P.fill('[data-testid=sidebar-search-input]', ''); });
      await attempt(P, 'sidebar filter', async () => { await P.click('[data-testid=sidebar-filter]'); await P.waitForTimeout(400); await shot(P, { area: 'menu', screen: 'sidebar-filter', state: 'open', src: 'src/ui/components/sidebar.jsx (filter)', desc: 'Sidebar filter popover' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'sidebar collapsed', async () => { await P.click('[data-testid=sidebar-collapse]'); await shot(P, { area: 'menu', screen: 'sidebar', state: 'collapsed', src: 'src/ui/components/theme-toggle.jsx + components/page.jsx', desc: 'Sidebar folded away, the screen takes the whole width' }); await P.click('[data-testid=sidebar-expand]'); });
      await attempt(P, 'mode switch bots', async () => { await nav(P, { view: 'chat' }); await P.click('[data-testid=mode-bots]'); await shot(P, { area: 'menu', screen: 'mode-switch', state: 'bots', src: 'src/ui/components/mode-switch.jsx + components/bots-nav.jsx', desc: 'Mode switch moved to Bots (bots sidebar)' }); await P.click('[data-testid=mode-orb]'); });
      await attempt(P, 'games', async () => { await nav(P, { view: 'chat' }); await P.click('[data-testid=bar-games]'); await P.waitForSelector('[data-testid=games-dialog]'); await shot(P, { area: 'games', screen: 'games', state: 'list', src: 'src/ui/games/games.jsx', desc: 'Mini games dialog' });
        for (const g of ['snake', 'chess', 'tetris']) { await attempt(P, `game ${g}`, async () => { if (await P.getByRole('button', { name: 'Volver a los juegos' }).isVisible().catch(() => false)) await P.getByRole('button', { name: 'Volver a los juegos' }).click(); await P.click(`[data-testid=game-${g}]`); await P.waitForTimeout(1200); await shot(P, { area: 'games', screen: g, state: 'playing', src: `src/ui/games/${g}.jsx`, desc: `Game: ${g}` }); }); }
        await P.keyboard.press('Escape'); });
      await attempt(P, 'bot chat with card', async () => { await nav(P, { view: 'bot-chat', id: jefe.id }); await P.waitForSelector('[data-testid=bot-chat-input]'); await shot(P, { area: 'bots', screen: 'bot-chat', state: 'jefe-pending-card', src: 'src/ui/views/bots/chat.jsx (cards)', desc: 'Chat with the chief bot, an approval card pending', scroll: true }); });
      await attempt(P, 'group chat', async () => { await nav(P, { view: 'bot-group', id: casa.id }); await P.waitForSelector('[data-testid=bot-chat-input]'); await shot(P, { area: 'bots', screen: 'bot-group', state: 'casa', src: 'src/ui/views/bots/chat.jsx', desc: 'Group chat «Casa»' }); });
      await attempt(P, 'bot editor', async () => { await nav(P, { view: 'bots', id: agenda.id }); await P.waitForSelector('[data-testid=bot-editor]'); await shot(P, { area: 'bots', screen: 'bot-editor', state: 'agenda', src: 'src/ui/views/bots/list.jsx (BotEditor)', desc: 'Bot editor (Agenda): role, tools, brain, account, caps', scroll: true }); });
      await attempt(P, 'bot share', async () => { await P.click('[data-testid=share-bot]'); await P.waitForSelector('[data-testid=share-dialog]'); await shot(P, { area: 'dialog', screen: 'share', state: 'bot', src: 'src/ui/components/share-dialog.jsx', desc: 'Share a bot with another user' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'bot delete confirm', async () => { await P.click('[data-testid=bot-delete]'); await P.waitForSelector('[role=alertdialog], [role=dialog]'); await shot(P, { area: 'dialog', screen: 'confirm', state: 'delete-bot', src: 'src/ui/components/dialogs.jsx (confirm, danger)', desc: 'Confirmation dialog (delete a bot)' }); await P.getByRole('button', { name: 'Cancelar' }).click(); });
      await attempt(P, 'new bot', async () => { await nav(P, { view: 'bots', id: 'new' }); await P.waitForSelector('[data-testid=bot-create]'); await shot(P, { area: 'bots', screen: 'bot-create', state: 'new', src: 'src/ui/views/bots/create.jsx (CreateBot)', desc: 'New bot: name, shape and colour' }); });
      await attempt(P, 'new group', async () => { await nav(P, { view: 'bot-groups' }); await P.click('[data-testid=group-new]'); await P.waitForTimeout(400); await shot(P, { area: 'dialog', screen: 'new-group', state: 'open', src: 'src/ui/views/bots/more.jsx (BotGroupsView)', desc: 'New bot group' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'new reminder', async () => { await nav(P, { view: 'bot-reminders' }); await P.click('[data-testid=reminder-new]'); await P.waitForTimeout(400); await shot(P, { area: 'dialog', screen: 'new-reminder', state: 'open', src: 'src/ui/views/bots/more.jsx (BotRemindersView)', desc: 'New reminder' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'new schedule', async () => { await nav(P, { view: 'schedules' }); await P.click('[data-testid=new-schedule]'); await dialog(P); await shot(P, { area: 'dialog', screen: 'new-schedule', state: 'open', src: 'src/ui/views/schedules.jsx', desc: 'New scheduled task', scroll: true }); await P.keyboard.press('Escape'); });
      await attempt(P, 'lend dialog', async () => { await nav(P, { view: 'agents' }); const lend = P.locator('[data-testid^=lend-]').filter({ hasText: 'Prestar' }).first(); await lend.click(); await P.waitForSelector('[data-testid=lend-terms]'); await shot(P, { area: 'dialog', screen: 'lend', state: 'open', src: 'src/ui/views/agents.jsx (lendDialog)', desc: '«Prestar a…» an account to another user, with caps and terms' }); await P.keyboard.press('Escape'); });
      await attempt(P, 'magic link qr', async () => { await P.evaluate(() => window.__orbFire('ui:navigate', { view: 'settings', section: 'magiclink' })); await P.waitForSelector('[data-testid=settings-dialog]'); await P.click('[data-testid=settings-nav-magiclink]'); await P.click('[data-testid=link-make]'); await P.waitForSelector('[data-testid=link-qr]'); await shot(P, { area: 'dialog', screen: 'magic-link', state: 'qr', src: 'src/ui/views/magic-link.jsx (MagicLinkPanel)', desc: 'Magic Link QR and code, «¿Para qué usuario?»', scroll: true }); await P.keyboard.press('Escape'); });
      await attempt(P, 'whiteboard panel', async () => { await nav(P, { view: 'board' }); await P.waitForTimeout(1500); if (await P.locator('[data-testid=whiteboard-show-panel]').isVisible().catch(() => false)) await P.click('[data-testid=whiteboard-show-panel]'); await shot(P, { area: 'orb', screen: 'board', state: 'panel', src: 'src/ui/views/whiteboard.jsx + components/excalidraw-board.jsx', desc: 'Whiteboard with its side panel' }); });
      await attempt(P, 'expert populated', async () => { await nav(P, { view: 'expert' }); await P.waitForTimeout(1200); await shot(P, { area: 'orb', screen: 'expert', state: 'project-mi-web', src: 'src/ui/views/expert.jsx', desc: 'God mode with mi-web (tree, git, system)' }); });
      await attempt(P, 'tutorials faq', async () => { await nav(P, { view: 'tutorials' }); await P.locator('[data-testid^=faq-]').first().click(); await shot(P, { area: 'orb', screen: 'tutorials', state: 'faq-open', src: 'src/ui/views/tutorials.jsx', desc: 'Tutorials, a question opened', scroll: true }); });
      await attempt(P, 'update card', async () => { await P.evaluate(() => localStorage.setItem('tour.update', JSON.stringify({ state: 'available', version: '3.7.0' }))); await P.reload(); await loaded(P); await P.waitForSelector('[data-testid=update-card]'); await shot(P, { area: 'notice', screen: 'update-card', state: 'available', src: 'src/ui/components/update-card.jsx', desc: 'New version available card' }); await P.evaluate(() => localStorage.removeItem('tour.update')); await P.reload(); await loaded(P); });
      await attempt(P, 'success toast', async () => { await nav(P, { view: 'projects' }); await P.locator('main').getByText('app-tienda', { exact: true }).first().click(); await P.getByRole('button', { name: 'Trabajar aquí' }).first().click(); await P.waitForTimeout(500); await shot(P, { area: 'toast', screen: 'success', state: 'working-project', src: 'src/ui/main.jsx (ThemedToaster) + lib/notify.js', desc: 'Success toast (working project changed)', toasts: true }); await call('projects.setActive', { name: 'mi-web' }); });
      // The window locked, and switching user with a PIN.
      await attempt(P, 'lock screen', async () => { await nav(P, { view: 'chat' }); await menuItem(P, 'person-lock'); await P.waitForSelector('[data-testid=lock-screen]'); await shot(P, { area: 'lock', screen: 'lock-screen', state: 'locked', src: 'src/ui/components/lock-screen.jsx (LockScreen)', desc: 'PC window locked: who unlocks' });
        await quiet(P.click('[data-testid=lock-person-Leo]')); await P.waitForTimeout(300); await shot(P, { area: 'lock', screen: 'lock-screen', state: 'pin-leo', src: 'src/ui/components/lock-screen.jsx', desc: 'Lock screen, Leo chosen: his PIN' });
        await P.click('[data-testid=lock-person-Ana]'); await P.click('[data-testid=lock-unlock]'); await loaded(P); });
      // 3.6: «Cambiar de usuario» locks the window; the lock screen asks who and, with a PIN, for it.
      await attempt(P, 'pin prompt', async () => { await menuItem(P, 'person-switch'); await P.waitForSelector('[data-testid=lock-screen]'); await P.click('[data-testid=lock-person-Leo]'); await P.fill('[data-testid=lock-screen] input[type=password]', '1111'); await P.click('[data-testid=lock-unlock]'); await P.waitForSelector('[data-testid=lock-error]'); await shot(P, { area: 'lock', screen: 'pin', state: 'wrong-pin', src: 'src/ui/components/lock-screen.jsx (LockScreen)', desc: 'Switch user: PIN asked, a wrong PIN', toasts: true });
        await P.click('[data-testid=lock-person-Ana]'); await P.click('[data-testid=lock-unlock]'); await loaded(P); });
      // The other visual themes.
      for (const skin of SKINS.slice(1)) {
        step = `tema ${skin}`;
        await setLook(P, { ...look, skin });
        await views(P, ['chat', 'tasks', 'projects', 'bot-chat', 'bots'], st, { scroll: false });
        await attempt(P, `conversation ${skin}`, async () => { await nav(P, { view: 'chat', id: conv.id }); await shot(P, { area: 'orb', screen: 'chat', state: 'conversation', src: 'src/ui/views/chat.jsx + themes.css', desc: `Orb chat, conversation, skin ${skin}` }); });
        await attempt(P, `settings ${skin}`, async () => { await P.evaluate(() => window.__orbFire('ui:navigate', { view: 'settings', section: 'apariencia' })); await P.waitForSelector('[data-testid=settings-dialog]'); await P.click('[data-testid=settings-nav-general]'); await P.click('[data-testid=settings-sub-apariencia]'); await shot(P, { area: 'settings', screen: 'apariencia', state: st, src: 'src/ui/views/settings.jsx + components/skin-preview.jsx', desc: `Settings › Appearance, skin ${skin}` }); await P.keyboard.press('Escape'); });
      }
      await setLook(P, { ...look, skin: 'orb' });
    }

    if (phone) {
      step = `móvil ${look.dark ? 'oscuro' : 'claro'}`;
      const M = phone;
      await setLook(M, look);
      await views(M, PHONE_VIEWS, st);
      await attempt(M, 'phone more bots', async () => { await nav(M, { view: 'bot-chats' }); await M.click('[data-testid=nav-menu]:visible'); await M.waitForSelector('[data-testid=mobile-more-bots]'); await M.waitForTimeout(400); await shot(M, { area: 'bots', screen: 'menu', state: st, src: 'src/ui/components/mobile-menu.jsx', desc: 'The phone menu ☰ in Bots mode' }); await M.keyboard.press('Escape'); });
      await attempt(M, 'phone conversation', async () => { await nav(M, { view: 'chat', id: conv.id }); await shot(M, { area: 'orb', screen: 'chat', state: 'conversation-long-code-table', src: 'src/ui/views/chat.jsx', desc: 'Orb chat on the phone, long text, code and table', scroll: true }); });
      await attempt(M, 'phone session', async () => { await nav(M, { view: 'session', id: s1.id }); await shot(M, { area: 'orb', screen: 'session', state: 'image-and-table', src: 'src/ui/views/session.jsx', desc: 'Conversation with Claude on the phone', scroll: true }); });
      await attempt(M, 'phone approval', async () => { await nav(M, { view: 'session', id: s2.id }); await M.waitForSelector('[data-testid=approval-card]'); await shot(M, { area: 'orb', screen: 'session', state: 'approval-card-pending', src: 'src/ui/views/session.jsx (ApprovalCard)', desc: 'Permission card on the phone' }); });
      await attempt(M, 'phone bot card', async () => { await nav(M, { view: 'bot-chat', id: jefe.id }); await M.waitForSelector('[data-testid=bot-chat-input]'); await shot(M, { area: 'bots', screen: 'bot-chat', state: 'jefe-pending-card', src: 'src/ui/views/bots/chat.jsx', desc: 'Chief bot chat with a pending card on the phone', scroll: true }); });
      await attempt(M, 'phone group', async () => { await nav(M, { view: 'bot-group', id: casa.id }); await shot(M, { area: 'bots', screen: 'bot-group', state: 'casa', src: 'src/ui/views/bots/chat.jsx', desc: 'Group chat on the phone' }); });
      await attempt(M, 'phone bot detail', async () => { await nav(M, { view: 'bots', id: agenda.id }); await shot(M, { area: 'bots', screen: 'bot-editor', state: 'agenda-readonly', src: 'src/ui/views/bots/list.jsx', desc: 'A bot opened on the phone (changes are made on the PC)', scroll: true }); });
      await tasksDetail(M, st);
      await attempt(M, 'phone person menu', async () => { await nav(M, { view: 'chats' }); await M.click('[data-testid=nav-menu]:visible'); await M.waitForSelector('[data-testid=mobile-menu]'); await M.waitForTimeout(400); await shot(M, { area: 'menu', screen: 'menu', state: 'with-users', src: 'src/ui/components/mobile-menu.jsx + components/person-menu.jsx', desc: 'The phone menu ☰ with several users' }); await M.keyboard.press('Escape'); });
    }
    if (web) {
      step = `navegador ${look.dark ? 'oscuro' : 'claro'}`;
      await setLook(web, look);
      await views(web, WEB_VIEWS, st, { scroll: false });
    }
  }

  // ================= 5. Leo's phone: the PIN lock, «Conectado como Leo» =================
  if (!ONLY || ONLY.has('phone')) {
    step = 'móvil de Leo';
    const L = await newPage('phone');
    await attempt(L, 'phone lock', async () => {
      const qr = await call('link.qr', { person: leo.id });
      await L.goto(`http://127.0.0.1:${port}/${new URL(qr.url).hash}`);
      await L.waitForSelector('[data-testid=phone-lock]', { timeout: 20000 });
      await shot(L, { area: 'lock', screen: 'phone-lock', state: 'pin', src: 'src/ui/components/lock-screen.jsx (PhoneLock)', desc: 'Leo\'s phone: PIN to open Orb' });
      await L.fill('[data-testid=lock-pin]', '1111'); await L.click('[data-testid=lock-unlock]'); await L.waitForTimeout(700);
      await shot(L, { area: 'lock', screen: 'phone-lock', state: 'wrong-pin', src: 'src/ui/components/lock-screen.jsx (PhoneLock)', desc: 'Phone lock with a wrong PIN' });
      await L.fill('[data-testid=lock-pin]', '2468'); await L.click('[data-testid=lock-unlock]');
      // 3.6: who is connected shows in the ☰ menu's user card (no «Conectado como» line any more).
      await loaded(L);
      await shot(L, { area: 'orb', screen: 'chats', state: 'leo-own-list', src: 'src/ui/views/orb/inbox.jsx', desc: 'Leo\'s phone: his own chat list' });
      await L.click('[data-testid=nav-menu]:visible');
      await L.waitForSelector('[data-testid=mobile-menu] [data-testid=person-card-name] >> text=Leo');
      await shot(L, { area: 'menu', screen: 'menu', state: 'leo-person-card', src: 'src/ui/components/mobile-menu.jsx + components/person-menu.jsx (PersonCard)', desc: 'Leo\'s phone: the ☰ menu with his user card' });
      await L.keyboard.press('Escape');
      await nav(L, { view: 'bots' });
      await shot(L, { area: 'bots', screen: 'bots', state: 'leo-shared-with-me', src: 'src/ui/views/bots/list.jsx + components/share-dialog.jsx (SharedWithMe)', desc: 'Leo\'s bots: Agenda shared with him' });
      await nav(L, { view: 'profile' });
      await shot(L, { area: 'orb', screen: 'profile', state: 'leo-borrowed-account', src: 'src/ui/views/persons.jsx', desc: 'Leo\'s profile with a borrowed account', scroll: true });
    });
  }
  console.log(`✔ recorrido: ${index.length} capturas en ${OUT}`);
} catch (error) {
  misses.push(`FATAL en «${step}»: ${String(error.stack).split('\n').slice(0, 3).join(' / ')}`);
  console.error(`✖ falló en «${step}»: ${error.stack}`);
  process.exitCode = 1;
} finally {
  // ---- INDEX.md
  const lines = ['# Orb — visual tour', '', `Generated by \`test/tour.e2e.mjs\` on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC (fake agents, sample data, headless Edge). ${index.length} screenshots.`, '',
    'Name: `NNN-area-screen-state-theme-device.png`. Theme: light / dark, prefixed with the skin when not the default (vaporwave, retro, profesional, nube). Device: `pc` = the PC window (1440x900), `web` = a linked computer browser (1440x900), `phone` = a linked phone (390x844).', '',
    '| File | What it shows | Component |', '|---|---|---|',
    ...index.map((x) => `| [${x.file}](${x.file}) | ${x.desc.replace(/\|/g, '/')} | \`${x.src}\` |`), '',
    '## Not reached', '', ...(misses.length ? misses.map((m) => `- ${m}`) : ['- (nothing)']), '',
    '## Errors in the pages', '', ...(errors.length ? [...new Set(errors)].slice(0, 40).map((e) => `- ${e.replace(/\n/g, ' ')}`) : ['- (none)']), ''];
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), lines.join('\n'));
  console.log(`índice: ${path.join(OUT, 'INDEX.md')} · sin llegar: ${misses.length}`);
  await browser.close().catch(() => {});
  shim.close();
  engine.send({ type: 'shutdown' });
  setTimeout(() => { t.cleanup(); process.exit(); }, 800);
}
