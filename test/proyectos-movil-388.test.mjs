// 3.8.8: what the phone's project screens read from the PC: the branch and the number of uncommitted files of every
// project (projects.list { withGit: true }), and that icons stay a PC-only choice.
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
import { DESKTOP, principalOf, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
import { guardCall } from '../src/engine/transport/remote-calls.mjs';
import { projectStatuses, forgetStatuses } from '../src/engine/host/project-status.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const row = async (name, params, who) => (await call('projects.list', params, who)).find((p) => p.name === name);

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('projects.list without the parameter is exactly what it was: no branch and no changes', async () => {
  await call('projects.create', { name: 'sin-param', category: 'web' });
  const p = await row('sin-param');
  assert.ok(!('branch' in p) && !('changes' in p));
  assert.deepEqual(await call('projects.list', { withGit: false }), await call('projects.list'));
  assert.deepEqual(await call('projects.list', { withGit: 'yes' }), await call('projects.list'), 'only true asks for it');
});

test('projects.list { withGit: true }: the branch and the count of uncommitted files, as numbers only', async () => {
  const p = await call('projects.create', { name: 'con-cambios', category: 'web' });
  forgetStatuses();
  const clean = await row('con-cambios', { withGit: true });
  assert.equal(typeof clean.branch, 'string');
  assert.equal(clean.changes, 0);
  fs.writeFileSync(path.join(p.path, 'nuevo.txt'), 'x');
  fs.writeFileSync(path.join(p.path, '.gitignore'), 'cambiado\n');
  forgetStatuses();
  const dirty = await row('con-cambios', { withGit: true });
  assert.equal(dirty.changes, 2, 'one new file and one modified');
  assert.equal(dirty.branch, clean.branch);
  assert.ok(!JSON.stringify(dirty).includes('nuevo.txt'), 'no file name');
  // the other fields of the row are the same ones as without the parameter
  const plain = await row('con-cambios');
  const { branch, changes, ...rest } = dirty;
  assert.deepEqual(rest, plain);
});

test('projects.list { withGit: true }: a project without git or without folder comes without the fields', async () => {
  await call('projects.create', { name: 'sin-git', category: 'web', template: false });
  const gone = await call('projects.create', { name: 'sin-carpeta', category: 'web', template: false });
  fs.rmSync(gone.path, { recursive: true, force: true });
  forgetStatuses();
  for (const n of ['sin-git', 'sin-carpeta']) {
    const p = await row(n, { withGit: true });
    assert.ok(p, n); assert.ok(!('branch' in p) && !('changes' in p), n);
  }
});

test('the branch of a detached HEAD is null and an empty repository still names its branch', async () => {
  const p = await call('projects.create', { name: 'suelto', category: 'web' });
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', p.path, 'checkout', '--detach'], { stdio: 'ignore' });
  forgetStatuses();
  assert.equal((await row('suelto', { withGit: true })).branch, null);
  const empty = path.join(t.home, 'vacio'); fs.mkdirSync(empty);
  execFileSync('git', ['-C', empty, 'init', '-b', 'dev'], { stdio: 'ignore' });
  forgetStatuses();
  const st = await projectStatuses([{ name: 'vacio', path: empty }]);
  assert.deepEqual(st.get('vacio'), { branch: 'dev', changes: 0 });
});

test('the time limits leave the fields out instead of waiting', async () => {
  const p = board.projects().find((x) => x.name === 'con-cambios');
  forgetStatuses();
  assert.equal((await projectStatuses([p], { eachMs: 1 })).size, 0, 'git cannot answer in 1 ms');
  assert.equal((await projectStatuses([p], { totalMs: 0 })).size, 0, 'past the deadline nothing starts');
  forgetStatuses();
  assert.equal((await projectStatuses([p, { name: 'x', path: '' }, null])).size, 1);
});

test('projects.icons and projects.create stay as they were; setting an icon is the PC only', async () => {
  assert.equal(typeof (await call('projects.icons', {}, REMOTE)), 'object');
  assert.equal(guardCall(board, 'projects.list', { withGit: true }), null);
  for (const m of ['projects.setIcon', 'projects.clearIcon', 'projects.commitFiles']) {
    assert.ok(!REMOTE_METHODS.has(m), m);
    assert.ok(guardCall(board, m, {}), m);
  }
  for (const m of ['projects.list', 'projects.create', 'projects.icons', 'projects.branch']) assert.ok(REMOTE_METHODS.has(m), m);
  // an icon sent with projects.create is ignored: it is not a parameter
  const made = await call('projects.create', { name: 'con-icono', category: 'web', icon: 'C:\Windows\win.ini' }, REMOTE);
  assert.equal((await call('projects.icons'))[made.name], null);
});
