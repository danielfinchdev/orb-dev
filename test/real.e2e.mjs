// The app with the REAL agents installed on this PC (uses the user's own accounts, small tasks on cheap models):
// a direct conversation with each agent, the assistant creating a task, the report and undo. Screenshots and a log in
// test-results/real/.   node test/real.e2e.mjs [claude,codex,cursor]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results', 'real'); fs.mkdirSync(OUT, { recursive: true });
const AGENTS = (process.argv[2] ?? 'claude,codex,cursor').split(',');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-real-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { assistantName: 'Orb', userName: 'Dani' });
const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const log = [];
const note = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; log.push(line); console.log(line); };

const app = await electron.launch({ executablePath: (await import('electron')).default, args: [ROOT], env: { ...process.env, ORB_USER_DATA: userData } });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
const shot = async (name) => {
  await page.waitForTimeout(500);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html')).webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, 'base64'));
};
const until = async (fn, what, ms = 180000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await page.waitForTimeout(1000); } throw new Error(`no llegó: ${what}`); };

try {
  await page.waitForSelector('text=Soy Orb', { timeout: 30000 });
  if (await page.isVisible('text=Preparo tu equipo')) await page.click('text=Continuar');
  note(`agentes: ${JSON.stringify((await call('agents.status', { refresh: true })).map((a) => ({ id: a.id, installed: a.installed, login: a.login, models: a.models })))}`);
  const project = await call('projects.create', { name: 'prueba-real' });
  note(`proyecto: ${JSON.stringify(project).slice(0, 200)}`);
  await call('projects.setActive', { name: 'prueba-real' }).catch((e) => note(`setActive: ${e.message}`));

  // ---- 1. direct conversation with each agent (two turns: the second must continue the first)
  for (const agent of AGENTS) {
    const t0 = Date.now();
    try {
      const s = await call('sessions.create', { agent, project: 'prueba-real', permission: 'editar', title: `Prueba ${agent}` });
      await call('sessions.send', { id: s.id, text: `Crea el archivo ${agent}.txt con el texto "hola desde ${agent}" y responde solo "listo". No hagas nada más.` });
      await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status !== 'running' && Date.now() - t0 > 3000, `${agent} turno 1`);
      const t1 = Date.now();
      await call('sessions.send', { id: s.id, text: '¿Qué archivo acabas de crear? Responde solo con su nombre.' });
      await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status !== 'running' && Date.now() - t1 > 3000, `${agent} turno 2`);
      const items = await call('sessions.items', { id: s.id });
      const said = items.filter((i) => i.role === 'assistant' && i.kind === 'text').map((i) => String(i.body).slice(0, 80));
      const errs = items.filter((i) => i.role === 'error').map((i) => String(i.body).slice(0, 300));
      const file = path.join(home, 'prueba-real', `${agent}.txt`);
      note(`${agent}: turno1 ${Math.round((t1 - t0) / 1000)} s, turno2 ${Math.round((Date.now() - t1) / 1000)} s · archivo ${fs.existsSync(file) ? 'creado' : 'NO creado'} · dice ${JSON.stringify(said)} · errores ${JSON.stringify(errs)}`);
      await page.click('text=Prueba ' + agent).catch(() => {});
      await shot(`conversacion-${agent}`);
    } catch (e) { note(`${agent}: FALLO ${e.message}`); await shot(`conversacion-${agent}-fallo`); }
  }

  // ---- 2. the assistant (Claude, coordinator) creates a task, an agent does it, report with OK, then undo
  if (AGENTS.includes('claude')) {
    const t0 = Date.now();
    await page.click('[data-testid=nav-chat]');
    await call('chat.send', { text: 'En el proyecto prueba-real, encarga a cualquier agente crear un archivo saludo.md con una línea que diga "Hola Dani". Es una prueba: tarea mínima, modelo barato.' });
    const task = await until(async () => (await call('tasks.list')).find((t) => t.project === 'prueba-real'), 'tarea creada por el asistente');
    note(`asistente creó tarea #${task.id} «${task.title}» para ${task.agent} (${task.status}) en ${Math.round((Date.now() - t0) / 1000)} s`);
    await shot('chat-tarea-creada');
    if (task.status === 'awaiting_approval') { note('la tarea espera aprobación; la apruebo'); await call('tasks.approve', { id: task.id }).catch((e) => note(`aprobar: ${e.message}`)); }
    const done = await until(async () => { const t = await call('tasks.get', { id: task.id }); return ['done', 'failed', 'blocked', 'cancelled'].includes(t.status) && t; }, 'tarea terminada', 300000);
    note(`tarea #${done.id}: ${done.status} en ${Math.round((Date.now() - t0) / 1000)} s · ${String(done.result ?? '').slice(0, 300)}`);
    await shot('tarea-terminada');
    const report = await until(async () => (await call('chat.list')).find((m) => m.role === 'orb' && m.meta?.kind === 'report'), 'informe', 240000).catch((e) => { note(e.message); return null; });
    if (report) note(`informe: ${String(report.body).slice(0, 400)}`);
    await page.click('[data-testid=nav-chat]');
    await shot('chat-informe');
    const undo = await call('tasks.undo', { id: done.id }).then(() => 'ok', (e) => e.message);
    note(`deshacer: ${undo} · saludo.md ${fs.existsSync(path.join(home, 'prueba-real', 'saludo.md')) ? 'sigue' : 'ya no está'}`);
    note(`uso: ${JSON.stringify(await call('usage.get')).slice(0, 400)}`);

    // ---- 3. 2.3: approval card (denied from the window), steer, queue, fork, Task Review, schedule and @ mentions
    if (process.env.ORB_REAL_23 !== '0') {
      const s = await call('sessions.create', { agent: 'claude', project: 'prueba-real', model: 'haiku', permission: 'editar', title: 'Prueba 2.3' });
      await call('sessions.send', { id: s.id, text: 'Ejecuta con Bash exactamente: git push origin main. Si no te dejan, responde solo "denegado".' });
      await page.click('[data-testid=nav-chat]'); await page.locator(`text=Prueba 2.3`).first().click().catch(() => {});
      await page.waitForSelector('[data-testid=approval-card] >> text=Denegar', { timeout: 120000 });
      await shot('23-aprobacion');
      note(`aprobaciones pendientes: ${(await call('approvals.list')).length}`);
      await page.click('[data-testid=approve-deny]');
      await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status !== 'running', 'turno tras denegar', 120000);
      const said = (await call('sessions.items', { id: s.id })).filter((i) => i.role === 'assistant' && i.kind === 'text').map((i) => i.body).at(-1);
      note(`tras denegar dice: ${JSON.stringify(said)}`);
      // steer: a long turn corrected on the fly
      await call('sessions.send', { id: s.id, text: 'Escribe en lista.txt los números del 1 al 30, uno por línea, usando la herramienta Write varias veces (de 10 en 10). Al final responde "hecho".' });
      await page.waitForTimeout(4000);
      const steer = await call('sessions.send', { id: s.id, text: 'Corrección: añade al final una línea que diga FIN.' });
      const queued = await call('sessions.send', { id: s.id, text: '¿Cuántas líneas tiene lista.txt? Solo el número.', mode: 'queue' });
      note(`corregir en marcha: ${JSON.stringify(steer)} · en cola: ${JSON.stringify(queued)} · cola: ${(await call('sessions.queue', { id: s.id })).length}`);
      await until(async () => (await call('sessions.queue', { id: s.id })).length === 0 && (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'idle', 'cola vaciada', 240000);
      const lista = fs.existsSync(path.join(home, 'prueba-real', 'lista.txt')) ? fs.readFileSync(path.join(home, 'prueba-real', 'lista.txt'), 'utf8').trim().split(/\r?\n/) : [];
      note(`lista.txt: ${lista.length} líneas, última «${lista.at(-1)}» · respuesta a la cola: ${JSON.stringify((await call('sessions.items', { id: s.id })).filter((i) => i.role === 'assistant' && i.kind === 'text').map((i) => i.body).at(-1))}`);
      note(`contexto: ${JSON.stringify((await call('sessions.list')).find((x) => x.id === s.id)?.context)}`);
      await shot('23-cola-y-correccion');
      // fork: the copy remembers the original natively
      const copy = await call('sessions.fork', { id: s.id });
      await call('sessions.send', { id: copy.id, text: '¿Qué archivo con números creaste antes? Solo el nombre.' });
      await until(async () => (await call('sessions.list')).find((x) => x.id === copy.id)?.status === 'idle' && (await call('sessions.items', { id: copy.id })).some((i) => i.role === 'assistant' && i.kind === 'text' && /lista/i.test(String(i.body))), 'bifurcación responde', 120000).catch((e) => note(`bifurcación: ${e.message}`));
      note(`bifurcación recuerda: ${JSON.stringify((await call('sessions.items', { id: copy.id })).filter((i) => i.role === 'assistant' && i.kind === 'text').map((i) => i.body).at(-1))}`);
      // @ mention: the assistant gets a task's result as context
      note(`opciones @: ${(await call('mentions.options')).length}`);
      // Task Review of the first task (another provider)
      const review = await call('tasks.review', { id: done.id, focus: 'que el archivo existió con el texto correcto' });
      note(`Task Review: tarea #${review.id} para ${review.agent} (${review.status})`);
      const reviewed = await until(async () => { const t = await call('tasks.get', { id: review.id }); return ['done', 'failed', 'blocked'].includes(t.status) && t; }, 'Task Review terminado', 300000).catch((e) => { note(e.message); return null; });
      if (reviewed) { const verdict = await until(async () => (await call('tasks.get', { id: done.id })).review, 'veredicto guardado', 60000).catch(() => null); note(`veredicto: ${JSON.stringify(verdict)} · ${String(reviewed.result ?? '').slice(0, 300)}`); }
      // schedule
      const sch = await call('schedules.create', { project: 'prueba-real', title: 'Revisión semanal', description: 'Revisa el proyecto y resume en 3 líneas.', every: 'weekly', at_time: '09:00', weekdays: [1], readonly: true });
      note(`programada: #${sch.id} próxima ${sch.next_run}`);
      await page.click('[data-testid=nav-schedules]');
      await page.waitForSelector('text=Revisión semanal');
      await shot('23-programadas');
      await call('schedules.remove', { id: sch.id });
    }
  }
  note(`errores de la página: ${errors.join(' | ') || 'ninguno'}`);
} catch (error) {
  note(`✖ ${error.stack}`);
  await shot('fallo').catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'registro.txt'), log.join('\n'));
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
