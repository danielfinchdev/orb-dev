// 3.8.8: guards for approving and accepting from a phone with stale data (accept, folder flags, cut description, undo point).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { shapeResult } from '../src/engine/transport/remote-calls.mjs';

const home = tempHome();
const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-guardas-'));
after(() => { home.cleanup(); fs.rmSync(outer, { recursive: true, force: true }); });

let n = 0;
function setup({ outside = false, description = 'x' } = {}) {
  const board = new Board();
  const inner = path.join(home.home, 'web', `c${Date.now()}-${n++}`); fs.mkdirSync(inner, { recursive: true });
  const name = path.basename(inner);
  board.addProject({ name, path: inner }, 'usuario');
  // addProject refuses a folder outside the assistant's: a linked one is stored directly
  const dir = outside ? path.join(outer, name) : inner;
  if (outside) { fs.mkdirSync(dir, { recursive: true }); board.run('UPDATE projects SET path = ? WHERE name = ?', dir, name); }
  const calls = [];
  const scheduler = { undo: async (id) => { calls.push(id); return { ok: true }; } };
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const task = board.createTask({ project: name, title: 'T', description, agent: 'claude' }, 'usuario');
  return { board, api, dir, name, task, calls, call: (m, p) => api.call(m, p, DESKTOP) };
}
const hold = (board, id) => { board.patch(id, { status: 'blocked' }, 'orb', 'task.held'); board.event(id, 'orb', 'task.held', 'ha eliminado 9 archivos'); };

test('tasks.accept {unheld:true} refuses a held task and changes nothing', async () => {
  const { board, call, task } = setup(); hold(board, task.id);
  await assert.rejects(call('tasks.accept', { id: task.id, unheld: true }), /retenida por la guardia/);
  assert.equal(board.task(task.id).status, 'blocked'); assert.equal(board.isAccepted(task.id), false);
});
test('tasks.accept {unheld:true} refuses a task that is not done any more, accepts a normal one', async () => {
  const { board, call, task } = setup();
  await assert.rejects(call('tasks.accept', { id: task.id, unheld: true }), /ya no se puede aceptar/);
  board.patch(task.id, { status: 'done' }, 'orb', 'task.done');
  await call('tasks.accept', { id: task.id, unheld: true });
  assert.equal(board.isAccepted(task.id), true);
});
test('tasks.accept without the parameter keeps accepting a held task', async () => {
  const { board, call, task } = setup(); hold(board, task.id);
  await call('tasks.accept', { id: task.id });
  assert.equal(board.task(task.id).status, 'done'); assert.equal(board.isAccepted(task.id), true);
});

test('folderMoved and folderOutside in the four cases', async () => {
  const inside = setup();
  let got = await inside.call('tasks.get', { id: inside.task.id });
  assert.equal(got.folderMoved, false); assert.equal(got.folderOutside, false);
  const moved = path.join(home.home, 'web', 'movida'); fs.mkdirSync(moved, { recursive: true });
  inside.board.run('UPDATE projects SET path = ? WHERE name = ?', moved, inside.name);
  got = await inside.call('tasks.get', { id: inside.task.id });
  assert.equal(got.folderMoved, true); assert.equal(got.folderOutside, false);
  const out = setup({ outside: true });
  got = await out.call('tasks.get', { id: out.task.id });
  assert.equal(got.folderMoved, false); assert.equal(got.folderOutside, true);
  const away = path.join(outer, 'otra'); fs.mkdirSync(away, { recursive: true });
  out.board.run('UPDATE projects SET path = ? WHERE name = ?', away, out.name);
  got = await out.call('tasks.get', { id: out.task.id });
  assert.equal(got.folderMoved, true); assert.equal(got.folderOutside, true);
  // the flags survive the phone's shaping, and no path is added
  const shaped = shapeResult('tasks.get', await inside.call('tasks.get', { id: inside.task.id }));
  assert.equal(shaped.folderMoved, true); assert.equal(shaped.folderOutside, false);
});

test('descriptionCut tells the phone its description lost the assistant folder; the window sees none', async () => {
  const { call, task } = setup({ description: `mira ${path.join(home.home, 'web')}\\x y sigue` });
  const raw = await call('tasks.get', { id: task.id });
  assert.equal('descriptionCut' in raw, false);
  assert.equal(shapeResult('tasks.get', raw).descriptionCut, true);
  const plain = setup({ description: 'sin rutas' });
  assert.equal(shapeResult('tasks.get', await plain.call('tasks.get', { id: plain.task.id })).descriptionCut, false);
});

test('tasks.undo with a stale checkpoint is refused; matching or absent goes through', async () => {
  const { board, call, task, calls } = setup();
  board.settingJson(`checkpoint:${task.id}`, { before: { kind: 'git', commit: 'aaa', repo: 'r' } });
  const id1 = (await call('tasks.get', { id: task.id })).checkpointId;
  assert.match(id1, /^[0-9a-f]{16}$/);
  board.settingJson(`checkpoint:${task.id}`, { before: { kind: 'git', commit: 'bbb', repo: 'r' }, after: { commit: 'ccc' } });
  await assert.rejects(call('tasks.undo', { id: task.id, checkpoint: id1 }), /vuelto a ejecutar/);
  assert.deepEqual(calls, []);
  await call('tasks.undo', { id: task.id, checkpoint: (await call('tasks.get', { id: task.id })).checkpointId });
  await call('tasks.undo', { id: task.id });
  assert.deepEqual(calls, [task.id, task.id]);
});
