// 3.8.8 paso 11b (tanda 3), motor: la firma del OK en tasks.get, el porqué de un diff vacío, un archivo entero antes y
// después (solo si está en el diff de la tarea) y «Abrir en el editor» un archivo y su línea (sin lanzar ningún programa).
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
import { DESKTOP, principalOf } from '../src/domain/security/permissions.mjs';
import { git } from '../src/platform/git.mjs';
import { takeCheckpoint, snapshotCommit, fileBetween } from '../src/domain/tasks/checkpoints.mjs';
import { fileArgs } from '../src/engine/host/editors.mjs';
import { attachHost, hostReply, checkHostRequest } from '../src/engine/host/host.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions; let repo;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'tanda3'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'untouched\n');
  fs.writeFileSync(path.join(repo, 'gone.txt'), 'bye\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  board.addProject({ name: 'tanda3', path: repo }, 'usuario', { fromUser: true });
});
after(() => { attachHost(null); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

let made = null;
const finishedTask = () => (made ??= makeFinishedTask());
function makeFinishedTask() {
  const cp = takeCheckpoint(repo, `t-tanda3-${Date.now()}`, path.join(t.home, 'fotos'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n2\nthree\n');
  fs.writeFileSync(path.join(repo, 'new file.txt'), 'hello\n');
  fs.writeFileSync(path.join(repo, '-dash.txt'), 'dash\n');
  fs.writeFileSync(path.join(repo, 'pic.bin'), Buffer.from([0, 1, 2, 0, 255]));
  fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=secret\n');
  fs.rmSync(path.join(repo, 'gone.txt'));
  const end = snapshotCommit(repo, { always: true, message: 'after' });
  const task = board.createTask({ project: 'tanda3', title: 'Edit', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${task.id}`, { before: cp, after: { kind: 'git', repo, commit: end.commit }, head: null, remotes: null });
  return task;
}

test('firma: una tarea que pide aprobación se ve sin firmar, firmada y verificada, y no válida si cambia después', async () => {
  const sensitive = board.createTask({ project: 'tanda3', title: 'Publicar', description: 'sube la web', sensitivity: ['publish'] }, 'usuario');
  let a = (await call('tasks.get', { id: sensitive.id })).approval;
  assert.deepEqual({ required: a.required, signed: a.signed, verified: a.verified, by: a.by, at: a.at }, { required: true, signed: false, verified: false, by: null, at: null });
  const got = await call('tasks.get', { id: sensitive.id });
  await call('tasks.approve', { id: sensitive.id, decision: 'approved', hash: got.previewHash });
  const signed = await call('tasks.get', { id: sensitive.id });
  a = signed.approval;
  assert.equal(a.required, true); assert.equal(a.signed, true); assert.equal(a.verified, true);
  assert.equal(a.by, 'usuario'); assert.ok(a.at);
  assert.deepEqual(Object.keys(a).sort(), ['at', 'by', 'required', 'signed', 'verified'], 'nothing of the signature itself');
  // the same check the scheduler makes before launching says the same
  assert.equal(board.approvalOk(board.task(sensitive.id)), true);
  board.run('UPDATE tasks SET description = ? WHERE id = ?', 'borra todo', sensitive.id);
  a = (await call('tasks.get', { id: sensitive.id })).approval;
  assert.equal(a.signed, true); assert.equal(a.verified, false);
  assert.equal(board.approvalOk(board.task(sensitive.id)), false, 'the launcher refuses it too');
});

test('firma: una tarea sin etiquetas no necesitaba aprobación; la lista no lleva el campo', async () => {
  const plain = board.createTask({ project: 'tanda3', title: 'Simple', description: 'lee' }, 'usuario');
  const a = (await call('tasks.get', { id: plain.id })).approval;
  assert.equal(a.required, false); assert.equal(a.signed, false);
  const row = (await call('tasks.list', {})).find((x) => x.id === plain.id);
  assert.equal(row.approval, undefined);
});

test('tasks.diff: el motivo de que no haya diff es el real', async () => {
  const none = board.createTask({ project: 'tanda3', title: 'Sin foto', description: 'x' }, 'usuario');
  assert.equal((await call('tasks.diff', { id: none.id })).reason, 'nophoto');
  const copy = board.createTask({ project: 'tanda3', title: 'Copia', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${copy.id}`, { before: { kind: 'copy', dir: 'x' } });
  assert.equal((await call('tasks.diff', { id: copy.id })).reason, 'nogit');
  const open = board.createTask({ project: 'tanda3', title: 'En curso', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${open.id}`, { before: { kind: 'git', repo, commit: 'abc' } });
  assert.equal((await call('tasks.diff', { id: open.id })).reason, 'notdone');
});

test('tasks.diff {file}: el archivo entero antes y después, solo de los archivos del diff', async () => {
  const task = finishedTask();
  const same = (r, o) => { for (const [k, v] of Object.entries(o)) assert.deepEqual(r[k], v, k); };
  same(await call('tasks.diff', { id: task.id, file: 'a.txt' }), { available: true, path: 'a.txt', status: 'M', before: 'one\ntwo\nthree\n', after: 'one\n2\nthree\n', binary: false, tooBig: false });
  same(await call('tasks.diff', { id: task.id, file: 'new file.txt' }), { status: 'A', before: null, after: 'hello\n' });
  same(await call('tasks.diff', { id: task.id, file: 'gone.txt' }), { status: 'D', before: 'bye\n', after: null });
  same(await call('tasks.diff', { id: task.id, file: 'pic.bin' }), { binary: true, before: null, after: null });
  same(await call('tasks.diff', { id: task.id, file: '-dash.txt' }), { after: 'dash\n' });
  for (const bad of ['keep.txt', '.env', '../x', 'C:/Windows/win.ini', '/etc/passwd', 'a.txt/../keep.txt', '', 'nope.txt']) {
    await assert.rejects(call('tasks.diff', { id: task.id, file: bad }), undefined, `rejected: ${bad}`);
  }
  // the diff of the whole task is the same as before
  assert.ok((await call('tasks.diff', { id: task.id })).files.length >= 4);
});

test('tasks.diff: si solo cambian archivos protegidos lo dice (hidden) y no enseña ninguno', async () => {
  const solo = path.join(t.home, 'web', 'solo-env'); fs.mkdirSync(solo, { recursive: true });
  // commits made by hand: the task's own snapshots never keep a secret-looking file, so this is the diff's safety net
  const commit = (msg) => { git(solo, 'add', '-A'); git(solo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git(solo, 'rev-parse', 'HEAD').stdout.trim(); };
  git(solo, 'init', '-q'); fs.writeFileSync(path.join(solo, 'a.txt'), 'x\n'); fs.writeFileSync(path.join(solo, '.env'), 'TOKEN=1\n');
  const first = commit('first');
  fs.writeFileSync(path.join(solo, '.env'), 'TOKEN=2\n');
  const second = commit('second');
  const task = board.createTask({ project: 'tanda3', title: 'Solo env', description: 'x' }, 'usuario');
  board.settingJson(`checkpoint:${task.id}`, { before: { kind: 'git', repo: solo, commit: first }, after: { kind: 'git', repo: solo, commit: second }, head: null, remotes: null });
  for (const params of [{ id: task.id }, { id: task.id, stat: true }]) {
    const r = await call('tasks.diff', params);
    assert.equal(r.available, true); assert.deepEqual(r.files, []); assert.equal(r.more, 0);
    assert.equal(r.hidden, 1, JSON.stringify(params));
  }
  assert.equal((await call('tasks.diff', { id: finishedTask().id })).hidden, 0, 'a task without protected changes says 0');
});

test('fileBetween: un archivo por encima del tope no se lee entero', () => {
  const task = finishedTask();
  const cp = board.settingJson(`checkpoint:${task.id}`);
  const r = fileBetween(repo, cp.before.commit, cp.after.commit, 'a.txt', { maxBytes: 5 });
  assert.equal(r.tooBig, true); assert.equal(r.before, null); assert.equal(r.after, null);
});

test('tasks.diff: el móvil sigue viendo el diff, pero el archivo entero es solo de la ventana del PC', async () => {
  const task = finishedTask();
  assert.ok((await call('tasks.diff', { id: task.id }, REMOTE)).files.length >= 4);
  assert.ok((await call('tasks.diff', { id: task.id, stat: true }, REMOTE)).files.length >= 4);
  await assert.rejects(call('tasks.diff', { id: task.id, file: 'a.txt' }, REMOTE));
});

test('fileArgs: los argumentos de cada editor, en lista y con el archivo absoluto', () => {
  const dir = path.resolve('/proj'); const file = path.join(dir, 'src', 'a.js');
  assert.deepEqual(fileArgs('vscode', dir, file, 12), [dir, '--goto', `${file}:12`]);
  assert.deepEqual(fileArgs('cursor', dir, file), [dir, '--goto', file]);
  assert.deepEqual(fileArgs('windsurf', dir, file, 3), [dir, '--goto', `${file}:3`]);
  assert.deepEqual(fileArgs('zed', dir, file, 7), [dir, `${file}:7`]);
  assert.deepEqual(fileArgs('jetbrains', dir, file, 7), [dir, '--line', '7', file]);
  assert.throws(() => fileArgs('notepad', dir, file, 1));
  assert.throws(() => fileArgs('vscode', dir, '-r', 1), 'never a relative name that could pass for an option');
  assert.throws(() => fileArgs('vscode', dir, file, 0));
  assert.throws(() => fileArgs('vscode', dir, file, 1.5));
  assert.throws(() => fileArgs('vscode', dir, file, '3; calc'));
});

test('checkHostRequest: file y line de host.openEditor solo pasan si son relativos y válidos', () => {
  const dir = repo;
  assert.deepEqual(checkHostRequest('host.openEditor', { which: 'vscode', dir, file: 'src/a.js', line: 4 }), { which: 'vscode', dir, file: 'src/a.js', line: 4 });
  assert.deepEqual(checkHostRequest('host.openEditor', { which: 'vscode', dir, file: '../x', line: 4 }), { which: 'vscode', dir });
  assert.deepEqual(checkHostRequest('host.openEditor', { which: 'vscode', dir, file: 'C:\\x', line: 4 }), { which: 'vscode', dir });
  assert.deepEqual(checkHostRequest('host.openEditor', { which: 'vscode', dir }), { which: 'vscode', dir });
  for (const file of ['.git/config', 'src/.GIT/config', '.orb/x', 'a\\.Orb\\x', '.orb-adjuntos/a.png']) {
    assert.deepEqual(checkHostRequest('host.openEditor', { which: 'vscode', dir, file, line: 4 }), { which: 'vscode', dir }, file);
  }
});

test('app.openFileIn: rechaza lo que sale del proyecto, lo secreto, lo que no existe y lo que empieza por «-»; acepta uno válido', async () => {
  await assert.rejects(call('app.openFileIn', { which: 'vscode', dir: repo, file: 'a.txt' }, REMOTE), undefined, 'the phone cannot launch programs on the PC');
  // an editor "installed" in a made-up place of this PC (Windows layout); the test launches nothing
  if (process.platform !== 'win32') return;
  const local = path.join(t.home, 'localapp'); const exe = path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '');
  const old = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = local;
  const sent = [];
  attachHost((msg) => { sent.push(msg); hostReply({ id: msg.id, ok: true, result: true }); });
  try {
    fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=1\n'); fs.writeFileSync(path.join(repo, '-opt.txt'), 'x\n');
    fs.mkdirSync(path.join(repo, 'dir'), { recursive: true });
    const bad = ['../outside.txt', '..\\outside.txt', 'C:\\Windows\\win.ini', '/etc/passwd', '.env', 'nope.txt', 'dir', 'a.txt::$DATA', 'a.txt.', '.git/config'];
    for (const file of bad) await assert.rejects(call('app.openFileIn', { which: 'vscode', dir: repo, file, line: 3 }), undefined, `rejected: ${file}`);
    for (const line of [0, -1, 1.5, '3', 'x', 1e9]) await assert.rejects(call('app.openFileIn', { which: 'vscode', dir: repo, file: 'a.txt', line }), undefined, `line ${line}`);
    await assert.rejects(call('app.openFileIn', { which: 'cursor', dir: repo, file: 'a.txt', line: 1 }), undefined, 'an editor that is not installed');
    await assert.rejects(call('app.openFileIn', { which: 'explorer', dir: repo, file: 'a.txt' }), undefined, 'only an editor');
    assert.equal(sent.length, 0, 'nothing reached the host');
    const ok = await call('app.openFileIn', { which: 'vscode', dir: repo, file: 'a.txt', line: 2 });
    const abs = fs.realpathSync.native(path.join(repo, 'a.txt'));
    assert.equal(ok.file, 'a.txt'); assert.equal(ok.line, 2);
    assert.deepEqual(ok.args, [repo, '--goto', `${abs}:2`]);
    assert.equal(sent.length, 1); assert.equal(sent[0].method, 'host.openEditor');
    assert.deepEqual(sent[0].params, { which: 'vscode', dir: repo, file: 'a.txt', line: 2 });
    // a name that starts with «-» is a file, never an option: its absolute path leads the argument
    const dash = await call('app.openFileIn', { which: 'vscode', dir: repo, file: '-opt.txt' });
    assert.ok(path.isAbsolute(dash.args.at(-1).replace(/:\d+$/, '')));
    // only the folder of a project or of a task's work: any other folder is refused, however it is written
    const other = path.join(t.home, 'otra'); fs.mkdirSync(other, { recursive: true }); fs.writeFileSync(path.join(other, 'x.txt'), 'x\n');
    const before = sent.length;
    await assert.rejects(call('app.openFileIn', { which: 'vscode', dir: other, file: 'x.txt' }), undefined, 'a folder that is nobody\'s');
    assert.equal(sent.length, before);
    const owner = board.createTask({ project: 'tanda3', title: 'Copia', description: 'x' }, 'usuario');
    board.patch(owner.id, { workdir: other }, 'orb', 'task.test');
    assert.equal((await call('app.openFileIn', { which: 'vscode', dir: other, file: 'x.txt' })).file, 'x.txt', 'the work folder of a task');
    // core is guarded by the file that is really opened, not only by the folder given
    // (core/bitacora is a folder meant to be opened; the configuration is not)
    assert.ok(fs.existsSync(path.join(t.home, 'core', 'orb.json')));
    const homeTask = board.createTask({ project: 'tanda3', title: 'Casa', description: 'x' }, 'usuario');
    board.patch(homeTask.id, { workdir: t.home }, 'orb', 'task.test');
    const sentBefore = sent.length;
    await assert.rejects(call('app.openFileIn', { which: 'vscode', dir: t.home, file: 'core/orb.json' }), undefined, 'core without unlock');
    assert.equal(sent.length, sentBefore);
  } finally { attachHost(null); if (old === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = old; }
});
