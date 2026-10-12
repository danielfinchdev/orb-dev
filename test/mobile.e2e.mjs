// The phone's web app at phone size (390x844, touch): pairing with the QR link (encrypted from then on), then every view the phone has, with
// screenshots in test-results/movil-*.png. The engine runs with fake agents and serves on loopback instead of Tailscale.
// Run: npm run build && node test/mobile.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ mobile: { enabled: true, port } });
const engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' } });
let n = 0; const pending = new Map();
engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
await until(async () => (await call('remote.status')).running, 'servidor del móvil');

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
// Linux CI: Playwright's Chromium. Windows: the Edge that comes with the system (nothing to download).
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const ctxt = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
// A phone whose clock is 30 minutes ahead: the PC refuses its first requests (409 with its own time), the page takes the
// PC's time and everything works without pairing again.
await ctxt.addInitScript(() => { const real = Date.now; Date.now = () => real() + 30 * 60_000; });
const page = await ctxt.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404)/.test(m.text())) errors.push(m.text()); });
// A file the PC does not serve to the phone: named, so the failure says which one.
page.on('response', (r) => { if (r.status() === 404 && !/favicon/.test(r.url())) errors.push(`404 ${new URL(r.url()).pathname}`); });
const shot = (name) => page.screenshot({ path: path.join(OUT, `movil-${name}.png`) });
// What travels between the page and the PC (requests and answers of the API), to check that it is all encrypted.
const sniffed = [];
page.on('request', (r) => { if (r.url().includes('/api/') && r.postData()) sniffed.push(r.postData()); });
page.on('response', async (r) => { if (r.url().includes('/api/call')) sniffed.push(await r.text().catch(() => '')); });
// Nothing may stick out sideways at phone width.
const noSideScroll = async (where) => { const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(w[0] <= w[1] + 1, `${where}: se sale por los lados (${w[0]} > ${w[1]})`); };
let step = 'inicio';
try {
  // Something to look at: a project, tasks, a conversation.
  await call('projects.create', { name: 'webviaproject' });
  await call('projects.setActive', { name: 'webviaproject' });
  await call('tasks.create', { project: 'webviaproject', title: 'Portada nueva con un título bastante largo para ver cómo se corta', description: 'ESCRIBE la portada', agent: 'claude' });
  await call('tasks.create', { project: 'webviaproject', title: 'Publicar la web', description: 'haz push a producción', agent: 'codex' });
  await until(async () => (await call('tasks.list')).some((x) => x.status === 'done'), 'tarea hecha', 30000);

  step = 'vincular';
  const { url } = await call('remote.pair');
  const link = `http://127.0.0.1:${port}/${new URL(url).hash}`;
  await page.goto(link);
  await page.waitForSelector('[data-testid=chat-input]');
  await page.fill('[data-testid=chat-input]', 'Hola desde el móvil');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Recibido: ');
  await page.waitForTimeout(500);
  await noSideScroll('chat'); await shot('01-chat');

  // 2.7: a simpler app on the phone, with tabs at the bottom (Orbe, Chats, Tareas, Proyectos, Más); the screens of «Más»
  // open from its list.
  const MORE = new Set(['nav-schedules', 'nav-memories', 'nav-tutorials', 'nav-phone']);
  const nav = async (testid) => { if (MORE.has(testid)) await page.click('[data-testid=nav-more]'); await page.locator(`[data-testid=${testid}]:visible`).click(); await page.waitForTimeout(500); };
  step = 'pestañas';
  assert.equal(await page.locator('[data-testid=mobile-tabs]:visible').count(), 1, 'pestañas abajo');
  assert.equal(await page.getByRole('button', { name: 'Menú' }).count(), 0, 'sin menú lateral en el móvil');
  assert.equal(await page.locator('[data-testid=chat-play], [data-testid=bar-games]').count(), 0, 'sin minijuegos en el móvil');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'orb', 'el móvil lleva el tema predeterminado');
  await page.click('[data-testid=nav-more]'); await page.waitForSelector('[data-testid=mobile-more]');
  assert.equal(await page.locator('[data-testid=nav-settings], [data-testid=nav-agents], [data-testid=nav-expert]').count(), 0, 'Ajustes, Agentes y modo experto solo en el PC');
  assert.equal(await page.locator('[data-testid=nav-phone]:visible').count(), 1, '«Este móvil» solo en el móvil');
  await noSideScroll('más'); await shot('02-mas');
  await page.click('[data-testid=nav-chats]'); await page.waitForSelector('[data-testid=mobile-chats]');
  await noSideScroll('chats'); await shot('02b-chats');

  for (const [testid, name, wait] of [['nav-tasks', '03-tareas', 'Publicar la web'], ['nav-projects', '04-proyectos', 'webviaproject'], ['nav-memories', '05-bitacoras', 'Bitácora general'], ['memories-activity', '06-actividad', 'task.created']]) {
    step = name;
    await nav(testid);
    await page.waitForSelector(`text=${wait} >> visible=true`);
    await noSideScroll(name); await shot(name);
  }
  step = 'detalle de tarea';
  await nav('nav-tasks');
  await page.getByRole('tab', { name: /Todas/ }).click();
  await page.getByRole('button', { name: /Portada nueva/ }).first().click();
  await page.waitForSelector('[data-testid=task-detail]');
  await page.waitForTimeout(400);
  await noSideScroll('detalle'); await shot('07-tarea-detalle');
  step = 'nueva conversación';
  await page.click('[data-testid=nav-chats]');
  // 3.0: «Nuevo chat» opens a clean conversation with the assistant.
  await page.locator('[data-testid=new-conversation]:visible').click();
  await page.waitForSelector('[data-testid=chat-input]');
  await page.waitForTimeout(300);
  await noSideScroll('nuevo chat'); await shot('08-nueva-conversacion');
  // A direct conversation with an agent (started on the PC): the phone opens it from «Chats» and answers in it.
  const direct = await call('sessions.create', { agent: 'claude', project: 'webviaproject', permission: 'editar', title: 'Charla con Claude' });
  await page.click('[data-testid=nav-chats]');
  await page.getByText('Charla con Claude').first().click();
  await page.waitForSelector('[data-testid=session-input]');
  await page.fill('[data-testid=session-input]', 'Hola Claude');
  await page.keyboard.press('Enter');
  assert.ok(direct.id);
  await page.waitForSelector('text=Recibido: Hola Claude');
  await page.waitForTimeout(400);
  await noSideScroll('conversación'); await shot('09-conversacion');
  step = 'este móvil';
  await nav('nav-phone');
  await page.waitForSelector('[data-testid=phone-card]');
  await noSideScroll('este móvil'); await shot('10-este-movil');
  // Everything the page and the PC said to each other was encrypted: nothing readable went over the wire.
  assert.ok(sniffed.length > 5, 'hubo tráfico');
  for (const body of sniffed) assert.ok(!/webviaproject|Hola desde el móvil|Recibido/.test(body), `se lee por el camino: ${body.slice(0, 120)}`);
  assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), [], `errores: ${errors.join(' | ')}`);
  console.log('✔ web app del móvil a tamaño de teléfono');
} catch (error) {
  await shot('fallo').catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack}\nerrores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  engine.send({ type: 'shutdown' });
  setTimeout(() => { t.cleanup(); process.exit(); }, 600);
}
