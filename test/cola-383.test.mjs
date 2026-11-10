// 3.8.3: the queue and the approvals explain themselves. A queued task says why it waits (the whole queue paused, other
// tasks it depends on, the scheduler's notice), a task Orb held for review after it ran (a mass deletion) shows in «Por
// aprobar» with what it did and where, and is accepted or undone from there; «Iniciar de todos modos» starts the task even
// with the queue paused (or says which tasks it still waits for); and the coordinator knows the queue is paused instead of
// promising «te aviso cuando terminen».
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, until, startEngine } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { ctx, tr } from '../src/platform/context.mjs';

const home = tempHome();
after(() => home.cleanup());
const tick = () => new Promise((r) => setImmediate(r));

// A task that ran and that the scheduler held, as scheduler.finish does (status, then the reasons in front of its result).
function hold(board, id, reasons) {
  board.patch(id, { status: 'running' }, 'orb', 'task.launched');
  board.patch(id, { status: 'blocked' }, 'orb', 'task.held');
  board.patch(id, { result: `${tr('msg.scheduler.needsReview', { reasons })}. Borré la carpeta vieja.` }, 'orb', 'task.held');
}
function setup() {
  const board = new Board();
  const dir = path.join(home.home, 'web', `cola-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`); fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(dir);
  board.addProject({ name, path: dir }, 'usuario');
  const mk = (title, extra = {}) => board.createTask({ project: name, title, description: 'x', agent: 'claude', ...extra }, 'usuario');
  return { board, dir, name, mk };
}

test('why a queued task waits: a dependency that needs the user first, then the paused queue, then the rest', () => {
  const { board, dir, mk } = setup();
  const a = mk('Borra lo viejo'); hold(board, a.id, 'ha eliminado 2714 archivos');
  const b = mk('Sigue', { depends_on: [a.id] }); const c = mk('Otra');
  assert.deepEqual(board.heldInfo(board.task(a.id)), { reasons: 'ha eliminado 2714 archivos', folder: dir });
  board.setting('paused', '1');
  assert.deepEqual(board.waitReason(board.task(b.id)), { kind: 'deps', on: [{ id: a.id, status: 'blocked', held: true }] }, 'resuming alone would not start it');
  assert.deepEqual(board.waitReason(board.task(c.id)), { kind: 'paused' });
  board.setting('paused', '0');
  assert.equal(board.waitReason(board.task(c.id)), null, 'its turn comes');
  // Ajustes › «Iniciar las tareas automáticamente» off: said too (it used to wait silently as well).
  ctx.config.autoRun = false;
  try { assert.deepEqual(board.waitReason(board.task(c.id)), { kind: 'manual' }); assert.match(board.explainForAgents(board.task(c.id)).waiting, /a mano/); } finally { ctx.config.autoRun = true; }
  board.setting(`wait_notice:${c.id}`, 'límite de uso de Claude hasta las 18:00');
  assert.deepEqual(board.waitReason(board.task(c.id)), { kind: 'notice', text: 'límite de uso de Claude hasta las 18:00' });
  // A dependency still working: «Espera a #n».
  const d = mk('Base'); board.patch(d.id, { status: 'running' }, 'orb', 'task.launched');
  const e = mk('Pieza', { depends_on: [d.id] });
  assert.deepEqual(board.waitReason(board.task(e.id)), { kind: 'deps', on: [{ id: d.id, status: 'running', held: false }] });
  // Launched again (retry): no longer held.
  board.patch(a.id, { status: 'running' }, 'orb', 'task.launched');
  assert.equal(board.heldInfo(board.task(a.id)), null);
  // The coordinator's board says it in words.
  board.patch(a.id, { status: 'blocked' }, 'orb', 'task.held'); board.patch(a.id, { result: `${tr('msg.scheduler.needsReview', { reasons: 'ha eliminado 3 archivos' })}. x` }, 'orb', 'task.held');
  board.setting('paused', '1');
  const active = board.summary(null).active;
  assert.match(active.find((x) => x.id === c.id).waiting, /cola en pausa/);
  assert.match(active.find((x) => x.id === a.id).held, /ha eliminado 3 archivos en /);
  assert.match(active.find((x) => x.id === b.id).waiting, new RegExp(`espera a #${a.id} \\(retenida`));
  board.setting('paused', '0');
});

test('the lists carry the reasons; a held task is accepted from its card and the ones after it go on', async () => {
  const { board, mk } = setup();
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: null, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const a = mk('Borra lo viejo'); hold(board, a.id, 'ha eliminado 12 archivos');
  const b = mk('Sigue', { depends_on: [a.id] }); const c = mk('Otra');
  board.setting('paused', '1');
  const list = await api.call('tasks.list', {}, DESKTOP);
  assert.equal(list.find((x) => x.id === a.id).held.reasons, 'ha eliminado 12 archivos');
  assert.equal(list.find((x) => x.id === b.id).waiting.kind, 'deps');
  assert.equal(list.find((x) => x.id === c.id).waiting.kind, 'paused');
  assert.equal((await api.call('tasks.get', { id: a.id }, DESKTOP)).held.reasons, 'ha eliminado 12 archivos');
  // «Iniciar de todos modos»: one that waits for others says which; the other one goes even paused.
  await assert.rejects(api.call('tasks.launchAnyway', { id: b.id }, DESKTOP), new RegExp(`#${a.id}`));
  assert.deepEqual(await api.call('tasks.launchAnyway', { id: c.id }, DESKTOP), { paused: true });
  assert.equal(board.setting(`budget_ok:${c.id}`), '1');
  // «Aceptar» on the held one: done and accepted; the one after it no longer waits for it.
  assert.deepEqual(await api.call('tasks.accept', { id: a.id }, DESKTOP), [a.id]);
  assert.equal(board.task(a.id).status, 'done'); assert.ok(board.isAccepted(a.id));
  assert.deepEqual(board.waitReason(board.task(b.id)), { kind: 'paused' });
  board.setting('paused', '0');
});

test('the coordinator hears the queue is paused, and the chat says so with «Reanudar» instead of «te aviso»', async () => {
  const { board, name, mk } = setup();
  const sent = [];
  const o = new Orchestrator(board);
  const make = o.lane.bind(o);
  o.lane = (id) => {
    const l = make(id);
    l.ensureLive = () => { l.liveAgent = 'claude'; l.live ??= { send: async ({ text }) => { sent.push(text); return { text: 'Hecho', final: 'Hecho' }; }, isClosed: () => false, close() {}, interrupt() {} }; };
    return l;
  };
  board.setting('paused', '1');
  const conv = board.createConversation({ title: 'Cola', project: name });
  mk('Pendiente', { conversation_id: conv.id });
  o.ask('haz algo', '', { conversation: conv.id });
  for (let i = 0; i < 10; i++) await tick();
  assert.match(sent.at(-1), /la cola de tareas está en pausa/);
  const lines = board.chat(conv.id);
  assert.ok(lines.some((m) => m.meta?.kind === 'paused' && /Reanudar/.test(m.body)), 'the paused card');
  assert.ok(!lines.some((m) => m.meta?.kind === 'games'), 'no «te aviso cuando terminen»');
  board.setting('paused', '0');
  o.ask('otra cosa', '', { conversation: conv.id });
  for (let i = 0; i < 10; i++) await tick();
  assert.doesNotMatch(sent.at(-1), /en pausa/, 'not paused: nothing added');
});

// The real engine (fake agents): with the queue paused, «Iniciar de todos modos» starts that task and only that one.
let engine = null; let t = null;
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); t = null; });
test('motor: con la cola en pausa, «Iniciar de todos modos» inicia esa tarea y solo esa', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'web' });
  await call('control.pause');
  const one = await call('tasks.create', { project: 'web', title: 'Esta sí', description: 'algo', agent: 'claude' });
  const two = await call('tasks.create', { project: 'web', title: 'Esta espera', description: 'algo', agent: 'claude' });
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((await call('tasks.get', { id: one.id })).status, 'queued', 'paused: nothing starts by itself');
  assert.equal((await call('tasks.get', { id: two.id })).waiting.kind, 'paused');
  assert.deepEqual(await call('tasks.launchAnyway', { id: one.id }), { paused: true });
  await until(async () => (await call('tasks.get', { id: one.id })).status === 'done', 'la tarea iniciada termina', 20000);
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((await call('tasks.get', { id: two.id })).status, 'queued', 'the rest of the queue stays paused');
  await call('control.resume');
  await until(async () => (await call('tasks.get', { id: two.id })).status === 'done', 'reanudada, la otra también', 20000);
});

test('motor: una tarea que borra muchos archivos queda por aprobar, con la carpeta, y se acepta desde ahí', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'limpieza' });
  const dir = (await call('projects.list')).find((x) => x.name === 'limpieza').path;
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, `viejo-${i}.txt`), `${i}\n`);
  const task = await call('tasks.create', { project: 'limpieza', title: 'Ordena', description: 'ZAP_TODO lo viejo', agent: 'claude' });
  await until(async () => (await call('tasks.get', { id: task.id })).status === 'blocked', 'retenida', 20000);
  const got = await call('tasks.get', { id: task.id });
  assert.match(got.held.reasons, /eliminado 12 archivos/);
  assert.equal(got.held.folder.toLowerCase(), dir.toLowerCase());
  assert.ok((await call('tasks.list')).find((x) => x.id === task.id).held, 'the list says so («Por aprobar»)');
  assert.ok((await call('chat.list')).some((m) => m.body.includes('eliminado 12 archivos') && m.body.includes(dir)), 'the notice names the folder');
  await call('tasks.accept', { id: task.id });
  assert.equal((await call('tasks.get', { id: task.id })).status, 'done');
});
