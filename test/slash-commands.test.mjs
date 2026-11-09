// 3.8.2: «/clear» and «/compact» typed alone in a chat are Orb's commands (src/shared/slash.mjs); anything else is a
// message for the agent as before.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { DESKTOP } from '../src/core/permissions.mjs';
import { slashCommand } from '../src/shared/slash.mjs';

let t; let board; let api; let sessions;
const call = (method, params = {}) => api.call(method, params, DESKTOP);

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('only the bare commands are Orb\'s', () => {
  assert.equal(slashCommand('/clear'), 'clear'); assert.equal(slashCommand('  /Compact \n'), 'compact');
  for (const text of ['/compact keep the plan', '/clears', 'please /clear', '/goal', '/', '', null]) assert.equal(slashCommand(text), null, String(text));
});

test('/clear in a direct chat: a new agent conversation in the same chat, the history kept', async () => {
  const s = await call('sessions.create', { agent: 'claude', permission: 'leer', title: 'Direct' });
  sessions.update(s.id, { cli_session: 'abc', context: JSON.stringify({ used: 10, size: 100 }) });
  sessions.addItem(s.id, 'user', 'text', 'earlier message');
  assert.deepEqual(await call('sessions.send', { id: s.id, text: '/clear' }), { ok: true });
  const now = sessions.get(s.id);
  assert.equal(now.cli_session, null); assert.equal(now.context, null); assert.equal(now.title, 'Direct', 'not renamed after the command');
  const items = sessions.items(s.id);
  assert.ok(items.some((i) => i.body === 'earlier message'), 'the history stays');
  assert.ok(!items.some((i) => i.role === 'user' && i.body === '/clear'), 'the command is not sent as a message');
  assert.equal(items.at(-1).kind, 'status');
  // /compact without an agent conversation yet: nothing to compact (the «Compactar» button's answer).
  assert.deepEqual(await call('sessions.send', { id: s.id, text: '/compact' }), { ok: true, how: 'none' });
});

test('/clear and /compact in a chat with the assistant', async () => {
  const c = board.createConversation({ title: 'Assistant chat' });
  board.updateConversation(c.id, { session_id: 'xyz', turns: 4 });
  assert.deepEqual(await call('chat.send', { text: '/clear', conversation: c.id }), { ok: true });
  assert.equal(board.conversation(c.id).session_id, null); assert.equal(board.conversation(c.id).turns, 0);
  assert.ok(!board.all('SELECT body FROM chat WHERE conversation_id = ?', c.id).some((r) => r.body === '/clear'));
  assert.deepEqual(await call('chat.send', { text: '/compact', conversation: c.id }), { ok: true, how: 'none' });
});
