// 3.8.10, step 6b: credentials and identity of several accounts of one agent. The agent itself says who a folder is signed in
// as (no turn, no plan spent); a fingerprint is compared with the one saved; a different login or a login without e-mail where
// there was one holds the message back; an API key is told before the turn; the same login in two accounts is told; a chat
// fixed to one account hands its tasks to that account only; a phone never receives who an account is. The e-mail lives only
// in the fake agents of these tests (globalThis.__orbFakeWho): it must not appear anywhere Orb writes.
import fs from 'node:fs';
import path from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, until } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { identityFromClaude, identityFromCodex, maskEmail } from '../src/agents/identity.mjs';
import { agentKeyEnv, keyEnvAllowed } from '../src/domain/security/agent-keys.mjs';
import { fixedAccountOf, loginState } from '../src/domain/usage/accounts.mjs';
import { phoneConfig, shapeResult, guardCall } from '../src/engine/transport/remote-calls.mjs';
import { statusAll } from '../src/agents/index.mjs';

const t = tempHome();
const folders = { stamina: path.join(t.base, 'cuentas', 'stamina'), codex2: path.join(t.base, 'cuentas', 'codex2') };
const logFile = path.join(t.base, 'fake.log');
const MAIL_A = 'ana.perez@example.org'; const MAIL_B = 'otra.persona@example.net';
let board; let sessions; let orchestrator; let api; let project;
let asked = 0; let answer = null; // what the fake agent's own call says, per folder
const call = (method, params, principal = DESKTOP) => api.call(method, params, principal);
const acct = (id) => ctx.config.accounts.find((a) => a.id === id);

before(() => {
  for (const dir of Object.values(folders)) fs.mkdirSync(dir, { recursive: true });
  ctx.config.accounts = [
    { id: 'claude', agent: 'claude', label: 'PGC', home: '', enabled: true },
    { id: 'claude-2', agent: 'claude', label: 'STAMINA', home: folders.stamina, enabled: true },
    { id: 'codex', agent: 'codex', label: 'Codex', home: '', enabled: true },
    { id: 'codex-2', agent: 'codex', label: 'Codex 2', home: folders.codex2, enabled: true }
  ];
  Object.assign(ctx.config.orchestrator, { account: 'claude', accountMode: 'auto' });
  process.env.ORB_FAKE_LOG = logFile;
  globalThis.__orbFakeWho = (env) => { asked++; return typeof answer === 'function' ? answer(env) : answer; };
  board = new Board();
  project = createProject(board, { name: 'web' }, 'usuario');
  sessions = new Sessions(board, { emit: () => {} });
  orchestrator = new Orchestrator(board, { emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler: { held: () => false, hold: () => () => {}, refreshAvailable: () => {} }, emit: () => {}, log: () => {}, version: 'test' });
});
after(() => { delete process.env.ORB_FAKE_LOG; delete globalThis.__orbFakeWho; sessions.stopAll(); orchestrator.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const forget = () => { for (const a of ctx.config.accounts) { delete a.who; delete a.hint; } asked = 0; answer = null; };
const chat = (extra = {}) => sessions.create({ agent: 'claude', cwd: project.path, project: 'web', title: 'chat', ...extra });
const idle = (id) => until(() => !sessions.isRunning(id), `turn of ${id}`);
const turnsLogged = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const everythingWritten = () => {
  const out = [fs.readFileSync(logFile, 'utf8').replace(/"claudeDir"/g, '')];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(jsonl|log|json|md)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8')); } };
  try { walk(ctx.paths.runs); } catch { /* none yet */ }
  return out.join('\n');
};

test('identity: a fingerprint of the e-mail (and the account id), a masked hint, and no organisation in it', () => {
  const a = identityFromClaude({ email: MAIL_A, organization: 'Acme', subscriptionType: 'max', apiProvider: 'firstParty' });
  const b = identityFromClaude({ email: MAIL_A.toUpperCase(), organization: 'Another name', apiProvider: 'firstParty' });
  assert.match(a.who, /^[0-9a-f]{16}$/);
  assert.equal(a.who, b.who, 'case and the organisation name do not change it');
  assert.notEqual(identityFromClaude({ email: MAIL_B }).who, a.who);
  assert.equal(a.hint, 'a***@e***.org');
  assert.ok(!JSON.stringify(a).includes('ana.perez') && !JSON.stringify(a).includes('Acme'));
  // no e-mail to trust: an API key, a gateway or a cloud provider
  assert.equal(identityFromClaude({ email: MAIL_A, apiProvider: 'gateway' }).who, null);
  assert.equal(identityFromClaude({ apiKeySource: 'ANTHROPIC_API_KEY' }).viaKey, true);
  assert.equal(identityFromClaude({ email: MAIL_A, apiKeySource: 'none' }).viaKey, false);
  // Codex: the e-mail and the workspace together
  const c1 = identityFromCodex({ type: 'chatgpt', email: MAIL_A, accountId: 'ws-1', planType: 'plus' });
  assert.notEqual(c1.who, identityFromCodex({ type: 'chatgpt', email: MAIL_A, accountId: 'ws-2' }).who);
  assert.equal(identityFromCodex({ type: 'apiKey' }).who, null); assert.equal(identityFromCodex({ type: 'apiKey' }).viaKey, true);
  assert.equal(identityFromClaude(null), null);
  assert.equal(maskEmail('not an address'), null);
});

test('a new process says who it is before the first message: first time it is saved, the same login goes on', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const c = chat({ account: 'claude-2' });
  sessions.send(c.id, 'hola'); await idle(c.id);
  assert.ok(asked >= 1);
  assert.match(acct('claude-2').who, /^[0-9a-f]{16}$/); assert.equal(acct('claude-2').hint, 'a***@e***.org');
  assert.equal(turnsLogged().filter((l) => l.claudeDir === folders.stamina).length > 0, true, 'the turn went');
  // a second message on the same process is not asked again
  const before = asked; sessions.send(c.id, 'otra'); await idle(c.id);
  assert.equal(asked, before);
});

test('a different login in the folder: «No coincide», the message does not go, the process is closed', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const first = chat({ account: 'claude-2' }); sessions.send(first.id, 'uno'); await idle(first.id);
  sessions.closeLive(first.id);
  const sent = turnsLogged().length;
  answer = { email: MAIL_B, apiProvider: 'firstParty' };
  const c = chat({ account: 'claude-2' });
  const note = []; sessions.emit = ((emit) => (ev, p) => { note.push([ev, p]); emit.call(sessions, ev, p); })(sessions.emit);
  sessions.send(c.id, 'esto no debe salir'); await idle(c.id);
  assert.equal(turnsLogged().length, sent, 'nothing reached the agent');
  const all = JSON.stringify(sessions.items(c.id));
  assert.match(all, /No coincide/); assert.match(all, /STAMINA/);
  assert.ok(note.some(([ev, p]) => ev === 'session:account' && p.problem.kind === 'identity' && p.problem.account === 'claude-2'));
  assert.equal(board.settingJson(`account_problem:${c.id}`).kind, 'identity');
  assert.equal(sessions.lives.has(c.id), false, 'the process of the other login is closed');
});

test('«Es correcta, recordar esta»: only this PC, and then the new login is the account\'s', async () => {
  // the account now holds MAIL_B (found by the last mismatch)
  const call2 = (principal) => call('accounts.rememberIdentity', { id: 'claude-2' }, principal);
  await assert.rejects(() => call2(Object.freeze({ channel: 'phone', device: 'd1' })), /./, 'a phone cannot');
  const old = acct('claude-2').who;
  assert.equal(await call2(DESKTOP), true);
  assert.notEqual(acct('claude-2').who, old);
  assert.equal(acct('claude-2').who, identityFromClaude({ email: MAIL_B }).who);
  await assert.rejects(() => call2(DESKTOP), /./, 'nothing more to remember');
  const c = chat({ account: 'claude-2' }); const sent = turnsLogged().length;
  sessions.send(c.id, 'ahora sí'); await idle(c.id);
  assert.ok(turnsLogged().length > sent);
});

test('an account that had an e-mail login and now has none (API key, gateway, cloud provider) does not match; one that never had it goes on', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const a = chat({ account: 'claude-2' }); sessions.send(a.id, 'uno'); await idle(a.id); sessions.closeLive(a.id);
  const sent = turnsLogged().length;
  for (const noMail of [{ apiProvider: 'gateway' }, { apiKeySource: 'ANTHROPIC_API_KEY' }, { email: MAIL_A, apiProvider: 'bedrock' }]) {
    answer = noMail;
    const c = chat({ account: 'claude-2' }); sessions.send(c.id, 'no'); await idle(c.id);
    assert.equal(turnsLogged().length, sent, JSON.stringify(noMail));
    assert.match(JSON.stringify(sessions.items(c.id)), /No coincide/);
    assert.equal(board.settingJson(`account_problem:${c.id}`).kind, 'identityNoMail');
  }
  // never had one: «sin comprobar», the turn goes
  forget();
  answer = { apiProvider: 'gateway' };
  const n = chat({ account: 'claude-2' }); sessions.send(n.id, 'va'); await idle(n.id);
  assert.ok(turnsLogged().length > sent);
  assert.equal(acct('claude-2').who, undefined);
});

test('no answer from the agent (old CLI, timeout): «sin comprobar», the turn goes', async () => {
  forget();
  answer = null;
  const c = chat({ account: 'claude-2' }); const sent = turnsLogged().length;
  sessions.send(c.id, 'hola'); await idle(c.id);
  assert.ok(turnsLogged().length > sent);
  assert.equal(acct('claude-2').who, undefined);
  // and one that had a login and does not answer now is not blocked either (nothing was found different)
  answer = { email: MAIL_A }; const d = chat({ account: 'claude-2' }); sessions.send(d.id, 'x'); await idle(d.id); sessions.closeLive(d.id);
  answer = null; const e = chat(); sessions.update(e.id, { account: 'claude-2', account_fixed: 0, cli_session: 'auto-resume-2' }); const k = turnsLogged().length;
  sessions.send(e.id, 'y'); await idle(e.id);
  assert.ok(turnsLogged().length > k);
});

test('an API key that would pay is told before the turn; two accounts with the same login are told', async () => {
  forget();
  answer = { email: MAIL_A, apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' };
  const c = chat({ account: 'claude-2' });
  sessions.send(c.id, 'hola'); await idle(c.id);
  const history = JSON.stringify(sessions.items(c.id));
  assert.match(history, /clave de API/); assert.match(history, /STAMINA/);
  assert.ok(history.indexOf('clave de API') < history.indexOf('"orb"') || !history.includes('"orb"'), 'before the turn');
  // the other account of the agent holds the same login
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const main = chat({ account: 'claude' }); sessions.send(main.id, 'hola'); await idle(main.id);
  assert.match(JSON.stringify(sessions.items(main.id)), /son la misma cuenta/);
  const list = (await call('agents.status', {})).find((a) => a.id === 'claude').accounts;
  assert.deepEqual(list.find((a) => a.id === 'claude').sameAs, ['claude-2']);
  assert.equal(list.find((a) => a.id === 'claude-2').identity, 'ok');
});

test('the assistant: a different login holds its message too (and Codex says who through account/read)', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const c = board.createConversation({ title: 'a', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  orchestrator.ask('hola', '', { conversation: c.id });
  await until(() => { const l = orchestrator.lanes.get(c.id); return l && !l.busy && !l.inflight; }, 'first turn');
  assert.ok(acct('claude-2').who);
  orchestrator.lane(c.id).closeLive();
  answer = { email: MAIL_B, apiProvider: 'firstParty' };
  const sent = turnsLogged().length;
  orchestrator.ask('otra', '', { conversation: c.id });
  await until(() => board.chat(c.id, 50, {}).some((l) => /No coincide/.test(l.body ?? '')), 'the line');
  await until(() => { const l = orchestrator.lanes.get(c.id); return l && !l.busy && !l.inflight; }, 'at rest');
  assert.equal(turnsLogged().length, sent);
  // Codex
  forget();
  answer = { type: 'chatgpt', email: MAIL_A, accountId: 'ws-1' };
  const x = sessions.create({ agent: 'codex', cwd: project.path, project: 'web', title: 'cx', account: 'codex-2' });
  sessions.send(x.id, 'hola'); await idle(x.id);
  assert.match(acct('codex-2').who, /^[0-9a-f]{16}$/);
  sessions.closeLive(x.id);
  answer = { type: 'chatgpt', email: MAIL_B, accountId: 'ws-1' };
  const y = sessions.create({ agent: 'codex', cwd: project.path, project: 'web', title: 'cx', account: 'codex-2' });
  const k = turnsLogged().length; sessions.send(y.id, 'no'); await idle(y.id);
  assert.equal(turnsLogged().length, k);
});

test('a key of the vault goes only to an account without a login of its own', () => {
  const withLogin = path.join(t.base, 'cuentas', 'con-sesion'); fs.mkdirSync(withLogin, { recursive: true });
  fs.writeFileSync(path.join(withLogin, '.credentials.json'), '{}');
  const accLogin = { id: 'claude-9', agent: 'claude', label: 'x', home: withLogin, enabled: true };
  const accNone = { id: 'claude-8', agent: 'claude', label: 'y', home: path.join(t.base, 'cuentas', 'vacia'), enabled: true };
  assert.equal(loginState(accLogin), 'si');
  assert.equal(keyEnvAllowed(accLogin), false);
  assert.equal(keyEnvAllowed(accNone), true);
  assert.equal(keyEnvAllowed({ id: 'grok', agent: 'grok' }), true, 'an agent without sessions of its own keeps using its key');
  const master = { unlocked: () => true, get: () => 'sk-test-secret-value' };
  assert.deepEqual(agentKeyEnv(master, 'grok', { id: 'grok', agent: 'grok' }), { XAI_API_KEY: 'sk-test-secret-value' });
  assert.deepEqual(agentKeyEnv(master, 'claude', accLogin), {});
});

test('a task from a chat fixed to one account takes that account; another account of the agent is refused', () => {
  const fixed = board.createConversation({ title: 'fija', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  const auto = board.createConversation({ title: 'auto', agent: 'claude', account: 'claude', account_fixed: 0 });
  const base = { project: 'web', title: 't', description: 'd' };
  assert.equal(fixedAccountOf(board, fixed.id).id, 'claude-2'); assert.equal(fixedAccountOf(board, auto.id), null);
  assert.equal(board.createTask({ ...base, agent: 'claude', conversation_id: fixed.id }, 'asistente').account, 'claude-2', 'inherited');
  assert.equal(board.createTask({ ...base, agent: 'claude', account: 'claude-2', conversation_id: fixed.id }, 'asistente').account, 'claude-2');
  assert.throws(() => board.createTask({ ...base, agent: 'claude', account: 'claude', conversation_id: fixed.id }, 'asistente'), /solo \*\*STAMINA\*\*/);
  assert.throws(() => board.createTask({ ...base, account: 'claude', conversation_id: fixed.id }, 'asistente'), /solo \*\*STAMINA\*\*/, 'also when the agent was left open');
  // another agent is free, and an open task stays open (the scheduler settles it)
  assert.equal(board.createTask({ ...base, agent: 'codex', conversation_id: fixed.id }, 'asistente').account, null);
  const open = board.createTask({ ...base, agent: 'any', conversation_id: fixed.id }, 'asistente');
  assert.equal(open.agent, 'any'); assert.equal(open.account, null);
  assert.equal(board.createTask({ ...base, agent: 'claude', account: 'claude', conversation_id: auto.id }, 'asistente').account, 'claude', 'an automatic chat may pick');
});

test('a phone gets neither who nor hint, in the settings or in the agents\' list; this PC does', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const c = chat({ account: 'claude-2' }); sessions.send(c.id, 'hola'); await idle(c.id);
  assert.ok(acct('claude-2').who && acct('claude-2').hint);
  const phone = phoneConfig(ctx.config);
  assert.ok(phone.accounts.length >= 4);
  for (const a of phone.accounts) assert.ok(!('who' in a) && !('hint' in a) && !('home' in a), JSON.stringify(a));
  const pc = await call('agents.status', {});
  assert.ok(pc.find((a) => a.id === 'claude').accounts.find((a) => a.id === 'claude-2').who, 'the window of this PC keeps them');
  const remote = shapeResult('agents.status', pc);
  const text = JSON.stringify(remote);
  assert.ok(!remote.some((a) => a.accounts.some((x) => 'who' in x || 'hint' in x)));
  assert.ok(!text.includes(acct('claude-2').who) && !text.includes(acct('claude-2').hint));
  const viaState = shapeResult('app.state', { config: ctx.config });
  assert.ok(viaState.config.accounts.every((a) => !('who' in a) && !('hint' in a)));
  assert.ok(guardCall(board, 'accounts.rememberIdentity', {}), 'a phone cannot call it');
});

test('the e-mail is nowhere Orb writes: not the chat, the run logs, the settings or the agents\' list', async () => {
  forget();
  answer = { email: MAIL_A, organization: 'Acme Org', apiProvider: 'firstParty' };
  const c = chat({ account: 'claude-2' }); sessions.send(c.id, 'hola'); await idle(c.id);
  answer = { email: MAIL_B, apiProvider: 'firstParty' };
  const d = chat({ account: 'claude' }); sessions.send(d.id, 'hola'); await idle(d.id);
  answer = { email: MAIL_A, apiKeySource: 'ANTHROPIC_API_KEY' };
  const x = chat({ account: 'claude-2' }); sessions.closeLive(c.id); sessions.send(x.id, 'hola'); await idle(x.id);
  const haystack = [everythingWritten(), JSON.stringify(ctx.config), JSON.stringify(await call('agents.status', {})), JSON.stringify(board.all('SELECT * FROM chat')), JSON.stringify(board.all('SELECT * FROM session_items'))].join('\n');
  for (const secret of [MAIL_A, MAIL_B, 'ana.perez', 'otra.persona', 'Acme Org']) assert.ok(!haystack.includes(secret), `${secret} must not be written`);
});

test('the list of agents tells each account\'s state of identity', async () => {
  forget();
  answer = { email: MAIL_A };
  const c = chat({ account: 'claude-2' }); sessions.send(c.id, 'hola'); await idle(c.id);
  const list = await statusAll({ refresh: false });
  assert.ok(list.length > 0);
});

test('«Compactar» checks the login first, in a chat and in the assistant', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const c = chat({ account: 'claude-2' }); sessions.send(c.id, 'hola'); await idle(c.id);
  assert.ok(sessions.get(c.id).cli_session);
  sessions.closeLive(c.id);
  answer = { email: MAIL_B, apiProvider: 'firstParty' };
  let sent = turnsLogged().length;
  await assert.rejects(() => sessions.compact(c.id), /No coincide/);
  assert.equal(turnsLogged().length, sent, 'no /compact went to the other login');
  assert.equal(sessions.lives.has(c.id), false);
  // the assistant
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const conv = board.createConversation({ title: 'k', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  orchestrator.ask('hola', '', { conversation: conv.id });
  await until(() => { const l = orchestrator.lanes.get(conv.id); return l && !l.busy && !l.inflight && board.conversation(conv.id).session_id; }, 'first turn');
  orchestrator.lane(conv.id).closeLive();
  answer = { email: MAIL_B, apiProvider: 'firstParty' };
  sent = turnsLogged().length;
  await assert.rejects(() => orchestrator.compact(conv.id), /No coincide/);
  assert.equal(turnsLogged().length, sent);
  assert.ok(board.chat(conv.id, 50, {}).some((l) => /No coincide/.test(l.body ?? '')));
});

test('Codex answering with no account counts as «no login»: it does not match where there was one', async () => {
  assert.deepEqual(identityFromCodex({}), { who: null, hint: null, viaKey: false, external: false, plan: null });
  forget();
  answer = { type: 'chatgpt', email: MAIL_A, accountId: 'ws-1' };
  const x = sessions.create({ agent: 'codex', cwd: project.path, project: 'web', title: 'cx', account: 'codex-2' });
  sessions.send(x.id, 'hola'); await idle(x.id); sessions.closeLive(x.id);
  answer = {};
  const y = sessions.create({ agent: 'codex', cwd: project.path, project: 'web', title: 'cx', account: 'codex-2' });
  const k = turnsLogged().length; sessions.send(y.id, 'no'); await idle(y.id);
  assert.equal(turnsLogged().length, k);
  assert.equal(board.settingJson(`account_problem:${y.id}`).kind, 'identityNoMail');
});

test('no answer from an account that was checked: a fixed chat retries and stops, an automatic one goes with a line', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const first = chat({ account: 'claude-2' }); sessions.send(first.id, 'uno'); await idle(first.id); sessions.closeLive(first.id);
  answer = null; asked = 0;
  const sent = turnsLogged().length;
  const fixed = chat({ account: 'claude-2' }); sessions.send(fixed.id, 'no'); await idle(fixed.id);
  assert.ok(asked >= 2, 'one retry');
  assert.equal(turnsLogged().length, sent);
  assert.match(JSON.stringify(sessions.items(fixed.id)), /No se pudo comprobar/);
  assert.equal(board.settingJson(`account_problem:${fixed.id}`).kind, 'identityUnknown');
  const auto = chat(); sessions.update(auto.id, { account: 'claude-2', account_fixed: 0, cli_session: 'auto-resume-1' }); sessions.send(auto.id, 'va'); await idle(auto.id);
  assert.ok(turnsLogged().length > sent, 'the turn goes');
  assert.match(JSON.stringify(sessions.items(auto.id)), /Sin comprobar/);
});

test('this PC may see which login «recordar esta» would adopt; a phone neither', async () => {
  forget();
  answer = { email: MAIL_A, apiProvider: 'firstParty' };
  const a = chat({ account: 'claude-2' }); sessions.send(a.id, 'uno'); await idle(a.id); sessions.closeLive(a.id);
  answer = { email: MAIL_B, apiProvider: 'firstParty' };
  const b = chat({ account: 'claude-2' }); sessions.send(b.id, 'dos'); await idle(b.id);
  assert.deepEqual(await call('accounts.identityFound', { id: 'claude-2' }), { hint: 'o***@e***.net' });
  const pc = (await call('agents.status', {})).find((x) => x.id === 'claude').accounts.find((x) => x.id === 'claude-2');
  assert.equal(pc.foundHint, 'o***@e***.net');
  const remote = JSON.stringify(shapeResult('agents.status', await call('agents.status', {})));
  assert.ok(!remote.includes('o***@e***.net'));
  assert.ok(guardCall(board, 'accounts.identityFound', {}), 'a phone cannot call it');
});
