// The assistant's queue (messages written while it works) seen and edited from a phone: chat.queue / chat.editQueued.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { REMOTE_METHODS, DESKTOP } from '../src/domain/security/permissions.mjs';
import { guardCall } from '../src/engine/transport/remote-calls.mjs';

const home = tempHome({ permissions: { mode: 'preguntar' } });
after(() => home.cleanup());
const tick = () => new Promise((r) => setImmediate(r));

// An assistant whose turns are held until the test lets them finish.
function setup() {
  const board = new Board();
  const events = [];
  const o = new Orchestrator(board, { emit: (event, payload) => events.push({ event, payload }) });
  o.turns = [];
  const make = o.lane.bind(o);
  o.lane = (id) => {
    const l = make(id);
    if (!l.held) {
      l.held = true;
      l.live = { steer: () => true, interrupt: () => {}, close: () => {}, isClosed: () => false };
      l.run = (text) => new Promise((resolve) => o.turns.push({ text, resolve: () => { l.busy = false; resolve({ ok: true }); } }));
    }
    return l;
  };
  const api = buildApi({ board, sessions: {}, orchestrator: o, scheduler: {}, emit: (e, p) => events.push({ event: e, payload: p }), log: () => {}, version: 'test' });
  const call = (method, params) => api.call(method, params, DESKTOP);
  return { board, o, call, events };
}
const start = (o) => o.ask('primero').conversation; // the first message runs; what follows waits

test('the queue lists waiting messages in order, with a stable id, the text and the time', async () => {
  const { o, call } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation });
  o.ask('tercero', '', { conversation });
  const list = await await call('chat.queue', { conversation });
  assert.deepEqual(list.map((q) => q.text), ['segundo', 'tercero'], 'the one running is not in the queue');
  assert.ok(list.every((q) => typeof q.id === 'string' && q.id && Number.isFinite(q.at)));
  assert.notEqual(list[0].id, list[1].id);
  assert.deepEqual(await call('chat.queue', { conversation }), list, 'the ids stay the same between reads');
  assert.deepEqual(await call('chat.queue', { conversation: o.ask('otro chat').conversation }), []);
});

test('editing changes the text for the brain and the chat line, and keeps the order', async () => {
  const { o, board, call, events } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation }); o.ask('tercero', '', { conversation });
  const [a, b] = await call('chat.queue', { conversation });
  events.length = 0;
  const left = await call('chat.editQueued', { conversation, queueId: a.id, text: '  segundo corregido ' });
  assert.deepEqual(left.map((q) => [q.id, q.text]), [[a.id, 'segundo corregido'], [b.id, 'tercero']]);
  assert.ok(events.some((e) => e.event === 'chat:state' && e.payload.conversation === conversation && e.payload.queued === 1), 'chat:state is emitted');
  assert.ok(board.chat(conversation).some((m) => m.role === 'usuario' && m.body === 'segundo corregido'), 'the chat line follows');
  assert.ok(!board.chat(conversation).some((m) => m.body === 'segundo'));
  o.turns[0].resolve(); await tick(); await tick();
  assert.match(o.turns[1].text, /segundo corregido[\s\S]*tercero/);
  assert.doesNotMatch(o.turns[1].text, /segundo\n/);
});

test('removing drops one message (and its chat line); the rest still go together', async () => {
  const { o, board, call, events } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation }); o.ask('tercero', '', { conversation });
  const [a, b] = await call('chat.queue', { conversation });
  events.length = 0;
  assert.deepEqual((await call('chat.editQueued', { conversation, queueId: a.id, remove: true })).map((q) => q.text), ['tercero']);
  assert.ok(events.some((e) => e.event === 'chat:state'));
  assert.ok(!board.chat(conversation).some((m) => m.body === 'segundo'));
  assert.deepEqual(await call('chat.editQueued', { conversation, queueId: b.id, remove: true }), []);
  assert.equal(o.state(conversation).queued, 0);
  o.turns[0].resolve(); await tick(); await tick();
  assert.equal(o.turns.length, 1, 'nothing is left to answer');
});

test('a message that already started cannot be touched; neither can an unknown one', async () => {
  const { o, call } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation });
  const [a] = await call('chat.queue', { conversation });
  o.turns[0].resolve(); await tick(); await tick();
  assert.equal(o.turns.length, 2, 'the second started');
  assert.deepEqual(await call('chat.queue', { conversation }), []);
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: a.id, text: 'tarde' }), /ya no está en la cola/);
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: a.id, remove: true }), /ya no está en la cola/);
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: 'nope', remove: true }), /ya no está en la cola/);
});

test('same checks as chat.send: empty or huge text, missing and trashed conversations', async () => {
  const { o, board, call } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation });
  const [a] = await call('chat.queue', { conversation });
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: a.id, text: '   ' }));
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: a.id, text: 'x'.repeat(20001) }));
  assert.equal((await call('chat.queue', { conversation }))[0].text, 'segundo', 'nothing changed');
  await assert.rejects(() => call('chat.queue', { conversation: 9999 }));
  await assert.rejects(() => call('chat.editQueued', { conversation: 9999, queueId: a.id, remove: true }));
  board.run('UPDATE conversations SET trashed_at = ? WHERE id = ?', new Date().toISOString(), conversation);
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: a.id, remove: true }), /papelera/i);
  assert.equal((await call('chat.queue', { conversation }))[0].text, 'segundo', 'still queued');
});

test('the phone may call both methods, and the guard treats them as chat.send', async () => {
  assert.ok(REMOTE_METHODS.has('chat.queue') && REMOTE_METHODS.has('chat.editQueued'));
  const { board } = setup();
  for (const m of ['chat.send', 'chat.queue', 'chat.editQueued']) assert.equal(guardCall(board, m, { conversation: 1 }), null);
  assert.ok(guardCall(board, 'chat.editQueued', { conversation: 1 }, { allowed: new Set(['chat.send']) }));
});
