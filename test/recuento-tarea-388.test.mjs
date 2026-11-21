// Light mode of tasks.diff ({ stat: true }): the same numbers as the whole patch, no patch, nothing written, no recheck of held files.
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

test('tasks.diff {stat:true}: same counts as the full diff, no patch, and the folder is untouched', async () => {
  const { task } = finishedTask();
  const status = () => git(repo, 'status', '--porcelain').stdout;
  const was = status();
  const full = await call('tasks.diff', { id: task.id });
  const light = await call('tasks.diff', { id: task.id, stat: true });
  assert.equal(light.available, true);
  const num = (o) => o.files.map((f) => ({ status: f.status, path: f.path, added: f.added, removed: f.removed, binary: f.binary })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(num(light), num(full));
  assert.equal(light.more, full.more);
  assert.ok(light.files.every((f) => !('patch' in f)), 'no patch');
  assert.ok(!light.files.some((f) => f.path === '.env'), 'secrets stay out');
  assert.equal(status(), was);
  // not strictly true: the full patch as before
  assert.ok('patch' in (await call('tasks.diff', { id: task.id, stat: 'yes' })).files[0]);
  assert.equal(METHODS['tasks.diff'], 'remote');
  assert.deepEqual(await call('tasks.diff', { id: 999999, stat: true }).catch((e) => e.message.match(/no existe/)?.[0]), 'no existe');
});
