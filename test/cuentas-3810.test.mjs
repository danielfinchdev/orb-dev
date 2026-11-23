// 3.8.10, step 6a: several accounts of one agent, the engine side. A chat is fixed to one account (it never moves by itself)
// or automatic (it follows the agent's accounts between turns); nothing changes account silently, a change asked for during a
// turn waits for its end, the account of a process is the one resolved for it, and an account with work going on is not
// removed. Two Claude accounts, with the fake agents (ORB_FAKE_AGENTS): the fake logs the folder each process got.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, until } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { migrate } from '../src/domain/data/db.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { brainAccount } from '../src/domain/usage/accounts.mjs';
import { resolveAccount, pauseAccount, clearCooldown } from '../src/domain/usage/budget.mjs';
import { configFrom } from '../src/platform/config-file.mjs';

const t = tempHome();
const folders = { pgc: path.join(t.base, 'cuentas', 'pgc'), stamina: path.join(t.base, 'cuentas', 'stamina') };
const logFile = path.join(t.base, 'fake.log');
let board; let sessions; let orchestrator; let api; let project;
const phone = Object.freeze({ channel: 'phone', device: 'd1' });
const call = (method, params, principal = DESKTOP) => api.call(method, params, principal);

before(() => {
  for (const dir of Object.values(folders)) fs.mkdirSync(dir, { recursive: true });
  // The main account has no folder of its own (the CLI's normal one); the second account lives in its own.
  ctx.config.accounts = [
    { id: 'claude', agent: 'claude', label: 'PGC', home: '', enabled: true },
    { id: 'claude-2', agent: 'claude', label: 'STAMINA', home: folders.stamina, enabled: true },
    { id: 'codex', agent: 'codex', label: 'Codex', home: '', enabled: true }
  ];
  ctx.config.orchestrator.account = 'auto';
  process.env.ORB_FAKE_LOG = logFile;
  board = new Board();
  project = createProject(board, { name: 'web' }, 'usuario');
  sessions = new Sessions(board, { emit: () => {} });
  orchestrator = new Orchestrator(board, { emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler: { held: () => false, hold: () => () => {}, refreshAvailable: () => {} }, emit: () => {}, log: () => {}, version: 'test' });
});
after(() => { delete process.env.ORB_FAKE_LOG; sessions.stopAll(); orchestrator.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const lines = (id) => board.chat(id, 200, {});
const system = (id) => lines(id).filter((l) => l.role === 'system').map((l) => l.body);
const conv = (id) => board.conversation(id);
const calm = (id) => until(() => { const l = orchestrator.lanes.get(id); return l && !l.busy && !l.inflight && !l.queue.length; }, `conversation ${id} at rest`);
const reset = () => { for (const id of ['claude', 'claude-2']) clearCooldown(board, id); board.settingJson('rate:claude', null); board.settingJson('rate:claude-2', null); };
const chat = (extra = {}) => sessions.create({ agent: 'claude', cwd: project.path, project: 'web', title: 'chat', ...extra });
const idle = (id) => until(() => !sessions.isRunning(id), `turn of ${id}`);
const folderOfTurns = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('brainAccount: the one place that turns a choice into columns', () => {
  assert.deepEqual(brainAccount('auto', 'claude'), { account: null, account_fixed: 0 });
  assert.deepEqual(brainAccount('', 'claude'), { account: null, account_fixed: 0 });
  assert.deepEqual(brainAccount(null, 'claude'), { account: null, account_fixed: 0 });
  assert.deepEqual(brainAccount('claude-2', 'claude'), { account: 'claude-2', account_fixed: 1 });
  assert.deepEqual(brainAccount('codex', 'claude'), { account: null, account_fixed: 0 }, 'an account of another agent is no choice for this one');
});

test('migration: chats on another account than the main one become fixed, the rest automatic, once', () => {
  const db = board.db;
  db.exec('ALTER TABLE conversations DROP COLUMN account_fixed; ALTER TABLE sessions DROP COLUMN account_fixed');
  const add = (title, account) => Number(db.prepare("INSERT INTO conversations (title, agent, account, created_at, updated_at) VALUES (?, 'claude', ?, 'a', 'a')").run(title, account).lastInsertRowid);
  const a = add('main', 'claude'); const c = add('second', 'claude-2'); const n = add('none', null);
  db.exec("INSERT INTO sessions (id, kind, agent, account, title, cwd, status, created_at, updated_at) VALUES ('m1', 'chat', 'claude', 'claude-2', 'x', '.', 'idle', 'a', 'a'), ('m2', 'chat', 'claude', 'claude', 'y', '.', 'idle', 'a', 'a')");
  migrate(db);
  assert.deepEqual([a, c, n].map((id) => board.conversation(id).account_fixed), [0, 1, 0]);
  assert.deepEqual(board.all("SELECT account_fixed FROM sessions WHERE id IN ('m1', 'm2') ORDER BY id").map((r) => r.account_fixed), [1, 0]);
  board.run('UPDATE conversations SET account_fixed = 0 WHERE id = ?', c);
  migrate(db);
  assert.equal(board.conversation(c).account_fixed, 0, 'a later choice of «automática» is not undone');
});

test('an old config naming the main account as the assistant account becomes automatic; one picked by hand stays', () => {
  assert.equal(configFrom({ version: 5, orchestrator: { agent: 'claude', account: 'claude' } }).orchestrator.account, 'auto');
  assert.equal(configFrom({ version: 5, orchestrator: { agent: 'claude', account: 'claude-2' } }).orchestrator.account, 'claude-2');
  assert.equal(configFrom({}).orchestrator.account, 'auto');
});

test('resolveAccount: fixed never answers with another account; automatic moves only when it must', () => {
  reset();
  // fixed, at its limit: a problem, with the other account on offer
  pauseAccount(board, 'claude-2', 3_600_000, '');
  let r = resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: true });
  assert.equal(r.acc.id, 'claude-2'); assert.equal(r.problem.kind, 'limit'); assert.equal(r.problem.other, 'claude'); assert.ok(r.problem.until > Date.now());
  // automatic on the same account: it moves to the other and says from where
  r = resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: false });
  assert.equal(r.acc.id, 'claude'); assert.equal(r.problem, null); assert.equal(r.switched.from, 'claude-2');
  // with switchAccount off an automatic chat stays where it is
  ctx.config.continuity = { ...ctx.config.continuity, switchAccount: false };
  assert.equal(resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: false }).acc.id, 'claude-2');
  ctx.config.continuity = { ...ctx.config.continuity, switchAccount: true };
  clearCooldown(board, 'claude-2');
  // automatic and well: it stays (no churn)
  assert.equal(resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: false }).switched, null);
  // both at their limit: it stays, no invented account
  pauseAccount(board, 'claude-2', 3_600_000, ''); pauseAccount(board, 'claude', 3_600_000, '');
  r = resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: false });
  assert.equal(r.acc.id, 'claude-2'); assert.equal(r.switched, null);
  reset();
  // gone, or without a session: the question, never another account
  assert.equal(resolveAccount(board, { agent: 'claude', account: 'claude-9', fixed: true }).problem.kind, 'gone');
  assert.equal(resolveAccount(board, { agent: 'claude', account: 'codex', fixed: true }).problem.kind, 'gone', 'an account of another agent is not this agent\'s');
  ctx.config.accounts.find((a) => a.id === 'claude-2').enabled = false;
  assert.equal(resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: true }).problem.kind, 'nosession');
  assert.equal(resolveAccount(board, { agent: 'claude', account: 'claude-2', fixed: false }).acc.id, 'claude', 'automatic simply uses the other');
  ctx.config.accounts.find((a) => a.id === 'claude-2').enabled = true;
});

test('assistant: a fixed chat at its limit does not send, does not change account, and offers the way out; «Pasar a automática» releases it', async () => {
  reset();
  const c = board.createConversation({ title: 'fija', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  pauseAccount(board, 'claude-2', 3_600_000, '');
  const out = orchestrator.ask('hola', '', { conversation: c.id });
  assert.equal(out.queued, true);
  await until(() => system(c.id).some((s) => /STAMINA/.test(s) && /límite/.test(s)), 'the line that tells it');
  assert.equal(conv(c.id).account, 'claude-2', 'no silent change');
  assert.equal(lines(c.id).filter((l) => l.role === 'orb').length, 0, 'the message did not go');
  const hold = orchestrator.state(c.id);
  assert.equal(hold.hold.kind, 'limit'); assert.equal(hold.hold.other, 'claude'); assert.equal(hold.queued, 1);
  const told = lines(c.id).find((l) => l.meta?.kind === 'account');
  assert.equal(told.meta.problem.kind, 'limit');
  // asking again does not repeat the line
  orchestrator.lane(c.id).next();
  assert.equal(system(c.id).length, 1);
  // «Pasar a automática»: the held message goes, on the other account, and the chat says so
  await call('chat.settings', { conversation: c.id, account: 'auto' });
  await calm(c.id);
  assert.equal(conv(c.id).account_fixed, 0);
  assert.equal(conv(c.id).account, 'claude', 'it left the account at its limit');
  assert.equal(lines(c.id).filter((l) => l.role === 'orb').length, 1, 'the held message was answered');
  assert.ok(system(c.id).some((s) => /Sigue con \*\*PGC\*\*/.test(s)), 'it says it moved');
  reset();
});

test('assistant: «Usar otra» (another account for the chat) releases a held message; «Esperar» sets a timer instead', async () => {
  reset();
  const c = board.createConversation({ title: 'fija 2', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  pauseAccount(board, 'claude-2', 3_600_000, '');
  orchestrator.ask('uno', '', { conversation: c.id });
  await until(() => orchestrator.state(c.id).hold, 'held');
  await assert.rejects(() => call('chat.holdWait', { conversation: 999999 }), /./);
  await call('chat.holdWait', { conversation: c.id });
  assert.equal(orchestrator.state(c.id).hold.waiting, true, 'waiting for the reset');
  await call('chat.settings', { conversation: c.id, account: 'claude' });
  await calm(c.id);
  assert.deepEqual([conv(c.id).account, conv(c.id).account_fixed], ['claude', 1], 'fixed on the other one now');
  assert.equal(lines(c.id).filter((l) => l.role === 'orb').length, 1);
  reset();
});

test('assistant: an automatic chat changes account when its turn ends and says so', async () => {
  reset();
  const c = board.createConversation({ title: 'auto', agent: 'claude', account: 'claude', account_fixed: 0 });
  orchestrator.ask('LENTO primero', '', { conversation: c.id });
  await until(() => orchestrator.state(c.id).busy && orchestrator.lane(c.id).live, 'turn running');
  const lane = orchestrator.lane(c.id); const live = lane.live;
  assert.ok(live, 'a process is open');
  // the user picks another account in the middle of the turn: nothing is closed, the change waits
  const info = await call('chat.settings', { conversation: c.id, account: 'claude-2' });
  assert.equal(info.pending.account, 'claude-2', 'the window sees the change is waiting');
  assert.equal(conv(c.id).account, 'claude', 'not applied yet');
  assert.equal(lane.live, live, 'the process of the turn is not touched');
  assert.equal(live.isClosed?.() ?? false, false);
  await calm(c.id);
  assert.deepEqual([conv(c.id).account, conv(c.id).account_fixed], ['claude-2', 1], 'applied when the turn ended');
  assert.equal(board.settingJson(`pending_brain:${c.id}`), null);
  // a second turn runs on the new account (its own folder, not the other one's)
  orchestrator.ask('segundo', '', { conversation: c.id });
  await calm(c.id);
  const turns = folderOfTurns().filter((l) => l.claudeDir);
  assert.equal(turns.at(-1).claudeDir, folders.stamina, 'the process got the folder of its account');
});

test('assistant: automatic, its account reaches its limit: next turn moves to the other, says why, starts from the summary', async () => {
  reset();
  const c = board.createConversation({ title: 'auto 2', agent: 'claude', account: 'claude', account_fixed: 0 });
  orchestrator.ask('uno', '', { conversation: c.id });
  await calm(c.id);
  assert.equal(conv(c.id).account, 'claude');
  pauseAccount(board, 'claude', 3_600_000, '');
  orchestrator.ask('dos', '', { conversation: c.id });
  await calm(c.id);
  assert.equal(conv(c.id).account, 'claude-2');
  assert.equal(conv(c.id).account_fixed, 0, 'still automatic');
  assert.ok(system(c.id).some((s) => /Sigue con \*\*STAMINA\*\*: PGC ha llegado al límite/.test(s)), system(c.id).join(' | '));
  assert.equal(lines(c.id).filter((l) => l.role === 'orb').length, 2);
  const dirs = folderOfTurns().filter((l) => l.claudeDir);
  assert.equal(dirs.at(-1).claudeDir, folders.stamina);
  reset();
});

test('assistant: a fixed chat whose account is gone or has no session asks instead of moving', async () => {
  reset();
  const gone = board.createConversation({ title: 'borrada', agent: 'claude', account: 'claude-7', account_fixed: 1 });
  orchestrator.ask('hola', '', { conversation: gone.id });
  await until(() => system(gone.id).length, 'the question');
  assert.match(system(gone.id)[0], /ya no está en Orb/);
  assert.equal(conv(gone.id).account, 'claude-7');
  assert.equal(lines(gone.id).filter((l) => l.role === 'orb').length, 0);
  ctx.config.accounts.find((a) => a.id === 'claude-2').enabled = false;
  const off = board.createConversation({ title: 'sin sesión', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  orchestrator.ask('hola', '', { conversation: off.id });
  await until(() => system(off.id).length, 'the question');
  assert.match(system(off.id)[0], /no tiene sesión/);
  assert.equal(conv(off.id).account, 'claude-2');
  ctx.config.accounts.find((a) => a.id === 'claude-2').enabled = true;
});

test('chat.settings: the account must exist, have a session and be of the chat\'s agent, from the PC and from a phone', async () => {
  const c = board.createConversation({ title: 'validar', agent: 'claude' });
  await assert.rejects(() => call('chat.settings', { conversation: c.id, account: 'codex' }), /no es de claude|not an claude/, 'a Codex account in a Claude chat');
  await assert.rejects(() => call('chat.settings', { conversation: c.id, account: 'claude-9' }), /./, 'one that does not exist');
  ctx.config.accounts.find((a) => a.id === 'claude-2').enabled = false;
  await assert.rejects(() => call('chat.settings', { conversation: c.id, account: 'claude-2' }), /sin sesión|no tiene sesión/, 'one without a session');
  await assert.rejects(() => call('chat.settings', { conversation: c.id, account: 'claude-2' }, phone), /sesión/, 'the phone is checked the same way');
  ctx.config.accounts.find((a) => a.id === 'claude-2').enabled = true;
  // the phone can change the account of a chat (it used to be dropped on the way)
  const info = await call('chat.settings', { conversation: c.id, account: 'claude-2' }, phone);
  assert.equal(info.account, 'claude-2'); assert.equal(info.accountFixed, true);
  assert.deepEqual([conv(c.id).account, conv(c.id).account_fixed], ['claude-2', 1]);
  assert.equal(fs.readFileSync(new URL('../src/engine/transport/remote.mjs', import.meta.url), 'utf8').includes('delete params.account'), false);
  // the phone still cannot change what new chats start with
  await assert.rejects(() => call('chat.settings', { account: 'claude-2' }, phone), /./);
  // «automática» again keeps the account in use and releases the choice
  const back = await call('chat.settings', { conversation: c.id, account: 'auto' }, phone);
  assert.equal(back.accountFixed, false); assert.equal(conv(c.id).account, 'claude-2');
});

test('a new chat takes the choice as columns (automatic by default; the one chosen on this PC, fixed)', async () => {
  ctx.config.orchestrator.account = 'auto';
  const auto = orchestrator.startConversation({ text: 'uno' });
  assert.deepEqual([auto.account, auto.account_fixed], [null, 0]);
  ctx.config.orchestrator.account = 'claude-2';
  const fixed = orchestrator.startConversation({ text: 'dos' });
  assert.deepEqual([fixed.account, fixed.account_fixed], ['claude-2', 1]);
  ctx.config.orchestrator.account = 'auto';
});

test('direct chats: fixed stays put and refuses at the limit; automatic moves; the process gets its account\'s folder', async () => {
  reset();
  const fixed = chat({ account: 'claude-2' });
  assert.deepEqual([fixed.account, fixed.account_fixed], ['claude-2', 1]);
  sessions.send(fixed.id, 'hola');
  await idle(fixed.id);
  assert.equal(folderOfTurns().filter((l) => l.claudeDir).at(-1).claudeDir, folders.stamina);
  pauseAccount(board, 'claude-2', 3_600_000, '');
  assert.throws(() => sessions.send(fixed.id, 'otra vez'), /STAMINA.*límite/);
  assert.equal(sessions.get(fixed.id).account, 'claude-2', 'no silent change');
  assert.equal(sessions.items(fixed.id).filter((i) => i.role === 'user').length, 1, 'the second message did not go');
  assert.ok(sessions.items(fixed.id).some((i) => i.kind === 'status' && /STAMINA/.test(i.body)));
  // the same chat becomes automatic: it goes on, on the other account
  sessions.update(fixed.id, { account_fixed: 0 });
  sessions.send(fixed.id, 'ahora sí');
  await idle(fixed.id);
  assert.equal(sessions.get(fixed.id).account, 'claude');
  assert.ok(sessions.items(fixed.id).some((i) => i.kind === 'status' && /Sigue con \*\*PGC\*\*/.test(i.body)), 'it says so');
  reset();
  // an account that does not exist or is of another agent is refused at creation
  assert.throws(() => chat({ account: 'codex' }), /no es de claude|not/i);
  const auto = chat({ account: 'auto' });
  assert.equal(auto.account_fixed, 0); assert.ok(auto.account);
});

test('direct chats: an account change asked for during a turn waits for its end', async () => {
  reset();
  const s = chat({ account: 'claude' });
  sessions.send(s.id, 'LENTO trabajando');
  await until(() => sessions.isRunning(s.id), 'running');
  const live = sessions.lives.get(s.id).live;
  sessions.update(s.id, { account: 'claude-2', account_fixed: 1 });
  assert.equal(sessions.get(s.id).account, 'claude', 'not yet');
  assert.equal(sessions.lives.get(s.id)?.live, live, 'the process of the turn stays open');
  assert.deepEqual(board.settingJson(`pending_account:${s.id}`), { account: 'claude-2', account_fixed: 1 });
  await idle(s.id);
  assert.deepEqual([sessions.get(s.id).account, sessions.get(s.id).account_fixed], ['claude-2', 1]);
  assert.equal(board.settingJson(`pending_account:${s.id}`), null);
});

test('accounts.remove and accounts.logout refuse with a turn running, a message waiting, or a chat of it in use', async () => {
  reset();
  const busy = board.createConversation({ title: 'ocupada', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  orchestrator.ask('LENTO trabajando', '', { conversation: busy.id });
  await until(() => orchestrator.state(busy.id).busy, 'turn running');
  await assert.rejects(() => call('accounts.remove', { id: 'claude-2' }), /conversación en curso/);
  await calm(busy.id);
  // messages waiting for a held account
  const held = board.createConversation({ title: 'en cola', agent: 'claude', account: 'claude-2', account_fixed: 1 });
  pauseAccount(board, 'claude-2', 3_600_000, '');
  orchestrator.ask('espera', '', { conversation: held.id });
  await until(() => orchestrator.state(held.id).hold, 'held');
  await assert.rejects(() => call('accounts.remove', { id: 'claude-2' }), /mensajes en cola/);
  await assert.rejects(() => call('accounts.logout', { id: 'claude-2', confirm: 'STAMINA' }), /./, 'logout refuses too (not Orb\'s folder, or the queue)');
  // a chat of direct kind with something queued
  const s = chat({ account: 'claude-2' });
  assert.equal(sessions.workingOn('claude-2'), null);
  sessions.enqueue(s.id, 'pendiente');
  assert.equal(sessions.workingOn('claude-2'), 'queued');
  assert.equal(orchestrator.workingOn('claude-2'), 'queued');
  reset();
  orchestrator.stop(held.id);
  sessions.editQueued(s.id, sessions.queue(s.id)[0].id, { remove: true });
  assert.equal(sessions.workingOn('claude-2'), null);
  await until(() => !orchestrator.workingOn('claude-2'), 'nothing left on the account');
  assert.equal(await call('accounts.remove', { id: 'claude-2' }), true, 'with nothing going on it goes');
});
