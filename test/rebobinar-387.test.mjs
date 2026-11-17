// 3.8.7 paso R: «Editar» a message of a chat, with or without putting the files back.
// - the later turns move to a «(versión anterior)» copy that keeps the native session; the chat starts again from a summary;
// - the rewind keeps a rescue copy, writes back only files that differ and can be undone, also for untracked files;
// - ignored files are never touched; a chat in a git worktree rewinds the worktree, not the main checkout;
// - nothing runs while a turn is running, and a chat without a photo says why.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';
import { snapshotCommit, snapshotCommitAsync, undoCheckpoint } from '../src/domain/tasks/checkpoints.mjs';
import { snapshotBeforeTurn, snapshotAfterTurn } from '../src/domain/conversations/turns.mjs';
import { rewindFiles, undoRewindFiles } from '../src/domain/conversations/rewind.mjs';

let t; let board; let api; let sessions; let repo; let sent; let release;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const g = (cwd, ...a) => git(cwd, ...a).stdout.trim();
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  const orchestrator = new Orchestrator(board, { emit });
  sessions = new Sessions(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'rebob'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n'); fs.writeFileSync(path.join(repo, 'gone.txt'), 'keep me\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
  git(repo, 'add', '-A'); git(repo, ...ident, 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'rebob', path: repo }, 'usuario', { fromUser: true });
  sent = [];
  // the simulated agent writes in the chat's own folder: «write f=x», «del f» and «hold» (a turn that stays running)
  sessions.getLive = (s) => ({ lastUsed: Date.now(), logFile: null, live: { caps: {}, close() {}, isClosed: () => false, async send({ text }) {
    sent.push(`${s.id}:${text}`);
    // the last command is the user's: an edited turn carries the earlier ones in its summary
    const w = [...text.matchAll(/write (\S+)=(\S+)/g)].at(-1); if (w) { fs.mkdirSync(path.dirname(path.join(s.cwd, w[1])), { recursive: true }); fs.writeFileSync(path.join(s.cwd, w[1]), `${w[2]}\n`); }
    const d = /del (\S+)/.exec(text); if (d) fs.rmSync(path.join(s.cwd, d[1]), { force: true });
    if (/hold/.test(text)) await new Promise((r) => { release = r; });
    return { final: 'ok', text: 'ok', isError: false, usage: {} };
  } } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const items = (id) => board.all('SELECT * FROM session_items WHERE session_id = ? ORDER BY id', id);
const userItems = (id) => items(id).filter((i) => i.role === 'user');
const users = (id) => userItems(id).map((i) => i.body);
const idle = (id) => until(() => sessions.get(id).status === 'idle' && !sessions.running.has(id), 'turno');
const photos = (id) => g(sessions.get(id).cwd, 'for-each-ref', '--format=%(refname)', `refs/orb/turnos/${id}/`).split('\n').filter((r) => !r.includes('/antes/') && /\/\d+$/.test(r)).length;
// a turn and its closing photo
async function turn(id, text) {
  const had = sent.length; const photosBefore = photos(id);
  await call('sessions.send', { id, text });
  await until(() => sent.length > had, 'arranca'); await idle(id);
  await until(() => photos(id) === photosBefore + (photosBefore ? 1 : 2), 'foto'); // the first turn also leaves the baseline
}
const create = (cwd = repo) => sessions.create({ kind: 'chat', agent: 'claude', project: 'rebob', cwd, permission: 'editar', title: 'chat' });

test('editing without rewinding keeps the later turns in a copy and the chat starts again from a summary', async () => {
  const s = create();
  await turn(s.id, 'write b.txt=uno'); await turn(s.id, 'write c.txt=dos');
  board.run('UPDATE sessions SET cli_session = ? WHERE id = ?', 'native-1', s.id);
  sessions.update(s.id, { context: { used: 1, size: 2 } }); // real chats have it after their first turn
  const second = userItems(s.id)[1];
  const out = await call('sessions.edit', { id: s.id, item: second.id, text: 'write d.txt=tres' });
  await idle(s.id);
  const copy = sessions.get(out.copy);
  assert.equal(copy.parent_id, s.id); assert.equal(copy.cli_session, 'native-1'); assert.match(copy.title, /versión anterior/);
  assert.notEqual(copy.permission, 'total');
  assert.deepEqual(copy.context, { used: 1, size: 2 });
  assert.deepEqual(users(copy.id), ['write b.txt=uno', 'write c.txt=dos']);
  assert.deepEqual(users(s.id), ['write b.txt=uno', 'write d.txt=tres']);
  assert.ok(!sessions.get(s.id).cli_session);
  assert.ok(sent.some((x) => x.startsWith(`${s.id}:`) && x.includes('write d.txt=tres') && x.includes('resumen-traspaso') && x.includes('write b.txt=uno') && !x.includes('write c.txt=dos')));
  assert.equal(board.settingJson(`handoff_summary:${s.id}`), null); // consumed by that send
  assert.ok(fs.existsSync(path.join(repo, 'c.txt'))); // no rewind: files untouched
});

test('editing a message with pictures sends them again with the new text', async () => {
  const s = create();
  const pic = path.join(t.home, 'pic.png'); fs.writeFileSync(pic, 'png');
  const had = sent.length;
  sessions.send(s.id, 'look at this', { images: [pic] });
  await until(() => sent.length > had, 'arranca'); await idle(s.id);
  const first = userItems(s.id)[0];
  assert.equal(first.body.includes('images'), true);
  await call('sessions.edit', { id: s.id, item: first.id, text: 'look again' });
  await idle(s.id);
  const edited = JSON.parse(userItems(s.id).at(-1).body);
  assert.equal(edited.text, 'look again'); assert.equal(edited.images.length, 1);
  assert.equal(fs.readFileSync(edited.images[0], 'utf8'), 'png');
});

test('rewind puts back modified, new and deleted files, never an ignored one, and can be undone', async () => {
  const s = create();
  await turn(s.id, 'write a.txt=changed');
  fs.writeFileSync(path.join(repo, 'ignored.log'), 'mine\n');
  await turn(s.id, 'del gone.txt');
  await turn(s.id, 'write new.txt=fresh');
  sessions.update(s.id, { context: { used: 1, size: 2 } });
  const mark = userItems(s.id)[1]; // «del gone.txt»: before it a.txt was changed and gone.txt existed
  const was = { head: g(repo, 'rev-parse', 'HEAD'), index: g(repo, 'diff', '--cached', '--name-only') };
  fs.writeFileSync(path.join(repo, 'loose.txt'), 'untracked of mine\n');
  const info = await call('sessions.rewindInfo', { id: s.id, item: mark.id });
  assert.equal(info.canRewind, true);
  const out = await call('sessions.editRewind', { id: s.id, item: mark.id, text: 'write other.txt=x' });
  await idle(s.id);
  assert.equal(out.rewound, true);
  assert.equal(read(repo, 'a.txt'), 'changed\n');
  assert.equal(read(repo, 'gone.txt'), 'keep me\n'); // deleted file restored
  assert.ok(!fs.existsSync(path.join(repo, 'new.txt'))); // created after the message: gone
  assert.ok(!fs.existsSync(path.join(repo, 'loose.txt')));
  assert.equal(read(repo, 'ignored.log'), 'mine\n'); // ignored: never touched
  assert.equal(g(repo, 'rev-parse', 'HEAD'), was.head); assert.equal(g(repo, 'diff', '--cached', '--name-only'), was.index);
  const line = items(s.id).find((i) => i.kind === 'rewind'); const body = JSON.parse(line.body);
  assert.equal(body.undone, false); assert.ok(body.restored >= 1 && body.removed >= 2);
  assert.equal(g(repo, 'rev-parse', body.ref), body.rescue);
  // the edited turn wrote other.txt after the rewind; undoing brings back the rest and leaves other.txt alone
  const undo = await call('sessions.rewindUndo', { id: s.id, item: line.id });
  assert.ok(undo.restored >= 1);
  assert.equal(read(repo, 'new.txt'), 'fresh\n'); assert.equal(read(repo, 'loose.txt'), 'untracked of mine\n');
  assert.ok(!fs.existsSync(path.join(repo, 'gone.txt')));
  assert.equal(JSON.parse(items(s.id).find((i) => i.id === line.id).body).undone, true);
  await assert.rejects(call('sessions.rewindUndo', { id: s.id, item: line.id }), /ya se deshizo|already undone/);
});

test('nothing is edited while a turn is running', async () => {
  const s = create();
  await turn(s.id, 'write h.txt=1');
  const mark = userItems(s.id)[0];
  await call('sessions.send', { id: s.id, text: 'hold' });
  await until(() => release, 'hold');
  await assert.rejects(call('sessions.edit', { id: s.id, item: mark.id, text: 'x' }), /Espera|Wait/);
  assert.equal((await call('sessions.rewindInfo', { id: s.id, item: mark.id })).canEdit, false);
  release(); release = null; await idle(s.id);
});

test('another chat running in the same folder blocks the rewind, not the edit', async () => {
  const a = create(); const b = create();
  await turn(a.id, 'write r.txt=1');
  const mark = userItems(a.id)[0];
  await call('sessions.send', { id: b.id, text: 'hold' });
  await until(() => release, 'hold');
  const info = await call('sessions.rewindInfo', { id: a.id, item: mark.id });
  assert.equal(info.canEdit, true); assert.equal(info.canRewind, false); assert.ok(info.rewindWhy);
  await assert.rejects(call('sessions.editRewind', { id: a.id, item: mark.id, text: 'x' }), /otro chat|Another chat/i);
  release(); release = null; await idle(b.id);
});

test('a chat without a photo explains why and nothing changes', async () => {
  const s = create();
  await turn(s.id, 'write p.txt=1');
  const mark = userItems(s.id)[0];
  git(repo, 'update-ref', '-d', `refs/orb/turnos/${s.id}/antes/${mark.id}`);
  const info = await call('sessions.rewindInfo', { id: s.id, item: mark.id });
  assert.equal(info.canRewind, false); assert.match(info.rewindWhy, /foto|photo/);
  await assert.rejects(call('sessions.editRewind', { id: s.id, item: mark.id, text: 'x' }), /foto|photo/);
  assert.equal(userItems(s.id).length, 1); assert.equal(sessions.get(s.id).parent_id, null);
});

test('a chat in a git worktree rewinds the worktree and leaves the main checkout alone', async () => {
  const wt = path.join(t.home, 'web', 'rebob-wt');
  git(repo, ...ident, 'worktree', 'add', '-q', '-b', 'side', wt);
  const s = create(wt);
  await turn(s.id, 'write w.txt=1');
  await turn(s.id, 'write w2.txt=2');
  fs.writeFileSync(path.join(repo, 'main-only.txt'), 'main\n');
  const mark = userItems(s.id)[1];
  await call('sessions.editRewind', { id: s.id, item: mark.id, text: 'write w3.txt=3' });
  await idle(s.id);
  assert.ok(fs.existsSync(path.join(wt, 'w.txt'))); assert.ok(!fs.existsSync(path.join(wt, 'w2.txt')));
  assert.ok(fs.existsSync(path.join(repo, 'main-only.txt'))); assert.ok(fs.existsSync(path.join(repo, 'c.txt')));
});

test('permissions: rewinding is only from the PC, editing also from the phone', () => {
  assert.equal(METHODS['sessions.edit'], 'remote'); assert.equal(METHODS['sessions.rewindInfo'], 'remote');
  assert.equal(METHODS['sessions.editRewind'], 'pc'); assert.equal(METHODS['sessions.rewindUndo'], 'pc');
});

test('the photo before a message includes what the user changed since the last turn', async () => {
  const s = create();
  await turn(s.id, 'write ua.txt=agent');
  fs.writeFileSync(path.join(repo, 'ua.txt'), 'user change\n'); // between turns, by hand
  await turn(s.id, 'write ub.txt=two');
  await turn(s.id, 'write uc.txt=three');
  const nums = photos(s.id);
  await call('sessions.editRewind', { id: s.id, item: userItems(s.id)[1].id, text: 'write ud.txt=four' });
  await idle(s.id);
  assert.equal(read(repo, 'ua.txt'), 'user change\n'); assert.ok(!fs.existsSync(path.join(repo, 'ub.txt')));
  // the message photos are marks, not turns: «Cambios» sees the same numbered photos plus the edited turn's own
  await until(() => photos(s.id) === nums + 1, 'one new photo'); await new Promise((r) => setTimeout(r, 300)); assert.equal(photos(s.id), nums + 1);
});

test('editing again after a rewind goes back to the rewound state, and a second click is refused', async () => {
  const s = create();
  await turn(s.id, 'write ra.txt=v1'); await turn(s.id, 'write rb.txt=2');
  const m2 = userItems(s.id)[1];
  const both = await Promise.allSettled([
    call('sessions.editRewind', { id: s.id, item: m2.id, text: 'write rc.txt=3' }),
    call('sessions.editRewind', { id: s.id, item: m2.id, text: 'write rc.txt=3' }),
  ]);
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(both.find((r) => r.status === 'rejected').reason.message, /Espera|Wait/);
  await idle(s.id);
  assert.ok(!fs.existsSync(path.join(repo, 'rb.txt'))); assert.ok(fs.existsSync(path.join(repo, 'rc.txt')));
  const edited = userItems(s.id).at(-1);
  await call('sessions.editRewind', { id: s.id, item: edited.id, text: 'write rd.txt=4' });
  await idle(s.id);
  assert.ok(!fs.existsSync(path.join(repo, 'rc.txt'))); assert.ok(!fs.existsSync(path.join(repo, 'rb.txt'))); assert.ok(fs.existsSync(path.join(repo, 'ra.txt')));
  // deleting the chat for good takes its photos and rescue copies; archiving would have kept the rescues
  const refsOf = (p) => g(repo, 'for-each-ref', '--format=%(refname)', `${p}/${s.id}/`);
  assert.ok(refsOf('refs/orb/rescate')); assert.ok(refsOf('refs/orb/turnos'));
  sessions.remove(s.id);
  await until(() => refsOf('refs/orb/turnos') === '', 'photos dropped'); assert.equal(refsOf('refs/orb/rescate'), '');
});

test('a rewind skips files behind a link or that cannot be written, and still finishes', async () => {
  const { undoCheckpoint } = await import('../src/domain/tasks/checkpoints.mjs');
  const dir = path.join(t.home, 'web', 'safe'); const outside = path.join(t.home, 'web', 'outside');
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(outside, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'd')); fs.writeFileSync(path.join(dir, 'd', 'f.txt'), 'old\n'); fs.writeFileSync(path.join(dir, 'ro.txt'), 'old\n');
  git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'one'); const c1 = g(dir, 'rev-parse', 'HEAD');
  git(dir, 'rm', '-rq', 'd'); fs.writeFileSync(path.join(dir, 'ro.txt'), 'new\n'); git(dir, 'add', '-A'); git(dir, ...ident, 'commit', '-q', '-m', 'two'); const c2 = g(dir, 'rev-parse', 'HEAD');
  try { fs.symlinkSync(outside, path.join(dir, 'd'), 'junction'); } catch { return; } // links not permitted here
  fs.chmodSync(path.join(dir, 'ro.txt'), 0o444);
  const out = undoCheckpoint({ kind: 'git', repo: dir, commit: c1 }, { commit: c2 }, { safe: true });
  assert.ok(out.skipped.includes('d/f.txt')); assert.ok(!fs.existsSync(path.join(outside, 'f.txt')));
  fs.chmodSync(path.join(dir, 'ro.txt'), 0o666);
});

test('a failed edit that cannot put every file back keeps the line that undoes the rewind', async () => {
  const src = fs.readFileSync(new URL('../src/engine/edit-message.mjs', import.meta.url), 'utf8');
  assert.match(src, /back\.skipped === 0\) rewound = null/);
});

// The photo before a message: the last one when nothing changed, a new one when the user touched the folder.
const tip = (id, name) => g(repo, 'rev-parse', '--verify', '--quiet', `refs/orb/turnos/${id}/${name}^{commit}`);

test('a message reuses the last photo when nothing changed and takes a new one when the user edited the folder', async () => {
  const s = create();
  fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=secret\n'); // never inside a photo, and never a reason for a new one
  fs.writeFileSync(path.join(repo, 'ignored.log'), 'noise\n');
  await turn(s.id, 'write p1.txt=1'); await turn(s.id, 'write p2.txt=2');
  const [, second] = userItems(s.id);
  const reused = tip(s.id, `antes/${second.id}`);
  assert.ok(reused); assert.equal(reused, tip(s.id, '1')); // same commit as the photo the first turn ended with
  assert.equal(g(repo, 'ls-tree', '-r', '--name-only', reused).split('\n').filter((f) => f === '.env' || f === 'ignored.log').length, 0);

  fs.writeFileSync(path.join(repo, 'a.txt'), 'edited by me\n'); fs.writeFileSync(path.join(repo, 'mine-new.txt'), 'new by me\n');
  await turn(s.id, 'write p3.txt=3');
  const third = userItems(s.id)[2];
  const fresh = tip(s.id, `antes/${third.id}`);
  assert.ok(fresh); assert.notEqual(fresh, tip(s.id, '2'));
  assert.equal(g(repo, 'show', `${fresh}:a.txt`), 'edited by me');
  assert.equal(g(repo, 'show', `${fresh}:mine-new.txt`), 'new by me');
  assert.equal(g(repo, 'ls-tree', '-r', '--name-only', fresh).split('\n').includes('.env'), false);

  // rewinding to that message leaves the folder as it was just before it: the user's own changes stay, the agent's go
  await call('sessions.editRewind', { id: s.id, item: third.id, text: 'write p4.txt=4' });
  await idle(s.id);
  assert.equal(read(repo, 'a.txt'), 'edited by me\n');
  assert.equal(read(repo, 'mine-new.txt'), 'new by me\n');
  assert.equal(read(repo, 'p2.txt'), '2\n');
  assert.ok(!fs.existsSync(path.join(repo, 'p3.txt')));
  assert.equal(read(repo, '.env'), 'TOKEN=secret\n'); // a secret the photo never held is not touched
  assert.equal(read(repo, 'ignored.log'), 'noise\n');
});

// A file that .gitignore ignores but the user force-adds and commits after the raw index was written must stay in the photos.
function forcedRepo(name) {
  const r = path.join(t.home, 'web', name); fs.mkdirSync(r, { recursive: true });
  git(r, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(r, 'a.txt'), 'one\n'); fs.writeFileSync(path.join(r, 'del.txt'), 'bye\n');
  fs.writeFileSync(path.join(r, '.gitignore'), 'gen/\n.env\n');
  git(r, 'add', '-A'); git(r, ...ident, 'commit', '-q', '-m', 'first');
  return r;
}
const forceCommit = (r, ...files) => { for (const f of files) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), `${f}\n`); } git(r, 'add', '-f', '--', ...files); git(r, ...ident, 'commit', '-q', '-m', 'force'); };
// the first snapshot starts cold; the second one is the first to leave the up-to-date marker beside the raw index
const warm = (r) => { snapshotCommit(r, { raw: true, always: true }); snapshotCommit(r, { raw: true, always: true }); };
const tracked = (r, commit) => g(r, 'ls-tree', '-r', '--name-only', commit).split('\n');

test('a fast snapshot keeps an ignored file that was force-added and committed after the raw index', () => {
  const r = forcedRepo('forced1');
  warm(r);
  forceCommit(r, 'gen/x.txt');
  const snap = snapshotCommit(r, { raw: true, always: true });
  assert.ok(tracked(r, snap.commit).includes('gen/x.txt'));
  const again = snapshotCommit(r, { raw: true, always: true });
  assert.ok(tracked(r, again.commit).includes('gen/x.txt'));
});

test('a force-committed secret stays out of the photo, and a file the user deleted is not brought back', () => {
  const r = forcedRepo('forced2');
  warm(r);
  forceCommit(r, 'gen/y.txt', '.env');
  fs.rmSync(path.join(r, 'del.txt'));
  const snap = snapshotCommit(r, { raw: true, always: true });
  const files = tracked(r, snap.commit);
  assert.ok(files.includes('gen/y.txt')); assert.ok(!files.includes('.env')); assert.ok(!files.includes('del.txt')); assert.ok(files.includes('a.txt'));
});

test('rewinding a chat does not delete a force-added ignored file committed after the first photo', async () => {
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), 'gen/\n');
  const s = create();
  await turn(s.id, 'write a.txt=first');
  forceCommit(repo, 'gen/kept.txt');
  await turn(s.id, 'write b2.txt=second');
  await turn(s.id, 'write c2.txt=third');
  await call('sessions.editRewind', { id: s.id, item: userItems(s.id)[2].id, text: 'write d2.txt=x' });
  await idle(s.id);
  assert.equal(read(repo, 'gen', 'kept.txt'), 'gen/kept.txt\n');
  assert.ok(!fs.existsSync(path.join(repo, 'c2.txt')));
});

test('a snapshot that copied the raw index before another one replaced it still restores the forced file', async () => {
  const r = forcedRepo('forced3'); warm(r);
  forceCommit(r, 'gen/k.txt');
  // the async snapshot has copied the old index; a sync one finishes (index and marker) before it reads the marker
  const orig = fs.readFileSync; let other = null; let fired = false;
  fs.readFileSync = function (f, ...a) { if (!fired && String(f).endsWith('index-raw.head')) { fired = true; other = snapshotCommit(r, { raw: true, always: true }); } return orig.call(this, f, ...a); };
  let mine; try { mine = await snapshotCommitAsync(r, { raw: true, always: true }); } finally { fs.readFileSync = orig; }
  assert.ok(tracked(r, other.commit).includes('gen/k.txt'));
  assert.ok(tracked(r, mine.commit).includes('gen/k.txt'));
  assert.ok(tracked(r, snapshotCommit(r, { raw: true, always: true }).commit).includes('gen/k.txt'));
});

test('the race is caught too when git writes the index without its checksum (index.skipHash)', async () => {
  // with skipHash the index ends in zeros plus the hash of its last subtree, which a forced file under an earlier folder does not change
  const r = path.join(t.home, 'web', 'forced7'); fs.mkdirSync(path.join(r, 'zzz'), { recursive: true });
  git(r, 'init', '-q', '-b', 'main'); git(r, 'config', 'index.skipHash', 'true');
  fs.writeFileSync(path.join(r, '.gitignore'), 'aaa/\n'); fs.writeFileSync(path.join(r, 'zzz', 'z.txt'), 'z\n');
  git(r, 'add', '-A'); git(r, ...ident, 'commit', '-q', '-m', 'first');
  warm(r);
  forceCommit(r, 'aaa/k.txt');
  const orig = fs.readFileSync; let other = null; let fired = false;
  fs.readFileSync = function (f, ...a) { if (!fired && String(f).endsWith('index-raw.head')) { fired = true; other = snapshotCommit(r, { raw: true, always: true }); } return orig.call(this, f, ...a); };
  let mine; try { mine = await snapshotCommitAsync(r, { raw: true, always: true }); } finally { fs.readFileSync = orig; }
  assert.ok(tracked(r, other.commit).includes('aaa/k.txt'));
  assert.ok(tracked(r, mine.commit).includes('aaa/k.txt'));
  assert.ok(tracked(r, snapshotCommit(r, { raw: true, always: true }).commit).includes('aaa/k.txt'));
});

test('an ignored folder standing where HEAD had a file is not dragged into the photo', () => {
  const r = forcedRepo('forced4');
  fs.writeFileSync(path.join(r, '.gitignore'), 'gen/\nout/\n'); fs.writeFileSync(path.join(r, 'out'), 'file\n');
  git(r, 'add', '-A'); git(r, ...ident, 'commit', '-q', '-m', 'out');
  warm(r);
  fs.rmSync(path.join(r, 'out')); fs.mkdirSync(path.join(r, 'out', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(r, 'out', 'creds.json'), '{}'); fs.writeFileSync(path.join(r, 'out', 'node_modules', 'i.js'), '1');
  forceCommit(r, 'gen/z.txt'); // HEAD moves
  const files = tracked(r, snapshotCommit(r, { raw: true, always: true }).commit);
  assert.ok(files.includes('gen/z.txt')); assert.ok(!files.some((f) => f.startsWith('out/')));
});

test('a path of HEAD behind a folder that became a link does not make every photo cold', (c) => {
  const r = forcedRepo('forced5');
  fs.mkdirSync(path.join(r, 'd')); fs.writeFileSync(path.join(r, 'd', 'f.txt'), 'f\n'); git(r, 'add', '-A'); git(r, ...ident, 'commit', '-q', '-m', 'd');
  warm(r);
  fs.mkdirSync(path.join(r, 'real')); fs.renameSync(path.join(r, 'd', 'f.txt'), path.join(r, 'real', 'f.txt')); fs.rmdirSync(path.join(r, 'd'));
  try { fs.symlinkSync(path.join(r, 'real'), path.join(r, 'd'), 'dir'); } catch { c.skip('cannot create symlinks here'); return; }
  forceCommit(r, 'gen/q.txt');
  const index = path.join(r, g(r, 'rev-parse', '--git-path', 'orb/index-raw'));
  snapshotCommit(r, { raw: true, always: true });
  assert.ok(fs.existsSync(`${index}.head`)); // the warm index was kept and reconciled
});

test('with the marker naming the current HEAD and index the check is skipped, and any other marker runs it', () => {
  const r = forcedRepo('forced6'); warm(r);
  forceCommit(r, 'gen/m.txt');
  const index = path.resolve(r, g(r, 'rev-parse', '--git-path', 'orb/index-raw'));
  const raw = fs.readFileSync(index);
  const stamp = `${g(r, 'rev-parse', 'HEAD')}:${crypto.createHash('sha1').update(raw).digest('hex')}`;
  // a marker that claims the index is reconciled with the new HEAD: nothing is looked for, so the forced file stays out
  fs.writeFileSync(`${index}.head`, stamp);
  assert.ok(!tracked(r, snapshotCommit(r, { raw: true, always: true }).commit).includes('gen/m.txt'));
  // the same HEAD with another index checksum is not trusted
  fs.writeFileSync(`${index}.head`, `${stamp.split(':')[0]}:${'0'.repeat(40)}`);
  assert.ok(tracked(r, snapshotCommit(r, { raw: true, always: true }).commit).includes('gen/m.txt'));
});

// A rename that changes only letter case must reach the photo: with core.ignorecase `add -A` would keep the old spelling.
const folds = process.platform === 'win32' || process.platform === 'darwin' ? test : test.skip;
const caseRepo = (name) => {
  const r = forcedRepo(name); git(r, 'config', 'core.ignorecase', 'true');
  fs.mkdirSync(path.join(r, 'lib/x'), { recursive: true });
  fs.writeFileSync(path.join(r, 'Readme.md'), 'readme\n'); fs.writeFileSync(path.join(r, 'lib/x/Util.c'), 'util\n');
  git(r, 'add', '-A'); git(r, ...ident, 'commit', '-q', '-m', 'files');
  return r;
};
// two steps through a temporary name, because the file system will not rename onto itself
const recase = (r, from, to) => { fs.renameSync(path.join(r, from), path.join(r, `${from}.tmp`)); fs.renameSync(path.join(r, `${from}.tmp`), path.join(r, to)); };
const caseOf = (r, commit, re) => tracked(r, commit).filter((f) => re.test(f));

const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

folds('a hot photo after a letter-case rename holds the new name only', () => {
  const r = caseRepo('case1'); warm(r);
  nap(2600); // past the margin: the folder's date, not luck, is what finds the rename
  recase(r, 'Readme.md', 'README.md');
  const snap = snapshotCommit(r, { raw: true, always: true });
  assert.deepEqual(caseOf(r, snap.commit, /^readme/i), ['README.md']);
  // a later photo with nothing new keeps it
  assert.deepEqual(caseOf(r, snapshotCommit(r, { raw: true, always: true }).commit, /^readme/i), ['README.md']);
});

folds('a letter-case rename inside a folder, and of the folder itself, reaches the photo', () => {
  const r = caseRepo('case2'); warm(r);
  nap(2600);
  recase(r, 'lib/x/Util.c', 'lib/x/UTIL.c');
  assert.deepEqual(caseOf(r, snapshotCommit(r, { raw: true, always: true }).commit, /util/i), ['lib/x/UTIL.c']);
  nap(2600);
  recase(r, 'lib', 'Lib');
  assert.deepEqual(caseOf(r, snapshotCommit(r, { raw: true, always: true }).commit, /util/i), ['Lib/x/UTIL.c']);
});

folds('only folders touched since the last photo are read: an untouched one keeps its old name until it is touched', () => {
  const r = caseRepo('case2b'); warm(r);
  recase(r, 'lib/x/Util.c', 'lib/x/UTIL.c');
  const old = new Date(Date.now() - 3600_000);
  for (const d of ['lib/x', 'lib', '']) fs.utimesSync(path.join(r, d), old, old); // as if the rename were long ago
  assert.deepEqual(caseOf(r, snapshotCommit(r, { raw: true, always: true }).commit, /util/i), ['lib/x/Util.c']);
  const now = new Date(); fs.utimesSync(path.join(r, 'lib/x'), now, now);
  assert.deepEqual(caseOf(r, snapshotCommit(r, { raw: true, always: true }).commit, /util/i), ['lib/x/UTIL.c']);
});

folds('an index holding a.txt and A.txt, with only a.txt on disk, loses no entry', () => {
  const r = forcedRepo('case2c'); git(r, 'config', 'core.ignorecase', 'true');
  const blob = g(r, 'hash-object', '-w', 'a.txt');
  git(r, 'update-index', '--add', '--cacheinfo', `100644,${blob},A.txt`); git(r, ...ident, 'commit', '-q', '-m', 'dup');
  const first = snapshotCommit(r, { raw: true, always: true }); const second = snapshotCommit(r, { raw: true, always: true });
  for (const s of [first, second]) assert.equal(caseOf(r, s.commit, /^a\.txt$/i).length, 2);
});

folds('a submodule whose folder differs only in case is not turned into a file entry', () => {
  const r = forcedRepo('case2d'); git(r, 'config', 'core.ignorecase', 'true');
  git(r, 'update-index', '--add', '--cacheinfo', `160000,${g(r, 'rev-parse', 'HEAD')},Sub`); git(r, ...ident, 'commit', '-q', '-m', 'sub');
  fs.mkdirSync(path.join(r, 'Sub')); warm(r);
  fs.renameSync(path.join(r, 'Sub'), path.join(r, 'sub'));
  const snap = snapshotCommit(r, { raw: true, always: true });
  assert.ok(snap);
  assert.equal(g(r, 'ls-tree', snap.commit, 'Sub').split(/\s+/)[0], '160000');
});

folds('a full snapshot after a letter-case rename holds the new name', async () => {
  const r = caseRepo('case3');
  recase(r, 'Readme.md', 'README.md');
  const { fullSnapshot } = await import('../src/domain/tasks/checkpoints.mjs');
  const full = await fullSnapshot(r, { message: 'full' });
  assert.deepEqual(caseOf(r, full.commit, /^readme/i), ['README.md']);
});

// «Deshacer» / rewind from the photo taken after a letter-case rename back to the one before it: the file must stay, with
// the old spelling and its content (the deleted and the added path are one file on disk, so removing one removes both).
const undoCase = async (name, files, renames, edit = null, around = (run) => run()) => {
  const { undoCheckpoint } = await import('../src/domain/tasks/checkpoints.mjs');
  const r = forcedRepo(name); git(r, 'config', 'core.ignorecase', 'true');
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), c); }
  git(r, 'add', '-A'); git(r, ...ident, 'commit', '-q', '-m', 'files'); warm(r);
  const before = snapshotCommit(r, { raw: true, always: true });
  for (const [from, to] of renames) recase(r, from, to);
  if (edit) edit(r);
  const after = snapshotCommit(r, { raw: true, always: true });
  const out = around(() => undoCheckpoint({ kind: 'git', repo: r, commit: before.commit, raw: true }, { kind: 'git', repo: r, commit: after.commit }, { safe: true }));
  return { r, out };
};
const listing = (r, dir = '') => fs.readdirSync(path.join(r, dir)).sort();

folds('undoing README.md -> readme.md gives the file back with its old name and content', async () => {
  const { r, out } = await undoCase('case4a', { 'README.md': 'upper\n' }, [['README.md', 'readme.md']]);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(listing(r).filter((f) => /^readme/i.test(f)), ['README.md']);
  assert.equal(read(r, 'README.md'), 'upper\n');
});

folds('undoing Readme.md -> README.md gives the old name and content', async () => {
  const { r } = await undoCase('case4b', { 'Readme.md': 'orig\n' }, [['Readme.md', 'README.md']]);
  assert.deepEqual(listing(r).filter((f) => /^readme/i.test(f)), ['Readme.md']);
  assert.equal(read(r, 'Readme.md'), 'orig\n');
});

folds('undoing a folder Lib -> lib keeps every file in it, under the old spelling', async () => {
  const { r, out } = await undoCase('case4c', { 'Lib/a.c': 'a\n', 'Lib/b.c': 'b\n', 'Lib/sub/c.c': 'c\n' }, [['Lib', 'lib']]);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(listing(r).filter((f) => /^lib$/i.test(f)), ['Lib']);
  assert.deepEqual(listing(r, 'Lib'), ['a.c', 'b.c', 'sub']);
  assert.equal(read(r, 'Lib/b.c'), 'b\n'); assert.equal(read(r, 'Lib/sub/c.c'), 'c\n');
});

folds('undoing lib -> Lib (the other direction) keeps every file too', async () => {
  const { r } = await undoCase('case4d', { 'lib/a.c': 'a\n', 'lib/b.c': 'b\n' }, [['lib', 'Lib']]);
  assert.deepEqual(listing(r).filter((f) => /^lib$/i.test(f)), ['lib']);
  assert.deepEqual(listing(r, 'lib'), ['a.c', 'b.c']);
});

folds('a photo with no renamed file leaves every name as it is and keeps the folder-date stamp', () => {
  const r = caseRepo('case5'); warm(r);
  fs.writeFileSync(path.join(r, 'a.txt'), 'two\n'); fs.writeFileSync(path.join(r, 'lib/new.txt'), 'n\n'); // folder dates change, no name does
  const snap = snapshotCommit(r, { raw: true, always: true });
  assert.deepEqual(caseOf(r, snap.commit, /^readme|util/i), ['Readme.md', 'lib/x/Util.c']);
  const index = path.resolve(r, g(r, 'rev-parse', '--git-path', 'orb/index-raw'));
  const [at, id] = fs.readFileSync(`${index}.scan`, 'utf8').split(':');
  assert.ok(Date.now() - Number(at) < 60_000);
  assert.equal(id, crypto.createHash('sha1').update(fs.readFileSync(index)).digest('hex'));
});

// «Cambios» reuses the last photo when the folder is unchanged; a case-only rename is invisible to diff-index and ls-files.
folds('caseRenamed tells a letter-case rename from an untouched folder, so the last photo is not reused', async () => {
  const { caseRenamed } = await import('../src/domain/tasks/checkpoints.mjs');
  const r = caseRepo('case6'); warm(r);
  const raw = path.resolve(r, g(r, 'rev-parse', '--git-path', 'orb/index-raw'));
  const copy = `${raw}.check`;
  const probe = async () => { fs.copyFileSync(raw, copy); try { return await caseRenamed(r, raw, copy); } finally { fs.rmSync(copy, { force: true }); } };
  assert.equal(await probe(), false);
  recase(r, 'Readme.md', 'README.md');
  assert.equal(await probe(), true);
  snapshotCommit(r, { raw: true, always: true }); // the next photo has the new spelling
  assert.equal(await probe(), false);
});

test('caseRenamed does nothing without core.ignorecase', async () => {
  const { caseRenamed } = await import('../src/domain/tasks/checkpoints.mjs');
  const r = forcedRepo('case7'); git(r, 'config', 'core.ignorecase', 'false'); warm(r);
  const raw = path.resolve(r, g(r, 'rev-parse', '--git-path', 'orb/index-raw'));
  assert.equal(await caseRenamed(r, raw, raw), false);
});

// A network drive gives no inode: two spellings of one file must still never be removed as if they were two files.
const patched = (name, fake) => (run) => { const real = fs[name]; fs[name] = fake(real); try { return run(); } finally { fs[name] = real; } };
const noInode = patched('lstatSync', (real) => (f, o) => { const st = real(f, o); return o?.bigint ? { dev: st.dev, ino: 0n } : st; });

folds('with no inode from the file system, undoing README.md -> readme.md still keeps the file', async () => {
  const { r, out } = await undoCase('case8a', { 'README.md': 'upper\n' }, [['README.md', 'readme.md']], null, noInode);
  assert.deepEqual(out.removed, []);
  assert.deepEqual(listing(r).filter((f) => /^readme/i.test(f)), ['README.md']);
  assert.equal(read(r, 'README.md'), 'upper\n');
});

folds('with no inode, undoing a folder Lib -> lib keeps its files', async () => {
  const { r } = await undoCase('case8b', { 'Lib/a.c': 'a\n', 'Lib/b.c': 'b\n' }, [['Lib', 'lib']], null, noInode);
  assert.deepEqual(listing(r, listing(r).find((f) => /^lib$/i.test(f))), ['a.c', 'b.c']);
});

folds('when the second rename of a respelling fails, the file goes back and the reason is reported', async () => {
  let n = 0;
  const failSecond = patched('renameSync', (real) => (a, b) => { if (++n === 2) throw new Error('EPERM simulated'); return real(a, b); });
  const { r, out } = await undoCase('case8c', { 'README.md': 'upper\n' }, [['README.md', 'readme.md']], null, failSecond);
  assert.ok(out.skipped.some((x) => x.startsWith('README.md:') && x.includes('EPERM')), JSON.stringify(out));
  assert.equal(listing(r).filter((f) => /^readme/i.test(f)).length, 1);
  assert.equal(fs.readFileSync(path.join(r, listing(r).find((f) => /^readme/i.test(f))), 'utf8'), 'upper\n');
});

test('undoing a hard link the task made removes the link and keeps the file it points to', async () => {
  const { undoCheckpoint } = await import('../src/domain/tasks/checkpoints.mjs');
  const r = forcedRepo('case9'); warm(r);
  const before = snapshotCommit(r, { raw: true, always: true });
  fs.linkSync(path.join(r, 'a.txt'), path.join(r, 'b.txt'));
  const after = snapshotCommit(r, { raw: true, always: true });
  undoCheckpoint({ kind: 'git', repo: r, commit: before.commit, raw: true }, { kind: 'git', repo: r, commit: after.commit }, { safe: true });
  assert.ok(!fs.existsSync(path.join(r, 'b.txt')));
  assert.equal(read(r, 'a.txt'), 'one\n');
});

folds('caseRenamed uses the folder list of the last photo and lists the index only when a folder was touched', async () => {
  const { caseRenamed } = await import('../src/domain/tasks/checkpoints.mjs');
  const r = caseRepo('case10'); warm(r);
  const raw = path.resolve(r, g(r, 'rev-parse', '--git-path', 'orb/index-raw'));
  const old = new Date(Date.now() - 3600_000);
  for (const d of ['lib/x', 'lib', '']) fs.utimesSync(path.join(r, d), old, old);
  // with the index copy missing, any attempt to list it would fail loudly: an untouched folder tree needs none
  assert.equal(await caseRenamed(r, raw, path.join(r, 'no-such-index')), false);
});

// Direct use of the photo and rewind modules (no chat engine), on a repository of their own.
const alive = () => true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const photoRef = (r, sid, mark) => g(r, 'rev-parse', `refs/orb/turnos/${sid}/antes/${mark}^{commit}`);

test('a message photo sees an ignored file force-added and committed since the last photo, and a rewind keeps it', async () => {
  const r = forcedRepo('photo-i2'); const sid = 'i2';
  await snapshotBeforeTurn(r, sid, alive, { mark: 1 });
  fs.writeFileSync(path.join(r, 'a.txt'), 'turn 1\n');
  await snapshotAfterTurn(r, sid, alive);
  forceCommit(r, 'gen/datos.json');
  await snapshotBeforeTurn(r, sid, alive, { mark: 2 });
  assert.ok(tracked(r, `refs/orb/turnos/${sid}/antes/2`).includes('gen/datos.json'));
  fs.writeFileSync(path.join(r, 'a.txt'), 'turn 2\n');
  await snapshotAfterTurn(r, sid, alive);
  await rewindFiles(r, sid, 2);
  assert.equal(read(r, 'gen', 'datos.json'), 'gen/datos.json\n');
  assert.equal(read(r, 'a.txt'), 'turn 1\n');
});

test('a message photo is still reused when nothing changed and HEAD is the same', async () => {
  const r = forcedRepo('photo-reuse'); const sid = 'reuse';
  await snapshotBeforeTurn(r, sid, alive, { mark: 1 });
  await snapshotBeforeTurn(r, sid, alive, { mark: 2 }); // the first photo left no marker: this one is a new photo that writes it
  await snapshotBeforeTurn(r, sid, alive, { mark: 3 });
  assert.equal(photoRef(r, sid, 3), photoRef(r, sid, 2));
  await snapshotBeforeTurn(r, sid, alive, { mark: 4 }); // and again
  assert.equal(photoRef(r, sid, 4), photoRef(r, sid, 2));
  fs.writeFileSync(path.join(r, 'new.txt'), 'x\n');
  await snapshotBeforeTurn(r, sid, alive, { mark: 5 });
  assert.notEqual(photoRef(r, sid, 5), photoRef(r, sid, 2));
});

test('a rewind keeps a file that existed before the message but was ignored then, and deletes one the turn created', async () => {
  const r = forcedRepo('photo-i3'); const sid = 'i3';
  fs.mkdirSync(path.join(r, 'gen'), { recursive: true }); fs.writeFileSync(path.join(r, 'gen', 'clientes.csv'), 'only here\n');
  await sleep(100); // so the file is clearly older than the photo
  await snapshotBeforeTurn(r, sid, alive, { mark: 1 });
  await sleep(100);
  // the turn stops ignoring gen/ and creates a file of its own
  fs.writeFileSync(path.join(r, '.gitignore'), '.env\n');
  fs.writeFileSync(path.join(r, 'made.txt'), 'by the turn\n');
  await snapshotAfterTurn(r, sid, alive);
  const out = await rewindFiles(r, sid, 1);
  assert.equal(read(r, 'gen', 'clientes.csv'), 'only here\n');
  assert.ok(out.files.skipped.some((f) => f.startsWith('gen/clientes.csv')));
  assert.ok(!fs.existsSync(path.join(r, 'made.txt')));
  assert.ok(out.files.removed.includes('made.txt'));
  await undoRewindFiles(r, out);
  assert.equal(read(r, 'made.txt'), 'by the turn\n');
});

test('undoing a task still removes a file the task created', () => {
  const r = forcedRepo('task-undo');
  const before = snapshotCommit(r, { raw: true, always: true });
  fs.writeFileSync(path.join(r, 'task.txt'), 'new\n');
  const after = snapshotCommit(r, { raw: true, always: true });
  const out = undoCheckpoint({ kind: 'git', repo: r, commit: before.commit, raw: true }, { commit: after.commit });
  assert.deepEqual(out.removed, ['task.txt']);
  assert.ok(!fs.existsSync(path.join(r, 'task.txt')));
});

test('with a reused photo, a file ignored then that appeared before the message is kept when the turn stops ignoring it', async () => {
  const r = forcedRepo('photo-i3-reuse'); const sid = 'i3r';
  await snapshotBeforeTurn(r, sid, alive, { mark: 1 });
  await snapshotBeforeTurn(r, sid, alive, { mark: 2 }); // writes the marker
  await sleep(100);
  fs.mkdirSync(path.join(r, 'gen'), { recursive: true }); fs.writeFileSync(path.join(r, 'gen', 'mine.csv'), 'before the message\n');
  await sleep(100);
  const messageAt = Date.now();
  await sleep(100);
  await snapshotBeforeTurn(r, sid, alive, { mark: 3 });
  assert.equal(photoRef(r, sid, 3), photoRef(r, sid, 2)); // reused: older than the file
  fs.writeFileSync(path.join(r, '.gitignore'), '.env\n');
  fs.writeFileSync(path.join(r, 'made.txt'), 'by the turn\n');
  await snapshotAfterTurn(r, sid, alive);
  const out = await rewindFiles(r, sid, 3, { messageAt });
  assert.equal(read(r, 'gen', 'mine.csv'), 'before the message\n');
  assert.ok(out.files.skipped.some((f) => f.startsWith('gen/mine.csv')));
  assert.ok(!fs.existsSync(path.join(r, 'made.txt')));
});
