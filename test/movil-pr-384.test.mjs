// Pull requests and the bell from the mobile app: projects.prs / projects.pr / projects.mergePr and notes.markRead,
// with a fake gh (nothing reaches GitHub).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, METHODS, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
import { guardCall } from '../src/engine/transport/remote-calls.mjs';
import { setGhForTests } from '../src/engine/host/github.mjs';

let t; let board; let api; let sessions; let dir;
const events = [];
const calls = [];
const OID = 'a'.repeat(40);
let reply = () => ({ ok: true, out: '[]', err: '' });
const fakeRun = async (cmd, args, opts) => { calls.push({ cmd, args, cwd: opts?.cwd }); return reply(args); };
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);

before(() => {
  t = tempHome();
  board = new Board();
  const emit = (e, p) => events.push([e, p]);
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  dir = path.join(t.home, 'web', 'tienda');
  fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'tienda', path: dir }, 'usuario', { fromUser: true });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  setGhForTests({ exe: () => 'gh-fake', run: fakeRun });
});
after(() => { setGhForTests(null); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('policy: the four new methods are remote, merge/push/createPr stay on the PC', () => {
  for (const m of ['projects.prs', 'projects.pr', 'projects.mergePr', 'notes.markRead']) { assert.equal(METHODS[m], 'remote', m); assert.ok(REMOTE_METHODS.has(m), m); }
  for (const m of ['projects.prs', 'projects.pr', 'projects.mergePr', 'notes.markRead']) assert.equal(guardCall(board, m, {}), null, m);
  for (const m of ['projects.merge', 'projects.push', 'projects.createPr']) {
    assert.equal(METHODS[m], 'pc', m);
    assert.notEqual(guardCall(board, m, {}), null, m);
  }
});

test('projects.prs lists open pull requests with a fixed gh command in the project folder', async () => {
  calls.length = 0;
  reply = () => ({ ok: true, err: '', out: JSON.stringify([{ number: 7, title: 'Fix\nthing', headRefName: 'f', baseRefName: 'main', url: 'u', isDraft: false, author: { login: 'ana' }, updatedAt: 'x', reviewDecision: '', mergeable: 'MERGEABLE', extra: 1 }]) });
  const r = await call('projects.prs', { name: 'tienda' });
  assert.deepEqual(calls[0].args, ['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,headRefName,headRefOid,baseRefName,url,isDraft,author,updatedAt,reviewDecision,mergeable']);
  assert.equal(calls[0].cwd, dir);
  assert.equal(r[0].author, 'ana'); assert.equal(r[0].title, 'Fix thing'); assert.equal('extra' in r[0], false);
});

test('projects.pr trims the detail', async () => {
  calls.length = 0;
  reply = () => ({ ok: true, err: '', out: JSON.stringify({
    number: 5, headRefOid: OID.toUpperCase(), title: 'T', body: 'x'.repeat(30_000), state: 'OPEN', url: 'u', author: { login: 'bo' }, additions: 3, deletions: 1, changedFiles: 400,
    statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'zzz' }],
    files: Array.from({ length: 400 }, (_, i) => ({ path: `f${i}`, additions: 1, deletions: 0, changeType: 'x' })),
    commits: Array.from({ length: 150 }, (_, i) => ({ oid: `abcdef${i}0123`, messageHeadline: `c${i}`, authors: [] }))
  }) });
  const r = await call('projects.pr', { name: 'tienda', number: 5 });
  assert.deepEqual(calls[0].args.slice(0, 3), ['pr', 'view', '5']);
  assert.equal(r.headRefOid, OID); assert.equal(r.body.length, 20_000); assert.equal(r.files.length, 300); assert.equal(r.commits.length, 100);
  assert.equal(r.commits[0].oid.length, 7); assert.deepEqual(r.checks, [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
  assert.deepEqual(Object.keys(r.files[0]), ['path', 'additions', 'deletions']);
});

test('projects.mergePr runs the exact merge and reports the state', async () => {
  calls.length = 0;
  reply = (args) => (args[1] === 'merge' ? { ok: true, out: '', err: '' } : { ok: true, err: '', out: '{"state":"MERGED","mergedAt":"2026-01-01"}' });
  const r = await call('projects.mergePr', { name: 'tienda', number: '12', method: 'squash', headRefOid: OID });
  assert.deepEqual(calls[0].args, ['pr', 'merge', '12', '--squash', '--match-head-commit', OID]);
  assert.equal(calls[0].cwd, dir);
  assert.ok(!calls[0].args.some((a) => /delete-branch|admin|auto/.test(a)));
  assert.deepEqual(r, { ok: true, number: 12, method: 'squash', state: 'MERGED', mergedAt: '2026-01-01' });
  calls.length = 0;
  await call('projects.mergePr', { name: 'tienda', number: 3, headRefOid: OID });
  assert.deepEqual(calls[0].args, ['pr', 'merge', '3', '--merge', '--match-head-commit', OID]);
});

test('invalid number, method or project are refused without running gh', async () => {
  calls.length = 0;
  for (const number of ['12; rm', '1e3', -1, 0, '1 2', 1.5, 10_000_001, null, {}, '']) {
    await assert.rejects(call('projects.mergePr', { name: 'tienda', number, headRefOid: OID }), /./);
    await assert.rejects(call('projects.pr', { name: 'tienda', number }), /./);
  }
  await assert.rejects(call('projects.mergePr', { name: 'tienda', number: 4, method: 'admin', headRefOid: OID }), /./);
  await assert.rejects(call('projects.mergePr', { name: 'tienda', number: 4, method: '--admin', headRefOid: OID }), /./);
  await assert.rejects(call('projects.prs', { name: '..\\x' }), /./);
  assert.equal(calls.length, 0);
});

test('errors are clear: no gh, no session, no pull request, not mergeable', async () => {
  setGhForTests({ exe: () => null });
  await assert.rejects(call('projects.prs', { name: 'tienda' }), /GitHub CLI/);
  setGhForTests({ exe: () => 'gh-fake', run: fakeRun });
  reply = () => ({ ok: false, out: '', err: 'To get started with GitHub CLI, please run:  gh auth login' });
  await assert.rejects(call('projects.prs', { name: 'tienda' }), /No hay sesión de GitHub/);
  reply = () => ({ ok: false, out: '', err: 'GraphQL: Could not resolve to a PullRequest with the number of 99. (repository.pullRequest)' });
  await assert.rejects(call('projects.pr', { name: 'tienda', number: 99 }), /no existe/);
  reply = () => ({ ok: false, out: '', err: 'no git remotes found' });
  await assert.rejects(call('projects.prs', { name: 'tienda' }), /remoto de GitHub/);
  reply = () => ({ ok: false, out: '', err: 'X Pull request #5 is not mergeable: the merge commit cannot be cleanly created.' });
  await assert.rejects(call('projects.mergePr', { name: 'tienda', number: 5, headRefOid: OID }), /no se puede fusionar.*not mergeable/);
});

test('notes.markRead tells the window and validates ids', async () => {
  events.length = 0;
  assert.deepEqual(await call('notes.markRead', {}), { ok: true });
  assert.equal(events.at(-1)[0], 'notes:read');
  await call('notes.markRead', { ids: ['a', 'b'] });
  assert.deepEqual(events.at(-1)[1].ids, ['a', 'b']);
  const n = events.length;
  await assert.rejects(call('notes.markRead', { ids: 'a' }), /./);
  await assert.rejects(call('notes.markRead', { ids: [1] }), /./);
  await assert.rejects(call('notes.markRead', { ids: Array(201).fill('x') }), /./);
  assert.equal(events.length, n);
});

test('projects.mergePr needs the exact head commit and refuses a bad one without running gh', async () => {
  calls.length = 0;
  for (const headRefOid of [undefined, null, '', 'abc1234', 'a'.repeat(39), 'a'.repeat(41), `${'a'.repeat(39)};`, `${'a'.repeat(20)} ${'a'.repeat(19)}`, '--admin', 'g'.repeat(40), 123, {}]) {
    await assert.rejects(call('projects.mergePr', { name: 'tienda', number: 4, headRefOid }), /headRefOid/);
  }
  assert.equal(calls.length, 0);
});

test('projects.mergePr passes the oid literally (lowercased) after --match-head-commit', async () => {
  calls.length = 0;
  reply = (args) => (args[1] === 'merge' ? { ok: true, out: '', err: '' } : { ok: true, err: '', out: '{"state":"MERGED"}' });
  const oid = '0123456789ABCDEFabcdef0123456789abcdef01';
  await call('projects.mergePr', { name: 'tienda', number: 8, headRefOid: oid });
  const a = calls[0].args;
  assert.equal(a[a.indexOf('--match-head-commit') + 1], oid.toLowerCase());
  assert.equal(a.length, 6);
});

test('a moved branch gives its own clear error, not "cannot be merged"', async () => {
  for (const err of ['X Pull request #5 head branch was modified', 'GraphQL: Head branch was modified. Review and try the merge again.', 'head ref sha does not match the expected one', 'expected head sha does not match']) {
    reply = () => ({ ok: false, out: '', err });
    await assert.rejects(call('projects.mergePr', { name: 'tienda', number: 5, headRefOid: OID }), (e) => /cambió desde que lo viste/.test(e.message) && !/no se puede fusionar/.test(e.message) && e.userFacing === true);
  }
});
