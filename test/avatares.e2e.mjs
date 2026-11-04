// 3.6: the bots' avatars in the product (components/bot-avatar.jsx, DESIGN-SYSTEM §2.5), headless. A computer's browser
// (PC layout, 1440x900): the bots list with avatars (a chief with its star, a paused one asleep), «Nuevo bot» (preview,
// shapes, colours) and the bot it makes, the editor's avatar part, a group's composite avatar; a phone browser
// (390x844): «Nuevo bot» on the whole screen; the Android build (glass): the same sheet, light and dark.
// Screenshots → test-results/avatares/*.png. The engine runs with the fake agents in a throwaway folder on loopback.
// Run: npm run build && node test/avatares.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results', 'avatares'); fs.mkdirSync(OUT, { recursive: true });
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-avatares-'));
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'android', '--outDir', www, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });

const engines = [];
async function engineWith(env = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port } });
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ...env }, windowsHide: true });
  let n = 0; const pending = new Map();
  child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params }); });
  await new Promise((resolve, reject) => { child.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); child.send({ type: 'start', home: t.home, version: 'test' }); });
  await until(async () => (await call('remote.status')).running, 'acceso del servidor');
  const e = { port, call, child, t }; engines.push(e); return e;
}
// The same sample bots on each engine (only in its throwaway folder).
async function sampleBots(call) {
  const jefe = await call('bots.create', { name: 'Jefe', avatar: { shape: 'estrella', color: 'limon' }, role_text: 'Reparte lo que pido y me avisa cuando está.', is_chief: true });
  const agenda = await call('bots.create', { name: 'Agenda', avatar: { shape: 'gota', color: 'lavanda' }, role_text: 'Llevas mi calendario y mis citas.', tools: ['recordatorios', 'calendario'] });
  await call('bots.create', { name: 'Compras', avatar: { shape: 'bollo', color: 'melocoton' }, role_text: 'Comparas precios y preparas la compra.', tools: ['internet'] });
  await call('bots.create', { name: 'Correo', avatar: { shape: 'nube', color: 'agua' }, role_text: 'Me resumes el correo.', paused: true });
  await call('bots.groups.create', { name: 'Casa', members: [jefe.id, agenda.id] });
}

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
const shots = [];
const watch = (page) => { page.on('pageerror', (e) => errors.push(`[${step}] ${e.message} @ ${page.url().slice(-30)} ${String(e.stack).split(String.fromCharCode(10)).slice(0, 4).join(' / ')}`)); page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404)|favicon/.test(m.text())) errors.push(m.text()); }); };
const shooter = (page, prefix) => async (name) => {
  const file = path.join(OUT, `${prefix}-${name}.png`);
  await page.waitForTimeout(450);
  await page.evaluate(() => { const st = document.createElement('style'); st.id = 'no-toasts'; st.textContent = '[data-sonner-toaster] { visibility: hidden !important; }'; document.head.append(st); });
  await page.screenshot({ path: file }); shots.push(file); await page.evaluate(() => document.getElementById('no-toasts')?.remove());
};
const EMOJI = /\p{Extended_Pictographic}/u;
let step = 'inicio';
try {
  // ---------------- PC (a computer's browser marked «Puede administrar») ----------------
  step = 'PC: motor';
  const pc = await engineWith();
  await sampleBots(pc.call);
  const ctxt = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
  const page = await ctxt.newPage(); watch(page);
  const shot = shooter(page, 'pc');
  const { url } = await pc.call('link.qr');
  await page.goto(`http://127.0.0.1:${pc.port}/${new URL(url).hash}`);
  await page.waitForSelector('[data-testid=chat-input]');
  const me = (await pc.call('link.devices')).find((d) => d.kind === 'browser');
  await pc.call('link.setAdmin', { id: me.id, admin: true });
  await page.reload();
  await page.waitForSelector('[data-testid=chat-input]');

  step = 'PC: lista de bots';
  await page.click('[data-testid=mode-bots]');
  await page.waitForSelector('[data-testid=bots-nav]');
  await page.click('[data-testid=bots-places-more]'); await page.click('[data-testid=nav-bots]');
  await page.waitForSelector('[data-testid=bot-Compras]');
  const card = (name) => page.locator(`[data-testid=bot-${name}] [data-testid=bot-avatar]`);
  assert.equal(await card('Agenda').getAttribute('data-avatar'), 'gota:lavanda');
  assert.equal(await card('Correo').getAttribute('data-state'), 'paused', 'en pausa: dormido');
  assert.equal(await page.locator('[data-testid=bot-Jefe] [data-testid=avatar-chief]').count(), 1, 'el jefe, con su estrella');
  assert.equal(await page.locator('[data-testid=bot-Agenda] [data-testid=avatar-chief]').count(), 0);
  assert.ok(await page.locator('[data-testid=side-group-Casa] [data-testid=group-avatar][data-members="2"]').count(), 'el grupo: sus miembros juntos');
  assert.doesNotMatch(await page.textContent('[data-testid=bots-nav]'), EMOJI, 'sin emojis en el menú de bots');
  assert.doesNotMatch(await page.textContent('[data-testid=bots-list]'), EMOJI, 'sin emojis en la lista');
  await shot('01-lista-bots');

  step = 'PC: nuevo bot';
  await page.click('[data-testid=bots-new]');
  await page.waitForSelector('[data-testid=bot-create]');
  assert.equal(await page.locator('[data-testid=avatar-shapes] [role=radio]').count(), 12);
  assert.equal(await page.locator('[data-testid=avatar-colors] [role=radio]').count(), 10);
  assert.ok(await page.isDisabled('[data-testid=bot-create-ok]'), 'sin nombre no se crea');
  await page.fill('[data-testid=bot-create-name]', 'Lector');
  await page.click('[data-testid=avatar-shape-corazon]');
  await page.click('[data-testid=avatar-color-rosa]');
  assert.equal(await page.getAttribute('[data-testid=bot-create-preview] .bav-wrap', 'data-avatar'), 'corazon:rosa', 'la vista previa sigue lo elegido');
  assert.equal(await page.getAttribute('[data-testid=bot-create-preview] .bav-wrap', 'data-state'), 'happy', 'y salta al cambiar');
  // The shapes' grid by keyboard: an arrow moves the choice.
  await page.focus('[data-testid=avatar-shape-corazon]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('[data-testid=avatar-shape-hoja]', 'aria-checked'), 'true', 'con las flechas');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(2000); // back to idle for the picture
  await shot('02-nuevo-bot');
  await page.click('[data-testid=bot-create-ok]');
  await page.waitForSelector('[data-testid=bot-chat-title] >> text=Lector');
  const made = (await pc.call('bots.list')).bots.find((b) => b.name === 'Lector');
  assert.deepEqual(made.avatar, { shape: 'corazon', color: 'rosa' }, 'creado con el avatar elegido');
  assert.equal(await page.getAttribute('[data-testid=side-bot-Lector] [data-testid=bot-avatar]', 'data-avatar'), 'corazon:rosa');
  await shot('03-chat-bot-nuevo');

  step = 'PC: el bot trabaja y contesta';
  await page.fill('[data-testid=bot-chat-input]', 'Hola');
  await page.click('[data-testid=send]');
  await page.waitForSelector('[data-testid=bot-line]', { timeout: 30000 });
  await shot('04-chat-respuesta');

  step = 'PC: editor';
  await page.click('[data-testid=bot-chat-head]'); // 3.6 (M2): «Editar» is in the bot's info
  await page.click('[data-testid=bot-chat-edit]');
  await page.waitForSelector('[data-testid=bot-editor]');
  await page.click('[data-testid=avatar-color-menta]');
  assert.equal(await page.getAttribute('[data-testid=bot-avatar-preview] .bav-wrap', 'data-avatar'), 'corazon:menta');
  await page.waitForTimeout(2000);
  await shot('05-editor-avatar');
  await page.click('[data-testid=bot-save]');
  await until(async () => (await pc.call('bots.list')).bots.find((b) => b.name === 'Lector')?.avatar?.color === 'menta', 'el color guardado');

  step = 'PC: grupo';
  await page.click('[data-testid=side-group-Casa]');
  await page.waitForSelector('[data-testid=bot-chat-title] >> text=Casa');
  assert.ok(await page.locator('header [data-testid=group-avatar], [data-testid=bot-chat-lines] [data-testid=group-avatar]').count() >= 1);
  await shot('06-grupo');
  await page.click('[data-testid=bots-places-more]'); await page.click('[data-testid=nav-bot-groups]');
  await page.waitForSelector('[data-testid=group-Casa]');
  await shot('07-grupos');
  await ctxt.close();

  // ---------------- Phone browser and Android (glass) ----------------
  for (const [kind, env] of [['movil', {}], ['glass', { ORB_RENDERER: www }]]) {
    step = `${kind}: motor`;
    const ph = await engineWith(env);
    await sampleBots(ph.call);
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const p = await pctx.newPage(); watch(p);
    const cdp = await pctx.newCDPSession(p);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    const { url: pair } = await ph.call('remote.pair');
    await p.goto(`http://127.0.0.1:${ph.port}/${new URL(pair).hash}`);
    await p.waitForSelector('[data-testid=chat-input]');
    const phone = (await ph.call('link.devices')).find((d) => d.kind === 'phone') ?? (await ph.call('link.devices'))[0];
    await ph.call('link.setAdmin', { id: phone.id, admin: true });
    for (const scheme of kind === 'glass' ? ['light', 'dark'] : ['light']) {
      step = `${kind} ${scheme}: lista`;
      await p.evaluate((s) => localStorage.setItem('orb.theme', s === 'dark' ? 'oscuro' : 'claro'), scheme);
      await p.reload();
      await p.waitForSelector('[data-testid=mobile-tabs]');
      if (kind === 'glass') assert.match(await p.evaluate(() => document.documentElement.className), /\bglass\b/, 'la app de Android, con cristal');
      await p.click('[data-testid=nav-menu]:visible'); await p.click('[data-testid=mode-bots]');
      await p.waitForSelector('[data-testid=bot-inbox]'); await p.waitForTimeout(400);
      await p.click('[data-testid=nav-menu]:visible'); await p.click('[data-testid=nav-bots]:visible');
      await p.waitForSelector('[data-testid=bot-Compras]');
      const s = shooter(p, `${kind}-${scheme}`);
      await s('01-lista-bots');
      step = `${kind} ${scheme}: nuevo bot`;
      await p.click('[data-testid=bots-new]:visible');
      await p.waitForSelector('[data-testid=bot-create]');
      const box = await p.locator('[data-testid=bot-create]').boundingBox();
      assert.ok(box.width >= 389 && box.height >= 800, `en el móvil ocupa la pantalla (${JSON.stringify(box)})`);
      await p.fill('[data-testid=bot-create-name]', 'Lector');
      await p.click('[data-testid=avatar-shape-gota]');
      await p.click('[data-testid=avatar-color-lavanda]');
      await p.waitForTimeout(2000);
      const ok = await p.locator('[data-testid=bot-create-ok]').boundingBox();
      assert.ok(ok.y + ok.height <= 844 && ok.y > 600, `«Crear bot» abajo, a mano (${JSON.stringify(ok)})`);
      const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert.ok(w[0] <= w[1] + 1, 'nada se sale por los lados');
      await s('02-nuevo-bot');
      await p.click('[data-testid=bot-create-close]');
      await p.waitForSelector('[data-testid=bot-create]', { state: 'detached' });
    }
    await pctx.close();
  }

  assert.deepEqual(errors, [], `errores: ${errors.join(' | ')}`);
  console.log(`✔ avatares:\n${shots.join('\n')}`);
} catch (error) {
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(OUT, 'fallo.png') }).catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack}\nerrores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  for (const e of engines) e.child.send({ type: 'shutdown' });
  setTimeout(() => { for (const e of engines) e.t.cleanup(); fs.rmSync(www, { recursive: true, force: true }); process.exit(); }, 800);
}
