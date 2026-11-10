// 3.8.3 (repaso): engine states that could get stuck or lose data.
// - The coordinator only forgets its conversation when the agent lost it, never on a usage limit or another error.
// - A copy whose hand-join task failed or was cancelled stops waiting: the pending join closes and the work stays on
//   its branch (its dependents were blocked for ever).
// - The whiteboard is written whole or not at all, and a drawing that cannot be read is kept aside, not replaced.
// - A send refused because the conversation is busy does not change what the running turn may do.
// - A linked device calling a method it may not use gets the same refusal whether the method exists or not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { Orchestrator, staleConversation } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { whiteboard } from '../src/engine/whiteboard.mjs';

let h; let board; let sessions; let scheduler; let api;
before(() => {
  h = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit, log: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  createProject(board, { name: 'web' }, 'usuario');
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } h.cleanup(); });

test('the coordinator forgets its conversation only when the agent lost it', () => {
  assert.equal(staleConversation({ isError: true, text: '', final: 'No conversation found with session ID abc' }), true);
  assert.equal(staleConversation({ isError: true, text: '', final: 'Error: thread not found' }), true);
  assert.equal(staleConversation({ isError: true, text: '', final: "You've hit your usage limit. Resets at 5pm", limit: { until: 1 } }), false, 'a usage limit is not a lost conversation');
  assert.equal(staleConversation({ isError: true, text: '', final: 'Error: network timeout' }), false);
  assert.equal(staleConversation({ isError: true, text: 'Hice la mitad', final: 'session ended by tool error' }), false, 'an answer came: nothing to forget');
  assert.equal(staleConversation({ isError: false, text: 'ok', final: 'ok' }), false);
});

test('a copy whose hand-join task failed or was cancelled stops waiting, and the work stays on its branch', () => {
  const task = board.createTask({ project: 'web', title: 'Aislada', description: 'x', agent: 'claude', mode: 'aislada' }, 'usuario');
  const join = board.createTask({ project: 'web', title: 'Unir', description: 'x', agent: 'claude' }, 'orb');
  board.patch(task.id, { status: 'done', branch: 'orb/1-aislada' }, 'orb', 'task.finished');
  board.patch(join.id, { status: 'cancelled' }, 'usuario', 'task.cancelled');
  board.settingJson(`integrate:${task.id}`, { base: 'abc', by: join.id }); board.setting(`join_task:${join.id}`, '1');
  const notices = board.all("SELECT COUNT(*) AS n FROM chat WHERE role = 'notice'")[0].n;
  scheduler.integratePending();
  assert.equal(board.settingJson(`integrate:${task.id}`), null, 'the pending join is closed');
  assert.equal(board.setting(`join_task:${join.id}`) || '', '');
  assert.equal(board.task(task.id).branch, 'orb/1-aislada', 'the branch stays for a join by hand');
  assert.ok(board.all('SELECT kind, detail FROM events WHERE task_id = ?', task.id).some((e) => e.kind === 'integrate.skipped' && /terminó en cancelled/.test(e.detail)));
  assert.ok(board.all("SELECT COUNT(*) AS n FROM chat WHERE role = 'notice'")[0].n > notices, 'the user is told');
  // A join task that no longer exists: the same.
  board.settingJson(`integrate:${task.id}`, { base: 'abc', by: 99_999 });
  scheduler.integratePending();
  assert.equal(board.settingJson(`integrate:${task.id}`), null);
});

test('the whiteboard is written whole or not at all; a drawing that cannot be read is kept aside, never replaced by an empty one', () => {
  const wb = whiteboard(board);
  wb.save({ project: 'web', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], appState: {} });
  const dir = path.join(board.project('web').path, 'pizarra');
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temporary file left behind');
  assert.equal(wb.load({ project: 'web' }).elements.length, 1);
  fs.writeFileSync(path.join(dir, 'pizarra.excalidraw'), '{"type":"excalidraw","elements":[{"id":"a"'); // cut short by a crash
  const loaded = wb.load({ project: 'web' });
  assert.deepEqual(loaded.elements, []); assert.equal(loaded.damaged, true);
  const aside = fs.readdirSync(dir).filter((f) => /^pizarra\.excalidraw\.roto-/.test(f));
  assert.equal(aside.length, 1, 'the unreadable drawing is kept');
  assert.match(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), /"id":"a"/);
  assert.equal(wb.load({ project: 'web' }).damaged, undefined, 'said once');
});

test('a send refused because the conversation is busy does not change what the running turn may do', () => {
  const s = sessions.create({ kind: 'chat', agent: 'claude', permission: 'auto', project: 'web', cwd: board.project('web').path, title: 'x' });
  sessions.asked.set(s.id, []);
  sessions.running.set(s.id, { stopped: false });
  try { assert.throws(() => sessions.send(s.id, 'haz push de todo'), /trabajando|working/i); }
  finally { sessions.running.delete(s.id); }
  assert.deepEqual(sessions.asked.get(s.id), [], 'the running turn still may not publish');
  sessions.remove(s.id);
  assert.equal(sessions.asked.has(s.id), false);
});

test('a linked device gets the same refusal for a method it may not use and for one that does not exist', async () => {
  const phone = { channel: 'phone', device: 'd1' };
  const [missing, pcOnly] = await Promise.all([api.call('nada.raro', {}, phone).catch((e) => e), api.call('system.check', {}, phone).catch((e) => e)]);
  assert.equal(missing.name, 'PermissionError'); assert.equal(pcOnly.name, 'PermissionError');
  assert.equal(missing.status, 403); assert.equal(pcOnly.status, 403);
  await assert.rejects(api.call('nada.raro', {}, { channel: 'desktop' }), /acción desconocida|unknown action/i, 'this PC still learns what is wrong');
});
