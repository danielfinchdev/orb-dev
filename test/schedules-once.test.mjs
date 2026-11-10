// 3.8.2: scheduled tasks that run once at a date and time, and the ones whose runs all go to the same chat
// (src/domain/schedules/schedules.mjs). The repeating ones keep working as before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { createSchedule, runSchedule, runDue, getSchedule, nextRun, describe } from '../src/domain/schedules/schedules.mjs';

let t; let board;
before(() => { t = tempHome(); board = new Board(); createProject(board, { name: 'web', category: 'web' }, 'usuario'); });
after(() => t.cleanup());
const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const base = { project: 'web', title: 'Check', description: 'Check the build' };

test('once: next run is its date; it refuses a past or malformed date; after running it turns off', () => {
  const at = local(new Date(Date.now() + 2 * 86400e3));
  const s = createSchedule(board, { ...base, every: 'once', at_time: at }, 'usuario');
  assert.equal(s.every, 'once'); assert.equal(s.at_time, at); assert.equal(s.enabled, true);
  assert.equal(local(new Date(s.next_run)), at);
  assert.match(describe(s), new RegExp(at.split('T')[1]));
  assert.throws(() => createSchedule(board, { ...base, every: 'once', at_time: local(new Date(Date.now() - 3600e3)) }, 'usuario'));
  assert.throws(() => createSchedule(board, { ...base, every: 'once', at_time: '09:00' }, 'usuario'));
  assert.equal(nextRun({ every: 'once', at_time: at }, new Date(Date.now() + 3 * 86400e3)), null, 'past its time: no next run');
  // Due: runDue creates its task once and the schedule is spent.
  board.run('UPDATE schedules SET next_run = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), s.id);
  runDue(board);
  const after1 = getSchedule(board, s.id);
  assert.ok(after1.last_task, 'its task was created'); assert.equal(after1.enabled, false); assert.equal(after1.next_run, null);
  const task = board.task(after1.last_task);
  assert.equal(task.schedule_id, s.id); assert.equal(task.conversation_id ?? null, null, 'not in a chat unless asked');
  board.patch(task.id, { status: 'done' }, 'codex', 'task.updated');
  runDue(board);
  assert.equal(getSchedule(board, s.id).last_task, task.id, 'it does not run again');
});

test('same chat: every run goes to one chat, made on the first run; a deleted chat is replaced', () => {
  const s = createSchedule(board, { ...base, title: 'Nightly', every: 'daily', at_time: '03:00', same_chat: true }, 'usuario');
  assert.equal(s.same_chat, true); assert.equal(s.conversation_id, null);
  const t1 = runSchedule(board, s);
  const conv = getSchedule(board, s.id).conversation_id;
  assert.ok(conv); assert.equal(board.conversation(conv).title, 'Nightly'); assert.equal(board.conversation(conv).project, 'web');
  assert.equal(board.task(t1.id).conversation_id, conv);
  const t2 = runSchedule(board, getSchedule(board, s.id));
  assert.equal(board.task(t2.id).conversation_id, conv, 'the same chat');
  assert.ok(getSchedule(board, s.id).enabled && getSchedule(board, s.id).next_run, 'a repeating one stays on');
  board.run('DELETE FROM conversations WHERE id = ?', conv);
  const t3 = runSchedule(board, getSchedule(board, s.id));
  assert.notEqual(board.task(t3.id).conversation_id, conv); assert.ok(board.task(t3.id).conversation_id);
  // The chat that asked for it (the assistant's orb_schedule) is used from the first run.
  const asked = board.createConversation({ title: 'Asked here', project: 'web' }).id;
  const s2 = createSchedule(board, { ...base, every: 'hourly', same_chat: true, conversation_id: asked }, 'orb');
  assert.equal(s2.conversation_id, asked); assert.equal(s2.approved, false, 'the assistant\'s still needs approval');
});

test('repeating schedules without the new options keep their behaviour', () => {
  const s = createSchedule(board, { ...base, every: 'weekly', at_time: '09:00', weekdays: [1] }, 'usuario');
  assert.equal(s.same_chat, false); assert.equal(new Date(s.next_run).getDay(), 1);
  const task = runSchedule(board, s);
  assert.equal(board.task(task.id).conversation_id ?? null, null);
  const now = getSchedule(board, s.id);
  assert.equal(now.enabled, true); assert.ok(Date.parse(now.next_run) > Date.now());
});
