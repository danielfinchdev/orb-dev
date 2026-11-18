// Exploratory pass over Orb (no agents needed): the welcome screen and the first run («Preparando tu PC»), every view in
// day and night, each section of Ajustes, the five visual themes, a narrow window and the settings' switches and checks,
// with screenshots in test-results/explora/ (explora-en/ with ORB_LANG=en) and the page errors collected. Not an
// assertion test: it is for looking at. On the test build of Orb, hidden (test/fixtures/launch-orb.mjs):
//   npm run tauri:build:e2e && node test/explora.e2e.mjs
// The assistant's folder is seeded with demo data like the mockups' (projects with a git repository, chats with fake
// agents, tasks, a schedule, a chat with Orbe) before the pictures, so the sidebar, the chat and its side panel have
// something to show. Everything lives in the temp folder; ORB_EXPLORA_SEED=0 skips it (the empty profile of before).
// ORB_EXPLORA_EXTRA=1 adds the deep pictures the mockup comparison needs (deepShots: views scrolled to the middle and the
// bottom, usage with seeded consumption, a game mid-play, God mode with git, the lock screen, «Tu tema» with another
// theme marked, Agentes and Uso in every theme). It replaces taskShots, projectShots, extraShots and the chat pictures
// of the views loop so that one mode still fits in a run: use it with ORB_EXPLORA_MODES=dia and then =noche.
// ORB_EXPLORA_EXTRA=1 also pictures the sidebar's foot (music player and feedback popups, never sent) in every mode
// (footShots) and in every theme (tema-<skin>-<mode>-reproductor / -comentarios).
// The companion robot (tema-orb-<mode>-companero, -companero-movido: dragged with the real pointer, then put back) and the
// pointer-over-the-mark responsiveness check run in the theme tour whenever the Orb theme is in it.
// ORB_EXPLORA_SOUND=1 lets the tour press «play» of the player (1.5 s of real audio, then pause); without it nothing sounds.
// ORB_EXPLORA_PIP=1 adds, at the end, the agent browser's live window (pip.html): a fake agent opens a local page (127.0.0.1,
// no network) and that second window is pictured (vivo-normal, vivo-grande, vivo-pildora). It is always dark.
// ORB_EXPLORA_START=1 skips everything else and pictures the start-up notices that cannot be provoked (core missing, failed
// data migration, app update, Orb could not start, a screen that failed…) in day and night: arranque-<card>[-noche].png.
// The page paints each one with sample data and without the engine (main.jsx › StartPreview) when window.__ORB_START_PREVIEW__
// names it. Only this script can set that variable: an init script copies it from window.name, which survives the reload
// and is set here by hand (an init script added once per card would pile up). Cards: core, core-sin, core-danada,
// core-confirma, migra, migra-act, error, clave, falla, falla-red, actualiza (ORB_EXPLORA_START_ONLY=core,error picks some).
// ORB_EXPLORA_SERVE=1 does not take pictures: it seeds the same demo data as ORB_EXPLORA_EXTRA=1 (with its consumption), goes to the
// first chat and leaves Orb OPEN (visible, its own process, still running when this script ends) for someone to try it. It needs
// ORB_EXPLORA_DATA=<folder> (everything the run makes lives inside it: profile, workspace, projects, backups, the fake agents'
// scripts; nothing in the temp folder or the user's) and ORB_E2E_EXE=<test build's Orb.exe>. It then writes
// <ORB_EXPLORA_DATA>/probar-entorno.json and .cmd: the ORB_* variables Orb was started with, to start it again without node.
// ORB_EXPLORA_WELCOME=1 (only with SERVE) seeds nothing: Orb opens on the welcome, with fake agents, for the user to go through it.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/domain/workspace/home.mjs';
import { loadConfig, merge } from '../src/platform/config-file.mjs';
import { writeJson } from '../src/platform/paths.mjs';
import { SKINS, darkOnlySkin, lightOnlySkin } from '../src/shared/appearance.mjs';
import { throughStart, sandboxEnv, TEST_MASTER } from './fixtures/e2e-flows.mjs';
import { launchOrb, E2E_EXE } from './fixtures/launch-orb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANG = process.env.ORB_LANG || '';
const SERVE = process.env.ORB_EXPLORA_SERVE === '1';
const WELCOME = SERVE && process.env.ORB_EXPLORA_WELCOME === '1';
if (SERVE && !process.env.ORB_EXPLORA_DATA) { console.error('✖ ORB_EXPLORA_SERVE=1 necesita ORB_EXPLORA_DATA=<carpeta>'); process.exit(1); }
const OUT = SERVE ? path.join(path.resolve(process.env.ORB_EXPLORA_DATA), 'notas') : path.join(ROOT, 'test-results', LANG ? `explora-${LANG}` : 'explora'); fs.mkdirSync(OUT, { recursive: true });
// SERVE: the temporary folder is the user's data folder itself (it is never removed).
const tmp = SERVE ? path.resolve(process.env.ORB_EXPLORA_DATA) : fs.mkdtempSync(path.join(os.tmpdir(), 'orb-explora-'));
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
  const orb = await launchOrb({ userData, env: { ...sandboxEnv(tmp), ...env }, ...(SERVE ? { visible: true, detach: true } : {}) });
  const page = orb.page; const stop = () => orb.close();
  opened.push(stop);
  // Pictures show the themes as designed: a PC with Windows' transparency effects off would drop Cristal's blur.
  if (!SERVE) try { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] }); } catch { /* an older WebView2: the pictures follow the system's setting */ }
  if (SIZE && !SERVE) await page.setViewportSize({ width: Number(SIZE[1]), height: Number(SIZE[2]) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  return { page, errors, close: stop, orb };
}
// The page's picture (with the interface zoom).
const shooter = (page) => async (name) => {
  if (SERVE) return;
  await page.waitForTimeout(500);
  // a scrollbar thumb is drawn for a moment after anything scrolls (the tour scrolls views itself): the picture is of the view at rest
  await page.waitForFunction(() => !document.querySelector('[data-scrolling]'), null, { timeout: 2000 }).catch(() => {});
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
const EXTRA = SERVE || process.env.ORB_EXPLORA_EXTRA === '1';
const text = (...l) => `${l.join('\n')}\n`;
const noted = new Set();
const noteOnce = (s) => { if (!noted.has(s)) { noted.add(s); note(s); } };
// A seeded step that fails is a note, never a stop: the tour goes on with what there is.
const attempt = async (what, fn) => { try { return await fn(); } catch (error) { note(`no se pudo sembrar ${what}: ${String(error?.message ?? error).split('\n')[0]}`); return null; } };

const REPOS = {
  'orb-dev': { git: 'orb/contexto-real', remote: true, files: {
    'README.md': text('# orb-dev', 'Orb, el panel de agentes.'),
    'src/context-meter.js': text('export function ContextMeter({ context }) {', '  const size = context.size;', '  const used = context.used;', '  const pct = size ? Math.round((used / size) * 100) : null;', '  return { pct };', '}'),
    'src/sidebar.js': text('export const blocks = [\'chats\', \'plan\', \'usage\'];', 'export const hasPlanBlock = true;'),
    'docs/context-switch-plan.md': text('# Context switch plan', '', 'Pending.') } },
  'tienda-web': { git: 'main', files: { 'README.md': text('# tienda-web'), 'src/importar.js': text('export const importar = () => [];') } },
  // no repository: its chats show the panel without a «Cambios» history
  'api-pagos': { git: null, files: { 'README.md': text('# api-pagos'), 'src/reembolsos.js': text('export const reembolsar = () => null;'), 'src/checkout.js': text('export const checkout = () => null;') } },
  // a folder of old exports: the task that empties it is held for review (10 or more deletions, in a repository)
  // it needs a repository: without one the task only has a plain copy as its checkpoint and Orb never holds it for a mass deletion
  // imported and then finished: the «Terminados» of Proyectos
  'web-antigua': { git: null, files: { 'README.md': text('# web-antigua'), 'index.html': text('<h1>Web antigua</h1>') } },
  'blog': { git: 'main', files: { 'README.md': text('# blog'), ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`exportaciones/entradas-${String(i + 1).padStart(2, '0')}.csv`, text('titulo,fecha', `entrada ${i + 1},2026-01-${String((i % 27) + 1).padStart(2, '0')}`)])) } }
};
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i + 1));
const METER_V1 = text('export function ContextMeter({ context }) {', '  const size = context.runtime?.size ?? context.size;', '  const used = context.runtime?.used ?? context.used;', '  const pct = size ? Math.round((used / size) * 100) : null;', '  return { pct, pending: pct === null };', '}');
const METER_V2 = text('// The runtime reports its own budget: a model switch restarts the idle runtime and resumes the same chat.', ...METER_V1.split('\n').slice(0, -1));
const BUSY_TEXT = 'Sigue leyendo designer.mjs y apunta lo que cambia del modo diseño';
// What the busy chat is told each time it stops (a short line: the first one is not repeated), and the follow-up of the busy task.
const BUSY_AGAIN = 'Continúa con el diagnóstico.';
const TASK_AGAIN = 'Sigue con la traducción.';
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
// One task per state the board shows. `after`: the title of the task it waits for (a failed or held one stays that way, so the wait lasts;
// a finished one only keeps two writers of the same folder from running together);
// `mode: 'aislada'`: its own branch (a worktree). PROGRESO reports 40 %, DUERME keeps it working, ZAP_TODO empties its folder (held for review).
const TASKS = [
  { project: 'tienda-web', title: 'Traducir las fichas de producto', agent: 'codex', text: 'Traduce las fichas de producto al inglés y al francés.', reply: 'Traduciendo…', append: 'PROGRESO DUERME', busy: true },
  { project: 'api-pagos', title: 'Migrar el cobro a la API nueva de Stripe', agent: 'cursor', text: 'Migra el cobro y haz el pago de la factura con la tarjeta de prueba.', reply: 'Hecho.' },
  { project: 'api-pagos', title: 'Revisar el checkout', agent: 'claude', text: 'Revisa el checkout y deja el resultado a punto de aceptar.', reply: 'Revisado: el checkout guarda el carrito entre recargas.', files: { 'src/checkout.js': text('export const checkout = (carrito) => ({ ...carrito, guardado: true });') } },
  { project: 'orb-dev', title: 'Revisar el contador', agent: 'claude', origin: 'contador', text: 'Revisa el contador de contexto y deja el resultado dicho.', reply: 'Revisado: el contador usa el presupuesto del runtime.' },
  { project: 'orb-dev', title: 'Probar en el móvil', agent: 'claude', origin: 'contador', after: 'Revisar el contador', text: 'Prueba el contador en el móvil y deja el resultado a punto de aceptar.', reply: 'Probado: el contador se ve bien en el móvil.',
    files: { 'docs/prueba-movil.md': text('# Prueba en el móvil', '', 'El contador se ve bien.'), 'src/context-meter.js': text('export function ContextMeter({ context }) {', '  const pct = context.size ? Math.round((context.used / context.size) * 100) : null;', '  return { pct, mobile: true };', '}'), 'test/movil-contador.test.js': text(...repeat(8, (n) => `test('móvil ${n}', () => assert.ok(${n}));`)) } },
  { project: 'api-pagos', title: 'Limpiar dependencias sin usar', agent: 'codex', text: 'Limpia las dependencias sin usar de la API.', reply: 'No pude terminar.', append: 'FALLA' },
  { project: 'blog', title: 'Ordenar las exportaciones antiguas', agent: 'claude', text: 'Ordena la carpeta de exportaciones antiguas del blog.', reply: 'Carpeta ordenada.', append: 'ZAP_TODO' },
  { project: 'tienda-web', title: 'Cambiar la tipografía de la tienda', agent: 'claude', mode: 'aislada', text: 'Cambia la tipografía de la tienda a una más legible.', reply: 'Tipografía cambiada en una rama propia.', files: { 'src/tipografia.js': text("export const fuente = 'Inter';", 'export const tamano = 16;') } },
  { project: 'tienda-web', title: 'Paginar el listado de entradas', agent: 'codex', after: 'Limpiar dependencias sin usar', text: 'Pagina el listado de entradas de la tienda.', reply: 'Paginado.' },
  { project: 'tienda-web', title: 'Optimizar las imágenes del catálogo', agent: 'cursor', after: 'Ordenar las exportaciones antiguas', text: 'Optimiza las imágenes del catálogo.', reply: 'Optimizadas.' }
];
// What the schedules run (their instructions are the task's text). The weekly one fails on purpose: «Reintentar» in its run.
const RUNS = [
  { text: 'Resume los errores de la noche.', reply: '3 errores nuevos, ninguno grave.' },
  { text: 'Revisa las dependencias y avisa de lo que falle.', reply: 'login_test y pago_test fallan.', append: 'FALLA' },
  { text: 'Prepara el informe mensual de visitas del blog.', reply: 'Informe listo: 12 400 visitas, un 8 % más que el mes pasado.' }
];
const ORBE = [{ text: 'Dame tres planes para el fin de semana si llueve.', reply: 'Te dejo tres planes con lluvia: un museo por la mañana, una peli con comida en casa y una partida de mesa con amigos.' },
  { text: 'Gracias, me quedo con el museo. ¿A qué hora abre?', reply: 'Casi todos abren a las 10:00. Mira el horario del que elijas antes de salir.' }];
// ORB_EXPLORA_EXTRA=1, a second chat with Orbe: a message with two files attached, then a task ordered from the chat whose
// turn Orb stops (fake-live's CREA_TAREA makes a task whose text is STOP_WHEN; the plan's «stop» sends the guard's event).
const ORBE_STOP = [{ text: 'Mira esta captura del error al cobrar y el registro de la pasarela.', reply: 'El cobro falla con un 401: la clave de pruebas de la pasarela ha caducado. Hay que renovarla y repetir el cobro.' },
  { text: 'Encarga a un agente que lo revise en api-pagos.', reply: 'Encargado. Te aviso en cuanto termine.', append: 'CREA_TAREA api-pagos' }];
const STOP_TITLE = 'Error al cobrar con tarjeta';
const STOP_WHEN = 'ESCRIBE un archivo de prueba';
const STOP_WHY = 'leer el archivo .env de otro proyecto';
const STOP = { cause: 'guard', why: STOP_WHY, body: `Orb ha parado el turno: el agente ejecutó por su cuenta algo que no está permitido (${STOP_WHY}).` };
// ORB_EXPLORA_EXTRA=1: a sensitive task approved by the tour (the same call as the window's «Aprobar»), for the «Firma» row.
const SIGNED = { project: 'api-pagos', title: 'Repetir el cobro de marzo', agent: 'cursor', text: 'Repite el cobro y haz el pago de la factura de marzo con la tarjeta de prueba.', reply: 'Cobro repetido en el entorno de pruebas.' };
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ORB_EXPLORA_PIP=1: a turn whose fake agent opens a local page in the agents' browser (NAVEGA_GUION: open, picture, wait so
// the live window stays up); the script file is written with the page's port once the local site is listening.
const PIP = process.env.ORB_EXPLORA_PIP === '1';
const PIP_SCRIPT = path.join(tmp, 'explora-vivo.json');
const PIP_TURN = { text: 'Abre la web de ejemplo en el navegador y dime qué ves.', reply: 'He abierto la web de ejemplo: veo un título y un formulario.', append: `NAVEGA_GUION ${PIP_SCRIPT}` };

// The two files the fake agents read at start (so they exist before Orb launches): the natural answers and the side effects.
function writeFakes() {
  const turns = [...CHATS.flatMap((c) => c.turns), ...TASKS, ...RUNS, ...ORBE, ...ORBE_STOP, SIGNED, ...(PIP ? [PIP_TURN] : [])];
  const script = path.join(tmp, 'explora-guion.json'); const plan = path.join(tmp, 'explora-plan.json');
  fs.writeFileSync(script, JSON.stringify(turns.map((t) => ({ when: t.text, reply: t.reply }))));
  // the two «keep working» lines are not seeded turns: they only need DUERME to reach the fake agent
  fs.writeFileSync(plan, JSON.stringify([...turns.filter((t) => t.files || t.append).map((t) => ({ when: t.text, files: t.files, append: t.append })),
    { when: BUSY_AGAIN, append: 'DUERME' }, { when: TASK_AGAIN, append: 'PROGRESO DUERME' }, { when: STOP_WHEN, stop: STOP }]));
  // the extra pass shows consumption on the account cards: the fake Claude and Codex report part of their windows used
  return { ORB_FAKE_AGENTS: path.join(ROOT, 'test', 'fixtures', 'fake-explora.mjs'), ORB_FAKE_SCRIPT: script, ORB_EXPLORA_PLAN: plan, ...(EXTRA ? { ORB_EXPLORA_USAGE: '1' } : {}) };
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
    // a remote inside the temp folder (no network): the branch is pushed, then one more commit stays unpushed, so God mode
    // shows «1 por delante de…»
    if (repo.remote) {
      const bare = path.join(tmp, 'Remotos', `${name}.git`); fs.mkdirSync(bare, { recursive: true });
      git('init', '--bare', '-b', 'main', bare); git('remote', 'add', 'origin', bare); git('push', '-u', 'origin', repo.git);
      fs.appendFileSync(path.join(dir, 'README.md'), String.fromCharCode(10) + 'Notas de la rama.' + String.fromCharCode(10));
      git('add', '-A'); git('commit', '-m', 'docs: add branch notes');
    }
  }
  return dirs;
}

// Notes, windows and the temp folder, then out (also the end of the ORB_EXPLORA_START=1 run).
async function finish(code = process.exitCode ?? 0) {
  fs.writeFileSync(path.join(OUT, 'notas.txt'), notes.join(String.fromCharCode(10)));
  for (const stop of opened) { try { await stop(); } catch { /* already closed */ } }
  if (!SERVE) { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a file still open: the temp folder stays */ } }
  process.exit(code);
}
// SERVE: what a later start needs (the ORB_* Orb was started with), then out WITHOUT closing Orb.
function serveLeave(orb) {
  const env = { ...orb.orbEnv };
  for (const [k, v] of Object.entries(env)) if (/["%!\r\n]/.test(v)) throw new Error(`${k}: el valor no cabe en un .cmd`);
  fs.writeFileSync(path.join(tmp, 'probar-entorno.json'), JSON.stringify({ exe: E2E_EXE, env, pid: orb.pid }, null, 2));
  fs.writeFileSync(path.join(tmp, 'probar-entorno.cmd'), [...Object.entries(env).map(([k, v]) => `set "${k}=${v}"`), `set "PROBAR_EXE=${E2E_EXE}"`, ''].join('\r\n'));
  fs.writeFileSync(path.join(OUT, 'notas.txt'), notes.join(String.fromCharCode(10)));
  console.log(`Orb queda abierto (pid ${orb.pid}) con datos en ${tmp}`);
  process.exit(0);
}

try {
  if (process.env.ORB_EXPLORA_START === '1') {
    const userData = path.join(tmp, 'arranque'); fs.mkdirSync(userData);
    const base = path.join(tmp, 'PrimerPC'); fs.mkdirSync(base);
    const { page, errors } = await open(userData, { ORB_DEFAULT_BASE: base });
    const shot = shooter(page);
    await page.addInitScript(() => { const m = /^orb-start-preview:(.+)$/.exec(window.name); if (m) window.__ORB_START_PREVIEW__ = m[1]; });
    const ALL = ['core', 'core-sin', 'core-danada', 'core-confirma', 'migra', 'migra-act', 'error', 'clave', 'falla', 'falla-red', 'actualiza'];
    const only = process.env.ORB_EXPLORA_START_ONLY ? process.env.ORB_EXPLORA_START_ONLY.split(',') : ALL;
    for (const name of ALL.filter((n) => only.includes(n))) {
      try {
        await page.evaluate((n) => { window.name = `orb-start-preview:${n}`; }, name);
        await page.reload();
        await page.waitForSelector(`[data-testid=start-preview][data-preview="${name}"]`, { timeout: 20000 });
        if (name === 'core-confirma' || name === 'clave') await page.waitForSelector('[data-slot=dialog-content]', { timeout: 10000 });
        await page.evaluate(() => { const tag = document.querySelector('[data-testid=start-preview-tag]'); if (tag) tag.style.display = 'none'; });
        for (const night of [false, true]) {
          await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), night);
          await shot(`arranque-${name}${night ? '-noche' : ''}`);
        }
      } catch (error) { note(`arranque/${name}: ${String(error?.message ?? error).split(String.fromCharCode(10))[0]}`); }
    }
    await page.evaluate(() => { window.name = ''; }).catch(() => {});
    note(`errores de la página: ${errors.join(' | ') || 'ninguno'}`);
    await finish(0);
  }
  // ---- 1. a brand-new PC: the welcome wizard, straight into the app.
  if (!SERVE) {
    const userData = path.join(tmp, 'nuevo'); fs.mkdirSync(userData);
    const base = path.join(tmp, 'PrimerPC'); fs.mkdirSync(base);
    // ORB_EXPLORA_EXTRA=1: the folders an earlier Orb kept at the top (bitacora, android/adb-tools, mcp-servers/notas), so that
    // the welcome has its «Ordenar carpetas» step (it only shows when there is something to move).
    if (EXTRA) {
      const old = path.join(base, 'Orb');
      fs.mkdirSync(path.join(old, 'bitacora'), { recursive: true }); fs.writeFileSync(path.join(old, 'bitacora', 'GENERAL.md'), '# Bitácora' + String.fromCharCode(10));
      fs.mkdirSync(path.join(old, 'android', 'adb-tools'), { recursive: true });
      fs.mkdirSync(path.join(old, 'mcp-servers', 'notas'), { recursive: true });
    }
    const { page, errors, close } = await open(userData, { ORB_DEFAULT_BASE: base });
    const shot = shooter(page);
    // 3.7: the 3.5.1 welcome: the assistant's name, what to call you, the folder (3.8: already chosen: ORB_DEFAULT_BASE);
    // 3.8: «Ordenar carpetas» when there is something to move and «Crea tu contraseña maestra»; on Windows «Preparando
    // tu PC».
    await page.waitForSelector('[data-testid=setup-datos]');
    note(`ventana inicial: ${(await page.evaluate(() => [innerWidth, innerHeight])).join('x')}`);
    await page.fill('[data-testid=setup-user]', 'Ana');
    await shot('00-bienvenida');
    // The welcome has no day / night control: before the setup the theme follows the system, so the dark pictures change the
    // system's colour scheme (the transparency setting of open() is kept) and give it back.
    const scheme = async (value) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }, ...(value ? [{ name: 'prefers-color-scheme', value }] : [])] });
      await page.waitForTimeout(400);
    };
    const darkShot = async (name) => {
      try { await scheme('dark'); await shot(`${name}-oscuro`); }
      catch (error) { note(`bienvenida oscura: ${name}: ${String(error?.message ?? error).split(String.fromCharCode(10))[0]}`); }
      finally { await scheme(null).catch(() => {}); }
    };
    await darkShot('00-bienvenida');
    const screens = { theme: '00a-tu-tema', layout: '00a-ordenar-carpetas', master: '00a-contrasena-maestra', prepare: '00b-preparo-equipo' };
    const onScreen = async (name) => {
      // «Tu tema» with another theme marked, then back to the default so the rest of the tour keeps it
      if (EXTRA && name === 'theme') {
        try {
          await page.click('[data-testid=setup-skin-vaporwave]', { timeout: 4000 }); await page.waitForTimeout(400);
          await shot('00a-tu-tema-vaporwave'); await darkShot('00a-tu-tema-vaporwave');
          await page.click('[data-testid=setup-skin-predeterminado]', { timeout: 4000 }); await page.waitForTimeout(400);
        } catch (error) { note(`bienvenida: no se pudo marcar otro tema (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); }
      }
      await shot(screens[name]); await darkShot(screens[name]);
      // «Crea tu contraseña maestra» with both fields written (a made-up example, cleared again so throughStart fills them as before)
      if (name === 'master') {
        try {
          const example = 'contraseña-de-ejemplo-1';
          await page.fill('[data-testid=master-new]', example); await page.fill('[data-testid=master-again]', example); await page.waitForTimeout(300);
          await shot('00a-contrasena-maestra-escrita'); await darkShot('00a-contrasena-maestra-escrita');
          await page.fill('[data-testid=master-new]', ''); await page.fill('[data-testid=master-again]', '');
        } catch (error) { note(`bienvenida: no se pudo rellenar la contraseña de ejemplo (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); }
      }
    };
    // The folder comes chosen (ORB_DEFAULT_BASE): «Cambiar ubicación…» would open Windows' own dialog.
    await page.click('[data-testid=setup-create]');
    const seen = await throughStart(page, { ready: '[data-testid=sidebar-home]', onScreen, layout: EXTRA ? 'keep' : 'apply' });
    note(`pantallas de bienvenida: ${seen.join(' → ') || 'ninguna'}`);
    if (!seen.includes('master')) note('no salió «Crea tu contraseña maestra»');
    await shot('01c-primer-chat');
    note(`errores en bienvenida: ${errors.join(' | ') || 'ninguno'}`);
    await close();
  }

  // ---- 2. an assistant already created: every view
  const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  // SERVE: the workspace must never land on the default place (C:\Orb): the welcome's folder comes chosen, and the phone link
  // (off by default) would only listen on this PC.
  const serveEnv = SERVE ? { ORB_DEFAULT_BASE: base, ORB_REMOTE_BIND: '127.0.0.1' } : {};
  if (WELCOME) {
    const profile = path.join(tmp, 'perfil'); fs.mkdirSync(profile, { recursive: true });
    const { orb } = await open(profile, { ...writeFakes(), ...serveEnv });
    note('Orb abierto en la bienvenida, sin datos de ejemplo (agentes falsos)');
    serveLeave(orb);
  }
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Alex' });
  writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } })); // 2.6: no guided tour in the tests
  fs.mkdirSync(path.join(home, 'web', 'webviaproject', 'src'), { recursive: true });
  fs.writeFileSync(path.join(home, 'web', 'webviaproject', 'src', 'index.html'), '<h1>hola</h1>\n');
  const userData = path.join(tmp, SERVE ? 'perfil' : 'datos'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
  // The fake agents (and the demo folders) must exist before Orb starts: the engine reads them at launch.
  const dirs = SEED ? await attempt('las carpetas de los proyectos', makeRepos) ?? {} : {};
  const fakes = SEED ? await attempt('los agentes falsos', writeFakes) ?? {} : {};
  if (SEED && !fakes.ORB_FAKE_AGENTS) note('sin agentes falsos: no habrá chats sembrados');
  const { page, errors, close, orb: launched } = await open(userData, { ...fakes, ...serveEnv });
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
    // the second chat with Orbe (files attached, and a task of the chat whose turn Orb stops)
    if (EXTRA) await attempt('el chat con Orbe con adjuntos y una parada', async () => {
      const dir = path.join(tmp, 'Descargas'); fs.mkdirSync(dir, { recursive: true });
      const picture = path.join(dir, 'error-al-cobrar.png'); const record = path.join(dir, 'pasarela.log');
      fs.writeFileSync(picture, Buffer.from(PNG_1PX, 'base64')); fs.writeFileSync(record, '12:04:11 POST /cobros 401 clave caducada\n');
      const lines = async () => call('chat.list', { conversation: ids.parada });
      ids.parada = (await call('chat.send', { text: ORBE_STOP[0].text, project: '', images: [picture, record] })).conversation;
      await until(async () => (await lines()).some((l) => l.role === 'orb'), 'respuesta de Orbe al adjunto', 30000);
      await call('chat.send', { text: ORBE_STOP[1].text, conversation: ids.parada });
      await call('conversations.update', { id: ids.parada, title: STOP_TITLE });
      await until(async () => (await lines()).some((l) => l.meta?.kind === 'turn-stopped'), 'la línea «Orb ha parado el turno»', 40000);
    });
    // a sensitive task approved as the window does (what it showed, by its hash): its detail has the «Firma» row verified
    if (EXTRA) await attempt('la tarea aprobada', async () => {
      const made = await call('tasks.create', { project: SIGNED.project, title: SIGNED.title, description: SIGNED.text, agent: SIGNED.agent });
      const full = await call('tasks.get', { id: made.id });
      if (!full.sensitivity?.length) return note(`«${SIGNED.title}» no pide aprobación: la fila «Firma» saldrá como «no necesitaba aprobación»`);
      await call('tasks.approve', { id: made.id, decision: 'approved', hash: full.previewHash });
    });
    const taskIds = {};
    for (const t of TASKS) {
      await attempt(`la tarea «${t.title}»`, async () => {
        // `origin`: the chat (by its key) the task was ordered from, so its Ficha lists it under «Tareas de este chat»
        const made = await call('tasks.create', { project: t.project, title: t.title, description: t.text, agent: t.agent, ...(t.origin && ids[t.origin] ? { origin_session: String(ids[t.origin]) } : {}), ...(t.mode ? { mode: t.mode } : {}), ...(t.after && taskIds[t.after] ? { depends_on: [taskIds[t.after]] } : {}) });
        taskIds[t.title] = made.id;
      });
    }
    await attempt('el fin de las tareas', () => until(async () => { const l = await call('tasks.list'); return l.some((x) => x.status === 'failed' || x.status === 'blocked') && l.some((x) => x.status === 'done'); }, 'tareas terminadas', 40000)).then((v) => { if (v === null) note('las tareas no llegaron a todos sus estados (mira la vista Tareas)'); });
    // the task that empties its folder is held for review (status blocked + «task.held»): a short wait, and a note when it is not
    await attempt('la tarea retenida', () => until(async () => (await call('tasks.list')).some((x) => x.held), 'tarea retenida', 20000)).then((v) => { if (v === null) note('ninguna tarea llegó a «retenida» (la vista Tareas no la enseñará)'); });
    await attempt('la programada diaria', () => call('schedules.create', { project: 'api-pagos', title: 'Resumen de errores de la noche', description: 'Resume los errores de la noche.', agent: 'codex', readonly: true, every: 'daily', at_time: '08:30' }));
    await attempt('la programada semanal', () => call('schedules.create', { project: 'tienda-web', title: 'Revisión semanal de dependencias', description: 'Revisa las dependencias y avisa de lo que falle.', agent: 'claude', model: 'sonnet', every: 'weekly', weekdays: [1], at_time: '09:00' }));
    // a monthly one in another time zone (the day 31 falls on the last day of shorter months)
    await attempt('la programada mensual', () => call('schedules.create', { project: 'blog', title: 'Informe mensual de visitas', description: RUNS[2].text, agent: 'claude', readonly: true, every: 'monthly', month_day: 31, at_time: '07:00', tz: 'Asia/Tokyo' }));
    // marks of the sidebar: one pinned, one completed, and unread only where the demo wants it (the rest are read)
    for (const c of CHATS) {
      if (!ids[c.key]) continue;
      if (c.pinned) await attempt(`fijar «${c.title}»`, () => call('inbox.pin', { kind: 'session', id: ids[c.key] }));
      if (c.complete) await attempt(`completar «${c.title}»`, () => call('sidebar.complete', { key: `s${ids[c.key]}`, done: true }));
      if (!c.unread) await attempt(`marcar leído «${c.title}»`, () => call('inbox.markRead', { kind: 'session', id: ids[c.key] }));
    }
    // «Probar en el móvil» has its files only if it ran alone in its folder: wait for it, and say so when its diff is empty
    await attempt('el fin de «Probar en el móvil»', () => until(async () => (await call('tasks.list')).some((x) => x.title === 'Probar en el móvil' && x.status === 'done'), 'tarea con cambios', 40000));
    await attempt('el diff de «Probar en el móvil»', async () => {
      const mine = (await call('tasks.list')).find((x) => x.title === 'Probar en el móvil');
      const d = mine ? await call('tasks.diff', { id: mine.id, stat: true }).catch(() => null) : null;
      if (!d?.available || !d.files.length) note(`«Probar en el móvil» termina sin cambios (${d?.available ? 0 : 'sin foto de git'}): la pestaña Cambios no tendrá sus archivos`);
    });
    // a run of each schedule (the daily one is read only): the «Últimas ejecuciones» of Programadas
    await attempt('las ejecuciones de las programadas', async () => {
      for (const s of await call('schedules.list')) await call('schedules.run', { id: s.id });
      await until(async () => (await call('tasks.list')).filter((x) => x.schedule_id && ['done', 'failed', 'blocked'].includes(x.status)).length >= 2, 'ejecuciones terminadas', 40000);
    });
    // the finished project goes last: it is gone from every picker of the pictures that follow
    await attempt('el proyecto terminado', () => call('projects.finish', { name: 'web-antigua' }));
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
      if (BUSY !== 'chat') {
        // One row only: when the task stops it is written to again (a follow-up requeues the same task) instead of creating another one.
        const list = await call('tasks.list');
        const mine = list.find((x) => x.title === busyTask.title);
        if (!list.some((x) => x.status === 'running') && !(mine && mine.status === 'queued')) {
          if (mine && mine.status !== 'cancelled') await call('tasks.followup', { id: mine.id, text: TASK_AGAIN });
          else await call('tasks.create', { project: busyTask.project, title: busyTask.title, description: busyTask.text, agent: busyTask.agent });
          await until(async () => (await call('tasks.list')).some((x) => x.status === 'running'), 'tarea en curso', 8000).catch(() => noteOnce('la tarea «en curso» no llegó a arrancar'));
        }
      }
      const s = ids.diseno ? await sessionOf(ids.diseno) : null;
      if (BUSY !== 'task' && s && s.status !== 'running') await call('sessions.send', { id: s.id, text: BUSY_AGAIN });
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
  // SERVE: seeded; the busy work is started once more, the first chat is opened and Orb stays as it is for whoever tries it.
  if (SERVE) {
    await keepBusy();
    await openChat(CHATS[0].title);
    serveLeave(launched);
  }
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
  // The board with the seeded tasks: the list with its panel closed, a task waiting for its OK, the Cambios of a finished one and the
  // «Deshacer esta tarea» dialog (closed with Cancelar, never confirmed). Every step is short and a missing piece is a note.
  const taskShots = async (prefix) => {
    if (!seeded) return;
    await keepBusy();
    if (!(await tap('nav-tasks', 'Tareas'))) return;
    const rowOf = (title) => page.locator('[data-testid=task-row]', { hasText: title }).first();
    const openTask = async (title) => {
      try { await rowOf(title).locator('[data-testid=task-open]').click({ timeout: 3000 }); await page.waitForTimeout(600); return true; } catch { noteOnce(`Tareas: sin fila «${title}»`); return false; }
    };
    await page.locator('[data-testid=task-filters] [role=tab]').first().click({ timeout: 3000 }).catch(() => noteOnce('Tareas: sin la pestaña «Todas»'));
    await page.locator('[data-testid=task-row]').first().waitFor({ timeout: 4000 }).catch(() => noteOnce('Tareas: ninguna fila a la vista'));
    if (await page.locator('[data-testid=task-panel-close]').count()) { await tap('task-panel-close', 'cerrar el panel de la tarea'); await shot(`${prefix}-tareas-lista`); } else noteOnce('Tareas: el panel no estaba abierto para cerrarlo');
    if (await openTask('Migrar el cobro')) await shot(`${prefix}-tareas-detalle`);
    // The Cambios tab only exists once a task has finished with a git checkpoint and files changed. The seeded task meant for it
    // is waited for; when it has no diff, the first finished task that has one takes its place and the note says what each had.
    const wanted = 'Probar en el móvil';
    await until(async () => (await call('tasks.list')).some((x) => x.title === wanted && x.status === 'done'), 'tarea terminada', 8000)
      .catch(async () => noteOnce(`Tareas: «${wanted}» no está «Completada» (estado: ${(await call('tasks.list').catch(() => [])).find((x) => x.title === wanted)?.status ?? 'no existe'})`));
    const stats = [];
    for (const x of (await call('tasks.list').catch(() => [])).filter((y) => y.status === 'done')) {
      const d = await call('tasks.diff', { id: x.id, stat: true }).catch(() => null);
      stats.push({ title: x.title, files: d?.available ? d.files.length + (d.more ?? 0) : -1 });
    }
    const changesTask = (stats.find((x) => x.title === wanted && x.files > 0) ?? stats.find((x) => x.files > 0))?.title;
    if (!changesTask) noteOnce(`Tareas: ninguna tarea terminada tiene cambios (${stats.map((x) => `«${x.title}»: ${x.files < 0 ? 'sin foto de git' : `${x.files} archivos`}`).join('; ') || 'ninguna terminada'})`);
    else if (changesTask !== wanted) noteOnce(`Tareas: «${wanted}» no tiene cambios (${stats.find((x) => x.title === wanted)?.files ?? 'no terminó'}); Cambios se captura con «${changesTask}»`);
    if (changesTask && await openTask(changesTask)) {
      await page.locator('[data-testid=task-panel-tab-changes]').first().waitFor({ timeout: 8000 }).catch(() => {});
      if (await tap('task-panel-tab-changes', 'la pestaña «Cambios» de la tarea')) {
        await page.locator('[data-testid=task-changes]').first().waitFor({ timeout: 5000 }).catch(() => noteOnce('Tareas: la pestaña Cambios no enseña la lista de archivos'));
        // the diff of one file open (the second one when there is one: the first is usually a plain addition)
        const files = page.locator('[data-testid=task-change]');
        if (await files.count().catch(() => 0)) { await files.nth(Math.min(1, (await files.count()) - 1)).click({ timeout: 3000 }).catch(() => noteOnce('Tareas: no se pudo abrir el diff de un archivo')); await page.waitForTimeout(500); }
        else noteOnce('Tareas: la pestaña Cambios no lista archivos');
        await shot(`${prefix}-tareas-cambios`);
      } else noteOnce(`Tareas: «${changesTask}» no tiene pestaña Cambios (sin diff)`);
    }
    await page.locator('[data-testid=task-row]').first().waitFor({ timeout: 2000 }).catch(() => {});
    const undo = rowOf('Ordenar las exportaciones').locator('[data-testid=task-row-undo]').first();
    if (await undo.count()) {
      try {
        await undo.click({ timeout: 3000 });
        // a plain confirmation (no test ids of its own): only its Cancelar is ever pressed
        const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Cancelar|Cancel)$/ });
        await cancel.waitFor({ timeout: 3000 });
        await page.waitForTimeout(300);
        await shot(`${prefix}-tareas-deshacer`);
        await cancel.click({ timeout: 3000 });
        await page.waitForTimeout(300);
      } catch { noteOnce('Tareas: no se pudo abrir o cerrar el diálogo «Deshacer esta tarea»'); await closeMenus(); }
    } else noteOnce('Tareas: sin tarea retenida con «Deshacer esta tarea» en su fila');
    // «Aceptar» of the held task asks first, with the reason the guard held it: Cancelar is the only button ever pressed
    const accept = rowOf('Ordenar las exportaciones').locator('[data-testid=task-row-accept]').first();
    if (await accept.count()) {
      try {
        await accept.click({ timeout: 3000 });
        const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Cancelar|Cancel)$/ });
        await cancel.waitFor({ timeout: 3000 });
        await page.waitForTimeout(300);
        await shot(`${prefix}-tareas-aceptar`);
        await cancel.click({ timeout: 3000 });
        await page.waitForTimeout(300);
      } catch { noteOnce('Tareas: no se pudo abrir o cerrar la confirmación de «Aceptar»'); await closeMenus(); }
    } else noteOnce('Tareas: sin «Aceptar» en la fila de la tarea retenida');
  };
  // The extra pass of Tareas: a file whole (after and before), the Cambios tab of a task that changed nothing, and the
  // «Firma» row of the approved task. The button that opens a file in an editor is only looked for: pressing it would start one.
  const taskExtraShots = async (prefix) => {
    if (!seeded) return;
    try {
      if (!(await tap('nav-tasks', 'Tareas'))) return;
      const openTask = async (title) => {
        try { await page.locator('[data-testid=task-row]', { hasText: title }).first().locator('[data-testid=task-open]').click({ timeout: 3000 }); await page.waitForTimeout(600); return true; } catch { noteOnce(`Tareas: sin fila «${title}»`); return false; }
      };
      await page.locator('[data-testid=task-filters] [role=tab]').first().click({ timeout: 3000 }).catch(() => noteOnce('Tareas: sin la pestaña «Todas»'));
      await page.locator('[data-testid=task-row]').first().waitFor({ timeout: 4000 }).catch(() => noteOnce('Tareas: ninguna fila a la vista'));
      if (await openTask('Probar en el móvil') && await tap('task-panel-tab-changes', 'la pestaña «Cambios» de la tarea')) {
        const files = page.locator('[data-testid=task-change]');
        await files.first().waitFor({ timeout: 6000 }).catch(() => noteOnce('Tareas: la pestaña Cambios no lista archivos'));
        if (await files.count().catch(() => 0)) { await files.nth(Math.min(1, (await files.count()) - 1)).click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
        // a comment on one line of the diff (kept in this window only, for «Pedir cambios»): the «+» shows on hover
        const line = page.locator('[data-testid=patch-view] .dl[data-change]').first();
        if (await line.hover({ timeout: 3000 }).then(() => true, () => false) && await tap('diff-comment-add', 'el «+» de una línea del diff')) {
          const box = page.locator('[data-testid=diff-comment-box] textarea').first();
          if (await box.fill('Guarda con un retraso de 300 ms: así no escribe en cada tecla.', { timeout: 3000 }).then(() => true, () => false) && await tap('diff-comment-save', 'guardar el comentario de la línea')) {
            await page.mouse.move(700, 120); await page.waitForTimeout(300); await shot(`${prefix}-tareas-cambios-comentario`);
          } else { noteOnce('Tareas: no se pudo escribir el comentario de una línea'); await closeMenus(); }
        } else noteOnce('Tareas: una línea del diff no ofrece comentarla');
        if (await tap('task-change-more', 'el «⋯» del archivo abierto')) await shot(`${prefix}-tareas-cambios-menu`);
        // the switch keeps its menu open (it is a check): Escape closes it before anything else is pressed
        if (await tap('task-change-whole', '«Archivo entero» en el «⋯» del archivo')) {
          await closeMenus();
          await page.locator('[data-testid=file-view]').first().waitFor({ timeout: 5000 }).catch(() => noteOnce('Tareas: «Archivo entero» no enseña el archivo'));
          await shot(`${prefix}-tareas-cambios-entero`);
          if (await tap('task-change-more', 'el «⋯» del archivo abierto')) await tap('task-change-whole', 'volver al parche');
        }
        await closeMenus();
        if (await tap('task-changes-before', '«Antes» de los cambios')) {
          await page.locator('[data-testid=file-view]').first().waitFor({ timeout: 5000 }).catch(() => noteOnce('Tareas: «Antes» no enseña el archivo entero'));
          await shot(`${prefix}-tareas-cambios-antes`);
          await tap('task-changes-after', 'volver a «Después»');
        }
        if (!(await page.locator('[data-testid=open-file-in]').count())) noteOnce('Tareas: sin botón para abrir el archivo en el editor (¿ningún editor instalado en este PC?)');
      }
      // a task that changed nothing keeps its Cambios tab, with the reason
      if (await openTask('Revisar el contador') && await tap('task-panel-tab-changes', 'la pestaña «Cambios» de una tarea sin cambios')) {
        const empty = page.locator('[data-testid=task-changes-empty]:not([data-reason=loading])').first();
        await empty.waitFor({ timeout: 6000 }).catch(() => noteOnce('Tareas: la pestaña Cambios vacía no dice por qué'));
        await shot(`${prefix}-tareas-cambios-vacio`);
      }
      // the «Firma» row of the approved task
      if (await openTask(SIGNED.title)) {
        await tap('task-panel-tab-detail', 'la pestaña «Detalle»');
        const sign = page.locator('[data-testid=task-sign]').first();
        await sign.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => noteOnce('Tareas: el detalle no tiene la fila «Firma»'));
        const state = await sign.getAttribute('data-state', { timeout: 2000 }).catch(() => null);
        if (state !== 'verified') noteOnce(`Tareas: la firma de «${SIGNED.title}» sale como «${state ?? 'sin fila'}», no como verificada`);
        await shot(`${prefix}-tareas-firma`);
      }
      await tap('task-panel-tab-detail', 'volver a «Detalle»');
    } catch (error) { noteOnce(`capturas de Tareas: el recorrido se cortó (${String(error?.message ?? error).split('\n')[0]})`); await closeMenus(); }
  };
  // Proyectos: the list, what its header and rows open (new project, tidy folders, change category) and one project's page
  // with its tabs, its «⋯», the closed pull requests, «Sincronizar», «Escribir entrada» and the menu of «Encargar una tarea».
  // Only opens and cancels: it never presses Sincronizar, Mover, Crear, Guardar, Fusionar, Permitir or Comentar.
  const projectPageShots = async (prefix) => {
    if (!seeded) return;
    const cancelDialog = async (what) => {
      const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Cancelar|Cancel)$/ }).first();
      if (await cancel.click({ timeout: 3000 }).then(() => true, () => false)) { await page.waitForTimeout(300); return; }
      noteOnce(`Proyectos: sin «Cancelar» en ${what}`); await closeMenus();
    };
    try {
      if (!(await tap('nav-projects', 'Proyectos'))) return;
      // each row asks for its git state in turn (a queue): the list is shot once the rows of the repositories show their branch
      await until(async () => (await page.locator('[data-testid=project-facts] svg.lucide-git-branch').count()) >= 3, 'la línea de git de las filas', 12000)
        .catch(async () => noteOnce(`Proyectos: solo ${await page.locator('[data-testid=project-facts] svg.lucide-git-branch').count().catch(() => 0)} filas enseñan su rama`));
      await page.waitForTimeout(400); await shot(`${prefix}-proyectos-lista`);
      // «Nuevo proyecto» with its «Plantilla y git» switch and what it keeps under «Más opciones»
      if (await tap('project-new', '«Nuevo» de Proyectos') && await tap('project-new-create', '«Crear un proyecto»')) {
        await page.locator('[data-testid=project-template]').first().waitFor({ timeout: 4000 }).catch(() => noteOnce('Proyectos: el diálogo de crear no tiene «Plantilla y git»'));
        await shot(`${prefix}-proyecto-nuevo`);
        await cancelDialog('el diálogo de crear un proyecto');
      } else await closeMenus();
      // «Ordenar carpetas»: its review, or the notice that says why it does not open (work in progress, nothing to tidy)
      if (await tap('projects-arrange', '«Ordenar carpetas» de la cabecera')) {
        await page.waitForTimeout(900); await shot(`${prefix}-proyectos-ordenar`);
        if (await page.locator('[data-testid=projects-arrange-panel]').count()) await tap('projects-arrange-close', 'cerrar «Ordenar carpetas»');
      }
      // «Cambiar categoría» from the row's «⋯»
      const row = page.locator('[data-testid=project-row]', { hasText: 'tienda-web' }).first();
      if (await row.locator('[data-testid=project-menu]').first().click({ timeout: 4000 }).then(() => true, () => false)) {
        await page.waitForTimeout(300);
        if (await tap('project-change-category', '«Cambiar categoría» del proyecto')) {
          await page.locator('[data-testid=project-category-select]').first().waitFor({ timeout: 4000 }).catch(() => noteOnce('Proyectos: «Cambiar categoría» no abre su diálogo'));
          await shot(`${prefix}-proyecto-categoria`);
          await cancelDialog('«Cambiar categoría»');
        } else await closeMenus();
      } else noteOnce('Proyectos: sin «⋯» en la fila de «tienda-web»');
      const name = row.locator('[data-testid=project-open-name]').first();
      if (!(await name.click({ timeout: 4000 }).then(() => true, () => false))) { noteOnce('Proyectos: sin fila «tienda-web» para abrir su página'); return; }
      await page.waitForTimeout(500); await shot(`${prefix}-proyecto`);
      // the project's own skills and MCP: the card, and the dialog that adds one from those installed (cancelled)
      if (await page.locator('[data-testid=project-extensions]').first().scrollIntoViewIfNeeded({ timeout: 3000 }).then(() => true, () => false)) {
        await page.waitForTimeout(300); await shot(`${prefix}-proyecto-skills-mcp`);
        if (await tap('project-ext-add', '«Añadir» de Skills y MCP del proyecto')) { await page.waitForTimeout(400); await shot(`${prefix}-proyecto-skills-mcp-anadir`); await cancelDialog('añadir skills o MCP al proyecto'); }
        await scrollView('top');
      } else noteOnce('Proyecto: sin la tarjeta «Skills y MCP del proyecto»');
      if (await tap('project-log-write', '«Escribir entrada» de la bitácora')) {
        await page.locator('[data-testid=project-log-entry-title]').first().waitFor({ timeout: 4000 }).catch(() => noteOnce('Proyecto: «Escribir entrada» no abre su diálogo'));
        await shot(`${prefix}-proyecto-entrada`);
        await cancelDialog('«Escribir entrada»');
      }
      if (await tap('project-tab-git', 'pestaña «Git y PR» del proyecto')) {
        await page.waitForTimeout(500); await shot(`${prefix}-proyecto-git`);
        if (await tap('project-pr-filter-merged', 'filtro «Fusionados» de las PR')) { await page.waitForTimeout(500); await shot(`${prefix}-proyecto-git-fusionados`); await tap('project-pr-filter-open', 'filtro «Abiertos» de las PR'); }
      }
      if (await tap('project-tab-tareas', 'pestaña «Tareas» del proyecto')) {
        await page.waitForTimeout(500); await shot(`${prefix}-proyecto-tareas`);
        if (await tap('project-new-task-more', 'la flecha de «Encargar una tarea»')) { await shot(`${prefix}-proyecto-tareas-menu`); await closeMenus(); }
      }
      if (await tap('project-more', '⋯ del proyecto')) { await shot(`${prefix}-proyecto-menu`); await closeMenus(); }
      await tap('project-back', 'volver a la lista de proyectos');
      // «Sincronizar» needs a remote: orb-dev has one inside the temp folder (no network). The plan is read first (a fetch from
      // it): its dialog, or the notice that says why not (agents at work, nothing to do). Never confirmed.
      const withRemote = page.locator('[data-testid=project-row]', { hasText: 'orb-dev' }).locator('[data-testid=project-open-name]').first();
      if (await withRemote.click({ timeout: 4000 }).then(() => true, () => false)) {
        await page.waitForTimeout(600);
        if (await tap('project-sync', '«Sincronizar» de la tarjeta de git')) {
          await page.locator('[data-testid=project-sync-dialog], [role=dialog]').first().waitFor({ timeout: 8000 }).catch(() => {});
          await shot(`${prefix}-proyecto-sincronizar`);
          if (await page.getByRole('dialog').count()) { const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Cancelar|Cancel)$/ }).first(); if (!(await cancel.click({ timeout: 3000 }).then(() => true, () => false))) await closeMenus(); }
        }
        await tap('project-back', 'volver a la lista de proyectos');
      } else noteOnce('Proyectos: sin fila «orb-dev» para «Sincronizar»');
    } catch (error) { noteOnce(`Proyectos: el recorrido se cortó (${String(error?.message ?? error).split('\n')[0]})`); await closeMenus(); }
  };
  // The whiteboard with its attachments and the new-schedule dialog, after the projects. Only opens and cancels.
  const projectShots = async (prefix) => {
    if (!seeded) return;
    await projectPageShots(prefix);
    try {
      if (await tap('nav-board', 'Pizarra')) {
        await page.waitForTimeout(500); await shot(`${prefix}-pizarra-sin-proyecto`);
        // The whiteboard belongs to the active project: one is chosen for the shots and the choice is undone afterwards.
        await call('projects.setActive', { name: 'tienda-web' }).catch(() => noteOnce('Pizarra: no se pudo elegir el proyecto «tienda-web»'));
        await page.locator('[data-testid=whiteboard-canvas] canvas').first().waitFor({ timeout: 20000 }).catch(() => noteOnce('Pizarra: el lienzo no aparece con un proyecto elegido'));
        await page.waitForTimeout(1500);
        if (await page.locator('[data-testid=whiteboard-toggle-panel]').count()) { await tap('whiteboard-toggle-panel', 'cerrar el panel de adjuntos de la pizarra'); await page.waitForTimeout(300); }
        await shot(`${prefix}-pizarra`);
        if (await page.locator('[data-testid=whiteboard-show-panel]').count()) { await tap('whiteboard-show-panel', 'panel de adjuntos de la pizarra'); await page.waitForTimeout(300); }
        if (await page.locator('[data-testid=whiteboard-panel]').count()) await shot(`${prefix}-pizarra-adjuntos`); else noteOnce('Pizarra: no hay panel de adjuntos con un proyecto elegido');
        if (await tap('whiteboard-more', '⋯ de la pizarra')) { await shot(`${prefix}-pizarra-adjuntos-menu`); await closeMenus(); }
        // the toolbar in the mock-up's order with one tool chosen, and the general note for the assistant (opened, nothing written)
        if (await tap('whiteboard-tool-rectangle', 'la herramienta «Rectángulo» de la barra de la pizarra')) { await shot(`${prefix}-pizarra-herramienta`); await tap('whiteboard-tool-selection', 'volver a «Seleccionar»'); }
        if (await tap('whiteboard-canvas-note', '«Nota para Orbe» del lienzo')) {
          await page.locator('[data-testid=whiteboard-canvas-note-text]').first().waitFor({ timeout: 3000 }).catch(() => noteOnce('Pizarra: «Nota para Orbe» no abre su caja'));
          await shot(`${prefix}-pizarra-nota`); await closeMenus();
        }
        await call('projects.setActive', { name: '' }).catch(() => {});
      }
      // Programadas: the dialog to create one (as it opens, then «Cada mes» with «Más opciones» unfolded) and the same dialog
      // editing the monthly one. Nothing is saved and «Ejecutar ahora» is never pressed.
      if (await tap('nav-schedules', 'Programadas')) {
        const leave = async (what) => { if (!(await tap('schedule-cancel', `«Cancelar» de ${what}`))) await closeMenus(); await page.waitForTimeout(300); };
        // «Últimas ejecuciones», at the end of the page (each seeded schedule ran once)
        if (await page.locator('[data-testid=schedule-runs]').first().scrollIntoViewIfNeeded({ timeout: 3000 }).then(() => true, () => false)) { await page.waitForTimeout(400); await shot(`${prefix}-programadas-ejecuciones`); await scrollView('top'); }
        else noteOnce('Programadas: sin «Últimas ejecuciones»');
        if (await tap('new-schedule', 'botón de nueva programada')) {
          await page.waitForTimeout(400); await shot(`${prefix}-programada-nueva`);
          if (await tap('schedule-every-monthly', 'la frecuencia «Cada mes»')) {
            await page.locator('[data-testid=schedule-more-options]').first().click({ timeout: 3000 }).catch(() => noteOnce('Programadas: sin «Más opciones» en el diálogo'));
            await page.waitForTimeout(300); await shot(`${prefix}-programada-mensual`);
          }
          await leave('la programada nueva');
        }
        const monthly = page.locator('[data-testid=schedule-row]', { hasText: 'Informe mensual' }).first();
        if (await monthly.locator('[data-testid=schedule-edit]').first().click({ timeout: 3000 }).then(() => true, () => false)) {
          await page.locator('[data-testid=schedule-dialog]').first().waitFor({ timeout: 4000 }).catch(() => noteOnce('Programadas: «Editar» no abre el diálogo'));
          await page.waitForTimeout(300); await shot(`${prefix}-programada-editar`);
          await leave('editar la programada');
        } else noteOnce('Programadas: sin la programada mensual sembrada para editarla');
      }
    } catch (error) { noteOnce(`Proyectos, pizarra y programadas: el recorrido se cortó (${String(error?.message ?? error).split('\n')[0]})`); await closeMenus(); }
  };
  // The rest of the places: usage (a tab of Agentes), the tutorials, the games (one is entered, none is played) and the
  // God mode, which is switched on for its shots and off again.
  const extraShots = async (prefix) => {
    if (!seeded) return;
    try {
      if (await tap('nav-agents', 'Agentes')) {
        await page.waitForTimeout(500); await shot(`${prefix}-agentes-cuentas`);
        if (await tap('agents-tab-usage', 'pestaña «Uso»')) {
          await page.waitForTimeout(800); await shot(`${prefix}-uso`);
          await page.locator('[data-testid=usage-limits]').first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => noteOnce('Uso: sin el bloque de límites'));
          await page.waitForTimeout(300); await shot(`${prefix}-uso-limites`);
          await tap('agents-tab-agents', 'pestaña «Agentes y cuentas»');
        }
      }
      if (await tap('nav-tutorials', 'Tutoriales')) { await page.waitForTimeout(500); await shot(`${prefix}-tutoriales`); }
      await goChat();
      if (await tap('orb-chat-more', '⋯ del chat con Orbe') && await tap('bar-games', '«Minijuegos» del menú')) {
        await page.locator('[data-testid=games-dialog]').waitFor({ timeout: 6000 }).catch(() => noteOnce('Juegos: el diálogo no se abrió'));
        await page.waitForTimeout(500); await shot(`${prefix}-juegos`);
        if (await tap('game-snake', 'el juego de la serpiente')) { await page.waitForTimeout(700); await shot(`${prefix}-juego`); }
        if (!(await tap('games-close', 'cerrar los juegos'))) await closeMenus();
        await page.waitForTimeout(300);
      } else await closeMenus();
      await call('config.save', { patch: { expert: { enabled: true } } }).catch(() => noteOnce('God mode: no se pudo activar'));
      // its entry lives under «Más» of the places, which only exists while the mode is on
      const shown = await page.locator('[data-testid=orb-places-more]').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
      if (shown && await tap('orb-places-more', '«Más» de los sitios') && await tap('nav-expert', 'God mode')) {
        await page.waitForTimeout(1500); await shot(`${prefix}-god-mode`);
        if (await tap('expert-panels', 'paneles del God mode')) { await shot(`${prefix}-god-mode-paneles`); await closeMenus(); }
        if (await tap('expert-more', '⋯ del God mode')) { await shot(`${prefix}-god-mode-menu`); await closeMenus(); }
      } else noteOnce('God mode: no aparece en la barra tras activarlo');
      await goChat();
      await call('config.save', { patch: { expert: { enabled: false } } }).catch(() => {});
    } catch (error) { noteOnce(`Agentes, tutoriales, juegos y God mode: el recorrido se cortó (${String(error?.message ?? error).split('\n')[0]})`); await closeMenus(); }
  };
  // ORB_EXPLORA_EXTRA=1: the biggest scrolling box of the open view (or of the dialog, or of `within`) goes to its top, middle
  // or end. null when nothing scrolls; otherwise { max, client } so a picture is only taken when there is more to see.
  const scrollView = async (where, within = null) => {
    try {
      const r = await page.evaluate(([w, sel]) => {
        const root = (sel && document.querySelector(sel)) || document.querySelector('[data-testid=settings-dialog]') || document.querySelector('main') || document.body;
        const boxes = [root, ...root.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 8 && e.clientHeight > 120 && e.clientWidth > 200 && !e.closest('nav'));
        boxes.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
        const box = boxes[0];
        if (!box) return null;
        const max = box.scrollHeight - box.clientHeight;
        box.scrollTop = w === 'end' ? max : w === 'middle' ? Math.round(max / 2) : 0;
        return { max, client: box.clientHeight };
      }, [where, within]);
      await page.waitForTimeout(300);
      return r;
    } catch { return null; }
  };
  // A picture of the view scrolled to `where`; skipped (with a note) when it is already whole in the first picture.
  const scrollShot = async (name, where, within = null) => {
    const r = await scrollView(where, within);
    if (!r) { noteOnce(`${name}: no hay nada que desplazar`); return false; }
    if (where === 'middle' && r.max < r.client * 0.6) { noteOnce(`${name}: la vista es corta, el medio no añade nada`); return false; }
    await shot(name);
    return true;
  };
  // The part of a section of Ajustes that its first picture does not reach, by the title of its block.
  const settingsBlock = async (title) => {
    const h = page.locator('[data-testid=settings-dialog] section h2', { hasText: title }).first();
    if (!(await h.count())) return false;
    await h.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    return true;
  };
  // The deep pictures of ORB_EXPLORA_EXTRA=1. Each block is on its own: one that fails is a note and the next one goes on.
  // prefix: «dia» / «noche».
  // Agentes checks the installed programs on arrival (a spinner and «Comprobando los programas instalados…»): the picture waits for it.
  const settleAgents = () => page.getByText(/Comprobando los programas instalados|Checking installed programs/).first().waitFor({ timeout: 1500 }).catch(() => {}).then(() => page.getByText(/Comprobando los programas instalados|Checking installed programs/).first().waitFor({ state: 'hidden', timeout: 30000 })).catch(() => noteOnce('Agentes: la comprobación de programas no terminó'));
  // What the chat gained: the trail of marks at rest and with its preview, a chat marked as unread (the same call as the
  // row's menu, undone afterwards) and the Ficha of an agent chat with its way to order a task.
  const chatExtraShots = async (prefix) => {
    if (!seeded) return;
    try {
      if (!(await openChat(CHATS[0].title))) return;
      await closePanel();
      const trail = page.locator('[data-testid=chat-trail]');
      if (await trail.count()) {
        await shot(`${prefix}-carril`);
        const marks = trail.locator('button');
        const n = await marks.count();
        if (n) {
          await marks.nth(Math.min(1, n - 1)).hover({ timeout: 3000 });
          await page.locator('[data-testid=chat-trail-card]').first().waitFor({ timeout: 3000 }).catch(() => noteOnce('carril: el globo no salió al pasar el ratón'));
          await page.waitForTimeout(300); await shot(`${prefix}-carril-globo`);
          await page.mouse.move(700, 400);
        } else noteOnce('carril: sin rayitas');
      } else noteOnce('carril: no está (¿menos de dos mensajes del usuario o sin margen?)');
      if (ids.contador) {
        await call('inbox.markUnread', { kind: 'session', id: ids.contador }).catch((e) => noteOnce(`no se pudo marcar como no leído: ${String(e?.message ?? e).split('\n')[0]}`));
        await goChat(); await page.waitForTimeout(700); await shot(`${prefix}-chat-no-leido`);
        await call('inbox.markRead', { kind: 'session', id: ids.contador }).catch(() => {});
      }
      if (await openChat(CHATS[0].title) && await openPanel('info')) {
        await page.locator('[data-testid=info-new-task]').first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => noteOnce('Ficha: sin «Encargar una tarea»'));
        await page.waitForTimeout(300); await shot(`${prefix}-ficha-tareas`);
        await closePanel();
      }
      // the chat with Orbe with files attached and a stopped turn, and the «+» of its box (nothing is picked: only the menu)
      if (ids.parada && await openChat(STOP_TITLE)) {
        await closePanel();
        await page.locator('[data-testid=stopped-card]').first().waitFor({ timeout: 5000 }).catch(() => noteOnce('Orbe: sin la tarjeta «Orb ha parado el turno»'));
        const center = (testid) => page.locator(`[data-testid=${testid}]`).first().evaluate((e) => e.scrollIntoView({ block: 'center' })).then(() => page.waitForTimeout(400));
        if (await page.locator('[data-testid=message-attachments]').count()) { await center('message-attachments'); await shot(`${prefix}-orbe-adjuntos`); } else noteOnce('Orbe: el mensaje no enseña sus adjuntos');
        await page.locator('[data-testid=stopped-undo]').first().waitFor({ timeout: 3000 }).catch(() => noteOnce('Orbe: la tarjeta de parada no ofrece «Deshacer esta tarea»'));
        await center('stopped-card').catch(() => {});
        await shot(`${prefix}-orbe-parada`);
        if (await tap('attach-menu', 'el «+» de la caja de Orbe')) { await shot(`${prefix}-orbe-adjuntar`); await closeMenus(); }
      } else if (EXTRA) noteOnce('Orbe: sin el chat con adjuntos y parada');
    } catch (error) { noteOnce(`capturas del chat: el recorrido se cortó (${String(error?.message ?? error).split('\n')[0]})`); await closeMenus(); }
  };
  const deepShots = async (prefix) => {
    if (!seeded) return;
    // Agentes: its two tabs, from the top to the end of the page
    try {
      if (await tap('nav-agents', 'Agentes')) {
        await tap('agents-tab-agents', 'pestaña «Agentes y cuentas»');
        await settleAgents();
        await page.waitForTimeout(500); await scrollView('top'); await shot(`${prefix}-agentes-cuentas`);
        await scrollShot(`${prefix}-agentes-medio`, 'middle');
        await scrollShot(`${prefix}-agentes-abajo`, 'end');
        // the card's «⋯» (turning the agent on or off lives there; never pressed)
        await scrollView('top');
        if (await page.locator('[data-testid^=agent-more-]').first().click({ timeout: 3000 }).then(() => true, () => false)) { await page.waitForTimeout(300); await shot(`${prefix}-agentes-menu`); await closeMenus(); }
        else noteOnce('Agentes: sin «⋯» en la tarjeta de un agente');
        // the «⋯» of one account (sign-out lives there; never pressed)
        if (await page.locator('[data-testid^=agent-account-more-]').first().click({ timeout: 3000 }).then(() => true, () => false)) { await page.waitForTimeout(300); await shot(`${prefix}-agentes-cuenta-menu`); await closeMenus(); }
        else noteOnce('Agentes: sin «⋯» en la fila de una cuenta');
        if (await tap('agents-tab-usage', 'pestaña «Uso»')) {
          await page.waitForTimeout(800); await scrollView('top'); await shot(`${prefix}-uso`);
          await scrollShot(`${prefix}-uso-medio`, 'middle');
          await scrollShot(`${prefix}-uso-abajo`, 'end');
          // «Más opciones» at the end of the page, unfolded (the table of tokens per day), then folded again
          if (await tap('usage-table-toggle', 'la tabla de tokens por día, en «Más opciones» de Uso')) { await scrollShot(`${prefix}-uso-mas-opciones`, 'end'); await tap('usage-table-toggle', 'plegar la tabla de tokens por día'); }
          // the period «Hoy» (the default is 30 days, put back afterwards)
          if (await tap('usage-range-1', 'periodo «Hoy» del uso')) { await page.waitForTimeout(600); await scrollView('top'); await shot(`${prefix}-uso-hoy`); await tap('usage-range-30', 'periodo de 30 días del uso'); }
          await tap('agents-tab-agents', 'pestaña «Agentes y cuentas»');
        }
      }
    } catch (error) { noteOnce(`Agentes y Uso: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await closeMenus(); }
    // Tutoriales
    try {
      if (await tap('nav-tutorials', 'Tutoriales')) { await page.waitForTimeout(500); await scrollView('top'); await shot(`${prefix}-tutoriales`); await scrollShot(`${prefix}-tutoriales-abajo`, 'end'); }
    } catch (error) { noteOnce(`Tutoriales: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); }
    // Ajustes: the rest of the long sections (only scrolling and tabs; nothing is changed)
    try {
      if (await tap('nav-settings', 'Ajustes')) {
        await page.locator('[data-testid=settings-dialog]').waitFor({ timeout: 8000 }).catch(() => noteOnce('Ajustes: no se abrió'));
        const section = async (id) => { const ok = await tap(`settings-nav-${id}`, `sección «${id}» de Ajustes`); if (ok) { await page.waitForTimeout(400); await scrollView('top'); } return ok; };
        if (await section('general')) {
          if (await settingsBlock(/^(Interfaz|Interface)$/)) await shot(`${prefix}-ajustes-general-interfaz`); else noteOnce('Ajustes: sin el bloque «Interfaz»');
          if (await settingsBlock(/^(Respuestas de los agentes|Agents.? replies)$/)) await shot(`${prefix}-ajustes-general-respuestas`); else noteOnce('Ajustes: sin el bloque «Respuestas de los agentes»');
          await scrollShot(`${prefix}-ajustes-general-actualizaciones`, 'end');
        }
        if (await section('agentes')) {
          await scrollShot(`${prefix}-ajustes-agentes-abajo`, 'end');
          // «Más opciones» of the spending card, unfolded (a fold of the page, nothing is saved)
          if (await page.locator('[data-testid=spend-advanced]').count() && await tap('spend-advanced', '«Más opciones» de Ajustes › Agentes')) { await scrollShot(`${prefix}-ajustes-agentes-mas`, 'end'); await tap('spend-advanced', 'plegar «Más opciones»'); }
          if (await tap('agents-tab-uso', 'pestaña «Uso» de Agentes y uso')) {
            await page.waitForTimeout(600); await scrollView('top'); await shot(`${prefix}-ajustes-agentes-uso`);
            await scrollShot(`${prefix}-ajustes-agentes-uso-abajo`, 'end');
            await tap('agents-tab-tareas', 'volver a la pestaña «Tareas»');
          }
        }
        for (const [id, name] of [['permisos', 'permisos'], ['datos', 'datos'], ['avanzado', 'avanzado']]) {
          if (await section(id)) { await shot(`${prefix}-ajustes-${name}`); await scrollShot(`${prefix}-ajustes-${name}-abajo`, 'end'); }
        }
        await closeSettings(page, `${prefix}/ajustes (extra)`);
      }
    } catch (error) { noteOnce(`Ajustes (extra): el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await closeMenus(); }
    // Normas: the Orb tab to its end and the one of the side agents
    try {
      if (await tap('nav-memories', 'Bitácoras y normas') && await tap('memories-rules', 'pestaña «Normas»')) {
        await page.waitForTimeout(500);
        await tap('rules-side-orb', 'Normas › Orb');
        await scrollView('top'); await scrollShot(`${prefix}-normas-abajo`, 'end');
        if (await tap('rules-side-agents', 'Normas › subagentes')) { await scrollView('top'); await page.waitForTimeout(300); await shot(`${prefix}-normas-subagentes`); }
        await tap('rules-side-orb', 'Normas › Orb');
        // the dialogs of Normas: a new rule's editor, an existing one and a rail's «Antes / Después» with its password field.
        // Opened and cancelled: nothing is typed, saved, paused or unlocked.
        const cancelRule = async (what) => {
          const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Cancelar|Cancel)$/ }).first();
          if (!(await cancel.click({ timeout: 3000 }).then(() => true, () => false))) { noteOnce(`Normas: sin «Cancelar» en ${what}`); await closeMenus(); }
          await page.waitForTimeout(300);
        };
        await scrollView('top');
        if (await tap('rules-new', '«Nueva norma»')) { await page.waitForTimeout(400); await shot(`${prefix}-norma-nueva`); await cancelRule('la norma nueva'); }
        if (await page.locator('[data-testid^=rule-edit-]').first().click({ timeout: 3000 }).then(() => true, () => false)) { await page.waitForTimeout(500); await shot(`${prefix}-norma-editar`); await cancelRule('editar la norma'); }
        else noteOnce('Normas: sin «Editar» en ninguna norma');
        if (await page.locator('[data-testid^=rail-more-]').first().click({ timeout: 3000 }).then(() => true, () => false)) {
          await page.waitForTimeout(300);
          if (await page.locator('[data-testid^=rail-switch-]').first().click({ timeout: 3000 }).then(() => true, () => false)) { await page.waitForTimeout(500); await shot(`${prefix}-rail-pausar`); await cancelRule('pausar un raíl'); }
          else await closeMenus();
        } else noteOnce('Normas: sin «⋯» en ningún raíl');
        await tap('memories-logs', 'volver a la pestaña «Bitácoras»');
        // the header's «⋯» of the logbooks (copy and read it whole live there)
        if (await tap('logbooks-more', '«⋯» de la cabecera de Bitácoras')) { await shot(`${prefix}-bitacoras-menu`); await closeMenus(); }
      }
    } catch (error) { noteOnce(`Normas: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await closeMenus(); }
    // Games: the list, the snake in the middle of a game and the 2048 after two moves
    try {
      await goChat();
      if (await tap('orb-chat-more', '⋯ del chat con Orbe') && await tap('bar-games', '«Minijuegos» del menú')) {
        await page.locator('[data-testid=games-dialog]').waitFor({ timeout: 6000 }).catch(() => noteOnce('Juegos: el diálogo no se abrió'));
        await page.waitForTimeout(500); await shot(`${prefix}-juegos`);
        if (await tap('game-snake', 'el juego de la serpiente')) {
          // a key starts it if it waits for one; the picture is taken at once (the snake still has room) and not after shot()'s own pause
          await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350);
          await page.screenshot({ path: path.join(OUT, `${prefix}-juego-partida.png`) });
        }
        const back = page.locator('[data-testid=games-dialog]').getByRole('button', { name: /^(Volver a los juegos|Back to the games)$/ });
        if (await back.count()) { await back.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); }
        else noteOnce('Juegos: sin botón para volver a la lista');
        if (await tap('game-g2048', 'el juego 2048')) {
          await page.waitForTimeout(500);
          await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(350);
          await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350);
          await shot(`${prefix}-juego-2048`);
        }
        if (!(await tap('games-close', 'cerrar los juegos'))) await closeMenus();
        await page.waitForTimeout(300);
      } else await closeMenus();
    } catch (error) { noteOnce(`Juegos: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await closeMenus(); }
    // God mode with a project that has a repository and changes (orb-dev); the active project and the panels are put back
    const state = await call('app.state').catch(() => null);
    const wasActive = state?.activeProject?.name ?? '';
    const wasPanels = state?.config?.expert?.panels ?? {};
    const panelIds = ['explorer', 'git', 'history', 'running', 'usage', 'system', 'activity'];
    try {
      await call('projects.setActive', { name: 'orb-dev' }).catch(() => noteOnce('God mode: no se pudo elegir el proyecto «orb-dev»'));
      const patch = { enabled: true };
      // every panel on, whatever the profile had
      if (panelIds.some((id) => wasPanels[id] === false)) patch.panels = Object.fromEntries(panelIds.map((id) => [id, id === 'history' ? wasPanels.history === true : true])); // the history panel is opt-in: it stays as the user had it
      await call('config.save', { patch: { expert: patch } }).catch(() => noteOnce('God mode: no se pudo activar'));
      const shown = await page.locator('[data-testid=orb-places-more]').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
      if (shown && await tap('orb-places-more', '«Más» de los sitios') && await tap('nav-expert', 'God mode')) {
        await page.locator('[data-testid=expert-tree]').first().waitFor({ timeout: 8000 }).catch(() => noteOnce('God mode: el árbol de archivos no aparece'));
        await page.waitForTimeout(1200);
        const bar = await page.locator('[data-testid=expert-bar]').first().innerText({ timeout: 2000 }).catch(() => '');
        if (!/orb-dev/.test(bar)) noteOnce('God mode: no se abrió con el proyecto «orb-dev»');
        await shot(`${prefix}-god-mode`);
        // a folder and a file of the tree, then its changes
        const entry = (name) => page.locator('[data-testid=expert-tree] button', { has: page.locator('span.truncate', { hasText: name }) }).first();
        try {
          await entry(/^src$/).click({ timeout: 3000 }); await page.waitForTimeout(500);
          await entry(/^context-meter\.js$/).click({ timeout: 3000 }); await page.waitForTimeout(900);
          await shot(`${prefix}-god-mode-archivo`);
          // the Git panel: the save menu, the new-branch form and the branches of the bar. Opened and closed: nothing is
          // saved, pushed, pulled, switched or undone.
          for (const [id, name, what] of [['expert-git-savemore', 'guardar-menu', 'el menú de «Guardar cambios»'], ['expert-git-cleanmore', 'guardar-menu', '«Más formas de guardar»'], ['expert-git-newbranch', 'rama-nueva', '«Nueva rama»'], ['expert-branch', 'ramas', 'el menú de ramas de la barra'], ['expert-git-more', 'git-menu', 'el «⋯» del panel Git']]) {
            if (!(await page.locator(`[data-testid=${id}]`).count())) continue;
            if (await tap(id, what)) {
              // the branches load when the menu opens: the picture waits for the list, and opens it again if it closed by itself
              if (id === 'expert-branch') {
                const menu = page.locator('[data-testid=expert-branch-menu]');
                if (!(await menu.isVisible().catch(() => false))) await tap(id, what);
                await menu.waitFor({ timeout: 3000 }).catch(() => noteOnce('God mode: el menú de ramas no se abre'));
                await page.waitForTimeout(500);
              }
              await page.waitForTimeout(300); await shot(`${prefix}-god-mode-${name}`); await closeMenus(); await closeMenus();
            }
          }
          // the file's «⋯» and «Nuevo archivo»: opened and closed, nothing is created
          if (await tap('expert-file-more', 'el «⋯» del archivo abierto en el God mode')) { await shot(`${prefix}-god-mode-archivo-menu`); await closeMenus(); }
          if (await tap('expert-new-file', '«Nuevo archivo» del God mode')) {
            await page.locator('[data-testid=expert-new-file-name]').first().waitFor({ timeout: 3000 }).catch(() => noteOnce('God mode: «Nuevo archivo» no abre su diálogo'));
            await shot(`${prefix}-god-mode-nuevo-archivo`);
            const cancel = page.getByRole('dialog').getByRole('button', { name: /^(Cancelar|Cancel)$/ }).first();
            if (!(await cancel.click({ timeout: 3000 }).then(() => true, () => false))) await closeMenus();
            await page.waitForTimeout(300);
          }
          if (await tap('expert-view-changes', '«Ver cambios» del archivo')) { await page.waitForTimeout(900); await shot(`${prefix}-god-mode-diff`); }
        } catch { noteOnce('God mode: no se pudo abrir una carpeta y un archivo del árbol'); }
        if (!(await page.locator('[data-testid=expert-view-changes]').count())) {
          // the file tab is gone (the diff replaced it): the list of Git's changes gives a diff too
          const change = page.locator('[data-testid=expert-git] button').first();
          if (await change.count()) { await change.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(800); }
        }
        if (await tap('expert-panels', 'paneles del God mode')) { await shot(`${prefix}-god-mode-paneles`); await closeMenus(); }
        await page.waitForTimeout(300); await shot(`${prefix}-god-mode-paneles-todos`);
        await scrollShot(`${prefix}-god-mode-abajo`, 'end', '[data-testid=expert-view] aside');
        if (await tap('expert-more', '⋯ del God mode')) { await shot(`${prefix}-god-mode-menu`); await closeMenus(); }
      } else noteOnce('God mode: no aparece en la barra tras activarlo');
      await goChat();
    } catch (error) { noteOnce(`God mode: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await closeMenus(); await goChat().catch(() => {}); }
    await call('config.save', { patch: { expert: { enabled: false, ...(panelIds.some((id) => wasPanels[id] === false) ? { panels: Object.fromEntries(panelIds.map((id) => [id, id === 'history' ? wasPanels.history === true : wasPanels[id] !== false])) } : {}) } } }).catch(() => {});
    await call('projects.setActive', { name: wasActive }).catch(() => {});
  };
  // The two popups of the sidebar's foot: the music player (never pressed «play» unless ORB_EXPLORA_SOUND=1) and the feedback
  // form (a sample text is typed and wiped; «Enviar» is never pressed). `name` is the picture's prefix, `full` adds the
  // states (playing, manual, written) that only one theme needs.
  const SOUND = process.env.ORB_EXPLORA_SOUND === '1';
  const popClosed = async (testid) => { await page.keyboard.press('Escape'); await page.locator(`[data-testid=${testid}]`).waitFor({ state: 'detached', timeout: 3000 }).catch(() => noteOnce(`${testid}: Escape no lo cerró`)); await page.waitForTimeout(250); };
  const footShots = async (name, full = true) => {
    try {
      if (await tap('nav-music', 'los auriculares (reproductor)') && await page.locator('[data-testid=music-pop]').waitFor({ timeout: 3000 }).then(() => true, () => false)) {
        await shot(`${name}-reproductor`);
        if (full && SOUND && await tap('music-pop-play', 'reproducir')) {
          await page.waitForTimeout(1500); await shot(`${name}-reproductor-sonando`);
          await tap('music-pop-play', 'pausar');
          await page.waitForTimeout(600);
          const still = await page.locator('[data-testid=nav-music]').getAttribute('aria-pressed').catch(() => null);
          if (still === 'true') noteOnce('reproductor: tras pulsar de nuevo sigue sonando');
        }
        if (full && await tap('music-pop-manual', '«Manual»')) { await shot(`${name}-reproductor-manual`); await tap('music-pop-manual', 'volver a «Manual»'); }
        await popClosed('music-pop');
      } else { noteOnce('el reproductor no abrió su ventanita'); await closeMenus(); }
      if (await tap('nav-feedback', 'comentarios') && await page.locator('[data-testid=feedback-pop]').waitFor({ timeout: 3000 }).then(() => true, () => false)) {
        await shot(`${name}-comentarios`);
        if (full) {
          const box = page.locator('[data-testid=feedback-pop-message]').first();
          if (await box.count()) {
            await box.fill('Ejemplo: el botón de guardar no responde.'); await shot(`${name}-comentarios-escrito`);
            await box.fill('');
          } else noteOnce('comentarios: sin caja de texto');
        }
        await popClosed('feedback-pop');
      } else { noteOnce('comentarios no abrió su ventanita'); await closeMenus(); }
    } catch (error) { noteOnce(`pie de la barra lateral: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await closeMenus(); }
  };
  // The Orb theme's companion robot (Tareas shows it): at rest, dragged with the real pointer, put back with a right click, and
  // the window's answer with the pointer over the mark.
  const companionShots = async (prefix) => {
    try {
      const where = () => page.evaluate(() => { const e = document.querySelector('[data-testid=companion]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
      const view = () => page.evaluate(() => `${location.href} · robot=${Boolean(document.querySelector('[data-testid=companion]'))} · chat=${Boolean(document.querySelector('[data-testid=chat-greeting]'))}`);
      if (!(await page.locator('[data-testid=companion]').first().waitFor({ timeout: 4000 }).then(() => true, () => false))) { noteOnce('robot compañero: no se ve en Tareas (¿ajuste «compañero» apagado?)'); return; }
      await shot(`${prefix}-companero`);
      const before = await where(); const viewBefore = await view();
      const cx = before.x + before.w / 2; const cy = before.y + before.h / 2;
      await page.mouse.move(cx, cy, { steps: 4 }); await page.mouse.down();
      await page.mouse.move(cx - 300, cy - 150, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const after = await where(); const viewAfter = await view();
      await shot(`${prefix}-companero-movido`);
      note(`robot compañero ${prefix}: antes ${JSON.stringify(before)} · después ${JSON.stringify(after)}${after && after.x !== before.x ? '' : ' · NO SE MOVIÓ'}`);
      if (viewAfter !== viewBefore) note(`robot compañero ${prefix}: el arrastre navegó (${viewBefore} → ${viewAfter})`);
      if (after) {
        await page.mouse.click(after.x + after.w / 2, after.y + after.h / 2, { button: 'right' }); await page.waitForTimeout(400);
        const back = await where();
        note(`robot compañero ${prefix}: clic derecho → ${JSON.stringify(back)} · ${back && Math.abs(back.x - before.x) <= 2 && Math.abs(back.y - before.y) <= 2 ? 'volvió a su sitio' : 'NO VOLVIÓ a su sitio'}`);
      }
      // the pointer resting over the mark: the window must keep answering
      const home = await page.locator('[data-testid=sidebar-home]').first().boundingBox().catch(() => null);
      if (home) {
        await page.mouse.move(home.x + home.width / 2, home.y + home.height / 2, { steps: 4 }); await page.waitForTimeout(1500);
        const t0 = Date.now();
        const ok = await Promise.race([page.evaluate(() => 1).then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 8000))]);
        const ms = Date.now() - t0;
        note(`respuesta con el puntero sobre la marca ${prefix}: ${ok ? `${ms} ms${ms > 1000 ? ' · LENTO' : ''}` : 'SIN RESPUESTA en 8 s · LENTO'}`);
        await page.mouse.move(700, 500, { steps: 3 });
      } else noteOnce('respuesta con el puntero sobre la marca: sin [data-testid=sidebar-home]');
    } catch (error) { noteOnce(`robot compañero: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); await page.mouse.up().catch(() => {}); await closeMenus(); }
  };
  // The lock screen, at the end of a mode's tour: «Bloquear ahora», a wrong password, then the test password of this profile.
  // Throws when the app does not come back: nothing after it could be shot.
  const lockShots = async (prefix) => {
    await goChat().catch(() => {});
    let locked = false;
    try {
      if (await tap('nav-settings', 'Ajustes') && await tap('settings-nav-datos', 'sección «Datos» de Ajustes') && await tap('master-lock-now', '«Bloquear ahora»')) locked = true;
    } catch { /* the call below locks it */ }
    if (!locked) { noteOnce('bloqueo: sin botón «Bloquear ahora»; se bloquea con master.lock'); await call('master.lock').catch((error) => noteOnce(`bloqueo: master.lock falló (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`)); }
    const screen = page.locator('[data-testid=master-locked]');
    if (!(await screen.waitFor({ timeout: 8000 }).then(() => true, () => false))) { noteOnce('bloqueo: no salió la pantalla de bloqueo'); await closeMenus(); return; }
    await shot(`${prefix}-bloqueo`);
    try {
      await page.fill('[data-testid=master-password]', 'no-es-esta');
      await page.press('[data-testid=master-password]', 'Enter');
      await page.locator('[data-testid=master-error]').waitFor({ timeout: 8000 });
      await shot(`${prefix}-bloqueo-error`);
    } catch { noteOnce('bloqueo: con una contraseña equivocada no salió el error'); }
    await page.fill('[data-testid=master-password]', TEST_MASTER);
    await page.press('[data-testid=master-password]', 'Enter');
    const back = await page.locator('[data-testid=sidebar-home]').waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (!back || await screen.count()) { note('bloqueo: no volvió la app al desbloquear'); throw new Error('bloqueo: el desbloqueo falló; se termina el recorrido'); }
    // Ajustes was left open behind the lock screen
    if (await page.locator('[data-testid=settings-dialog]').count()) await closeSettings(page, `${prefix}/bloqueo`);
  };
  const dark =() => page.evaluate(() => document.documentElement.classList.contains('dark'));
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
  // ORB_EXPLORA_MODES=dia (or noche) tours the views in one mode only: both no longer fit in one run of ten minutes.
  const VIEW_MODES = ['dia', 'noche'].filter((m) => !process.env.ORB_EXPLORA_MODES || process.env.ORB_EXPLORA_MODES.split(',').includes(m));
  if (!process.env.ORB_EXPLORA_ONLY_THEMES) for (const theme of VIEW_MODES) {
    await setDark(theme === 'noche');
    for (const [nav, name] of views) {
      await keepBusy();
      if (nav === 'sidebar-home') await goChat(); else await page.click(`[data-testid=${nav}]`);
      if (name === 'agentes') await settleAgents();
      await shot(`${theme}-${name}`);
      if (theme === 'dia') {
        const wide = await overflow(page);
        if (wide.length) note(`${name}: contenido más ancho que su caja → ${wide.join(' | ')}`);
      }
      if (name === 'bitacoras' && seeded) {
        // the logbook of a project with real entries, then the rules tabs (only looked at: no rule is edited, restored or deleted)
        try {
          const row = page.locator('main [role=navigation] button', { hasText: 'tienda-web' }).first();
          if (await row.count()) { await row.click({ timeout: 3000 }); await page.waitForTimeout(500); await shot(`${theme}-bitacoras-proyecto`); } else noteOnce('Bitácoras: sin fila «tienda-web»');
          if (await tap('memories-rules', 'pestaña «Normas»')) {
            await page.waitForTimeout(500); await shot(`${theme}-normas`);
            if (await page.locator('[data-testid=rules-side-agents]').count()) { await tap('rules-side-agents', 'Normas › subagentes'); await page.waitForTimeout(400); await shot(`${theme}-normas-subagentes`); await tap('rules-side-orb', 'Normas › Orb'); }
            await tap('memories-logs', 'volver a la pestaña «Bitácoras»');
          }
        } catch (error) { noteOnce(`Bitácoras: capturas extra: ${error.message.slice(0, 120)}`); }
      }
      if (name === 'ajustes') {
        // each section of the settings window
        for (const id of SECTIONS) {
          await page.click(`[data-testid=settings-nav-${id}]`);
          await shot(`${theme}-ajustes-${id}`);
          // the parts of a long section that the first picture does not reach; only scrolling and tabs, nothing is changed
          try {
            if (id === 'general') {
              const skin = page.locator('[data-testid=skin-picker]').first();
              if (await skin.count()) { await skin.evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300); await shot(`${theme}-ajustes-apariencia`); } else noteOnce('Ajustes: sin [data-testid=skin-picker]');
              const robot = page.locator('section', { has: page.locator('h2', { hasText: /Robot/i }) }).last();
              if (await robot.count()) { await robot.evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300); await shot(`${theme}-ajustes-robot`); } else noteOnce('Ajustes: sin el bloque «Robot y sonidos»');
            }
            if (id === 'agentes') {
              if (await tap('agents-tab-uso', 'pestaña «Uso» de Agentes y uso')) { await page.waitForTimeout(600); await shot(`${theme}-ajustes-agentes-uso`); await tap('agents-tab-tareas', 'volver a la pestaña «Tareas»'); }
            }
          } catch (error) { noteOnce(`Ajustes/${id}: capturas extra: ${error.message.slice(0, 120)}`); }
          if (theme === 'dia') {
            const wide = await overflow(page);
            if (wide.length) note(`ajustes/${id}: contenido más ancho que su caja → ${wide.join(' | ')}`);
          }
        }
        await closeSettings(page, `${theme}/ajustes`);
      }
    }
    if (EXTRA) {
      // the extra pass: deepShots takes the place of the chat pictures, the boards and the places, then the lock screen
      await chatExtraShots(theme);
      await taskExtraShots(theme);
      await deepShots(theme);
      await footShots(theme);
      await lockShots(theme);
      continue;
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
    await taskShots(theme);
    // Programadas lives in the sidebar's places: seeded with two schedules (a view the loop above does not list)
    if (seeded && await tap('nav-schedules', 'Programadas')) await shot(`${theme}-programadas`);
    await projectShots(theme);
    await extraShots(theme);
  }
  // checks and switches in the night theme: their computed colors
  await page.click('[data-testid=nav-settings]');
  // Ajustes is loaded on demand: without this wait, Escape arrives before the dialog and it then stays open over the tour
  await page.locator('[data-testid=settings-dialog]').waitFor({ timeout: 8000 }).catch(() => note('controles: Ajustes no se abrió'));
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
  if (process.env.ORB_EXPLORA_ONLY_THEMES) {
    for (let i = 0; i < 4 && await page.locator('[data-slot=dialog-overlay]').count(); i++) {
      if (i === 0) note(`diálogo abierto tras la siembra: «${(await page.locator('[role=dialog] h2').first().textContent({ timeout: 1000 }).catch(() => '')) || 'sin título'}»`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    }
  }
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
      if (await tapOrNote('[data-testid=nav-tasks]')) {
        await shot(`tema-${skin}-${theme}-tareas`);
        if (skin === 'orb') await companionShots(`tema-${skin}-${theme}`);
      }
      // the sidebar's foot popups in every theme (the player's play button is never pressed here)
      if (EXTRA) await footShots(`tema-${skin}-${theme}`, false);
      // the trail of marks and its preview over a theme with a backdrop
      if (EXTRA && seeded && (skin === 'vaporwave' || skin === 'cristal') && await openChat(CHATS[0].title)) {
        await closePanel();
        const mark = page.locator('[data-testid=chat-trail] button').nth(1);
        if (await mark.count()) {
          await mark.hover({ timeout: 3000 }).catch(() => noteOnce(`carril en ${skin}: no se pudo pasar el ratón`));
          await page.locator('[data-testid=chat-trail-card]').first().waitFor({ timeout: 3000 }).catch(() => noteOnce(`carril en ${skin}: el globo no salió`));
          await page.waitForTimeout(300); await shot(`tema-${skin}-${theme}-carril-globo`);
          await page.mouse.move(700, 400);
        } else noteOnce(`carril en ${skin}: sin rayitas`);
      }
      // the lock screen over the Orb and Vaporwave themes (the others are pictured at the end of each view mode)
      if (EXTRA && (skin === 'orb' || skin === 'vaporwave')) {
        try { await lockShots(`tema-${skin}-${theme}`); } catch (error) { note(`bloqueo en ${skin}/${theme}: ${String(error?.message ?? error).split(String.fromCharCode(10))[0]}`); throw error; }
      }
      // ORB_EXPLORA_EXTRA=1: Agentes and Uso in every theme too
      if (EXTRA && await tapOrNote('[data-testid=nav-agents]')) {
        await page.waitForTimeout(500); await shot(`tema-${skin}-${theme}-agentes`);
        if (await tapOrNote('[data-testid=agents-tab-usage]')) { await page.waitForTimeout(600); await shot(`tema-${skin}-${theme}-uso`); await tapOrNote('[data-testid=agents-tab-agents]'); }
      }
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
      // a side panel slides in when its view opens: measured while it moves, it would count as sticking out
      await page.waitForTimeout(500);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw > iw + 1) {
        // the widest elements that stick out past the window's right edge
        const out = await page.evaluate((w) => [...document.querySelectorAll('body *')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > w + 1).sort((a, b) => b.r.right - a.r.right).slice(0, 3).map((x) => `${x.e.tagName.toLowerCase()}[${x.e.getAttribute('data-testid') ?? ''}].${String(x.e.className).slice(0, 80)} right=${Math.round(x.r.right)} w=${Math.round(x.r.width)}`), iw);
        // and where the room goes: the boxes from the one that sticks out the most up to the page, each with its left edge and width
        const chain = await page.evaluate((w) => {
          const worst = [...document.querySelectorAll('body *')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > w + 1 && x.r.left < w).sort((a, b) => b.r.width - a.r.width)[0]?.e;
          const rows = [];
          for (let e = worst; e && e !== document.body; e = e.parentElement) {
            const r = e.getBoundingClientRect();
            const sibs = e.parentElement ? [...e.parentElement.children].filter((s) => s !== e && s.getBoundingClientRect().width > 0).map((s) => `${s.tagName.toLowerCase()}:${Math.round(s.getBoundingClientRect().width)}/min${Math.round(parseFloat(getComputedStyle(s).minWidth) || 0)}`).join(',') : '';
            rows.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 4).join('.')}@${Math.round(r.left)}+${Math.round(r.width)}[${sibs}]`);
          }
          return rows.slice(0, 8).join(' < ');
        }, iw);
        note(`${name}/${view}: se sale por los lados (${sw} > ${iw}) → ${out.join(' | ')}`);
        note(`${name}/${view}: cadena → ${chain}`);
      }
      await shot(`${name}-${view}`);
      if (view === 'ajustes') {
        for (const id of ['general', 'agentes', 'acerca']) { await page.click(`[data-testid=settings-nav-${id}]`); await shot(`${name}-ajustes-${id}`); }
        await closeSettings(page, `${name}/ajustes`);
      }
    }
  }
  // the narrow window in the dark too: the theme is switched at full width with its own button (out of reach in a narrow
  // window), then the window is narrowed again
  try {
    await page.setViewportSize({ width: 1440, height: 880 }); await page.waitForTimeout(400);
    await setDark(true);
    await page.setViewportSize({ width: 420, height: 860 }); await page.waitForTimeout(400);
    for (const [nav, view] of [['sidebar-home', 'chat'], ['nav-tasks', 'tareas'], ['nav-settings', 'ajustes']]) {
      await page.getByRole('button', { name: /^(Menú|Menu)$/ }).click({ timeout: 5000 }); await page.locator(`[data-testid=${nav}]:visible`).click({ timeout: 5000 });
      await page.waitForTimeout(500);
      await shot(`estrecha-${view}-noche`);
      if (view === 'ajustes') {
        for (const id of ['general', 'agentes', 'acerca']) { await page.click(`[data-testid=settings-nav-${id}]`, { timeout: 5000 }); await shot(`estrecha-ajustes-${id}-noche`); }
        await closeSettings(page, 'estrecha/ajustes (noche)');
      }
    }
  } catch (error) { note(`estrecha en oscuro: el recorrido se cortó (${String(error?.message ?? error).split('\n')[0]})`); }
  await page.setViewportSize({ width: 1440, height: 880 }).catch(() => {});
  await setDark(false).catch(() => {});
  // ---- 5. the agents' browser's live window (ORB_EXPLORA_PIP=1): a second window (pip.html) Orb opens when an agent uses its
  // browser. A fake agent opens a local page (127.0.0.1: no network); the window's own page is what gets pictured.
  if (PIP) {
    let site = null;
    try {
      if (!seeded) throw new Error('hacen falta los agentes falsos (ORB_EXPLORA_SEED no puede ser 0)');
      site = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Tienda de ejemplo</title><body style="font:20px sans-serif;background:#eef;margin:32px"><h1>Tienda de ejemplo</h1><p>Una página local para la ventana en vivo.</p><input placeholder="Tu correo" style="font:inherit;padding:6px"> <button style="font:inherit;padding:6px 14px">Suscribirme</button></body>');
      });
      await new Promise((r) => site.listen(0, '127.0.0.1', r));
      opened.push(() => new Promise((r) => site.close(() => r())));
      const url = `http://127.0.0.1:${site.address().port}/`;
      // open, take a picture (the window gets frames), then stay busy so the window stays up while it is pictured
      fs.writeFileSync(PIP_SCRIPT, JSON.stringify([['orb_browser_open', { url }], ['orb_browser_screenshot', {}], ['sleep', { ms: 60000 }]]));
      const chat = await call('sessions.create', { agent: 'claude', project: 'tienda-web', permission: 'editar', title: 'Navegador de ejemplo' });
      await call('sessions.send', { id: chat.id, text: PIP_TURN.text });
      const findPip = () => page.context().browser()?.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('pip.html'));
      const pip = await until(findPip, 'la ventana en vivo (pip.html)', 40000).catch(() => null);
      if (!pip) note('VENTANA EN VIVO: no se abrió pip.html con la ventana principal oculta (ORB_HIDDEN_WINDOW=1). Haría falta una ejecución con la ventana visible o ver qué pide src-tauri/src/pip.rs en modo oculto');
      else {
        const pipShot = async (name) => { await pip.waitForTimeout(500); await pip.screenshot({ path: path.join(OUT, `${name}.png`) }); };
        const press = async (name, what) => { try { await pip.getByRole('button', { name }).first().click({ timeout: 4000 }); await pip.waitForTimeout(700); return true; } catch { noteOnce(`ventana en vivo: sin botón «${what}»`); return false; } };
        if (!(await pip.locator('[data-testid=pip] img').first().waitFor({ timeout: 20000 }).then(() => true, () => false))) noteOnce('ventana en vivo: no llegó ninguna imagen de la página (se capta lo que haya)');
        await pipShot('vivo-normal');
        if (await press(/Más grande|Larger/, 'Más grande')) { await pipShot('vivo-grande'); await press(/Más pequeña|Smaller/, 'Más pequeña'); }
        if (await press(/Contraer|Collapse/, 'Contraer')) { await pipShot('vivo-pildora'); await press(/Mostrar|Show/, 'Mostrar'); }
        note('ventana en vivo: siempre oscura (body.dark), no sigue el modo de la app: una sola serie de capturas');
        await press(/Cerrar hasta|Close until/, 'Cerrar hasta la próxima vez');
      }
      await call('sessions.stop', { id: chat.id }).catch(() => {});
    } catch (error) { note(`VENTANA EN VIVO: el recorrido se cortó (${String(error?.message ?? error).split(String.fromCharCode(10))[0]})`); } finally {
      await new Promise((r) => { if (!site) return r(); site.closeAllConnections?.(); site.close(() => r()); });
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
  await finish();
}
