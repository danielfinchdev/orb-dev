// 3.8.8: a queued task says why it waits in a form the phone can draw: «otra tarea escribe en esta carpeta» (by: the
// holder's id) and «la cuenta está al límite» (account, until, percent next to the text it always had).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { recordRate, rankAccounts } from '../src/domain/usage/budget.mjs';

const home = tempHome({ maxParallel: 5, perAgent: 5, oneAtATime: false });
after(() => home.cleanup());

// A scheduler whose launch only marks the task running (no agent process): enough to see who waits for whom.
function setup() {
  const board = new Board();
  const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
  const launched = [];
  sched.launch = (task) => { launched.push(task.id); board.patch(task.id, { status: 'running', workdir: board.project(task.project).path }, 'orb', 'task.launched'); sched.running.set(task.id, { agent: 'claude', account: 'claude' }); };
  const folder = (name) => { const dir = path.join(home.home, 'web', `${name}-${Math.random().toString(36).slice(2, 6)}`); fs.mkdirSync(dir, { recursive: true }); board.addProject({ name: path.basename(dir), path: dir }, 'usuario'); return path.basename(dir); };
  const mk = (project, title) => board.createTask({ project, title, description: 'x', agent: 'claude' }, 'usuario');
  return { board, sched, launched, folder, mk };
}

test('a task that waits for a folder says which task holds it, and goes on when that one ends', () => {
  const { board, sched, launched, folder, mk } = setup();
  const one = folder('uno'); const two = folder('dos');
  const first = mk(one, 'Larga'); sched.tick();
  assert.deepEqual(launched, [first.id]);
  const second = mk(one, 'Misma carpeta'); const other = mk(two, 'Otra carpeta');
  sched.tick();
  assert.deepEqual(board.waitReason(board.task(second.id)), { kind: 'folder', by: first.id });
  assert.deepEqual(board.panelTasks(50).map((t) => [t.id, board.waitReason(t)?.kind ?? null]).find(([id]) => id === second.id), [second.id, 'folder']);
  assert.deepEqual(launched, [first.id, other.id], 'another folder does not wait');
  assert.equal(board.waitReason(board.task(other.id)), null);
  assert.match(board.explainForAgents(board.task(second.id)).waiting, new RegExp(`#${first.id}`));
  // the holder ends: the reason goes and the task starts
  board.patch(first.id, { status: 'done' }, 'orb', 'task.done'); sched.running.delete(first.id);
  assert.equal(board.waitReason(board.task(second.id)), null, 'a holder that is not running holds nothing');
  sched.tick();
  assert.deepEqual(launched, [first.id, other.id, second.id]);
  assert.equal(board.waitReason(board.task(second.id)), null);
});

test('a usage-limit notice keeps its text and adds the account, when it comes back and the percent', () => {
  const board = new Board();
  const dir = path.join(home.home, 'web', 'limite'); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'p', path: dir }, 'usuario');
  const task = board.createTask({ project: 'p', title: 'Espera', description: 'x', agent: 'claude' }, 'usuario');
  const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
  const resetAt = Date.now() + 3 * 3_600_000;
  recordRate(board, 'claude', { utilization: 0.94, resetAt, window: 'five_hour', status: 'allowed' });
  const ranked = rankAccounts(board, [{ id: 'claude', agent: 'claude' }], null);
  sched.waitFor(board.task(task.id), ranked);
  const w = board.waitReason(board.task(task.id));
  assert.equal(w.kind, 'notice');
  assert.equal(w.text, board.setting(`wait_notice:${task.id}`), 'the text is the one the setting always had');
  assert.match(w.text, /94/);
  assert.equal(w.percent, 94);
  assert.equal(w.until, new Date(resetAt).toISOString());
  assert.equal(typeof w.account, 'string');
  assert.ok(!/[\/]/.test(JSON.stringify(w.until)), 'no paths');
  // the other reasons keep their shape
  assert.deepEqual(board.waitReason(board.task(task.id), true), { kind: 'paused' });
  sched.notice(board.task(task.id), 'Ningún agente disponible');
  assert.deepEqual(board.waitReason(board.task(task.id)), { kind: 'notice', text: 'Ningún agente disponible' });
});
