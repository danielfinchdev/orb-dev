// Exploratory pass over Orb (no agents needed): the welcome screen and the first run («Preparando tu PC»), every view in
// day and night, each section of Ajustes, the five visual themes, a narrow window and the settings' switches and checks,
// with screenshots in test-results/explora/ (explora-en/ with ORB_LANG=en) and the page errors collected. Not an
// assertion test: it is for looking at. On the test build of Orb, hidden (test/fixtures/launch-orb.mjs):
//   npm run tauri:build:e2e && node test/explora.e2e.mjs
// The assistant's folder is seeded with demo data like the mockups' (projects with a git repository, chats with fake
// agents, tasks, a schedule, a chat with Orbe) before the pictures, so the sidebar, the chat and its side panel have
// something to show. Everything lives in the temp folder; ORB_EXPLORA_SEED=0 skips it (the empty profile of before).
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/domain/workspace/home.mjs';
import { loadConfig, merge } from '../src/platform/config-file.mjs';
import { writeJson } from '../src/platform/paths.mjs';
import { SKINS, darkOnlySkin, lightOnlySkin } from '../src/shared/appearance.mjs';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';
import { launchOrb } from './fixtures/launch-orb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANG = process.env.ORB_LANG || '';
const OUT = path.join(ROOT, 'test-results', LANG ? `explora-${LANG}` : 'explora'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-explora-'));
const until = async (fn, what, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };
const notes = [];
// Every Orb this run opens: a failed step closes them all, so the run always ends.
const opened = [];
// A run that hangs (a control that never shows) ends by itself: it closes its Orbs and exits with an error.
setTimeout(async () => { console.error('✖ tiempo máximo agotado'); for (const stop of opened) { try { await stop(); } catch { /* already closed */ } } process.exit(2); }, Number(process.env.ORB_EXPLORA_MAX_MIN || 12) * 60000).unref();
// ORB_EXPLORA_SIZE=1440x880 gives every picture that window size (the mockups' size).
const SIZE = /^(\d+)x(\d+)$/.exec(process.env.ORB_EXPLORA_SIZE || '');
const note = (s) => { notes.push(s); console.log(`  · ${s}`); };

// Orb's window over CDP: the pictures and the window size go through the page (the window itself stays hidden).
async function open(userData, env = {}) {
  const orb = await launchOrb({ userData, env: { ...sandboxEnv(tmp), ...env } });
  const page = orb.page; const stop = () => orb.close();
  opened.push(stop);
  // Pictures show the themes as designed: a PC with Windows' transparency effects off would drop Cristal's blur.
  try { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] }); } catch { /* an older WebView2: the pictures follow the system's setting */ }
  if (SIZE) await page.setViewportSize({ width: Number(SIZE[1]), height: Number(SIZE[2]) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  return { page, errors, close: stop };
}
// The page's picture (with the interface zoom).
const shooter = (page) => async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};
// Ajustes closes with Escape; if it does not (noted: that is a finding), the X closes it so the tour goes on.
const closeSettings = async (page, where) => {
  await page.keyboard.press('Escape');
  const closed = await until(async () => (await page.locator('[data-testid=settings-dialog]').count()) === 0, 'ajustes cerrado', 3000).catch(() => false);
  if (closed) return;
  note(`${where}: Escape no cerró Ajustes (se cierra con la X)`);
  await page.locator('[data-testid=settings-dialog] button:has(span.sr-only)').click();
  await until(async () => (await page.locator('[data-testid=settings-dialog]').count()) === 0, 'ajustes cerrado con la X');
};
// Text that overflows its box inside the main area (truncated labels are fine: they are meant to be cut).
const overflow = (page) => page.evaluate(() => [...document.querySelectorAll('main *, [role=dialog] *')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible' && e.clientWidth > 0 && !e.classList.contains('truncate') && !e.closest('.truncate, .sr-only') && !e.closest('pre, .overflow-x-auto, [data-slot=scroll-area-viewport]')).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 70)} ${e.scrollWidth}>${e.clientWidth}`));

// ---- demo data (the mockups' sidebar.json and 01-chat.html): what the second Orb is seeded with. All of it is fake: fake
// agents (test/fixtures/fake-explora.mjs), folders under `tmp`, no network, never this PC's profile.
const SEED = process.env.ORB_EXPLORA_SEED !== '0';
const text = (...l) => `${l.join('\n')}\n`;
const noted = new Set();
const noteOnce = (s) => { if (!noted.has(s)) { noted.add(s); note(s); } };
// A seeded step that fails is a note, never a stop: the tour goes on with what there is.
const attempt = async (what, fn) => { try { return await fn(); } catch (error) { note(`no se pudo sembrar ${what}: ${String(error?.message ?? error).split('\n')[0]}`); return null; } };

const REPOS = {
  'orb-dev': { git: 'orb/contexto-real', files: {
    'README.md': text('# orb-dev', 'Orb, el panel de agentes.'),
    'src/context-meter.js': text('export function ContextMeter({ context }) {', '  const size = context.size;', '  const used = context.used;', '  const pct = size ? Math.round((used / size) * 100) : null;', '  return { pct };', '}'),
    'src/sidebar.js': text('export const blocks = [\'chats\', \'plan\', \'usage\'];', 'export const hasPlanBlock = true;'),
    'docs/context-switch-plan.md': text('# Context switch plan', '', 'Pending.') } },
  'tienda-web': { git: 'main', files: { 'README.md': text('# tienda-web'), 'src/importar.js': text('export const importar = () => [];') } },
  // no repository: its chats show the panel without a «Cambios» history
  'api-pagos': { git: null, files: { 'README.md': text('# api-pagos'), 'src/reembolsos.js': text('export const reembolsar = () => null;'), 'src/checkout.js': text('export const checkout = () => null;') } }
};
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i + 1));
const METER_V1 = text('export function ContextMeter({ context }) {', '  const size = context.runtime?.size ?? context.size;', '  const used = context.runtime?.used ?? context.used;', '  const pct = size ? Math.round((used / size) * 100) : null;', '  return { pct, pending: pct === null };', '}');
const METER_V2 = text('// The runtime reports its own budget: a model switch restarts the idle runtime and resumes the same chat.', ...METER_V1.split('\n').slice(0, -1));
const BUSY_TEXT = 'Sigue leyendo designer.mjs y apunta lo que cambia del modo diseño';
// What each chat says (the user's lines are the keys the fake agents answer to: ORB_FAKE_SCRIPT) and does (ORB_EXPLORA_PLAN).
const CHATS = [
  { key: 'contador', title: 'Arreglar el contador de contexto', agent: 'claude', project: 'orb-dev', permission: 'auto', turns: [
    { text: 'Mira cómo se calcula el contador de contexto y dime qué falla.', reply: 'El contador usa el tamaño del modelo y no el del runtime: por eso marca mal al cambiar entre Auto, 200k y 1M. Lo arreglo en el siguiente paso.', files: { 'src/context-meter.js': METER_V1 } },
    { text: 'Arréglalo y añade pruebas del área.', reply: 'El presupuesto sale del tiempo de ejecución del modelo que corresponde, también con Auto. Se mantienen el razonamiento, el modo rápido y la distribución.\n\n**Comprobado:**\n\n- 46 tests del área y 16 del navegador en verde\n- lint sin errores\n\nPlan y pruebas actualizados. Sin commit ni push.',
      files: { 'src/context-meter.js': METER_V2, 'test/contexto-388.test.js': text(...repeat(24, (n) => `test('contador ${n}', () => assert.ok(${n}));`)), 'docs/context-switch-plan.md': text('# Context switch plan', '', ...repeat(11, (n) => `- Step ${n}: apply the runtime budget.`)) } },
    { text: 'Revisa el código y, si hace falta, arréglalo y abre una PR.', reply: 'He abierto la PR #1260, commit `47dcd08`.\n\nRevisión completa: no hay fallos nuevos ni nada que refactorizar. Incluye capturas de antes y después.\n\nTodo en verde en local: formato, lint, tipos y 46 tests. La CI de GitHub acaba de empezar.\n\nWorktree limpio; nada fusionado y `main` sin cambios.',
      files: { 'docs/context-switch-plan.md': text('# Context switch plan', '', ...repeat(14, (n) => `- Step ${n}: apply the runtime budget.`), '', 'Reviewed.') } }] },
  { key: 'compactacion', title: 'La compactación no quita contexto', agent: 'claude', project: 'orb-dev', permission: 'editar', turns: [
    { text: 'Mira por qué la compactación no quita contexto. Pide permiso antes de publicar la rama.', reply: 'Necesito publicar la rama para seguir.', append: 'PIDE_PERMISO', waitsApproval: true }] },
  { key: 'sidebar', title: 'Quitar el bloque de la barra lateral', agent: 'codex', project: 'orb-dev', permission: 'editar', complete: true, turns: [
    { text: 'Quita el bloque del plan de la barra lateral.', reply: 'Quité el bloque del plan y dejé el espacio para los chats.', files: { 'src/sidebar.js': text('export const blocks = [\'chats\', \'usage\'];') } }] },
  { key: 'limite', title: 'Límite al pedir PR a GitHub', agent: 'cursor', project: 'orb-dev', permission: 'editar', unread: true, turns: [
    { text: 'Mira por qué falla el límite al pedir la PR a GitHub.', reply: 'Es el límite de peticiones de la API: añado un reintento con espera antes de volver a pedirla.' }] },
  { key: 'diseno', title: 'Diagnóstico del modo diseño', agent: 'claude', project: 'orb-dev', permission: 'editar', pinned: true, turns: [
    { text: 'Haz un diagnóstico del modo diseño.', reply: 'Empiezo por designer.mjs y sigo con el panel.' },
    { text: BUSY_TEXT, reply: 'Leyendo designer.mjs…', append: 'DUERME', busy: true }] },
  { key: 'importar', title: 'Importar proyectos y voz con Ctrl+K', agent: 'codex', project: 'tienda-web', permission: 'editar', turns: [
    { text: 'Importa los proyectos y la voz desde Ctrl+K.', reply: 'Hecho: Ctrl+K ya importa proyectos y la entrada de voz.', files: { 'src/importar.js': text('export const importar = (fuente) => [fuente];', 'export const voz = () => true;') } }] },
  { key: 'reembolsos', title: 'Reembolsos parciales', agent: 'claude', project: 'api-pagos', permission: 'editar', turns: [
    { text: 'Prepara el plan de los reembolsos parciales.', reply: 'Propongo dos pasos: primero el cálculo del importe y luego la llamada a la pasarela.' }] }
];
const TASKS = [
  { project: 'tienda-web', title: 'Traducir las fichas de producto', agent: 'codex', text: 'Traduce las fichas de producto al inglés y al francés.', reply: 'Traduciendo…', append: 'DUERME', busy: true },
  { project: 'api-pagos', title: 'Migrar el cobro a la API nueva de Stripe', agent: 'cursor', text: 'Migra el cobro y haz el pago de la factura con la tarjeta de prueba.', reply: 'Hecho.' },
  { project: 'api-pagos', title: 'Revisar el checkout', agent: 'claude', text: 'Revisa el checkout y deja el resultado a punto de aceptar.', reply: 'Revisado: el checkout guarda el carrito entre recargas.', files: { 'src/checkout.js': text('export const checkout = (carrito) => ({ ...carrito, guardado: true });') } },
  { project: 'orb-dev', title: 'Revisar el contador', agent: 'claude', text: 'Revisa el contador de contexto y deja el resultado dicho.', reply: 'Revisado: el contador usa el presupuesto del runtime.' },
  { project: 'orb-dev', title: 'Probar en el móvil', agent: 'claude', text: 'Prueba el contador en el móvil y deja el resultado a punto de aceptar.', reply: 'Probado: el contador se ve bien en el móvil.', files: { 'docs/prueba-movil.md': text('# Prueba en el móvil', '', 'El contador se ve bien.') } },
  { project: 'api-pagos', title: 'Limpiar dependencias sin usar', agent: 'codex', text: 'Limpia las dependencias sin usar de la API.', reply: 'No pude terminar.', append: 'FALLA' }
];
const ORBE = [{ text: 'Dame tres planes para el fin de semana si llueve.', reply: 'Te dejo tres planes con lluvia: un museo por la mañana, una peli con comida en casa y una partida de mesa con amigos.' },
  { text: 'Gracias, me quedo con el museo. ¿A qué hora abre?', reply: 'Casi todos abren a las 10:00. Mira el horario del que elijas antes de salir.' }];

// The two files the fake agents read at start (so they exist before Orb launches): the natural answers and the side effects.
function writeFakes() {
  const turns = [...CHATS.flatMap((c) => c.turns), ...TASKS, ...ORBE];
  const script = path.join(tmp, 'explora-guion.json'); const plan = path.join(tmp, 'explora-plan.json');
  fs.writeFileSync(script, JSON.stringify(turns.map((t) => ({ when: t.text, reply: t.reply }))));
  fs.writeFileSync(plan, JSON.stringify(turns.filter((t) => t.files || t.append).map((t) => ({ when: t.text, files: t.files, append: t.append }))));
  return { ORB_FAKE_AGENTS: path.join(ROOT, 'test', 'fixtures', 'fake-explora.mjs'), ORB_FAKE_SCRIPT: script, ORB_EXPLORA_PLAN: plan };
}
// The projects' folders: files, and for the ones with a repository a first commit on main plus the branch the chat works on.
function makeRepos() {
  const dirs = {};
  for (const [name, repo] of Object.entries(REPOS)) {
    const dir = path.join(tmp, 'Proyectos', name); dirs[name] = dir;
    for (const [rel, body] of Object.entries(repo.files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); }
    if (!repo.git) continue;
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Orb Explora', '-c', 'user.email=explora@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore', timeout: 20000, windowsHide: true });
    git('init', '-b', 'main'); git('add', '-A'); git('commit', '-m', 'chore: initial commit');
    if (repo.git !== 'main') git('checkout', '-b', repo.git);
  }
  return dirs;
}

try {
  // ---- 1. a brand-new PC: the welcome wizard, straight into the app.
  {
    const userData = path.join(tmp, 'nuevo'); fs.mkdirSync(userData);
    const base = path.join(tmp, 'PrimerPC'); fs.mkdirSync(base);
    const { page, errors, close } = await open(userData, { ORB_DEFAULT_BASE: base });
    const shot = shooter(page);
    // 3.7: the 3.5.1 welcome: the assistant's name, what to call you, the folder (3.8: already chosen: ORB_DEFAULT_BASE);
    // 3.8: «Ordenar carpetas» when there is something to move and «Crea tu contraseña maestra»; on Windows «Preparando
    // tu PC».
    await page.waitForSelector('[data-testid=setup-datos]');
    note(`ventana inicial: ${(await page.evaluate(() => [innerWidth, innerHeight])).join('x')}`);
    await page.fill('[data-testid=setup-user]', 'Ana');
    await shot('00-bienvenida');
    const screens = { layout: '00a-ordenar-carpetas', master: '00a-contrasena-maestra', prepare: '00b-preparo-equipo' };
    const onScreen = (name) => shot(screens[name]);
    // The folder comes chosen (ORB_DEFAULT_BASE): «Cambiar ubicación…» would open Windows' own dialog.
    await page.click('[data-testid=setup-create]');
    const seen = await throughStart(page, { ready: '[data-testid=sidebar-home]', onScreen });
    note(`pantallas de bienvenida: ${seen.join(' → ') || 'ninguna'}`);
    if (!seen.includes('master')) note('no salió «Crea tu contraseña maestra»');
    await shot('01c-primer-chat');
    note(`errores en bienvenida: ${errors.join(' | ') || 'ninguno'}`);
    await close();
  }

  // ---- 2. an assistant already created: every view
  const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Alex' });
  writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } })); // 2.6: no guided tour in the tests
  fs.mkdirSync(path.join(home, 'web', 'webviaproject', 'src'), { recursive: true });
  fs.writeFileSync(path.join(home, 'web', 'webviaproject', 'src', 'index.html'), '<h1>hola</h1>\n');
  const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
  // The fake agents (and the demo folders) must exist before Orb starts: the engine reads them at launch.
  const dirs = SEED ? await attempt('las carpetas de los proyectos', makeRepos) ?? {} : {};
  const fakes = SEED ? await attempt('los agentes falsos', writeFakes) ?? {} : {};
  if (SEED && !fakes.ORB_FAKE_AGENTS) note('sin agentes falsos: no habrá chats sembrados');
  const { page, errors, close } = await open(userData, fakes);
  const shot = shooter(page);
  const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
  // 3.8: a folder made before the first start has no master password yet: «Crea tu contraseña maestra» once.
  await throughStart(page, { ready: '[data-testid=chat-greeting]' });
  // The one-time «Modo Auto activado» notice would sit over every picture for 20 s: marked as seen (ORB_EXPLORA_AUTO_NOTICE=1 keeps it).
  if (!process.env.ORB_EXPLORA_AUTO_NOTICE) await call('config.save', { patch: { ui: { autoNoticed: true } } });
  // The default name, so the sidebar shows the ORB·E wordmark the mockups draw (the welcome gave it another one).
  await call('config.save', { patch: { assistantName: 'Orbe' } });
  // ORB_LANG=en: the same tour in English (the interface and the engine's notices follow config.language).
  if (LANG) { await call('config.save', { patch: { language: LANG } }); await page.reload(); await page.waitForSelector('[data-testid=sidebar-home]'); }
  if (await page.isVisible('text=Preparando tu PC')) { await shot('01-preparo-equipo'); await page.click('text=Continuar'); }
  // ---- demo data: projects, chats of three fake agents, a chat with Orbe, tasks in several states, schedules, a bell.
  const ids = {};
  const sessionOf = async (id) => (await call('sessions.list')).find((s) => s.id === id);
  // A turn takes a moment to start: it is only «idle» once it has begun and ended.
  const waitIdle = async (id, ms = 25000) => { await page.waitForTimeout(700); await until(async () => (await sessionOf(id))?.status !== 'running', `chat ${id} en reposo`, ms); };
  const seeded = SEED && Boolean(fakes.ORB_FAKE_AGENTS); // never with real agents: without the fakes nothing is seeded
  if (seeded) {
    note('datos de prueba: agentes falsos (claude, codex, cursor), sin red; todo en la carpeta temporal');
    for (const name of Object.keys(REPOS)) await attempt(`el proyecto ${name}`, () => call('projects.import', { name, folder: dirs[name] }));
    for (const c of CHATS) {
      await attempt(`el chat «${c.title}»`, async () => {
        const s = await call('sessions.create', { agent: c.agent, project: c.project, permission: c.permission, title: c.title });
        ids[c.key] = s.id;
        for (const t of c.turns) {
          await call('sessions.send', { id: s.id, text: t.text });
          // an approval stays pending on purpose; a «busy» turn keeps working (DUERME) so the sidebar shows it working
          if (t.waitsApproval) await until(async () => (await call('approvals.list')).length > 0, 'permiso pendiente', 15000).catch(() => note(`«${c.title}»: no apareció la tarjeta de permiso`));
          else if (t.busy) await page.waitForTimeout(1200);
          else await waitIdle(s.id);
        }
      });
    }
    // the orbe chat: two exchanges, then its title
    await attempt('el chat con Orbe', async () => {
      const lines = async (conversation) => (await call('chat.list', { conversation })).filter((l) => l.role === 'orb');
      const first = await call('chat.send', { text: ORBE[0].text, project: '' });
      ids.orbe = first.conversation;
      await until(async () => (await lines(ids.orbe)).length >= 1, 'respuesta de Orbe', 30000);
      await call('chat.send', { text: ORBE[1].text, conversation: ids.orbe });
      await until(async () => (await lines(ids.orbe)).length >= 2, 'segunda respuesta de Orbe', 30000);
      await call('conversations.update', { id: ids.orbe, title: 'Ideas para el fin de semana' });
    });
    for (const t of TASKS) await attempt(`la tarea «${t.title}»`, () => call('tasks.create', { project: t.project, title: t.title, description: t.text, agent: t.agent }));
    await attempt('el fin de las tareas', () => until(async () => { const l = await call('tasks.list'); return l.some((x) => x.status === 'failed' || x.status === 'blocked') && l.some((x) => x.status === 'done'); }, 'tareas terminadas', 40000)).then((v) => { if (v === null) note('las tareas no llegaron a todos sus estados (mira la vista Tareas)'); });
    await attempt('la programada diaria', () => call('schedules.create', { project: 'api-pagos', title: 'Resumen de errores de la noche', description: 'Resume los errores de la noche.', agent: 'codex', readonly: true, every: 'daily', at_time: '08:30' }));
    await attempt('la programada semanal', () => call('schedules.create', { project: 'tienda-web', title: 'Revisión semanal de dependencias', description: 'Revisa las dependencias y avisa de lo que falle.', agent: 'claude', every: 'weekly', weekdays: [1], at_time: '09:00' }));
    // marks of the sidebar: one pinned, one completed, and unread only where the demo wants it (the rest are read)
    for (const c of CHATS) {
      if (!ids[c.key]) continue;
      if (c.pinned) await attempt(`fijar «${c.title}»`, () => call('inbox.pin', { kind: 'session', id: ids[c.key] }));
      if (c.complete) await attempt(`completar «${c.title}»`, () => call('sidebar.complete', { key: `s${ids[c.key]}`, done: true }));
      if (!c.unread) await attempt(`marcar leído «${c.title}»`, () => call('inbox.markRead', { kind: 'session', id: ids[c.key] }));
    }
    note('no sembrado a propósito: PR de GitHub (sin red ni gh), solo carpetas locales');
  }
  // The tour lasts minutes and a fake «DUERME» turn ends after 30 s: before the pictures that need them, whatever has
  // stopped working starts again, so the sidebar's spinner and «En curso» are there.
  // ORB_EXPLORA_BUSY=none|task|chat limits what is kept working (to tell which one a theme cannot cope with).
  const BUSY = process.env.ORB_EXPLORA_BUSY || 'all';
  const keepBusy = async () => {
    if (!seeded || BUSY === 'none') return;
    try {
      const busyTask = TASKS.find((t) => t.busy);
      if (BUSY !== 'chat' && !(await call('tasks.list')).some((x) => x.status === 'running' || (x.title === busyTask.title && x.status === 'queued'))) {
        await call('tasks.create', { project: busyTask.project, title: busyTask.title, description: busyTask.text, agent: busyTask.agent });
        await until(async () => (await call('tasks.list')).some((x) => x.status === 'running'), 'tarea en curso', 8000).catch(() => noteOnce('la tarea «en curso» no llegó a arrancar'));
      }
      const s = ids.diseno ? await sessionOf(ids.diseno) : null;
      if (BUSY !== 'task' && s && s.status !== 'running') await call('sessions.send', { id: s.id, text: BUSY_TEXT });
    } catch (error) { noteOnce(`no se pudo mantener algo «trabajando»: ${error.message}`); }
  };
  // The chat of a row of the sidebar (by its title); a missing row is a note, not a stop.
  const openChat = async (title) => {
    try {
      const row = page.getByTestId(`orb-row-${title}`).first();
      await row.scrollIntoViewIfNeeded({ timeout: 4000 });
      await row.locator('button').first().click({ timeout: 4000 });
      await page.waitForTimeout(700);
      return true;
    } catch { noteOnce(`sin fila «${title}» en la barra lateral`); return false; }
  };
  // A control that may not be there: clicked for a short time, and its absence is a note.
  const tap = async (testid, what) => {
    try { await page.locator(`[data-testid="${testid}"]`).first().click({ timeout: 4000 }); await page.waitForTimeout(350); return true; } catch { noteOnce(`sin ${what ?? testid}`); return false; }
  };
  const closeMenus = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
  const panelIsOpen = () => page.locator('[data-testid=chat-panel][data-state=open]').count().then((n) => n > 0).catch(() => false);
  // The chat's side panel on one of its tabs (Ficha, Cambios, PR); false when the tab does not exist (no PR without network).
  const openPanel = async (tab) => {
    if (!(await panelIsOpen()) && !(await tap('turn-changes-toggle', 'botón del panel derecho'))) return false;
    await page.locator('[data-testid=chat-panel][data-state=open]').waitFor({ timeout: 3000 }).catch(() => {});
    if (!(await page.locator(`[data-testid=panel-tab-${tab}]`).count())) { noteOnce(`sin pestaña «${tab}» en el panel (${tab === 'pr' ? 'una PR necesita GitHub: no se puede sembrar sin red' : 'no aparece'})`); return false; }
    return tap(`panel-tab-${tab}`);
  };
  const closePanel = async () => { if (await panelIsOpen()) await tap('turn-changes-close', 'cerrar el panel'); await page.waitForTimeout(300); };
  // The pictures of the chat with an agent (the sidebar, the turns with their «Cambió N archivos» card, the panel and the
  // menus of its bar and its box). prefix: «dia» / «noche».
  const agentShots = async (prefix) => {
    if (!seeded) return;
    await keepBusy();
    if (!(await openChat(CHATS[0].title))) return;
    await closePanel();
    await shot(`${prefix}-chat-agente`);
    for (const [tab, name] of [['info', 'panel-ficha'], ['changes', 'panel-cambios'], ['pr', 'panel-pr']]) {
      if (await openPanel(tab)) await shot(`${prefix}-${name}`);
    }
    await closePanel();
    if (await tap('session-more', 'el ⋯ de la cabecera')) { await shot(`${prefix}-chat-agente-menu`); await closeMenus(); }
    if (await tap('session-permission-more', 'el selector de permisos')) {
      await shot(`${prefix}-chat-permisos`);
      if (await tap('session-permission-options', '«Más opciones» de permisos')) await shot(`${prefix}-chat-permisos-mas-opciones`);
      await closeMenus();
    }
    if (await tap('reasoning-picker', 'el selector de razonamiento')) { await shot(`${prefix}-chat-razonamiento`); await closeMenus(); }
    if (ids.orbe && await openChat('Ideas para el fin de semana')) await shot(`${prefix}-chat-orbe`);
    // the ⋯ of a row (it shows on hover) and two tabs open
    const row = page.getByTestId(`orb-row-${CHATS[3].title}`).first();
    try {
      await row.hover({ timeout: 3000 });
      await row.locator('[data-testid=chat-menu]').click({ timeout: 3000 });
      await page.waitForTimeout(350);
      await shot(`${prefix}-menu-fila`);
      if (!(await tap('chat-newtab', '«Abrir en pestaña nueva» del menú de la fila'))) await closeMenus(); else await shot(`${prefix}-pestanas`);
    } catch { noteOnce('sin menú ⋯ en la fila de un chat'); await closeMenus(); }
  };
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  const setDark = async (on) => { if (on !== (await dark())) await page.getByRole('button', { name: /claro y oscuro|day and night|light and dark/i }).click(); };
  // The robot at the top goes back to the chat; the professional theme has no robot (nothing drawn): there, a new chat
  // from the list's «+».
  const goChat = async () => {
    if (await page.locator('[data-testid=sidebar-home]').isVisible()) await page.click('[data-testid=sidebar-home]');
    else { await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]'); }
  };
  // The families the default settings really give (the mockups use Segoe UI Variable Text and JetBrains Mono).
  note(`letras de serie: cuerpo «${await page.evaluate(() => getComputedStyle(document.body).fontFamily)}» · mono «${await page.evaluate(() => { const e = document.createElement('code'); e.className = 'font-mono'; document.body.append(e); const v = getComputedStyle(e).fontFamily; e.remove(); return v; })}»`);
  const views = [['sidebar-home', 'chat'], ['nav-tasks', 'tareas'], ['nav-projects', 'proyectos'], ['nav-agents', 'agentes'], ['nav-memories', 'bitacoras'], ['memories-activity', 'actividad'], ['nav-settings', 'ajustes']];
  const SECTIONS = ['general', 'magiclink', 'agentes', 'permisos', 'extensiones', 'datos', 'avanzado', 'acerca'];
  // ORB_EXPLORA_ONLY_THEMES=1 skips the tour of every view (to look again at the themes alone).
  if (!process.env.ORB_EXPLORA_ONLY_THEMES) for (const theme of ['dia', 'noche']) {
    await setDark(theme === 'noche');
    for (const [nav, name] of views) {
      await keepBusy();
      if (nav === 'sidebar-home') await goChat(); else await page.click(`[data-testid=${nav}]`);
      await shot(`${theme}-${name}`);
      if (theme === 'dia') {
        const wide = await overflow(page);
        if (wide.length) note(`${name}: contenido más ancho que su caja → ${wide.join(' | ')}`);
      }
      if (name === 'ajustes') {
        // each section of the settings window
        for (const id of SECTIONS) {
          await page.click(`[data-testid=settings-nav-${id}]`);
          await shot(`${theme}-ajustes-${id}`);
          if (theme === 'dia') {
            const wide = await overflow(page);
            if (wide.length) note(`ajustes/${id}: contenido más ancho que su caja → ${wide.join(' | ')}`);
          }
        }
        await closeSettings(page, `${theme}/ajustes`);
      }
    }
    // the dialogs and menus of the chat
    await goChat();
    await page.click('[data-testid=project-picker]'); await shot(`${theme}-chat-menu-proyecto`); await page.keyboard.press('Escape');
    await page.waitForSelector('[role=menu]', { state: 'detached' }).catch(() => {}); await page.waitForTimeout(300);
    // 3.6: the list's «+» (Nuevo chat, Nuevo proyecto).
    await page.click('[data-testid=chats-new]').catch(() => note('sin botón «+» en la lista de chats'));
    await shot(`${theme}-menu-nuevo`);
    await page.click('[data-testid=new-conversation]', { timeout: 5000 }).catch(() => note('sin «Nuevo chat» en el menú «+»'));
    await shot(`${theme}-nueva-conversacion`); await page.keyboard.press('Escape');
    // the seeded chats: with an agent (turns, «Cambió N archivos», panel, menus), with Orbe, the row's ⋯, two tabs
    await agentShots(theme);
    // Programadas lives in the sidebar's places: seeded with two schedules (a view the loop above does not list)
    if (seeded && await tap('nav-schedules', 'Programadas')) await shot(`${theme}-programadas`);
  }
  // checks and switches in the night theme: their computed colors
  await page.click('[data-testid=nav-settings]');
  const controls = await page.evaluate(() => [...document.querySelectorAll('button[role=checkbox],button[role=switch]')].slice(0, 12).map((b) => {
    const cs = getComputedStyle(b); const label = (b.closest('label,div')?.innerText ?? '').split('\n')[0].slice(0, 40);
    return `${b.getAttribute('role')} ${b.dataset.state} bg=${cs.backgroundColor} border=${cs.borderColor} color=${cs.color} «${label}»`;
  }));
  note(`controles en noche:\n    ${controls.join('\n    ')}`);
  await closeSettings(page, 'controles');

  // A click of the theme tour: 6 s at most; when something covers the control, the note names it and the tour goes on.
  let dissected = false;
  const tapOrNote = async (sel) => {
    try { await page.click(sel, { timeout: 6000 }); return true; } catch (error) {
      // Playwright's own log says at which stage the click stopped (visible, stable, hit target, receiving events)
      const stage = String(error.message).split(String.fromCharCode(10)).map((l) => l.split(String.fromCharCode(27)).map((p, k) => (k ? p.slice(p.indexOf("m") + 1) : p)).join("").trim()).filter((l) => l.startsWith("-")).slice(-7).join(" / ");
      const over = await page.evaluate((q) => { const e = document.querySelector(q); if (!e) return 'no existe'; const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const path = []; for (let n = top; n && path.length < 4; n = n.parentElement) path.push(`${n.tagName.toLowerCase()}${n.dataset?.testid ? `[${n.dataset.testid}]` : ''}.${String(n.className?.baseVal ?? n.className ?? '').split(' ').slice(0, 3).join('.')}`); return path.join(' < '); }, sel).catch(() => '?');
      // a control that never holds still cannot be clicked: say which animation moves it (or one of its ancestors)
      const moving = await page.evaluate(async (q) => { const e = document.querySelector(q); if (!e) return ''; const rects = []; for (let i = 0; i < 8; i++) { const r = e.getBoundingClientRect(); rects.push(`${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)}x${r.height.toFixed(1)}`); await new Promise((ok) => setTimeout(ok, 80)); } const anims = []; for (let n = e; n; n = n.parentElement) for (const a of n.getAnimations()) anims.push(`${n.tagName.toLowerCase()}${n.dataset?.testid ? `[${n.dataset.testid}]` : ''}.${String(n.className?.baseVal ?? n.className ?? '').split(' ').slice(0, 2).join('.')}:${a.animationName ?? a.transitionProperty ?? a.constructor.name}/${a.playState}`); return `posiciones ${[...new Set(rects)].join(' | ')} · animaciones ${anims.join(' ; ') || 'ninguna'}`; }, sel).catch(() => '?');
      // what the window looked like when the click could not be made
      await page.screenshot({ path: path.join(OUT, `fallo-${sel.replace(/[^a-z0-9-]+/gi, '_')}-${Date.now() % 100000}.png`) }).catch(() => {});
      note(`no se pudo pulsar ${sel}: encima está ${over} · ${moving} · etapas: ${stage}`);
      // ORB_EXPLORA_DISSECT=1: once, the theme's pieces are taken out one at a time to see with which one a click works again
      if (process.env.ORB_EXPLORA_DISSECT && !dissected) {
        dissected = true;
        const tryClick = async (label) => {
          const t = Date.now(); let ok = true;
          try { await page.locator(sel).click({ trial: true, timeout: 4000 }); } catch { ok = false; }
          const took = Date.now() - t; const t2 = Date.now();
          const count = await Promise.race([page.locator(sel).count().catch(() => 'error'), new Promise((r) => setTimeout(() => r('sin respuesta'), 3000))]);
          note(`disección «${label}»: clic ${ok ? 'OK' : 'FALLA'} en ${took} ms · locator.count() = ${count} en ${Date.now() - t2} ms`);
        };
        await tryClick('tal cual');
        const pieces = [['el fondo WebGL', 'canvas.orb-shader{display:none!important}'], ['mix-blend-mode', '*{mix-blend-mode:normal!important}'], ['backdrop-filter', '*{backdrop-filter:none!important}'], ['animaciones del robot', '.orb,.orb *{animation:none!important;transition:none!important;will-change:auto!important}'], ['los robots', '.orb{display:none!important}'], ['todas las animaciones', '*,*::before,*::after{animation:none!important;transition:none!important}']];
        for (const [label, text] of pieces) {
          await page.evaluate((css) => { const st = document.createElement('style'); st.id = 'orb-dissect'; st.textContent = css; document.head.append(st); }, text);
          await page.waitForTimeout(600); await tryClick(`sin ${label}`);
          await page.evaluate(() => document.getElementById('orb-dissect')?.remove());
        }
        // another theme's stylesheet with Orb's own components still mounted: tells the CSS from the components
        for (const other of ['vaporwave', 'predeterminado']) {
          await page.evaluate((s) => { document.documentElement.dataset.skin = s; }, other);
          await page.waitForTimeout(600); await tryClick(`data-skin=${other} solo en el DOM`);
          await page.evaluate(() => { document.documentElement.dataset.skin = 'orb'; });
        }
        await page.waitForTimeout(600); await tryClick('otra vez tal cual');
      }
      return false;
    }
  };
  // ORB_EXPLORA_SKINS=orb,retro limits the theme tour (to look again at one theme without the whole run).
  const TOUR_SKINS = process.env.ORB_EXPLORA_SKINS ? SKINS.filter((x) => process.env.ORB_EXPLORA_SKINS.split(',').includes(x)) : SKINS;
  // ---- 3. the visual themes (Ajustes → Apariencia), each in day and night: the chat, Tareas and the Apariencia section.
  // The professional theme has no robot anywhere.
  // with the tour of the views skipped, whatever dialog the seeding left open is closed first
  if (process.env.ORB_EXPLORA_ONLY_THEMES) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  for (const skin of TOUR_SKINS) {
    await call('config.save', { patch: { ui: { skin } } });
    await until(async () => (await page.evaluate(() => document.documentElement.dataset.skin)) === skin, `tema ${skin}`);
    for (const theme of ['dia', 'noche']) {
      // a theme that only exists in one mode has no day / night control: its other mode is skipped
      if ((theme === 'noche' && lightOnlySkin(skin)) || (theme === 'dia' && darkOnlySkin(skin))) continue;
      await setDark(theme === 'noche');
      await keepBusy();
      // How alive the page is in this theme: frames and DOM changes in one second, and which nodes change most. A theme
      // that repaints or rebuilds without rest shows here (and its controls cannot be clicked: no two equal frames).
      note(`pulso ${skin}/${theme}: ${await page.evaluate(() => new Promise((done) => { let frames = 0; let on = true; const tick = () => { if (!on) return; frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); const hits = new Map(); let changes = 0; const mo = new MutationObserver((list) => { for (const m of list) { changes++; const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; const k = n ? `${n.tagName.toLowerCase()}${n.dataset?.testid ? `[${n.dataset.testid}]` : ''}.${String(n.className?.baseVal ?? n.className ?? '').split(' ').slice(0, 2).join('.')}${m.type === 'attributes' ? `@${m.attributeName}` : ''}` : '?'; hits.set(k, (hits.get(k) ?? 0) + 1); } }); mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); setTimeout(() => { on = false; mo.disconnect(); done(`${frames} fotogramas/s, ${changes} cambios del DOM/s, oculta=${document.hidden} · ${[...hits].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${n}× ${k}`).join(' ; ')}`); }, 1000); })).catch((e) => `sin medir (${e.message})`)}`);
      // ORB_EXPLORA_STRIP=1: the theme's pieces are taken out BEFORE entering the chat with Orbe and given back one at a
      // time, entering again each time: the piece whose return hangs the window is the one to fix.
      if (process.env.ORB_EXPLORA_STRIP && skin === 'orb' && !dissected) {
        dissected = true;
        const strips = [['los robots', '.orb{display:none!important}'], ['el fondo WebGL', 'canvas.orb-shader{display:none!important}'], ['mix-blend-mode', '*{mix-blend-mode:normal!important}'], ['backdrop-filter', '*{backdrop-filter:none!important}'], ['animaciones y transiciones', '*,*::before,*::after{animation:none!important;transition:none!important}'], ['content-visibility y contain', '*{content-visibility:visible!important;contain:none!important}'], ['will-change', '*{will-change:auto!important}'], ['filtros y máscaras', '*{filter:none!important;mask:none!important;-webkit-mask:none!important}']];
        await page.evaluate((list) => { list.forEach(([, css], i) => { const st = document.createElement('style'); st.id = `orb-strip-${i}`; st.textContent = css; document.head.append(st); }); }, strips);
        const alive = async (label) => {
          const t = Date.now(); let ok = true;
          try { await page.screenshot({ timeout: 5000 }); } catch { ok = false; }
          const answer = await Promise.race([page.evaluate(() => `${document.querySelectorAll('.orb').length} robots, ${document.querySelectorAll('*').length} nodos`).catch(() => 'error'), new Promise((r) => setTimeout(() => r('la página no responde'), 4000))]);
          note(`tira «${label}»: ${ok ? 'VIVA' : 'COLGADA'} (captura en ${Date.now() - t} ms) · ${answer}`);
          return ok && answer !== 'la página no responde';
        };
        const enter = async () => { await page.evaluate(() => document.querySelector('[data-testid=sidebar-home]')?.click()); await page.waitForTimeout(1500); };
        const leave = async () => { await page.evaluate(() => document.querySelector('[data-testid=nav-tasks]')?.click()); await page.waitForTimeout(800); };
        await enter();
        if (await alive('con todo quitado')) {
          for (let i = 0; i < strips.length; i++) {
            await leave();
            await page.evaluate((n) => document.getElementById(`orb-strip-${n}`)?.remove(), i);
            await page.waitForTimeout(300); await enter();
            if (!(await alive(`devuelto: ${strips[i][0]}`))) { note(`CULPABLE: ${strips[i][0]}`); break; }
          }
        } else note('se cuelga incluso con todo quitado: no es el CSS del tema, son sus componentes');
        // Entering with a synthetic click never hangs; the tour enters with a real pointer, which hovers and presses the
        // robot's head and then stays over it. So: the real pointer, one gesture at a time.
        const head = await page.evaluate(() => { const e = document.querySelector('[data-testid=sidebar-home] .orb') ?? document.querySelector('[data-testid=sidebar-home]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, robot: e.classList.contains('orb'), w: Math.round(r.width), h: Math.round(r.height) }; });
        note(`cabeza del robot: ${JSON.stringify(head)}`);
        await leave();
        await page.mouse.move(700, 500); await page.waitForTimeout(400);
        if (await alive('ratón lejos, en Tareas')) {
          await page.mouse.move(head.x, head.y, { steps: 6 }); await page.waitForTimeout(1500);
          if (await alive('ratón REAL encima de la cabeza del robot, sin pulsar')) {
            await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(1500);
            if (await alive('clic REAL en la cabeza, ratón aún encima')) {
              await page.mouse.move(700, 500, { steps: 6 }); await page.waitForTimeout(800);
              await alive('ratón fuera otra vez');
            } else note('CULPABLE: el clic real sobre la cabeza del robot (con el ratón encima)');
          } else note('CULPABLE: el ratón real encima de la cabeza del robot');
        }
        break;
      }
      let spy = null;
      if (process.env.ORB_EXPLORA_DISSECT && !dissected) {
        // armed before the view that hangs: a paused stack is the only thing a busy main thread still answers
        spy = await page.context().newCDPSession(page);
        await spy.send('Debugger.enable'); await spy.send('Profiler.enable'); await spy.send('Profiler.setSamplingInterval', { interval: 2000 }); await spy.send('Profiler.start');
      }
      try { await page.click('[data-testid=sidebar-home]', { timeout: 6000 }); } catch { if (!(await tapOrNote('[data-testid=sidebar-home]'))) continue; }
      // ORB_EXPLORA_DISSECT=1: in the chat with Orbe, can the window still give a picture? If not, the theme's pieces are
      // taken out one at a time to see which one stops the frames.
      if (process.env.ORB_EXPLORA_DISSECT && !dissected) {
        dissected = true;
        const probe = async (label) => {
          const t = Date.now(); let ok = true;
          try { await page.screenshot({ timeout: 4000 }); } catch { ok = false; }
          const took = Date.now() - t;
          const info = await Promise.race([page.evaluate(() => new Promise((done) => { let n = 0; let on = true; const tick = () => { if (!on) return; n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => { on = false; done(`${n} fotogramas/s, ${document.querySelectorAll('.orb').length} robots, ${document.querySelectorAll('*').length} nodos, mensajes ${document.querySelectorAll('[data-slot=message], .msg-box, [data-testid^=msg]').length}`); }, 1000); })), new Promise((r) => setTimeout(() => r('la página no responde'), 4000))]);
          note(`disección «${label}»: captura ${ok ? 'OK' : 'FALLA'} en ${took} ms · ${info}`);
          return ok;
        };
        if (!(await probe('chat con Orbe, tal cual'))) {
          const frameOf = (c) => `${c.functionName || '(anon)'} ${String(c.url ?? '').split('/').pop()}:${(c.location?.lineNumber ?? c.lineNumber)}:${(c.location?.columnNumber ?? c.columnNumber)}`;
          for (let i = 0; i < 3 && spy; i++) {
            const paused = new Promise((ok) => spy.once('Debugger.paused', (p) => ok(p.callFrames.slice(0, 9).map(frameOf).join(' < '))));
            spy.send('Debugger.pause').catch(() => {});
            const stack = await Promise.race([paused, new Promise((r) => setTimeout(() => r('no se pudo pausar en 5 s'), 5000))]);
            note(`pila ${i + 1} del hilo principal: ${stack}`);
            await Promise.race([spy.send('Debugger.resume').catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
            await new Promise((r) => setTimeout(r, 700));
          }
          if (spy) {
            const prof = await Promise.race([spy.send('Profiler.stop'), new Promise((r) => setTimeout(() => r(null), 8000))]);
            if (prof?.profile) { const byId = new Map(prof.profile.nodes.map((n) => [n.id, n])); const self = new Map(); for (const id of prof.profile.samples ?? []) { const k = frameOf(byId.get(id).callFrame); self.set(k, (self.get(k) ?? 0) + 1); } note(`perfil (${prof.profile.samples?.length ?? 0} muestras): ${[...self].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${v} ${k}`).join(' ; ')}`); } else note('el perfilador no devolvió nada en 8 s');
          }
          break;
          const pieces = [['el fondo WebGL', 'canvas.orb-shader{display:none!important}'], ['mix-blend-mode', '*{mix-blend-mode:normal!important}'], ['backdrop-filter', '*{backdrop-filter:none!important}'], ['animaciones del robot', '.orb,.orb *{animation:none!important;transition:none!important;will-change:auto!important}'], ['los robots', '.orb{display:none!important}'], ['todas las animaciones', '*,*::before,*::after{animation:none!important;transition:none!important}'], ['content-visibility', '*{content-visibility:visible!important;contain:none!important}'], ['will-change', '*{will-change:auto!important}']];
          for (const [label, text] of pieces) {
            await page.evaluate((css) => { const st = document.createElement('style'); st.id = 'orb-dissect'; st.textContent = css; document.head.append(st); }, text);
            await page.waitForTimeout(500); await probe(`sin ${label}`);
            await page.evaluate(() => document.getElementById('orb-dissect')?.remove());
          }
          for (const other of ['vaporwave', 'predeterminado']) {
            await page.evaluate((x) => { document.documentElement.dataset.skin = x; }, other);
            await page.waitForTimeout(500); await probe(`data-skin=${other} solo en el DOM`);
            await page.evaluate(() => { document.documentElement.dataset.skin = 'orb'; });
          }
          await page.waitForTimeout(500); await probe('otra vez tal cual');
          break;
        }
      }
      await shot(`tema-${skin}-${theme}-chat`);
      // the chat with an agent with its side panel open (Ficha)
      if (seeded && await openChat(CHATS[0].title)) { if (await openPanel('info')) await shot(`tema-${skin}-${theme}-chat-agente`); await closePanel(); }
      if (await tapOrNote('[data-testid=nav-tasks]')) await shot(`tema-${skin}-${theme}-tareas`);
      if (!(await tapOrNote('[data-testid=nav-settings]')) || !(await tapOrNote('[data-testid=settings-nav-general]'))) continue;
      await shot(`tema-${skin}-${theme}-ajustes`);
      if (theme === 'dia' || darkOnlySkin(skin)) {
        const wide = await overflow(page);
        if (wide.length) note(`tema ${skin}: contenido más ancho que su caja → ${wide.join(' | ')}`);
        const robots = await page.evaluate(() => document.querySelectorAll('.orb').length);
        if (skin !== 'orb' && robots) note(`tema ${skin}: quedan ${robots} robots en pantalla`);
        if (skin === 'orb' && !robots) note(`tema ${skin}: no se ve el robot`);
      }
      await closeSettings(page, `tema ${skin}/${theme}`);
    }
  }
  await call('config.save', { patch: { ui: { skin: SKINS[0] } } });
  await setDark(false);

  // ---- 4. narrow window and a small laptop height
  for (const [w, h, name] of [[420, 860, 'estrecha'], [1280, 640, 'portatil-bajo']]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [nav, view] of [['sidebar-home', 'chat'], ['nav-tasks', 'tareas'], ['nav-settings', 'ajustes']]) {
      if (w < 700) { await page.getByRole('button', { name: /^(Menú|Menu)$/ }).click(); await page.locator(`[data-testid=${nav}]:visible`).click(); } else if (nav === 'sidebar-home') await goChat(); else await page.click(`[data-testid=${nav}]`);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw > iw + 1) note(`${name}/${view}: se sale por los lados (${sw} > ${iw})`);
      await shot(`${name}-${view}`);
      if (view === 'ajustes') {
        for (const id of ['general', 'agentes', 'acerca']) { await page.click(`[data-testid=settings-nav-${id}]`); await shot(`${name}-ajustes-${id}`); }
        await closeSettings(page, `${name}/ajustes`);
      }
    }
  }
  const state = await call('app.state');
  note(`versión ${state.version}, agentes: ${(await call('agents.status')).map((a) => `${a.id}=${a.installed ? 'instalado' : 'no'}/${a.login ?? '?'}`).join(', ')}`);
  note(`errores de la página: ${errors.join(' | ') || 'ninguno'}`);
  // What still «works» (a 30 s fake turn, a task) is stopped, so closing the window does not ask about running tasks.
  if (seeded) await attempt('parar lo que sigue trabajando', async () => {
    for (const t of await call('tasks.list')) if (t.status === 'running') await call('tasks.cancel', { id: t.id }).catch(() => {});
    for (const s of await call('sessions.list')) if (s.status === 'running') await call('sessions.stop', { id: s.id }).catch(() => {});
  });
  await close();
} catch (error) {
  console.error(`✖ ${error.stack}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'notas.txt'), notes.join('\n'));
  for (const stop of opened) { try { await stop(); } catch { /* already closed */ } }
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a file still open: the temp folder stays */ }
  process.exit(process.exitCode ?? 0);
}
