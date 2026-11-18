// 3.8.8 paso 5G: la fila de un chat en la barra lateral enseña su rama (y la PR si el motor ya la conocía).
// - sessions.list añade `branch` (worktree del chat) y `prNumber` (caché en memoria de projects.info / projects.prs);
// - sin worktree ni rama conocida el campo no existe, y la lista no lanza ningún proceso;
// - la fila de inbox.jsx la pinta.
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
import { rememberRepo, forgetRepos, cachedPr, cachedBranch, setCacheClock } from '../src/engine/host/pr-cache.mjs';
import { orbItems } from '../src/ui/lib/inbox.js';

let t; let board; let api; let sessions; let repo;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'ramas'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'ramas', path: repo }, 'usuario', { fromUser: true });
});
after(() => { setCacheClock(null); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } forgetRepos(); t.cleanup(); });

test('sessions.list da la rama de un chat con worktree y nada al que no lo tiene', async () => {
  const tree = await call('sessions.create', { agent: 'claude', project: 'ramas', permission: 'editar', title: 'wt', workspace: 'worktree' });
  const plain = await call('sessions.create', { agent: 'claude', project: 'ramas', permission: 'editar', title: 'local' });
  forgetRepos();
  const rows = await call('sessions.list', {});
  const a = rows.find((x) => x.id === tree.id); const b = rows.find((x) => x.id === plain.id);
  assert.match(a.branch, /^orb\/chat-/);
  assert.equal('prNumber' in a, false);
  assert.equal('branch' in b, false); assert.equal('prNumber' in b, false);
  // the rest of the row is what it was
  for (const k of ['id', 'title', 'agent', 'project', 'status', 'cwd', 'updated_at']) assert.ok(k in a, k);
});

test('la PR y la rama del chat local salen solo de lo que projects.info ya leyó', async () => {
  const tree = sessions.list().find((x) => x.title === 'wt'); const plain = sessions.list().find((x) => x.title === 'local');
  const branch = (await call('sessions.list', {})).find((x) => x.id === tree.id).branch;
  rememberRepo(repo, { branch: 'main', prs: [{ number: 41, headRefName: 'other' }, { number: 42, headRefName: branch }] });
  const rows = await call('sessions.list', {});
  assert.equal(rows.find((x) => x.id === tree.id).prNumber, 42);
  const local = rows.find((x) => x.id === plain.id);
  assert.equal(local.branch, 'main'); assert.equal('prNumber' in local, false);
  assert.equal(cachedPr(repo, 'nope'), null); assert.equal(cachedBranch(path.join(repo, 'zz')), null);
});

test('la lista no lanza git ni gh: con el PATH vacío da lo mismo', async () => {
  const before = JSON.stringify(await call('sessions.list', {}));
  const old = process.env.PATH; process.env.PATH = '';
  try { assert.equal(JSON.stringify(await call('sessions.list', {})), before); } finally { process.env.PATH = old; }
  const src = read('src/engine/api/work.mjs');
  const block = src.slice(src.indexOf("'sessions.list':"), src.indexOf("'sessions.create':"));
  assert.ok(block.includes('chatTrees.all()'));
  assert.doesNotMatch(block, /await|git\(|gitAsync|gh\(|spawn|exec/);
});

test('caché: una PR de un fork no se guarda, aunque su rama se llame como la nuestra', () => {
  forgetRepos();
  rememberRepo(repo, { branch: 'main', prs: [{ number: 5, headRefName: 'main', isCrossRepository: true }, { number: 6, headRefName: 'feat', isCrossRepository: false }, { number: 7, headRefName: 'old' }] });
  assert.equal(cachedPr(repo, 'main'), null);
  assert.equal(cachedPr(repo, 'feat'), 6); assert.equal(cachedPr(repo, 'old'), 7);
});

test("caché: la rama 'HEAD' o vacía borra la anterior en vez de conservarla", () => {
  for (const bad of ['HEAD', '']) {
    forgetRepos();
    rememberRepo(repo, { branch: 'main' }); assert.equal(cachedBranch(repo), 'main');
    rememberRepo(repo, { branch: bad }); assert.equal(cachedBranch(repo), null, JSON.stringify(bad));
  }
});

test('caché: cada campo caduca a los 30 min de su última lectura real', () => {
  let clock = 1_000_000; setCacheClock(() => clock);
  try {
    forgetRepos();
    rememberRepo(repo, { branch: 'main', prs: [{ number: 1, headRefName: 'main' }] });
    clock += 20 * 60_000;
    rememberRepo(repo, { prs: [{ number: 2, headRefName: 'main' }] }); // listPrs: reads PRs, not the branch
    clock += 15 * 60_000; // 35 min since the branch was read, 15 since the PRs
    assert.equal(cachedBranch(repo), null);
    assert.equal(cachedPr(repo, 'main'), 2);
    clock += 16 * 60_000;
    assert.equal(cachedPr(repo, 'main'), null);
    // a read of the branch alone (gh missing, offline) does not renew the PRs
    forgetRepos(); clock = 5_000_000;
    rememberRepo(repo, { branch: 'main', prs: [{ number: 3, headRefName: 'main' }] });
    clock += 29 * 60_000; rememberRepo(repo, { branch: 'main' });
    clock += 2 * 60_000;
    assert.equal(cachedBranch(repo), 'main'); assert.equal(cachedPr(repo, 'main'), null);
  } finally { setCacheClock(null); }
});

test('caché: barra invertida y normal, la barra final y el cwd relativo a la misma carpeta dan la misma clave', () => {
  forgetRepos();
  const slashes = repo.replace(/[\\]/g, '/');
  rememberRepo(`${slashes}/`, { branch: 'dev', prs: [{ number: 9, headRefName: 'dev' }] });
  for (const spelling of [repo, `${repo}${path.sep}`, slashes, path.join(repo, 'sub', '..')]) {
    assert.equal(cachedBranch(spelling), 'dev', spelling); assert.equal(cachedPr(spelling, 'dev'), 9, spelling);
  }
  assert.equal(cachedBranch(`${repo}-other`), null);
  if (process.platform === 'win32') assert.equal(cachedBranch(repo.toUpperCase()), 'dev');
});

test('un chat archivado o completado no recibe la rama del proyecto; la de su propio worktree sí', async () => {
  const old = await call('sessions.create', { agent: 'claude', project: 'ramas', permission: 'editar', title: 'viejo' });
  const done = await call('sessions.create', { agent: 'claude', project: 'ramas', permission: 'editar', title: 'hecho' });
  const tree = sessions.list().find((x) => x.title === 'wt');
  rememberRepo(repo, { branch: 'main' });
  sessions.update(old.id, { archived: true }); sessions.update(done.id, { settled: true }); sessions.update(tree.id, { settled: true });
  const rows = await call('sessions.list', {});
  assert.equal('branch' in rows.find((x) => x.id === done.id), false);
  assert.match(rows.find((x) => x.id === tree.id).branch, /^orb\/chat-/);
  assert.equal('branch' in (await call('sessions.list', { archived: true })).find((x) => x.id === old.id), false);
});

test('orbItems pasa branch y prNumber de un chat y la fila los pinta', () => {
  const [item] = orbItems({ sessions: [{ id: 's1', kind: 'chat', title: 'x', branch: 'orb/chat-1', prNumber: 7 }] });
  assert.equal(item.branch, 'orb/chat-1'); assert.equal(item.prNumber, 7);
  const [bare] = orbItems({ sessions: [{ id: 's2', kind: 'chat', title: 'y' }] });
  assert.equal('branch' in bare, false); assert.equal('prNumber' in bare, false);
  const jsx = read('src/ui/views/orb/inbox.jsx');
  assert.match(jsx, /item\.branch && p\.tone === 'muted'/);
  assert.match(jsx, /font-mono[^\n]*\{item\.branch\}/);
  assert.match(jsx, /text-primary-text[^\n]*#\{item\.prNumber\}/);
});
