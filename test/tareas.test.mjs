// Tasks in 2.3, with the engine in its own process and the fake agents: a task stopped by a usage limit waits ("limited")
// and continues by itself at the reset; tasks interrupted by a closed app continue when it opens again; an agent delegates
// part of its task (orb_delegate) and waits for it (orb_wait_tasks); Task Review by another provider with its verdict;
// and the real usage the accounts report stops new work at budget.stopAt.
import { tempHome, until, startEngine, fakeLog, wait } from './helpers.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let t; let engine;
async function fresh(patch = {}) {
  t = tempHome(patch);
  engine = await startEngine(t.home);
  await engine.call('projects.create', { name: 'web' });
  await engine.call('projects.setActive', { name: 'web' });
  return engine;
}
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });
const kinds = (task) => task.events.map((e) => e.kind);
const status = async (call, id, wanted, ms = 20000) => until(async () => { const x = await call('tasks.get', { id }); return wanted.includes(x.status) && x.pid == null && x; }, `tarea #${id} en ${wanted.join('/')}`, ms);

test('límite de uso: la tarea queda «limitada» y sigue sola al reiniciarse el cupo', async () => {
  const { call } = await fresh();
  const task = await call('tasks.create', { project: 'web', title: 'Con límite', description: 'LIMITE 2500', agent: 'claude' });
  const limited = await status(call, task.id, ['limited']);
  assert.ok(Date.parse(limited.limited_until) > Date.now() - 1000, 'guarda cuándo se reinicia');
  assert.match(limited.result, /ha alcanzado su límite de uso\. La tarea se reanudará automáticamente a las/);
  assert.ok((await call('chat.list')).some((m) => m.body.includes(`#${task.id}`) && /se reanudará automáticamente/.test(m.body)));
  const usage = (await call('usage.get')).find((u) => u.account === 'claude');
  assert.ok(usage.cooldownUntil > Date.now(), 'la cuenta no recibe nada más hasta el reinicio');
  const done = await status(call, task.id, ['done'], 20000);
  assert.ok(kinds(done).includes('task.limit_reset') && kinds(done).includes('task.resumed'));
  assert.equal(done.limited_until, null);
  const log = fakeLog(t.home, task.id);
  assert.match(log.at(-1).text, /El límite de uso se ha reiniciado\. Continúa la tarea donde la dejaste\./);
  assert.equal(log.at(-1).resumeId, log[0].newSessionId, 'continúa la misma conversación del agente');
  assert.ok((await call('chat.list')).some((m) => /Se ha restablecido el cupo\. La tarea #\d+/.test(m.body)));
});

test('límite de uso con «seguir al reiniciarse» desactivado: espera al usuario, que puede reintentarla', async () => {
  const { call } = await fresh({ continuity: { resumeAtReset: false } });
  const task = await call('tasks.create', { project: 'web', title: 'Sin seguir', description: 'LIMITE 300', agent: 'codex' });
  await status(call, task.id, ['limited']);
  await wait(3500); // the reset passed and several ticks went by
  assert.equal((await call('tasks.get', { id: task.id })).status, 'limited');
  assert.equal((await call('tasks.retry', { id: task.id })).status, 'queued', 'una tarea limitada se puede reintentar');
  assert.equal((await status(call, task.id, ['done', 'limited'])).status, 'limited', 'el agente vuelve a encontrarse el límite (sigue diciendo LIMITE)');
});

test('continuar tras reiniciar: la tarea que trabajaba al cerrarse la app sigue en la misma conversación', async () => {
  let { call } = await fresh();
  const task = await call('tasks.create', { project: 'web', title: 'Larga', description: 'DUERME mucho rato', agent: 'claude' });
  await until(async () => (await call('tasks.get', { id: task.id })).status === 'running', 'tarea en marcha');
  await until(() => fakeLog(t.home, task.id).length, 'el agente empezó');
  await engine.kill(); // the app closes without a goodbye (crash, power cut, Windows update)
  engine = await startEngine(t.home);
  ({ call } = engine);
  const done = await status(call, task.id, ['done']);
  assert.ok(['task.interrupted', 'task.resumed', 'followup.sent'].every((k) => kinds(done).includes(k)), kinds(done).join(', '));
  assert.ok(done.events.some((e) => e.kind === 'followup.sent' && /misma conversación/.test(e.detail)));
  const log = fakeLog(t.home, task.id);
  assert.match(log.at(-1).text, /se cerró mientras trabajabas en esta tarea\. Continúa donde lo dejaste/);
  assert.equal(log.at(-1).resumeId, log[0].newSessionId, 'el agente retoma su propia conversación');
  assert.ok((await call('chat.list')).some((m) => /se reanuda desde donde se quedó/.test(m.body) && m.body.includes(`#${task.id}`)));
});

test('continuar tras reiniciar desactivado: la tarea interrumpida queda fallida para reintentarla', async () => {
  let { call } = await fresh({ continuity: { resumeAfterRestart: false } });
  const task = await call('tasks.create', { project: 'web', title: 'Larga 2', description: 'DUERME', agent: 'codex' });
  await until(async () => (await call('tasks.get', { id: task.id })).status === 'running', 'tarea en marcha');
  await engine.kill();
  engine = await startEngine(t.home);
  ({ call } = engine);
  const failed = await call('tasks.get', { id: task.id });
  assert.equal(failed.status, 'failed');
  assert.match(failed.result, /se interrumpió porque Orb se cerró\. Puedes reintentarla/);
});

test('delegación: el agente reparte una subtarea, espera su resultado y la subtarea cuelga de la suya', async () => {
  const { call } = await fresh();
  const parent = await call('tasks.create', { project: 'web', title: 'Principal', description: 'DELEGA 1 codex ESPERA', agent: 'claude' });
  const done = await status(call, parent.id, ['done'], 45000);
  const [child] = done.children;
  assert.ok(child, 'la subtarea aparece colgando de la principal');
  assert.equal(child.agent, 'codex');
  assert.equal(child.status, 'done');
  assert.match(done.result, new RegExp(`subtarea #${child.id}: queued \\| resultado #${child.id}: done`), done.result);
  assert.ok(done.events.some((e) => e.kind === 'task.delegated' && e.detail.includes(`#${child.id}`)));
  const sub = await call('tasks.get', { id: child.id });
  assert.equal(sub.parent_id, parent.id);
  assert.equal(sub.created_by, 'claude');
  assert.equal(sub.readonly, true);
  assert.deepEqual(sub.sensitivity, [], 'con confianza y sin riesgo va directa a la cola');
});

test('Task Review: lo revisa otro proveedor en solo lectura y el veredicto queda junto a la tarea', async () => {
  const { call } = await fresh();
  const task = await call('tasks.create', { project: 'web', title: 'Portada', description: 'ESCRIBE la portada', agent: 'claude' });
  await status(call, task.id, ['done']);
  const review = await call('tasks.review', { id: task.id, focus: 'accesibilidad' });
  assert.equal(review.agent, 'codex', 'otro proveedor');
  assert.equal(review.readonly, true);
  assert.equal(review.review_of, task.id);
  assert.deepEqual(review.depends_on, [task.id]);
  assert.match(review.description, /Fíjate sobre todo en: accesibilidad/);
  await status(call, review.id, ['done']);
  const reviewed = await call('tasks.get', { id: task.id });
  assert.deepEqual({ ...reviewed.review, at: undefined }, { task: review.id, verdict: 'correcto', agent: 'codex', at: undefined });
  assert.ok(reviewed.events.some((e) => e.kind === 'review.verdict' && /correcto \(Task Review #\d+\)/.test(e.detail)));
  assert.ok(reviewed.children.some((c) => c.id === review.id), 'la revisión aparece con la tarea');
  // A review that finds problems.
  const bad = await call('tasks.create', { project: 'web', title: 'Formulario', description: 'Haz el formulario (con FALLOS a propósito)', agent: 'claude' });
  await status(call, bad.id, ['done']);
  const r2 = await call('tasks.review', { id: bad.id });
  await status(call, r2.id, ['done']);
  assert.equal((await call('tasks.get', { id: bad.id })).review.verdict, 'con fallos');
});

test('Task Review automático, del proyecto entero y con el mismo agente (otro modelo)', async () => {
  const { call } = await fresh({ review: { auto: true } });
  const task = await call('tasks.create', { project: 'web', title: 'Cabecera', description: 'algo sencillo', agent: 'codex' });
  await status(call, task.id, ['done']);
  const auto = await until(async () => (await call('tasks.list')).find((x) => x.review_of === task.id), 'revisión automática');
  assert.equal(auto.agent, 'claude', 'el trabajo de Codex lo revisa Claude');
  await status(call, auto.id, ['done']);
  assert.equal((await call('tasks.get', { id: task.id })).review.verdict, 'correcto');
  assert.ok(!(await call('tasks.list')).some((x) => x.review_of === auto.id), 'una revisión no se revisa a sí misma');
  const whole = await call('projects.review', { name: 'web' });
  assert.equal(whole.title, 'Task Review del proyecto web');
  assert.equal(whole.readonly, true);
  assert.equal(whole.agent, 'claude', 'otro que el que hizo las últimas tareas (Codex)');
  // The same agent reviews with another model than the one that did the work (its default one when none was chosen).
  const mine = await call('tasks.create', { project: 'web', title: 'Pie', description: 'algo', agent: 'claude' });
  await status(call, mine.id, ['done']);
  const same = await call('tasks.review', { id: mine.id, agent: 'claude' });
  assert.equal(same.agent, 'claude');
  assert.ok(same.model && same.model !== 'sonnet', `otro modelo que el predeterminado (sonnet), no ${same.model}`);
});

test('cupo real: al pasar de budget.stopAt la cuenta no recibe trabajo nuevo, y sí cuando se sube el tope', async () => {
  const { call } = await fresh();
  const s = await call('sessions.create', { agent: 'codex', project: 'web' });
  await call('sessions.send', { id: s.id, text: 'RATE 95' });
  await until(async () => (await call('usage.get')).find((u) => u.account === 'codex').real?.utilization === 0.95, 'uso real de Codex');
  const task = await call('tasks.create', { project: 'web', title: 'Espera cupo', description: 'algo', agent: 'codex' });
  await until(async () => (await call('chat.list')).some((m) => m.body.includes(`#${task.id}`) && /ya ha usado el 95 % de su cupo real/.test(m.body)), 'aviso de espera');
  assert.equal((await call('tasks.get', { id: task.id })).status, 'queued');
  await call('config.save', { patch: { budget: { stopAt: 0.99 } } });
  assert.equal((await status(call, task.id, ['done'])).status, 'done');
  // An "any" task goes to the account with more room left (Claude has used nothing).
  const any = await call('tasks.create', { project: 'web', title: 'Cualquiera', description: 'algo', agent: 'any' });
  assert.equal((await status(call, any.id, ['done'])).assigned_to, 'claude');
});
