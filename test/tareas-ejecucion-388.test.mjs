// 3.8.8: the checkpointId tells runs apart for every task, and a diff says which run it is of.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';

const home = tempHome({ maxParallel: 5, perAgent: 5, oneAtATime: false });
after(() => home.cleanup());

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
let n = 0;
function setup({ mode = 'carpeta', useGit = true } = {}) {
  const board = new Board();
  const dir = path.join(home.home, 'web', `e${Date.now()}-${n++}`); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
  if (useGit) { git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init'); }
  const name = path.basename(dir);
  board.addProject({ name, path: dir }, 'usuario');
  const undone = [];
  const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
  const realUndo = sched.undo.bind(sched);
  sched.undo = async (id) => { undone.push(id); return realUndo(id); };
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: sched, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const task = board.createTask({ project: name, title: 'T', description: 'x', agent: 'claude', mode }, 'usuario');
  const project = board.project(name);
  // a start as launch.mjs writes it; a folder task takes its undo point first (folderWorkspace)
  const start = (folder = true) => {
    if (folder && mode === 'carpeta') sched.folderWorkspace(board.task(task.id), project);
    board.run("UPDATE tasks SET status = 'queued' WHERE id = ?", task.id);
    board.patch(task.id, { status: 'running' }, 'orb', 'task.launched', 'queued');
  };
  const end = async () => { board.patch(task.id, { status: 'done' }, 'orb', 'task.done'); await sched.afterFolderTask(board.task(task.id)); };
  const call = (m, p) => api.call(m, p, DESKTOP);
  const idOf = async () => (await call('tasks.get', { id: task.id })).checkpointId;
  return { board, sched, task, dir, start, end, call, idOf, undone };
}

test('a task never launched has no identifier; every run of an isolated task has its own', async () => {
  const { start, end, idOf, board, task } = setup({ mode: 'aislada', useGit: false });
  assert.equal(await idOf(), null);
  start(); const one = await idOf();
  assert.match(one, /^[0-9a-f]{16}$/);
  board.patch(task.id, { status: 'done' }, 'orb', 'task.done');
  start(); const two = await idOf();
  assert.match(two, /^[0-9a-f]{16}$/); assert.notEqual(two, one);
  assert.equal((await setup().idOf()), null);
});

test('a folder task with git changes per run, not with the held recheck; the diff names its run', async () => {
  const { start, end, idOf, call, task, dir, sched, board } = setup();
  start(); fs.writeFileSync(path.join(dir, 'a.txt'), 'dos\n'); await end();
  const one = await idOf();
  const diff = await call('tasks.diff', { id: task.id });
  assert.equal(diff.available, true); assert.equal(diff.checkpointId, one);
  assert.equal((await call('tasks.diff', { id: task.id, stat: true })).checkpointId, one);
  await sched.recheckHeld(board.task(task.id));
  assert.equal(await idOf(), one);
  start(); fs.writeFileSync(path.join(dir, 'a.txt'), 'tres\n'); await end();
  const two = await idOf(); assert.notEqual(two, one);
  assert.equal((await call('tasks.diff', { id: task.id })).checkpointId, two);
});

test('a folder task without git changes per run', async () => {
  const { start, end, idOf } = setup({ useGit: false });
  start(); await end(); const one = await idOf();
  start(); await end(); assert.notEqual(await idOf(), one);
});

test('a re-run in an isolated copy keeps the old point: its diff does not match, and the phone is refused', async () => {
  const { start, end, idOf, call, task, dir, board, undone } = setup();
  start(); fs.writeFileSync(path.join(dir, 'a.txt'), 'dos\n'); await end();
  const one = await idOf();
  // run 2 in an isolated copy: the start is written but the undo point is not touched (launch.mjs)
  start(false);
  const two = await idOf(); assert.notEqual(two, one);
  const diff = await call('tasks.diff', { id: task.id });
  assert.equal(diff.available, true); assert.notEqual(diff.checkpointId, two); assert.equal(diff.checkpointId, one);
  board.patch(task.id, { status: 'done' }, 'orb', 'task.done');
  await assert.rejects(call('tasks.accept', { id: task.id, checkpoint: two }), /aún no están listos/);
  await assert.rejects(call('tasks.undo', { id: task.id, checkpoint: two }), /aún no están listos/);
  assert.equal(board.isAccepted(task.id), false); assert.deepEqual(undone, []);
  // without the parameter the PC's window works as before
  await call('tasks.accept', { id: task.id });
  assert.equal(board.isAccepted(task.id), true);
});

test('an old end photo without run: the current id when not launched since, null when it was', async () => {
  const { start, end, call, idOf, task, board } = setup();
  start(); await end();
  const cp = board.settingJson(`checkpoint:${task.id}`);
  board.settingJson(`checkpoint:${task.id}`, { ...cp, after: { ...cp.after, run: undefined } });
  const now = await idOf();
  assert.equal((await call('tasks.diff', { id: task.id })).checkpointId, now);
  await new Promise((r) => setTimeout(r, 5));
  start(false);
  assert.equal((await call('tasks.diff', { id: task.id })).checkpointId, null);
});

test('tasks.undo without an undo point is refused as before, with or without checkpoint', async () => {
  const { start, call, idOf, task, undone } = setup({ mode: 'aislada', useGit: false });
  start(); const id = await idOf();
  const plain = await call('tasks.undo', { id: task.id }).then(() => 'ok', (e) => e.message);
  const sent = await call('tasks.undo', { id: task.id, checkpoint: id }).then(() => 'ok', (e) => e.message);
  assert.notEqual(plain, 'ok'); assert.equal(sent, plain);
  assert.equal((await call('tasks.get', { id: task.id })).hasCheckpoint, false);
});
