// 3.8.8 step 11b (G3), engine: God mode's git panel. Switching branch, creating one and undoing the last unpublished save,
// against temporary repositories (the remote is a local bare one). None of them may lose work or run for the phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS, principalOf } from '../src/domain/security/permissions.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const keepAlive = setInterval(() => {}, 1000);
let mono; let t; let board; let api; let sessions; let scheduler; let repo; let remote; let plain;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const refused = (promise, re) => assert.rejects(promise, (e) => { if (re) assert.match(e.message, re); return true; });
const commit = (dir, file, text, msg) => { fs.writeFileSync(path.join(dir, file), text); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };
const here = () => git(repo, 'branch', '--show-current');
const head = () => git(repo, 'rev-parse', 'HEAD');

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  remote = path.join(t.home, 'remote.git'); repo = path.join(t.home, 'web', 'tienda'); plain = path.join(t.home, 'web', 'nuevo');
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(plain, { recursive: true });
  git(t.home, 'init', '-q', '--bare', '-b', 'main', remote);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'T'); git(repo, 'config', 'user.email', 't@example.com');
  commit(repo, 'a.txt', 'one\n', 'chore: first');
  git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'branch', 'feature'); git(repo, 'branch', 'other');
  git(plain, 'init', '-q', '-b', 'main'); git(plain, 'config', 'user.name', 'T'); git(plain, 'config', 'user.email', 't@example.com');
  board.addProject({ name: 'tienda', path: repo }, 'usuario', { fromUser: true });
  mono = path.join(t.home, 'web', 'mono'); fs.mkdirSync(path.join(mono, 'app'), { recursive: true });
  git(mono, 'init', '-q', '-b', 'main'); git(mono, 'config', 'user.name', 'T'); git(mono, 'config', 'user.email', 't@example.com');
  commit(mono, 'app/x.txt', 'x\n', 'chore: first'); git(mono, 'branch', 'side');
  board.addProject({ name: 'mono', path: path.join(mono, 'app') }, 'usuario', { fromUser: true });
  board.addProject({ name: 'nuevo', path: plain }, 'usuario', { fromUser: true });
});
after(() => { clearInterval(keepAlive); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('expert.branches lists the local branches and marks the current one', async () => {
  const r = await call('expert.branches', { project: 'tienda' });
  assert.deepEqual(r.branches.map((b) => b.name).sort(), ['feature', 'main', 'other']);
  assert.equal(r.branches.find((b) => b.current).name, 'main');
});

test('switchBranch: clean tree switches; the same branch is a no-op; unknown or odd names are refused and nothing moves', async () => {
  assert.equal((await call('expert.switchBranch', { project: 'tienda', branch: 'feature' })).branch, 'feature');
  assert.equal(here(), 'feature');
  assert.equal((await call('expert.switchBranch', { project: 'tienda', branch: 'feature' })).already, true);
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'nope' }), /no existe|does not exist/);
  for (const bad of ['-x', '--detach', 'a..b', 'a b', 'refs/heads/main^', 'x;y', 'HEAD']) await refused(call('expert.switchBranch', { project: 'tienda', branch: bad }));
  // a tag is not a local branch: it is never switched to
  git(repo, 'tag', 'v1');
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'v1' }), /no existe|does not exist/);
  assert.equal(here(), 'feature');
  await call('expert.switchBranch', { project: 'tienda', branch: 'main' });
});

test('switchBranch with unsaved changes (modified or untracked) is refused and the tree is untouched', async () => {
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  const before = head();
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'feature' }), /sin guardar|unsaved/);
  assert.equal(here(), 'main'); assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'changed\n'); assert.equal(head(), before);
  git(repo, 'checkout', '-q', '--', 'a.txt');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x\n');
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'feature' }), /sin guardar|unsaved/);
  assert.equal(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8'), 'x\n');
  fs.unlinkSync(path.join(repo, 'new.txt'));
});

test('switchBranch refuses a branch open in another worktree and any project that is busy', async () => {
  const wt = path.join(t.home, 'wt'); git(repo, 'worktree', 'add', '-q', wt, 'other');
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'other' }), /otra carpeta|another working folder/);
  git(repo, 'worktree', 'remove', '--force', wt);
  const release = scheduler.hold('tienda');
  try { await refused(call('expert.switchBranch', { project: 'tienda', branch: 'feature' }), /trabajando|working/); } finally { release(); }
  assert.equal(here(), 'main');
});

test('createBranch: valid names, with and without switch; invalid and existing names are refused', async () => {
  assert.equal((await call('expert.createBranch', { project: 'tienda', name: 'mi-cambio' })).switched, false);
  assert.equal(here(), 'main'); assert.ok(git(repo, 'branch', '--list', 'mi-cambio'));
  // unsaved changes are safe to carry to a new branch: they stay in the tree
  fs.writeFileSync(path.join(repo, 'a.txt'), 'carried\n');
  assert.equal((await call('expert.createBranch', { project: 'tienda', name: 'feat/two', switch: true })).switched, true);
  assert.equal(here(), 'feat/two'); assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'carried\n');
  git(repo, 'checkout', '-q', '--', 'a.txt'); await call('expert.switchBranch', { project: 'tienda', branch: 'main' });
  await refused(call('expert.createBranch', { project: 'tienda', name: 'main' }), /ya existe|already exists/);
  for (const bad of ['-x', 'a..b', 'a b', 'refs/../x', 'x.lock', 'a/', 'HEAD', '@', 'a~1']) await refused(call('expert.createBranch', { project: 'tienda', name: bad }));
  await refused(call('expert.createBranch', { project: 'nuevo', name: 'x' }), /ningún guardado|no saves/);
  const release = scheduler.hold('tienda');
  try { await refused(call('expert.createBranch', { project: 'tienda', name: 'busy' }), /trabajando|working/); } finally { release(); }
  assert.equal(git(repo, 'branch', '--list', 'busy'), '');
});

test('undoCommit: a local save goes back to the tree and the index, byte for byte; nothing is lost', async () => {
  fs.writeFileSync(path.join(repo, 'b.bin'), Buffer.from([0, 1, 2, 255, 10, 13]));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'feat: local save');
  const last = await call('expert.lastCommit', { project: 'tienda' });
  assert.equal(last.canUndo, true); assert.equal(last.subject, 'feat: local save');
  const parent = git(repo, 'rev-parse', 'HEAD~1');
  await refused(call('expert.undoCommit', { project: 'tienda', hash: 'f'.repeat(40) }), /cambiado|changed/);
  const out = await call('expert.undoCommit', { project: 'tienda', hash: last.hash });
  assert.equal(out.subject, 'feat: local save'); assert.equal(head(), parent);
  assert.deepEqual(fs.readFileSync(path.join(repo, 'b.bin')), Buffer.from([0, 1, 2, 255, 10, 13]));
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'two\n');
  assert.match(git(repo, 'diff', '--cached', '--name-only'), /a\.txt/); // soft: the changes are staged again
  git(repo, 'commit', '-q', '-m', 'feat: again');
});

test('undoCommit refuses a save already pushed to the remote, a merge, the first commit and a busy project', async () => {
  git(repo, 'push', '-q', 'origin', 'main');
  assert.equal((await call('expert.lastCommit', { project: 'tienda' })).reason, 'pushed');
  const pushed = head();
  await refused(call('expert.undoCommit', { project: 'tienda' }), /subió|pushed/);
  assert.equal(head(), pushed);
  // a merge commit (the remote branch is dropped so only the merge rule can refuse)
  git(repo, 'switch', '-q', '-c', 'side'); commit(repo, 's.txt', 's\n', 'feat: side'); git(repo, 'switch', '-q', 'main'); commit(repo, 'm.txt', 'm\n', 'feat: main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
  assert.equal((await call('expert.lastCommit', { project: 'tienda' })).reason, 'merge');
  await refused(call('expert.undoCommit', { project: 'tienda' }), /fusión|merge/);
  // the very first commit of a repository
  commit(plain, 'f.txt', '1\n', 'chore: first');
  assert.equal((await call('expert.lastCommit', { project: 'nuevo' })).reason, 'first');
  await refused(call('expert.undoCommit', { project: 'nuevo' }), /primer|first/);
  // a local save while something works in the project
  git(repo, 'reset', '-q', '--hard', 'HEAD~1'); commit(repo, 'w.txt', 'w\n', 'feat: busy');
  const release = scheduler.hold('tienda');
  try { await refused(call('expert.undoCommit', { project: 'tienda' }), /trabajando|working/); } finally { release(); }
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'feat: busy');
});

test('a linked phone cannot call any of the git-panel methods', async () => {
  for (const m of ['expert.branches', 'expert.lastCommit', 'expert.switchBranch', 'expert.createBranch', 'expert.undoCommit']) {
    assert.equal(METHODS[m], 'pc');
    await refused(call(m, { project: 'tienda', branch: 'main', name: 'x' }, REMOTE));
  }
  assert.equal(here(), 'main');
});

test('orb/ branches are Orb own: not created, not switched to, and the list marks them', async () => {
  await refused(call('expert.createBranch', { project: 'tienda', name: 'orb/42-cart' }), /orb/);
  git(repo, 'branch', 'orb/task-1');
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'orb/task-1' }), /orb/);
  assert.equal((await call('expert.branches', { project: 'tienda' })).branches.find((b) => b.name === 'orb/task-1').orb, true);
  assert.equal(here(), 'main');
});

test('switchBranch refuses to overwrite an IGNORED local file that the other branch tracks, and leaves it byte for byte', async () => {
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'chore: ignore env');
  git(repo, 'switch', '-q', '-c', 'envbr'); fs.writeFileSync(path.join(repo, '.env'), 'REMOTE=1\n'); git(repo, 'add', '-f', '.env'); git(repo, 'commit', '-q', '-m', 'chore: env');
  git(repo, 'switch', '-q', 'main');
  const secret = Buffer.from('KEY=local-secret\r\n\x00\xff');
  fs.writeFileSync(path.join(repo, '.env'), secret);
  assert.equal(git(repo, 'status', '--porcelain'), ''); // ignored: git status does not show it
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'envbr' }), /\.env/);
  assert.equal(here(), 'main'); assert.deepEqual(fs.readFileSync(path.join(repo, '.env')), secret);
  fs.unlinkSync(path.join(repo, '.env'));
});

test('a detached HEAD with commits on no branch cannot be left; one that a branch holds can', async () => {
  git(repo, 'checkout', '-q', '--detach', 'main');
  assert.equal((await call('expert.switchBranch', { project: 'tienda', branch: 'feature' })).already, false);
  git(repo, 'checkout', '-q', '--detach', 'main'); commit(repo, 'orphan.txt', 'o\n', 'feat: orphan');
  const orphan = head();
  assert.equal((await call('expert.lastCommit', { project: 'tienda' })).reason, 'detached');
  await refused(call('expert.undoCommit', { project: 'tienda' }), /HEAD/);
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'main' }), /ninguna rama|no branch/);
  await refused(call('expert.createBranch', { project: 'tienda', name: 'x1', switch: true }), /ninguna rama|no branch/);
  assert.equal(head(), orphan);
  git(repo, 'branch', 'rescue'); await call('expert.switchBranch', { project: 'tienda', branch: 'main' });
});

test('any existing local branch can be switched to, whatever its characters; options and missing ones cannot', async () => {
  git(repo, 'branch', 'función'); git(repo, 'branch', 'fix+x');
  for (const b of ['función', 'fix+x']) { assert.equal((await call('expert.switchBranch', { project: 'tienda', branch: b })).branch, b); await call('expert.switchBranch', { project: 'tienda', branch: 'main' }); }
  await refused(call('expert.switchBranch', { project: 'tienda', branch: '--orphan' })); await refused(call('expert.switchBranch', { project: 'tienda', branch: 'nada' }));
});

test('a file hidden with skip-worktree or assume-unchanged stops a switch, naming it', async () => {
  git(repo, 'update-index', '--skip-worktree', 'a.txt');
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'feature' }), /a\.txt/);
  git(repo, 'update-index', '--no-skip-worktree', 'a.txt'); git(repo, 'update-index', '--assume-unchanged', 'a.txt');
  await refused(call('expert.switchBranch', { project: 'tienda', branch: 'feature' }), /a\.txt/);
  git(repo, 'update-index', '--no-assume-unchanged', 'a.txt');
  assert.equal(here(), 'main');
});

test('a half-done merge or cherry-pick stops a switch and an undo', async () => {
  const mark = path.join(repo, '.git', 'CHERRY_PICK_HEAD'); fs.writeFileSync(mark, head() + '\n');
  try {
    await refused(call('expert.switchBranch', { project: 'tienda', branch: 'feature' }), /a medias|half done/);
    await refused(call('expert.undoCommit', { project: 'tienda' }), /a medias|half done/);
  } finally { fs.unlinkSync(mark); }
});

test('a project that is a folder of a bigger repository does not switch, create-and-switch or undo from here', async () => {
  await refused(call('expert.switchBranch', { project: 'mono', branch: 'side' }), /comparte repositorio|shares its repository/);
  await refused(call('expert.createBranch', { project: 'mono', name: 'n1', switch: true }), /comparte repositorio|shares its repository/);
  assert.equal((await call('expert.lastCommit', { project: 'mono' })).reason, 'shared');
  await refused(call('expert.undoCommit', { project: 'mono' }), /comparte repositorio|shares its repository/);
  assert.equal(git(mono, 'branch', '--show-current'), 'main'); assert.equal(git(mono, 'branch', '--list', 'n1'), '');
});

test('the save list of the panel is the commit dialog list: a new folder comes with its files and all of them are saved', async () => {
  fs.mkdirSync(path.join(repo, 'newdir', 'deep'), { recursive: true });
  for (const f of ['newdir/a.js', 'newdir/b.js', 'newdir/deep/c.js']) fs.writeFileSync(path.join(repo, f), f);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
  const list = await call('projects.commitFiles', { name: 'tienda' });
  assert.deepEqual(list.map((x) => x.path).sort(), ['a.txt', 'newdir/a.js', 'newdir/b.js', 'newdir/deep/c.js']);
  const out = await call('projects.commit', { name: 'tienda', message: 'feat: folder', files: list.map((x) => x.path), push: false });
  assert.equal(out.files, 4); assert.equal(git(repo, 'status', '--porcelain'), '');
});
