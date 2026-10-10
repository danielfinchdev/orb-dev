// Live progress of running tasks and plain-words failures of the agents (e.g. a plan without access), with the engine in
// its own process and fake agents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

let t; let engine; let n = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
const taskDone = (id) => until(async () => { const x = await call('tasks.get', { id }); return !['queued', 'running'].includes(x.status) && x.pid == null && x; }, `tarea #${id}`);

before(async () => {
  t = tempHome();
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  await call('projects.create', { name: 'web' });
  await call('projects.setActive', { name: 'web' });
});
after(() => { engine.send({ type: 'shutdown' }); t.cleanup(); });

test('una tarea en marcha se ve en directo: tiempo, pasos, lo que hace y el porcentaje que informa el agente', async () => {
  const task = await call('tasks.create', { project: 'web', title: 'Con progreso', description: 'PROGRESO', agent: 'claude' });
  const live = await until(async () => (await call('tasks.live')).find((x) => x.id === task.id && x.percent != null), 'progreso en directo');
  assert.equal(live.percent, 40);
  assert.equal(live.note, 'probando el formulario');
  assert.equal(live.agent, 'claude');
  assert.ok(live.steps >= 1 && live.startedAt <= Date.now() && live.quietMin === 0);
  const done = await taskDone(task.id);
  assert.equal(done.status, 'done');
  assert.deepEqual(await call('tasks.live'), []);
  // The progress report is shown live, not kept as a note in the history.
  assert.ok(!done.events.some((e) => e.kind === 'note' && /probando/.test(e.detail)));
});

test('si el plan del agente no le deja trabajar, se explica claro, se pausa esa cuenta y la tarea pasa a otro agente', async () => {
  // Same use on both agents, so the task goes to Claude first (the order in Ajustes).
  await taskDone((await call('tasks.create', { project: 'web', title: 'Codex antes', description: 'algo', agent: 'codex' })).id);
  const task = await call('tasks.create', { project: 'web', title: 'Plan gratis', description: 'PLAN_GRATIS', agent: 'any' });
  const done = await taskDone(task.id);
  assert.equal(done.status, 'done', done.result);
  assert.equal(done.assigned_to, 'codex', 'la reintenta otro agente');
  assert.ok(done.events.some((e) => e.kind === 'task.launched' && e.actor === 'orb'));
  assert.ok(done.events.some((e) => e.kind === 'agent.problem' && /plan/.test(e.detail)));
  const chat = await call('chat.list');
  assert.ok(chat.some((m) => /no pudo completar la tarea #\d+.*plan.*La tarea se asigna a otro agente/s.test(m.body)), 'aviso claro en el chat');
  const usage = await call('usage.get');
  assert.ok(usage.find((u) => u.account === 'claude').cooldownUntil > Date.now() + 3_600_000, 'Claude en pausa (un día)');
  // A task pinned to that agent waits with the reason instead of failing again.
  const pinned = await call('tasks.create', { project: 'web', title: 'Fijada', description: 'algo', agent: 'claude' });
  await until(async () => (await call('chat.list')).some((m) => m.body.includes(`#${pinned.id}`) && /en pausa.*plan/.test(m.body)), 'espera con motivo');
  await call('tasks.cancel', { id: pinned.id });
});
