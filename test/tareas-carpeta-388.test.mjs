// 3.8.8: tasks.get tells the phone the folder the approval fingerprint covers (folderNow), which is not the stored
// project_path when the project moved after the task was created.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { withoutPaths } from '../src/engine/transport/remote-calls.mjs';

const home = tempHome();
after(() => home.cleanup());

function setup() {
  const board = new Board();
  const dir = path.join(home.home, 'web', `carpeta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`); fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(dir);
  board.addProject({ name, path: dir }, 'usuario');
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: null, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const task = board.createTask({ project: name, title: 'Hace algo', description: 'x', agent: 'claude' }, 'usuario');
  return { board, api, dir, name, task };
}

test('tasks.get carries the folder the fingerprint covers, and the rest of its shape is the same', async () => {
  const { board, api, dir, task } = setup();
  const got = await api.call('tasks.get', { id: task.id }, DESKTOP);
  assert.equal(got.folderNow, dir);
  assert.equal(got.folderNow, got.project_path);
  assert.equal(got.folderNow, board.projectPathNow(board.task(task.id)));
  assert.equal(got.previewHash, board.previewHash(board.task(task.id)));
  for (const k of ['previewHash', 'approval', 'waiting', 'held', 'accepted', 'children', 'undone', 'hasCheckpoint', 'review', 'modelLabel', 'accountLabel', 'project_path']) assert.ok(k in got, k);
});

test('a project that moved after the task was created: folderNow is the new folder and the hash covers it', async () => {
  const { board, api, dir, name, task } = setup();
  const before = (await api.call('tasks.get', { id: task.id }, DESKTOP)).previewHash;
  const moved = `${dir}-movida`; fs.mkdirSync(moved);
  board.run('UPDATE projects SET path = ? WHERE name = ?', moved, name);
  const got = await api.call('tasks.get', { id: task.id }, DESKTOP);
  assert.equal(got.project_path, dir);
  assert.equal(got.folderNow, moved);
  assert.notEqual(got.folderNow, got.project_path);
  assert.notEqual(got.previewHash, before, 'the fingerprint follows the current folder');
});

test('for a phone, folderNow is treated like project_path (same path rule)', async () => {
  const { api, task } = setup();
  const got = await api.call('tasks.get', { id: task.id }, DESKTOP);
  const out = withoutPaths(got);
  assert.equal(out.folderNow, out.project_path);
  assert.ok(!path.isAbsolute(out.folderNow) || out.folderNow === out.project_path);
});
