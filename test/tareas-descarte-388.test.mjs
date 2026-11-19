// 3.8.8: who gets the phone guards on tasks.undo, and a discarded copy answered to the phone (accept / undo).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { workMethods } from '../src/engine/api/work.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';

const home = tempHome({ maxParallel: 5, perAgent: 5, oneAtATime: false });
after(() => home.cleanup());

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
const phone = { channel: 'phone', device: 'd' };
let n = 0;

function setup() {
  const board = new Board();
  const dir = path.join(home.home, 'web', `d${Date.now()}-${n++}`); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  const name = path.basename(dir);
  board.addProject({ name, path: dir }, 'usuario');
  const undone = [];
  const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
  const realUndo = sched.undo.bind(sched);
  sched.undo = async (id) => { undone.push(id); return realUndo(id); };
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: sched, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const task = board.createTask({ project: name, title: 'T', description: 'x', agent: 'claude', mode: 'carpeta' }, 'usuario');
  const project = board.project(name);
  const start = (folder = true) => {
    if (folder) sched.folderWorkspace(board.task(task.id), project);
    board.run("UPDATE tasks SET status = 'queued' WHERE id = ?", task.id);
    board.patch(task.id, { status: 'running' }, 'orb', 'task.launched', 'queued');
  };
  const end = async () => { board.patch(task.id, { status: 'done' }, 'orb', 'task.done'); await sched.afterFolderTask(board.task(task.id)); };
  const idOf = async () => (await api.call('tasks.get', { id: task.id }, DESKTOP)).checkpointId;
  return { board, sched, api, task, dir, start, end, undone, idOf, pc: (m, p) => api.call(m, p, DESKTOP), mobile: (m, p) => api.call(m, p, phone) };
}

// A re-run in an isolated copy, then a conflict joining it: a task joins it by hand.
async function conflicted(ctx) {
  const { start, end, board, task, dir, sched } = ctx;
  start(); fs.writeFileSync(path.join(dir, 'a.txt'), 'dos\n'); await end();
  start(false);
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  const branch = `orb-copy-${task.id}`;
  git(dir, 'branch', branch);
  git(dir, 'checkout', '-q', branch); fs.writeFileSync(path.join(dir, 'b.txt'), 'nuevo\n'); git(dir, 'add', 'b.txt'); git(dir, 'commit', '-qm', 'copy work'); git(dir, 'checkout', '-q', '-');
  board.patch(task.id, { status: 'done', branch }, 'orb', 'task.done');
  const info = { base }; board.settingJson(`integrate:${task.id}`, info);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'otro\n'); git(dir, 'add', 'b.txt'); git(dir, 'commit', '-qm', 'folder');
  await sched.integrate(board.task(task.id), board.project(board.task(task.id).project), info);
  return board.settingJson(`integrate:${task.id}`);
}
const giveUp = (ctx, info) => { ctx.board.patch(info.by, { status: 'failed' }, 'orb', 'task.failed'); ctx.sched.joinedBy(ctx.board.task(ctx.task.id), info); };

test('tasks.undo without a principal is guarded like a remote caller; the PC window is not', async () => {
  const board = new Board();
  const dir = path.join(home.home, 'web', `np${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: path.basename(dir), path: dir }, 'usuario');
  const task = board.createTask({ project: path.basename(dir), title: 'T', description: 'x', agent: 'claude' }, 'usuario');
  // a point without end photo: the guard refuses it, the window may take the whole folder back
  board.settingJson(`checkpoint:${task.id}`, { before: { kind: 'git', commit: 'aaa', repo: 'r' }, after: null });
  const calls = [];
  const methods = workMethods({ board, scheduler: { undo: async (id) => { calls.push(id); return { ok: true }; } } });
  await assert.rejects(Promise.resolve().then(() => methods['tasks.undo']({ id: task.id })), /el PC no guardó el estado final/);
  assert.deepEqual(calls, []);
  await methods['tasks.undo']({ id: task.id }, DESKTOP);
  assert.deepEqual(calls, [task.id]);
});

// The copy can be discarded while the joining task still runs; once that task gives up no copy is left to discard, so the
// phone must not be sent to the PC for ever.
test('discarding the copy before the join task gave up (before integrate.skipped)', async () => {
  const ctx = setup(); const { board, task, sched } = ctx;
  const info = await conflicted(ctx);
  assert.ok(info?.by, 'a join task was created');
  await sched.discardBranch(task.id);
  assert.equal(board.task(task.id).branch ?? '', '');
  giveUp(ctx, info);
  assert.equal(board.one('SELECT kind FROM events WHERE task_id = ? ORDER BY id DESC LIMIT 1', task.id).kind, 'integrate.skipped');
  // nothing is left to discard in the PC, so the phone must not be sent there for ever
  const diff = await ctx.mobile('tasks.diff', { id: task.id });
  assert.equal(diff.available, true); assert.equal(diff.checkpointId, await ctx.idOf());
  await ctx.mobile('tasks.accept', { id: task.id, checkpoint: await ctx.idOf() });
  assert.equal(board.isAccepted(task.id), true);
  await ctx.mobile('tasks.undo', { id: task.id });
  assert.deepEqual(ctx.undone, [task.id]);
});

test('the PC window undoes a task joined by hand; the phone is told to use the PC', async () => {
  const ctx = setup(); const { board, task, undone } = ctx;
  await conflicted(ctx);
  await assert.rejects(ctx.mobile('tasks.undo', { id: task.id }), /se unió a mano/);
  assert.deepEqual(undone, []);
  await ctx.pc('tasks.undo', { id: task.id });
  assert.deepEqual(undone, [task.id]);
  assert.ok(board.settingJson(`undone:${task.id}`));
});

test('a real scheduler.discardBranch after an abandoned join: the phone is refused before it and may accept and undo after it', async () => {
  const ctx = setup(); const { board, task, sched, undone } = ctx;
  const info = await conflicted(ctx);
  giveUp(ctx, info);
  const id = await ctx.idOf();
  await assert.rejects(ctx.mobile('tasks.accept', { id: task.id, checkpoint: id }), /quedó sin terminar/);
  await assert.rejects(ctx.mobile('tasks.undo', { id: task.id }), /quedó sin terminar/);
  assert.equal((await ctx.mobile('tasks.diff', { id: task.id })).reason, 'resolveonpc');
  await ctx.pc('tasks.discardBranch', { id: task.id });
  assert.equal(board.task(task.id).branch ?? '', '');
  assert.ok(board.one("SELECT id FROM events WHERE task_id = ? AND kind = 'branch.discarded'", task.id));
  const diff = await ctx.mobile('tasks.diff', { id: task.id });
  assert.equal(diff.available, true); assert.equal(diff.checkpointId, await ctx.idOf());
  await ctx.mobile('tasks.accept', { id: task.id, checkpoint: await ctx.idOf() });
  assert.equal(board.isAccepted(task.id), true);
  await ctx.mobile('tasks.undo', { id: task.id });
  assert.deepEqual(undone, [task.id]);
  // a second discard has no branch left
  await assert.rejects(sched.discardBranch(task.id));
});
