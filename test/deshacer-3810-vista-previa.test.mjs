// 3.8.10: the undo dialog shows how every file will end up (tasks.undoPreview) and the undo that carries its hash does exactly that.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit } from '../src/domain/tasks/checkpoints.mjs';

let t; let board; let api; let sessions; let repo;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'prev');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  for (const [f, c] of Object.entries({ 'a.txt': 'one\ntwo\nthree\n', 'gone.txt': 'bye\n', 'mine.txt': 'x\n', 'same.txt': 'keep\n' })) fs.writeFileSync(path.join(repo, f), c);
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'prev', path: repo }, 'usuario', { fromUser: true });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

function finishedTask() {
  const cp = takeCheckpoint(repo, `t-prev-${Date.now()}`, path.join(t.home, 'fotos'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n2\nthree\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'hello\n');
  fs.writeFileSync(path.join(repo, 'pic.bin'), Buffer.from([0, 1, 2, 0, 255]));
  fs.writeFileSync(path.join(repo, 'mine.txt'), 'agent\n');
  fs.writeFileSync(path.join(repo, 'same.txt'), 'agent\n');
  fs.rmSync(path.join(repo, 'gone.txt'));
  const end = snapshotCommit(repo, { always: true, message: 'after' });
  const task = board.createTask({ project: 'prev', title: 'Edit', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${task.id}`, { before: cp, after: { kind: 'git', repo, commit: end.commit, at: Date.now() }, head: null, remotes: null });
  return task;
}

test('tasks.undoPreview: every file with its final state and diff, read only, PC only', async () => {
  const task = finishedTask();
  // the user edits mine.txt after the agent, and puts same.txt back as it was before the task
  fs.writeFileSync(path.join(repo, 'mine.txt'), 'user edit\n');
  fs.writeFileSync(path.join(repo, 'same.txt'), 'keep\n');
  const disk = Object.fromEntries(fs.readdirSync(repo).filter((f) => f !== '.git').map((f) => [f, fs.readFileSync(path.join(repo, f))]));
  const p = await call('tasks.undoPreview', { id: task.id });
  const by = Object.fromEntries(p.files.map((f) => [f.path, f]));
  assert.equal(by['a.txt'].action, 'restore'); assert.match(by['a.txt'].patch, /^-2$/m); assert.match(by['a.txt'].patch, /^\+two$/m);
  assert.equal(by['new.txt'].action, 'remove'); assert.match(by['new.txt'].patch, /^-hello$/m);
  assert.equal(by['gone.txt'].action, 'recreate'); assert.match(by['gone.txt'].patch, /^\+bye$/m);
  assert.equal(by['pic.bin'].action, 'remove'); assert.equal(by['pic.bin'].binary, true); assert.equal(by['pic.bin'].patch, '');
  assert.equal(by['mine.txt'].action, 'conflict'); assert.equal(by['mine.txt'].patch, '');
  assert.equal(by['same.txt'].action, 'unchanged');
  assert.equal(p.counts.conflict, 1);
  for (const [f, bytes] of Object.entries(disk)) assert.ok(fs.readFileSync(path.join(repo, f)).equals(bytes), `${f} untouched by the preview`);
  assert.equal(METHODS['tasks.undoPreview'], 'pc');
  await assert.rejects(call('tasks.undoPreview', { id: task.id }, { channel: 'remote' }));
  // what the preview said is what the undo does
  const out = await call('tasks.undo', { id: task.id, hash: p.hash });
  assert.deepEqual([...out.restored, ...out.removed].sort(), ['a.txt', 'gone.txt', 'new.txt', 'pic.bin']);
  assert.equal(read('a.txt'), 'one\ntwo\nthree\n'); assert.equal(read('gone.txt'), 'bye\n'); assert.equal(read('mine.txt'), 'user edit\n');
  assert.ok(!fs.existsSync(path.join(repo, 'new.txt')));
});

test('tasks.undo with the hash of a preview that no longer holds writes nothing', async () => {
  fs.writeFileSync(path.join(repo, 'mine.txt'), 'x\n');
  const task = finishedTask();
  const p = await call('tasks.undoPreview', { id: task.id });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed again\n'); // a restore turns into a conflict meanwhile
  await assert.rejects(call('tasks.undo', { id: task.id, hash: p.hash }), /cambiado|changed/);
  assert.equal(read('a.txt'), 'changed again\n'); assert.ok(fs.existsSync(path.join(repo, 'new.txt')));
  assert.ok(!board.settingJson(`undone:${task.id}`), 'the task is not marked as undone');
  // without a hash it still works as before
  const out = await call('tasks.undo', { id: task.id });
  assert.ok(out.skipped.includes('a.txt'));
});

test('a file edited after the preview makes its hash stale; many files: diffs only up to the cap, links are never read', async () => {
  fs.writeFileSync(path.join(repo, 'mine.txt'), 'x\n'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  const task = finishedTask();
  const p = await call('tasks.undoPreview', { id: task.id });
  fs.writeFileSync(path.join(repo, 'new.txt'), 'hello, edited\n'); // still «remove», but another content
  await assert.rejects(call('tasks.undo', { id: task.id, hash: p.hash }), /cambiado|changed/);
  assert.ok(fs.existsSync(path.join(repo, 'new.txt')));
  const { undoPreviewFiles } = await import('../src/domain/tasks/checkpoints.mjs');
  const cp = board.settingJson(`checkpoint:${task.id}`).before;
  const plan = Array.from({ length: 5 }, (_, i) => ({ path: `a.txt`, action: 'restore', i }));
  const rows = undoPreviewFiles(cp, plan, { maxDiffs: 2 });
  assert.equal(rows.filter((r) => r.noDiff).length, 3);
  assert.equal(rows.filter((r) => r.patch).length, 2);
  await call('tasks.undo', { id: task.id }); // leave the folder as it was
});
