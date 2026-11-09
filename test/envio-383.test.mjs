// 3.8.3: sending to the assistant feels instant. chat.send replies before the agent's process starts (it used to start
// it, read the logs and write the briefing first, delaying the first streamed text), and the message being answered is
// never shown as «1 en cola».
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';

const home = tempHome();
after(() => home.cleanup());
const tick = () => new Promise((r) => setImmediate(r));

// An assistant whose process start is recorded (and answers at once).
function assistant(board, order, states) {
  const o = new Orchestrator(board, { emit: (event, payload) => { if (event === 'chat:state') states.push(payload); } });
  const make = o.lane.bind(o);
  o.lane = (id) => {
    const l = make(id);
    l.ensureLive = () => {
      order.push('process');
      l.liveAgent = 'claude';
      l.live ??= { send: async ({ text }) => { order.push(`turn:${text.split('\n').pop()}`); return { text: 'hecho', final: 'hecho' }; }, isClosed: () => false, close() {}, interrupt() {} };
    };
    return l;
  };
  return o;
}

test('chat.send replies first; the process starts right after, and the turns keep their order', async () => {
  const board = new Board(); const order = []; const states = [];
  const o = assistant(board, order, states);
  const { conversation } = o.ask('uno');
  order.push('reply');
  assert.deepEqual(order, ['reply'], 'nothing of the agent ran before the reply');
  assert.equal(o.state(conversation).busy, true, 'the window already hears that it is answering');
  o.ask('dos', '', { conversation });
  order.push('reply 2');
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(order.filter((x) => x !== 'process'), ['reply', 'reply 2', 'turn:uno', 'turn:dos']);
  assert.ok(order.indexOf('process') > order.indexOf('reply 2'));
  assert.deepEqual(board.chat(conversation).filter((m) => m.role === 'usuario').map((m) => m.body), ['uno', 'dos']);
});

test('the message being answered is never «en cola» (no busy state with it still queued)', async () => {
  const board = new Board(); const order = []; const states = [];
  const o = assistant(board, order, states);
  const { conversation } = o.ask('hola');
  for (let i = 0; i < 5; i++) await tick();
  const busy = states.filter((s) => s.conversation === conversation && s.busy);
  assert.ok(busy.length, 'it answered');
  assert.deepEqual(busy.filter((s) => s.queued > 0), [], 'never «1 en cola» for itself');
});

test('a turn stopped before its process started does not start it', async () => {
  const board = new Board(); const order = []; const states = [];
  const o = assistant(board, order, states);
  const { conversation } = o.ask('para');
  o.stop(conversation);
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(order, [], 'no process, no turn');
  assert.equal(o.state(conversation).busy, false);
});

