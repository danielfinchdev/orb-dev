// 3.8.7 paso 9: «Local / Worktree» al abrir un chat directo. Repos temporales y un agente simulado:
// - un chat en Worktree trabaja en su propio git worktree (carpeta de Orb, fuera del repo) y en su rama orb/chat-<id>;
// - el agente escribe allí y la carpeta del proyecto no cambia; el permiso del chat es el que se pidió, no sube;
// - la guardia cuenta el worktree como «dentro del proyecto» y no deja salir de él;
// - nunca se borra trabajo sin confirmar: cambios sin commit o commits solo de la rama se conservan;
// - al archivar se puede quitar el worktree y al sacar el chat del archivo vuelve; al borrar el chat se limpia solo lo que no pierde nada.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS, allowed, principalOf } from '../src/domain/security/permissions.mjs';
import { decide } from '../src/domain/security/guard.mjs';
import { ctx } from '../src/platform/context.mjs';
import { git } from '../src/platform/git.mjs';
import { ChatWorktrees } from '../src/engine/chat-worktrees.mjs';

let t; let board; let api; let sessions; let repo; let sent;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const g = (dir, ...a) => git(dir, ...a).stdout.trim();
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const lower = (p) => path.resolve(p).toLowerCase();
const pause = (ms) => new Promise((res) => setTimeout(res, ms));

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'arbol'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A'); git(repo, ...ident, 'commit', '-q', '-m', 'first');
  git(repo, 'branch', 'dev');
  board.addProject({ name: 'arbol', path: repo }, 'usuario', { fromUser: true });
  // the simulated agent: «write <file>=<text>» writes it in the folder the chat works in.
  sent = [];
  sessions.getLive = (s) => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send({ text }) {
    sent.push({ text, cwd: s.cwd, permission: s.permission });
    const m = /write (\S+)=(\S+)/.exec(text); if (m) fs.writeFileSync(path.join(s.cwd, m[1]), `${m[2]}\n`);
    return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

// force needs the fingerprint of the status the user confirmed
const forceDiscard = async (id, extra = {}) => call('worktrees.discard', { id, force: true, fingerprint: (await call('worktrees.status', { id })).fingerprint, ...extra });
const mk = (extra = {}) => call('sessions.create', { agent: 'claude', project: 'arbol', permission: 'editar', title: 'x', workspace: 'worktree', ...extra });
async function say(id, text) {
  const n = sent.length; await call('sessions.send', { id, text });
  await until(() => sent.length > n && !sessions.isRunning(id), 'turno');
}

test('Worktree: the chat gets its own folder (outside the repo, in Orb) and branch; Local stays in the project', async () => {
  const local = await call('sessions.create', { agent: 'claude', project: 'arbol', permission: 'editar', title: 'l' });
  assert.equal(path.resolve(local.cwd), path.resolve(repo));
  assert.equal((await call('worktrees.status', { id: local.id })).has, false);
  const s = await mk();
  assert.notEqual(lower(s.cwd), lower(repo));
  assert.ok(lower(s.cwd).startsWith(lower(ctx.paths.chatTrees) + path.sep), s.cwd);
  assert.ok(!lower(s.cwd).startsWith(lower(repo) + path.sep));
  assert.equal(g(s.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), `orb/chat-${s.id.replace(/-/g, '').slice(0, 8)}`);
  assert.equal(s.permission, 'editar');
  const st = await call('worktrees.status', { id: s.id });
  assert.deepEqual([st.has, st.safe, st.dirty.length, st.ahead], [true, true, 0, 0]);
  // the agent works there; the project's folder and branch do not move
  const headBefore = g(repo, 'rev-parse', 'HEAD');
  await say(s.id, 'write nuevo.txt=hola');
  assert.equal(sent.at(-1).cwd, s.cwd);
  assert.ok(fs.existsSync(path.join(s.cwd, 'nuevo.txt')));
  assert.ok(!fs.existsSync(path.join(repo, 'nuevo.txt')));
  assert.equal(g(repo, 'status', '--porcelain'), '');
  assert.equal(g(repo, 'rev-parse', 'HEAD'), headBefore);
  assert.deepEqual((await call('worktrees.status', { id: s.id })).dirty, ['nuevo.txt']);
  await forceDiscard(s.id);
  await call('sessions.remove', { id: s.id }); await call('sessions.remove', { id: local.id });
});

test('Worktree starts from the chosen branch; a bad base or a non-git project fails and leaves nothing', async () => {
  git(repo, 'checkout', '-q', 'dev'); fs.writeFileSync(path.join(repo, 'dev.txt'), 'd\n'); git(repo, 'add', '-A'); git(repo, ...ident, 'commit', '-q', '-m', 'dev');
  git(repo, 'checkout', '-q', 'main');
  const s = await mk({ base: 'dev' });
  assert.ok(fs.existsSync(path.join(s.cwd, 'dev.txt')));
  assert.equal((await call('worktrees.branches', { project: 'arbol' })).current, 'main');
  const count = sessions.list().length;
  await assert.rejects(() => mk({ base: 'no-existe' }), /no existe|not exist/i);
  await assert.rejects(() => mk({ base: '--upload-pack=x' }), /no existe|not exist|válida|valid/i);
  assert.equal(sessions.list().length, count);
  const plain = path.join(t.home, 'web', 'sin-git'); fs.mkdirSync(plain, { recursive: true });
  board.addProject({ name: 'sin-git', path: plain }, 'usuario', { fromUser: true });
  await assert.rejects(() => mk({ project: 'sin-git' }), /git/i);
  await assert.rejects(() => call('sessions.create', { agent: 'claude', title: 'x', workspace: 'worktree' }), /proyecto|project/i);
  assert.equal(sessions.list().length, count);
  await call('sessions.remove', { id: s.id });
  await until(() => !fs.existsSync(s.cwd) && g(repo, 'branch', '--list', 'orb/chat-*') === '', 'carpeta y rama quitadas');
});

test('the guard counts the worktree as «dentro del proyecto» and keeps the agent from leaving it', async () => {
  const s = await mk();
  const args = { permission: 'editar', internalDir: ctx.paths.internal, cwd: s.cwd, projectDir: s.cwd };
  assert.equal(decide({ ...args, tool: 'Write', paths: [path.join(s.cwd, 'ok.txt')] }).decision, 'allow');
  assert.notEqual(decide({ ...args, tool: 'Write', paths: [path.join(os.homedir(), 'fuera-del-proyecto.txt')] }).decision, 'allow');
  assert.equal(decide({ ...args, permission: 'leer', tool: 'Write', paths: [path.join(s.cwd, 'ok.txt')] }).decision, 'deny');
  assert.equal(decide({ ...args, tool: 'Write', paths: [path.join(ctx.paths.internal, 'orb.db')] }).decision, 'deny');
  await call('sessions.remove', { id: s.id });
});

test('never deletes work unasked: changes not committed and commits only the branch has are kept', async () => {
  const s = await mk();
  await say(s.id, 'write wip.txt=1');
  // uncommitted work: the removal is refused, the folder and the record stay
  let r = await call('worktrees.discard', { id: s.id });
  assert.equal(r.removed, false); assert.equal(r.kept, 'dirty'); assert.deepEqual(r.dirty, ['wip.txt']);
  assert.ok(fs.existsSync(path.join(s.cwd, 'wip.txt')));
  // deleting the chat does not take it either, and the user is told
  await call('sessions.remove', { id: s.id });
  await until(() => board.all('SELECT * FROM chat ORDER BY id DESC LIMIT 10').some((m) => /conserv|kept/i.test(JSON.stringify(m))), 'aviso');
  assert.ok(fs.existsSync(path.join(s.cwd, 'wip.txt')), 'the folder of a deleted chat is kept when it holds work');
  assert.equal((await call('worktrees.list')).filter((x) => x.id === s.id).length, 1);
  assert.ok(board.all('SELECT * FROM chat ORDER BY id DESC LIMIT 10').some((m) => /conserv|kept/i.test(JSON.stringify(m))), 'the user is told');
  // committed, then removed: the folder goes, the branch with its commit stays (it exists nowhere else)
  git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'work');
  const branch = g(s.cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  r = await call('worktrees.discard', { id: s.id });
  assert.equal(r.removed, true); assert.equal(r.branchKept, true);
  assert.ok(!fs.existsSync(s.cwd));
  assert.notEqual(g(repo, 'branch', '--list', branch), '');
  assert.equal(g(repo, 'show', `${branch}:wip.txt`), '1');
  assert.equal((await call('worktrees.list')).filter((x) => x.id === s.id).length, 0);
  git(repo, 'branch', '-D', branch);
});

test('force, after the user confirmed, discards the uncommitted work but not the branch commits', async () => {
  const s = await mk();
  await say(s.id, 'write a.txt=cambiado');
  git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'c');
  fs.writeFileSync(path.join(s.cwd, 'sucio.txt'), 's\n');
  const branch = g(s.cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  const r = await forceDiscard(s.id);
  assert.equal(r.removed, true); assert.equal(r.branchKept, true, 'its commit is not lost without asking for it');
  assert.ok(!fs.existsSync(s.cwd));
  assert.equal(g(repo, 'status', '--porcelain'), '');
  assert.notEqual(g(repo, 'branch', '--list', branch), '');
  await call('sessions.remove', { id: s.id });
  git(repo, 'branch', '-D', branch);
});

test('archive → discard the worktree → restore: the chat gets its folder back; a merged branch goes with it', async () => {
  const s = await mk();
  await say(s.id, 'write hecho.txt=1');
  git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'hecho');
  const branch = g(s.cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(repo, ...ident, 'merge', '-q', '--no-edit', branch); // the user took the work into main
  assert.equal((await call('worktrees.status', { id: s.id })).safe, true);
  await call('sessions.update', { id: s.id, archived: true });
  const r = await call('worktrees.discard', { id: s.id });
  assert.deepEqual([r.removed, r.branchKept], [true, undefined]);
  assert.ok(!fs.existsSync(s.cwd));
  assert.equal(g(repo, 'branch', '--list', branch), '');
  assert.ok(fs.existsSync(path.join(repo, 'hecho.txt')), 'the merged work is in the project');
  const back = await call('sessions.update', { id: s.id, archived: false });
  assert.equal(back.archived, false);
  assert.ok(fs.existsSync(s.cwd)); assert.equal(g(s.cwd, 'status', '--porcelain'), '');
  await call('sessions.remove', { id: s.id });
  await until(() => !fs.existsSync(s.cwd), 'carpeta quitada');
});

test('a folder is only touched when it is inside Orb\'s chats folder; a fork sharing it keeps it alive', async () => {
  const s = await mk();
  board.settingJson(`chatwt:${s.id}`, { ...board.settingJson(`chatwt:${s.id}`), path: repo });
  const r = await forceDiscard(s.id);
  assert.equal(r.removed, false);
  assert.ok(fs.existsSync(path.join(repo, 'a.txt')), 'the project folder is never removed');
  const s2 = await mk();
  const fork = sessions.create({ agent: 'claude', project: 'arbol', cwd: s2.cwd, title: 'fork', parentId: s2.id });
  const kept = await call('worktrees.discard', { id: s2.id });
  assert.equal(kept.kept, 'shared'); assert.ok(fs.existsSync(s2.cwd));
  sessions.remove(fork.id);
  assert.equal((await call('worktrees.discard', { id: s2.id })).removed, true);
  board.settingJson(`chatwt:${s.id}`, null);
});

test('discarding a chat that has no worktree says so; the startup cleanup of task copies leaves the chats folder alone', async () => {
  const local = await call('sessions.create', { agent: 'claude', project: 'arbol', permission: 'editar', title: 'l' });
  await assert.rejects(() => call('worktrees.discard', { id: local.id }), /worktree/i);
  const s = await mk();
  const sched = new Scheduler(board, sessions, { orchestrator: new Orchestrator(board, { emit() {} }), emit() {} });
  sched.pruneCopies();
  assert.ok(fs.existsSync(s.cwd), 'pruneCopies did not take the chat worktree');
  await call('sessions.remove', { id: s.id }); await call('sessions.remove', { id: local.id });
});

test('review fixes: the root .git file is guarded, orb/ bases are refused, ignored files and detached commits count as work', async () => {
  const s = await mk();
  const args = { permission: 'editar', internalDir: ctx.paths.internal, cwd: s.cwd, projectDir: s.cwd };
  assert.notEqual(decide({ ...args, tool: 'Write', paths: [path.join(s.cwd, '.git')] }).decision, 'allow');
  await assert.rejects(() => mk({ base: g(s.cwd, 'rev-parse', '--abbrev-ref', 'HEAD') }), /no existe|not exist|válida|valid/i);
  // an ignored file is work too
  fs.writeFileSync(path.join(s.cwd, '.gitignore'), 'secreto.env\n'); git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'ign');
  fs.writeFileSync(path.join(s.cwd, 'secreto.env'), 'k=1\n');
  let r = await call('worktrees.discard', { id: s.id });
  assert.equal(r.kept, 'dirty'); assert.ok(r.dirty.some((p) => /secreto\.env/.test(p)));
  fs.rmSync(path.join(s.cwd, 'secreto.env'));
  // commits on a detached HEAD are in no branch
  const tip = g(s.cwd, 'rev-parse', 'HEAD');
  git(s.cwd, 'checkout', '-q', '--detach'); fs.writeFileSync(path.join(s.cwd, 'suelto.txt'), 's\n'); git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'suelto');
  r = await call('worktrees.discard', { id: s.id });
  assert.equal(r.kept, 'dirty'); assert.ok(r.dirty.some((p) => /detached/.test(p)));
  git(s.cwd, 'checkout', '-q', `orb/chat-${s.id.replace(/-/g, '').slice(0, 8)}`);
  assert.equal(g(s.cwd, 'rev-parse', 'HEAD'), tip);
  r = await forceDiscard(s.id);
  assert.equal(r.removed, true);
  await call('sessions.remove', { id: s.id });
  git(repo, 'branch', '-D', `orb/chat-${s.id.replace(/-/g, '').slice(0, 8)}`);
});

test('worktrees.status lists files without a commit, so it stays on the PC like the other worktree methods', () => {
  assert.equal(METHODS['worktrees.status'], 'pc');
  assert.equal(allowed(principalOf({ device: { id: 'd', kind: 'phone' } }), 'worktrees.status'), false);
  assert.equal(allowed(DESKTOP, 'worktrees.status'), true);
});

test('regenerable ignored folders do not make a worktree dirty; other ignored files still do', async () => {
  const s = await mk();
  fs.writeFileSync(path.join(s.cwd, '.gitignore'), 'node_modules/\n.env\n'); git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'ign2');
  fs.mkdirSync(path.join(s.cwd, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(s.cwd, 'node_modules', 'x.js'), '1\n');
  let st = await call('worktrees.status', { id: s.id });
  assert.deepEqual(st.dirty, []); assert.ok(st.regenerable >= 1);
  fs.writeFileSync(path.join(s.cwd, '.env'), 'k=1\n');
  st = await call('worktrees.status', { id: s.id });
  assert.equal(st.safe, false); assert.ok(st.dirty.some((p) => /\.env/.test(p)));
  fs.rmSync(path.join(s.cwd, '.env'));
  const r = await call('worktrees.discard', { id: s.id });
  assert.equal(r.removed, true);
  assert.ok(!fs.existsSync(s.cwd));
  await call('sessions.remove', { id: s.id });
});

test('a moved or renamed project: status and release find the repository again and the record follows', async () => {
  const dir = path.join(t.home, 'web', 'mover'); fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'f');
  board.addProject({ name: 'mover', path: dir }, 'usuario', { fromUser: true });
  const s = await call('sessions.create', { agent: 'claude', project: 'mover', permission: 'editar', title: 'm', workspace: 'worktree' });
  const moved = path.join(t.home, 'web', 'movido');
  // moved by hand and the project pointed at its new folder: the worktree's own .git still names the old path
  fs.renameSync(dir, moved); board.run('UPDATE projects SET path = ? WHERE name = ?', moved, 'mover');
  const st = await call('worktrees.status', { id: s.id });
  assert.equal(st.has, true); assert.equal(st.orphan, false);
  assert.equal(lower(board.settingJson(`chatwt:${s.id}`).repo), lower(moved));
  const r = await call('worktrees.discard', { id: s.id });
  assert.equal(r.removed, true); assert.equal(git(moved, 'branch', '--list', 'orb/*').stdout.trim(), '');
  await call('sessions.remove', { id: s.id });
});

test('renaming the project in Orb updates the chat records', async () => {
  const dir = path.join(t.home, 'web', 'viejo'); fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'f');
  board.addProject({ name: 'viejo', path: dir }, 'usuario', { fromUser: true });
  const s = await call('sessions.create', { agent: 'claude', project: 'viejo', permission: 'editar', title: 'v', workspace: 'worktree' });
  await call('sessions.update', { id: s.id, archived: true });
  await call('projects.rename', { name: 'viejo', to: 'nuevo' });
  const rec = board.settingJson(`chatwt:${s.id}`);
  assert.equal(rec.project, 'nuevo'); assert.equal(lower(rec.repo), lower(path.join(t.home, 'web', 'nuevo')));
  assert.equal((await call('worktrees.discard', { id: s.id })).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('a deleted repository leaves an orphan folder: removed when empty, kept until force when it holds files', async () => {
  const dir = path.join(t.home, 'web', 'borrable'); fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'f');
  board.addProject({ name: 'borrable', path: dir }, 'usuario', { fromUser: true });
  const a = await call('sessions.create', { agent: 'claude', project: 'borrable', permission: 'editar', title: 'a', workspace: 'worktree' });
  const b = await call('sessions.create', { agent: 'claude', project: 'borrable', permission: 'editar', title: 'b', workspace: 'worktree' });
  fs.writeFileSync(path.join(b.cwd, 'work.txt'), 'w\n');
  // the worktree's .git file points into the repo, so with the repo gone git no longer works inside it
  fs.rmSync(dir, { recursive: true, force: true });
  let r = await call('worktrees.discard', { id: a.id });
  // without its repository git cannot say what changed: a folder with files needs force, one with only the .git pointer does not
  assert.equal(r.kept, 'unverified'); assert.ok(r.dirty.some((p) => /a.txt/.test(p)));
  for (const f of fs.readdirSync(a.cwd)) if (f !== '.git') fs.rmSync(path.join(a.cwd, f), { recursive: true, force: true });
  r = await call('worktrees.discard', { id: a.id });
  assert.equal(r.removed, true); assert.ok(!fs.existsSync(a.cwd));
  // Orb cannot see what an orphan holds: not even force from the app removes it; only the explicit engine option does
  r = await call('worktrees.discard', { id: b.id });
  assert.equal(r.kept, 'unverified'); assert.ok(fs.existsSync(b.cwd));
  r = await forceDiscard(b.id);
  assert.equal(r.kept, 'unverified'); assert.ok(fs.existsSync(b.cwd));
  r = await new ChatWorktrees({ board, sessions }).release(b.id, { force: true, unverified: true });
  assert.equal(r.removed, true); assert.ok(!fs.existsSync(b.cwd));
});

test('forcing a worktree removal is not available from the phone', () => {
  assert.equal(METHODS['worktrees.discard'], 'pc');
});

test('ignored files inside folders that are not themselves ignored stay work; an ignored node_modules does not', async () => {
  const s = await mk();
  fs.writeFileSync(path.join(s.cwd, '.gitignore'), 'node_modules/\n.env\n*.db\n'); git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'ign3');
  fs.mkdirSync(path.join(s.cwd, 'node_modules')); fs.writeFileSync(path.join(s.cwd, 'node_modules', 'x.js'), '1\n');
  fs.mkdirSync(path.join(s.cwd, 'out')); fs.writeFileSync(path.join(s.cwd, 'out', 'app.db'), '1\n');
  fs.mkdirSync(path.join(s.cwd, 'target')); fs.writeFileSync(path.join(s.cwd, 'target', '.env'), 'k=1\n');
  const st = await call('worktrees.status', { id: s.id });
  assert.ok(st.dirty.some((p) => /out\/app\.db/.test(p)) && st.dirty.some((p) => /target\/\.env/.test(p)), JSON.stringify(st.dirty));
  assert.ok(!st.dirty.some((p) => /node_modules/.test(p)));
  assert.equal((await call('worktrees.discard', { id: s.id })).kept, 'dirty');
  assert.ok(fs.existsSync(path.join(s.cwd, 'out', 'app.db')));
  assert.equal((await forceDiscard(s.id)).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('force only removes what the user was shown: a file that appeared after is kept; the real total is reported', async () => {
  const s = await mk();
  fs.writeFileSync(path.join(s.cwd, 'one.txt'), '1\n');
  const st = await call('worktrees.status', { id: s.id });
  assert.equal(st.dirtyTotal, 1);
  fs.writeFileSync(path.join(s.cwd, 'two.txt'), '2\n');
  let r = await call('worktrees.discard', { id: s.id, force: true, fingerprint: st.fingerprint });
  assert.equal(r.kept, 'dirty'); assert.equal(r.dirtyTotal, 2); assert.ok(fs.existsSync(path.join(s.cwd, 'two.txt')));
  const again = await call('worktrees.status', { id: s.id });
  r = await call('worktrees.discard', { id: s.id, force: true, fingerprint: again.fingerprint });
  assert.equal(r.removed, true);
  await call('sessions.remove', { id: s.id });
});

test('a recorded repository that is not the worktree own is not trusted', async () => {
  const s = await mk();
  const other = path.join(t.home, 'web', 'otro'); fs.mkdirSync(path.join(other, 'sub'), { recursive: true });
  git(other, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(other, 'b.txt'), '1\n'); git(other, 'add', '-A'); git(other, ...ident, 'commit', '-q', '-m', 'f');
  const key = `chatwt:${s.id}`; const rec = board.settingJson(key);
  board.settingJson(key, { ...rec, repo: path.join(other, 'sub') });
  const st = await call('worktrees.status', { id: s.id });
  assert.equal(st.orphan, false); assert.equal(lower(board.settingJson(key).repo), lower(rec.repo));
  assert.equal((await call('worktrees.discard', { id: s.id })).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('force without the current fingerprint keeps the folder, also when the change is beyond the 50 files shown', async () => {
  const s = await mk();
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(s.cwd, 'f' + String(i).padStart(2, '0') + '.txt'), 'x');
  const st = await call('worktrees.status', { id: s.id });
  assert.equal(st.dirtyTotal, 60); assert.equal(st.dirty.length, 50);
  assert.equal((await call('worktrees.discard', { id: s.id, force: true })).changed, true); // no fingerprint at all
  fs.rmSync(path.join(s.cwd, 'f59.txt')); fs.writeFileSync(path.join(s.cwd, 'f60.txt'), 'x'); // one leaves, one enters, outside the shown 50
  const r = await call('worktrees.discard', { id: s.id, force: true, fingerprint: st.fingerprint });
  assert.equal(r.kept, 'dirty'); assert.equal(r.changed, true); assert.ok(fs.existsSync(path.join(s.cwd, 'f60.txt')));
  assert.equal((await forceDiscard(s.id)).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('ignored files that are not regenerable are listed before the rest, so they are among the 50 shown', async () => {
  const s = await mk();
  fs.writeFileSync(path.join(s.cwd, '.gitignore'), '.env');
  git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'ign4');
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(s.cwd, 'a' + String(i).padStart(2, '0') + '.txt'), 'x');
  fs.writeFileSync(path.join(s.cwd, '.env'), 'k=1');
  const st = await call('worktrees.status', { id: s.id });
  assert.ok(st.dirty[0].includes('.env'));
  assert.equal((await forceDiscard(s.id)).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('a project folder that did not make the worktree is never used to repair it', async () => {
  const s = await mk();
  const key = 'chatwt:' + s.id; const rec = board.settingJson(key);
  const other = path.join(t.home, 'web', 'ajeno'); fs.mkdirSync(other, { recursive: true });
  git(other, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(other, 'b.txt'), '1'); git(other, 'add', '-A'); git(other, ...ident, 'commit', '-q', '-m', 'f');
  // the other repository administers a worktree under the same folder name
  const twin = path.join(t.home, 'gemelo', path.basename(rec.path));
  git(other, 'worktree', 'add', '-q', '-b', 'otra', twin);
  const admin = path.join(other, '.git', 'worktrees', path.basename(rec.path), 'gitdir');
  const before = fs.readFileSync(admin, 'utf8');
  const gitFile = path.join(rec.path, '.git'); fs.renameSync(gitFile, gitFile + '.off');
  board.run('UPDATE projects SET path = ? WHERE name = ?', other, 'arbol');
  const st = await call('worktrees.status', { id: s.id });
  assert.equal(st.orphan, true);
  assert.equal(fs.readFileSync(admin, 'utf8'), before); assert.ok(!fs.existsSync(gitFile));
  board.run('UPDATE projects SET path = ? WHERE name = ?', repo, 'arbol'); fs.renameSync(gitFile + '.off', gitFile);
  assert.equal((await call('worktrees.discard', { id: s.id })).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('the commit dialog of a Worktree chat lists and commits the chat\'s own changes, on its own branch; a Local chat uses the project', async () => {
  const s = await mk();
  const local = await call('sessions.create', { agent: 'claude', project: 'arbol', permission: 'editar', title: 'l' });
  fs.writeFileSync(path.join(s.cwd, 'del-chat.txt'), 'chat\n');
  fs.writeFileSync(path.join(repo, 'de-la-carpeta.txt'), 'main\n');
  const branch = `orb/chat-${s.id.replace(/-/g, '').slice(0, 8)}`;
  const mainBefore = g(repo, 'rev-parse', 'HEAD');
  assert.deepEqual((await call('projects.commitFiles', { name: 'arbol', session: s.id })).map((f) => f.path), ['del-chat.txt']);
  assert.deepEqual((await call('projects.commitFiles', { name: 'arbol', session: local.id })).map((f) => f.path), ['de-la-carpeta.txt']);
  assert.deepEqual((await call('projects.commitFiles', { name: 'arbol' })).map((f) => f.path), ['de-la-carpeta.txt']);
  const out = await call('projects.commit', { name: 'arbol', session: s.id, message: 'feat: chat work', files: ['del-chat.txt'] });
  assert.equal(out.branch, branch);
  assert.equal(g(s.cwd, 'show', '--name-only', '--format=', 'HEAD'), 'del-chat.txt');
  assert.equal(g(repo, 'rev-parse', 'HEAD'), mainBefore, 'the project folder\'s branch did not move');
  assert.ok(fs.existsSync(path.join(repo, 'de-la-carpeta.txt')) && g(repo, 'status', '--porcelain').includes('de-la-carpeta.txt'));
  // a Local chat commits in the project's folder
  const outLocal = await call('projects.commit', { name: 'arbol', session: local.id, message: 'chore: main work', files: ['de-la-carpeta.txt'] });
  assert.equal(outLocal.branch, 'main');
  // the session is checked: unknown, or of another project, never a path from the caller
  await assert.rejects(() => call('projects.commitFiles', { name: 'arbol', session: 'no-such-chat' }));
  await assert.rejects(() => call('projects.commitFiles', { name: 'arbol', session: s.cwd }));
  assert.equal((await forceDiscard(s.id, { branch: 'keep' })).removed, true);
  await call('sessions.remove', { id: s.id }); await call('sessions.remove', { id: local.id });
});

test('/review refuses a Worktree chat instead of reviewing the project folder', async () => {
  const s = await mk();
  fs.writeFileSync(path.join(s.cwd, 'x.txt'), 'x\n');
  const scheduler = new Scheduler(board, sessions, { orchestrator: new Orchestrator(board, { emit() {} }), emit() {} });
  assert.throws(() => scheduler.reviewChat(sessions.get(s.id), {}), /copia propia/);
  assert.equal((await forceDiscard(s.id)).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('deleting a chat whose folder was already removed still drops its rescue refs from the repository', async () => {
  const s = await mk();
  const ref = `refs/orb/rescate/${s.id}/1`;
  git(repo, 'update-ref', ref, 'HEAD');
  assert.equal((await call('worktrees.discard', { id: s.id, branch: 'keep' })).removed, true);
  assert.ok(!fs.existsSync(s.cwd));
  await call('sessions.remove', { id: s.id });
  assert.equal(g(repo, 'for-each-ref', `refs/orb/rescate/${s.id}`), '');
});

test('the chats folder is core\copias\chats, outside the task copies that an older pruneCopies sweeps', async () => {
  assert.equal(path.basename(ctx.paths.chatTrees), 'chats');
  assert.equal(path.dirname(ctx.paths.chatTrees), path.dirname(ctx.paths.worktrees));
  assert.ok(!lower(ctx.paths.chatTrees).startsWith(lower(ctx.paths.worktrees) + path.sep));
  const s = await mk();
  assert.ok(lower(s.cwd).startsWith(lower(ctx.paths.chatTrees) + path.sep));
  // an old record under aisladas\chats stays removable
  const cw = new ChatWorktrees({ board, sessions });
  assert.equal(cw.managed(path.join(ctx.paths.worktrees, 'chats', 'x-1')), true);
  assert.equal(cw.managed(path.join(ctx.paths.worktrees, 'otra', 'x-1')), false);
  assert.equal((await call('worktrees.discard', { id: s.id })).removed, true);
  await call('sessions.remove', { id: s.id });
});

test('worktrees.list says which chat each copy has left', async () => {
  const s = await mk();
  const row = (await call('worktrees.list')).find((r) => r.id === s.id);
  assert.deepEqual([row.gone, row.chat.archived], [false, false]);
  await call('sessions.remove', { id: s.id });
  await until(() => !board.settingJson(`chatwt:${s.id}`), 'copia quitada');
  assert.equal((await call('worktrees.list')).find((r) => r.id === s.id), undefined, 'a clean copy went with its chat');
});
