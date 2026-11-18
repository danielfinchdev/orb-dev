// 3.8.8 paso 11b (tanda 1), motor: «Marcar como no leído», la rama del chat sin worktree leída de .git/HEAD, la PR de una
// rama en cualquier estado (gh simulado: nada de red) y la sesión de la que nace una tarea.
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
import { DESKTOP, METHODS, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';
import { rememberRepo, forgetRepos, cachedPr, liveBranch, setCacheClock } from '../src/engine/host/pr-cache.mjs';
import { setGhForTests } from '../src/engine/host/github.mjs';

let t; let board; let api; let sessions; let repo;
const told = [];
const calls = [];
let reply = () => ({ ok: true, out: '[]', err: '' });
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const item = (list, key) => list.items.find((x) => x.key === key);

before(() => {
  t = tempHome(); board = new Board();
  const emit = (name, data) => { if (name === 'inbox:changed') told.push(data); };
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'chat11b'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'chat11b', path: repo }, 'usuario', { fromUser: true });
  setGhForTests({ exe: () => 'gh-fake', run: async (cmd, args, opts) => { calls.push({ cmd, args, cwd: opts?.cwd }); return reply(args); } });
});
after(() => { setGhForTests(null); setCacheClock(null); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } forgetRepos(); t.cleanup(); });

test('inbox.markUnread: una conversación con Orbe cuenta como 1 sin leer y markRead la deja a 0', async () => {
  const id = board.createConversation({ title: 'Agenda' }).id;
  board.addChat('orb', 'uno', null, id);
  await call('inbox.markRead', { kind: 'conversation', id });
  const key = `conversation:${id}`;
  assert.equal(item(await call('inbox.list', { zone: 'orb' }), key).unread, 0);
  const before = told.length;
  const r = await call('inbox.markUnread', { kind: 'conversation', id });
  assert.equal(r.unread, 1); assert.equal(r.markedUnread, true);
  assert.ok(told.length > before, 'the lists are told');
  const row = item(await call('inbox.list', { zone: 'orb' }), key);
  assert.equal(row.unread, 1); assert.equal(row.markedUnread, true);
  // lines that really arrive count on top of nothing extra: the mark never hides them
  board.addChat('orb', 'dos', null, id); board.addChat('orb', 'tres', null, id);
  assert.equal(item(await call('inbox.list', { zone: 'orb' }), key).unread, 2);
  assert.equal((await call('inbox.markRead', { kind: 'conversation', id })).unread, 0);
  const done = item(await call('inbox.list', { zone: 'orb' }), key);
  assert.equal(done.unread, 0); assert.equal(done.markedUnread, false);
  // the user's own line reads it too
  await call('inbox.markUnread', { kind: 'conversation', id });
  board.addChat('usuario', 'hola', null, id);
  assert.equal(item(await call('inbox.list', { zone: 'orb' }), key).unread, 0);
});

test('inbox.markUnread en un chat con un agente: 1 sin leer hasta que markRead lo lee, y no cambia el resto de marcas', async () => {
  const s = await call('sessions.create', { agent: 'claude', project: 'chat11b', permission: 'editar', title: 'directo' });
  const key = `session:${s.id}`;
  await call('inbox.pin', { kind: 'session', id: s.id });
  assert.equal((await call('inbox.markUnread', { kind: 'session', id: s.id })).unread, 1);
  const row = item(await call('inbox.list', { zone: 'orb' }), key);
  assert.equal(row.unread, 1); assert.equal(row.pinned, true);
  assert.equal((await call('inbox.list', { zone: 'orb' })).unread >= 1, true);
  const r = await call('inbox.markRead', { kind: 'session', id: s.id });
  assert.equal(r.markedUnread, false);
  const after = item(await call('inbox.list', { zone: 'orb' }), key);
  assert.equal(after.unread, 0); assert.equal(after.pinned, true);
  await assert.rejects(call('inbox.markUnread', { kind: 'session', id: 'nope' }));
});

test('inbox.markUnread tiene la clase de su pareja markRead (también para el móvil) y la base lo guarda en una columna nueva', () => {
  assert.equal(METHODS['inbox.markUnread'], METHODS['inbox.markRead']);
  assert.equal(REMOTE_METHODS.has('inbox.markUnread'), REMOTE_METHODS.has('inbox.markRead'));
  assert.ok(board.all('PRAGMA table_info(inbox_items)').some((c) => c.name === 'marked_unread'));
});

test('la rama de un chat sin worktree sale de .git/HEAD, se renueva a los 5 s y la PR se busca por la rama de ahora', async () => {
  const plain = await call('sessions.create', { agent: 'claude', project: 'chat11b', permission: 'editar', title: 'local' });
  let clock = 10_000_000; setCacheClock(() => clock);
  try {
    forgetRepos();
    rememberRepo(repo, { branch: 'main', prs: [{ number: 7, headRefName: 'feat/x', isCrossRepository: false }] });
    let row = (await call('sessions.list', {})).find((x) => x.id === plain.id);
    assert.equal(row.branch, 'main'); assert.equal('prNumber' in row, false);
    git(repo, 'checkout', '-q', '-b', 'feat/x');
    // within 5 s the folder is not read again
    row = (await call('sessions.list', {})).find((x) => x.id === plain.id);
    assert.equal(row.branch, 'main');
    clock += 6_000;
    row = (await call('sessions.list', {})).find((x) => x.id === plain.id);
    assert.equal(row.branch, 'feat/x'); assert.equal(row.prNumber, 7);
    // a detached HEAD has no branch (the older read of «main» must not come back)
    git(repo, 'checkout', '-q', '--detach');
    clock += 6_000;
    assert.equal(liveBranch(repo), null);
    row = (await call('sessions.list', {})).find((x) => x.id === plain.id);
    assert.equal('branch' in row, false);
    git(repo, 'checkout', '-q', 'main');
  } finally { setCacheClock(null); }
});

test('liveBranch: una carpeta de dentro, un .git que es un archivo (worktree) y una carpeta que no es un repositorio', () => {
  forgetRepos();
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true });
  assert.equal(liveBranch(path.join(repo, 'sub', 'deep')), 'main');
  const linked = path.join(t.home, 'web', 'enlazado'); fs.mkdirSync(linked, { recursive: true });
  const gitDir = path.join(t.home, 'web', 'gitdir-enlazado'); fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/orb/chat-9\n');
  fs.writeFileSync(path.join(linked, '.git'), `gitdir: ${gitDir}\n`);
  assert.equal(liveBranch(linked), 'orb/chat-9');
  assert.equal(liveBranch(path.join(t.home, 'sin-repo-alguno')), null);
  assert.equal(cachedPr(linked, 'orb/chat-9'), null);
});

test('la lista sigue sin lanzar procesos: ni git ni gh', () => {
  const src = fs.readFileSync(new URL('../src/engine/api/work.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("'sessions.list':"), src.indexOf("'sessions.create':"));
  assert.match(block, /liveBranch/);
  assert.doesNotMatch(block, /await|git\(|gitAsync|gh\(|spawn|exec/);
});

test('projects.branchPr: la PR más nueva de la rama en cualquier estado, con argumentos literales y solo lectura', async () => {
  calls.length = 0;
  reply = () => ({ ok: true, err: '', out: JSON.stringify([
    { number: 11, title: 'De un fork', headRefName: 'feat/x', isCrossRepository: true, state: 'OPEN', author: { login: 'otro' } },
    { number: 9, title: 'Añade   la\ncosa', headRefName: 'feat/x', headRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/o/r/pull/9', isDraft: false, isCrossRepository: false, state: 'MERGED', author: { login: 'yo' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', mergeable: 'UNKNOWN' }
  ]) });
  const pr = await call('projects.branchPr', { name: 'chat11b', branch: 'feat/x' });
  assert.equal(pr.number, 9); assert.equal(pr.state, 'MERGED'); assert.equal(pr.author, 'yo'); assert.equal(pr.title, 'Añade la cosa');
  assert.equal(pr.headRefOid, 'b'.repeat(40));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, repo);
  const a = calls[0].args;
  assert.deepEqual(a.slice(0, 6), ['pr', 'list', '--state', 'all', '--head', 'feat/x']);
  assert.ok(a.includes('--limit')); assert.ok(a.some((x) => /state/.test(x) && /number/.test(x)));
  assert.ok(!a.some((x) => /merge|comment|close|edit/.test(x) && x !== 'mergeable' && !/,/.test(x)));
  // a closed one, and a branch that never had one
  reply = () => ({ ok: true, err: '', out: JSON.stringify([{ number: 3, title: 'x', headRefName: 'feat/x', isCrossRepository: false, state: 'CLOSED' }]) });
  assert.equal((await call('projects.branchPr', { name: 'chat11b', branch: 'feat/x' })).state, 'CLOSED');
  reply = () => ({ ok: true, err: '', out: '[]' });
  assert.equal(await call('projects.branchPr', { name: 'chat11b', branch: 'feat/x' }), null);
});

test('projects.branchPr rechaza ramas que no son un nombre (nada de opciones de gh) y falla claro sin gh', async () => {
  calls.length = 0;
  for (const bad of ['--web', '-x', 'a..b', 'a b', '', 'a;b']) await assert.rejects(call('projects.branchPr', { name: 'chat11b', branch: bad }), undefined, bad);
  assert.equal(calls.length, 0);
  setGhForTests({ exe: () => null });
  await assert.rejects(call('projects.branchPr', { name: 'chat11b', branch: 'main' }), /GitHub CLI/);
});

test('projects.branchPr tiene la clase de projects.pr; fusionar y comentar no cambian', () => {
  assert.equal(METHODS['projects.branchPr'], METHODS['projects.pr']);
  assert.equal(METHODS['projects.mergePr'], 'remote'); assert.equal(METHODS['projects.merge'], 'pc'); assert.equal(METHODS['projects.prComment'], 'remote');
});

test('tasks.create guarda origin_session solo de un chat del mismo proyecto; si no, queda null; y viaja en tasks.list', async () => {
  const other = path.join(t.home, 'web', 'otro11b'); fs.mkdirSync(other, { recursive: true });
  board.addProject({ name: 'otro11b', path: other }, 'usuario', { fromUser: true });
  const chat = await call('sessions.create', { agent: 'claude', project: 'chat11b', permission: 'editar', title: 'origen' });
  const elsewhere = await call('sessions.create', { agent: 'claude', project: 'otro11b', permission: 'editar', title: 'ajeno' });
  const make = (project, origin) => call('tasks.create', { project, title: 'T', description: 'D', ...(origin === undefined ? {} : { origin_session: origin }) });
  const mine = await make('chat11b', chat.id);
  assert.equal(board.task(mine.id).origin_session, String(chat.id));
  assert.equal((await call('tasks.list', {})).find((x) => x.id === mine.id).origin_session, String(chat.id));
  for (const bad of [elsewhere.id, 'no-existe', undefined, null]) assert.equal((await make('chat11b', bad)).origin_session ?? null, null, String(bad));
  // a session that is not a chat (a task's own run) is no origin
  board.run("INSERT INTO sessions (id, kind, agent, project, cwd, status, title, created_at, updated_at) VALUES ('run-x', 'task', 'claude', 'chat11b', ?, 'idle', 'x', '2026-01-01', '2026-01-01')", repo);
  assert.equal((await make('chat11b', 'run-x')).origin_session ?? null, null);
  assert.equal(METHODS['tasks.create'], 'remote'); // as before
  assert.ok(board.all('PRAGMA table_info(tasks)').some((c) => c.name === 'origin_session'));
});

test('el servidor MCP no pone origen a las tareas: lo pone el usuario desde la Ficha', () => {
  assert.doesNotMatch(fs.readFileSync(new URL('../src/mcp/server.mjs', import.meta.url), 'utf8'), /origin_session/);
});

test('liveBranch: un HEAD enorme, un nombre raro y un gitdir de red no se siguen', () => {
  forgetRepos();
  const mk = (name, head, dotGit) => {
    const dir = path.join(t.home, 'web', name); fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    if (head != null) fs.writeFileSync(path.join(dir, '.git', 'HEAD'), head);
    if (dotGit) { fs.rmSync(path.join(dir, '.git'), { recursive: true }); fs.writeFileSync(path.join(dir, '.git'), dotGit); }
    return dir;
  };
  assert.equal(liveBranch(mk('h-ok', 'ref: refs/heads/feat/ok-1\n')), 'feat/ok-1');
  assert.equal(liveBranch(mk('h-raro', 'ref: refs/heads/ra$ro;`x`\n')), null);
  assert.equal(liveBranch(mk('h-largo', `ref: refs/heads/${'a'.repeat(300)}\n`)), null);
  // a huge file is read only in part: the name is cut and refused instead of loading it all
  assert.equal(liveBranch(mk('h-enorme', `ref: refs/heads/${'b'.repeat(5_000_000)}`)), null);
  assert.equal(liveBranch(mk('h-unc', null, 'gitdir: //servidor/compartida/x\n')), undefined);
  assert.equal(liveBranch(mk('h-unc2', null, 'gitdir: \\\\servidor\\compartida\\x\n')), undefined);
});
