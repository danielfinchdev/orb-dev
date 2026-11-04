// 3.6 «Personas» (WS3): préstamos de cuentas y topes. Ana presta su Claude a Leo con un tope diario: Leo trabaja con él
// hasta el tope y entonces para, con un aviso solo para Leo; la reserva de Ana le corta al llegar al 80 %; sin préstamo
// Leo no puede elegir la cuenta de Ana por ningún parámetro; los topes de un bot paran al bot; el día es el de Leo.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.mjs';
import { createPerson } from '../src/core/persons.mjs';
import { principalOf, AuthzError } from '../src/core/authz.mjs';
import { createProject } from '../src/core/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { checkSpend, recordSpend, pickAccount, accountsFor, usageByPerson, dayOf } from '../src/core/budget.mjs';
import { localDay } from '../src/core/tz.mjs';

let t; let board; let sessions; let api; let ana; let leo; let asAna; let asLeo; const events = [];
before(() => {
  t = tempHome();
  board = new Board();
  sessions = new Sessions(board, { emit: (event, payload) => events.push({ event, payload }) });
  sessions.onBlocked = (s, why) => board.notice(why, 'warning', { person: s.person_id });
  const orchestrator = new Orchestrator(board, 'clave');
  api = buildApi({ board, sessions, orchestrator, scheduler: new Scheduler(board, sessions, { orchestrator }), emit: (e, p) => events.push({ event: e, payload: p }), log: () => {}, version: 'test' });
  ana = board.ownerId();
  // Leo lives far away: his day is not the server's.
  leo = createPerson(board, { name: 'Leo', caps: { dev: true }, tz: 'Pacific/Kiritimati' }).id;
  asAna = principalOf(board, { desktop: true });
  asLeo = principalOf(board, { desktop: true, person: leo });
  createProject(board, { name: 'web-leo', person: leo }, 'usuario');
});
after(() => { sessions.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const call = (who, method, params = {}) => api.call(method, params, who);
const idle = (id) => until(() => !sessions.isRunning(id) && sessions.get(id), `turno de ${id}`);
const lastText = (id) => { const it = sessions.items(id).filter((i) => i.kind === 'text').at(-1); return typeof it.body === 'string' ? it.body : it.body.text; };

test('sin préstamo, Leo no puede gastar la cuenta de Ana por ningún camino', async () => {
  assert.deepEqual(accountsFor(board, leo, 'claude').map((a) => a.id), []);
  assert.equal(pickAccount(board, { person: leo, agent: 'claude' }), null);
  assert.equal(pickAccount(board, { person: leo, agent: 'claude', preferred: 'claude' }), null);
  await assert.rejects(call(asLeo, 'sessions.create', { agent: 'claude', project: 'web-leo', account: 'claude' }), /no es tuya/);
  await assert.rejects(call(asLeo, 'sessions.create', { agent: 'claude', project: 'web-leo' }), /cuenta/);
  await assert.rejects(call(asLeo, 'tasks.create', { project: 'web-leo', title: 'x', description: 'y', account: 'claude' }), /no es tuya/);
  await assert.rejects(call(asLeo, 'chat.settings', { account: 'claude' }), /no es tuya/);
  await assert.rejects(call(asLeo, 'accounts.lend', { id: 'claude', person: leo, daily_turns: 5 }), AuthzError, 'solo quien la tiene la presta');
  await assert.rejects(call(asLeo, 'accounts.update', { id: 'claude', label: 'mía' }), AuthzError);
  await assert.rejects(call(asLeo, 'agents.login', { account: 'claude' }), AuthzError, 'iniciar sesión en la cuenta de otra persona');
  assert.equal(checkSpend(board, { person: leo, account: 'claude' }).reason, 'noLoan');
  assert.ok(!(await call(asLeo, 'usage.get')).some((u) => u.account === 'claude'), 'ni ve su uso');
});

test('con préstamo trabaja hasta el tope y entonces para, avisando solo a Leo', async () => {
  await call(asAna, 'accounts.lend', { id: 'claude', person: leo, daily_turns: 2, dev: true, bots: false });
  const loans = await call(asLeo, 'accounts.loans');
  assert.equal(loans.got[0].account, 'claude');
  assert.equal(loans.got[0].left.turns, 2);
  const s = await call(asLeo, 'sessions.create', { agent: 'claude', project: 'web-leo' });
  assert.equal(s.account, 'claude', 'la cuenta prestada');
  for (const text of ['uno', 'dos']) { await call(asLeo, 'sessions.send', { id: s.id, text }); await idle(s.id); }
  assert.equal(lastText(s.id), 'Recibido: dos');
  const before = events.length;
  await call(asLeo, 'sessions.send', { id: s.id, text: 'tres' });
  assert.match(lastText(s.id), /límite de hoy/);
  const notice = board.all("SELECT body, person_id FROM chat WHERE role = 'notice' ORDER BY id DESC LIMIT 1")[0];
  assert.equal(notice.person_id, leo, 'el aviso es para Leo');
  assert.match(notice.body, /límite/);
  assert.ok(!events.slice(before).some((e) => e.event === 'notice' && e.payload?.person !== leo));
  // Days and spending in his own time zone.
  const rows = board.all('SELECT day, person_id, account_id, session_id FROM usage_ledger WHERE person_id = ?', leo);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.day === localDay(new Date(), 'Pacific/Kiritimati') && r.account_id === 'claude' && r.session_id === s.id));
  assert.equal(dayOf(board, leo), localDay(new Date(), 'Pacific/Kiritimati'));
  // Ana, whose account it is, keeps working.
  assert.equal(checkSpend(board, { person: ana, account: 'claude' }).ok, true);
  // The owner sees how much each person spent, never on what.
  const by = await call(asAna, 'usage.byPerson');
  assert.deepEqual(Object.keys(by.find((p) => p.person === leo)).sort(), ['month', 'name', 'person', 'today']);
  assert.equal(by.find((p) => p.person === leo).today.turns, 2);
  await assert.rejects(call(asLeo, 'usage.byPerson'), AuthzError);
});

test('la reserva de Ana corta a Leo al 80 % de uso; a Ana no', async () => {
  await call(asAna, 'accounts.lend', { id: 'claude', person: leo, daily_turns: 50, reserve_pct: 20, dev: true });
  assert.equal(checkSpend(board, { person: leo, account: 'claude' }).ok, true);
  board.settingJson('rate:claude', { utilization: 0.81, resetAt: Date.now() + 3_600_000, window: 'five_hour', at: Date.now() });
  const c = checkSpend(board, { person: leo, account: 'claude' });
  assert.equal(c.reason, 'reserve');
  assert.ok(c.resetsAt > Date.now());
  assert.equal(checkSpend(board, { person: ana, account: 'claude' }).ok, true);
  board.settingJson('rate:claude', null);
});

test('un préstamo vencido o retirado ya no sirve; solo para bots no vale para programar', async () => {
  board.run('UPDATE account_loans SET expires_at = ? WHERE person_id = ?', new Date(Date.now() - 1000).toISOString(), leo);
  assert.equal(checkSpend(board, { person: leo, account: 'claude' }).reason, 'expired');
  assert.equal(pickAccount(board, { person: leo, agent: 'claude' }), null);
  await call(asAna, 'accounts.lend', { id: 'claude', person: leo, daily_turns: 5, bots: true, dev: false });
  assert.equal(pickAccount(board, { person: leo, agent: 'claude' }), null, 'para programar, no');
  assert.equal(pickAccount(board, { person: leo, agent: 'claude', bot: 1 })?.id, 'claude', 'para sus bots, sí');
  await call(asAna, 'accounts.unlend', { id: 'claude', person: leo });
  assert.equal(checkSpend(board, { person: leo, account: 'claude' }).reason, 'noLoan');
  await assert.rejects(call(asAna, 'accounts.lend', { id: 'claude', person: ana }), /ya es de ese usuario/);
});

test('los topes de un bot lo paran al llegar; el día es el de quien gasta', () => {
  const bot = Number(board.run("INSERT INTO bots (name, created_at, updated_at, person_id, caps) VALUES ('Casa', 'now', 'now', ?, ?)", leo, JSON.stringify({ daily_turns: 2 })).lastInsertRowid);
  assert.equal(checkSpend(board, { person: leo, bot }).ok, true);
  recordSpend(board, { person: leo, bot, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } });
  recordSpend(board, { person: leo, bot, usage: {} });
  const c = checkSpend(board, { person: leo, bot });
  assert.equal(c.reason, 'botCap');
  assert.ok(c.resetsAt > Date.now() && c.resetsAt - Date.now() <= 24 * 3_600_000 + 60_000, 'vuelve en su medianoche');
  assert.equal(localDay(new Date(c.resetsAt), 'Pacific/Kiritimati') !== dayOf(board, leo), true);
  const row = board.one('SELECT day, tokens_in, tokens_out, usd FROM usage_ledger WHERE bot_id = ? ORDER BY id LIMIT 1', bot);
  assert.deepEqual([row.day, row.tokens_in, row.tokens_out, row.usd], [localDay(new Date(), 'Pacific/Kiritimati'), 10, 5, 0.01]);
  assert.ok(usageByPerson(board).find((p) => p.person === leo).today.turns >= 4);
});

test('cada persona añade su propia cuenta y solo ella la usa', async () => {
  await assert.rejects(call(asLeo, 'accounts.add', { agent: 'claude', label: 'x', home: 'C:\\otra' }), /tu propia carpeta/);
  const acc = await call(asLeo, 'accounts.add', { agent: 'claude', label: 'De Leo' });
  assert.equal(pickAccount(board, { person: leo, agent: 'claude' }).id, acc.id);
  assert.equal(pickAccount(board, { person: ana, agent: 'claude', preferred: acc.id }), null, 'ni la dueña gasta la de Leo');
  assert.notEqual(pickAccount(board, { person: ana, agent: 'claude' }).id, acc.id);
  await assert.rejects(call(asAna, 'accounts.remove', { id: acc.id }), AuthzError);
  await call(asLeo, 'accounts.update', { id: acc.id, label: 'Mi Claude' });
});
