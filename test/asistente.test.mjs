// 2.6: the engine's notices the assistant still owes (the report of finished tasks, a failed task…) survive closing the
// app: they are saved when queued, the one being answered when the app closes stays, and they come back at the next start.
// 3.2: each conversation has its own queue; several are answered at once, up to the limit.
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
  const make = o.lane.bind(o);
  o.lane = (id) => {
    const l = make(id);
    // Like the real turn, the end of the answer frees the conversation.
    if (!l.held) { l.held = true; l.run = (text) => new Promise((resolve) => o.turns.push({ text, conversation: l.id, resolve: () => { l.busy = false; resolve(); } })); }
    return l;
  };
  return o;
}
const tick = () => new Promise((r) => setImmediate(r));

test('los avisos pendientes del asistente no se pierden al cerrar la app', async () => {
  const board = new Board();
  const c = board.createConversation({ title: 'Web' });
  let o = assistant(board);
  o.internal('AVISO 1', null, { kind: 'report' }, { conversation: c.id });
  o.internal('AVISO 2', null, null, { conversation: c.id });
  assert.equal(o.turns.length, 1, 'en una conversación contesta de uno en uno');
  assert.equal(board.settingJson('orchestrator_pending').length, 2, 'los dos quedan guardados');
  assert.ok(board.settingJson('orchestrator_pending').every((q) => q.conversation === c.id), 'cada uno con su conversación');
  // The app closes while the first is being answered.
  o.closing = true; o.stopAll(); o.turns[0].resolve(); await tick();
  assert.deepEqual(board.settingJson('orchestrator_pending').map((q) => q.text), ['AVISO 1', 'AVISO 2'], 'el que se contestaba sigue pendiente');

  o = assistant(board);
  assert.equal(o.resume(), 2);
  assert.equal(o.turns[0].text, 'AVISO 1');
  assert.equal(o.turns[0].conversation, c.id, 'vuelve a su conversación');
  o.turns[0].resolve(); await tick(); await tick();
  assert.deepEqual(board.settingJson('orchestrator_pending').map((q) => q.text), ['AVISO 2']);
  assert.equal(o.turns[1].text, 'AVISO 2');
  o.turns[1].resolve(); await tick(); await tick();
  assert.equal(board.settingJson('orchestrator_pending'), null, 'contestados todos, no queda nada');
  assert.equal(assistant(board).resume(), 0);
});

test('detener una conversación no pierde sus avisos pendientes; al volver a abrir no se contesta dos veces el que está en curso', async () => {
  const board = new Board();
  const c = board.createConversation({ title: 'Otra' });
  const o = assistant(board);
  o.internal('AVISO A', null, null, { conversation: c.id });
  o.internal('AVISO B', null, null, { conversation: c.id });
  o.stop(c.id);
  assert.deepEqual(board.settingJson('orchestrator_pending').map((q) => q.text), ['AVISO A', 'AVISO B']);
  assert.ok(o.lane(c.id).queue.some((q) => q.text === 'AVISO B'), 'el que esperaba sigue en la cola');
  // A notice already being answered when resume() runs is not queued again.
  const p = assistant(board);
  p.internal('AVISO C', null, null, { conversation: c.id });
  p.resume();
  assert.equal(p.lane(c.id).queue.filter((q) => q.text === 'AVISO C').length, 0, 'el que se está contestando no se repite');
});

test('3.2: varias conversaciones se contestan a la vez, hasta el límite; las demás esperan su turno', async () => {
  const board = new Board();
  const o = assistant(board);
  const ids = [1, 2, 3, 4].map((n) => o.ask(`Pedido ${n}`).conversation);
  assert.equal(new Set(ids).size, 4, 'cada mensaje sin conversación empieza una nueva');
  assert.equal(o.turns.length, 3, 'tres a la vez (el límite por defecto)');
  assert.equal(o.state(ids[3]).waiting, true, 'la cuarta espera su turno');
  o.turns[0].resolve(); await tick(); await tick();
  assert.equal(o.turns.length, 4, 'al acabar una, entra la que esperaba');
  assert.equal(o.turns[3].conversation, ids[3]);
  // A message to an existing conversation goes there, and its title comes from the first message.
  assert.equal(board.conversation(ids[1]).title, 'Pedido 2');
  o.ask('Y otra cosa', '', { conversation: ids[1] });
  assert.equal(board.chat(ids[1]).filter((m) => m.role === 'usuario').length, 2);
  assert.equal(board.chat(ids[0]).filter((m) => m.role === 'usuario').length, 1, 'no se mezcla con las demás');
});
