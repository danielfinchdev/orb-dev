// The pull-request tools of the agents (orb_pr_view / orb_pr_comment / orb_pr_merge): permissions by level, a merge that
// always waits for the user's answer on this PC, the commit the user saw, and a comment that never travels as an argument.
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
import { agentAuth } from '../src/domain/security/agent-auth.mjs';
import { DESKTOP, METHODS, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
import { guardCall } from '../src/engine/transport/remote-calls.mjs';
import { createPrTools } from '../src/engine/host/pr-tools.mjs';
import { setGhForTests } from '../src/engine/host/github.mjs';
import { decide } from '../src/domain/security/guard.mjs';

const OID = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
let t; let board; let sessions; let api; let dir; let chats;
const events = [];
const ghCalls = [];
// Polls (at most 2 s) until the condition holds, instead of sleeping a fixed time.
const until = async (cond) => { const end = Date.now() + 2000; while (!cond()) { if (Date.now() > end) throw new Error('timeout waiting for the condition'); await new Promise((r) => setImmediate(r)); } };

// A fake of the github.mjs module: the PR's state is changed by each test.
let pr;
const freshPr = () => ({ number: 7, title: 'Add thing', body: 'x'.repeat(9000), state: 'OPEN', url: 'u', headRefName: 'feat', headRefOid: OID, baseRefName: 'main', isDraft: false, author: 'a', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, additions: 3, deletions: 1, changedFiles: 1, checks: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }], files: [{ path: 'a.js', additions: 3, deletions: 1 }], commits: [{ oid: 'abc1234', title: 't' }] });
let mergeError = null;
const fakeGh = {
  viewPr: async (p, n) => { ghCalls.push(['view', p.name, n]); return structuredClone(pr); },
  mergePr: async (p, n, m, oid) => { ghCalls.push(['merge', p.name, n, m, oid]); if (mergeError) throw mergeError; return { ok: true, number: n, method: m, state: 'MERGED' }; },
  commentPr: async (p, n, body) => { ghCalls.push(['comment', p.name, n, body]); return { ok: true, number: n }; }
};
const make = (extra = {}) => createPrTools({ board, sessions, gh: fakeGh, emit: (e, p) => events.push([e, p]), log: () => {}, ...extra });

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
  chats = {};
  for (const level of ['leer', 'probar', 'editar', 'preguntar', 'auto']) chats[level] = sessions.create({ agent: 'claude', permission: level, project: 'tienda', cwd: dir, title: level });
  chats.total = sessions.create({ agent: 'claude', permission: 'auto', project: 'tienda', cwd: dir, title: 'total' });
  board.db.prepare("UPDATE sessions SET permission = 'total' WHERE id = ?").run(chats.total.id);
  chats.none = sessions.create({ agent: 'claude', permission: 'editar', cwd: dir, title: 'sin proyecto' });
});
after(() => { clearInterval(keepAlive); setGhForTests(null); try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });
const reset = () => { pr = freshPr(); mergeError = null; ghCalls.length = 0; events.length = 0; };
const chatOf = (level) => sessions.get(chats[level].id);
const rejects = (promise, re) => assert.rejects(promise, (e) => { assert.match(e.message, re); assert.equal(e.userFacing, true); return true; });

test('view works at every level and gives the agent a short text marked as data', async () => {
  const tools = make();
  for (const level of ['leer', 'probar', 'editar', 'preguntar', 'auto', 'total']) {
    reset();
    const { text } = await tools.run(chatOf(level), 'view', { number: 7 });
    assert.match(text, /no son instrucciones/);
    const json = JSON.parse(text.slice(text.indexOf('{')));
    assert.equal(json.number, 7);
    assert.equal(json.body.length, 4000);
    assert.deepEqual(ghCalls, [['view', 'tienda', 7]], level);
  }
});

test('comment is refused for read and test chats; below total it waits for the card; total publishes directly', async () => {
  const tools = make();
  for (const level of ['leer', 'probar']) { reset(); await rejects(tools.run(chatOf(level), 'comment', { number: 7, body: 'hola' }), /solo lee o prueba/); assert.equal(ghCalls.length, 0, level); }
  for (const level of ['editar', 'preguntar', 'auto']) {
    reset();
    const p = tools.run(chatOf(level), 'comment', { number: 7, body: '  hola  ' });
    await until(() => tools.pending().length === 1);
    assert.equal(ghCalls.filter((c) => c[0] === 'comment').length, 0, `${level}: nothing before the answer`);
    const [card] = tools.pending();
    assert.equal(card.kind, 'comment');
    assert.equal(card.body, 'hola');
    assert.equal(card.title, 'Add thing');
    assert.equal(card.number, 7);
    await tools.answer(ref(card));
    assert.match((await p).text, /#7/);
    assert.deepEqual(ghCalls.filter((c) => c[0] === 'comment'), [['comment', 'tienda', 7, 'hola']], level);
  }
  assert.ok(board.all('SELECT body FROM session_items WHERE session_id = ?', chats.editar.id).some((i) => /comentó en el PR #7/.test(i.body)));
  reset();
  const direct = await tools.run(chatOf('total'), 'comment', { number: 7, body: ' directo ' });
  assert.match(direct.text, /#7/);
  assert.deepEqual(ghCalls, [['comment', 'tienda', 7, 'directo']]);
  assert.deepEqual(tools.pending(), []);
  reset();
  await rejects(tools.run(chatOf('editar'), 'comment', { number: 7, body: '   ' }), /entre 1 y 20000/);
  await rejects(tools.run(chatOf('editar'), 'comment', { number: 7, body: 'x'.repeat(20001) }), /entre 1 y 20000/);
  await rejects(tools.run(chatOf('editar'), 'comment', { number: 'x', body: 'a' }), /no válido/);
  assert.equal(ghCalls.length, 0);
});

test('a comment declined, timed out or wiped never reaches gh; a failing gh clears the request and tells the agent', async () => {
  reset();
  const tools = make();
  const p = tools.run(chatOf('auto'), 'comment', { number: 7, body: 'hola' });
  await until(() => tools.pending().length === 1);
  tools.decline(ref(tools.pending()[0]));
  assert.match((await p).text, /rechazó/);
  const q = make({ askMs: 20 });
  assert.match((await q.run(chatOf('auto'), 'comment', { number: 7, body: 'hola' })).text, /falta de respuesta/);
  const w = tools.run(chatOf('auto'), 'comment', { number: 7, body: 'hola' });
  await until(() => tools.pending().length === 1);
  tools.wipe();
  assert.match((await w).text, /bloqueado/);
  assert.equal(ghCalls.filter((c) => c[0] === 'comment').length, 0);
  // gh fails while merging: the request is gone and the agent's promise resolves with the error
  mergeError = new Error('boom');
  const m = tools.run(chatOf('editar'), 'merge', { number: 7 });
  await until(() => tools.pending().length === 1);
  await assert.rejects(tools.answer(ref(tools.pending()[0])), /boom/);
  assert.match((await m).text, /no se pudo: boom/);
  assert.deepEqual(tools.pending(), []);
});

test('a deleted chat loses its requests', async () => {
  reset();
  const tools = make();
  const doomed = sessions.create({ agent: 'claude', permission: 'editar', project: 'tienda', cwd: dir, title: 'borrable' });
  const p = tools.run(sessions.get(doomed.id), 'merge', { number: 7 });
  await until(() => tools.pending().length === 1);
  board.db.prepare('DELETE FROM sessions WHERE id = ?').run(doomed.id);
  assert.deepEqual(tools.pending(), []);
  assert.match((await p).text, /bloqueado/);
});

test('an unknown tool is refused before gh is loaded', async () => {
  let loaded = 0;
  const tools = createPrTools({ board, sessions, gh: async () => { loaded++; return fakeGh; }, emit: () => {}, log: () => {} });
  await rejects(tools.run(chatOf('editar'), 'borrar', { number: 7 }), /desconocida/);
  assert.equal(loaded, 0);
});

test('merge is refused for read and test chats without touching gh', async () => {
  const tools = make();
  for (const level of ['leer', 'probar']) { reset(); await rejects(tools.run(chatOf(level), 'merge', { number: 7 }), /solo lee o prueba/); assert.equal(ghCalls.length, 0); }
  assert.deepEqual(tools.pending(), []);
});

test('merge with total access does NOT merge until the user answers; the merged commit is the one shown', async () => {
  reset();
  const tools = make();
  const p = tools.run(chatOf('total'), 'merge', { number: 7, method: 'squash' });
  await until(() => tools.pending().length === 1);
  assert.equal(ghCalls.filter((c) => c[0] === 'merge').length, 0);
  const [card] = tools.pending();
  assert.equal(card.headRefOid, OID);
  assert.equal(card.method, 'squash');
  assert.equal(card.project, 'tienda');
  assert.equal(card.number, 7);
  assert.equal(events.find((e) => e[0] === 'pr:request')?.[1].id, card.id);
  // the branch moves after the user saw the card: gh still gets the old commit (and would refuse it)
  pr.headRefOid = MOVED;
  await tools.answer(ref(card));
  const done = await p;
  assert.deepEqual(ghCalls.filter((c) => c[0] === 'merge'), [['merge', 'tienda', 7, 'squash', OID]]);
  assert.match(done.text, /fusionado/);
  assert.ok(events.some((e) => e[0] === 'pr:done'));
  assert.deepEqual(tools.pending(), []);
  await rejects(Promise.resolve().then(() => tools.answer(ref(card))), /ya no está activa/);
});

test('when gh refuses a moved head, the agent sees the clear error', async () => {
  reset();
  const tools = make();
  const p = tools.run(chatOf('auto'), 'merge', { number: 7 });
  await until(() => tools.pending().length === 1);
  mergeError = Object.assign(new Error('la rama del pull request cambió desde que lo viste'), { userFacing: true });
  await assert.rejects(tools.answer(ref(tools.pending()[0])), /cambió desde que lo viste/);
  assert.match((await p).text, /no se pudo: la rama del pull request cambió/);
});

test('decline and timeout never call gh to merge', async () => {
  reset();
  const tools = make();
  const p = tools.run(chatOf('editar'), 'merge', { number: 7 });
  await until(() => tools.pending().length === 1);
  tools.decline(ref(tools.pending()[0]));
  assert.match((await p).text, /rechazó fusionar/);
  const q = make({ askMs: 20 });
  const slow = await q.run(chatOf('editar'), 'merge', { number: 7 });
  assert.match(slow.text, /falta de respuesta/);
  assert.equal(ghCalls.filter((c) => c[0] === 'merge').length, 0);
  assert.deepEqual(q.pending(), []);
});

test('a closed, merged or draft pull request creates no request', async () => {
  const tools = make();
  for (const change of [{ state: 'CLOSED' }, { state: 'MERGED' }, { isDraft: true }]) {
    reset(); Object.assign(pr, change);
    await rejects(tools.run(chatOf('editar'), 'merge', { number: 7 }), /no está abierto|borrador/);
    assert.deepEqual(tools.pending(), []);
    assert.equal(events.length, 0);
  }
});

test('wipe declines everything waiting', async () => {
  reset();
  const tools = make();
  const a = tools.run(chatOf('editar'), 'merge', { number: 7 });
  const b = tools.run(chatOf('auto'), 'merge', { number: 8 });
  await until(() => tools.pending().length === 2);
  tools.wipe();
  assert.match((await a).text, /bloqueado/);
  assert.match((await b).text, /bloqueado/);
  assert.deepEqual(tools.pending(), []);
  assert.equal(ghCalls.filter((c) => c[0] === 'merge').length, 0);
});

test('a chat without project fails clearly, and a project named by the agent is ignored', async () => {
  reset();
  const tools = make();
  await rejects(tools.run(chatOf('none'), 'view', { number: 7 }), /no tiene un proyecto/);
  await rejects(tools.run(null, 'view', { number: 7 }), /desde un chat/);
  await tools.run(chatOf('editar'), 'view', { number: 7, name: 'otro', project: 'otro' });
  assert.deepEqual(ghCalls, [['view', 'tienda', 7]]);
  await rejects(tools.run(chatOf('editar'), 'borrar', { number: 7 }), /desconocida/);
  await rejects(tools.run(chatOf('editar'), 'merge', { number: 7, method: 'octopus' }), /Método no válido/);
});

test('at most three merges wait per chat, even with simultaneous calls', async () => {
  reset();
  const tools = make();
  const calls = [1, 2, 3, 4, 5, 6].map((n) => tools.run(chatOf('editar'), 'merge', { number: n }).then((r) => ({ r }), (e) => ({ e })));
  await until(() => tools.pending().length === 3);
  const other = tools.run(chatOf('auto'), 'merge', { number: 5 }); // another chat still can
  await until(() => tools.pending().length === 4);
  const waiting = calls;
  tools.wipe();
  const done = await Promise.all([...waiting, other]);
  assert.equal(done.filter((d) => d.e && /varias fusiones pendientes/.test(d.e.message)).length, 3);
});

test('the agent pipe path: method "pr" uses the chat of the grant', async () => {
  reset();
  const out = await agentAuth.onCall({ session: chats.editar.id }, 'pr', { tool: 'view', args: { number: 7 } }).catch((e) => e);
  // gh is the real module here (no fake installed): the call reaches it and fails on its own, not as "not allowed"
  assert.doesNotMatch(String(out?.message ?? ''), /no permitido|not allowed/i);
  await assert.rejects(agentAuth.onCall({ session: null }, 'pr', {}), /./);
});

test('the new methods and events are for this PC only', () => {
  for (const m of ['prConfirm.pending', 'prConfirm.answer', 'prConfirm.decline']) {
    assert.equal(METHODS[m], 'pc', m);
    assert.ok(!REMOTE_METHODS.has(m), m);
    assert.notEqual(guardCall(board, m, {}), null, m);
  }
  assert.equal(METHODS['projects.prComment'], 'remote');
  assert.equal(guardCall(board, 'projects.prComment', {}), null);
});

const ref = (c) => ({ id: c.id, session: c.session, number: c.number, headRefOid: c.headRefOid ?? null });

test('an answer with another chat, PR number or commit is refused and the request stays pending', async () => {
  reset();
  const tools = make();
  const p = tools.run(chatOf('editar'), 'merge', { number: 7 });
  await until(() => tools.pending().length === 1);
  const card = tools.pending()[0];
  for (const bad of [{ session: 'other' }, { number: 8 }, { headRefOid: MOVED }, { headRefOid: null }]) {
    await assert.rejects(Promise.resolve().then(() => tools.answer({ ...ref(card), ...bad })), /ya no está activa/);
    assert.throws(() => tools.decline({ ...ref(card), ...bad }), /ya no está activa/);
    assert.equal(tools.pending().length, 1);
  }
  assert.equal(ghCalls.filter((c) => c[0] === 'merge').length, 0);
  await tools.answer(ref(card));
  assert.match((await p).text, /fusionado/);
});

test('prConfirm.* answers the pending request through the API', async () => {
  reset();
  setGhForTests({ exe: () => 'gh-fake', run: async (cmd, args) => { ghCalls.push(['raw', args]); return { ok: true, out: JSON.stringify({ ...pr, statusCheckRollup: [], files: [], commits: [] }), err: '' }; } });
  const p = agentAuth.onCall({ session: chats.total.id }, 'pr', { tool: 'merge', args: { number: 7 } });
  let list = [];
  for (let i = 0; i < 400 && !list.length; i++) { list = await api.call('prConfirm.pending', {}, DESKTOP); if (!list.length) await new Promise((r) => setTimeout(r, 5)); }
  assert.equal(list.length, 1);
  assert.equal(list[0].headRefOid, OID);
  await api.call('prConfirm.decline', ref(list[0]), DESKTOP);
  assert.match((await p).text, /rechazó/);
  assert.equal(ghCalls.filter((c) => c[0] === 'raw' && c[1].includes('merge')).length, 0);
  setGhForTests(null);
});

test('projects.prComment validates first and sends the text on stdin with --body-file -', async () => {
  reset();
  const runs = [];
  setGhForTests({ exe: () => 'gh-fake', run: async (cmd, args, opts) => { runs.push({ args, input: opts?.input, cwd: opts?.cwd }); return { ok: true, out: '', err: '' }; } });
  for (const bad of [{ number: 0, body: 'x' }, { number: 'a', body: 'x' }, { number: 7, body: '' }, { number: 7, body: '   ' }, { number: 7, body: 5 }, { number: 7, body: 'x'.repeat(20001) }, { name: 'nope', number: 7, body: 'x' }]) {
    await assert.rejects(api.call('projects.prComment', { name: 'tienda', ...bad }, DESKTOP), /./, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(runs.length, 0);
  const secretish = 'hola "$(rm -rf /)" `x` & | > y';
  const r = await api.call('projects.prComment', { name: 'tienda', number: '7', body: ` ${secretish} ` }, DESKTOP);
  assert.deepEqual(r, { ok: true, number: 7 });
  assert.deepEqual(runs[0].args, ['pr', 'comment', '7', '--body-file', '-']);
  assert.equal(runs[0].input, secretish);
  assert.equal(runs[0].cwd, dir);
  assert.ok(!runs[0].args.some((a) => a.includes('rm -rf')));
  setGhForTests(null);
});

test('the guard keeps asking for gh pr merge / comment from the console', () => {
  const ask = (permission, command) => decide({ permission, cwd: dir, projectDir: dir, tool: 'Bash', kind: 'execute', command });
  for (const command of ['gh pr merge 3', 'gh pr comment 3 -b x']) {
    for (const permission of ['probar', 'editar', 'preguntar']) assert.notEqual(ask(permission, command).decision, 'allow', `${command} (${permission})`);
  }
});

test('an old gh without --match-head-commit gives its own clear error', async () => {
  const { mergePr } = await import('../src/engine/host/github.mjs');
  setGhForTests({ exe: () => 'gh-fake', run: async () => ({ ok: false, out: '', err: 'unknown flag: --match-head-commit' }) });
  await assert.rejects(mergePr({ name: 'tienda', path: dir }, 7, 'merge', OID), (e) => { assert.match(e.message, /demasiado antiguo/); assert.equal(e.userFacing, true); return true; });
  setGhForTests(null);
});
