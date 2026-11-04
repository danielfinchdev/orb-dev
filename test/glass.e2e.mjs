// 3.6: the Android app's «glass» look (docs/DESIGN-SYSTEM.md › Android glass), at phone size (390x844, touch), light and
// dark. Builds the Android page (`vite build --mode android`, into a temporary folder) and lets the engine serve that page
// instead of the usual one (ORB_RENDERER), so what is shot is the Android build itself, opened as a linked phone.
// Checks the budget of blurred layers and leaves the screenshots in test-results/diseno/glass-<light|dark>-*.png.
// Headless (Edge without a window on Windows). Run: node test/glass.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results', 'diseno'); fs.mkdirSync(OUT, { recursive: true });
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-glass-'));
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'android', '--outDir', www, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });

const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ mobile: { enabled: true, port } });
const engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_RENDERER: www } });
let n = 0; const pending = new Map();
engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
await until(async () => (await call('remote.status')).running, 'servidor del móvil');

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const ctxt = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
const page = await ctxt.newPage();
// The system's «less transparency» (Windows passes its own setting to Edge) would turn the glass solid: the screenshots
// show the full look; the fallback is checked at the end.
const cdp = await ctxt.newCDPSession(page);
const transparency = (value) => cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });
await transparency('no-preference');
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let scheme = 'light';
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `glass-${scheme}-${name}.png`) }); };
// Blurred layers on screen (backdrop-filter): the tab bar, plus at most one sheet or menu.
const blurred = () => page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => {
  const s = getComputedStyle(el); const r = el.getBoundingClientRect();
  return s.backdropFilter && s.backdropFilter !== 'none' && r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
}).map((el) => el.className.toString().slice(0, 40) || el.tagName));
const tab = async (id) => { await page.locator(`[data-testid=${id}]:visible`).click(); await page.waitForTimeout(400); };
let step = 'inicio';
try {
  await call('projects.create', { name: 'mi-web' });
  await call('projects.setActive', { name: 'mi-web' });
  await call('tasks.create', { project: 'mi-web', title: 'Revisar los enlaces rotos de la portada', description: 'ESCRIBE la portada', agent: 'claude' });
  await call('tasks.create', { project: 'mi-web', title: 'Publicar la web', description: 'haz push a producción', agent: 'codex' });
  await until(async () => (await call('tasks.list')).some((x) => x.status === 'done'), 'tarea hecha', 30000);
  await call('bots.create', { name: 'Jefe', icon: '🧠', role_text: 'Reparte lo que pido', is_chief: true });
  await call('bots.create', { name: 'Agenda', icon: '📅', role_text: 'Mi calendario', tools: ['recordatorios'] });

  step = 'vincular';
  const { url } = await call('remote.pair');
  await page.goto(`http://127.0.0.1:${port}/${new URL(url).hash}`);
  await page.waitForSelector('[data-testid=chat-input]');
  const cls = await page.evaluate(() => document.documentElement.className);
  assert.match(cls, /\bglass\b/, 'la app de Android lleva el aspecto de cristal');
  const lite = /\bglass-lite\b/.test(cls);
  await page.fill('[data-testid=chat-input]', 'Hola desde el móvil');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Recibido: ');

  for (scheme of ['light', 'dark']) {
    step = `${scheme}: tema`;
    await page.evaluate((s) => localStorage.setItem('orb.theme', s === 'dark' ? 'oscuro' : 'claro'), scheme);
    await page.reload();
    await page.waitForSelector('[data-testid=mobile-tabs]');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), scheme === 'dark', `modo ${scheme}`);

    step = `${scheme}: chat`;
    await tab('nav-chats');
    await page.getByText('Desde el móvil').first().click();
    await page.waitForSelector('[data-testid=chat-input]');
    await shot('01-chat');
    const rest = await blurred();
    assert.ok(rest.length <= 1, `capas con desenfoque en reposo: ${rest.join(', ')}`);
    if (!lite) assert.equal(rest.length, 1, 'la barra de pestañas flota con desenfoque');

    step = `${scheme}: menú`;
    await page.locator('[data-testid=project-picker]:visible').click();
    await page.waitForSelector('[data-slot=menu-content]');
    await shot('02-menu');
    assert.ok((await blurred()).length <= 2, 'como mucho una capa pasajera más');
    await page.keyboard.press('Escape');

    step = `${scheme}: nuevo chat`;
    await tab('nav-chats');
    await shot('03-chats');
    await page.locator('[data-testid=new-conversation]:visible').click();
    await page.waitForSelector('[data-testid=chat-greeting]');
    await shot('04-chat-nuevo');

    step = `${scheme}: tareas`;
    await tab('nav-tasks');
    await page.getByRole('tab', { name: /Todas/ }).click();
    await shot('05-tareas');
    await page.getByRole('button', { name: /Publicar la web/ }).first().click();
    await page.waitForSelector('[data-testid=task-detail]');
    await shot('06-tarea');
    step = `${scheme}: hoja`;
    await page.locator('[data-testid=task-detail]').getByRole('button', { name: 'Cancelar' }).first().click();
    await page.waitForSelector('[data-slot=dialog-content]');
    await page.waitForTimeout(400);
    await shot('07-hoja');
    assert.ok((await blurred()).length <= 2, 'la hoja es la única capa pasajera');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    step = `${scheme}: proyectos y más`;
    await tab('nav-projects');
    await shot('08-proyectos');
    await tab('nav-more');
    await shot('09-mas');

    step = `${scheme}: bots`;
    await page.click('[data-testid=mode-bots]');
    await tab('nav-bot-chat');
    await page.waitForSelector('[data-testid=bot-chat-input]');
    await shot('10-bot-chat');
    await tab('nav-bots');
    await page.waitForSelector('[data-testid=bot-Agenda]');
    await shot('11-bots');
    await page.click('[data-testid=mode-orb]');
    await page.waitForSelector('[data-testid=nav-tasks]:visible');
  }
  step = 'menos transparencia';
  await transparency('reduce');
  assert.deepEqual(await blurred(), [], 'con «menos transparencia» no queda ningún desenfoque');
  assert.deepEqual(errors, [], `errores: ${errors.join(' | ')}`);
  console.log(`✔ aspecto de cristal de la app de Android${lite ? ' (versión ligera, sin desenfoque)' : ''}: capturas en test-results/diseno`);
} catch (error) {
  await shot('fallo').catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack}\nerrores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  engine.send({ type: 'shutdown' });
  setTimeout(() => { t.cleanup(); fs.rmSync(www, { recursive: true, force: true }); process.exit(); }, 600);
}
