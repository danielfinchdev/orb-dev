// 3.8.8 paso 7D: projects.info { local: true } is the list's read: git only, never gh, and the PR only if already known.
// Without the option the answer is the page's full one, as before.
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
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';
import { setGhForTests } from '../src/engine/host/github.mjs';
import { rememberRepo, forgetRepos, cachedBranch } from '../src/engine/host/pr-cache.mjs';

let t; let board; let api; let sessions; let repo;
let ghRuns = 0;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'sinred'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/sinred.git');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
  board.addProject({ name: 'sinred', path: repo }, 'usuario', { fromUser: true });
  // a fake runner that only counts: no real gh and no network in this file
  setGhForTests({ exe: () => 'gh-fake', run: async () => { ghRuns += 1; return { ok: false, out: '', err: 'fake' }; } });
});
after(() => { setGhForTests(null); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } forgetRepos(); t.cleanup(); });

test('la lectura local da rama y cambios y no lanza gh', async () => {
  forgetRepos(); ghRuns = 0;
  const info = await call('projects.info', { name: 'sinred', local: true });
  assert.equal(info.git, true);
  assert.equal(info.branch, 'main');
  assert.equal(info.changes, 1);
  assert.equal(info.remote, 'https://github.com/acme/sinred.git');
  assert.equal('prs' in info, false, 'sin PR conocido no se dice nada de PR');
  assert.equal(ghRuns, 0, 'gh no se lanzó');
});

test('el gh falso se usa de verdad: la lectura completa lo lanza y la local no', async () => {
  forgetRepos(); ghRuns = 0;
  await call('projects.info', { name: 'sinred', local: true });
  assert.equal(ghRuns, 0, 'con local no se lanza gh');
  await call('projects.info', { name: 'sinred' });
  assert.ok(ghRuns >= 1, 'sin local, con gh disponible, se lanza al menos una vez');
  forgetRepos();
});

test('las lecturas de la lista no tocan .git/index ni dejan index.lock', async () => {
  // a stale stat entry makes a plain `git status` rewrite the index: touch the file so its mtime differs from the cached one
  const idx = path.join(repo, '.git', 'index');
  fs.utimesSync(path.join(repo, 'a.txt'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  const before = fs.readFileSync(idx); const mtime = fs.statSync(idx).mtimeMs;
  await call('projects.info', { name: 'sinred', local: true });
  await call('projects.info', { name: 'sinred' });
  assert.ok(before.equals(fs.readFileSync(idx)), 'el índice tiene el mismo contenido');
  assert.equal(fs.statSync(idx).mtimeMs, mtime, 'y la misma fecha');
  assert.equal(fs.existsSync(`${idx}.lock`), false);
  assert.match(read('src/engine/host/github.mjs'), /query\(cwd, '--no-optional-locks'/);
});

test('la lectura local usa la PR que el motor ya conocía, sin lanzar nada', async () => {
  ghRuns = 0;
  rememberRepo(repo, { branch: 'main', prs: [{ number: 7, headRefName: 'main', isCrossRepository: false }] });
  const info = await call('projects.info', { name: 'sinred', local: true });
  assert.deepEqual(info.prs, [{ number: 7, headRefName: 'main' }]);
  assert.equal(ghRuns, 0);
  forgetRepos();
});

test('la lectura local no escribe en la caché', async () => {
  forgetRepos();
  await call('projects.info', { name: 'sinred', local: true });
  assert.equal(cachedBranch(repo), null);
});

test('sin la opción el resultado tiene los mismos campos de siempre', async () => {
  const full = await call('projects.info', { name: 'sinred' });
  for (const k of ['git', 'branch', 'remote', 'branches', 'changes', 'ahead', 'prs']) assert.ok(k in full, k);
  assert.ok(Array.isArray(full.prs));
  assert.equal(full.changes, 1);
  // only `local: true` (a real boolean) switches the read
  assert.match(read('src/engine/api/projects.mjs'), /local: local === true/);
});

test('misma clase de acceso que antes y el método no cambia', () => {
  assert.match(read('src/domain/security/permissions.mjs'), /'projects\.info': 'remote'/);
  assert.match(read('test/fixtures/superficie.json'), /"projects\.info": "remote"/);
});
