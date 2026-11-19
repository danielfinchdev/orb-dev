// The assistant's queue (messages written while it works) seen and edited from a phone: chat.queue / chat.editQueued.
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { REMOTE_METHODS, DESKTOP } from '../src/domain/security/permissions.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { recordUserCall } from '../src/domain/activity/record.mjs';
import { userLogFile } from '../src/domain/activity/user-log.mjs';
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

// ---- what a removed or edited message was carrying ----
const taskMention = (board, title) => { createProject(board, { name: `p${title}` }, 'usuario'); const task = board.createTask({ project: `p${title}`, title, description: `encargo ${title}`, agent: 'claude' }, 'usuario'); return `@tarea:${task.id}`; };

test('two messages merged into one turn read exactly as before', async () => {
  const { o, call } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation }); o.ask('tercero', '', { conversation });
  o.turns[0].resolve(); await tick(); await tick();
  assert.match(o.turns[1].text, /^\(Mensaje nuevo de [^)]*\)\nsegundo\n\ntercero$/);
  assert.equal((await call('chat.queue', { conversation })).length, 0);
});

test('removing a message that owed a system notice gives it to the next one waiting', async () => {
  const { o, board, call } = setup();
  const conversation = start(o);
  board.settingJson(`orch_note:${conversation}`, ['La tarea 1 se deshizo.']);
  o.ask('vale', '', { conversation }); o.ask('otro', '', { conversation });
  assert.equal(board.settingJson(`orch_note:${conversation}`), null, 'the first message took it');
  const [a] = await call('chat.queue', { conversation });
  await call('chat.editQueued', { conversation, queueId: a.id, remove: true });
  o.turns[0].resolve(); await tick(); await tick();
  assert.match(o.turns[1].text, /otro[\s\S]*AVISO DEL SISTEMA[\s\S]*La tarea 1 se deshizo\./);
  assert.equal((o.turns[1].text.match(/se deshizo/g) ?? []).length, 1);
});

test('removing the only message that owed a notice leaves it owed to the next message that comes', async () => {
  const { o, board, call } = setup();
  const conversation = start(o);
  board.settingJson(`orch_note:${conversation}`, ['La tarea 1 se deshizo.']);
  o.ask('vale', '', { conversation });
  const [a] = await call('chat.queue', { conversation });
  await call('chat.editQueued', { conversation, queueId: a.id, remove: true });
  assert.deepEqual(board.settingJson(`orch_note:${conversation}`), ['La tarea 1 se deshizo.']);
  o.ask('luego', '', { conversation });
  o.turns[0].resolve(); await tick(); await tick();
  assert.match(o.turns[1].text, /luego[\s\S]*La tarea 1 se deshizo\./);
});

test('the Pizarra notice a removed message carried comes back', async () => {
  const { o, board, call } = setup();
  const project = createProject(board, { name: 'pizarra' }, 'usuario');
  const conversation = start(o);
  board.updateConversation(conversation, { project: 'pizarra', session_id: 's1' });
  fs.mkdirSync(path.join(project.path, 'pizarra'), { recursive: true });
  fs.writeFileSync(path.join(project.path, 'pizarra', 'PIZARRA.md'), 'dibujo');
  const key = `wb_seen:pizarra:${conversation}`;
  o.ask('vale', '', { conversation });
  assert.ok(Number(board.setting(key)) > 0, 'the notice was consumed');
  const [a] = await call('chat.queue', { conversation });
  await call('chat.editQueued', { conversation, queueId: a.id, remove: true });
  assert.equal(Number(board.setting(key) ?? 0), 0, 'owed again');
  o.ask('luego', '', { conversation });
  o.turns[0].resolve(); await tick(); await tick();
  assert.match(o.turns[1].text, /luego[\s\S]*cambiado la pizarra/);
});

test('editing re-expands the mentions of the new text; notices stay', async () => {
  const { o, board, call } = setup();
  const one = taskMention(board, 'uno'); const two = taskMention(board, 'dos');
  const conversation = start(o);
  board.settingJson(`orch_note:${conversation}`, ['Aviso fijo.']);
  await call('chat.send', { conversation, text: `mira ${one}` });
  const [a] = await call('chat.queue', { conversation });
  await call('chat.editQueued', { conversation, queueId: a.id, text: 'mira' });
  await call('chat.editQueued', { conversation, queueId: a.id, text: `mira ${two}` });
  o.turns[0].resolve(); await tick(); await tick();
  assert.doesNotMatch(o.turns[1].text, /encargo uno/, 'the removed mention is gone');
  assert.match(o.turns[1].text, /encargo dos/, 'the added one is expanded');
  assert.match(o.turns[1].text, /Aviso fijo\./, 'the notice stays');
});

test('the answer to a question card is not listed, edited or removed', async () => {
  const { o, call } = setup();
  const conversation = start(o);
  o.ask('Mi respuesta: A', '', { conversation, meta: { answer: true, own: '' } });
  o.ask('normal', '', { conversation });
  const listed = await call('chat.queue', { conversation });
  assert.deepEqual(listed.map((q) => q.text), ['normal']);
  const answerId = o.lanes.get(conversation).queue[0].parts[0].id;
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: answerId, text: 'otra' }), /respuesta a una pregunta/);
  await assert.rejects(() => call('chat.editQueued', { conversation, queueId: answerId, remove: true }), /respuesta a una pregunta/);
  o.turns[0].resolve(); await tick(); await tick();
  assert.match(o.turns[1].text, /Mi respuesta: A/);
});

test('a waiting message cannot be edited into /clear or /compact', async () => {
  const { o, call } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation });
  const [a] = await call('chat.queue', { conversation });
  for (const text of ['/clear', ' /compact ']) await assert.rejects(() => call('chat.editQueued', { conversation, queueId: a.id, text }), /comando/);
  assert.equal((await call('chat.queue', { conversation }))[0].text, 'segundo');
  assert.equal((await call('chat.editQueued', { conversation, queueId: a.id, text: '/clearing' }))[0].text, '/clearing');
});

test('editing keeps the pictures; removing deletes only the files of that message', async () => {
  const { o, board, call } = setup();
  const conversation = start(o);
  const mk = (n) => { const f = path.join(home.home, n); fs.writeFileSync(f, Buffer.from([137, 80, 78, 71])); return f; };
  o.ask('con foto', '', { conversation, attachments: [mk('a.png')] });
  o.ask('con otra', '', { conversation, attachments: [mk('b.png')] });
  const [a] = await call('chat.queue', { conversation });
  const parts = o.lanes.get(conversation).queue[0].parts;
  const [pa, pb] = parts.map((p) => p.attachments.map((f) => f.path));
  assert.ok(pa.length === 1 && pb.length === 1 && fs.existsSync(pa[0]) && fs.existsSync(pb[0]));
  await call('chat.editQueued', { conversation, queueId: a.id, text: 'con foto editada' });
  const line = board.chat(conversation).find((m) => m.body === 'con foto editada');
  assert.deepEqual(line.meta.images, pa, 'meta.images stays');
  assert.equal(o.lanes.get(conversation).queue[0].attachments.length, 2, 'the brain still gets both pictures');
  await call('chat.editQueued', { conversation, queueId: a.id, remove: true });
  assert.ok(!fs.existsSync(pa[0]), 'its picture is deleted');
  assert.ok(fs.existsSync(pb[0]), 'the other one stays');
});

test('taking back the first message of a new conversation retires the empty conversation', async () => {
  const { o, board, call } = setup();
  const c = o.startConversation({ text: 'nueva' });
  Object.defineProperty(o, 'maxBusy', { value: 0 }); // the assistant is at its limit of parallel conversations: the message waits
  o.ask('nueva', '', { conversation: c.id });
  const [a] = await call('chat.queue', { conversation: c.id });
  await call('chat.editQueued', { conversation: c.id, queueId: a.id, remove: true });
  assert.ok(!board.conversation(c.id));
  // a conversation with history stays
  const keep = start(o);
  o.ask('segundo', '', { conversation: keep });
  const [b] = await call('chat.queue', { conversation: keep });
  await call('chat.editQueued', { conversation: keep, queueId: b.id, remove: true });
  assert.ok(board.conversation(keep));
});

test('the activity log writes the edit with the phone mark', () => {
  const { board } = setup();
  recordUserCall({ board, method: 'chat.editQueued', params: { conversation: 1, queueId: 'x', text: 'nuevo texto' }, principal: { channel: 'mobile' } });
  recordUserCall({ board, method: 'chat.editQueued', params: { conversation: 1, queueId: 'x', remove: true }, principal: DESKTOP });
  const rows = fs.readFileSync(userLogFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.match(rows.at(-2).text, /^\[movil\] edited a queued message: nuevo texto$/);
  assert.equal(rows.at(-1).text, 'removed a queued message');
});

test('editQueued with expect: equal goes through, different is refused untouched, absent is as before', async () => {
  const { o, call } = setup();
  const conversation = start(o);
  o.ask('segundo', '', { conversation });
  const [a] = await call('chat.queue', { conversation });
  await assert.rejects(call('chat.editQueued', { conversation, queueId: a.id, text: 'nuevo', expect: 'otro' }), /ha cambiado/);
  await assert.rejects(call('chat.editQueued', { conversation, queueId: a.id, remove: true, expect: 'otro' }), /ha cambiado/);
  assert.deepEqual((await call('chat.queue', { conversation })).map((q) => q.text), ['segundo']);
  await call('chat.editQueued', { conversation, queueId: a.id, text: 'nuevo', expect: 'segundo' });
  assert.deepEqual((await call('chat.queue', { conversation })).map((q) => q.text), ['nuevo']);
  assert.deepEqual(await call('chat.editQueued', { conversation, queueId: a.id, remove: true }), []);
});
