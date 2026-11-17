// Subagents as children of their chat: how Claude's task messages become results, the state the list shows, and Stop / Background
// (only that subagent, only when the agent can; otherwise an honest refusal).
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { subagentTask } from '../src/agents/claude.mjs';
import { toBlocks, subagentState } from '../src/ui/lib/session-blocks.js';
import { tr } from '../src/platform/context.mjs';

let t; let board; let sessions;
before(() => { t = tempHome(); board = new Board(); sessions = new Sessions(board, { emit: () => {} }); });
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const call = (id, agent) => ({ id: 1, kind: 'tool', body: { id, name: 'Agent', input: '', agent: { name: agent, description: 'look', model: null } } });
const result = (id, body) => ({ id: 2, kind: 'tool_result', body: { id, ...body } });
const states = (items) => toBlocks(items, (k) => k).filter((b) => b.type === 'subagent').map(subagentState);

test('a stopped, failed or backgrounded subagent ends as its call result; a plain completed one adds nothing', () => {
  const tasks = new Map(); const bg = new Set();
  assert.equal(subagentTask({ type: 'system', subtype: 'task_started', tool_use_id: 'a', task_id: 't1', task_type: 'local_agent' }, tasks, bg), null);
  assert.equal(tasks.get('a'), 't1');
  assert.equal(subagentTask({ type: 'system', subtype: 'task_notification', tool_use_id: 'a', status: 'completed', summary: 'x' }, tasks, bg), null);
  tasks.set('b', 't2');
  const stopped = subagentTask({ type: 'system', subtype: 'task_notification', tool_use_id: 'b', status: 'stopped', summary: 'x' }, tasks, bg);
  assert.deepEqual([stopped.body.id, stopped.body.status, stopped.body.done], ['b', 'stopped', true]);
  tasks.set('c', 't3'); bg.add('c');
  assert.ok(subagentTask({ type: 'system', subtype: 'task_notification', tool_use_id: 'c', status: 'completed', summary: 'done' }, tasks, bg), 'a backgrounded one reports its end');
  assert.equal(subagentTask({ type: 'system', subtype: 'task_started', tool_use_id: 'd', task_id: 't4', task_type: 'local_bash' }, tasks, bg), null);
  assert.equal(tasks.has('d'), false, 'a shell task is not a subagent');
});

test('the list states: running, a backgrounded one stays running until its end, stopped, done', () => {
  assert.deepEqual(states([call('a', 'x')]), ['running']);
  assert.deepEqual(states([call('a', 'x'), result('a', { output: '', background: true }), result('a', { output: 'running in the background' })]), ['running']);
  assert.deepEqual(states([call('a', 'x'), result('a', { background: true }), result('a', { output: 'ok', done: true, status: 'completed' })]), ['done']);
  assert.deepEqual(states([call('a', 'x'), result('a', { output: 's', status: 'stopped', error: false, done: true })]), ['stopped']);
  assert.deepEqual(states([call('a', 'x'), result('a', { output: 'fine' })]), ['done']);
});

test('Stop and Background reach only that subagent; an agent that cannot says so and the turn stays', async () => {
  const s = sessions.create({ kind: 'chat', agent: 'claude', permission: 'leer', title: 'x', cwd: t.home });
  const calls = [];
  const live = { stopSubagent: async (id) => { calls.push(['stop', id]); return id === 'a'; }, backgroundSubagent: async (id) => { calls.push(['bg', id]); return true; }, caps: {}, close() {}, isClosed: () => false };
  sessions.lives.set(s.id, { live, lastUsed: Date.now(), key: 'k' });
  await assert.rejects(() => sessions.subagent(s.id, 'a', 'background'), (e) => e.message === tr('msg.subagent.noBackground'), 'no running turn: nothing to background');
  sessions.running.set(s.id, { agent: 'claude', live });
  assert.deepEqual(await sessions.subagent(s.id, 'a', 'stop'), { ok: true });
  await assert.rejects(() => sessions.subagent(s.id, 'zzz', 'stop'), (e) => e.message === tr('msg.subagent.notRunning'));
  assert.deepEqual(await sessions.subagent(s.id, 'a', 'background'), { ok: true });
  assert.deepEqual(calls, [['stop', 'a'], ['stop', 'zzz'], ['bg', 'a']]);
  sessions.lives.set(s.id, { live: { caps: {}, close() {}, isClosed: () => false }, lastUsed: Date.now(), key: 'k' }); // Codex-like: no control per subagent
  await assert.rejects(() => sessions.subagent(s.id, 'a', 'stop'), (e) => e.message === tr('msg.subagent.noStop'));
  sessions.running.delete(s.id);
});
