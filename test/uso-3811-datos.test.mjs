// The numbers of the new usage page: windows, filters, series per day, breakdowns, top chats and tasks and the CSV, also
// over records from before accounts, projects and titles were recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowOf, daysNeeded, eachDay, shiftDay, filterRecords, seriesOf, breakdownOf, topItems, totals, toCsv, smoothPath, niceMax, slotOf } from '../src/ui/lib/usage-data.js';

const rec = (o) => ({ day: '2026-11-25', account: 'a1', agent: 'claude', model: 'sonnet', modelLabel: 'Sonnet', project: 'tienda', kind: 'chat', id: 1, title: 'Carrito', turns: 1, tokensIn: 100, tokensOut: 50, tokensCache: 10, usd: 1, ...o });
const R = [
  rec({}),
  rec({ day: '2026-11-24', kind: 'task', id: 7, title: 'Buscador, "rápido"', usd: 3, tokensIn: 300 }),
  rec({ day: '2026-11-24', agent: 'codex', account: 'x1', model: 'gpt', project: 'api', kind: 'session', id: 's9', usd: 2 }),
  rec({ day: '2026-11-20', account: '', model: '', modelLabel: '', project: '', agent: 'claude', kind: 'other', id: null, title: '', usd: 0.5 })
];

test('windows: periods end today, custom dates are put in order and kept inside a year', () => {
  assert.deepEqual(windowOf('7', null, '2026-11-25'), { from: '2026-11-19', to: '2026-11-25', days: 7 });
  assert.deepEqual(windowOf('1', null, '2026-11-25'), { from: '2026-11-25', to: '2026-11-25', days: 1 });
  assert.deepEqual(windowOf('custom', { from: '2026-11-20', to: '2026-11-10' }, '2026-11-25'), { from: '2026-11-10', to: '2026-11-20', days: 11 });
  assert.equal(windowOf('custom', { from: '2026-11-20', to: '2027-02-01' }, '2026-11-25').to, '2026-11-25');
  assert.equal(windowOf('custom', { from: '2020-01-01', to: '2026-11-25' }, '2026-11-25').days, 366);
  assert.equal(daysNeeded(windowOf('90', null, '2026-11-25'), '2026-11-25'), 180);
  assert.equal(daysNeeded(windowOf('custom', { from: '2026-01-01', to: '2026-11-25' }, '2026-11-25'), '2026-11-25'), 366);
  assert.deepEqual(eachDay('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(shiftDay('2026-03-01', 1), '2026-02-28');
});

test('filters by agent, account, model and project; old rows count as no account, no model, no project', () => {
  const all = '2026-11-01'; const to = '2026-11-30';
  assert.equal(filterRecords(R, {}, all, to).length, 4);
  assert.equal(filterRecords(R, { agent: 'codex' }, all, to).length, 1);
  assert.equal(filterRecords(R, { account: 'a1', project: 'tienda' }, all, to).length, 2);
  assert.deepEqual(filterRecords(R, { account: '-' }, all, to).map((r) => r.kind), ['other']);
  assert.deepEqual(filterRecords(R, { project: '-', model: '-' }, all, to).map((r) => r.kind), ['other']);
  assert.equal(filterRecords(R, {}, '2026-11-24', '2026-11-24').length, 2);
});

test('series by day: every day is there, days without use are 0, the biggest series first', () => {
  const days = eachDay('2026-11-23', '2026-11-25');
  const s = seriesOf(R, days, 'agent', 'cost');
  assert.deepEqual(s.lines.map((l) => l.key), ['claude', 'codex']);
  assert.deepEqual(s.lines[0].values, [0, 3, 1]);
  assert.deepEqual(s.totals, [0, 5, 1]);
  assert.deepEqual(s.items, [0, 2, 1]);
  assert.deepEqual(seriesOf(R, days, 'project', 'tokens').lines.map((l) => l.key).sort(), ['api', 'tienda']);
  assert.equal(seriesOf(R, days, 'account', 'cost').lines.length, 2);
});

test('breakdown, top chats and tasks, totals', () => {
  const b = breakdownOf(R, 'model', 'cost');
  assert.deepEqual(b.map((x) => x.key), ['sonnet', 'gpt', '']);
  assert.equal(Math.round(b.reduce((n, x) => n + x.share, 0) * 100), 100);
  const top = topItems(R, 'cost');
  assert.deepEqual(top.map((t) => t.key), ['task:7', 'session:s9', 'chat:1']);
  assert.deepEqual(topItems(R, 'tokens').map((t) => t.key)[0], 'task:7');
  const t = totals(R);
  assert.deepEqual([t.usd, t.tokensIn, t.tokensCache, t.items], [6.5, 600, 40, 3]);
});

test('CSV: header, quoting and old rows named', () => {
  const names = { noProject: 'Sin proyecto', defaultModel: 'Modelo predeterminado', agent: (a) => a.toUpperCase(), account: (r) => r.account || 'Cuenta principal' };
  const csv = toCsv(R, names);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'day,type,name,project,agent,account,model,tokens_in,tokens_out,tokens_cache,cost_usd');
  assert.match(lines[1], /^2026-11-20,other,,Sin proyecto,CLAUDE,Cuenta principal,Modelo predeterminado,/);
  assert.match(csv, /"Buscador, ""rápido"""/);
  assert.equal(lines.length, 6);
});

test('curve and axis: smooth and never under zero; colours follow the entity', () => {
  const p = smoothPath([[0, 100], [10, 0], [20, 100], [30, 100]]);
  assert.match(p, /^M0\.0 100\.0 C/);
  assert.ok(p.split('C').length === 4);
  assert.equal(smoothPath([[0, 1]]), '');
  assert.equal(niceMax(0), 1); assert.equal(niceMax(3.2), 5); assert.equal(niceMax(0.12), 0.2);
  assert.equal(slotOf('agent', 'codex', []), 2);
  assert.equal(slotOf('model', 'b', ['a', 'b', 'c']), 2);
  assert.equal(slotOf('model', 'b', ['c', 'b', 'a']), 2);
});
