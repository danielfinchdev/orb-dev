// Usage audit: the weekly window brakes earlier than the session one, the assistant's own turns respect the brake, a request
// has at most two correction rounds, and the separate verification task is only planned from spend level 2.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Orchestrator, persona } from '../src/engine/orchestrator.mjs';
import { recordRate, canLaunch, budgetConfig } from '../src/domain/usage/budget.mjs';
import { fixRoundCheck, maxFixRounds } from '../src/domain/tasks/rounds.mjs';
import { ctx } from '../src/platform/context.mjs';

const t = tempHome();
after(() => t.cleanup());
const hour = 3_600_000;
const tick = () => new Promise((r) => setImmediate(r));
// The temp database is shared by the tests, so every case starts from a clean account.
const clean = (board) => { board.settingJson('rate:claude', null); board.settingJson('rates:claude', null); return board; };
const rate = (board, window, utilization, id = 'claude') => recordRate(board, id, { utilization, resetAt: Date.now() + 40 * hour, window, status: 'allowed' });

test('weekly window: 86% blocks by default, 84% does not, a single-model week never blocks', () => {
  const board = clean(new Board());
  rate(board, 'five_hour', 0.1); rate(board, 'seven_day', 0.86);
  const c = canLaunch(board, 'claude', null);
  assert.equal(c.ok, false); assert.match(c.reason, /86/);
  const b2 = clean(new Board()); rate(b2, 'seven_day', 0.84);
  assert.equal(canLaunch(b2, 'claude', null).ok, true);
  const b3 = clean(new Board()); rate(b3, 'five_hour', 0.1); rate(b3, 'seven_day_opus', 0.97);
  assert.equal(canLaunch(b3, 'claude', null).ok, true, 'one model only does not stop the account');
});
test('session window keeps its 92% and weeklyStopAt is configurable', () => {
  assert.equal(budgetConfig().stopAt, 0.92); assert.equal(budgetConfig().weeklyStopAt, 0.85);
  const b = clean(new Board()); rate(b, 'five_hour', 0.9);
  assert.equal(canLaunch(b, 'claude', null).ok, true);
  const b2 = clean(new Board()); rate(b2, 'five_hour', 0.93);
  assert.equal(canLaunch(b2, 'claude', null).ok, false);
  const b3 = clean(new Board()); rate(b3, 'seven_day', 0.9);
  ctx.config.budget.weeklyStopAt = 0.95;
  try { assert.equal(canLaunch(b3, 'claude', null).ok, true); } finally { delete ctx.config.budget.weeklyStopAt; }
  assert.equal(canLaunch(b3, 'claude', null).ok, false);
});

function assistant(board) {
  const o = new Orchestrator(board); o.turns = [];
  const make = o.lane.bind(o);
  o.lane = (id) => {
    const l = make(id);
    if (!l.held) { l.held = true; l.run = (text) => new Promise((resolve) => o.turns.push({ text, resolve: () => { l.busy = false; resolve(); } })); }
    return l;
  };
  return o;
}
test('braked: an automatic notice gets no turn but its report is shown, a typed message runs with one warning', async () => {
  const board = clean(new Board()); rate(board, 'seven_day', 0.9);
  const c = board.createConversation({ title: 'Web' });
  const o = assistant(board);
  process.env.ORB_NOTICE_RETRY_MS = '60000';
  try {
    o.internal('AVISO DEL SISTEMA: tareas terminadas\n- #7 Portada: hecha', null, null, { conversation: c.id });
    await tick();
    assert.equal(o.turns.length, 0, 'the notice does not run');
    assert.ok(board.chat(c.id).some((m) => m.role === 'orb' && m.body.includes('#7 Portada')), 'its report reaches the user');
    assert.equal((board.settingJson('orchestrator_pending') ?? []).length, 0, 'and is not left pending');
    o.ask('hola', '', { conversation: c.id }); await tick();
    assert.equal(o.turns.length, 1, 'the user message runs');
    o.turns[0].resolve(); await tick();
    o.ask('otra', '', { conversation: c.id }); await tick();
    const warnings = board.chat(c.id).filter((m) => m.meta?.kind === 'brake');
    assert.equal(warnings.length, 1, 'one warning per reset window');
    // A launch count over its limit is not a reason to keep the assistant quiet: only real usage brakes it.
    clean(board); ctx.config.budget.agents = { claude: { maxTasks: 0 } };
    try { assert.equal(o.lane(c.id).brake(), null); } finally { delete ctx.config.budget.agents; }
  } finally { delete process.env.ORB_NOTICE_RETRY_MS; o.closing = true; o.stopAll(); }
});

function rounds(board, conv, max) {
  const mk = (n) => board.createTask({ project: 'web', title: `t${n}`, description: 'x', agent: 'claude', conversation_id: conv }, 'orb');
  let stamp = 1;
  // Distinct, ordered timestamps: chat lines and tasks are written in the same millisecond otherwise.
  const age = (table, id) => board.run(`UPDATE ${table} SET ${table === 'chat' ? 'at' : 'created_at'} = ? WHERE id = ?`, new Date(Date.now() + (stamp++) * 1000).toISOString(), id);
  const user = () => age('chat', board.addChat('usuario', 'pide', null, conv).id);
  const reply = () => age('chat', board.addChat('orb', 'hecho', null, conv).id);
  const task = () => { const x = mk(stamp); age('tasks', x.id); };
  const check = () => fixRoundCheck(board, conv, max, new Date(Date.now() + stamp * 1000).toISOString());
  return { user, reply, task, check };
}
test('correction rounds: plan + 2 allowed, the 3rd is refused, a user message resets', async () => {
  const board = clean(new Board());
  const dir = path.join(t.home, 'web', 'gasto'); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'web', path: dir }, 'usuario');
  const conv = board.createConversation({ title: 'Web' }).id;
  const r = rounds(board, conv, 2);
  r.user(); r.task(); r.task(); assert.equal(r.check().allowed, true, 'plan, several tasks of one turn');
  r.reply(); r.task(); r.task(); assert.equal(r.check().allowed, true, 'round 1');
  r.reply(); r.task(); assert.equal(r.check().allowed, true, 'round 2');
  r.reply(); assert.equal(r.check().allowed, false, 'round 3 refused');
  assert.equal(maxFixRounds({}), 2); assert.equal(maxFixRounds({ budget: { maxFixRounds: 4 } }), 4);
  r.user(); assert.equal(r.check().allowed, true, 'a new request starts again');
  // The engine's own join of a copy is not a round of the assistant.
  r.task(); r.reply(); r.task(); r.reply(); r.task(); r.reply();
  const join = board.createTask({ project: 'web', title: 'unir', description: 'x', agent: 'claude', conversation_id: conv, internal: true }, 'orb');
  board.setting(`engine_task:${join.id}`, '1');
  assert.equal(r.check().allowed, false, 'already at 2 rounds');
  r.user(); r.task(); r.reply();
  const join2 = board.createTask({ project: 'web', title: 'unir 2', description: 'x', agent: 'claude', conversation_id: conv, internal: true }, 'orb');
  board.setting(`engine_task:${join2.id}`, '1');
  assert.equal(r.check().rounds, 1, 'the join does not count');
});

test('weekly brake: any single-model week (Haiku, a full model name) never stops the account', () => {
  for (const w of ['seven_day_haiku', 'seven_day_claude_haiku_5', 'seven_day_opus']) {
    const b = clean(new Board()); rate(b, 'five_hour', 0.1); rate(b, w, 0.97);
    assert.equal(canLaunch(b, 'claude', null).ok, true, w);
  }
});

test('braked report text says why (no tries), and the prompt follows maxFixRounds', () => {
  const board = clean(new Board()); rate(board, 'seven_day', 0.9);
  const c = board.createConversation({ title: 'Web 2' });
  const o = assistant(board);
  try {
    o.internal('AVISO DEL SISTEMA: tareas terminadas\n- #8 Menú: hecho', null, null, { conversation: c.id });
    const line = board.chat(c.id).find((m) => m.role === 'orb' && m.body.includes('#8 Menú'));
    assert.ok(line && !/intentos/.test(line.body) && /límite/.test(line.body));
    assert.equal(o.braked(c.id), true);
  } finally { o.closing = true; o.stopAll(); clean(board); }
  ctx.config.budget.maxFixRounds = 3;
  try { assert.match(persona(), /3 rondas de corrección/); } finally { delete ctx.config.budget.maxFixRounds; }
});

test('prompt: no verification line on levels 0-1, kept on 2+', () => {
  const was = ctx.config.budget.profile;
  try {
    for (const lvl of [0, 1]) { ctx.config.budget.profile = lvl; const p = persona(); assert.doesNotMatch(p, /cierra con una tarea de VERIFICACI/i); assert.doesNotMatch(p, /SIEMPRE con una tarea/); assert.match(p, /No crees una tarea de verificación aparte/); assert.match(p, /2 rondas de corrección/); }
    for (const lvl of [2, 4]) { ctx.config.budget.profile = lvl; const p = persona(); assert.match(p, /cierra con una tarea de VERIFICACIÓN readonly/); assert.match(p, /VEREDICTO/); assert.match(p, /2 rondas de corrección/); }
  } finally { ctx.config.budget.profile = was; }
});
