// 2.6: the engine's notices the assistant still owes (the report of finished tasks, a failed task…) survive closing the
// app: they are saved when queued, the one being answered when the app closes stays, and they come back at the next start.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';

const t = tempHome();
after(() => t.cleanup());

// An assistant whose turns are held until the test lets them finish.
function assistant(board) {
  const o = new Orchestrator(board, 'clave');
  o.turns = [];
  // Like the real turn, the end of the answer frees the chat.
  o.run = (text) => new Promise((resolve) => o.turns.push({ text, resolve: () => { o.busy = false; resolve(); } }));
  return o;
}
const tick = () => new Promise((r) => setImmediate(r));

test('los avisos pendientes del asistente no se pierden al cerrar la app', async () => {
  const board = new Board();
  let o = assistant(board);
  o.internal('AVISO 1', null, { kind: 'report' });
  o.internal('AVISO 2', null);
  assert.equal(o.turns.length, 1, 'contesta de uno en uno');
  assert.equal(board.settingJson('orchestrator_pending').length, 2, 'los dos quedan guardados');
  // The app closes while the first is being answered.
  o.closing = true; o.stop(); o.turns[0].resolve(); await tick();
  assert.deepEqual(board.settingJson('orchestrator_pending').map((q) => q.text), ['AVISO 1', 'AVISO 2'], 'el que se contestaba sigue pendiente');

  o = assistant(board);
  assert.equal(o.resume(), 2);
  assert.equal(o.turns[0].text, 'AVISO 1');
  o.turns[0].resolve(); await tick(); await tick();
  assert.deepEqual(board.settingJson('orchestrator_pending').map((q) => q.text), ['AVISO 2']);
  assert.equal(o.turns[1].text, 'AVISO 2');
  o.turns[1].resolve(); await tick(); await tick();
  assert.equal(board.settingJson('orchestrator_pending'), null, 'contestados todos, no queda nada');
  assert.equal(assistant(board).resume(), 0);
});

test('una conversación nueva no pierde los avisos pendientes; al volver a abrir no se contesta dos veces el que está en curso', async () => {
  const board = new Board();
  const o = assistant(board);
  o.internal('AVISO A', null);
  o.internal('AVISO B', null);
  o.reset(); // «Nuevo chat»
  assert.deepEqual(board.settingJson('orchestrator_pending').map((q) => q.text), ['AVISO A', 'AVISO B']);
  assert.ok(o.queue.some((q) => q.text === 'AVISO B'), 'el que esperaba sigue en la cola');
  // A notice already being answered when resume() runs is not queued again.
  const p = assistant(board);
  p.internal('AVISO C', null);
  p.resume();
  assert.equal(p.queue.filter((q) => q.text === 'AVISO C').length, 0, 'el que se está contestando no se repite');
});
