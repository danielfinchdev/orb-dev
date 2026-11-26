// 3.8.12 (point 37): a chat moves to its own copy (git worktree) in the middle of the conversation, and back.
// Temporary repositories and a simulated agent that writes in the folder the chat works in:
// - every turn keeps its photo before and after; what the chat changed is the union of those pairs, never turn n-1 → n;
// - the chat's files go to the copy and come out of the folder; the user's, another chat's and a task's changes stay untouched;
// - a switch that fails or is cut short puts everything back; the rewind across the switch is refused by the engine;
// - join with its own undo point, a conflict resolved inside the copy, discard with its confirmation.
import { tempHome, until } from './helpers.mjs';
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
import { ChatWorktrees } from '../src/engine/chat-worktrees.mjs';
import { ChatCopy, followClaudeSession, claudeProjectName } from '../src/engine/chat-copy.mjs';
import { rewindFiles } from '../src/domain/conversations/rewind.mjs';
import { rewindInfo, editMessage } from '../src/engine/edit-message.mjs';
import { turnPairs } from '../src/domain/conversations/turns.mjs';

let resolveGate = null; let t; let board; let api; let sessions; let scheduler; let chatTrees; let copy; let sent; let claudeDir; let counter = 0;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const g = (dir, ...a) => git(dir, ...a).stdout.trim();
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
// files checked out by git on this PC may have CRLF (core.autocrlf): what is compared is the text
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').split(String.fromCharCode(13)).join('');
const events = [];

before(() => {
  t = tempHome(); board = new Board();
  const emit = (event, payload) => events.push({ event, payload });
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  claudeDir = path.join(t.base, 'claude-config'); fs.mkdirSync(claudeDir, { recursive: true });
  chatTrees = new ChatWorktrees({ board, sessions });
  copy = new ChatCopy({ board, sessions, chatTrees, hold: (n) => scheduler.hold(n), held: (n) => scheduler.held(n), claudeDir: () => claudeDir });
  sessions.onTurnEnd = (id) => { copy.afterTurn(id, (e, p) => events.push({ event: e, payload: p })).catch(() => {}); };
  sent = [];
  // the simulated agent writes in the folder the chat works in: «write f=x», «del f», «commit», «stage f»
  sessions.getLive = (s) => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send({ text }) {
    sent.push({ id: s.id, text, cwd: s.cwd, resume: s.cli_session });
    for (const w of text.matchAll(/write (\S+)=(\S+)/g)) { fs.mkdirSync(path.dirname(path.join(s.cwd, w[1])), { recursive: true }); fs.writeFileSync(path.join(s.cwd, w[1]), `${w[2]}\n`); }
    for (const d of text.matchAll(/del (\S+)/g)) fs.rmSync(path.join(s.cwd, d[1]), { force: true });
    const st = /stage (\S+)/.exec(text); if (st) git(s.cwd, 'add', st[1]);
    if (/\bcommit\b/.test(text)) { git(s.cwd, 'add', '-A'); git(s.cwd, ...ident, 'commit', '-q', '-m', 'agent'); }
    // asked to resolve a conflict: it edits the files of the copy (the markers go)
    if (/Hay archivos que cambiaron a la vez/.test(text)) {
      if (resolveGate) await resolveGate;
      const list = /copia: (.+?)\. Orb ha/.exec(text)?.[1] ?? ''; const files = list.split(', ').filter(Boolean);
      for (const f of files) fs.writeFileSync(path.join(s.cwd, f), 'resolved\n');
      sent.at(-1).resolvedIn = s.cwd;
    }
    return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

// a project of its own per test, so what one does never reaches another
function mkProject(files = {}) {
  const name = `copia${++counter}`; const dir = path.join(t.home, 'web', name); fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  const all = { 'a.txt': 'one\n', 'f.txt': 'fixed\n', 'u.txt': 'user\n', 'o.txt': 'other\n', '.gitignore': 'cache.log\n', ...files };
  for (const [f, c] of Object.entries(all)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'first');
  board.addProject({ name, path: dir }, 'usuario', { fromUser: true });
  return { name, dir };
}
const mkChat = (project, extra = {}) => call('sessions.create', { agent: 'claude', project: project.name, permission: 'editar', title: 'x', ...extra });
// numbered photos of a chat (not the markers: antes/<message>, pre/<turn>)
const photoRefs = (dir, id) => g(dir, 'for-each-ref', '--format=%(refname)', `refs/orb/turnos/${id}/`).split('\n').filter((r) => /\/\d+$/.test(r) && !r.includes('/pre/') && !r.includes('/antes'));
const preRefs = (dir, id) => g(dir, 'for-each-ref', '--format=%(refname)', `refs/orb/turnos/${id}/pre/`).split('\n').filter(Boolean);
async function turn(project, id, text, opts = {}) {
  const had = sent.length; const before = photoRefs(project.dir, id).length;
  await call('sessions.send', { id, text, ...opts });
  await until(() => sent.length > had, 'arranca');
  await until(() => sessions.get(id).status === 'idle' && !sessions.running.has(id), 'turno');
  await until(() => photoRefs(project.dir, id).length === before + (before ? 1 : 2), 'foto'); // the first turn also leaves the baseline
}
const planOf = async (id) => { const p = await copy.preview(id); assert.equal(p.ok, true, p.message); return p; };
const move = async (id, extra = {}) => { const p = await planOf(id); return copy.toCopy(id, { fingerprint: p.fingerprint, ack: true, ...(p.mixedTotal ? { mixed: 'leave' } : {}), ...extra }); };
const clean = (dir) => g(dir, 'status', '--porcelain');

test('every turn keeps a photo before and after it, also one that carries no message of the user', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await turn(p, s.id, 'write b.txt=new', { showUser: false }); // an automatic turn
  const pairs = await turnPairs(p.dir, s.id);
  assert.equal(pairs.ok, true);
  assert.deepEqual(pairs.turns.map((x) => x.n), [1, 2]);
  assert.deepEqual(preRefs(p.dir, s.id).map((r) => r.split('/').pop()).sort(), ['1', '2']);
  // turn 1 starts from the baseline (the folder before the first turn)
  assert.equal(pairs.turns[0].pre, pairs.zero);
});

test('what the chat changed is the union of each turn’s own diff: what the user did between turns is not the chat’s', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  fs.writeFileSync(path.join(p.dir, 'u.txt'), 'user edit between turns\n'); // the user, while the chat is idle
  await turn(p, s.id, 'write b.txt=new');
  const plan = await planOf(s.id);
  assert.deepEqual(plan.files.map((f) => f.path), ['a.txt', 'b.txt']);
  assert.deepEqual(plan.others, ['u.txt']);
  assert.deepEqual(plan.mixed, []);
});

test('moving: the chat’s files go to the copy and out of the folder; the user’s and others’ changes stay untouched', async () => {
  const p = mkProject(); const s = await mkChat(p);
  fs.writeFileSync(path.join(p.dir, 'o.txt'), 'other chat edit\n'); // another chat, before this one started
  await turn(p, s.id, 'write a.txt=two');
  await turn(p, s.id, 'write b.txt=new');
  fs.writeFileSync(path.join(p.dir, 'u.txt'), 'user edit\n');
  const headBefore = g(p.dir, 'rev-parse', 'HEAD');
  const out = await move(s.id);
  const info = chatTrees.info(s.id);
  assert.equal(out.moved, 2);
  assert.equal(read(info.path, 'a.txt'), 'two\n'); assert.equal(read(info.path, 'b.txt'), 'new\n');
  // the user's files in the copy are as in HEAD: they were never carried
  assert.equal(read(info.path, 'u.txt'), 'user\n'); assert.equal(read(info.path, 'o.txt'), 'other\n');
  // the folder: the chat's work is out; its own changes stay exactly as they were
  assert.equal(read(p.dir, 'a.txt'), 'one\n'); assert.ok(!fs.existsSync(path.join(p.dir, 'b.txt')));
  assert.equal(read(p.dir, 'u.txt'), 'user edit\n'); assert.equal(read(p.dir, 'o.txt'), 'other chat edit\n');
  assert.deepEqual(git(p.dir, 'status', '--porcelain').stdout.split('\n').filter(Boolean).map((l) => l.slice(3)).sort(), ['o.txt', 'u.txt']);
  assert.equal(g(p.dir, 'rev-parse', 'HEAD'), headBefore); // the folder's branch and index are not touched
  assert.equal(g(p.dir, 'diff', '--cached', '--name-only'), '');
  assert.equal(info.switching, undefined);
  const now = sessions.get(s.id);
  assert.equal(path.resolve(now.cwd), path.resolve(info.path));
  assert.equal(copy.where(s.id), 'copy');
  // the next message works in the copy and the agent is told where it is
  await turn(p, s.id, 'write c.txt=three');
  assert.equal(path.resolve(sent.at(-1).cwd), path.resolve(info.path));
  assert.match(sent.at(-1).text, /Ahora trabajas en .*chats/);
  assert.ok(fs.existsSync(path.join(info.path, 'c.txt'))); assert.ok(!fs.existsSync(path.join(p.dir, 'c.txt')));
});

test('a file the chat changed and someone else also changed is asked apart: leave it here or take it', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'two plus the user\n'); // after the chat’s last turn
  const plan = await planOf(s.id);
  assert.deepEqual(plan.mixed, ['a.txt']);
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true }), /Elige qué hacer/);
  await copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true, mixed: 'leave' });
  assert.equal(read(p.dir, 'a.txt'), 'two plus the user\n'); // stays where it is
  assert.equal(read(chatTrees.info(s.id).path, 'a.txt'), 'one\n');
  // and the other way: taking it moves the whole file, the folder gets the file as it was before the chat
  const q = mkProject(); const s2 = await mkChat(q);
  await turn(q, s2.id, 'write a.txt=two');
  fs.writeFileSync(path.join(q.dir, 'a.txt'), 'two plus the user\n');
  await move(s2.id, { mixed: 'take' });
  assert.equal(read(chatTrees.info(s2.id).path, 'a.txt'), 'two plus the user\n');
  assert.equal(read(q.dir, 'a.txt'), 'one\n');
});

test('a file the user already changed before the chat and the chat touched is also a mixed one', async () => {
  const p = mkProject(); const s = await mkChat(p);
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'one dirty\n');
  await turn(p, s.id, 'write a.txt=two');
  assert.deepEqual((await planOf(s.id)).mixed, ['a.txt']);
});

test('the user’s changes are always asked first, and ignored or secret-looking files stay and are said', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await turn(p, s.id, 'write .env=KEY');
  await turn(p, s.id, 'write cache.log=junk');
  fs.writeFileSync(path.join(p.dir, 'u.txt'), 'user edit\n');
  const plan = await planOf(s.id);
  assert.deepEqual(plan.files.map((f) => f.path), ['a.txt']);
  assert.deepEqual(plan.others, ['u.txt']);
  assert.deepEqual(plan.stay.secret, ['.env']); assert.deepEqual(plan.stay.ignored, ['cache.log']);
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: plan.fingerprint }), /Confirma que tus cambios se quedan/);
  await copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true });
  assert.equal(read(p.dir, '.env'), 'KEY\n'); assert.equal(read(p.dir, 'cache.log'), 'junk\n'); // stayed
  assert.ok(!fs.existsSync(path.join(chatTrees.info(s.id).path, '.env')));
});

test('a folder that changed while the user decided is a new decision', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  const plan = await planOf(s.id);
  fs.writeFileSync(path.join(p.dir, 'u.txt'), 'late edit\n');
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true }), /ha cambiado mientras decidías/);
  assert.equal(copy.where(s.id), 'local'); assert.equal(read(p.dir, 'a.txt'), 'two\n');
});

test('a moved HEAD is refused with the neutral text; files the agent staged with git add are warned', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two stage a.txt');
  const plan = await planOf(s.id);
  assert.deepEqual(plan.staged, ['a.txt']);
  git(p.dir, 'add', '-A'); git(p.dir, ...ident, 'commit', '-q', '-m', 'someone committed');
  const refused = await copy.preview(s.id);
  assert.equal(refused.ok, false); assert.equal(refused.why, 'head');
  assert.match(refused.message, /La rama de tu carpeta ha cambiado desde que empezó este chat/);
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: 'x', ack: true }), /La rama de tu carpeta/);
});

test('a chat with turns from before 3.8.12 (no photo before) is refused with its own text', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await turn(p, s.id, 'write b.txt=new');
  git(p.dir, 'update-ref', '-d', preRefs(p.dir, s.id).find((r) => r.endsWith('/2')));
  const r = await copy.preview(s.id);
  assert.equal(r.ok, false); assert.equal(r.why, 'old');
  assert.equal(r.message, 'Este chat empezó con una versión anterior de Orb. Abre un chat nuevo en copia aparte.');
});

test('a failure at any step puts the folder, the copy, the branch, the chat’s folder and its conversation back', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await turn(p, s.id, 'write b.txt=new');
  sessions.update(s.id, { cli_session: 'aaaaaaaa-1111-2222-3333-444444444444', context: JSON.stringify({ used: 5 }) });
  const before = sessions.get(s.id); const status = clean(p.dir);
  const branches = g(p.dir, 'branch', '--list');
  // 1: the copy cannot be written
  const write = copy.writeCopy; copy.writeCopy = async () => { throw new Error('disk full'); };
  await assert.rejects(() => move(s.id), /disk full/);
  copy.writeCopy = write;
  // 2: it fails after the folder was already given back its files (the last step)
  const mv = copy.moveSession; copy.moveSession = () => { throw new Error('session failed'); };
  await assert.rejects(() => move(s.id), /session failed/);
  copy.moveSession = mv;
  const after = sessions.get(s.id);
  assert.equal(after.cwd, before.cwd); assert.equal(after.cli_session, before.cli_session); assert.deepEqual(after.context, before.context);
  assert.equal(clean(p.dir), status); assert.equal(read(p.dir, 'a.txt'), 'two\n'); assert.equal(read(p.dir, 'b.txt'), 'new\n');
  assert.equal(g(p.dir, 'branch', '--list'), branches);
  assert.equal(chatTrees.info(s.id), null);
  assert.ok(!g(p.dir, 'worktree', 'list').includes('chat-'));
  // the photos before each message are back, and moving works afterwards
  assert.ok(g(p.dir, 'for-each-ref', `refs/orb/turnos/${s.id}/antes/`));
  assert.equal((await move(s.id)).moved, 2);
});

test('a switch cut short is undone at the next start (the journal is in the chat’s record)', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  const status = clean(p.dir); const cwd = sessions.get(s.id).cwd;
  // the process dies during the last step: nothing undoes it
  const mv = copy.moveSession; const rb = copy.rollback;
  copy.moveSession = () => { throw new Error('killed'); }; copy.rollback = async () => false;
  await assert.rejects(() => move(s.id), /killed/);
  copy.moveSession = mv; copy.rollback = rb;
  assert.equal(chatTrees.info(s.id).switching.phase, 'session');
  assert.equal(read(p.dir, 'a.txt'), 'one\n'); // already out of the folder
  await copy.recover();
  assert.equal(chatTrees.info(s.id), null);
  assert.equal(read(p.dir, 'a.txt'), 'two\n'); assert.equal(clean(p.dir), status);
  assert.equal(sessions.get(s.id).cwd, cwd);
  assert.ok(!g(p.dir, 'worktree', 'list').includes('chat-'));
});

test('rewinding across the switch is refused by the engine (info, rewind and edit), and works again on the new side', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  const first = board.all("SELECT id FROM session_items WHERE session_id = ? AND role = 'user'", s.id)[0].id;
  assert.equal((await rewindInfo(sessions, s.id, first)).canRewind, true);
  await move(s.id);
  const info = await rewindInfo(sessions, s.id, first);
  assert.equal(info.canRewind, false); assert.equal(info.rewindWhy, 'No disponible: el chat cambió de carpeta después.');
  await assert.rejects(() => rewindFiles(sessions.get(s.id).cwd, s.id, first), /No disponible: el chat cambió de carpeta después/);
  await assert.rejects(() => editMessage(sessions, s.id, first, 'again', { rewind: true }), /No disponible: el chat cambió de carpeta después/);
  // a message sent after the switch has its photo in the copy
  await turn(p, s.id, 'write c.txt=three');
  const second = board.all("SELECT id FROM session_items WHERE session_id = ? AND role = 'user'", s.id).at(-1).id;
  assert.equal((await rewindInfo(sessions, s.id, second)).canRewind, true);
});

test('joining: the copy’s work lands in the folder with the chat’s own undo point, and Undo gives the folder back', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  const info = chatTrees.info(s.id);
  await turn(p, s.id, 'write c.txt=three');
  fs.writeFileSync(path.join(p.dir, 'u.txt'), 'user edit\n'); // the user keeps working in the folder meanwhile
  const out = await copy.merge(s.id);
  assert.equal(out.ok, true); assert.equal(out.undo, true);
  assert.equal(read(p.dir, 'a.txt'), 'two\n'); assert.equal(read(p.dir, 'c.txt'), 'three\n'); assert.equal(read(p.dir, 'u.txt'), 'user edit\n');
  assert.equal(copy.where(s.id), 'local');
  assert.equal(path.resolve(sessions.get(s.id).cwd), path.resolve(p.dir));
  assert.ok(!fs.existsSync(info.path), 'the copy is removed');
  assert.ok(g(p.dir, 'branch', '--list', info.branch), 'the branch stays while the undo point exists');
  assert.equal(copy.state(s.id).undo, true);
  assert.equal(chatTrees.folderFor(s.id, p.name), null); // the chat works in the project again
  const undone = await copy.undoMerge(s.id);
  assert.equal(undone.ok, true);
  assert.equal(read(p.dir, 'a.txt'), 'one\n'); assert.ok(!fs.existsSync(path.join(p.dir, 'c.txt'))); assert.equal(read(p.dir, 'u.txt'), 'user edit\n');
  assert.equal(copy.state(s.id).undo, false);
  assert.ok(g(p.dir, 'branch', '--list', info.branch), 'the branch stays until the undo point would expire');
  // the chat can go to a copy again (a new name, never a reused one)
  await turn(p, s.id, 'write d.txt=four');
  assert.equal((await move(s.id)).ok, true);
});

test('a file changed in both places is a conflict: the agent resolves it INSIDE the copy, never in the user’s folder', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await move(s.id).catch(() => null); // no turn yet: nothing to carry, but the chat can still have a copy
  assert.equal(copy.where(s.id), 'copy');
  const info = chatTrees.info(s.id);
  await turn(p, s.id, 'write a.txt=chat-version');
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'user-version\n');
  const out = await copy.merge(s.id);
  assert.equal(out.ok, false); assert.deepEqual(out.conflicts, ['a.txt']);
  assert.equal(read(p.dir, 'a.txt'), 'user-version\n'); // nothing was touched
  assert.equal(copy.where(s.id), 'copy');
  const asked = await copy.resolve(s.id);
  assert.equal(asked.clean, false); assert.deepEqual(asked.files, ['a.txt']);
  assert.match(read(info.path, 'a.txt'), /<<<<<<</); // the folder’s version was brought into the copy as markers
  assert.equal(read(p.dir, 'a.txt'), 'user-version\n');
  await until(() => sent.some((x) => /Hay archivos que cambiaron a la vez/.test(x.text)) && !sessions.running.has(s.id), 'el agente resuelve');
  // when its turn ends the join is tried again from the folder photo it brought
  await until(() => copy.where(s.id) === 'local', 'unido', 20000);
  assert.equal(path.resolve(sent.find((x) => x.resolvedIn).resolvedIn), path.resolve(info.path));
  assert.equal(read(p.dir, 'a.txt'), 'resolved\n');
  assert.equal(copy.state(s.id).undo, true);
});

test('a folder that changed while the agent resolved repeats the process instead of joining', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await move(s.id);
  await turn(p, s.id, 'write a.txt=chat-version');
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'user-version\n');
  const asks = () => sent.filter((x) => x.id === s.id && /Hay archivos que cambiaron a la vez/.test(x.text)).length;
  let open; resolveGate = new Promise((r) => { open = r; });
  const trace = []; copy.log = (m) => trace.push(m);
  await copy.resolve(s.id);
  await until(() => asks() === 1, 'primera ronda');
  fs.writeFileSync(path.join(p.dir, 'u.txt'), 'changed during the resolution\n'); // the agent is still working
  resolveGate = null; open();
  // the join is not made with the stale photo: the process starts again, and then it joins
  await until(() => copy.where(s.id) === 'local', 'unido', 30000);
  assert.equal(asks(), 2);
  assert.equal(read(p.dir, 'u.txt'), 'changed during the resolution\n');
  assert.equal(read(p.dir, 'a.txt'), 'resolved\n');
});

test('discarding needs the confirmation, then removes the copy and its branch even with commits, and the chat stays in Local', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  const info = chatTrees.info(s.id);
  await turn(p, s.id, 'write c.txt=three commit'); // commits that live only in the copy’s branch
  assert.ok(g(p.dir, 'branch', '--list', info.branch));
  await assert.rejects(() => copy.discard(s.id), /Confirma que quieres descartar/);
  assert.ok(fs.existsSync(info.path));
  const out = await copy.discard(s.id, { confirm: true });
  assert.equal(out.ok, true);
  assert.ok(!fs.existsSync(info.path)); assert.equal(g(p.dir, 'branch', '--list', info.branch), '');
  assert.equal(path.resolve(sessions.get(s.id).cwd), path.resolve(p.dir));
  assert.equal(chatTrees.info(s.id), null);
  assert.equal(read(p.dir, 'a.txt'), 'one\n'); // what was not joined is gone with the copy
});

test('Claude’s conversation follows the chat: found by id in the config folder and put in the new folder’s place', async () => {
  const p = mkProject(); const s = await mkChat(p);
  const id = 'bbbbbbbb-1111-2222-3333-444444444444';
  await turn(p, s.id, 'write a.txt=two');
  sessions.update(s.id, { cli_session: id });
  const oldDir = path.join(claudeDir, 'projects', claudeProjectName(p.dir)); fs.mkdirSync(path.join(oldDir, id), { recursive: true });
  fs.writeFileSync(path.join(oldDir, `${id}.jsonl`), '{"role":"user"}\n'); fs.writeFileSync(path.join(oldDir, id, 'sub.jsonl'), 'sub\n');
  await move(s.id);
  const info = chatTrees.info(s.id);
  const newFile = path.join(claudeDir, 'projects', claudeProjectName(info.path), `${id}.jsonl`);
  assert.equal(fs.readFileSync(newFile, 'utf8'), '{"role":"user"}\n');
  assert.ok(fs.existsSync(path.join(claudeDir, 'projects', claudeProjectName(info.path), id, 'sub.jsonl')));
  assert.equal(sessions.get(s.id).cli_session, id); // it resumes the same conversation
  // the way back copies it again (the Local one stayed behind)
  fs.appendFileSync(newFile, '{"role":"assistant"}\n');
  await copy.merge(s.id);
  assert.equal(fs.readFileSync(path.join(oldDir, `${id}.jsonl`), 'utf8'), '{"role":"user"}\n{"role":"assistant"}\n');
  assert.equal(sessions.get(s.id).cli_session, id);
});

test('when the conversation cannot follow (not found, Cursor) the chat goes on from a summary and says so; Codex resumes by id', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  sessions.update(s.id, { cli_session: 'cccccccc-1111-2222-3333-444444444444' }); // no file in the config folder
  await move(s.id);
  assert.equal(sessions.get(s.id).cli_session, null);
  assert.ok(board.settingJson(`handoff_summary:${s.id}`));
  assert.ok(board.all("SELECT body FROM session_items WHERE session_id = ?", s.id).some((i) => i.body.includes('El agente sigue en la copia con un resumen de lo anterior.')));
  // Codex: the id stays, the process is rebuilt with the new folder; an answer with another id means it could not follow
  const q = mkProject(); const s2 = await mkChat(q, { agent: 'codex' });
  await turn(q, s2.id, 'write a.txt=two');
  sessions.update(s2.id, { cli_session: 'thread-123' });
  await move(s2.id);
  assert.equal(sessions.get(s2.id).cli_session, 'thread-123');
  assert.ok(board.settingJson(`chatresume:${s2.id}`));
  sessions.onLiveEvent(s2.id, { type: 'session', id: 'thread-456' });
  assert.ok(board.all("SELECT body FROM session_items WHERE session_id = ?", s2.id).some((i) => i.body.includes('con un resumen de lo anterior')));
  // Cursor: always a summary
  const c = mkProject(); const s3 = await mkChat(c, { agent: 'cursor' }).catch(() => null);
  if (s3) { await turn(c, s3.id, 'write a.txt=two'); sessions.update(s3.id, { cli_session: 'cur-1' }); await move(s3.id); assert.equal(sessions.get(s3.id).cli_session, null); }
});

test('followClaudeSession: no file, no copy', () => {
  assert.equal(followClaudeSession({ configDir: path.join(t.base, 'nothing'), sessionId: 'dddddddd-1111-2222-3333-444444444444', toCwd: t.base }), false);
  assert.equal(followClaudeSession({ configDir: claudeDir, sessionId: '../x', toCwd: t.base }), false);
});

test('the agent’s proposal: the card is answered on this PC; yes waits for the end of the turn, no or silence leaves it in Local', async () => {
  const p = mkProject(); const s = await mkChat(p);
  const asked = api.call('copyAsk.pending', {}, DESKTOP);
  assert.deepEqual(await asked, []);
  // the engine’s own tool entry: an agent call goes through agentAuth; here the proposals object is exercised via the api
  const { createCopyProposals } = await import('../src/engine/host/copy-proposal.mjs');
  const seen = [];
  const props = createCopyProposals({ board, sessions, copy, emit: (e, x) => seen.push([e, x]), askMs: 400 });
  const live = sessions.get(s.id);
  const yes = props.run(live, { reason: 'big refactor' });
  assert.equal(props.pending().length, 1); assert.equal(seen[0][0], 'copy:request'); assert.equal(seen[0][1].reason, 'big refactor');
  assert.throws(() => props.answer({ id: props.pending()[0].id, session: 'other' }), /ya no está/);
  // the agent proposes from inside its turn: a turn is running while the answer arrives (with none, the list opens at once)
  sessions.running.set(s.id, {});
  props.answer({ id: props.pending()[0].id, session: s.id });
  assert.match((await yes).text, /Termina tu turno ahora sin tocar nada más/);
  sessions.running.delete(s.id);
  assert.equal(copy.waitingFor(s.id), true); assert.equal(copy.where(s.id), 'local');
  // when the turn ends the window is told to show the list; nothing moved by itself
  await turn(p, s.id, 'write a.txt=two');
  await until(() => events.some((e) => e.event === 'copy:ready' && e.payload.id === s.id), 'lista');
  assert.equal(copy.where(s.id), 'local'); assert.equal(copy.waitingFor(s.id), false); assert.ok(copy.readyFor(s.id), 'kept as ready until the window answers');
  copy.cancelWait(s.id);
  // a no
  const no = props.run(live, { reason: 'x' }); props.decline({ id: props.pending()[0].id, session: s.id });
  assert.match((await no).text, /prefiere seguir en su carpeta/);
  // silence
  const none = await props.run(live, { reason: 'x' });
  assert.match(none.text, /Sin respuesta/);
  assert.equal(copy.where(s.id), 'local');
  // a chat that only reads, or one already in a copy, is not asked
  await assert.rejects(() => props.run({ ...live, permission: 'leer' }), /solo lee/);
  await move(s.id);
  await assert.rejects(() => props.run(sessions.get(s.id), {}), /ya trabaja en una copia aparte/);
});

test('a chat that is working, or a folder another chat is writing in, is not moved', async () => {
  const p = mkProject(); const s = await mkChat(p); const other = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  const plan = await planOf(s.id);
  sessions.running.set(other.id, { agent: 'claude' }); // another chat writing in the same folder
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true }), /Hay otro chat o una tarea/);
  sessions.running.delete(other.id);
  const release = scheduler.hold(p.name);
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true }), /Hay otro chat o una tarea/);
  release();
  sessions.running.set(s.id, { agent: 'claude' });
  await assert.rejects(() => copy.plan(s.id), /Espera a que el agente termine/);
  sessions.running.delete(s.id);
  assert.equal((await copy.toCopy(s.id, { fingerprint: plan.fingerprint, ack: true })).ok, true);
});

test('only for git projects: a folder without git is refused', async () => {
  const dir = path.join(t.home, 'web', 'sin-git'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  board.addProject({ name: 'sin-git', path: dir }, 'usuario', { fromUser: true });
  const s = await call('sessions.create', { agent: 'claude', project: 'sin-git', permission: 'editar', title: 'x' });
  const r = await copy.preview(s.id);
  assert.equal(r.ok, false); assert.equal(r.why, 'git');
});

test('the methods are this PC’s only and the window can read the state', async () => {
  const p = mkProject(); const s = await mkChat(p);
  const st = await call('copy.state', { id: s.id });
  assert.equal(st.where, 'local');
  const { principalOf, allowed } = await import('../src/domain/security/permissions.mjs');
  for (const m of ['copy.state', 'copy.preview', 'copy.toCopy', 'copy.merge', 'copy.undoMerge', 'copy.resolve', 'copy.discard', 'copyAsk.answer']) assert.equal(allowed(principalOf({ device: 'x' }), m), false, m);
});

test('Codex resumes the same thread with the copy’s folder (the real adapter against the fake app-server)', async () => {
  const { createLive } = await import('../src/agents/codex.mjs');
  const { fake } = await import('./helpers.mjs');
  const log = path.join(t.base, 'codex.log');
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  const folder = sessions.get(s.id).cwd;
  const live = createLive({ exe: { cmd: process.execPath, pre: [fake('fake-codex-app.mjs')] }, cwd: folder, resumeId: 'hilo-viejo', mcpServers: {}, permission: 'leer', env: { FAKE_LOG: log }, onEvent: () => {}, log: () => {} });
  const r = await live.send({ text: 'hola' });
  live.close();
  assert.equal(r.isError, false);
  const resume = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.method === 'thread/resume');
  assert.equal(resume.params.threadId, 'hilo-viejo');
  assert.equal(path.resolve(resume.params.cwd), path.resolve(chatTrees.info(s.id).path));
});
