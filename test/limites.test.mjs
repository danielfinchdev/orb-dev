// 3.2.1: usage limits, resuming and accounts. The limit of one model (Cursor's API models) stops that model, not the
// account; the reset date the agent gives is read; a task that ends well lifts the pause and the user can lift it by
// hand; a resumed task that brings nothing new is not taken as done; an undone task says so; the OK to a report settles
// the tasks held for review; the lists only offer the agents this PC can run.
import { tempHome, until, startEngine } from './helpers.mjs';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.mjs';
import { parseReset, startCooldown, canLaunch, recordRate, modelLimitUntil, liftAfterSuccess, clearCooldown, waitReason, usageReport, untilText, cooldownUntil } from '../src/core/budget.mjs';
import { chooseModel, modelCatalog } from '../src/engine/catalog.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';

const home = tempHome({ agents: { cursor: { enabled: true } } });
after(() => home.cleanup());

test('parseReset lee la fecha que da Cursor («ends on 10/20/2026», orden de EE. UU.) y la ISO', () => {
  const now = new Date(2026, 9, 14, 11, 42);
  const text = "You've hit your usage limit … Your usage limits will reset when your monthly cycle ends on 10/20/2026.";
  assert.equal(parseReset(text, now), new Date(2026, 9, 20).getTime(), 'el 20 de octubre, no 5 h después');
  assert.equal(parseReset('limit until 2026-10-22', now), new Date(2026, 9, 22).getTime());
  assert.equal(parseReset('ends on 10/14/2026', now), now.getTime() + 5 * 3_600_000, 'una fecha ya pasada no vale: la ventana normal');
  assert.equal(new Date(parseReset('resets 5pm', now)).getHours(), 17, 'lo de antes sigue igual');
  assert.match(untilText(new Date(2026, 9, 20).getTime(), now.getTime()), /^00:00 del /, 'la hora con el día cuando falta más de un día');
});

test('el límite de un modelo deja la cuenta libre; un éxito o «Quitar pausa» levantan la pausa', () => {
  const board = new Board();
  board.settingJson('models:cursor', [{ id: 'auto', label: 'Auto', default: true }, { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash' }]);
  recordRate(board, 'cursor', { status: 'rejected', model: 'gemini-3.8-flash-medium', resetAt: null, text: `reset when your monthly cycle ends on ${(() => { const d = new Date(Date.now() + 5 * 86_400_000); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; })()}` });
  assert.ok(modelLimitUntil(board, 'cursor', 'gemini-3.8-flash-medium') > Date.now() + 4 * 86_400_000, 'hasta el fin del ciclo');
  assert.equal(cooldownUntil(board, 'cursor'), 0, 'la cuenta no se pausa');
  assert.equal(canLaunch(board, 'cursor', null).ok, true, 'Cursor con su modelo normal sigue disponible');
  const blocked = canLaunch(board, 'cursor', 'gemini-3.8-flash-medium');
  assert.equal(blocked.ok, false); assert.match(blocked.reason, /no tiene uso del modelo Gemini 3\.8 Flash hasta las/);
  assert.deepEqual(usageReport(board).find((u) => u.account === 'cursor').modelLimits.map((m) => m.label), ['Gemini 3.8 Flash']);
  assert.match(waitReason(board, 'cursor', { model: 'gemini-3.8-flash-medium' }), /Gemini 3\.8 Flash/, 'el coordinador sabe que esperaría');
  assert.equal(waitReason(board, 'cursor', {}), '');
  // A pause of the whole account: lifted by a task launched after it that ends well, not by one launched before.
  const before = new Date(Date.now() - 60_000).toISOString();
  startCooldown(board, 'codex', 'usage limit · resets in 3 h');
  assert.deepEqual(liftAfterSuccess(board, 'codex', null, before), [], 'una tarea lanzada antes del límite no cuenta');
  assert.ok(cooldownUntil(board, 'codex'));
  assert.deepEqual(liftAfterSuccess(board, 'codex', null, new Date(Date.now() + 1000).toISOString()), ['account']);
  assert.equal(cooldownUntil(board, 'codex'), 0);
  // By hand: the account and its models.
  startCooldown(board, 'cursor', 'usage limit · resets in 2 h');
  clearCooldown(board, 'cursor');
  assert.equal(cooldownUntil(board, 'cursor'), 0);
  assert.equal(modelLimitUntil(board, 'cursor', 'gemini-3.8-flash-medium'), 0);
});

test('Orb no elige un modelo sin uso para una tarea', () => {
  const board = new Board();
  board.settingJson('models:codex', [{ id: 'gpt-a-5', label: 'GPT A 5', default: true }, { id: 'gpt-b-4', label: 'GPT B 4' }]);
  assert.equal(chooseModel(board, 'codex', 'normal', 'codex', { writes: true }).model, 'gpt-a-5');
  recordRate(board, 'codex', { status: 'rejected', model: 'gpt-a-5', resetAt: Date.now() + 3_600_000 });
  assert.equal(chooseModel(board, 'codex', 'normal', 'codex', { writes: true }).model, 'gpt-b-4');
  const entry = modelCatalog(board).find((a) => a.id === 'codex');
  assert.ok(entry.models.find((m) => m.id === 'gpt-a-5').limitedUntil > Date.now(), 'el selector lo marca');
});

test('el uso de una tarea sin datos de tokens dice «sin datos», no 0', () => {
  assert.equal(Scheduler.prototype.usageLine({ minutes: 2.2, tokens: null, costUsd: null }), '2 min · tokens: sin datos');
  assert.equal(Scheduler.prototype.usageLine({ minutes: 0.4, tokens: 37_000, costUsd: null }), '<1 min · 37 k tokens');
});

// ---- with the engine in its own process and the fake agents
let t; let engine;
async function fresh(patch = {}, env = {}) {
  t = tempHome(patch);
  engine = await startEngine(t.home, { env });
  await engine.call('projects.create', { name: 'web' });
  await engine.call('projects.setActive', { name: 'web' });
  return engine;
}
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });
const done = (call, id, wanted, ms = 20000) => until(async () => { const x = await call('tasks.get', { id }); return wanted.includes(x.status) && x.pid == null && x; }, `tarea #${id} en ${wanted.join('/')}`, ms);

test('motor: el límite de un modelo vuelve a poner la tarea en cola sin modelo y la cuenta sigue trabajando', async () => {
  const { call } = await fresh();
  const task = await call('tasks.create', { project: 'web', title: 'Con un modelo de API', description: 'LIMITE_MODELO', agent: 'codex', model: 'gpt-api-1' });
  const out = await done(call, task.id, ['done']);
  assert.ok(out.events.some((e) => e.kind === 'task.model_limited'), out.events.map((e) => e.kind).join(', '));
  assert.notEqual(out.model, 'gpt-api-1', 'sigue con otro modelo (o el predeterminado)');
  const usage = (await call('usage.get')).find((u) => u.account === 'codex');
  assert.equal(usage.cooldownUntil, null, 'la cuenta no queda en pausa');
  assert.deepEqual(usage.modelLimits.map((m) => m.model), ['gpt-api-1']);
  assert.ok((await call('chat.list')).some((m) => /se ha quedado sin uso del modelo gpt-api-1 hasta las .+ del .+ sigue con el modelo predeterminado/.test(m.body)));
  // «Quitar pausa» in Agentes also frees the model.
  assert.equal(await call('accounts.clearCooldown', { account: 'codex' }), true);
  assert.deepEqual((await call('usage.get')).find((u) => u.account === 'codex').modelLimits, []);
  await assert.rejects(call('accounts.clearCooldown', { account: 'no-existe' }));
});

test('motor: una tarea lanzada de todos modos que termina bien quita la pausa de su cuenta', async () => {
  const { call } = await fresh();
  const first = await call('tasks.create', { project: 'web', title: 'Llega al límite', description: 'LIMITE 3600000', agent: 'codex' });
  await done(call, first.id, ['limited']);
  assert.ok((await call('usage.get')).find((u) => u.account === 'codex').cooldownUntil > Date.now());
  const next = await call('tasks.create', { project: 'web', title: 'Otra', description: 'algo', agent: 'codex' });
  await until(async () => (await call('tasks.get', { id: next.id })).events.some((e) => e.kind === 'task.waiting'), 'espera por la pausa');
  await call('tasks.launchAnyway', { id: next.id });
  const ok = await done(call, next.id, ['done']);
  assert.ok(ok.events.some((e) => e.kind === 'budget.lifted'));
  assert.equal((await call('usage.get')).find((u) => u.account === 'codex').cooldownUntil, null, 'Agentes ya no la muestra en pausa');
});

test('motor: una tarea reanudada tras un cierre que termina sin nada nuevo queda para revisar, no hecha', async () => {
  let { call } = await fresh({}, { ORB_FAKE_EMPTY_RESUME: '1' });
  const task = await call('tasks.create', { project: 'web', title: 'Verificación larga', description: 'DUERME mucho rato', agent: 'claude' });
  await until(async () => (await call('tasks.get', { id: task.id })).status === 'running', 'tarea en marcha');
  await engine.kill();
  engine = await startEngine(t.home, { env: { ORB_FAKE_EMPTY_RESUME: '1' } });
  ({ call } = engine);
  const out = await done(call, task.id, ['blocked', 'done']);
  assert.equal(out.status, 'blocked');
  assert.match(out.result, /se reanudó tras cerrarse Orb y terminó sin un resultado nuevo/);
  assert.ok(out.events.some((e) => e.kind === 'task.resumed_empty'));
});

test('motor: deshacer deja la tarea «Deshecha», sin aceptar ni deshacer otra vez', async () => {
  const { call } = await fresh();
  const task = await call('tasks.create', { project: 'web', title: 'Escribe', description: 'ESCRIBE', agent: 'claude' });
  await done(call, task.id, ['done']);
  assert.equal((await call('tasks.get', { id: task.id })).hasCheckpoint, true);
  await call('tasks.undo', { id: task.id });
  const undone = await call('tasks.get', { id: task.id });
  assert.ok(undone.undone?.at, 'marcada como deshecha');
  assert.equal(undone.hasCheckpoint, false, 'no se puede deshacer dos veces');
  assert.ok((await call('tasks.list')).find((x) => x.id === task.id).undone);
  await assert.rejects(call('tasks.undo', { id: task.id }), /ya está deshecha/);
  await assert.rejects(call('tasks.accept', { id: task.id }), 'su resultado ya no se puede aceptar');
  await until(() => engine.events.some((e) => e.event === 'notice' && /Se ha deshecho la tarea #\d+: 0 archivos restaurados, 1 eliminado\./.test(e.payload?.body)), 'aviso sin «(s)»', 5000);
});

test('motor: el OK al informe resuelve las tareas que esperaban tu revisión; las listas solo traen agentes disponibles', async () => {
  const { call } = await fresh();
  const board = new Board();
  const conv = board.createConversation({ title: 'Prueba', project: 'web' });
  board.run("INSERT INTO tasks (project, title, description, status, created_by, conversation_id, created_at, updated_at) VALUES ('web', 'Verificación', 'x', 'blocked', 'orb', ?, ?, ?)", conv.id, new Date(Date.now() - 5000).toISOString(), new Date(Date.now() - 5000).toISOString());
  const held = board.one('SELECT MAX(id) AS id FROM tasks').id;
  board.event(held, 'orb', 'task.launched', 'queued'); board.event(held, 'orb', 'task.held', 'requiere tu revisión');
  const report = board.addChat('orb', 'Informe: todo bien.', { kind: 'report', project: 'web', tasks: [] }, conv.id);
  assert.deepEqual(await call('chat.accept', { id: report.id }), [held]);
  const after = await call('tasks.get', { id: held });
  assert.equal(after.status, 'done'); assert.equal(after.accepted, true);
  // Only the agents this PC can run (the test PC: Claude and Codex).
  const state = await call('app.state');
  assert.deepEqual([...state.agentsAvailable].sort(), ['claude', 'codex']);
  assert.deepEqual([...new Set((await call('usage.get')).map((u) => u.agent))].sort(), ['claude', 'codex']);
  const guide = await call('models.guide');
  assert.ok(guide.every((a) => a.readPicks?.simple), 'la guía de Ajustes enseña también lo de solo lectura');
});
