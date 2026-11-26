// 3.8.7 paso 5: «Cambios» por turno de un chat directo. Con un agente simulado que escribe en la carpeta:
// - al acabar cada turno el motor deja una foto ligera en refs/orb/turnos/<chat>/<n> (la 0 es la carpeta antes del primer turno);
// - el diff de un turno se lee de esas fotos sin tocar los archivos, el índice, las ramas ni el stash del usuario;
// - esas referencias no salen con un push normal ni se clonan, y desaparecen al archivar el chat;
// - los comentarios sobre líneas viajan con el siguiente mensaje como un bloque.
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
import { commentsBlock, listTurns, snapshotAfterTurn, snapshotBeforeTurn } from '../src/domain/conversations/turns.mjs';

let t; let board; let api; let sessions; let repo; let sent;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const g = (...a) => git(repo, ...a).stdout.trim();
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'turnos'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
  git(repo, 'add', '-A'); git(repo, ...ident, 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'turnos', path: repo }, 'usuario', { fromUser: true });
  // the simulated agent: a message "write <file>=<text>" writes it in the folder and answers.
  sent = [];
  sessions.getLive = () => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send({ text }) {
    sent.push(text);
    const m = /write (\S+)=(\S+)/.exec(text); if (m) fs.writeFileSync(path.join(repo, m[1]), `${m[2]}\n`);
    return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const allRefs = (id) => g('for-each-ref', '--format=%(refname)', `refs/orb/turnos/${id}/`).split('\n').filter(Boolean);
// the numbered photos; refs/orb/turnos/<chat>/antes/<message> and pre/<turn> only mark where a message or a turn started
const turnRefs = (id) => allRefs(id).filter((r) => !r.includes('/antes/') && !r.includes('/pre/'));
// sends a message and waits until the turn ended and its photo exists
async function turn(id, text, photos) {
  await call('sessions.send', { id, text });
  await until(() => sent.some((s) => s.includes(text)), 'arranca');
  await until(() => sessions.get(id).status === 'idle' && !sessions.running.has(id), 'turno');
  if (photos) await until(() => turnRefs(id).length === photos, `${photos} fotos`);
}

test('cada turno deja su foto y el diff se lee sin tocar la carpeta, el índice ni las ramas', async () => {
  const s = await call('sessions.create', { agent: 'claude', project: 'turnos', permission: 'editar', title: 'x' });
  const branches = g('branch', '-a'); const stash = g('stash', 'list');
  await turn(s.id, 'write b.txt=uno', 2);
  await turn(s.id, 'write a.txt=dos', 3);
  assert.deepEqual(turnRefs(s.id).map((r) => r.split('/').pop()), ['0', '1', '2']);
  assert.equal((await call('sessions.turns', { id: s.id })).turns.length, 2);
  // the user has a staged file: reading the panel must leave everything as it is
  fs.writeFileSync(path.join(repo, 'mine.txt'), 'mio\n'); git(repo, 'add', 'mine.txt');
  const status = g('status', '--porcelain'); const index = g('ls-files', '-s');
  const last = await call('sessions.turnDiff', { id: s.id, scope: 'last' });
  assert.deepEqual(last.files.map((f) => f.path), ['a.txt']);
  assert.match(last.files[0].patch, /\+dos/);
  const first = await call('sessions.turnDiff', { id: s.id, scope: 'turn', n: 1 });
  assert.deepEqual(first.files.map((f) => [f.path, f.status]), [['b.txt', 'A']]);
  const all = await call('sessions.turnDiff', { id: s.id, scope: 'all' });
  assert.deepEqual(all.files.map((f) => f.path).sort(), ['a.txt', 'b.txt']);
  const head = await call('sessions.turnDiff', { id: s.id, scope: 'head' });
  assert.ok(head.files.some((f) => f.path === 'a.txt'));
  assert.equal(g('status', '--porcelain'), status); assert.equal(g('ls-files', '-s'), index);
  assert.equal(g('branch', '-a'), branches); assert.equal(g('stash', 'list'), stash);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'dos\n');
  git(repo, 'reset', '-q', 'mine.txt'); fs.rmSync(path.join(repo, 'mine.txt'));
});

test('las referencias de turnos no salen con un push ni se clonan, y se borran al archivar', async () => {
  const s = sessions.list().find((x) => x.project === 'turnos');
  assert.ok(turnRefs(s.id).length >= 3);
  const bare = path.join(t.home, 'remoto.git'); git(t.home, 'init', '-q', '--bare', bare);
  git(repo, 'remote', 'add', 'origin', bare);
  const branch = g('rev-parse', '--abbrev-ref', 'HEAD');
  assert.equal(git(repo, 'push', '-q', 'origin', branch).status, 0);
  assert.equal(git(repo, 'push', '-q', '--tags', 'origin').status, 0);
  assert.equal(git(bare, 'for-each-ref', '--format=%(refname)').stdout.trim(), `refs/heads/${branch}`);
  const clone = path.join(t.home, 'clon'); git(t.home, 'clone', '-q', bare, clone);
  assert.equal(git(clone, 'for-each-ref', '--format=%(refname)', 'refs/orb').stdout.trim(), '');
  assert.doesNotMatch(g('config', '--get-all', 'remote.origin.fetch'), /orb/);
  await call('sessions.update', { id: s.id, archived: true });
  assert.deepEqual(allRefs(s.id), []);
  assert.deepEqual((await call('sessions.turns', { id: s.id })).turns, []);
});

test('un chat sin git no tiene panel ni deja nada', async () => {
  const plain = path.join(t.home, 'web', 'sin-git'); fs.mkdirSync(plain, { recursive: true });
  board.addProject({ name: 'sin-git', path: plain }, 'usuario', { fromUser: true });
  const s = await call('sessions.create', { agent: 'claude', project: 'sin-git', permission: 'editar', title: 'y' });
  await turn(s.id, 'write z.txt=1');
  assert.equal((await call('sessions.turns', { id: s.id })).available, false);
  assert.equal((await call('sessions.turnDiff', { id: s.id })).available, false);
  assert.ok(!fs.existsSync(path.join(plain, '.git')));
});

test('los comentarios sobre líneas viajan con el siguiente mensaje', async () => {
  const s = await call('sessions.create', { agent: 'claude', project: 'turnos', permission: 'editar', title: 'z' });
  sent.length = 0;
  await call('sessions.send', { id: s.id, text: 'Corrige esto', comments: [{ path: 'a.txt', line: 2, side: 'new', text: 'usa otro nombre' }, { path: '', text: 'sin ruta' }] });
  await until(() => sent.length === 1, 'enviado');
  assert.equal(sent[0], 'Corrige esto\n\nComentarios sobre el código:\n- a.txt:2: usa otro nombre');
  assert.equal(commentsBlock([]), ''); assert.equal(commentsBlock('x'), '');
  assert.match(commentsBlock([{ path: 'a.txt', line: 3, side: 'old', text: 'a\nb' }]), /- a\.txt:3 \(antes del cambio\): a b/);
});

test('a photo that fails (the chat lookup throws) leaves no unhandled rejection behind', async () => {
  const seen = []; const on = (e) => seen.push(e); process.on('unhandledRejection', on);
  try {
    const boom = () => { throw new Error('statement has been finalized'); };
    assert.equal(await snapshotAfterTurn(repo, 'serial-check', boom), null);
    assert.equal(await snapshotBeforeTurn(repo, 'serial-check', boom), null);
    await new Promise((res) => setTimeout(res, 50));
    assert.deepEqual(seen, []);
  } finally { process.off('unhandledRejection', on); }
});

test('listing the turns while the last photo is still being taken already includes that turn', async () => {
  await snapshotBeforeTurn(repo, 'list-wait', () => true);
  fs.writeFileSync(path.join(repo, 'late.txt'), 'x\n');
  const photo = snapshotAfterTurn(repo, 'list-wait', () => true); // not awaited, as the engine does
  const listed = await listTurns(repo, 'list-wait');
  assert.deepEqual(listed.turns.map((x) => x.n), [1]);
  assert.equal(listed.available, true);
  await photo;
  assert.deepEqual((await listTurns(repo, 'never-photographed')).turns, []);
});
