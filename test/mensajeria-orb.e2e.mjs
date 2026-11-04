// 3.6 (messaging, step M3): the Orb zone as a messaging app, headless. A computer's browser (PC layout, 1440x900, light
// and dark): the chat list grouped by project (each row's latest progress, unread, the places), a conversation with a
// running task as one line and an approval card, the chat's info pane, a project's info, a chat's menu (right click),
// search («#id» finds a task) and a new chat with the composer. A phone browser (390x844) and the Android build (glass):
// the list with the tabs Chats · Tareas · Proyectos, the long-press sheet, the conversation full screen, its info sheet.
// Also checks marking read, pinning and that the app never blanks (no page errors).
// The sample is generic and written straight into the throwaway folder's database (projects mi-web and app-tienda, five
// conversations, a running task, one waiting for approval, finished ones): no agent runs. The engine uses the fake agents
// and serves on loopback. Screenshots → test-results/mensajeria-orb/*.png.
// Run: npm run build && node test/mensajeria-orb.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { openDb } from '../src/core/db.mjs';

const OUT = path.join(ROOT, 'test-results', 'mensajeria-orb'); fs.mkdirSync(OUT, { recursive: true });
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-mensajeria-orb-'));
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

// The sample, written into the engine's database (this process opens the same file; tempHome pointed it here).
async function sample(call) {
  await call('projects.create', { name: 'mi-web', category: 'web', notes: 'La web personal con el blog.' });
  await call('projects.create', { name: 'app-tienda', category: 'web', notes: 'La tienda online.' });
  const board = new Board(openDb());
  const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const line = (role, body, conv, min, meta = null) => { const r = board.addChat(role, body, meta, conv); board.run('UPDATE chat SET at = ? WHERE id = ?', at(min), r.id); return r; };
  const task = (conv, project, title, status, min, extra = {}) => {
    const x = board.createTask({ project, title, description: `${title}.`, agent: 'claude', launch: 'manual', conversation_id: conv, ...extra }, 'usuario');
    if (status !== x.status) board.run('UPDATE tasks SET status = ?, assigned_to = ? WHERE id = ?', status, 'claude', x.id);
    board.run('UPDATE tasks SET updated_at = ?, created_at = ? WHERE id = ?', at(min), at(min + 3), x.id);
    return x;
  };
  const conv = (title, project, min, status = 'open') => { const c = board.createConversation({ title, project, agent: 'claude' }); board.run('UPDATE conversations SET created_at = ?, status = ? WHERE id = ?', at(min), status, c.id); return c; };
  const done = (c, min) => board.run('UPDATE conversations SET updated_at = ? WHERE id = ?', at(min), c.id);

  const blog = conv('Ideas para el blog', null, 7240);
  line('usuario', 'Dame ideas de títulos para el blog', blog.id, 7230);
  line('orb', 'Aquí tienes cinco títulos para el blog: «Cómo ordenar tu semana», «Lo que aprendí al mudarme»…', blog.id, 7229);
  done(blog, 7229);

  const pago = conv('Errores del pago', 'app-tienda', 5800, 'done');
  line('usuario', 'Hay errores al pagar con tarjeta, ¿los miras?', pago.id, 5790);
  line('orb', 'Corregido: el pago con tarjeta ya funciona y las pruebas pasan.', pago.id, 5750);
  task(pago.id, 'app-tienda', 'Corregir los errores del pago', 'done', 5751);
  done(pago, 5750);

  const carrito = conv('Carrito con cupones', 'app-tienda', 4400);
  line('usuario', 'Quiero que el carrito acepte cupones de descuento', carrito.id, 4390);
  line('orb', 'Te propongo un plan en tres pasos: cupones en el carrito, validación al pagar y pruebas. ¿Lo pongo en marcha?', carrito.id, 4388);
  done(carrito, 4388);

  const form = conv('Formulario de contacto', 'mi-web', 1500);
  line('usuario', 'Añade un formulario de contacto a la web', form.id, 1490);
  line('orb', 'Hecho: el formulario envía los mensajes a tu correo y avisa si falta algún dato.', form.id, 1440);
  task(form.id, 'mi-web', 'Formulario de contacto', 'done', 1439);
  done(form, 1439);

  const imgs = conv('Optimizar las imágenes', 'mi-web', 60);
  line('usuario', 'Las imágenes de la portada pesan mucho, optimízalas', imgs.id, 58);
  line('orb', 'Lo hace Claude en una tarea: convertir las imágenes a WebP y ajustar su tamaño.', imgs.id, 57);
  task(imgs.id, 'mi-web', 'Optimizar las imágenes de la portada', 'running', 5);
  done(imgs, 5);

  const links = conv('Revisar los enlaces rotos', 'mi-web', 14);
  line('usuario', 'Revisa los enlaces rotos de la web y arréglalos', links.id, 13);
  line('orb', 'Lo reparto en una tarea para Claude en mi-web: buscar los enlaces, corregirlos y comprobar que la web compila. Te aviso al terminar.', links.id, 12);
  const fix = task(links.id, 'mi-web', 'Corregir los enlaces del blog', 'running', 2);
  const pub = task(links.id, 'mi-web', 'Publicar la web', 'awaiting_approval', 9, { sensitivity: ['publish'] });
  board.run("UPDATE chat SET at = ? WHERE conversation_id = ? AND meta LIKE '%\"kind\":\"attention\"%'", at(9), links.id);
  done(links, 2);
  // Everything so far was read; then one new line of Orbe in «Revisar los enlaces rotos» (unread).
  await call('inbox.list', { zone: 'orb' });
  line('orb', 'Ya he encontrado 12 enlaces rotos; Claude está corrigiéndolos.', links.id, 1);
  done(links, 1);
  await call('inbox.pin', { kind: 'conversation', id: blog.id });
  board.db.close();
  return { links, imgs, form, carrito, pago, blog, fix, pub };
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
const row = (title) => `[data-testid="orb-row-${title}"]`;

try {
  // ---------------- PC: a computer's browser ----------------
  step = 'PC: motor';
  const pc = await engineWith();
  const s = await sample(pc.call);
  const ctxt = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
  const page = await ctxt.newPage(); watch(page);
  const { url } = await pc.call('link.qr');
  await page.goto(`http://127.0.0.1:${pc.port}/${new URL(url).hash}`);
  await page.waitForSelector('[data-testid=orb-inbox]');

  for (const dark of [false, true]) {
    const scheme = dark ? 'dark' : 'light';
    const shot = shooter(page, `pc-${scheme}`);
    await theme(page, dark);
    await page.evaluate(() => localStorage.removeItem('orb.route'));
    await page.reload();
    await page.waitForSelector('[data-testid=mode-switch]');

    step = `PC ${scheme}: lista por proyecto`;
    await page.waitForSelector(`[data-testid=orb-group-mi-web] ${row('Revisar los enlaces rotos')}`);
    assert.equal(await page.locator(`[data-testid=orb-group-app-tienda] ${row('Carrito con cupones')}`).count(), 1, 'cada chat en su proyecto');
    assert.equal(await page.locator(`[data-testid=orb-pinned] ${row('Ideas para el blog')}`).count(), 1, 'el fijado arriba');
    assert.equal(await page.locator(`[data-testid=orb-group-none] ${row('Ideas para el blog')}`).count(), 0, 'un fijado no se repite abajo');
    assert.equal(await page.locator(row('Errores del pago')).count(), 0, 'los completados, ocultos');
    assert.match(await page.textContent(`${row('Revisar los enlaces rotos')} [data-testid=orb-progress]`), /Esperando tu aprobación/);
    assert.match(await page.textContent(`${row('Optimizar las imágenes')} [data-testid=orb-progress]`), new RegExp(`Tarea #${s.imgs.id ? '\\d+' : ''} en curso`));
    assert.match(await page.textContent(`${row('Formulario de contacto')} [data-testid=orb-progress]`), /Completada · Formulario de contacto/);
    assert.match(await page.textContent(`${row('Carrito con cupones')} [data-testid=orb-progress]`), /^Orbe: Te propongo/);
    assert.deepEqual(await page.locator('[data-testid=orb-places] > button').evaluateAll((els) => els.map((e) => e.dataset.testid)), ['nav-tasks', 'nav-projects', 'nav-schedules', 'nav-board'], 'los otros sitios bajo la búsqueda');
    assert.equal(await page.textContent('[data-testid=nav-tasks-count]'), '1', 'una tarea por aprobar');
    assert.deepEqual(await page.locator('[data-testid=sidebar-footer] .side-foot-icon').evaluateAll((els) => els.map((e) => e.dataset.testid)), ['nav-settings', 'nav-memories', 'nav-tutorials'], 'el pie de siempre');
    if (!dark) assert.equal(await page.getAttribute(row('Revisar los enlaces rotos'), 'data-unread'), '1', 'una línea sin leer');
    await page.hover(row('Optimizar las imágenes'));
    await shot('01-lista');

    step = `PC ${scheme}: chat con tarea y tarjeta`;
    await page.click(`${row('Revisar los enlaces rotos')} button >> nth=0`);
    await page.waitForSelector('[data-testid=task-line][data-status=running]');
    await page.waitForSelector('[data-testid=chat-task-approval][data-status=awaiting_approval] [data-testid=chat-task-approve]');
    assert.match(await page.textContent('[data-testid=chat-task-approval]'), /«Publicar la web» necesita tu aprobación/);
    assert.match(await page.textContent('[data-testid=orb-chat-status]'), /mi-web · Esperando tu aprobación/);
    assert.equal(await page.locator('[data-testid=live-strip]').count(), 0, 'las tareas en una línea, no en un bloque aparte');
    assert.doesNotMatch(await page.textContent('[data-testid=chat-lines]'), /orb_|BOT_CALL|\{"/, 'sin llamadas de herramientas a la vista');
    await page.waitForSelector('[data-testid=reasoning-picker]');
    if (!dark) await until(async () => (await pc.call('inbox.list', { zone: 'orb' })).items.find((x) => x.id === s.links.id)?.unread === 0, 'leído al abrirlo', 10000);
    await page.waitForSelector(`${row('Revisar los enlaces rotos')}[data-unread="0"]`);
    await page.mouse.move(700, 300);
    await shot('02-chat-tarea-tarjeta');

    step = `PC ${scheme}: información del chat`;
    await page.click('[data-testid=orb-chat-head]');
    await page.waitForSelector('[data-testid=chat-info] [data-testid=info-tasks]');
    assert.equal(await page.locator(`[data-testid=chat-info] [data-testid=info-task-${s.pub.id}]`).count(), 1, 'sus tareas');
    assert.equal(await page.locator('[data-testid=chat-info] [data-testid=info-export]').count(), 1);
    await shot('03-info-chat');
    if (!dark) {
      await page.click('[data-testid=info-pin]');
      await page.waitForSelector(`[data-testid=orb-pinned] ${row('Revisar los enlaces rotos')}`);
      await page.click('[data-testid=info-unpin]');
      await page.waitForSelector(`[data-testid=orb-group-mi-web] ${row('Revisar los enlaces rotos')}`);
    }

    step = `PC ${scheme}: información del proyecto`;
    await page.click('[data-testid=chat-info] [data-testid=info-project]');
    await page.waitForSelector('[data-testid=project-info-panel]');
    assert.equal(await page.locator('[data-testid=project-info-log]').count(), 1, 'la bitácora del proyecto');
    await shot('04-info-proyecto');
    await page.click('[data-testid=chat-info-close]');
    await until(async () => (await page.locator('[data-testid=chat-info]').count()) === 0, 'panel cerrado');

    step = `PC ${scheme}: menú de un chat`;
    await page.click(row('Formulario de contacto'), { button: 'right' });
    await page.waitForSelector('[data-testid=chat-menu-list]');
    await shot('05-menu-chat');
    await page.keyboard.press('Escape');

    step = `PC ${scheme}: buscar`;
    await page.fill('[data-testid=sidebar-search-input]', `#${s.fix.id}`);
    await page.waitForSelector(`[data-testid=sidebar-results] [data-testid=item-t${s.fix.id}]`);
    await page.fill('[data-testid=sidebar-search-input]', 'enlaces');
    await page.waitForSelector(`[data-testid=sidebar-results] ${row('Revisar los enlaces rotos')}`);
    await page.fill('[data-testid=sidebar-search-input]', '');

    step = `PC ${scheme}: completados`;
    await page.click('[data-testid=sidebar-completed]');
    await page.waitForSelector(row('Errores del pago'));
    await page.click('[data-testid=sidebar-completed]');

    step = `PC ${scheme}: nuevo chat`;
    await page.click('[data-testid=chats-new]');
    await page.click('[data-testid=new-conversation]');
    await page.waitForSelector('[data-testid=chat-greeting]');
    await page.waitForSelector('[data-testid=orchestrator-check]');
    await page.mouse.move(700, 300);
    await shot('06-chat-nuevo');

    step = `PC ${scheme}: pantallas de siempre`;
    await page.click('[data-testid=orb-places] [data-testid=nav-tasks]');
    await page.waitForSelector('[data-testid=task-detail], [data-testid=tasks-list], main h1');
    await shot('07-tareas');
  }
  await ctxt.close();

  // ---------------- phones: the web (390x844) and the Android build (glass) ----------------
  for (const [kind, env] of [['movil', {}], ['glass', { ORB_RENDERER: www }]]) {
    step = `${kind}: motor`;
    const ph = await engineWith(env);
    const ps = await sample(ph.call);
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const p = await pctx.newPage(); watch(p);
    if (kind === 'glass') { const cdp = await pctx.newCDPSession(p); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] }); }
    const { url: purl } = await ph.call('remote.pair');
    await p.goto(`http://127.0.0.1:${ph.port}/${new URL(purl).hash}`);
    await p.waitForSelector('[data-testid=orb-inbox]');
    for (const dark of kind === 'glass' ? [false, true] : [false]) {
      const scheme = dark ? 'dark' : 'light';
      const shot = shooter(p, `${kind}-${scheme}`);
      await theme(p, dark);
      await p.evaluate(() => localStorage.removeItem('orb.route'));
      await p.reload();

      step = `${kind} ${scheme}: lista`;
      await p.waitForSelector(`[data-testid=orb-group-mi-web] ${row('Revisar los enlaces rotos')}`);
      assert.deepEqual(await p.locator('[data-testid=mobile-tabs] button').evaluateAll((els) => els.map((e) => e.dataset.testid)), ['nav-chats', 'nav-tasks', 'nav-projects'], 'Chats · Tareas · Proyectos');
      assert.equal(await p.locator('[data-testid=nav-menu]:visible').count(), 1, '☰ arriba');
      if (!dark) await p.waitForSelector('[data-testid=nav-chats-count]');
      await shot('01-lista');

      step = `${kind} ${scheme}: pulsación larga`;
      const r = p.locator(row('Carrito con cupones'));
      const box = await r.boundingBox();
      await r.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 120, clientY: box.y + box.height / 2, isPrimary: true });
      await p.waitForSelector('[data-testid=chat-sheet]', { timeout: 3000 });
      await r.dispatchEvent('pointerup', { pointerType: 'touch' });
      await p.waitForTimeout(350);
      await shot('02-menu-largo');
      await p.keyboard.press('Escape');
      await until(async () => (await p.locator('[data-testid=chat-sheet]').count()) === 0, 'hoja cerrada');

      step = `${kind} ${scheme}: conversación a pantalla completa`;
      await p.locator(`${row('Revisar los enlaces rotos')} button`).first().click();
      await p.waitForSelector('[data-testid=chat-task-approval] [data-testid=chat-task-approve]');
      await p.waitForSelector('[data-testid=task-line]');
      assert.equal(await p.locator('[data-testid=mobile-tabs]').count(), 0, 'sin pestañas en una conversación');
      assert.equal(await p.locator('[data-testid=chat-back]').count(), 1, 'flecha atrás');
      await shot('03-chat');
      await p.click('[data-testid=orb-chat-head]');
      await p.waitForSelector('[data-testid=chat-info] [data-testid=info-tasks]'); await p.waitForTimeout(400);
      await shot('04-info');
      await p.click('[data-testid=chat-info-close]'); await p.waitForTimeout(300);
      await p.click('[data-testid=chat-back]');
      await p.waitForSelector('[data-testid=orb-inbox]');

      step = `${kind} ${scheme}: pestaña Tareas y ☰`;
      await p.click('[data-testid=nav-tasks]');
      await p.waitForSelector('[data-testid=mobile-tabs] [data-testid=nav-tasks][aria-current=page]');
      await shot('05-tareas');
      await p.click('[data-testid=nav-menu]:visible');
      await p.waitForSelector('[data-testid=mobile-menu] [data-testid=nav-schedules]');
      await p.waitForTimeout(350);
      await shot('06-menu');
      await p.keyboard.press('Escape');
      await p.click('[data-testid=nav-chats]');
      void ps;
    }
    await pctx.close();
  }
  assert.deepEqual(errors, [], `errores: ${errors.join(' | ')}`);
  console.log(shots.join('\n'));
  console.log(`✔ mensajería de Orb: ${shots.length} capturas en test-results/mensajeria-orb`);
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
