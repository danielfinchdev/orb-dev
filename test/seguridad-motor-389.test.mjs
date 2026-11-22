// 3.8.9 engine security: a re-launched joined task gets its own undo point, schedule approvals carry a fingerprint,
// accept guards for web/phone, a report's OK only covers the run it shows, and a half-done hand join can be settled.
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
import { createSchedule } from '../src/domain/schedules/schedules.mjs';
import { lastLaunchId } from '../src/engine/scheduler/run-id.mjs';

const home = tempHome({ maxParallel: 5, perAgent: 5, oneAtATime: false });
after(() => home.cleanup());

const PHONE = { channel: 'phone', device: 'd' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
let n = 0;
function setup() {
  const board = new Board();
  const dir = path.join(home.home, 'web', `s${Date.now()}-${n++}`); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  const name = path.basename(dir);
  board.addProject({ name, path: dir }, 'usuario');
  const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: sched, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const task = board.createTask({ project: name, title: 'T', description: 'x', agent: 'claude', mode: 'carpeta' }, 'usuario');
  const project = board.project(name);
  const start = (folder = true) => {
    if (folder) sched.folderWorkspace(board.task(task.id), project);
    board.run("UPDATE tasks SET status = 'queued' WHERE id = ?", task.id);
    board.patch(task.id, { status: 'running' }, 'orb', 'task.launched', 'queued');
  };
  const end = async () => { board.patch(task.id, { status: 'done' }, 'orb', 'task.done'); await sched.afterFolderTask(board.task(task.id)); };
  const call = (m, p, who = DESKTOP) => api.call(m, p, who);
  return { board, sched, task, dir, start, end, call, project, name };
}

// a re-run in an isolated copy that is joined at the end (same shape as the 3.8.8 tests)
async function rerunInCopy(ctx) {
  const { start, end, board, task, dir, sched } = ctx;
  start(); fs.writeFileSync(path.join(dir, 'a.txt'), 'dos\n'); await end();
  start(false);
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  const branch = `orb-copy-${task.id}`;
  git(dir, 'branch', branch);
  git(dir, 'checkout', '-q', branch); fs.writeFileSync(path.join(dir, 'b.txt'), 'nuevo\n'); git(dir, 'add', 'b.txt'); git(dir, 'commit', '-qm', 'copy work'); git(dir, 'checkout', '-q', '-');
  board.patch(task.id, { status: 'done', branch }, 'orb', 'task.done');
  const info = { base }; board.settingJson(`integrate:${task.id}`, info);
  return { info, join: () => sched.integrate(board.task(task.id), board.project(board.task(task.id).project), info) };
}
async function conflicted(ctx) {
  const r = await rerunInCopy(ctx);
  fs.writeFileSync(path.join(ctx.dir, 'b.txt'), 'otro\n'); git(ctx.dir, 'add', 'b.txt'); git(ctx.dir, 'commit', '-qm', 'folder');
  await r.join();
  return ctx.board.settingJson(`integrate:${ctx.task.id}`);
}

test('3: a joined task launched again in the folder takes its own undo point', async () => {
  const ctx = setup(); const { board, task, start, dir } = ctx;
  const { join } = await rerunInCopy(ctx);
  await join();
  const joined = board.settingJson(`checkpoint:${task.id}`);
  assert.ok(joined.before.ref.endsWith('-antes-de-unir'));
  start(); // launched again in the folder
  const again = board.settingJson(`checkpoint:${task.id}`);
  assert.notEqual(again.before.commit, joined.before.commit, 'not the point from before the join');
  assert.equal(again.joined, undefined);
  // and a follow-up of that new run still reuses it
  const kept = again.before.commit;
  start();
  assert.equal(board.settingJson(`checkpoint:${task.id}`).before.commit, kept);
  assert.ok(fs.existsSync(path.join(dir, 'b.txt')));
});

test('4: approving a schedule needs the fingerprint of what is approved', async () => {
  const { board, call, name } = setup();
  const s = createSchedule(board, { project: name, title: 'Daily', description: 'check things', agent: 'claude', every: 'daily', at_time: '09:00' }, 'orb');
  assert.equal(s.approved, false);
  const listed = (await call('schedules.list', {})).find((x) => x.id === s.id);
  assert.match(listed.previewHash, /^[0-9a-f]{16,}$/);
  await assert.rejects(call('schedules.update', { id: s.id, approve: true }, PHONE), /huella|fingerprint/i);
  await assert.rejects(call('schedules.update', { id: s.id, approve: true, hash: 'stale' }, PHONE), /cambiado|changed/i);
  assert.equal((await call('schedules.list', {})).find((x) => x.id === s.id).approved, false);
  // it changes after the list was loaded: the old fingerprint no longer approves
  await call('schedules.update', { id: s.id, description: 'delete everything' }, PHONE);
  await assert.rejects(call('schedules.update', { id: s.id, approve: true, hash: listed.previewHash }, PHONE), /cambiado|changed/i);
  const now = (await call('schedules.list', {})).find((x) => x.id === s.id);
  assert.notEqual(now.previewHash, listed.previewHash);
  await call('schedules.update', { id: s.id, approve: true, hash: now.previewHash }, PHONE);
  assert.equal((await call('schedules.list', {})).find((x) => x.id === s.id).approved, true);
});

test('5: a remote accept without checkpointId still refuses a stale point and an abandoned join', async () => {
  const ctx = setup(); const { board, task, call } = ctx;
  await rerunInCopy(ctx); // re-run waiting to be joined: the stored point is still of the first run
  await assert.rejects(call('tasks.accept', { id: task.id }, PHONE), /todavía|aún|not ready|yet/i);
  assert.equal(board.isAccepted(task.id), false);
  // the PC window keeps accepting without it
  await call('tasks.accept', { id: task.id });
  assert.equal(board.isAccepted(task.id), true);

  const c2 = setup(); const info = await conflicted(c2);
  c2.board.patch(info.by, { status: 'failed' }, 'orb', 'task.failed');
  c2.sched.joinedBy(c2.board.task(c2.task.id), info);
  await assert.rejects(c2.call('tasks.accept', { id: c2.task.id }, PHONE), /sin terminar|unfinished/i);
  assert.equal(c2.board.isAccepted(c2.task.id), false);
});

test('6: the OK of a report accepts only the run it shows', async () => {
  const ctx = setup(); const { board, task, start, end, call } = ctx;
  start(); fs.writeFileSync(path.join(ctx.dir, 'a.txt'), 'dos\n'); await end();
  const other = board.createTask({ project: task.project, title: 'O', description: 'y', agent: 'claude', mode: 'carpeta' }, 'usuario');
  board.patch(other.id, { status: 'done' }, 'orb', 'task.done');
  const run = lastLaunchId(board, task.id);
  const report = board.addChat('assistant', 'report', { kind: 'report', project: task.project, tasks: [task.id, other.id], runs: { [task.id]: run, [other.id]: lastLaunchId(board, other.id) } });
  await new Promise((r) => setTimeout(r, 5));
  start(); await end(); // the task ran again after the report
  const out = await call('chat.accept', { id: report.id });
  assert.deepEqual(out, [other.id]);
  assert.equal(board.isAccepted(task.id), false); assert.equal(board.isAccepted(other.id), true);
  // a report written before runs were stored: judged by when the task was launched
  const old = board.addChat('assistant', 'old', { kind: 'report', project: task.project, tasks: [task.id] });
  await new Promise((r) => setTimeout(r, 5));
  start(); await end();
  await assert.rejects(call('chat.accept', { id: old.id }), /volvió a ejecutar|ran again/i);
  assert.equal(board.isAccepted(task.id), false);
});

test('7: undoing a joined task keeps later work in the folder', async () => {
  const ctx = setup(); const { task, dir, sched } = ctx;
  const { join } = await rerunInCopy(ctx);
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  await join();
  assert.equal(read('b.txt'), 'nuevo\n');
  // later work on the joined file and on a file of the first run, one uncommitted and one committed
  fs.writeFileSync(path.join(dir, 'b.txt'), 'nuevo\nmas trabajo\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'dos\ntrabajo posterior\n'); git(dir, 'add', 'a.txt'); git(dir, 'commit', '-qm', 'later');
  await sched.undo(task.id);
  assert.equal(read('b.txt'), 'nuevo\nmas trabajo\n');
  assert.equal(read('a.txt'), 'dos\ntrabajo posterior\n');
});

test('8: a hand join that failed halfway shows as partial and can be cleaned up or tried again', async () => {
  const ctx = setup(); const { board, task, sched, dir, project, call } = ctx;
  const info = await conflicted(ctx);
  assert.equal((await call('tasks.get', { id: task.id }, PHONE)).joinState, 'byhand');
  // the join task wrote part of the work in the folder, then failed
  sched.folderWorkspace(board.task(info.by), project);
  fs.writeFileSync(path.join(dir, 'c.txt'), 'half\n');
  board.patch(info.by, { status: 'failed' }, 'orb', 'task.failed');
  await sched.afterFolderTask(board.task(info.by)); // its end photo
  sched.joinedBy(board.task(task.id), info);
  const got = await call('tasks.get', { id: task.id }, PHONE);
  assert.equal(got.joinState, 'partial'); assert.equal(got.joinWrote, true); assert.equal(got.joinTask, info.by);
  // not settled for a join that is not half-done
  await assert.rejects(call('tasks.undoJoin', { id: ctx.board.createTask({ project: ctx.name, title: 'x', description: 'y', agent: 'claude' }, 'usuario').id }, PHONE), /unión a medias|half-done/i);
  const out = await call('tasks.undoJoin', { id: task.id }, PHONE);
  assert.equal(out.cleaned, true);
  assert.equal(fs.existsSync(path.join(dir, 'c.txt')), false, 'what the join wrote is gone');
  const after = await call('tasks.get', { id: task.id }, PHONE);
  assert.equal(after.joinState, 'partial'); assert.equal(after.joinWrote, false);
  // try again: the copy is joined once more (it conflicts again, so a new join task takes it)
  await call('tasks.retryJoin', { id: task.id }, PHONE);
  await sched.integratePending();
  const again = board.settingJson(`integrate:${task.id}`);
  assert.ok(again?.by && again.by !== info.by, 'a new join task');
  assert.equal((await call('tasks.get', { id: task.id }, PHONE)).joinState, 'byhand');
});

test('8b: the half-done join is only settled while its join task is still the one that failed', async () => {
  const mk = async () => {
    const ctx = setup(); const { board, task, sched, dir, project } = ctx;
    const info = await conflicted(ctx);
    sched.folderWorkspace(board.task(info.by), project);
    fs.writeFileSync(path.join(dir, 'c.txt'), 'half\n');
    board.patch(info.by, { status: 'failed' }, 'orb', 'task.failed');
    return { ctx, info };
  };
  // cut short without an end photo: the phone is told to settle it on the PC instead of reverting later work
  const a = await mk();
  a.ctx.sched.joinedBy(a.ctx.board.task(a.ctx.task.id), a.info);
  await assert.rejects(a.ctx.call('tasks.undoJoin', { id: a.ctx.task.id }, PHONE), /estado final|final state|final/i);
  assert.ok(fs.existsSync(path.join(a.ctx.dir, 'c.txt')));
  // the join task was run again and ended well: nothing is half-done any more
  const b = await mk();
  await b.ctx.sched.afterFolderTask(b.ctx.board.task(b.info.by));
  b.ctx.sched.joinedBy(b.ctx.board.task(b.ctx.task.id), b.info);
  b.ctx.board.patch(b.info.by, { status: 'queued' }, 'orb', 'task.retry');
  b.ctx.board.patch(b.info.by, { status: 'running' }, 'orb', 'task.launched', 'queued');
  b.ctx.board.patch(b.info.by, { status: 'done' }, 'orb', 'task.done');
  const got = await b.ctx.call('tasks.get', { id: b.ctx.task.id }, PHONE);
  assert.equal(got.joinSettleable, false);
  await assert.rejects(b.ctx.call('tasks.undoJoin', { id: b.ctx.task.id }, PHONE), /unión a medias|half-done/i);
  await assert.rejects(b.ctx.call('tasks.retryJoin', { id: b.ctx.task.id }, PHONE), /unión a medias|half-done/i);
  assert.ok(fs.existsSync(path.join(b.ctx.dir, 'c.txt')));
});

test('9: an unapproved schedule runs only with its fingerprint, and approving carries no other change', async () => {
  const { board, call, name } = setup();
  const s = createSchedule(board, { project: name, title: 'Daily', description: 'check things', agent: 'claude', every: 'daily', at_time: '09:00' }, 'orb');
  const hash = (await call('schedules.list', {})).find((x) => x.id === s.id).previewHash;
  await assert.rejects(call('schedules.run', { id: s.id }, PHONE), /huella|fingerprint/i);
  await assert.rejects(call('schedules.run', { id: s.id, hash: 'old' }, PHONE), /cambiado|changed/i);
  await assert.rejects(call('schedules.update', { id: s.id, approve: true, hash, description: 'other' }, PHONE), /sola|on its own/i);
  assert.equal((await call('schedules.list', {})).find((x) => x.id === s.id).approved, false);
  await call('schedules.run', { id: s.id, hash }, PHONE);
});
