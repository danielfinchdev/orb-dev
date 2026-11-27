// 3.8.9: a finished and accepted folder task is undone from the PC like in 3.8.8 (the e2e «vista tareas» step).
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

for (const useGit of [true, false]) {
  test(`undo of an accepted task from the PC removes what it created (${useGit ? 'git' : 'no git'})`, async () => {
    const board = new Board();
    const dir = path.join(home.home, 'web', `u${useGit ? 'g' : 'n'}${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
    if (useGit) { git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init'); }
    const name = path.basename(dir);
    board.addProject({ name, path: dir }, 'usuario');
    const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
    const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: sched, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
    const task = board.createTask({ project: name, title: 'T', description: 'x', agent: 'claude' }, 'usuario');
    sched.folderWorkspace(board.task(task.id), board.project(name));
    board.run("UPDATE tasks SET status = 'queued' WHERE id = ?", task.id);
    board.patch(task.id, { status: 'running' }, 'orb', 'task.launched', 'queued');
    fs.writeFileSync(path.join(dir, 'hecho.txt'), 'x');
    board.patch(task.id, { status: 'done' }, 'orb', 'task.done');
    await sched.afterFolderTask(board.task(task.id));
    await api.call('tasks.accept', { id: task.id }, DESKTOP);
    assert.equal(board.isAccepted(task.id), true);
    // another task closing in the same project holds its folder: the undo is refused meanwhile and works once it is over
    const release = sched.hold(name);
    await assert.rejects(api.call('tasks.undo', { id: task.id }, DESKTOP), /deshaciendo en ese proyecto/);
    assert.equal(fs.existsSync(path.join(dir, 'hecho.txt')), true);
    release();
    const out = await api.call('tasks.undo', { id: task.id }, DESKTOP);
    assert.ok(out);
    assert.equal(fs.existsSync(path.join(dir, 'hecho.txt')), false);
    assert.equal(fs.existsSync(path.join(dir, 'a.txt')), true);
  });
}
