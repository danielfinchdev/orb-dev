// 3.8.2: «Cambios» of a finished task: the files it changed with their diff, read from its undo checkpoint
// (src/core/workspace.mjs › diffBetween, tasks.diff). Reading them never changes the folder nor what «Deshacer» does.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/core/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { DESKTOP, principalOf, METHODS } from '../src/core/permissions.mjs';
import { git, takeCheckpoint, snapshotCommit, diffBetween, undoCheckpoint } from '../src/core/workspace.mjs';
import { shapeResult } from '../src/engine/remote.mjs';

let t; let board; let api; let sessions; let repo;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'diffs');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'gone.txt'), 'bye\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'diffs', path: repo }, 'usuario', { fromUser: true });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

// A task in «carpeta» mode as the scheduler leaves it: the checkpoint before, the agent's work, the checkpoint after.
function finishedTask() {
  const cp = takeCheckpoint(repo, `t-diff-${Date.now()}`, path.join(t.home, 'fotos'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n2\nthree\n');
  fs.writeFileSync(path.join(repo, 'new file.txt'), 'hello\n');
  fs.writeFileSync(path.join(repo, 'pic.bin'), Buffer.from([0, 1, 2, 0, 255]));
  fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=secret\n');
  fs.rmSync(path.join(repo, 'gone.txt'));
  const after = snapshotCommit(repo, { always: true, message: 'after' });
  const task = board.createTask({ project: 'diffs', title: 'Edit', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${task.id}`, { before: cp, after: { kind: 'git', repo, commit: after.commit }, head: null, remotes: null });
  return { task, cp, after };
}

test('diffBetween: each changed file with its status, counts and patch; secrets and binaries without a patch', () => {
  const { cp, after } = finishedTask();
  const out = diffBetween(repo, cp.commit, after.commit);
  const by = Object.fromEntries(out.files.map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(by).sort(), ['a.txt', 'gone.txt', 'new file.txt', 'pic.bin']);
  assert.equal(by['a.txt'].status, 'M'); assert.equal(by['a.txt'].added, 1); assert.equal(by['a.txt'].removed, 1);
  assert.match(by['a.txt'].patch, /^-two$/m); assert.match(by['a.txt'].patch, /^\+2$/m);
  assert.equal(by['new file.txt'].status, 'A'); assert.match(by['new file.txt'].patch, /^\+hello$/m);
  assert.equal(by['gone.txt'].status, 'D');
  assert.equal(by['pic.bin'].binary, true); assert.equal(by['pic.bin'].patch, '');
  assert.equal(out.more, 0);
  // Caps: a patch over the limit is cut (listed, without its text), and so is the list.
  const small = diffBetween(repo, cp.commit, after.commit, { maxPatch: 10, maxFiles: 2 });
  assert.equal(small.files.length, 2); assert.equal(small.more, 2);
  assert.ok(small.files.every((f) => f.patch === '' && (f.cut || f.binary)));
  // Fixed back for the next tests.
  undoCheckpoint(cp, after);
});

test('tasks.diff: read only, also from the phone without paths of this PC; «Deshacer» still restores', async () => {
  const { task } = finishedTask();
  const status = () => git(repo, 'status', '--porcelain').stdout;
  const head = git(repo, 'rev-parse', 'HEAD').stdout;
  const was = status();
  const out = await call('tasks.diff', { id: task.id });
  assert.equal(out.available, true);
  assert.equal(out.files.length, 4);
  assert.equal(status(), was, 'the folder is as it was'); assert.equal(git(repo, 'rev-parse', 'HEAD').stdout, head);
  assert.equal(METHODS['tasks.diff'], 'remote');
  const phone = principalOf({ device: { id: 'p1', kind: 'phone' } });
  const remote = shapeResult('tasks.diff', await call('tasks.diff', { id: task.id }, phone));
  assert.ok(!JSON.stringify(remote).includes(t.home), 'no folder of this PC');
  assert.deepEqual(remote.files.map((f) => f.path).sort(), out.files.map((f) => f.path).sort());
  // The undo of before, unchanged.
  const undone = await call('tasks.undo', { id: task.id });
  assert.deepEqual(undone.restored.sort(), ['a.txt', 'gone.txt']);
  assert.deepEqual(undone.removed.sort(), ['new file.txt', 'pic.bin']);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').replace(/\r\n/g, '\n'), 'one\ntwo\nthree\n');
  // Undone: no checkpoint left, so nothing to show.
  assert.deepEqual(await call('tasks.diff', { id: task.id }), { available: false, files: [], more: 0 });
});

test('tasks.diff: nothing while a task has no checkpoint after it, and an unknown task is refused', async () => {
  const task = board.createTask({ project: 'diffs', title: 'Running', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${task.id}`, { before: { kind: 'git', repo, commit: git(repo, 'rev-parse', 'HEAD').stdout.trim() }, after: null });
  assert.equal((await call('tasks.diff', { id: task.id })).available, false);
  await assert.rejects(call('tasks.diff', { id: 999999 }), /no existe esa tarea/);
});

// 3.8.2 (security review): a token written in an ordinary file never travels in the diff (it also goes to the phone).
test('diffBetween: a key in an ordinary file is hidden in its patch', () => {
  const cp = takeCheckpoint(repo, `t-diff-key-${Date.now()}`, path.join(t.home, 'fotos'));
  const KEY = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
  fs.writeFileSync(path.join(repo, 'config.js'), `export const token = '${KEY}';
`);
  const after = snapshotCommit(repo, { always: true, message: 'key' });
  const out = diffBetween(repo, cp.commit, after.commit);
  const f = out.files.find((x) => x.path === 'config.js');
  assert.ok(f && f.added === 1);
  assert.ok(!JSON.stringify(out).includes(KEY), 'the key is not in the answer');
  assert.match(f.patch, /secreto oculto/);
  undoCheckpoint(cp, after);
});
