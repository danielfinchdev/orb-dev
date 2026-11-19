// 3.8.8: the approval fingerprint and signature never reach a phone (answers or pushed events); the PC window keeps them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { shapeResult, withoutPaths } from '../src/engine/transport/remote-calls.mjs';

const home = tempHome();
after(() => home.cleanup());

const KEYS = ['approval_hash', 'approval_sig'];
function setup() {
  const board = new Board();
  const dir = path.join(home.home, 'web', 'firma'); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'firma', path: dir }, 'usuario');
  const api = buildApi({ board, sessions: { list: () => [] }, orchestrator: null, scheduler: {}, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  return { board, call: (m, p) => api.call(m, p, DESKTOP) };
}

test('a phone gets no approval fingerprint or signature; the window keeps them and previewHash still approves', async () => {
  const { board, call } = setup();
  const task = board.createTask({ project: 'firma', title: 'T', description: 'x', agent: 'claude', sensitivity: ['publish'] }, 'usuario');
  const detail = await call('tasks.get', { id: task.id });
  await call('tasks.approve', { id: task.id, decision: 'approved', hash: detail.previewHash });
  const signed = board.task(task.id);
  assert.ok(signed.approval_hash && signed.approval_sig);

  const pcGet = await call('tasks.get', { id: task.id });
  for (const k of KEYS) assert.ok(pcGet[k], `window keeps ${k}`);
  const phoneGet = shapeResult('tasks.get', pcGet);
  for (const k of KEYS) assert.equal(k in phoneGet, false);
  assert.equal(phoneGet.previewHash, pcGet.previewHash);
  assert.equal(phoneGet.title, 'T'); assert.equal(phoneGet.status, pcGet.status);

  const list = await call('tasks.list', {});
  assert.equal(shapeResult('tasks.list', list).some((t) => KEYS.some((k) => k in t)), false);
  assert.equal(shapeResult('tasks.list', list)[0].title, 'T');
});

test('pushed events and nested rows lose the fields at any depth, the rest stays', () => {
  const row = { id: 3, title: 'T', approval_hash: 'h', approval_sig: 's', previewHash: 'p' };
  const ev = withoutPaths({ tasks: [row], deep: { a: { b: [row] } } });
  assert.deepEqual(ev.tasks[0], { id: 3, title: 'T', previewHash: 'p' });
  assert.deepEqual(ev.deep.a.b[0], { id: 3, title: 'T', previewHash: 'p' });
  // past the depth limit the JSON path is used
  let nested = row; for (let i = 0; i < 20; i++) nested = { n: nested };
  assert.equal(JSON.stringify(withoutPaths(nested)).includes('approval_'), false);
});
