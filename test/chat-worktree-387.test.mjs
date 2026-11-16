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
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { decide } from '../src/domain/security/guard.mjs';
import { ctx } from '../src/platform/context.mjs';
import { git } from '../src/platform/git.mjs';

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
  await call('worktrees.discard', { id: s.id, force: true });
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
  await pause(500);
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
  const r = await call('worktrees.discard', { id: s.id, force: true });
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
  const r = await call('worktrees.discard', { id: s.id, force: true });
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
