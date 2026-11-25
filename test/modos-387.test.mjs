// 3.8.7: «/goal» (a cap of turns, «bloqueado» after three equal failures, the usage brakes), «/plan» (one turn in «Solo lectura»),
// «/review» (Task Review of the chat's changes) and «/debug» (instructions + badge). The engine runs in its own process with
// the fake agents (test/fixtures/fake-live.mjs); none of the commands may raise the chat's permission.
import { tempHome, until, startEngine, fakeLog } from './helpers.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { modeCommand, slashCommand } from '../src/shared/slash.mjs';

let t; let engine;
async function fresh(patch = {}) {
  t = tempHome(patch);
  engine = await startEngine(t.home);
  await engine.call('projects.create', { name: 'web' });
  await engine.call('projects.setActive', { name: 'web' });
  return engine;
}
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });
const chat = (call, permission = 'editar', agent = 'claude') => call('sessions.create', { agent, project: 'web', permission, title: 'Modos' });
const goalIn = (call, id, states) => until(async () => { const m = await call('sessions.modes', { id }); return states.includes(m.goal?.status) && m.goal; }, `objetivo en ${states}`, 45_000);
const agentTurns = (id) => fakeLog(t.home, `conversaciones/${id}`).filter((l) => l.turn);
const statusLines = async (call, id) => (await call('sessions.items', { id })).filter((i) => i.kind === 'status').map((i) => i.body);

test('the commands are recognised only where they are Orb\'s', () => {
  assert.deepEqual(modeCommand('/goal arregla los tests'), { name: 'goal', args: 'arregla los tests' });
  assert.deepEqual(modeCommand('  /Plan  '), { name: 'plan', args: '' });
  assert.deepEqual(modeCommand('/review foco en seguridad'), { name: 'review', args: 'foco en seguridad' });
  assert.deepEqual(modeCommand('/debug apagar'), { name: 'debug', args: 'apagar' });
  for (const text of ['/goals x', 'por favor /goal x', '/compact', '/status', '', null]) assert.equal(modeCommand(text), null, String(text));
  assert.equal(slashCommand('/goal'), null, 'the bare-command list does not take the new ones');
});

test('/goal goes on turn after turn until the agent says OBJETIVO CUMPLIDO, in the chat\'s own permission', async () => {
  const { call } = await fresh();
  const s = await chat(call, 'probar');
  await call('sessions.send', { id: s.id, text: '/goal OBJETIVO_AL_TURNO 3 AVANZA haz la portada' });
  const goal = await goalIn(call, s.id, ['done']);
  assert.equal(goal.turns, 3);
  const turns = agentTurns(s.id);
  assert.equal(turns.length, 3, 'one agent turn per goal turn');
  assert.match(turns[0].text, /Tu objetivo en esta conversación: .*haz la portada/);
  assert.match(turns[1].text, /Sigue con el objetivo: .*haz la portada/);
  assert.ok(turns.every((l) => l.permission === 'probar'), 'the goal never changes the permission the chat has');
  assert.equal((await call('sessions.items', { id: s.id })).filter((i) => i.role === 'user').length, 1, 'only the user\'s own words show as a user message');
  assert.ok((await statusLines(call, s.id)).some((l) => /Objetivo cumplido en 3 turnos/.test(l)));
  assert.equal((await call('sessions.list')).find((x) => x.id === s.id).permission, 'probar');
});

test('/goal stops at its cap of turns and «continuar» gives it another round', async () => {
  const { call } = await fresh();
  const s = await chat(call);
  await call('sessions.send', { id: s.id, text: '/goal 2 turnos: AVANZA sin fin' });
  const capped = await goalIn(call, s.id, ['limit']);
  assert.deepEqual([capped.turns, capped.max], [2, 2]);
  assert.equal(agentTurns(s.id).length, 2);
  await call('sessions.send', { id: s.id, text: '/goal continuar' });
  await until(async () => agentTurns(s.id).length === 4 && (await call('sessions.modes', { id: s.id })).goal?.status === 'limit', 'otra tanda de 2 turnos');
});

test('/goal: three turns blocked by the same thing end it as «bloqueado»', async () => {
  const { call } = await fresh();
  const s = await chat(call);
  await call('sessions.send', { id: s.id, text: '/goal BLOQUEADO_SIEMPRE abre la base de datos' });
  const goal = await goalIn(call, s.id, ['blocked']);
  assert.equal(goal.blockedCount, 3);
  assert.equal(agentTurns(s.id).length, 3, 'it does not try a fourth time');
  assert.ok((await statusLines(call, s.id)).some((l) => /Objetivo bloqueado: 3 turnos seguidos/.test(l)));
  // «continuar» starts counting again
  await call('sessions.send', { id: s.id, text: '/goal continuar' });
  await goalIn(call, s.id, ['blocked']);
  assert.equal(agentTurns(s.id).length, 6);
});

test('/goal: failures that are not the same do not block, and a failing agent is not retried for ever', async () => {
  const { call } = await fresh();
  const s = await chat(call);
  await call('sessions.send', { id: s.id, text: '/goal FALLA siempre' });
  const goal = await goalIn(call, s.id, ['blocked']);
  assert.equal(goal.turns, 3);
  assert.equal(agentTurns(s.id).length, 3);
});

test('/goal pauses when the account hits its usage limit, and refuses to start behind a usage brake', async () => {
  const { call } = await fresh();
  const s = await chat(call);
  await call('sessions.send', { id: s.id, text: '/goal LIMITE 60000 AVANZA' });
  const goal = await goalIn(call, s.id, ['paused']);
  assert.equal(goal.turns, 1);
  assert.match(goal.reason, /límite de uso/);
  assert.equal(agentTurns(s.id).length, 1);
  // the account is in its cooldown now: a new goal (or «continuar») is refused by the same brake that holds tasks back
  await assert.rejects(call('sessions.send', { id: s.id, text: '/goal continuar' }), /pausa por límite de uso/i);
  const other = await chat(call);
  await assert.rejects(call('sessions.send', { id: other.id, text: '/goal AVANZA otra vez' }), /pausa por límite de uso/i);
  assert.equal(agentTurns(other.id).length, 0);
});

test('/goal stops between turns when the real usage reaches the brake', async () => {
  const { call } = await fresh();
  const s = await chat(call);
  await call('sessions.send', { id: s.id, text: '/goal RATE 99 AVANZA' });
  const goal = await goalIn(call, s.id, ['paused']);
  assert.match(goal.reason, /pausa por límite de uso/i);
  assert.equal(agentTurns(s.id).length, 1, 'the second turn was not sent');
});

test('/goal parar ends it, also while a turn is working; a queued message pauses it', async () => {
  const { call } = await fresh();
  const s = await chat(call, 'editar', 'cursor'); // Cursor does not steer: a message while it works is queued
  await call('sessions.send', { id: s.id, text: '/goal 5 turnos: LENTO AVANZA' });
  const queued = await call('sessions.send', { id: s.id, text: 'una cosa más', mode: 'queue' });
  assert.deepEqual(queued, { queued: true });
  const paused = await goalIn(call, s.id, ['paused']);
  assert.match(paused.reason, /mensaje en cola/);
  await until(async () => agentTurns(s.id).some((l) => /una cosa más/.test(l.text)), 'the queued message went first');
  // stop
  await call('sessions.send', { id: s.id, text: '/goal continuar' });
  await call('sessions.send', { id: s.id, text: '/goal parar' }).catch(() => {});
  const stopped = await goalIn(call, s.id, ['stopped']);
  assert.equal(stopped.status, 'stopped');
});

test('/plan is one turn in «Solo lectura» and the chat\'s permission is the same before and after', async () => {
  const { call } = await fresh();
  const s = await chat(call, 'editar');
  await call('sessions.send', { id: s.id, text: '/plan añade una portada' });
  await until(async () => agentTurns(s.id).length === 1 && (await call('sessions.items', { id: s.id })).some((i) => i.role === 'assistant'), 'el turno del plan');
  const plan = agentTurns(s.id)[0];
  assert.equal(plan.permission, 'leer', 'the agent runs read-only');
  assert.match(plan.text, /MODO PLAN/); assert.match(plan.text, /añade una portada/);
  const list = await call('sessions.list');
  assert.equal(list.find((x) => x.id === s.id).permission, 'editar', 'the chat keeps its permission');
  // accepting the plan = the next message: back to the chat's permission (a new process, since «leer» is fixed at its start)
  await call('sessions.send', { id: s.id, text: 'adelante, aplícalo' });
  await until(async () => agentTurns(s.id).length === 2, 'el turno siguiente');
  assert.equal(agentTurns(s.id).at(-1).permission, 'editar');
  // a chat that is read-only already stays so; the command can never raise it
  const ro = await chat(call, 'leer');
  await call('sessions.send', { id: ro.id, text: '/plan' });
  await until(async () => agentTurns(ro.id).length === 1, 'plan sin texto');
  assert.equal(agentTurns(ro.id)[0].permission, 'leer');
  assert.match(agentTurns(ro.id)[0].text, /lo que estamos tratando/);
});

test('/plan: changing the permission during the plan turn does not lift its read-only state', async () => {
  const { call } = await fresh();
  const s = await chat(call, 'editar');
  await call('sessions.send', { id: s.id, text: '/plan LENTO algo largo' });
  await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'running', 'turno en marcha');
  await call('sessions.update', { id: s.id, permission: 'auto' });
  await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'idle', 'fin del turno', 30_000);
  const log = fakeLog(t.home, `conversaciones/${s.id}`);
  assert.ok(!log.some((l) => l.setPermission), 'the running read-only process never got the new permission');
  await call('sessions.send', { id: s.id, text: 'sigue' });
  await until(async () => agentTurns(s.id).length === 2, 'siguiente');
  assert.equal(agentTurns(s.id).at(-1).permission, 'auto');
});

test('/debug adds its instructions to every turn until «/debug apagar»', async () => {
  const { call } = await fresh();
  const s = await chat(call);
  await call('sessions.send', { id: s.id, text: '/debug la pantalla sale en blanco' });
  await until(async () => agentTurns(s.id).length === 1, 'primer turno');
  assert.equal((await call('sessions.modes', { id: s.id })).debug, true);
  assert.match(agentTurns(s.id)[0].text, /MODO DEPURACIÓN/);
  assert.match(agentTurns(s.id)[0].text, /la pantalla sale en blanco/);
  await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'idle', 'idle');
  await call('sessions.send', { id: s.id, text: 'otra cosa' });
  await until(async () => agentTurns(s.id).length === 2, 'segundo turno');
  assert.match(agentTurns(s.id)[1].text, /MODO DEPURACIÓN/);
  await call('sessions.send', { id: s.id, text: '/debug apagar' });
  assert.equal((await call('sessions.modes', { id: s.id })).debug, false);
  await call('sessions.send', { id: s.id, text: 'ya sin depurar' });
  await until(async () => agentTurns(s.id).length === 3, 'tercer turno');
  assert.doesNotMatch(agentTurns(s.id)[2].text, /MODO DEPURACIÓN/);
  assert.equal((await call('sessions.list')).find((x) => x.id === s.id).permission, 'editar');
});

test('/review launches a read-only Task Review of the chat\'s changes by another agent', async () => {
  const { call } = await fresh();
  const s = await chat(call, 'editar');
  execFileSync('git', ['init', '-q'], { cwd: s.cwd });
  await assert.rejects(call('sessions.send', { id: s.id, text: '/review' }), /no hay cambios/i);
  await call('sessions.send', { id: s.id, text: 'ESCRIBE un archivo' });
  await until(async () => (await call('sessions.items', { id: s.id })).some((i) => i.role === 'assistant'), 'el turno que escribe');
  await until(async () => (await call('sessions.list')).find((x) => x.id === s.id)?.status === 'idle', 'idle');
  const out = await call('sessions.send', { id: s.id, text: '/review fíjate en los nombres' });
  assert.ok(out.review);
  const task = await call('tasks.get', { id: out.review });
  assert.equal(task.readonly, true);
  assert.equal(task.agent, 'codex', 'another provider than the chat\'s agent');
  assert.match(task.description, /hecho-por-claude\.txt/);
  assert.match(task.description, /Fíjate sobre todo en: fíjate en los nombres/);
  await until(async () => (await call('tasks.get', { id: out.review })).status === 'done', 'la revisión', 45_000);
  assert.ok((await statusLines(call, s.id)).some((l) => /Revisión lanzada/.test(l)));
  assert.equal((await call('sessions.list')).find((x) => x.id === s.id).permission, 'editar');
});
