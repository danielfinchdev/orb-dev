// 3.8.7: chat tabs, split view and shortcuts in a computer's browser (PC layout, 1440x900), headless.
// Ctrl+click opens a second tab, the bar appears, «Dividir» shows two chats side by side, keys move between them, the last
// tab closed leaves the empty state, the tabs come back after a reload, and the themes (Órbita, Cristal, Grafito) draw the bar.
// Screenshots → test-results/pestanas-387/*.png. Run: npm run build && node test/pestanas-387.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { openDb } from '../src/domain/data/db.mjs';
import { pairBrowser, TEST_MASTER } from './fixtures/e2e-flows.mjs';

const OUT = path.join(ROOT, 'test-results', 'pestanas-387'); fs.mkdirSync(OUT, { recursive: true });
const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ mobile: { enabled: true, port } });
const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' }, windowsHide: true });
let n = 0; const pending = new Map();
child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error)); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { child.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); child.send({ type: 'start', home: t.home, version: 'test' }); });
await until(async () => (await call('remote.status')).running, 'acceso del servidor');
await call('master.create', { password: TEST_MASTER });

const board = new Board(openDb());
const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
for (const [title, min] of [['Ideas para el blog', 30], ['Errores del pago', 20], ['Carrito con cupones', 10]]) {
  const c = board.createConversation({ title, project: null, agent: 'claude' });
  const u = board.addChat('usuario', `Hola, ${title}`, null, c.id); board.run('UPDATE chat SET at = ? WHERE id = ?', at(min), u.id);
  const o = board.addChat('orb', `Aquí tienes lo de «${title}».`, null, c.id); board.run('UPDATE chat SET at = ? WHERE id = ?', at(min - 1), o.id);
  board.run('UPDATE conversations SET updated_at = ? WHERE id = ?', at(min - 1), c.id);
}
board.db.close();

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404)|favicon/.test(m.text())) errors.push(m.text()); });
  const { url, pc: fp } = await call('link.qr', { device: 'browser' });
  await pairBrowser(page, `http://127.0.0.1:${port}/${new URL(url).hash}`, { fp, ready: '[data-testid=orb-inbox]' });
  const shot = async (name) => { await page.waitForTimeout(400); await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' }); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };
  const row = (title) => page.locator(`[data-testid="orb-row-${title}"]`);
  const tabs = () => page.locator('[data-testid=chat-tabs] [role=tab]');
  const count = (sel) => page.locator(sel).count();

  await row('Ideas para el blog').click();
  assert.equal(await count('[data-testid=chat-tabs]'), 0, 'one chat: no bar, the chat is as before');
  await row('Errores del pago').click({ modifiers: ['Control'] });
  await page.locator('[data-testid=chat-tabs]').waitFor();
  assert.equal(await tabs().count(), 2);
  assert.equal(await tabs().nth(1).getAttribute('aria-selected'), 'true');
  await shot('tabs-2');

  // «Dividir»: two chats side by side; the divider moves with the keyboard
  await page.getByRole('button', { name: /Dividir/ }).click();
  const divider = page.locator('[data-testid=split-divider]');
  await divider.waitFor();
  assert.equal(await count('[data-testid^=pane-]'), 2);
  await divider.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await divider.getAttribute('aria-valuenow'), '55');
  await shot('split');

  // keys: Ctrl+T a new tab, Ctrl+W closes it, Ctrl+\ removes the split
  await page.keyboard.press('Control+t');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=chat-tabs] [role=tab]').length === 3);
  await page.keyboard.press('Control+w');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=chat-tabs] [role=tab]').length === 2);
  await page.keyboard.press('Control+Alt+ArrowRight');
  await page.keyboard.press('Control+\\');
  await page.waitForFunction(() => !document.querySelector('[data-testid=split-divider]'));

  // reload: the two tabs come back
  await page.reload();
  await page.locator('[data-testid=chat-tabs]').waitFor();
  assert.equal(await tabs().count(), 2);

  // the themes keep the bar readable (look at the pictures)
  for (const skin of ['cristal', 'predeterminado', 'orb']) {
    await call('config.save', { patch: { ui: { skin } } });
    await page.reload();
    await page.locator('[data-testid=chat-tabs]').waitFor();
    await shot(`tema-${skin}`);
  }

  // close everything: the empty state, then a new chat
  while (await tabs().count()) { await page.keyboard.press('Control+w'); await page.waitForTimeout(200); }
  await page.keyboard.press('Control+w'); // the last chat: the bar is gone, the chat closes
  await page.locator('[data-testid=tabs-empty]').waitFor();
  await shot('vacio');
  await page.getByRole('button', { name: 'Nuevo chat' }).click();
  await page.waitForSelector('[data-testid=tabs-empty]', { state: 'detached' });
  assert.deepEqual(errors, [], 'no page errors');
  console.log('pestañas: OK');
} finally {
  await browser.close(); child.kill();
  fs.rmSync(t.home, { recursive: true, force: true });
}
