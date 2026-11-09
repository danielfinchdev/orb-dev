// 3.8.3: the engine never blocks. Up to 3.8.2 every finished task left an empty «leftovers_pending» row, and on every
// tick (1.5 s) the engine listed the PC's processes once per row with a synchronous PowerShell (~0.8 s each): the window,
// the phone and every chat froze, and one core stayed busy forever.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { tempHome, wait } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { processList } from '../src/core/procs.mjs';
import { createProject } from '../src/core/projects.mjs';

const t = tempHome();
const board = new Board();
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const rows = () => board.all("SELECT key, value FROM settings WHERE key LIKE 'leftovers_pending:%'");

test('settingJson(clave, null) borra la fila (no deja una vacía)', () => {
  board.settingJson('prueba:1', { a: 1 });
  assert.deepEqual(board.settingJson('prueba:1'), { a: 1 });
  board.settingJson('prueba:1', null);
  assert.equal(board.one("SELECT COUNT(*) AS n FROM settings WHERE key = 'prueba:1'").n, 0, 'sin fila');
  assert.equal(board.settingJson('prueba:1'), null, 'se lee como antes: null');
  assert.equal(board.setting('prueba:1'), undefined);
});

// A scheduler without engine: only what the leftovers need.
function scheduler() {
  const s = Object.create(Scheduler.prototype);
  Object.assign(s, { board, running: new Map(), cleaning: new Map(), log: () => {}, sessions: { closeLive() {} } });
  return s;
}
function withRealAgents(fn) {
  const saved = process.env.ORB_FAKE_AGENTS; delete process.env.ORB_FAKE_AGENTS;
  try { return fn(); } finally { process.env.ORB_FAKE_AGENTS = saved; }
}

test('una tarea que termina sin nada pendiente no deja marca; muchas terminadas no hacen listar procesos en cada vuelta', { skip: process.platform !== 'win32' }, async () => {
  createProject(board, { name: 'restos' }, 'usuario');
  const s = scheduler();
  // 40 tasks that ended as 3.8.2 left them (an empty row each) and three really pending (their folder was busy then).
  for (let i = 1; i <= 40; i++) board.setting(`leftovers_pending:${1000 + i}`, '');
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const task = board.createTask({ project: 'restos', title: `Restos ${i}`, description: 'x', agent: 'claude' }, 'usuario');
    board.run('UPDATE tasks SET workdir = ? WHERE id = ?', t.base, task.id);
    board.event(task.id, 'orb', 'task.launched', 'x');
    board.settingJson(`leftovers_pending:${task.id}`, { workdir: t.base });
    ids.push(task.id);
  }
  // The startup of 3.8.3 clears the empty rows of before.
  board.run("DELETE FROM settings WHERE key LIKE 'leftovers_pending:%' AND value = ''");
  assert.equal(rows().length, 3, 'solo quedan las de verdad pendientes');

  const before = processList.calls;
  const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
  withRealAgents(() => { for (let tick = 0; tick < 10; tick++) s.retryLeftovers(); });
  assert.equal(rows().length, 0, 'las tres se atienden juntas');
  await Promise.all([...s.cleaning.values()]);
  delay.disable();
  assert.equal(processList.calls - before, 1, 'una sola lista de procesos para todas, no una por fila y vuelta');
  assert.ok(delay.max / 1e6 < 300, `el bucle de eventos no se bloquea mientras se listan (máx ${Math.round(delay.max / 1e6)} ms)`);

  // A task that ends with its folder free leaves no row at all.
  const more = processList.calls;
  const stop = withRealAgents(() => s.stopLeftovers(board.task(ids[0])));
  assert.equal(rows().length, 0, 'sin marca vacía');
  await stop;
  assert.equal(processList.calls - more, 1);
  // Nothing pending: ticks list nothing, ever.
  const idle = processList.calls;
  withRealAgents(() => { for (let tick = 0; tick < 20; tick++) s.retryLeftovers(); });
  await wait(50);
  assert.equal(processList.calls - idle, 0, 'en reposo no se lanza ningún PowerShell');
});

test('la lista de procesos es asíncrona y nunca se solapa', { skip: process.platform !== 'win32' }, async () => {
  const before = processList.calls;
  const since = Date.now() - 60_000;
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  const a = processList(since); const b = processList(since + 1000); // the second is covered by the first: shared
  assert.ok(a instanceof Promise);
  const [la, lb] = await Promise.all([a, b]);
  clearInterval(timer);
  assert.equal(processList.calls - before, 1, 'una sola PowerShell para las dos');
  assert.ok(Array.isArray(la) && la.length > 0 && la === lb);
  assert.ok(la.some((p) => p.id === process.pid), 'este proceso está en la lista');
  assert.ok(ticks > 5, 'el bucle siguió vivo mientras PowerShell trabajaba');
});

test('el texto que escribe un agente va a la ventana en trozos de 50 ms, y antes que cualquier otra cosa que haga', async () => {
  const { Sessions } = await import('../src/engine/sessions.mjs');
  const sent = [];
  const s = Object.assign(Object.create(Sessions.prototype), { deltas: new Map(), running: new Map(), emit: (event, payload) => sent.push([event, payload]) });
  for (let i = 0; i < 40; i++) s.onLiveEvent('x', { type: 'delta', text: `t${i} ` });
  assert.equal(sent.length, 0, 'aún nada: se agrupan');
  s.onLiveEvent('x', { type: 'context', used: 1, size: 0 }); // any other event sends what was pending first
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ['session:delta', { id: 'x', text: Array.from({ length: 40 }, (_, i) => `t${i} `).join('') }]);
  s.onLiveEvent('x', { type: 'delta', text: 'fin' });
  await wait(120);
  assert.deepEqual(sent.at(-1), ['session:delta', { id: 'x', text: 'fin' }], 'y si no pasa nada más, a los 50 ms');
});
