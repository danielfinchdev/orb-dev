// «/side»: a question apart. Never written into the chat, never above the chat's permission («leer», no Orb tools, permission
// requests denied), refused for agents that cannot keep «Solo lectura», and it expires.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { modeCommand } from '../src/shared/slash.mjs';
import { SIDE_DENIED, SIDE_TTL_MS } from '../src/engine/side.mjs';

let t; let board; let api; let sessions; let events; let made; let answer;
const call = (method, params = {}) => api.call(method, params, DESKTOP);

before(() => {
  t = tempHome(); board = new Board(); events = [];
  const emit = (event, payload) => events.push([event, payload]);
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  made = [];
  sessions.side.make = (agent, o) => {
    const live = { closed: false, prompts: [], isClosed() { return this.closed; }, close() { this.closed = true; }, respond(id, d) { this.responded = [id, d]; },
      async send({ text }) { this.prompts.push(text); o.onEvent({ type: 'approval', request: { id: 'r1' } }); return { final: answer(text), text: '', isError: false, usage: {} }; } };
    made.push({ agent, o, live });
    return live;
  };
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const itemsOf = (id) => board.all('SELECT COUNT(*) AS n FROM session_items WHERE session_id = ?', id)[0].n;
const chat = (permission, agent = 'claude') => call('sessions.create', { agent, permission, title: 'Lateral' });

test('«/side» is a command with text, answered apart: nothing is written in the chat, and it has no more than «Solo lectura»', async () => {
  assert.deepEqual(modeCommand('/side qué hace esto'), { name: 'side', args: 'qué hace esto' });
  answer = () => 'una respuesta';
  const s = await chat('leer');
  sessions.update(s.id, { permission: 'total' }); // the chat holds full access, granted elsewhere
  sessions.addItem(s.id, 'user', 'text', 'haz la portada');
  sessions.addItem(s.id, 'assistant', 'text', 'hecha la portada');
  const before = itemsOf(s.id);
  const out = await call('sessions.send', { id: s.id, text: '/side qué framework usa' });
  assert.equal(out.ok, true); assert.equal(out.side.status, 'running');
  const side = await until(async () => (await call('sessions.sides', { id: s.id })).find((x) => x.status === 'done'), 'respuesta lateral');
  assert.equal(side.turns[0].a, 'una respuesta');
  assert.equal(itemsOf(s.id), before, 'nothing of the side chat reaches the conversation');
  assert.equal(sessions.running.has(s.id), false, 'the chat itself was not running');
  const m = made.at(-1);
  assert.equal(m.o.permission, 'leer', 'a chat with full access gives its side chat «Solo lectura»');
  assert.deepEqual(m.o.mcpServers, {}, 'no Orb tools');
  assert.deepEqual(m.o.tools.disallowed, SIDE_DENIED);
  for (const w of ['Bash', 'Edit', 'Write']) assert.ok(m.o.tools.disallowed.includes(w));
  assert.deepEqual(m.live.responded, ['r1', 'deny'], 'a permission request is denied');
  assert.match(m.live.prompts[0], /haz la portada/, 'it is told what the chat said');
  assert.ok(events.some(([e, p]) => e === 'session:side' && p.id === s.id));
});

test('a follow-up goes to the same side chat; closing it ends its agent', async () => {
  answer = (text) => (text.includes('segunda') ? 'dos' : 'uno');
  const s = await chat('leer');
  const first = (await call('sessions.sideAsk', { id: s.id, text: 'primera' }));
  await until(async () => (await call('sessions.sides', { id: s.id }))[0]?.status === 'done', 'primera');
  await call('sessions.sideAsk', { id: s.id, side: first.id, text: 'segunda' });
  const side = await until(async () => { const l = (await call('sessions.sides', { id: s.id }))[0]; return l?.status === 'done' && l.turns.length === 2 && l; }, 'segunda');
  assert.deepEqual(side.turns.map((x) => x.a), ['uno', 'dos']);
  const live = made.at(-1).live;
  assert.equal(live.prompts.length, 2); assert.doesNotMatch(live.prompts[1], /<chat>/, 'the chat context goes only with the first question');
  await call('sessions.sideClose', { side: first.id });
  assert.equal(live.closed, true); assert.deepEqual(await call('sessions.sides', { id: s.id }), []);
  await assert.rejects(() => call('sessions.sideAsk', { id: s.id, side: first.id, text: 'x' }));
});

test('it expires by itself after a quiet while, and goes with its chat', async () => {
  answer = () => 'ok';
  const s = await chat('leer');
  const side = await call('sessions.sideAsk', { id: s.id, text: 'hola' });
  await until(async () => (await call('sessions.sides', { id: s.id }))[0]?.status === 'done', 'respuesta');
  const live = made.at(-1).live;
  sessions.side.sweep(); assert.equal((await call('sessions.sides', { id: s.id })).length, 1, 'not yet');
  sessions.side.map.get(side.id).expiresAt = Date.now() - 1; sessions.side.sweep();
  assert.equal(live.closed, true); assert.equal((await call('sessions.sides', { id: s.id })).length, 0);
  assert.ok(SIDE_TTL_MS > 0);
  const two = await call('sessions.sideAsk', { id: s.id, text: 'otra' });
  await until(async () => (await call('sessions.sides', { id: s.id }))[0]?.status === 'done', 'otra');
  await call('sessions.remove', { id: s.id });
  assert.equal(sessions.side.map.has(two.id), false, 'removing the chat closes its side chats');
});

test('an agent that cannot keep «Solo lectura» gets no side chat, and a chat has at most three', async () => {
  answer = () => 'ok';
  const pi = await chat('total', 'pi').catch(() => null);
  if (pi) await assert.rejects(() => call('sessions.sideAsk', { id: pi.id, text: 'x' }));
  const s = await chat('leer');
  for (let i = 0; i < 3; i++) await call('sessions.sideAsk', { id: s.id, text: `q${i}` });
  await assert.rejects(() => call('sessions.sideAsk', { id: s.id, text: 'cuarta' }), /3/);
});

test('a phone cannot start a side question: sideAsk is PC-only and «/side» typed from a phone is refused', async () => {
  const { METHODS, principalOf } = await import('../src/domain/security/permissions.mjs');
  const fs = await import('node:fs');
  assert.equal(METHODS['sessions.sideAsk'], 'pc');
  const s = await chat('leer');
  const phone = principalOf({ device: { id: 'd', kind: 'phone' } });
  await assert.rejects(() => api.call('sessions.send', { id: s.id, text: '/side hola' }, phone), /PC/);
  assert.equal((await call('sessions.sides', { id: s.id })).length, 0);
  // the phone's web reloads a chat's list when an edit moves its messages
  assert.match(fs.readFileSync(new URL('../src/engine/transport/remote.mjs', import.meta.url), 'utf8'), /'session:reset'/);
});
