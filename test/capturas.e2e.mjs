// 3.5: screenshots at PC size (1440x900) of the new screens, in a computer's browser linked with a server («centro»):
// Orb mode's chat, the Bots list, the bot editor, a bot's chat with an approval card, Recordatorios, Magic Link with its
// QR and the linked devices → test-results/pc-*.png. Headless Edge (Chromium on Linux); the engine runs with the fake
// agents in a throwaway folder and serves on loopback. The sample bots exist only in that folder.
// Run: npm run build && node test/capturas.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ role: 'centro', mobile: { enabled: true, port, name: 'Servidor' } });
const engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' }, windowsHide: true });
let n = 0; const pending = new Map();
engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
await until(async () => (await call('remote.status')).running, 'acceso del servidor');

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const ctxt = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
const page = await ctxt.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404)/.test(m.text())) errors.push(m.text()); });
const shots = [];
const shot = async (name) => { const file = path.join(OUT, `pc-${name}.png`); await page.waitForTimeout(400); await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((e) => e.remove())); await page.screenshot({ path: file }); shots.push(file); };
let step = 'inicio';
try {
  // The sample bots (only in this test's folder): a chief and two specialists.
  const jefe = await call('bots.create', { name: 'Jefe', icon: '🧠', role_text: 'Recibe lo que pido, lo reparte a los demás y me avisa cuando está.', is_chief: true, tools: ['internet', 'recordatorios'] });
  const agenda = await call('bots.create', { name: 'Agenda', icon: '📅', role_text: 'Llevas mi calendario y mis citas. Avísame la víspera de cada una.', tools: ['recordatorios', 'calendario'], exclusive: ['calendario'], agent: 'codex' });
  await call('bots.create', { name: 'Compras', icon: '🛒', role_text: 'Comparas precios y preparas la compra. Nunca compras sin mi OK.', tools: ['internet', 'navegador'], effort: 'high' });
  const when = new Date(Date.now() + 26 * 3_600_000); const p2 = (x) => String(x).padStart(2, '0');
  const at = (d, h, m) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(h)}:${p2(m)}`;
  await call('bots.reminders.create', { id: agenda.id, text: 'Cita con el dentista', when: at(when, 10, 0) });
  await call('bots.reminders.create', { id: agenda.id, text: 'Revisar la semana', when: at(when, 18, 30), every: 'weekly' });
  await call('bots.reminders.create', { id: jefe.id, text: 'Pagar el alquiler', when: at(new Date(Date.now() + 5 * 86_400_000), 9, 0), every: 'monthly' });
  await call('bots.groups.create', { name: 'Casa', icon: '🏠', members: [jefe.id, agenda.id] });

  step = 'enlazar el navegador';
  const { url } = await call('link.qr');
  await page.goto(`http://127.0.0.1:${port}/${new URL(url).hash}`);
  await page.waitForSelector('[data-testid=chat-input]');
  // 3.5: being a browser does not make it the server's console: the user marks it «Puede administrar».
  const me = (await call('link.devices')).find((d) => d.kind === 'browser');
  assert.equal(me.admin, false, 'sin administrar por defecto');
  await call('link.setAdmin', { id: me.id, admin: true });
  await page.reload();
  await page.waitForSelector('[data-testid=chat-input]');
  assert.equal(await page.locator('[data-testid=mobile-tabs]').count(), 0, 'un navegador de PC lleva el diseño del PC');
  assert.equal(await page.locator('[data-testid=mode-switch]:visible').count(), 1, 'el selector Orb | Bots arriba del menú');

  step = 'chat de Orb';
  await page.fill('[data-testid=chat-input]', 'Hola, ¿qué tal va todo?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Recibido: ');
  await shot('01-orb-chat');

  step = 'lista de bots';
  await page.click('[data-testid=mode-bots]');
  await page.waitForSelector('[data-testid=bots-nav]');
  await page.click('[data-testid=nav-bots]');
  await page.waitForSelector('[data-testid=bot-Compras]');
  assert.ok(await page.locator('[data-testid=bot-Asistente]').count(), 'el bot inicial, sin bots hechos de nadie');
  await shot('02-bots');

  step = 'editor';
  await page.click('[data-testid=bot-edit-Agenda]');
  await page.waitForSelector('[data-testid=bot-editor]');
  assert.equal(await page.inputValue('[data-testid=bot-name]'), 'Agenda');
  await shot('03-editor');

  step = 'chat con tarjeta';
  await page.click('[data-testid=side-bot-Jefe]');
  await page.waitForSelector('[data-testid=bot-chat-input]');
  await page.fill('[data-testid=bot-chat-input]', 'Crea un bot para el correo\nBOT_CALL bot_create {"name":"Correo","icon":"✉️","role_text":"Mira el correo y me resume lo importante","tools":["correo"]}');
  await page.click('[data-testid=send]');
  await page.waitForSelector('[data-testid=bot-card][data-status=pending]', { timeout: 30000 });
  await page.waitForSelector('[data-testid=bot-line]', { timeout: 30000 });
  await shot('04-bot-chat-tarjeta');
  await page.click('[data-testid=bot-card-allow]');
  await page.waitForSelector('[data-testid=bot-card][data-status=done]', { timeout: 20000 });
  await until(async () => (await call('bots.list')).bots.some((b) => b.name === 'Correo'), 'el bot aprobado existe');
  await page.waitForSelector('[data-testid=side-bot-Correo]');

  step = 'recordatorios';
  await page.click('[data-testid=nav-bot-reminders]');
  await page.waitForSelector('text=Cita con el dentista');
  await shot('05-recordatorios');

  step = 'grupo';
  await page.click('[data-testid=side-group-Casa]');
  await page.waitForSelector('[data-testid=bot-chat-input]');
  await page.fill('[data-testid=bot-chat-input]', '¿Qué tenemos mañana?');
  await page.click('[data-testid=send]');
  await page.waitForSelector('[data-testid=bot-line] >> text=Recibido', { timeout: 30000 });
  await shot('06-grupo');

  step = 'magic link';
  await page.click('[data-testid=nav-link]');
  await page.waitForSelector('[data-testid=magic-link]');
  await page.click('[data-testid=link-make]');
  await page.waitForSelector('[data-testid=link-qr]');
  assert.match(await page.textContent('[data-testid=link-code]'), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await shot('07-magic-link-qr');
  step = 'dispositivos';
  await page.locator('[data-testid=link-devices]').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('[data-testid=link-device]').count() >= 1, 'este navegador está en la lista');
  await shot('08-dispositivos');

  step = 'modo recordado';
  // Each mode remembers its last screen: back in Bots, the group's chat; back in Orb, Magic Link.
  await page.reload();
  await page.waitForSelector('[data-testid=magic-link]');
  await page.click('[data-testid=mode-bots]');
  await page.waitForSelector('[data-testid=bot-chat-title] >> text=Casa');
  await page.click('[data-testid=mode-orb]');
  await page.waitForSelector('[data-testid=magic-link]');

  // 3.6: with a second user, the person menu, «¿Para qué usuario?» with the devices of each one, and «Mi perfil».
  step = 'usuarios';
  await call('persons.create', { name: 'Leo' });
  await page.reload();
  await page.waitForSelector('[data-testid=person-menu]');
  await page.click('[data-testid=nav-link]');
  await page.waitForSelector('[data-testid=link-for-who]');
  assert.ok(await page.locator('[data-testid=link-device-group]').count() >= 1, 'los dispositivos, por usuario');
  await shot('09-magic-link-usuarios');
  await page.click('[data-testid=person-menu]');
  await page.click('[data-testid=person-profile]');
  await page.waitForSelector('[data-testid=profile-card]');
  await shot('10-mi-perfil');

  assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), [], `errores: ${errors.join(' | ')}`);
  console.log(`✔ capturas a tamaño de PC:\n${shots.join('\n')}`);
} catch (error) {
  await page.screenshot({ path: path.join(OUT, 'pc-fallo.png') }).catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack}\nerrores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  engine.send({ type: 'shutdown' });
  setTimeout(() => { t.cleanup(); process.exit(); }, 600);
}
