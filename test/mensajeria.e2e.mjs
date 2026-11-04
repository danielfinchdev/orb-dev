// 3.6 (messaging, step M2): the Bots zone as a messaging app, headless. A computer's browser (PC layout, 1440x900, light
// and dark): the chat list (pinned row, sections, unread), a bot's chat with an approval card, its info pane, «Nuevo
// grupo», a group chat with «@» and a chat's menu (right click). A phone browser (390x844) and the Android build (glass):
// the list, the long-press sheet, the chat full screen, the info sheet, a group with «@». Also checks marking read, the
// unread badges, pin/unpin, sections and that the app never blanks (no page errors: the old insertBefore crash).
// Screenshots → test-results/mensajeria/*.png. The engine runs with the fake agents in a throwaway folder on loopback.
// Run: npm run build && node test/mensajeria.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results', 'mensajeria'); fs.mkdirSync(OUT, { recursive: true });
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-mensajeria-'));
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'android', '--outDir', www, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });

const engines = [];
async function engineWith(env = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const t = tempHome({ mobile: { enabled: true, port } });
  const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_FAKE_SCRIPT: path.join(ROOT, 'test', 'fixtures', 'guion-mensajeria.json'), ...env }, windowsHide: true });
  let n = 0; const pending = new Map();
  child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params }); });
  await new Promise((resolve, reject) => { child.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); child.send({ type: 'start', home: t.home, version: 'test' }); });
  await until(async () => (await call('remote.status')).running, 'acceso del servidor');
  const e = { port, call, child, t }; engines.push(e); return e;
}
// The sample: a chief, three bots, a group, a section «Trabajo» with Compras in it, Jefe and the group pinned, and a
// message of Agenda nobody read yet.
async function sample(call) {
  const jefe = await call('bots.create', { name: 'Jefe', avatar: { shape: 'gota', color: 'cielo' }, role_text: 'Reparte lo que pido y me avisa cuando está.', is_chief: true, tools: ['internet', 'recordatorios'] });
  const agenda = await call('bots.create', { name: 'Agenda', avatar: { shape: 'capsula', color: 'melocoton' }, role_text: 'Llevas mi calendario y mis citas.', tools: ['recordatorios', 'calendario'] });
  const compras = await call('bots.create', { name: 'Compras', avatar: { shape: 'mochi', color: 'menta' }, role_text: 'Comparas precios y preparas la compra. Nunca compras sin mi aprobación.', tools: ['internet', 'navegador'] });
  const correo = await call('bots.create', { name: 'Correo', avatar: { shape: 'nube', color: 'agua' }, role_text: 'Me resumes el correo.', tools: ['correo'] });
  const casa = await call('bots.groups.create', { name: 'Casa', members: [jefe.id, agenda.id] });
  const trabajo = await call('inbox.sections.create', { zone: 'bots', name: 'Trabajo' });
  await call('inbox.sections.move', { kind: 'bot', id: compras.id, section: trabajo.id });
  await call('inbox.pin', { kind: 'bot', id: jefe.id });
  await call('inbox.pin', { kind: 'group', id: casa.id });
  // 3.6: real-looking conversations (the fake agents answer from test/fixtures/guion-mensajeria.json).
  for (const [id, text] of [[compras.id, 'Prepara la lista de la compra de la semana'], [jefe.id, 'Hazme el plan de la semana'], [correo.id, '¿Hay algo importante en el correo?']]) {
    await call('bots.send', { id, text });
    await until(async () => (await call('inbox.list', { zone: 'bots' })).items.find((x) => x.kind === 'bot' && x.id === id)?.unread > 0, 'respuesta de ejemplo', 30000);
  }
  await call('bots.send', { id: agenda.id, text: 'Recuérdame la cita del dentista' });
  await until(async () => (await call('inbox.list', { zone: 'bots' })).items.find((x) => x.title === 'Agenda')?.unread > 0, 'Agenda tiene un mensaje sin leer', 30000);
  return { jefe, agenda, compras, casa, trabajo };
}

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
const shots = [];
let step = 'inicio';
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`[${step}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404)|favicon/.test(m.text())) errors.push(`[${step}] ${m.text()}`); });
};
// Toasts are hidden for the picture with a style (never removed by hand: React owns those nodes).
const shooter = (page, prefix) => async (name) => {
  const file = path.join(OUT, `${prefix}-${name}.png`);
  await page.waitForTimeout(450);
  await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important; }' }).then((h) => h.evaluate((el) => { el.id = 'no-toasts'; }));
  await page.screenshot({ path: file }); shots.push(file);
  await page.evaluate(() => document.getElementById('no-toasts')?.remove());
};
const theme = async (page, dark) => { await page.evaluate((d) => { localStorage.setItem('orb.theme', d ? 'oscuro' : 'claro'); }, dark); };

try {
  // ---------------- PC: a computer's browser marked «Puede administrar» ----------------
  step = 'PC: motor';
  const pc = await engineWith();
  const s = await sample(pc.call);
  const ctxt = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
  const page = await ctxt.newPage(); watch(page);
  const { url } = await pc.call('link.qr');
  await page.goto(`http://127.0.0.1:${pc.port}/${new URL(url).hash}`);
  await page.waitForSelector('[data-testid=chat-input]');
  const me = (await pc.call('link.devices')).find((d) => d.kind === 'browser');
  await pc.call('link.setAdmin', { id: me.id, admin: true });

  for (const dark of [false, true]) {
    const scheme = dark ? 'dark' : 'light';
    const shot = shooter(page, `pc-${scheme}`);
    await theme(page, dark);
    await page.reload();
    await page.waitForSelector('[data-testid=mode-switch]');

    step = `PC ${scheme}: insignia y lista`;
    if (!dark) await page.waitForSelector('[data-testid=mode-bots-unread]', { timeout: 15000 });
    await page.click('[data-testid=mode-bots]');
    await page.waitForSelector('[data-testid=bot-inbox]');
    await page.waitForSelector('[data-testid=chat-pinned] [data-testid=pinned-Jefe]');
    assert.equal(await page.locator('[data-testid=chat-pinned] [data-testid=pinned-Casa]').count(), 1, 'el grupo fijado arriba');
    assert.equal(await page.locator('[data-testid=chat-row-Jefe]').count(), 0, 'un fijado no se repite abajo');
    assert.equal(await page.locator('[data-testid=chat-section-Trabajo] [data-testid=chat-row-Compras]').count(), 1, 'Compras en su sección');
    assert.equal(await page.locator('[data-testid=bots-places] [data-testid=nav-bot-reminders]').count(), 1, 'los otros sitios bajo la búsqueda');
    assert.deepEqual(await page.locator('[data-testid=sidebar-footer] .side-foot-icon').evaluateAll((els) => els.map((e) => e.dataset.testid)), ['nav-settings', 'nav-memories', 'nav-tutorials'], 'el pie de siempre');
    if (!dark) assert.ok(Number(await page.getAttribute('[data-testid=chat-row-Agenda]', 'data-unread')) > 0, 'Agenda sin leer');

    step = `PC ${scheme}: chat con tarjeta`;
    await page.click('[data-testid=pinned-Jefe] button >> nth=0');
    await page.waitForSelector('[data-testid=bot-chat-input]');
    if (!dark) {
      await page.fill('[data-testid=bot-chat-input]', 'Pausa a Correo unos días, me voy de vacaciones');
      await page.click('[data-testid=send]');
    }
    await page.waitForSelector('[data-testid=bot-card][data-status=pending]', { timeout: 30000 });
    await page.waitForSelector('[data-testid=day-separator]');
    await shot('01-chat-tarjeta');

    step = `PC ${scheme}: información`;
    await page.click('[data-testid=bot-chat-head]');
    await page.waitForSelector('[data-testid=chat-info] [data-testid=info-brain]');
    await shot('02-info-bot');
    await page.click('[data-testid=chat-info-close]');

    step = `PC ${scheme}: marcar leído`;
    await page.click('[data-testid=side-bot-Agenda]');
    await page.waitForSelector('[data-testid=bot-chat-title] >> text=Agenda');
    await until(async () => (await pc.call('inbox.list', { zone: 'bots' })).items.find((x) => x.title === 'Agenda')?.unread === 0, 'leído al abrirlo', 10000);
    await page.waitForSelector('[data-testid=chat-row-Agenda][data-unread="0"]');
    await shot('03-lista');

    step = `PC ${scheme}: menú de un chat`;
    await page.click('[data-testid=chat-row-Correo]', { button: 'right' });
    await page.waitForSelector('[data-testid=chat-menu-list]');
    await shot('04-menu-chat');
    if (!dark) {
      await page.click('[data-testid=chat-pin]');
      await page.waitForSelector('[data-testid=chat-pinned] [data-testid=pinned-Correo]');
      assert.ok((await pc.call('inbox.list', { zone: 'bots' })).items.find((x) => x.title === 'Correo').pinned, 'fijado');
      await page.click('[data-testid=pinned-Correo]', { button: 'right' });
      await page.click('[data-testid=chat-unpin]');
      await page.waitForSelector('[data-testid=chat-row-Correo]');
    } else await page.keyboard.press('Escape');

    step = `PC ${scheme}: nuevo grupo`;
    if (!dark) {
      await page.click('[data-testid=chats-new]');
      await page.click('[data-testid=group-new]');
      await page.waitForSelector('[data-testid=group-create]');
      await page.click('[data-testid=group-pick-Compras]');
      await page.click('[data-testid=group-pick-Correo]');
      await shot('05-nuevo-grupo-miembros');
      await page.click('[data-testid=group-next]');
      await page.fill('[data-testid=group-name]', 'Recados');
      await shot('06-nuevo-grupo-nombre');
      await page.click('[data-testid=group-create-ok]');
      await page.waitForSelector('[data-testid=bot-chat-title] >> text=Recados');
      assert.ok((await pc.call('bots.groups.list')).some((g) => g.name === 'Recados' && g.members.length === 2), 'grupo creado con sus dos bots');
    }

    step = `PC ${scheme}: grupo con @`;
    await page.click('[data-testid=pinned-Casa] button >> nth=0');
    await page.waitForSelector('[data-testid=bot-chat-title] >> text=Casa');
    if (!dark) {
      await page.fill('[data-testid=bot-chat-input]', '@Agenda ¿qué tengo mañana?');
      await page.click('[data-testid=send]');
      await page.waitForSelector('[data-testid=bot-line-name] >> text=Agenda', { timeout: 30000 });
    }
    await page.fill('[data-testid=bot-chat-input]', 'Y luego @Je');
    await page.waitForSelector('[data-testid=mention-list] >> text=Jefe');
    await shot('07-grupo-mencion');
    await page.keyboard.press('Enter');
    assert.match(await page.inputValue('[data-testid=bot-chat-input]'), /@Jefe $/, 'la mención elegida en el texto');
    await page.fill('[data-testid=bot-chat-input]', '');
    await page.click('[data-testid=bot-chat-head]');
    await page.waitForSelector('[data-testid=group-member-list] [data-testid=group-member-Agenda]');
    await shot('08-info-grupo');
    await page.click('[data-testid=chat-info-close]');

    step = `PC ${scheme}: chat → editor → guardar (sin pantallazo en blanco)`;
    await page.click('[data-testid=side-bot-Agenda]');
    await page.click('[data-testid=bot-chat-head]');
    await page.click('[data-testid=chat-info] [data-testid=bot-chat-edit]');
    await page.waitForSelector('[data-testid=bot-editor]');
    await page.waitForSelector('[data-testid=reasoning-picker]');
    await page.click('[data-testid=bot-save]');
    await page.waitForSelector('[data-testid=bots-list]');
    assert.equal(await page.locator('#root > *').count() > 0, true, 'la app sigue en pantalla');
  }
  await ctxt.close();

  // ---------------- phones: the web (390x844) and the Android build (glass) ----------------
  for (const [kind, env] of [['movil', {}], ['glass', { ORB_RENDERER: www }]]) {
    step = `${kind}: motor`;
    const ph = await engineWith(env);
    await sample(ph.call);
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const p = await pctx.newPage(); watch(p);
    if (kind === 'glass') { const cdp = await pctx.newCDPSession(p); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] }); }
    const { url: purl } = await ph.call('remote.pair');
    await p.goto(`http://127.0.0.1:${ph.port}/${new URL(purl).hash}`);
    await p.waitForSelector('[data-testid=orb-inbox]'); // 3.6 (M3): the phone opens on the Orb zone's chat list
    const dev = (await ph.call('link.devices')).find((d) => d.kind !== 'browser') ?? (await ph.call('link.devices'))[0];
    await ph.call('link.setAdmin', { id: dev.id, admin: true });
    for (const dark of kind === 'glass' ? [false, true] : [false]) {
      const scheme = dark ? 'dark' : 'light';
      const shot = shooter(p, `${kind}-${scheme}`);
      await theme(p, dark);
      await p.reload();
      await p.waitForSelector('[data-testid=nav-menu]:visible');
      step = `${kind} ${scheme}: lista`;
      if (!dark) await p.waitForSelector('[data-testid=nav-menu-dot]', { timeout: 15000 });
      await p.click('[data-testid=nav-menu]:visible'); await p.click('[data-testid=mode-bots]');
      await p.waitForSelector('[data-testid=bot-inbox]');
      await p.waitForSelector('[data-testid=nav-bot-chats]:visible');
      assert.equal(await p.locator('[data-testid=mobile-tabs] button').count(), 3, 'Chats · Recordatorios · Casa');
      if (!dark) await p.waitForSelector('[data-testid=nav-bot-chats-count]');
      await shot('01-lista');

      step = `${kind} ${scheme}: pulsación larga`;
      const row = p.locator('[data-testid=chat-row-Correo]');
      const box = await row.boundingBox();
      await p.mouse.move(box.x + 120, box.y + box.height / 2);
      await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 120, clientY: box.y + box.height / 2, isPrimary: true });
      await p.waitForSelector('[data-testid=chat-sheet]', { timeout: 3000 });
      await row.dispatchEvent('pointerup', { pointerType: 'touch' });
      await p.waitForTimeout(350);
      await shot('02-menu-largo');
      await p.click('[data-testid=chat-move]');
      await p.waitForSelector('[data-testid=chat-sheet] >> text=Trabajo');
      await p.locator('[data-testid=chat-sheet] button', { hasText: 'Trabajo' }).click();
      await p.waitForSelector('[data-testid=chat-section-Trabajo] [data-testid=chat-row-Correo]');
      await ph.call('inbox.sections.move', { kind: 'bot', id: (await ph.call('bots.list')).bots.find((b) => b.name === 'Correo').id, section: null });

      step = `${kind} ${scheme}: chat a pantalla completa`;
      await p.locator('[data-testid=pinned-Jefe] button').first().click();
      await p.waitForSelector('[data-testid=bot-chat-input]');
      assert.equal(await p.locator('[data-testid=mobile-tabs]').count(), 0, 'sin pestañas en una conversación');
      if (!dark) {
        await p.fill('[data-testid=bot-chat-input]', 'Pausa a Correo, me voy de vacaciones');
        await p.click('[data-testid=send]');
      }
      await p.waitForSelector('[data-testid=bot-card][data-status=pending]', { timeout: 30000 });
      await shot('03-chat-tarjeta');
      await p.click('[data-testid=bot-chat-head]');
      await p.waitForSelector('[data-testid=chat-info]'); await p.waitForTimeout(400);
      await shot('04-info');
      await p.click('[data-testid=chat-info-close]'); await p.waitForTimeout(300);
      await p.click('[data-testid=chat-back]');
      await p.waitForSelector('[data-testid=bot-inbox]');

      step = `${kind} ${scheme}: nuevo grupo`;
      await p.click('[data-testid=chats-new]');
      await p.click('[data-testid=group-new]');
      await p.waitForSelector('[data-testid=group-create]');
      await p.click('[data-testid=group-pick-Agenda]');
      await p.click('[data-testid=group-pick-Compras]');
      await shot('05-nuevo-grupo');
      await p.click('[data-testid=group-next]');
      await p.fill('[data-testid=group-name]', dark ? 'Tarde' : 'Mañana');
      await shot('06-nuevo-grupo-nombre');
      await p.click('[data-testid=group-create-ok]');
      await p.waitForSelector(`[data-testid=bot-chat-title] >> text=${dark ? 'Tarde' : 'Mañana'}`);
      await p.fill('[data-testid=bot-chat-input]', '@Compras lista para el sábado');
      await p.click('[data-testid=send]');
      await p.waitForSelector('[data-testid=bot-line-name] >> text=Compras', { timeout: 30000 });
      await p.fill('[data-testid=bot-chat-input]', '@Ag');
      await p.waitForSelector('[data-testid=mention-list] >> text=Agenda');
      await shot('07-grupo-mencion');
      await p.fill('[data-testid=bot-chat-input]', '');
      await p.click('[data-testid=chat-back]');
    }
    await pctx.close();
  }
  assert.deepEqual(errors, [], `errores: ${errors.join(' | ')}`);
  console.log(shots.join('\n'));
  console.log(`✔ mensajería de los bots: ${shots.length} capturas en test-results/mensajeria`);
} catch (error) {
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(OUT, 'fallo.png') }).catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack ?? error}
errores: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  for (const e of engines) e.child.send({ type: 'shutdown' });
  setTimeout(() => { for (const e of engines) e.t.cleanup(); fs.rmSync(www, { recursive: true, force: true }); process.exit(); }, 800);
}
