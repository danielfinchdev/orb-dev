// 3.8.8 step 11b (batch 4B), engine: the PR filter (merged and closed lists, the three counters, checks summarized),
// «Revisar tarea» of a PR, «Sincronizar» (fetch, fast-forward, push) against a local bare remote, and «Escribir entrada» in a
// project's logbook. A fake gh and temporary repositories: nothing touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS, REMOTE_METHODS, principalOf } from '../src/domain/security/permissions.mjs';
import { setGhForTests, checksSummary } from '../src/engine/host/github.mjs';
import { setCacheClock, forgetRepos } from '../src/engine/host/pr-cache.mjs';
import { countLogEntries } from '../src/domain/journal/journal.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const keepAlive = setInterval(() => {}, 1000);
let t; let board; let api; let sessions; let scheduler; let repo; let remote; let other;
const calls = []; let reply = () => ({ ok: true, out: '[]', err: '' });
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const commit = (dir, file, text, msg) => { fs.writeFileSync(path.join(dir, file), text); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };
const theirs = (file, text, msg) => { git(other, 'pull', '-q', '--ff-only'); commit(other, file, text, msg); git(other, 'push', '-q', 'origin', 'main'); };

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  remote = path.join(t.home, 'remote.git'); repo = path.join(t.home, 'web', 'tienda'); other = path.join(t.home, 'other');
  fs.mkdirSync(repo, { recursive: true });
  git(t.home, 'init', '-q', '--bare', '-b', 'main', remote);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'T'); git(repo, 'config', 'user.email', 't@example.com');
  commit(repo, 'a.txt', 'one\n', 'chore: first');
  git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(t.home, 'clone', '-q', remote, other); git(other, 'config', 'user.name', 'O'); git(other, 'config', 'user.email', 'o@example.com');
  board.addProject({ name: 'tienda', path: repo }, 'usuario', { fromUser: true });
  setGhForTests({ exe: () => 'gh-fake', run: async (cmd, args, opts) => { calls.push({ args, cwd: opts?.cwd }); return reply(args); } });
});
after(() => { clearInterval(keepAlive); setGhForTests(null); setCacheClock(null); forgetRepos(); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

// ---- the PR filter ---------------------------------------------------------------------------------------------------
test('checksSummary counts passed, failed and running checks of both kinds of rollup entry', () => {
  assert.deepEqual(checksSummary([
    { status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'COMPLETED', conclusion: 'SKIPPED' }, { status: 'COMPLETED', conclusion: 'FAILURE' },
    { status: 'IN_PROGRESS', conclusion: '' }, { state: 'SUCCESS' }, { state: 'PENDING' }, { state: 'ERROR' }
  ]), { total: 7, ok: 3, failed: 2, running: 2 });
  assert.deepEqual(checksSummary(null), { total: 0, ok: 0, failed: 0, running: 0 });
});

test('projects.prs without a state is the phone list as ever; with one it adds dates, base and the checks summary', async () => {
  calls.length = 0;
  const row = { number: 7, title: 'Cart', headRefName: 'orb/42', baseRefName: 'main', url: 'u', isDraft: false, author: { login: 'ana' }, createdAt: 'c', updatedAt: 'u', mergedAt: 'm', reviewDecision: '', mergeable: 'MERGEABLE', isCrossRepository: false, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] };
  reply = () => ({ ok: true, err: '', out: JSON.stringify([row]) });
  const old = await call('projects.prs', { name: 'tienda' });
  assert.equal(calls[0].args[4], '--limit'); assert.ok(!calls[0].args.join(' ').includes('statusCheckRollup'));
  assert.equal('checksSummary' in old[0], false);
  const merged = await call('projects.prs', { name: 'tienda', state: 'merged' });
  assert.deepEqual(calls[1].args.slice(0, 4), ['pr', 'list', '--state', 'merged']);
  assert.match(calls[1].args.at(-1), /statusCheckRollup/);
  assert.equal(merged[0].state, 'MERGED'); assert.equal(merged[0].baseRefName, 'main'); assert.equal(merged[0].mergedAt, 'm');
  assert.deepEqual(merged[0].checksSummary, { total: 1, ok: 0, failed: 1, running: 0 });
  assert.equal('statusCheckRollup' in merged[0], false);
  await assert.rejects(call('projects.prs', { name: 'tienda', state: 'all' }));
  await assert.rejects(call('projects.prs', { name: 'tienda', state: '--json' }));
});

test('projects.prCounts counts the three states from one read, remembers them two minutes and never throws', async () => {
  let now = 1_000_000; setCacheClock(() => now); forgetRepos();
  calls.length = 0;
  reply = () => ({ ok: true, err: '', out: JSON.stringify([{ state: 'OPEN' }, { state: 'MERGED' }, { state: 'MERGED' }, { state: 'CLOSED' }, { state: 'OPEN' }]) });
  assert.deepEqual(await call('projects.prCounts', { name: 'tienda' }), { open: 2, merged: 2, closed: 1, capped: false });
  assert.deepEqual(calls[0].args, ['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'state']);
  await call('projects.prCounts', { name: 'tienda' });
  assert.equal(calls.length, 1, 'the second answer comes from memory');
  now += 3 * 60_000;
  await call('projects.prCounts', { name: 'tienda' });
  assert.equal(calls.length, 2, 'two minutes later it asks again');
  await call('projects.prCounts', { name: 'tienda', force: true });
  assert.equal(calls.length, 3, 'force skips the memory');
  forgetRepos();
  reply = () => ({ ok: false, out: '', err: 'HTTP 401 gh auth login' });
  const bad = await call('projects.prCounts', { name: 'tienda' });
  assert.deepEqual([bad.open, bad.merged, bad.closed], [0, 0, 0]); assert.ok(bad.error);
  setGhForTests({ exe: () => null });
  const none = await call('projects.prCounts', { name: 'tienda' });
  assert.deepEqual([none.open, none.merged, none.closed], [0, 0, 0]); assert.ok(none.error);
  setGhForTests({ exe: () => 'gh-fake', run: async (cmd, args, opts) => { calls.push({ args, cwd: opts?.cwd }); return reply(args); } });
  setCacheClock(null);
});

test('the new read is open to the phone, the new actions are this PC only', () => {
  assert.equal(METHODS['projects.prCounts'], 'remote'); assert.ok(REMOTE_METHODS.has('projects.prCounts'));
  for (const m of ['projects.sync', 'projects.syncPlan', 'projects.prReview', 'logs.addEntry']) { assert.equal(METHODS[m], 'pc', m); assert.equal(REMOTE_METHODS.has(m), false, m); }
});

// ---- «Revisar tarea» -------------------------------------------------------------------------------------------------
test('projects.prReview creates the read-only review task of a PR once and then finds it again', async () => {
  const view = { number: 128, title: 'Pago en un paso', state: 'OPEN', headRefName: 'orb/42', headRefOid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', baseRefName: 'main', url: 'https://github.com/o/r/pull/128', files: [], commits: [], statusCheckRollup: [] };
  reply = () => ({ ok: true, err: '', out: JSON.stringify(view) });
  scheduler.reviewerFor = () => ({ project: board.project('tienda'), last: [], agent: 'claude' });
  const first = await call('projects.prReview', { name: 'tienda', number: 128 });
  assert.equal(first.created, true);
  const task = board.task(first.id);
  assert.equal(task.readonly, true); assert.match(task.description, /\[orb-pr-review:128\]/); assert.match(task.description, /Pago en un paso/);
  const again = await call('projects.prReview', { name: 'tienda', number: 128 });
  assert.deepEqual(again, { id: first.id, created: false });
  // without a known head commit nothing says the saved review is still of this PR's code: a new one is made
  const { headRefOid: _head, ...headless } = view;
  reply = () => ({ ok: true, err: '', out: JSON.stringify(headless) });
  assert.equal((await call('projects.prReview', { name: 'tienda', number: 128 })).created, true);
  reply = () => ({ ok: true, err: '', out: JSON.stringify(view) });
  const other128 = await call('projects.prReview', { name: 'tienda', number: 12 });
  assert.equal(other128.created, true); assert.notEqual(other128.id, first.id);
  await assert.rejects(call('projects.prReview', { name: 'tienda', number: '1e3' }));
  await assert.rejects(call('projects.prReview', { name: 'tienda', number: 5 }, REMOTE));
});

test('projects.prReview: the link is Orb\'s own setting; a mark written in a PR title steals nothing', async () => {
  const view = (number, title, oid = 'a'.repeat(40)) => ({ number, title, state: 'OPEN', headRefName: 'orb/x', baseRefName: 'main', headRefOid: oid, url: 'u', files: [], commits: [], statusCheckRollup: [] });
  const mine = await call('projects.prReview', { name: 'tienda', number: 128 });
  reply = () => ({ ok: true, err: '', out: JSON.stringify(view(200, 'Evil [orb-pr-review:128] title')) });
  const forged = await call('projects.prReview', { name: 'tienda', number: 200 });
  assert.equal(forged.created, true); assert.notEqual(forged.id, mine.id);
  assert.doesNotMatch(board.task(forged.id).description, /orb-pr-review:128/, 'the mark of a PR text never reaches the brief');
  // the text of the brief alone is not a link
  const lone = scheduler.reviewProject('tienda', { actor: 'usuario', focus: 'x [orb-pr-review:300]' });
  reply = () => ({ ok: true, err: '', out: JSON.stringify(view(300, 'Plain')) });
  const third = await call('projects.prReview', { name: 'tienda', number: 300 });
  assert.equal(third.created, true); assert.notEqual(third.id, lone.id);
  // a task of another project, or one an agent made, is never handed back
  assert.deepEqual(await call('projects.prReview', { name: 'tienda', number: 300 }), { id: third.id, created: false });
  board.run("UPDATE tasks SET created_by = 'claude' WHERE id = ?", third.id);
  const byAgent = await call('projects.prReview', { name: 'tienda', number: 300 });
  assert.equal(byAgent.created, true); assert.notEqual(byAgent.id, third.id);
  board.run("UPDATE tasks SET project = 'otro' WHERE id = ?", byAgent.id);
  const elsewhere = await call('projects.prReview', { name: 'tienda', number: 300 });
  assert.equal(elsewhere.created, true); assert.notEqual(elsewhere.id, byAgent.id);
  // new commits on the PR: a new review
  assert.deepEqual(await call('projects.prReview', { name: 'tienda', number: 300 }), { id: elsewhere.id, created: false });
  reply = () => ({ ok: true, err: '', out: JSON.stringify(view(300, 'Plain', 'b'.repeat(40))) });
  const moved = await call('projects.prReview', { name: 'tienda', number: 300 });
  assert.equal(moved.created, true); assert.notEqual(moved.id, elsewhere.id);
  // the branch names in the brief are bounded
  reply = () => ({ ok: true, err: '', out: JSON.stringify({ ...view(400, 'T'), headRefName: 'h'.repeat(500) }) });
  const long = await call('projects.prReview', { name: 'tienda', number: 400 });
  assert.ok(!board.task(long.id).description.includes('h'.repeat(121)));
  board.run("UPDATE tasks SET status = 'done' WHERE project = 'tienda'"); // «Sincronizar» refuses while anything works
});

test('projects.prCounts: force is honoured only from this PC\'s window', async () => {
  forgetRepos();
  reply = () => ({ ok: true, err: '', out: JSON.stringify([{ state: 'OPEN' }]) });
  calls.length = 0;
  await call('projects.prCounts', { name: 'tienda' }, REMOTE);
  await call('projects.prCounts', { name: 'tienda', force: true }, REMOTE);
  assert.equal(calls.length, 1, 'the phone cannot skip the memory');
  await call('projects.prCounts', { name: 'tienda', force: true });
  assert.equal(calls.length, 2, 'the window can');
});

test('sync: refused while anything works in the project, and the plan says so', async () => {
  const task = board.createTask({ project: 'tienda', title: 'Hola', description: 'x', agent: 'claude' }, 'usuario');
  const busy = await plan();
  assert.equal(busy.busy, true); assert.equal(busy.state, 'busy'); assert.match(busy.reason, /agentes trabajando/);
  await assert.rejects(call('projects.sync', { name: 'tienda', behind: 0, ahead: 0 }), /agentes trabajando/);
  board.run("UPDATE tasks SET status = 'done' WHERE id = ?", task.id);
  assert.equal((await plan()).busy, false);
});

// ---- «Sincronizar» ---------------------------------------------------------------------------------------------------
const plan = () => call('projects.syncPlan', { name: 'tienda' });
const sync = (p, extra = {}) => call('projects.sync', { name: 'tienda', behind: p.behind, ahead: p.ahead, ...extra });
const heads = () => ({ local: git(repo, 'rev-parse', 'HEAD'), remote: git(remote, 'rev-parse', 'main') });

test('sync: nothing to do', async () => {
  const p = await plan();
  assert.equal(p.state, 'upToDate'); assert.equal(p.branch, 'main'); assert.equal(p.upstream, 'origin/main');
  const before = heads();
  const r = await sync(p);
  assert.deepEqual([r.pulled, r.pushed], [0, 0]); assert.deepEqual(heads(), before);
});

test('sync: only bring in what the remote has (fast-forward, no merge commit)', async () => {
  commit(other, 'b.txt', 'b\n', 'feat: b'); theirs('c.txt', 'c\n', 'feat: c');
  const p = await plan();
  assert.deepEqual([p.state, p.behind, p.ahead], ['ready', 2, 0]);
  const r = await sync(p);
  assert.deepEqual([r.pulled, r.pushed], [2, 0]);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  assert.equal(git(repo, 'rev-list', '--merges', '--count', 'HEAD'), '0');
  assert.ok(fs.existsSync(path.join(repo, 'c.txt')));
});

test('sync: only send what the remote lacks', async () => {
  commit(repo, 'd.txt', 'd\n', 'feat: d');
  const p = await plan();
  assert.deepEqual([p.state, p.behind, p.ahead], ['ready', 0, 1]);
  const r = await sync(p);
  assert.deepEqual([r.pulled, r.pushed], [0, 1]);
  assert.equal(git(remote, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'));
});

test('sync: unsaved changes do not stop a push-only sync, and are kept', async () => {
  commit(repo, 'e.txt', 'e\n', 'feat: e');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
  const p = await plan();
  assert.deepEqual([p.state, p.ahead, p.changes], ['ready', 1, 1]);
  assert.deepEqual((({ pulled, pushed }) => [pulled, pushed])(await sync(p)), [0, 1]);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'edited\n');
  git(repo, 'checkout', '--', 'a.txt');
});

test('sync: a diverged branch is refused and nothing is touched', async () => {
  commit(repo, 'mine.txt', 'mine\n', 'feat: mine');
  theirs('theirs.txt', 'theirs\n', 'feat: theirs');
  const p = await plan();
  assert.equal(p.state, 'diverged');
  const before = { ...heads(), tree: git(repo, 'status', '--porcelain') };
  await assert.rejects(sync(p), /diverg/);
  assert.deepEqual({ ...heads(), tree: git(repo, 'status', '--porcelain') }, before);
  assert.equal(git(repo, 'rev-list', '--merges', '--count', 'HEAD'), '0');
  assert.equal(fs.existsSync(path.join(repo, 'theirs.txt')), false);
  git(repo, 'reset', '-q', '--hard', 'origin/main'); // leave the repository as the next test expects it
});

test('sync: pulling over unsaved changes is refused', async () => {
  theirs('z.txt', 'z\n', 'feat: z');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty\n');
  const p = await plan();
  assert.equal(p.state, 'unsaved'); assert.equal(p.behind, 1);
  const before = git(repo, 'rev-parse', 'HEAD');
  await assert.rejects(sync(p), /sin guardar/);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'dirty\n');
  git(repo, 'checkout', '--', 'a.txt');
  await sync(await plan()); // clean again: it comes in
  assert.ok(fs.existsSync(path.join(repo, 'z.txt')));
});

test('sync: the confirmed numbers must still be true, and the call needs them', async () => {
  commit(repo, 'x1.txt', '1\n', 'feat: x1');
  const p = await plan();
  commit(repo, 'x2.txt', '2\n', 'feat: x2'); // one more than the user confirmed
  const remoteBefore = git(remote, 'rev-parse', 'main');
  await assert.rejects(sync(p), /cambiado|changed/);
  assert.equal(git(remote, 'rev-parse', 'main'), remoteBefore, 'nothing was sent');
  await assert.rejects(call('projects.sync', { name: 'tienda' }));
  await assert.rejects(call('projects.sync', { name: 'tienda', behind: '0', ahead: 2 }));
  await assert.rejects(call('projects.sync', { name: 'tienda', behind: 0, ahead: 2 }, REMOTE));
  await sync(await plan());
});

test('sync: no remote branch and no remote do nothing and say so', async () => {
  git(repo, 'checkout', '-q', '-b', 'feature/new');
  const p = await plan();
  assert.equal(p.state, 'noRemoteBranch'); assert.equal(p.branch, 'feature/new');
  await assert.rejects(sync(p), /remot/);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/new'], { cwd: remote }).status !== 0, true, 'the branch was not pushed');
  git(repo, 'checkout', '-q', 'main');
  const lone = path.join(t.home, 'web', 'lone'); fs.mkdirSync(lone, { recursive: true });
  git(lone, 'init', '-q', '-b', 'main'); git(lone, 'config', 'user.name', 'T'); git(lone, 'config', 'user.email', 't@example.com'); commit(lone, 'a', 'a', 'first');
  board.addProject({ name: 'lone', path: lone }, 'usuario', { fromUser: true });
  assert.equal((await call('projects.syncPlan', { name: 'lone' })).state, 'noRemote');
});

test('sync: a secret in what would be sent stops the push', async () => {
  commit(repo, '.env', 'API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz0123456789\n', 'chore: env');
  const only = await plan();
  assert.deepEqual([only.state, only.behind, only.ahead], ['ready', 0, 1]);
  const r = await sync(only);
  assert.equal(r.pushed, 0); assert.ok(r.pushError, 'the push was refused by the secrets check');
  assert.notEqual(git(remote, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'));
  git(repo, 'reset', '-q', '--hard', 'origin/main');
});

// ---- «Escribir entrada» ----------------------------------------------------------------------------------------------
const logFile = () => board.projectLogFile('tienda');
test('logs.addEntry appends a signed entry in the same format and leaves everything before it byte for byte', async () => {
  const entry = async (title, body) => call('logs.addEntry', { project: 'tienda', title, body });
  await entry('Primera', 'texto');
  const before = fs.readFileSync(logFile());
  const n = countLogEntries(logFile());
  const r = await entry('Decidido: usar Stripe', 'Linea 1\nLinea 2');
  assert.equal(r.ok, true);
  const after = fs.readFileSync(logFile());
  assert.ok(after.subarray(0, before.length).equals(before), 'the old text is untouched');
  const added = after.subarray(before.length).toString('utf8');
  assert.match(added, /^\n### \d{4}-\d\d-\d\d \d\d:\d\d — .+ — Decidido: usar Stripe\n/);
  assert.match(added, /Linea 1\n {2}Linea 2\n/);
  assert.equal(countLogEntries(logFile()), n + 1);
});

test('logs.addEntry cannot forge an entry heading, and refuses bad titles, empty or huge texts and other logs', async () => {
  const n = countLogEntries(logFile()); const size = fs.statSync(logFile()).size;
  const r = await call('logs.addEntry', { project: 'tienda', title: 'Con trampa', body: 'ok\n### 2026-01-01 00:00 — Orbe — Falsa\n- Hecho: nada\n###### otra' });
  assert.equal(r.ok, true);
  assert.equal(countLogEntries(logFile()), n + 1, 'only the real heading counts');
  const text = fs.readFileSync(logFile(), 'utf8');
  assert.equal(/^### 2026-01-01/m.test(text), false);
  const size2 = fs.statSync(logFile()).size;
  const bad = [['', 'x'], ['a\nb', 'x'], ['# H', 'x'], ['x'.repeat(121), 'x'], ['t', ''], ['t', '   '], ['t', 'x'.repeat(5001)], [5, 'x'], ['t', null]];
  for (const [title, body] of bad) await assert.rejects(call('logs.addEntry', { project: 'tienda', title, body }), undefined, JSON.stringify([title, body]).slice(0, 40));
  await assert.rejects(call('logs.addEntry', { project: 'general', title: 't', body: 'b' }));
  await assert.rejects(call('logs.addEntry', { project: 'central', title: 't', body: 'b' }));
  await assert.rejects(call('logs.addEntry', { project: 'nope', title: 't', body: 'b' }));
  await assert.rejects(call('logs.addEntry', { project: 'tienda', title: 't', body: 'b' }, REMOTE));
  assert.equal(fs.statSync(logFile()).size, size2, 'a refusal writes nothing');
  assert.ok(size2 > size);
});

test('logs.addEntry redacts secrets in the title and the text and signs with the user name', async () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  await call('logs.addEntry', { project: 'tienda', title: `clave ${secret}`, body: `usa ${secret} aqui` });
  const text = fs.readFileSync(logFile(), 'utf8');
  assert.equal(text.includes(secret), false);
  const last = text.split('\n### ').pop();
  assert.match(last.split('\n')[0], /^\d{4}-\d\d-\d\d \d\d:\d\d — [^—]+ — /);
});

test('logs.addEntry: Unicode line separators cannot open a heading either', async () => {
  const n = countLogEntries(logFile());
  const seps = [String.fromCharCode(0x2028), String.fromCharCode(0x2029), String.fromCharCode(0x85), '\r', '\r\n'];
  for (const sep of seps) await call('logs.addEntry', { project: 'tienda', title: 'Separadores', body: `uno${sep}### 2026-01-01 00:00 — Claude — falsa${sep}fin` });
  assert.equal(countLogEntries(logFile()), n + seps.length, 'one entry per call, never an extra heading');
  assert.equal(/^### 2026-01-01/m.test(fs.readFileSync(logFile(), 'utf8')), false);
  await assert.rejects(call('logs.addEntry', { project: 'tienda', title: `a${String.fromCharCode(0x2028)}b`, body: 'x' }));
});

test('logs.addEntry: a text that does not fit once indented is refused, never cut', async () => {
  const size = fs.statSync(logFile()).size;
  // 2500 short lines: under the character limit as typed, over the entry's once every line is indented
  const body = Array.from({ length: 2400 }, () => 'a').join('\n');
  assert.ok(body.length < 5000);
  await assert.rejects(call('logs.addEntry', { project: 'tienda', title: 'Larga', body }), /demasiado larga/);
  assert.equal(fs.statSync(logFile()).size, size, 'nothing was written');
});
