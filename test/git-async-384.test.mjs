// 3.8.4 (R5): the engine no longer runs git synchronously when a task ends, when a copy is joined into its folder, nor in
// the GitHub card and the expert views: the event loop keeps turning, and the order of what happens stays the same.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome, wait } from './helpers.mjs';
import { tr, ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { git, gitAsync, gitBufferAsync, gitAsyncWith } from '../src/platform/git.mjs';
import { prepareWorkdir, snapshotCommit, snapshotCommitAsync, changedBetween, changedBetweenAsync, takeCheckpoint } from '../src/domain/tasks/checkpoints.mjs';
import { commitAll } from '../src/engine/host/github.mjs';
import { gitStatus } from '../src/engine/host/expert.mjs';

let h; let board; let sched; let n = 0;
const raw = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { stdio: 'pipe', encoding: 'utf8' });
before(() => {
  h = tempHome(); board = new Board();
  sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
});
after(() => { try { board.db.close(); } catch { /* closed */ } h.cleanup(); });

// A project with a git repository (files: how many files it starts with).
function project(files = 3) {
  const name = `p${++n}`; const dir = path.join(h.home, 'web', name); fs.mkdirSync(dir, { recursive: true });
  raw(dir, 'init', '-q');
  for (let i = 0; i < files; i++) { const f = path.join(dir, 'src', `d${i % 10}`, `f${i}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `file ${i}\n`); }
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x\n');
  raw(dir, 'add', '-A'); raw(dir, 'commit', '-q', '-m', 'base');
  board.addProject({ name, path: dir }, 'usuario', { fromUser: true });
  return { name, dir };
}
// How many times the loop turned while `make()` was pending (a 1 ms timer): zero when it blocks.
async function spins(make) {
  let ticks = 0; const timer = setInterval(() => { ticks++; }, 1);
  try {
    const pending = make();
    assert.ok(pending && typeof pending.then === 'function', 'returns a promise');
    const before = ticks;
    const value = await pending;
    return { value, ticks: ticks - before };
  } finally { clearInterval(timer); }
}
// A "carpeta" task as the scheduler leaves it when it starts: running, with the checkpoint before it.
function folderTask(p, title = 'Edit') {
  const task = board.createTask({ project: p.name, title, description: 'x', agent: 'claude' }, 'usuario');
  sched.folderWorkspace(board.task(task.id), board.project(p.name));
  board.patch(task.id, { status: 'running', pid: 4242 }, 'orb', 'task.launched');
  return board.task(task.id);
}
const ended = { code: 0, state: { final: 'hecho', text: 'hecho', isError: false }, stderr: '', stopped: false, timedOut: false, limit: null };
// A finished task in its own copy, with a file committed there, waiting to be joined (what finishNow leaves).
function waitingCopy(p, file, content) {
  const task = board.createTask({ project: p.name, title: `Copia ${file}`, description: 'x', agent: 'claude', mode: 'aislada' }, 'usuario');
  const base = raw(p.dir, 'rev-parse', 'HEAD').trim();
  const wt = prepareWorkdir(board.task(task.id), board.project(p.name), ctx.paths.worktrees);
  fs.writeFileSync(path.join(wt.workdir, file), content);
  raw(wt.workdir, 'add', '-A'); raw(wt.workdir, 'commit', '-q', '-m', 'work');
  board.patch(task.id, { status: 'done', branch: wt.branch, workdir: wt.workdir }, 'orb', 'task.finished');
  board.settingJson(`isolated:${task.id}`, { base });
  board.settingJson(`integrate:${task.id}`, { base, at: new Date().toISOString() });
  return board.task(task.id);
}
const events = (id, kind) => board.all('SELECT detail FROM events WHERE task_id = ? AND kind = ?', id, kind);

test('async git: the same answers as the synchronous one, and a cut output says so', async () => {
  const p = project(5);
  assert.deepEqual((await gitAsync(p.dir, {}, 'rev-parse', 'HEAD')).stdout, git(p.dir, 'rev-parse', 'HEAD').stdout);
  const buf = await gitBufferAsync(p.dir, 'cat-file', 'blob', 'HEAD:x.txt');
  assert.ok(Buffer.isBuffer(buf.stdout)); assert.equal(buf.stdout.toString(), 'x\n'); assert.equal(buf.status, 0);
  const cut = await gitAsyncWith(p.dir, { max: 10 }, 'ls-files');
  assert.equal(cut.cut, true); assert.ok(cut.stdout.length <= 10);
  assert.notEqual((await gitAsyncWith(p.dir, {}, 'ls-files')).cut, true);
  // The asynchronous snapshot and diff give what the synchronous ones give.
  const a = snapshotCommit(p.dir, { always: true, message: 'm' }); const b = await snapshotCommitAsync(p.dir, { always: true, message: 'm' });
  assert.equal(a.files, b.files);
  fs.writeFileSync(path.join(p.dir, 'x.txt'), 'changed\n'); fs.writeFileSync(path.join(p.dir, 'new.txt'), 'n\n');
  const s1 = snapshotCommit(p.dir, { always: true, message: 'm2' }); const s2 = await snapshotCommitAsync(p.dir, { always: true, message: 'm2' });
  assert.deepEqual(await changedBetweenAsync(p.dir, a.commit, s2.commit), changedBetween(p.dir, a.commit, s1.commit));
});

test('the event loop keeps turning while a task is closed, committed, joined, and while the card and the expert view read git', async () => {
  const p = project(150);
  // afterFolderTask
  const task = folderTask(p);
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(p.dir, 'src', `d${i % 10}`, `f${i}.txt`), `changed ${i}\n`);
  const a = await spins(() => sched.afterFolderTask(task));
  assert.equal(a.value, ''); assert.ok(a.ticks > 0, `afterFolderTask blocked the loop (${a.ticks})`);
  // commitIsolated
  const iso = project(150); fs.writeFileSync(path.join(iso.dir, 'nuevo.txt'), 'n\n');
  const c = await spins(() => Scheduler.prototype.commitIsolated.call({ board }, { id: 1, title: 't', branch: 'orb/x', workdir: iso.dir }));
  assert.equal(c.value, ''); assert.ok(c.ticks > 0, `commitIsolated blocked the loop (${c.ticks})`);
  assert.equal(raw(iso.dir, 'log', '-1', '--format=%s').trim().startsWith('orb: tarea #1'), true);
  // integratePending
  const jp = project(150); const copy = waitingCopy(jp, 'unido.txt', 'u\n');
  const j = await spins(() => sched.integratePending());
  assert.ok(j.ticks > 0, `integratePending blocked the loop (${j.ticks})`);
  assert.equal(events(copy.id, 'task.integrated').length, 1);
  // github.commitAll and expert.gitStatus
  const gp = project(150); fs.writeFileSync(path.join(gp.dir, 'otro.txt'), 'o\n');
  const g = await spins(() => commitAll(board.project(gp.name), 'mensaje'));
  assert.equal(g.value.files, 1); assert.ok(g.ticks > 0, `commitAll blocked the loop (${g.ticks})`);
  fs.writeFileSync(path.join(gp.dir, 'otro2.txt'), 'o\n');
  const e = await spins(() => gitStatus(gp.dir));
  assert.ok(e.value.files.some((f) => f.path === 'otro2.txt')); assert.ok(e.ticks > 0, `gitStatus blocked the loop (${e.ticks})`);
});

test('while a folder task is being closed nothing starts in its project and nobody undoes it', async () => {
  const p = project(50);
  const task = folderTask(p, 'Cerrándose'); const other = folderTask(p, 'Otra');
  fs.writeFileSync(path.join(p.dir, 'a.txt'), 'a\n');
  const launched = []; const real = sched.launch; sched.launch = (t) => { launched.push(t.id); };
  const queued = board.createTask({ project: p.name, title: 'En cola', description: 'x', agent: 'claude' }, 'usuario');
  try {
    sched.running.set(task.id, { sessionId: 's', agent: 'claude' });
    const fin = sched.finish(task.id, ended);
    assert.equal(sched.held(p.name), true, 'the project is held at once');
    assert.equal(sched.running.has(task.id), false);
    sched.tick();
    assert.ok(!launched.includes(queued.id), 'no task starts in a project being closed');
    await assert.rejects(() => sched.undo(task.id), new RegExp(tr('msg.scheduler.undoRunning').slice(0, 20)));
    await assert.rejects(() => sched.undo(other.id), new RegExp(tr('msg.scheduler.undoBusy').slice(0, 20)));
    await fin;
    assert.equal(sched.held(p.name), false, 'released when it is over');
    assert.equal(sched.finishing.size, 0);
    assert.equal(board.task(task.id).status, 'done');
  } finally { sched.launch = real; }
});

test('hold counts: two holds need two releases, and a release is idempotent', () => {
  const r1 = sched.hold('zz'); const r2 = sched.hold('zz');
  assert.equal(sched.held('zz'), true);
  r1(); r1(); assert.equal(sched.held('zz'), true);
  r2(); assert.equal(sched.held('zz'), false);
});

test('two joins at once join a copy once; a held project is not joined until it is released', async () => {
  const p = project(10); const copy = waitingCopy(p, 'copia.txt', 'dentro\n');
  const release = sched.hold(p.name);
  await sched.integratePending();
  assert.equal(fs.existsSync(path.join(p.dir, 'copia.txt')), false, 'held: not joined');
  assert.ok(board.settingJson(`integrate:${copy.id}`), 'the join stays pending');
  release();
  await Promise.all([sched.integratePending(), sched.integratePending()]);
  assert.equal(fs.readFileSync(path.join(p.dir, 'copia.txt'), 'utf8').trim(), 'dentro'); // the line ending is the repository's own
  assert.equal(events(copy.id, 'task.integrated').length, 1, 'one join');
  assert.equal(events(copy.id, 'files.changed').length, 1);
  assert.equal(board.settingJson(`integrate:${copy.id}`), null);
  assert.equal(sched.held(p.name), false);
});

test("the photo after a task does not take the files of another copy's join", async () => {
  const p = project(10);
  const copy = waitingCopy(p, 'ajeno.txt', 'a\n'); // its copy starts before the task writes anything
  const task = folderTask(p, 'Escribe'); fs.writeFileSync(path.join(p.dir, 'suyo.txt'), 's\n');
  sched.running.set(task.id, { sessionId: 's', agent: 'claude' });
  const fin = sched.finish(task.id, ended);
  await sched.integratePending(); // while it is closing: skipped
  await fin;
  const changed = events(task.id, 'files.changed').map((e) => e.detail).join(' ');
  assert.match(changed, /suyo\.txt/); assert.doesNotMatch(changed, /ajeno\.txt/);
  // …and its join waited for the closing to finish (finishNow releases the project right before joining its own).
  await sched.integratePending();
  assert.equal(fs.existsSync(path.join(p.dir, 'ajeno.txt')), true);
  assert.equal(events(copy.id, 'task.integrated').length, 1);
  // «Deshacer» of the first task leaves the join alone.
  await sched.undo(task.id);
  assert.equal(fs.existsSync(path.join(p.dir, 'suyo.txt')), false); assert.equal(fs.existsSync(path.join(p.dir, 'ajeno.txt')), true);
});

test('start: a finished task whose process was left is closed before the leftovers are cleaned', async () => {
  const p = project(5);
  const copy = waitingCopy(p, 'pendiente.txt', 'p\n');
  board.settingJson(`integrate:${copy.id}`, null); // as the 3.8.3 start finds it: nothing marked yet
  board.patch(copy.id, { pid: 777 }, 'orb', 'task.updated');
  const s = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {} });
  assert.ok(s.ready && typeof s.ready.then === 'function', 'the start can be waited for');
  await s.ready;
  assert.equal(board.task(copy.id).pid, null, 'closed');
  assert.ok(fs.existsSync(copy.workdir) || board.task(copy.id).branch === null, 'its copy is not lost before it is joined');
});

test('«Deshacer» gives the folder back byte by byte after an asynchronous close', async () => {
  const p = project(20);
  fs.writeFileSync(path.join(p.dir, 'crlf.txt'), Buffer.from('a\r\nb\nc\r\n'));
  fs.writeFileSync(path.join(p.dir, 'borrame.txt'), 'bye\n'); raw(p.dir, 'add', '-A'); raw(p.dir, 'commit', '-q', '-m', 'more');
  const listing = () => Object.fromEntries(raw(p.dir, 'ls-files', '-z').split('\0').filter(Boolean).map((f) => [f, fs.readFileSync(path.join(p.dir, f)).toString('base64')]));
  const before = listing();
  const task = folderTask(p, 'Cambia');
  fs.writeFileSync(path.join(p.dir, 'creado.txt'), 'nuevo\n');
  fs.writeFileSync(path.join(p.dir, 'x.txt'), 'cambiado\n');
  fs.writeFileSync(path.join(p.dir, 'crlf.txt'), Buffer.from('z\nz\r\n'));
  fs.rmSync(path.join(p.dir, 'borrame.txt'));
  sched.running.set(task.id, { sessionId: 's', agent: 'claude' });
  await sched.finish(task.id, ended);
  assert.equal(board.task(task.id).status, 'done');
  await sched.undo(task.id);
  assert.equal(fs.existsSync(path.join(p.dir, 'creado.txt')), false);
  assert.deepEqual(listing(), before);
});

test("expert and the GitHub actions do not run the project's fsmonitor or hooks", async () => {
  const p = project(3);
  const marker = path.join(h.base, 'ran.txt'); fs.rmSync(marker, { force: true });
  const script = path.join(h.base, 'run.js'); fs.writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(marker)}, 'x');`);
  raw(p.dir, 'config', 'core.fsmonitor', `node "${script.replace(/\\/g, '/')}"`);
  const hook = path.join(p.dir, '.git', 'hooks', 'pre-commit'); fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nnode "${script.replace(/\\/g, '/')}"\n`); try { fs.chmodSync(hook, 0o755); } catch { /* windows */ }
  fs.writeFileSync(path.join(p.dir, 'nuevo.txt'), 'n\n');
  await gitStatus(p.dir);
  assert.equal(fs.existsSync(marker), false, 'expert: fsmonitor did not run');
  await commitAll(board.project(p.name), 'sin ganchos');
  await wait(100);
  assert.equal(fs.existsSync(marker), false, 'github: neither fsmonitor nor the pre-commit hook ran');
});

// A task in its own copy, running, with a file written in the copy (not committed: finishNow commits it).
function runningCopy(p, file = 'nuevo.txt') {
  const task = board.createTask({ project: p.name, title: `iso ${file}`, description: 'x', agent: 'claude' }, 'usuario');
  const base = raw(p.dir, 'rev-parse', 'HEAD').trim();
  const wt = prepareWorkdir(board.task(task.id), board.project(p.name), ctx.paths.worktrees);
  board.settingJson(`isolated:${task.id}`, { base });
  fs.writeFileSync(path.join(wt.workdir, file), 'n\n');
  board.patch(task.id, { status: 'running', pid: 4242, branch: wt.branch, workdir: wt.workdir }, 'orb', 'task.launched');
  sched.running.set(task.id, { sessionId: 's', agent: 'claude' });
  return { task: board.task(task.id), base };
}

test('a task in its own copy joins it inside its own close, before it says it ended', async () => {
  const p = project(5); const { task } = runningCopy(p);
  await sched.finish(task.id, ended);
  assert.equal(fs.existsSync(path.join(p.dir, 'nuevo.txt')), true, 'the file is in the folder');
  assert.ok(board.settingJson(`checkpoint:${task.id}`), 'there is a checkpoint to undo');
  assert.equal(board.settingJson(`integrate:${task.id}`), null);
  const kinds = board.all('SELECT kind FROM events WHERE task_id = ? ORDER BY id', task.id).map((e) => e.kind);
  assert.ok(kinds.indexOf('task.integrated') >= 0 && kinds.indexOf('task.integrated') < kinds.indexOf('agent.reply'), kinds.join(','));
  // Order of bf153ee: the copy is dropped from the task before the join is written down.
  assert.ok(kinds.indexOf('task.copy_removed') < kinds.indexOf('task.integrated'), kinds.join(','));
  assert.equal(sched.held(p.name), false);
});

test('finish called twice for a task keeps the entry of the second close', async () => {
  const p = project(3); const t = folderTask(p, 'Dos veces');
  sched.running.set(t.id, { sessionId: 's', agent: 'claude' });
  const a = sched.finish(t.id, ended); const b = sched.finish(t.id, ended);
  await a;
  assert.equal(sched.finishing.has(t.id), sched.finishing.get(t.id) === b ? true : false);
  await b;
  assert.equal(sched.finishing.size, 0);
});

test('closing the app: no new join starts, and drain waits until nothing is closing or joining', async () => {
  const p = project(5); const copy = waitingCopy(p, 'tarde.txt', 't\n');
  sched.closing = true;
  try {
    await sched.integratePending();
    assert.equal(fs.existsSync(path.join(p.dir, 'tarde.txt')), false, 'no join starts while closing');
    assert.ok(board.settingJson(`integrate:${copy.id}`));
    const launched = []; const real = sched.launch; sched.launch = (t) => launched.push(t.id);
    board.createTask({ project: p.name, title: 'No', description: 'x', agent: 'claude' }, 'usuario');
    try { sched.tick(); } finally { sched.launch = real; }
    assert.deepEqual(launched, []);
    // A job that appears while another is being waited for is waited for too.
    let late = false;
    sched.finishing.set(-1, new Promise((r) => setTimeout(() => { sched.joining.set(-2, new Promise((r2) => setTimeout(() => { late = true; r2(); }, 50))); r(); }, 50)));
    await sched.drain(5000);
    assert.equal(late, true);
  } finally { sched.closing = false; sched.finishing.delete(-1); sched.joining.delete(-2); }
});

test('git that is cut or timed out is refused by the secret checks of a commit and a push', async () => {
  const { stagedSecretsAsync } = await import('../src/shared/secrets-scan.mjs');
  const { unpushedSecrets } = await import('../src/engine/host/github.mjs');
  await assert.rejects(() => stagedSecretsAsync('x', async () => ({ status: -1, stdout: '', stderr: '', cut: true })));
  await assert.rejects(() => stagedSecretsAsync('x', async () => ({ status: -1, stdout: '', stderr: '', timedOut: true })));
  const p = project(5); fs.writeFileSync(path.join(p.dir, 'big.txt'), `${'x'.repeat(200)}\n`); raw(p.dir, 'add', '-A'); raw(p.dir, 'commit', '-q', '-m', 'big');
  await assert.rejects(() => unpushedSecrets(p.dir, 'HEAD', { max: 10 }));
  assert.deepEqual(await unpushedSecrets(p.dir, 'HEAD'), []);
  const t = await gitAsyncWith(p.dir, { timeout: 1 }, 'log');
  assert.equal(t.status, -1); assert.equal(t.timedOut, true);
});
