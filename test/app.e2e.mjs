// End-to-end test of the desktop app with fake agents (no real CLI or account needed).
// Runs the real Electron app (under Xvfb on Linux: `xvfb-run -a npm run test:app`), goes through the first run, the
// assistant's chat (which creates a task through the MCP server), a task run, a direct conversation and every view.
// Screenshots go to test-results/.
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const fake = (name) => path.join(ROOT, 'test', 'fixtures', name);
const electronBin = (await import('electron')).default;
// Playwright also watches the agents' hidden pages and tries to dismiss their alert() boxes, which the app already blocks.
process.on('unhandledRejection', (e) => { if (/No dialog is showing/.test(String(e?.message))) return; console.error(e); process.exitCode = 1; });

// ORB_E2E_EXE: test a packaged build instead of the sources (e.g. dist/linux-unpacked/orb).
const packaged = process.env.ORB_E2E_EXE;
// 2.3: the fake agents live inside the engine (ORB_FAKE_AGENTS), so nothing is launched as a program (also on Windows).
const app = await electron.launch({ executablePath: packaged || electronBin, args: [...(packaged ? [] : [ROOT]), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, ORB_USER_DATA: path.join(tmp, 'datos-app'), ORB_FAKE_AGENTS: fake('fake-live.mjs'), ORB_FAKE_UPDATE: '9.9.9' } });
const errors = [];
const win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await win.setViewportSize({ width: 1360, height: 860 });
const shot = (name) => win.screenshot({ path: path.join(OUT, `${name}.png`) });
const call = (method, params = {}) => win.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
const until = async (fn, what, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await win.waitForTimeout(200); } throw new Error(`no llegó: ${what}`); };
let step = 'inicio';
try {
  // ---- first run
  step = 'primer arranque';
  const button = (name) => win.getByRole('button', { name, exact: true });
  const dialogButton = (name) => win.getByRole('dialog').getByRole('button', { name, exact: true });
  await win.waitForSelector('text=Crear y empezar');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, base);
  await win.locator('input').nth(0).fill('Orb');
  await win.locator('input').nth(1).fill('Ana');
  await win.click('text=Elegir ubicación');
  await win.locator('[data-testid=setup-target]', { hasText: path.join(base, 'Orb') }).waitFor();
  await win.waitForTimeout(500);
  await shot('01-bienvenida');
  await win.click('text=Crear y empezar');
  // On Windows the first run also offers to install the agents ("Preparando tu PC") before the chat.
  await win.getByText('Hola, Ana. Soy Orb.').or(win.getByText('Preparando tu PC')).first().waitFor();
  if (await win.isVisible('text=Preparando tu PC')) { await shot('01b-preparo-equipo'); await win.click('text=Continuar'); }
  await win.waitForSelector('text=Hola, Ana. Soy Orb.');
  const home = path.join(base, 'Orb');
  for (const f of ['orb.json', '.orb/datos/orb.db', 'bitacora/GENERAL.md', 'mcp-servers', 'windows', 'ios', 'android', 'web']) assert.ok(fs.existsSync(path.join(home, f)), `falta ${f}`);
  // The approval secret is kept encrypted by the system when it can be (then the plain file is gone).
  const encrypted = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
  assert.ok(fs.existsSync(path.join(home, '.orb/datos', encrypted ? 'clave.enc' : 'clave.bin')));
  if (encrypted) assert.ok(!fs.existsSync(path.join(home, '.orb/datos/clave.bin')), 'sin clave en texto plano');
  console.log(`  clave de aprobaciones: ${encrypted ? 'cifrada por el sistema' : 'archivo (este sistema no tiene cifrado)'}`);

  // ---- the guided tour (2.6): the robot starts it by itself on the first launch; one step forward, then «Saltar
  // tutorial»; it is remembered in the assistant's folder and never comes back on its own.
  step = 'tutorial guiado';
  await win.locator('[data-testid=tour]').waitFor({ timeout: 10000 });
  await win.locator('[data-testid=tour-counter]', { hasText: /^1 de \d+/ }).waitFor();
  await win.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await win.locator('[data-testid=tour][data-step=chat]').waitFor();
  await win.locator('[data-testid=tour-counter]', { hasText: /^2 de \d+/ }).waitFor();
  await win.locator('[data-testid=tour] .tour-spot').waitFor();
  await win.waitForTimeout(500);
  await shot('01c-tutorial-guiado');
  await win.getByRole('button', { name: 'Saltar tutorial', exact: true }).click();
  await until(async () => (await win.locator('[data-testid=tour]').count()) === 0, 'tutorial cerrado');
  await until(async () => (await call('app.state')).config.ui.tourDone === true, 'tutorial recordado en orb.json');
  await win.waitForTimeout(1500);
  assert.equal(await win.locator('[data-testid=tour]').count(), 0, 'el tutorial no vuelve solo');
  await win.waitForTimeout(400);
  await shot('02-chat-vacio');

  // ---- fake agents
  step = 'agentes falsos';
  await call('config.save', { patch: { agents: { codex: { models: [] }, cursor: { enabled: false }, gemini: { enabled: false }, opencode: { enabled: false }, qwen: { enabled: false }, copilot: { enabled: false } } } });
  assert.equal((await call('agents.status', { refresh: true })).find((a) => a.id === 'claude').installed, true);

  // ---- a project from the chat's project control: a folder in the web category (the default) of the assistant's folder
  step = 'proyecto';
  await win.click('[data-testid=project-picker]');
  await win.getByRole('menuitem', { name: 'Nuevo proyecto' }).click();
  await win.getByRole('dialog').locator('input').fill('webviaproject');
  await dialogButton('Crear proyecto').click();
  await until(async () => (await call('app.state')).activeProject?.name === 'webviaproject', 'proyecto activo');
  assert.ok(fs.existsSync(path.join(home, 'web', 'webviaproject', '.git')), 'D:\\Orb\\webviaproject');
  // A folder created by hand in the Explorer shows up as a project too.
  fs.mkdirSync(path.join(home, 'windows', 'hecha-a-mano'));
  await until(async () => (await call('projects.list')).some((p) => p.name === 'hecha-a-mano'), 'carpeta creada a mano');

  // ---- the assistant creates a task through MCP (identity "orb"), the scheduler runs it
  step = 'chat con el asistente';
  await win.fill('[data-testid=chat-input]', 'CREA_TAREA webviaproject');
  await win.keyboard.press('Enter');
  const task = await until(async () => (await call('tasks.list')).find((t) => t.title === 'Tarea del asistente'), 'tarea creada por el asistente');
  assert.equal(task.created_by, 'orb');
  const finished = await until(async () => { const t = await call('tasks.get', { id: task.id }); return ['done', 'failed', 'blocked'].includes(t.status) && t; }, 'tarea terminada', 30000);
  assert.equal(finished.status, 'done', finished.result);
  assert.ok(fs.existsSync(path.join(home, 'web', 'webviaproject', 'hecho-por-claude.txt')));
  assert.match(fs.readFileSync(path.join(home, 'bitacora', 'proyectos', 'webviaproject.md'), 'utf8'), /Tarea #\d+: Tarea del asistente/);

  // ---- the way back: review, report, OK
  step = 'informe y OK';
  const report = await until(async () => (await call('chat.list')).find((m) => m.role === 'orb' && m.meta?.kind === 'report'), 'informe del asistente', 30000);
  assert.deepEqual(report.meta.tasks, [task.id]);
  await win.waitForSelector('[data-testid=report-actions] >> text=OK');
  await win.waitForTimeout(300);
  await shot('03-informe-con-ok');
  await win.locator('[data-testid=report-actions]').getByRole('button', { name: 'OK' }).click();
  await win.waitForSelector('text=Aceptado');
  assert.equal((await call('tasks.get', { id: task.id })).accepted, true);

  // ---- a risky task typed by the user still waits for its explicit approval
  step = 'aprobaciones';
  const risky = await call('tasks.create', { project: 'webviaproject', title: 'Publicar', description: 'haz push a producción', agent: 'codex' });
  assert.equal(risky.status, 'awaiting_approval');

  // ---- tasks view, undo
  step = 'vista tareas';
  await win.click('[data-testid=nav-tasks]');
  await win.getByRole('tab', { name: /Todas/ }).click();
  await win.getByRole('button', { name: /Tarea del asistente/ }).first().click();
  await win.waitForSelector('[data-testid=task-detail] >> text=Deshacer esta tarea');
  await win.waitForTimeout(300);
  await shot('04-tareas');
  await win.getByRole('button', { name: 'Deshacer esta tarea' }).click();
  await dialogButton('Deshacer').click();
  await until(() => !fs.existsSync(path.join(home, 'web', 'webviaproject', 'hecho-por-claude.txt')), 'deshacer');

  // ---- direct conversation (T3 style) with Codex
  step = 'conversación directa';
  // 2.6: «Nuevo chat» opens a clean chat, no pop-up (clicked twice: still one view, no dialogs on top of each other).
  await win.click('[data-testid=new-conversation]');
  await win.click('[data-testid=new-conversation]');
  await win.waitForSelector('[data-testid=new-chat-input]');
  assert.equal(await win.locator('[role=dialog]').count(), 0, 'sin ventana emergente');
  await win.click('[data-testid=brain-picker]');
  // 2.6: the list comes folded: one group per agent (and «Recomendados» when there are any).
  assert.equal(await win.locator('[data-testid=brain-codex-default]').count(), 0, 'los grupos empiezan plegados');
  await win.click('[data-testid=brain-group-codex]');
  await win.click('[data-testid=brain-codex-default]');
  await win.click('[data-testid=new-chat-orchestrator]');
  await win.locator('[data-testid=permission-picker]').waitFor();
  await shot('05a-nuevo-chat');
  await win.fill('[data-testid=new-chat-input]', 'Hola Codex, ¿qué hay en la carpeta?');
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-testid=session-input]');
  await win.waitForSelector('text=Codex empieza');
  await win.fill('[data-testid=session-input]', 'Y ahora sigue');
  await win.keyboard.press('Enter');
  await win.waitForSelector('text=Codex sigue');
  await win.getByRole('button', { name: /Bash/ }).first().click();
  await win.waitForTimeout(300);
  await shot('05-conversacion-codex');

  // ---- the agent's browser: Claude opens a local page, types and presses a button; the little window shows it live
  step = 'navegador del agente';
  const site = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Prueba</title><body style="font:20px sans-serif;background:#eef"><h1>Web de prueba</h1><script>alert(\'ventana molesta\')</script><input id="q" placeholder="Escribe aquí"><input type="file" id="f"><button onclick="document.getElementById(\'r\').textContent=\'Recibido: \'+document.getElementById(\'q\').value;document.title=\'Enviado\'">Enviar</button><p id="r"></p></body>'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const browsing = await call('sessions.create', { agent: 'claude', project: 'webviaproject', permission: 'editar', title: 'Navegador' });
  await call('sessions.send', { id: browsing.id, text: `NAVEGA http://127.0.0.1:${site.address().port}/` });
  const pip = await until(() => app.windows().find((w) => w.url().endsWith('pip.html')), 'ventanita del navegador');
  const navFile = path.join(home, 'web', 'webviaproject', 'navegador.txt');
  await until(() => fs.existsSync(navFile), 'el agente usó el navegador', 30000);
  const nav = fs.readFileSync(navFile, 'utf8');
  assert.match(nav, /button "Enviar"/, nav);
  assert.match(nav, /Recibido: Hola, navegador/, `escribir y pulsar en la página: ${nav}`);
  assert.match(nav, /captura: [1-9]\d{3,}/, 'captura de pantalla');
  assert.match(nav, /tecla no permitida/, 'solo teclas de la lista');
  assert.match(nav, /no sube archivos/, 'nunca abre el selector de archivos del equipo');
  await pip.waitForSelector('[data-testid=pip] img');
  await pip.waitForTimeout(500);
  await pip.screenshot({ path: path.join(OUT, '05b-ventanita-navegador.png') });
  const bounds = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('pip.html')); return { b: w.getBounds(), top: w.isAlwaysOnTop(), wa: screen.getPrimaryDisplay().workArea }; });
  assert.ok(bounds.top, 'siempre encima');
  assert.ok(bounds.b.x + bounds.b.width > bounds.wa.x + bounds.wa.width - 60 && bounds.b.y < bounds.wa.y + 60, 'arriba a la derecha');
  await pip.getByRole('button', { name: 'Contraer' }).click();
  await until(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('pip.html')).getBounds().height)) < 60, 'contraída');
  await pip.getByRole('button', { name: 'Mostrar' }).click();
  site.close();

  // ---- other views
  step = 'otras vistas';
  for (const [nav, name, wait] of [['nav-projects', '06-proyectos', 'Git y GitHub'], ['nav-agents', '07-agentes', 'Uso de cada cuenta'], ['nav-logs', '08-bitacoras', 'Bitácora general'], ['nav-activity', '09-actividad', 'task.created'], ['nav-tutorials', '08b-tutoriales', 'Preguntas frecuentes']]) {
    await win.click(`[data-testid=${nav}]`);
    await win.waitForSelector(`text=${wait}`);
    await win.waitForTimeout(400);
    await shot(name);
  }
  // Tutoriales (2.6): the search narrows the cards, a question unfolds, and the guided tour starts again from its button
  // (skipped here with Esc).
  await win.fill('[data-testid=help-search]', 'deshacer');
  await until(async () => (await win.locator('[data-testid^=tutorial-]').count()) < 10, 'la búsqueda filtra los tutoriales');
  await win.fill('[data-testid=help-search]', '');
  await win.click('[data-testid=faq-1]');
  await win.waitForSelector('text=Orb usa su programa oficial');
  await win.click('[data-testid=tour-replay]');
  await win.locator('[data-testid=tour]').waitFor();
  await win.keyboard.press('Escape');
  await until(async () => (await win.locator('[data-testid=tour]').count()) === 0, 'tutorial saltado con Esc');

  // ---- Ajustes: a window over the app, with its sections on the left and the developer's GitHub and the version below
  step = 'ajustes';
  await win.click('[data-testid=nav-settings]');
  await win.locator('[data-testid=settings-dialog]').getByText('Nombre del asistente', { exact: true }).waitFor();
  await win.locator('[data-testid=settings-about]', { hasText: '@danielfinchdev' }).waitFor();
  await win.locator('[data-testid=settings-about]', { hasText: /Orb \d+\.\d+\.\d+/ }).waitFor();
  await win.waitForTimeout(400);
  await shot('10-ajustes');
  const section = async (id) => { await win.click(`[data-testid=settings-nav-${id}]`); await win.waitForTimeout(250); };
  await section('apariencia');
  await win.locator('[data-testid=skin-picker]').waitFor();
  await shot('10e-ajustes-apariencia');
  // A visual theme applies at once to the whole app; the professional one has no robot.
  await win.click('[data-testid=skin-retro]');
  await until(async () => (await win.evaluate(() => document.documentElement.dataset.skin)) === 'retro', 'tema retro');
  await until(async () => (await call('app.state')).config.ui.skin === 'retro', 'tema guardado');
  await win.waitForTimeout(400);
  await shot('10f-tema-retro');
  await win.click('[data-testid=skin-profesional]');
  await until(async () => (await win.evaluate(() => document.documentElement.dataset.skin)) === 'profesional', 'tema profesional');
  await win.waitForTimeout(400);
  await shot('10g-tema-profesional');
  await win.click('[data-testid=skin-orb]');
  await until(async () => (await win.evaluate(() => document.documentElement.dataset.skin)) === 'orb', 'vuelve al tema Orb');
  // 2.6: no Windows title bar nor Windows buttons: minimise, maximise and close are the app's own, and the top bars move
  // the window and leave room for them.
  const bar = await win.evaluate(() => { const h = document.querySelector('main header'); const s = getComputedStyle(h); return { wco: navigator.windowControlsOverlay?.visible ?? false, drag: s.getPropertyValue('-webkit-app-region') || s.getPropertyValue('app-region'), pad: parseFloat(s.paddingRight) }; });
  assert.equal(bar.drag, 'drag', 'la cabecera mueve la ventana');
  assert.equal(bar.wco, false, 'sin los botones de Windows');
  assert.ok(bar.pad > 100, `hueco para los botones (${bar.pad} px)`);
  const mainWin = (fn) => app.evaluate(({ BrowserWindow }, f) => { const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html')); return f === 'max' ? w.isMaximized() : w.isMinimized(); }, fn);
  await win.locator('[data-testid=window-close]').waitFor();
  // Maximising needs a window manager: on Windows (and macOS), not in the CI's bare Linux display (xvfb).
  if (process.platform !== 'linux') {
    await win.click('[data-testid=window-maximize]');
    await until(() => mainWin('max'), 'maximizada con el botón propio');
    await win.locator('[data-testid=window-maximize][aria-label=Restaurar]').waitFor();
    await win.click('[data-testid=window-maximize]');
    await until(async () => !(await mainWin('max')), 'restaurada');
  }
  await section('contribuye');
  await win.locator('[data-testid=feedback-message]').waitFor();
  await shot('10h-ajustes-contribuye');
  await section('apps');
  await win.locator('[data-testid=app-open-control-edge]').waitFor();
  await shot('10i-ajustes-mas-apps');
  await section('apariencia');

  // ---- interface size: Ctrl + / Ctrl - / Ctrl 0 and the presets in Ajustes (kept per PC)
  step = 'tamaño de la interfaz';
  const factor = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html')).webContents.getZoomFactor());
  // Keys as Windows sends them (Playwright's own keyboard skips the window's before-input-event, where the app reads them).
  const ctrl = (keyCode) => app.evaluate(({ BrowserWindow }, k) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html')).webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] }), keyCode);
  assert.ok(Math.abs((await factor()) - 1.15) < 0.01, 'por defecto «Normal», algo mayor que antes');
  await ctrl('=');
  await until(async () => Math.abs((await factor()) - 1.1 * 1.15) < 0.01, 'Ctrl + agranda');
  await ctrl('-'); await ctrl('-');
  await until(async () => Math.abs((await factor()) - 0.9 * 1.15) < 0.01, 'Ctrl - reduce');
  await ctrl('0');
  await until(async () => Math.abs((await factor()) - 1.15) < 0.01, 'Ctrl 0 vuelve a normal');
  await win.getByText('Tamaño de la interfaz', { exact: true }).waitFor();
  await win.getByRole('combobox').filter({ hasText: 'Normal' }).click();
  await win.getByRole('option', { name: 'Grande' }).click();
  await until(async () => Math.abs((await factor()) - 1.15 * 1.15) < 0.01, 'tamaño grande');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'datos-app', 'interfaz.json'), 'utf8')).zoom, 1.15);
  await win.waitForTimeout(400);
  await shot('10a-ajustes-grande');
  await ctrl('0');
  // A switch of Ajustes applies at once, also clicking its text (before, it waited for «Guardar»).
  await section('tareas');
  const autoRun = (await call('app.state')).config.autoRun;
  await win.getByText('Iniciar las tareas automáticamente').click();
  await until(async () => (await call('app.state')).config.autoRun === !autoRun, 'interruptor aplicado al momento');
  await win.getByText('Iniciar las tareas automáticamente').click();
  await until(async () => (await call('app.state')).config.autoRun === autoRun, 'y vuelve');
  // 2.6: one slider from maximum saving to maximum use sets every limit; the limits stay under «Opciones avanzadas».
  await win.locator('[data-testid=spend-slider]').fill('0');
  await until(async () => { const c = (await call('app.state')).config; return c.budget.profile === 0 && c.maxParallel === 1 && c.budget.stopAt === 0.75; }, 'máximo ahorro aplicado');
  await win.click('[data-testid=spend-advanced]');
  await shot('10f-ajustes-ahorro');
  await win.locator('[data-testid=spend-slider]').fill('2');
  await until(async () => { const c = (await call('app.state')).config; return c.budget.profile === 2 && c.maxParallel === 3; }, 'vuelve a equilibrado');

  // ---- a new version (ORB_FAKE_UPDATE: no network): the card in the corner and the Updates card in Ajustes
  step = 'actualización';
  await win.evaluate(() => window.orb.update.check()); // the app also checks by itself 15 s after opening
  await win.waitForSelector('[data-testid=update-card] >> text=Hay una versión nueva de Orb: 9.9.9.');
  await section('actualizaciones');
  await win.waitForSelector('[data-testid=updates-card] >> text=Nueva versión disponible: 9.9.9');
  await win.waitForTimeout(500); // the card fades in
  await shot('10c-actualizacion');
  await win.keyboard.press('Escape');
  await until(async () => (await win.locator('[data-testid=settings-dialog]').count()) === 0, 'ajustes cerrado');
  await win.click('[data-testid=nav-chat]'); // in the chat it must not cover the message box
  await win.waitForTimeout(400);
  await shot('10d-actualizacion-chat');
  await win.click('[data-testid=chat-input]');
  await win.locator('[data-testid=update-card]').getByRole('button', { name: 'Cerrar' }).click();
  await until(async () => (await win.locator('[data-testid=update-card]').count()) === 0, 'tarjeta cerrada');

  // ---- left menu (2.6): a click on a project picks it for a new conversation; a double click unfolds its tasks and
  // conversations; each one can be put away in «Completados» (folded at the bottom) and brought back.
  step = 'proyectos del menú';
  const folder = win.locator('[data-testid=folder-webviaproject]');
  await folder.waitFor();
  const firstTask = (await call('tasks.list')).find((x) => x.project === 'webviaproject');
  // The one inside the project (the inbox at the top may list the same task while it waits or works).
  const taskInMenu = win.locator('aside').getByRole('button', { name: firstTask.title }).last();
  if (!(await taskInMenu.isVisible())) await folder.dblclick();
  await taskInMenu.click();
  await win.waitForSelector('[data-testid=task-detail]');
  await win.locator('[data-testid=task-detail]', { hasText: `Tarea #${firstTask.id}` }).waitFor();
  await taskInMenu.hover();
  await win.click(`[data-testid=complete-t${firstTask.id}]`);
  await until(async () => (await call('app.state')).completed?.includes(`t${firstTask.id}`), 'tarea completada');
  await win.click('[data-testid=sidebar-completed]');
  await shot('12b-menu-completados');
  await win.locator(`[data-testid=complete-t${firstTask.id}]`).hover();
  await win.click(`[data-testid=complete-t${firstTask.id}]`);
  await until(async () => !(await call('app.state')).completed?.includes(`t${firstTask.id}`), 'devuelta a su proyecto');
  await folder.click();
  await win.locator('[data-testid=new-chat-input]').waitFor();
  assert.equal((await call('app.state')).activeProject?.name, 'webviaproject', 'un clic elige el proyecto para conversar');

  // ---- expert mode (PC only): turned on in Settings, files, git and panels chosen by the user
  step = 'modo experto';
  await win.click('[data-testid=nav-settings]');
  await section('experto');
  await win.click('[data-testid=expert-switch]');
  await until(async () => (await call('app.state')).config.expert.enabled === true, 'modo experto activado');
  await win.keyboard.press('Escape');
  await win.click('[data-testid=nav-expert]');
  await win.waitForSelector('[data-testid=expert-view]');
  await win.locator('[data-testid=expert-tree]').getByText('navegador.txt').click();
  await win.waitForSelector('[data-testid=expert-viewer] >> text=Recibido: Hola, navegador');
  await win.locator('[data-testid=expert-git]').getByText('navegador.txt').click();
  await win.waitForSelector('[data-testid=expert-diff] >> text=+Página: Prueba');
  await win.waitForSelector('[data-testid=expert-system] >> text=Memoria');
  await win.waitForTimeout(400);
  await shot('10b-modo-experto');
  await win.click('[data-testid=expert-panels]');
  await win.getByRole('menuitem', { name: /Actividad en directo/ }).click();
  await until(async () => (await call('app.state')).config.expert.panels.activity === false, 'panel quitado');
  await win.keyboard.press('Escape');
  await until(async () => (await win.locator('[data-testid=panel-activity]').count()) === 0, 'panel oculto');
  assert.equal((await call('expert.read', { project: 'webviaproject', path: '../../orb.json' }).catch((e) => e.message)).includes('fuera del proyecto'), true);

  // ---- free mode and model choice from the chat
  step = 'modo libre';
  await win.click('[data-testid=nav-chat]');
  await win.click('[data-testid=brain-picker]');
  await win.click('[data-testid=brain-group-rec]');
  await win.click('[data-testid=brain-claude-claude-opus-5-5-rec]');
  await until(async () => (await call('app.state')).config.orchestrator.model === 'claude-opus-5-5', 'modelo Opus');
  // Opus spends the quota faster: the bubble says so.
  await win.locator('[data-testid=usage-bubble]').waitFor();
  await shot('11a-aviso-cupo');
  // 2.6: a clean top bar: icon buttons with their bubble, and the mini-games.
  assert.equal(await win.locator('main header').evaluate((h) => h.innerText.replace(h.querySelector('h1')?.innerText ?? '', '').trim()), '', 'sin nombre, modo ni modelo en la barra');
  await win.hover('[data-testid=bar-pause]');
  await win.locator('[data-testid=bubble-tip]').waitFor();
  await shot('11b-barra-globo');
  await win.click('[data-testid=bar-games]');
  await win.locator('[data-testid=games-dialog]').waitFor();
  await shot('11c-minijuegos');
  for (const game of ['snake', 'tetris', 'chess', 'runner', 'g2048', 'breakout', 'invaders', 'pacman']) {
    await win.click(`[data-testid=game-${game}]`);
    await win.waitForTimeout(500);
    if (game === 'chess') { await win.click('[data-testid=chess-52]'); await win.click('[data-testid=chess-36]'); await win.waitForSelector('text=Te toca', { timeout: 15000 }); }
    else await win.keyboard.press('ArrowUp');
    await win.waitForTimeout(400);
    await shot(`11d-juego-${game}`);
    await win.getByRole('button', { name: 'Volver a los juegos' }).click();
  }
  await win.keyboard.press('Escape');
  await until(async () => (await win.locator('[data-testid=games-dialog]').count()) === 0, 'minijuegos cerrados');
  await win.click('[data-testid=orchestrator-check]');
  await dialogButton('Activar modo libre').click();
  await until(async () => (await call('app.state')).config.orchestrator.orchestrate === false, 'modo libre');
  await win.fill('[data-testid=chat-input]', 'ESCRIBE algo en modo libre');
  await win.keyboard.press('Enter');
  await until(() => fs.existsSync(path.join(home, 'web', 'webviaproject', 'hecho-por-claude.txt')), 'en modo libre trabaja en la carpeta del proyecto');
  await win.waitForTimeout(600);
  await shot('11-chat-modo-libre');

  // ---- night mode from the sun / moon button
  step = 'modo noche';
  const wasDark = await win.evaluate(() => document.documentElement.classList.contains('dark'));
  await win.getByRole('button', { name: 'Cambiar entre modo claro y oscuro' }).click();
  await until(async () => (await win.evaluate(() => document.documentElement.classList.contains('dark'))) !== wasDark, 'cambio día/noche');
  await win.click('[data-testid=nav-tasks]');
  await win.waitForTimeout(500);
  await shot('12-noche-tareas');
  await win.click('[data-testid=nav-chat]');
  await win.waitForTimeout(500);
  await shot('13-noche-chat');

  // ---- a narrow window (the app is responsive; only expert mode needs a wide one)
  step = 'ventana estrecha';
  await win.setViewportSize({ width: 420, height: 860 });
  for (const [nav, name] of [['nav-chat', '14-estrecha-chat'], ['nav-tasks', '15-estrecha-tareas'], ['nav-settings', '16-estrecha-ajustes'], ['nav-agents', '17-estrecha-agentes']]) {
    await win.getByRole('button', { name: 'Menú' }).click();
    await win.locator(`[data-testid=${nav}]:visible`).click();
    await win.waitForTimeout(500);
    const [sw, iw] = await win.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    const wide = sw > iw + 1 ? await win.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(-4).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)} ${Math.round(e.getBoundingClientRect().right)}`).join(' | ')) : '';
    assert.ok(sw <= iw + 1, `${name}: se sale por los lados ${wide}`);
    await shot(name);
    if (nav === 'nav-settings') await win.keyboard.press('Escape');
  }
  await win.getByRole('button', { name: 'Menú' }).click();
  assert.equal(await win.locator('[data-testid=nav-expert]:visible').count(), 0, 'el modo experto necesita una ventana ancha');
  await win.keyboard.press('Escape');
  await until(async () => (await win.locator('[data-testid=nav-tasks]:visible').count()) === 0, 'el menú se cierra con Escape');
  await win.setViewportSize({ width: 1360, height: 860 });

  assert.deepEqual(errors, [], `errores en la página: ${errors.join(' | ')}`);
  console.log(`✔ prueba de la app completa (${fs.readdirSync(OUT).length} capturas en ${OUT})`);
} catch (error) {
  await shot('fallo').catch(() => {});
  console.error(`✖ falló en «${step}»: ${error.stack}\nerrores de la página: ${errors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
