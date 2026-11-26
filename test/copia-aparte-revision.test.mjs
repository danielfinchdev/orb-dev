// 3.8.12 step 4, review round: one test per point the review raised about moving a chat to a copy and back.
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
import { ChatCopy } from '../src/engine/chat-copy.mjs';
import { rewindFiles } from '../src/domain/conversations/rewind.mjs';
import { createCopyProposals } from '../src/engine/host/copy-proposal.mjs';

let t; let board; let api; let sessions; let scheduler; let chatTrees; let copy; let sent; let counter = 0;
let gate = null; let leaveMarkers = false;
const events = [];
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const g = (dir, ...a) => git(dir, ...a).stdout.trim();
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').split(String.fromCharCode(13)).join('');

before(() => {
  t = tempHome(); board = new Board();
  const emit = (event, payload) => events.push({ event, payload });
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  chatTrees = new ChatWorktrees({ board, sessions });
  copy = new ChatCopy({ board, sessions, chatTrees, hold: (n) => scheduler.hold(n), held: (n) => scheduler.held(n), claudeDir: () => path.join(t.base, 'claude-config') });
  sessions.onTurnEnd = (id) => { copy.afterTurn(id, (e, p) => events.push({ event: e, payload: p })).catch(() => {}); };
  sent = [];
  sessions.getLive = (s) => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send({ text }) {
    sent.push({ id: s.id, text, cwd: s.cwd });
    if (/\bslow\b/.test(text) && gate) await gate;
    for (const w of text.matchAll(/write (\S+)=(\S+)/g)) { fs.mkdirSync(path.dirname(path.join(s.cwd, w[1])), { recursive: true }); fs.writeFileSync(path.join(s.cwd, w[1]), `${w[2]}\n`); }
    if (/Hay archivos que cambiaron a la vez/.test(text)) {
      if (gate) await gate;
      const list = /copia: (.+?)\. Orb ha/.exec(text)?.[1] ?? '';
      if (!leaveMarkers) for (const f of list.split(', ').filter(Boolean)) fs.writeFileSync(path.join(s.cwd, f), 'resolved\n');
    }
    return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

function mkProject(files = {}) {
  const name = `rev${++counter}`; const dir = path.join(t.home, 'web', name); fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  const all = { 'a.txt': 'one\n', 'f.txt': 'fixed\n', '.gitignore': 'cache.log\n', ...files };
  for (const [f, c] of Object.entries(all)) fs.writeFileSync(path.join(dir, f), c);
  git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'first');
  board.addProject({ name, path: dir }, 'usuario', { fromUser: true });
  return { name, dir };
}
const mkChat = (p) => call('sessions.create', { agent: 'claude', project: p.name, permission: 'editar', title: 'x' });
const nums = (dir, id) => g(dir, 'for-each-ref', '--format=%(refname)', `refs/orb/turnos/${id}/`).split('\n').filter((r) => /\/\d+$/.test(r) && !/\/(pre|antes|antes-movidos|mezcla)\//.test(r));
async function turn(p, id, text, opts = {}) {
  const had = sent.length; const before = nums(p.dir, id).length;
  await call('sessions.send', { id, text, ...opts });
  await until(() => sent.length > had, 'arranca');
  await until(() => sessions.get(id).status === 'idle' && !sessions.running.has(id), 'turno');
  await until(() => nums(p.dir, id).length === before + (before ? 1 : 2), 'foto');
}
const move = async (id, extra = {}) => { const p = await copy.preview(id); assert.equal(p.ok, true, p.message); return copy.toCopy(id, { fingerprint: p.fingerprint, ack: true, ...(p.mixedTotal ? { mixed: 'leave' } : {}), ...extra }); };
const refs = (dir, prefix) => g(dir, 'for-each-ref', '--format=%(refname)', prefix).split('\n').filter(Boolean);

test('1+2: a carried file the user edits during the move is never overwritten by the undo, and the copy and its journal are kept', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  // the move fails in its last step, and just before, the user saves a new version of a file that was carried
  const mv = copy.moveSession;
  copy.moveSession = () => { fs.writeFileSync(path.join(p.dir, 'a.txt'), 'the user edit\n'); throw new Error('boom'); };
  await assert.rejects(() => move(s.id), /boom/);
  copy.moveSession = mv;
  assert.equal(read(p.dir, 'a.txt'), 'the user edit\n');
  const rec = chatTrees.info(s.id);
  assert.equal(rec.detached, true); assert.equal(rec.switching.failed, true);
  assert.ok(fs.existsSync(rec.path), 'the copy with the chat’s work stays');
  assert.ok(refs(p.dir, `refs/orb/copia/${s.id}/`).some((r) => r.endsWith('/antes')), 'the rescue photo stays');
  assert.ok(refs(p.dir, `refs/orb/copia/${s.id}/`).some((r) => r.endsWith('/ahora')), 'the photo of the folder as it was is kept');
  assert.equal(copy.where(s.id), 'local');
  assert.ok(board.all('SELECT body FROM session_items WHERE session_id = ?', s.id).some((i) => i.body.includes('La copia se conserva')));
  await copy.recover(); // a failed undo is not tried again alone
  assert.ok(chatTrees.info(s.id).switching.failed);
  // A: a new try is refused BEFORE it writes anything: the rescue photo of the failed one is untouched, and the window says why
  const rescue = () => g(p.dir, 'rev-parse', `refs/orb/copia/${s.id}/antes`);
  const before = rescue();
  const pv = await copy.preview(s.id);
  assert.equal(pv.ok, false); assert.equal(pv.why, 'pending');
  await assert.rejects(() => copy.toCopy(s.id, { fingerprint: 'x', ack: true }), /no se pudo deshacer del todo/);
  assert.equal(rescue(), before);
  assert.match(copy.state(s.id).blocked, /no se pudo deshacer del todo/);
  assert.ok(chatTrees.info(s.id).switching);
});

test('3: joining never takes conflict markers to the folder: half-done merges and markers refuse, and a pending resolution is not overwritten', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await move(s.id);
  await turn(p, s.id, 'write a.txt=chat');
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'user\n');
  leaveMarkers = true;
  await copy.resolve(s.id);
  await until(() => !sessions.running.has(s.id) && sessions.get(s.id).status === 'idle', 'turno');
  await until(() => board.all('SELECT body FROM session_items WHERE session_id = ?', s.id).some((i) => i.body.includes('Quedan marcas')), 'marcas');
  leaveMarkers = false;
  const info = chatTrees.info(s.id);
  assert.match(read(info.path, 'a.txt'), /<<<<<<</);
  await assert.rejects(() => copy.merge(s.id), /Quedan marcas de conflicto/);
  assert.equal(read(p.dir, 'a.txt'), 'user\n');
  assert.ok(!g(info.path, 'log', '-1', '--format=%s').includes('orb: trabajo del chat') || !/<<<<<<</.test(g(info.path, 'show', 'HEAD:a.txt')), 'the markers are not committed');
  // while a resolution is pending a «wait» does not wipe it
  let release; gate = new Promise((r) => { release = r; });
  await copy.resolve(s.id); // asks again (merge still in progress)
  await until(() => sessions.running.has(s.id), 'ronda');
  assert.throws(() => copy.wait(s.id), /Espera a que el agente termine/);
  assert.equal(board.settingJson(`chatcopy_next:${s.id}`).resolve, true);
  gate = null; release();
  await until(() => copy.where(s.id) === 'local', 'unido', 30000);
  assert.equal(read(p.dir, 'a.txt'), 'resolved\n');
  assert.deepEqual(refs(p.dir, `refs/orb/copia/${s.id}/`), [], '12: the folder photo ref is gone after the join');
});

test('4: undoing a move brings back only the photos that move retired, and rewindFiles looks at the chat’s moves', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  await turn(p, s.id, 'write c.txt=three');
  await copy.merge(s.id); // retires the photos of the copy side
  const retired = refs(p.dir, `refs/orb/turnos/${s.id}/antes-movidos/`).length;
  assert.equal(retired, 2);
  await turn(p, s.id, 'write d.txt=four');
  const marks = refs(p.dir, `refs/orb/turnos/${s.id}/antes/`);
  assert.equal(marks.length, 1);
  const mv = copy.moveSession; copy.moveSession = () => { throw new Error('boom'); };
  await assert.rejects(() => move(s.id, { mixed: 'leave' }), /boom/);
  copy.moveSession = mv;
  assert.equal(refs(p.dir, `refs/orb/turnos/${s.id}/antes-movidos/`).length, 2, 'the older retired photos stay retired');
  assert.deepEqual(refs(p.dir, `refs/orb/turnos/${s.id}/antes/`), marks);
  const first = board.all("SELECT id FROM session_items WHERE session_id = ? AND role = 'user'", s.id)[0].id;
  await assert.rejects(() => rewindFiles(p.dir, s.id, first, { moves: [{ item: first + 5 }] }), /No disponible: el chat cambió de carpeta después/);
});

test('5: what another chat writes in the same folder during a turn counts as mixed, not as the chat’s', async () => {
  const p = mkProject(); const s = await mkChat(p); const other = await mkChat(p);
  await turn(p, s.id, 'write f.txt=first');
  sessions.running.set(other.id, { agent: 'claude' }); // another chat is working in the same folder meanwhile
  await turn(p, s.id, 'write a.txt=two');
  sessions.running.delete(other.id);
  const plan = await copy.preview(s.id);
  assert.deepEqual(plan.mixed, ['a.txt']);
  assert.deepEqual(plan.files.map((f) => f.path).sort(), ['a.txt', 'f.txt']);
});

test('6: undoing a join keeps the branch and its refs until the point would have expired', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  const branch = chatTrees.info(s.id).branch;
  await copy.merge(s.id);
  await copy.undoMerge(s.id);
  assert.ok(g(p.dir, 'branch', '--list', branch), 'the branch stays');
  assert.equal(copy.state(s.id).undo, false);
  await assert.rejects(() => copy.undoMerge(s.id), /No hay ninguna unión/);
  assert.ok(refs(p.dir, 'refs/orb').filter((r) => r.includes('/c-' + s.id)).length >= 2);
  await copy.prune(-1); // everything is expired
  assert.equal(g(p.dir, 'branch', '--list', branch), '');
});

test('7: a message queued during the turn does not start before a waiting move or resolution', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  let release; gate = new Promise((r) => { release = r; });
  await call('sessions.send', { id: s.id, text: 'slow' });
  await until(() => sessions.running.has(s.id), 'trabaja');
  copy.wait(s.id);
  await call('sessions.send', { id: s.id, text: 'write q.txt=queued', mode: 'queue' });
  gate = null; release();
  await until(() => events.some((e) => e.event === 'copy:ready' && e.payload.id === s.id), 'lista');
  await until(() => !sessions.running.has(s.id), 'fin');
  assert.ok(!sent.some((x) => x.id === s.id && /q\.txt/.test(x.text)), 'the queued message did not start');
  assert.equal(sessions.queue(s.id).length, 1);
});

test('8: the proposals are dropped when Orb locks or the chat is removed', async () => {
  const p = mkProject(); const s = await mkChat(p);
  const props = createCopyProposals({ board, sessions, copy, askMs: 60_000 });
  const a = props.run(sessions.get(s.id), { reason: 'x' });
  props.wipe();
  assert.match((await a).text, /Orb está bloqueado/);
  const b = props.run(sessions.get(s.id), { reason: 'x' });
  props.dropSession(s.id);
  assert.match((await b).text, /Orb está bloqueado/);
  assert.deepEqual(props.pending(), []);
  // and the engine wires both (the lock and the removal of a chat)
  const src = fs.readFileSync('src/engine/api/index.mjs', 'utf8');
  assert.ok(src.includes('copyProposals.wipe()') && src.includes('copyProposals.dropSession(payload.id)'));
});

test('9: the chat is marked as moving while the start-up recovery runs', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  const mv = copy.moveSession; copy.moveSession = () => { throw new Error('boom'); };
  const rb = copy.rollback; copy.rollback = async () => false;
  await assert.rejects(() => move(s.id), /boom/);
  copy.moveSession = mv;
  let during = null;
  copy.rollback = async (id) => { during = sessions.moving.has(id); return rb.call(copy, id); };
  await copy.recover();
  copy.rollback = rb;
  assert.equal(during, true);
  assert.equal(sessions.moving.has(s.id), false);
});

test('10: the list of moves is capped keeping the first and the last ones, so no old rewind is unlocked', async () => {
  const p = mkProject(); const s = await mkChat(p);
  for (let i = 1; i <= 25; i++) copy.addMove(s.id, i % 2 ? 'copy' : 'local', i);
  const list = copy.moves(s.id);
  assert.equal(list.length, 20);
  assert.equal(list[0].item, 1); assert.equal(list.at(-1).item, 25);
});

test('11: a copy of the chat that stayed after a join is moved aside under its own key, never overwritten', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  await turn(p, s.id, 'write cache.log=junk write c.txt=three'); // an ignored file that never travels
  await copy.merge(s.id);
  const stayed = chatTrees.info(s.id);
  assert.equal(stayed.detached, true); assert.ok(fs.existsSync(stayed.path));
  await turn(p, s.id, 'write d.txt=four');
  await move(s.id);
  const olds = board.all("SELECT key FROM settings WHERE key LIKE ? AND value <> ''", `chatwt:${s.id}-old%`);
  assert.equal(olds.length, 1);
  assert.equal(chatTrees.info(s.id).path === stayed.path, false);
  assert.ok(fs.existsSync(stayed.path), 'the earlier copy is untouched');
});

test('12: the rescue photo is deleted when the move goes well', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  await move(s.id);
  assert.deepEqual(refs(p.dir, `refs/orb/copia/${s.id}/`), []);
});

test('B: the earlier copy moved aside is discarded from the list of copies (with its fingerprint) and released when the chat is removed', async () => {
  const mk = async () => {
    const p = mkProject(); const s = await mkChat(p);
    await turn(p, s.id, 'write a.txt=two');
    await move(s.id);
    await turn(p, s.id, 'write cache.log=junk write c.txt=three');
    await copy.merge(s.id); // the ignored file keeps the copy: it stays detached
    const stayed = chatTrees.info(s.id).path;
    await turn(p, s.id, 'write d.txt=four');
    await move(s.id);
    const old = board.all("SELECT key FROM settings WHERE key LIKE ? AND value <> ''", `chatwt:${s.id}-old%`)[0].key.slice('chatwt:'.length);
    return { p, s, stayed, old };
  };
  const one = await mk();
  assert.ok((await call('worktrees.list')).some((r) => r.id === one.old), 'it is listed with the others');
  const st = await call('worktrees.status', { id: one.old });
  assert.ok(fs.existsSync(one.stayed));
  const out = await call('worktrees.discard', { id: one.old, force: true, branch: 'delete', fingerprint: st.fingerprint });
  assert.equal(out.removed, true);
  assert.ok(!fs.existsSync(one.stayed));
  const two = await mk();
  // a copy that still holds work stays (with the chat gone it is listed and can be discarded); a clean one is released with the chat
  fs.rmSync(path.join(two.stayed, 'cache.log'), { force: true });
  await copy.discard(two.s.id, { confirm: true }); // the chat is in Local again, so it can be removed
  await call('sessions.remove', { id: two.s.id });
  await until(() => !fs.existsSync(two.stayed), 'la copia apartada se libera');
});

test('C: a task in the repository root counts as overlap for a chat in a subfolder', async () => {
  const p = mkProject(); fs.mkdirSync(path.join(p.dir, 'sub')); fs.writeFileSync(path.join(p.dir, 'sub', 'keep.txt'), 'keep'); git(p.dir, 'add', '-A'); git(p.dir, ...ident, 'commit', '-q', '-m', 'sub');
  const sub = path.join(p.dir, 'sub');
  board.addProject({ name: `${p.name}-sub`, path: sub }, 'usuario', { fromUser: true });
  const s = await call('sessions.create', { agent: 'claude', project: `${p.name}-sub`, permission: 'editar', title: 'x' });
  const other = await mkChat(p);
  await turn({ dir: sub }, s.id, 'write x.txt=1');
  sessions.running.set(other.id, { agent: 'claude' }); // a task in the root writes at the same time
  await turn({ dir: sub }, s.id, 'write y.txt=2');
  sessions.running.delete(other.id);
  const plan = await copy.preview(s.id);
  assert.deepEqual(plan.mixed, ['sub/y.txt']);
});

test('D: when the wait is cancelled or the move fails, the queued messages go on', async () => {
  const p = mkProject(); const s = await mkChat(p);
  await turn(p, s.id, 'write a.txt=two');
  let release; gate = new Promise((r) => { release = r; });
  await call('sessions.send', { id: s.id, text: 'slow' });
  await until(() => sessions.running.has(s.id), 'trabaja');
  copy.wait(s.id);
  await call('sessions.send', { id: s.id, text: 'write q.txt=queued', mode: 'queue' });
  gate = null; release();
  await until(() => events.some((e) => e.event === 'copy:ready' && e.payload.id === s.id), 'lista');
  await until(() => !sessions.running.has(s.id), 'fin');
  assert.ok(!sent.some((x) => x.id === s.id && /q.txt/.test(x.text)));
  copy.cancelWait(s.id); // the user closed the list
  await until(() => sent.some((x) => x.id === s.id && /q.txt/.test(x.text)), 'la cola sigue');
});
