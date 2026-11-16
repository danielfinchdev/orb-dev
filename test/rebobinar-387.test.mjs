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
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';

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
