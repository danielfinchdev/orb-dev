// 3.8.2: the usage page (views/usage.jsx): cost and tokens by day, agent and model (usage.history, from usage_ledger)
// and the plans' limits with an even pace. The usage panel of the context ring stays as it was, with a link to it.
import { tempHome, ROOT } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/core/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { DESKTOP, principalOf, METHODS } from '../src/core/permissions.mjs';
import { usageHistory, recordSpend } from '../src/core/budget.mjs';
import { localDay, ownerTz } from '../src/shared/tz.mjs';
import { ctx } from '../src/core/context.mjs';
import { paceOf, windowMs } from '../src/ui/lib/usage-pace.js';

let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('usageHistory: every day of the range, and the totals by agent and by model', async () => {
  const claude = await call('sessions.create', { agent: 'claude', model: 'claude-opus-5-5', permission: 'leer', title: 'A' });
  const codex = await call('sessions.create', { agent: 'codex', model: 'gpt-6', permission: 'leer', title: 'B' });
  recordSpend(board, { account: claude.account, session: claude.id, usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.5 } });
  recordSpend(board, { account: claude.account, session: claude.id, usage: { inputTokens: 500, outputTokens: 100, costUsd: 0.25 } });
  recordSpend(board, { account: codex.account, session: codex.id, usage: { inputTokens: 3000, outputTokens: 50 } });
  // A turn of long ago is outside the range.
  board.run("INSERT INTO usage_ledger (at, day, account_id, session_id, turns, tokens_in, tokens_out, usd) VALUES ('2020-01-01T00:00:00Z', '2020-01-01', ?, ?, 1, 99999, 0, 9)", claude.account, claude.id);
  const out = usageHistory(board, { days: 7 });
  assert.equal(out.days.length, 7);
  assert.equal(out.to, localDay(new Date(), ownerTz(ctx.config)));
  assert.deepEqual(out.days.at(-1), { day: out.to, usd: 0.75, tokensIn: 4500, tokensOut: 350, turns: 3 });
  assert.ok(out.days.slice(0, -1).every((d) => d.turns === 0));
  assert.deepEqual(out.total, { usd: 0.75, tokensIn: 4500, tokensOut: 350, turns: 3 });
  assert.deepEqual(out.agents.map((a) => [a.agent, a.turns]), [['claude', 2], ['codex', 1]], 'the most spent first');
  assert.deepEqual(out.models.map((m) => [m.agent, m.model, m.tokensIn]), [['claude', 'claude-opus-5-5', 1500], ['codex', 'gpt-6', 3000]]);
});

test('usage.history: 7, 30 or 90 days, with the models by name; also from a linked phone', async () => {
  const out = await call('usage.history', { days: 30 });
  assert.equal(out.days.length, 30);
  assert.ok(out.models.every((m) => typeof m.label === 'string' && !('account' in m)));
  await assert.rejects(call('usage.history', { days: 12 }));
  assert.equal(METHODS['usage.history'], 'remote');
  const phone = principalOf({ device: { id: 'p1', kind: 'phone' } });
  assert.equal((await call('usage.history', {}, phone)).days.length, 30, '30 by default');
});

test('an even pace through a window: only for windows of known length with a reset ahead', () => {
  const now = Date.UTC(2026, 10, 9, 12);
  assert.equal(windowMs('five_hour'), 5 * 3_600_000); assert.equal(windowMs('seven_day_opus'), 7 * 86_400_000); assert.equal(windowMs('90min'), 90 * 60_000); assert.equal(windowMs('monthly'), null);
  assert.equal(paceOf({ window: 'five_hour', resetAt: now + 4 * 3_600_000 }, now), 20, 'one hour into five');
  assert.equal(paceOf({ window: 'seven_day', resetAt: now + 3.5 * 86_400_000 }, now), 50);
  assert.equal(paceOf({ window: 'five_hour', resetAt: now - 1 }, now), null);
  assert.equal(paceOf({ window: 'five_hour' }, now), null);
  assert.equal(paceOf({ window: 'monthly', resetAt: now + 1000 }, now), null);
});

test('the usage panel is the same, with its reload button, and links to the page; the page is a screen of its own', () => {
  const session = read('views', 'session.jsx');
  const panel = session.slice(session.indexOf('function UsagePanel'), session.indexOf('export function ContextMeter'));
  assert.match(panel, /call\('usage\.now'\)/); assert.match(panel, /call\('usage\.refresh'\)/); assert.match(panel, /data-testid="usage-reload"/);
  assert.match(panel, /go\(\{ view: 'usage' \}\)/);
  const main = read('main.jsx');
  assert.equal((main.match(/usage: UsageView/g) ?? []).length, 2, 'on the PC and on the phone');
  assert.match(read('components', 'command-palette.jsx'), /go\(\{ view: 'usage' \}\)/, 'and from Ctrl+K');
});
