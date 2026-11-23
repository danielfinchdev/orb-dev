// 3.8.10, step 6c: what the windows need to show several accounts of one agent. The engine side (tag and colour, every account
// with its state in the catalog, the account of a conversation, the spend by account) is exercised with two Claude accounts;
// the screens are read as text (the build is not run by this test).
import fs from 'node:fs';
import path from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, ROOT } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { pauseAccount } from '../src/domain/usage/budget.mjs';
import { markOf, defaultTag, ACCOUNT_COLORS } from '../src/shared/account-marks.mjs';

const t = tempHome();
const stamina = path.join(t.base, 'cuentas', 'stamina');
const gone = path.join(t.base, 'cuentas', 'gone');
let board; let sessions; let orchestrator; let api;
const call = (method, params, principal = DESKTOP) => api.call(method, params, principal);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

before(() => {
  fs.mkdirSync(stamina, { recursive: true });
  ctx.config.accounts = [
    { id: 'claude', agent: 'claude', label: 'PGC', home: '', enabled: true },
    { id: 'claude-2', agent: 'claude', label: 'STAMINA', home: stamina, enabled: true },
    { id: 'claude-3', agent: 'claude', label: 'Old trial', home: gone, enabled: true },
    { id: 'codex', agent: 'codex', label: 'Codex', home: '', enabled: true }
  ];
  Object.assign(ctx.config.orchestrator, { account: 'claude', accountMode: 'auto' });
  board = new Board();
  sessions = new Sessions(board, { emit: () => {} });
  orchestrator = new Orchestrator(board, { emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler: { held: () => false, hold: () => () => {}, refreshAvailable: () => {} }, emit: () => {}, log: () => {}, version: 'test' });
});
after(() => { sessions.stopAll(); orchestrator.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('the default tag comes from the name and the colour from the place among the accounts of the agent', () => {
  assert.equal(defaultTag('PGC'), 'PGC');
  assert.equal(defaultTag('Work Max'), 'WM');
  assert.equal(defaultTag('Personal'), 'PER');
  assert.ok(defaultTag('', 'claude-2').length >= 2);
  assert.deepEqual(markOf({ label: 'PGC' }, 0), { tag: 'PGC', color: ACCOUNT_COLORS[0] });
  assert.deepEqual(markOf({ label: 'PGC', tag: 'ab', color: 'teal' }, 3), { tag: 'AB', color: 'teal' });
  assert.equal(markOf({ label: 'PGC', color: 'pink' }, 1).color, ACCOUNT_COLORS[1], 'a colour outside the list is ignored');
});

test('accounts.update edits the tag and the colour; agents.status brings both, with defaults', async () => {
  await call('accounts.update', { id: 'claude-2', tag: 'sta', color: 'violet' });
  assert.equal(ctx.config.accounts.find((a) => a.id === 'claude-2').tag, 'STA');
  const claude = (await call('agents.status', {})).find((a) => a.id === 'claude');
  const by = (id) => claude.accounts.find((a) => a.id === id);
  assert.deepEqual([by('claude-2').tag, by('claude-2').color], ['STA', 'violet']);
  assert.deepEqual([by('claude').tag, by('claude').color], ['PGC', ACCOUNT_COLORS[0]]);
  await assert.rejects(() => call('accounts.update', { id: 'claude-2', tag: 'x' }));
  await assert.rejects(() => call('accounts.update', { id: 'claude-2', color: 'pink' }));
  await call('accounts.update', { id: 'claude-2', tag: '' });
  assert.equal(ctx.config.accounts.find((a) => a.id === 'claude-2').tag, undefined, 'empty goes back to the default');
  await call('accounts.update', { id: 'claude-2', tag: 'STA' });
});

test('models.catalog lists the usable accounts with their mark and the others with the reason', async () => {
  pauseAccount(board, 'claude-2', 3_600_000, 'limit');
  const claude = (await call('models.catalog', {})).find((a) => a.id === 'claude');
  assert.deepEqual(claude.accounts.map((a) => a.id), ['claude', 'claude-2']);
  assert.ok(claude.accounts.every((a) => a.state === 'ok' && a.tag && a.color));
  assert.ok(claude.accounts.find((a) => a.id === 'claude-2').limitedUntil > Date.now(), 'the pause shows as «al límite hasta»');
  assert.equal(claude.accounts.find((a) => a.id === 'claude').limitedUntil, undefined);
  assert.equal(claude.unusable.length, 1);
  assert.equal(claude.unusable[0].id, 'claude-3');
  assert.equal(claude.unusable[0].state, 'nofolder');
  assert.ok(claude.unusable[0].reason);
  await call('accounts.update', { id: 'claude', enabled: false });
  const off = (await call('models.catalog', {})).find((a) => a.id === 'claude').unusable.find((a) => a.id === 'claude');
  assert.equal(off.state, 'off');
  await call('accounts.update', { id: 'claude', enabled: true });
});

test('the conversation list says whether its account is fixed; the spend is split by account only with several', async () => {
  const fixed = board.createConversation({ title: 'fixed', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  const auto = board.createConversation({ title: 'auto', agent: 'claude', account: 'claude', account_fixed: 0 });
  const list = await call('conversations.list', {});
  const by = (c) => list.find((x) => x.id === (c.id ?? c));
  assert.equal(by(fixed).account_fixed, 1);
  assert.equal(by(auto).account_fixed, 0);
  const today = new Date().toISOString().slice(0, 10);
  for (const [account, usd] of [['claude', 1], ['claude-2', 3], ['codex', 5]]) board.run('INSERT INTO usage_ledger (at, day, account_id, turns, tokens_in, tokens_out, usd) VALUES (?, ?, ?, 1, 10, 20, ?)', new Date().toISOString(), today, account, usd);
  const history = await call('usage.history', { days: 7 });
  assert.deepEqual(history.byAccount.map((a) => a.account), ['claude-2', 'claude'], 'Codex has one account: not split; the larger spend first');
  assert.equal(history.byAccount[0].label, 'STAMINA');
});

test('the screens: Automática is sent as auto, the notice has its buttons and every new text exists in es and en', async () => {
  const picker = read('src', 'ui', 'components', 'brain-picker.jsx');
  assert.match(picker, /acc === AUTO \? AUTO/, 'the Automática group picks auto');
  assert.match(picker, /export function AccountTag/);
  assert.match(picker, /acc\.state !== 'ok'/, 'an account that cannot be used is shown dimmed');
  const notice = read('src', 'ui', 'components', 'account-notice.jsx');
  for (const id of ['account-hold-wait', 'account-use-other', 'account-to-auto']) assert.ok(notice.includes(id), id);
  assert.match(read('src', 'ui', 'views', 'chat.jsx'), /chat\.holdWait/);
  assert.match(read('src', 'ui', 'views', 'session.jsx'), /sessions\.holdWait/);
  assert.match(read('src', 'ui', 'views', 'agents.jsx'), /accounts\.rememberIdentity/);
  const es = (await import('../src/shared/locales/es.mjs')).default; const en = (await import('../src/shared/locales/en.mjs')).default;
  const used = new Set();
  for (const f of ['components/brain-picker.jsx', 'components/account-notice.jsx', 'components/new-task.jsx', 'views/chat.jsx', 'views/session.jsx', 'views/agents.jsx', 'views/usage.jsx']) {
    for (const m of read('src', 'ui', ...f.split('/')).matchAll(/\b(?:t|tr|tb)\('((?:acct\.|usage\.byAccount|usage\.account)[\w.]*)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 25);
  for (const key of used) { assert.ok(es[key], `es: ${key}`); assert.ok(en[key], `en: ${key}`); }
  for (const key of ['acct.reason.off', 'acct.reason.nofolder', 'acct.reason.nosession', 'msg.api.accountTag', 'msg.ctx.accountMark']) { assert.ok(es[key], key); assert.ok(en[key], key); }
});
