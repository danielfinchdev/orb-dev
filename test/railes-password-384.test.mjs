// 3.8.4: the master password EVERY time for a change of a rail's value (also through config.save) and for saving a
// shipped rule; yours keep the 5-minute unlock. Runs the real dispatcher in-process on a throwaway home.
import './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { PermissionError, principalOf, needsUnlock, freshPurpose, railValuesChange } from '../src/domain/security/permissions.mjs';
import { guardCall } from '../src/engine/transport/remote.mjs';
import { ensureDefaultRules } from '../src/domain/rules/rules.mjs';
import { DEFAULT_RULES } from '../src/domain/rules/defaults.mjs';
import { keysHeld, isRef } from '../src/domain/security/connector-secrets.mjs';

const PASSWORD = 'una frase larga de prueba';
const desktop = principalOf();
const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
const browser = principalOf({ device: { id: 'b1', kind: 'browser' } });
const SEED = DEFAULT_RULES[0].id;
const needPassword = /necesita tu contraseña maestra/;
let t; let board; let api;

before(async () => {
  t = tempHome(); board = new Board();
  ensureDefaultRules();
  const sessions = new Sessions(board, { emit: () => {} });
  const orchestrator = new Orchestrator(board, { emit: () => {} });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null } });
  await api.call('master.create', { password: PASSWORD }, desktop);
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const call = (m, p = {}) => api.call(m, p, desktop);
const normal = async () => (await call('master.unlock', { password: PASSWORD })).unlock;
const fresh = async (purpose) => (await call('master.unlock', { password: PASSWORD, purpose })).unlock;

// every rail key with a different value, as the patch Ajustes would send
const CHANGES = {
  protected: () => ({ protected: [...ctx.config.protected].reverse().concat(['C:\\extra-ruta']) }),
  approvalWaitMinutes: () => ({ approvalWaitMinutes: ctx.config.approvalWaitMinutes + 1 }),
  'budget.stopAt': () => ({ budget: { stopAt: ctx.config.budget.stopAt === 0.9 ? 0.8 : 0.9 } }),
  'budget.weeklyStopAt': () => ({ budget: { weeklyStopAt: ctx.config.budget.weeklyStopAt === 0.9 ? 0.8 : 0.9 } }),
  'budget.maxFixRounds': () => ({ budget: { maxFixRounds: ctx.config.budget.maxFixRounds === 3 ? 4 : 3 } }),
  'budget.agents': () => ({ budget: { agents: { claude: { maxTasks: ctx.config.budget.agents.claude.maxTasks === 7 ? 8 : 7, maxHeavy: 3 } } } }),
  maxParallel: () => ({ maxParallel: ctx.config.maxParallel === 3 ? 4 : 3 }),
  perAgent: () => ({ perAgent: ctx.config.perAgent === 2 ? 3 : 2 }),
  oneAtATime: () => ({ oneAtATime: !ctx.config.oneAtATime }),
  'budget.windowHours': () => ({ budget: { windowHours: ctx.config.budget.windowHours === 6 ? 7 : 6 } }),
  timeoutMinutes: () => ({ timeoutMinutes: ctx.config.timeoutMinutes + 5 })
};

test('config.save: each rail key changing needs a fresh rails token, once', async () => {
  for (const [key, make] of Object.entries(CHANGES)) {
    const patch = make();
    assert.equal(needsUnlock('config.save', { patch }, ctx.config), true, key);
    assert.equal(freshPurpose('config.save', { patch }, { current: ctx.config }), 'rails', key);
    const before = JSON.stringify(ctx.config);
    await assert.rejects(call('config.save', { patch }), needPassword, `${key}: no token`);
    await assert.rejects(call('config.save', { patch, unlock: await normal() }), needPassword, `${key}: 5-minute unlock`);
    await assert.rejects(call('config.save', { patch, unlock: await fresh('ruleSeed') }), needPassword, `${key}: wrong purpose`);
    assert.equal(JSON.stringify(ctx.config), before, `${key}: nothing written`);
    const f = await fresh('rails');
    await call('config.save', { patch, unlock: f });
    assert.notEqual(JSON.stringify(ctx.config), before, `${key}: written`);
    await assert.rejects(call('config.save', { patch: make(), unlock: f }), needPassword, `${key}: a token serves once`);
  }
});

test('config.save: the same values, or other settings, ask for nothing new', async () => {
  const same = { budget: structuredClone(ctx.config.budget), protected: [...ctx.config.protected], maxParallel: ctx.config.maxParallel, perAgent: ctx.config.perAgent, oneAtATime: ctx.config.oneAtATime, timeoutMinutes: ctx.config.timeoutMinutes, approvalWaitMinutes: ctx.config.approvalWaitMinutes };
  assert.equal(needsUnlock('config.save', { patch: same }, ctx.config), false);
  assert.equal(railValuesChange(same, ctx.config), false);
  await call('config.save', { patch: same });
  await call('config.save', { patch: { assistantName: 'Otro' } });
  await call('config.save', { patch: { language: 'en' } });
  await call('config.save', { patch: { language: 'es', budget: { profile: ctx.config.budget.profile } } });
  assert.equal(ctx.config.assistantName, 'Otro');
  // a budget key that is not a rail's is free too
  assert.equal(railValuesChange({ budget: { autoModel: false } }, ctx.config), false);
});

test('rails.set with values: the 5-minute unlock is not enough, a rails token passes once', async () => {
  const p = { id: 'tiempo-maximo', values: { timeoutMinutes: ctx.config.timeoutMinutes + 10 } };
  await assert.rejects(call('rails.set', p), needPassword);
  await assert.rejects(call('rails.set', { ...p, unlock: await normal() }), needPassword);
  const f = await fresh('rails');
  await call('rails.set', { ...p, unlock: f });
  await assert.rejects(call('rails.set', { ...p, unlock: f }), needPassword);
});

test('a rails token is not spent by a call refused for its parameters, and two calls cannot share it', async () => {
  const f = await fresh('rails');
  await assert.rejects(call('rails.set', { id: 'tiempo-maximo', values: { timeoutMinutes: -5 }, unlock: f }), (e) => !needPassword.test(e.message), 'bad value: refused for the value, not for the password');
  const good = { id: 'tiempo-maximo', values: { timeoutMinutes: ctx.config.timeoutMinutes + 10 }, unlock: f };
  const [a, b] = await Promise.allSettled([call('rails.set', good), call('rails.set', good)]);
  assert.equal([a, b].filter((r) => r.status === 'fulfilled').length, 1, 'one passes, the other finds the token in use');
  await assert.rejects(call('rails.set', good), needPassword, 'and now it is spent');
});

test('rules.save on a shipped rule: a ruleSeed token once; your own rule keeps the 5-minute unlock', async () => {
  const fields = { id: SEED, titulo: 'x', para: 'ambos', texto: 'x' };
  assert.equal(freshPurpose('rules.save', fields, { seedRule: true }), 'ruleSeed');
  assert.equal(freshPurpose('rules.save', fields, { seedRule: false }), null);
  await assert.rejects(call('rules.save', fields), needPassword);
  await assert.rejects(call('rules.save', { ...fields, unlock: await normal() }), needPassword);
  await assert.rejects(call('rules.save', { ...fields, unlock: await fresh('rails') }), needPassword);
  const f = await fresh('ruleSeed');
  assert.equal((await call('rules.save', { ...fields, unlock: f })).after.titulo, 'x');
  await assert.rejects(call('rules.save', { ...fields, unlock: f }), needPassword, 'once');
  const u = await normal();
  const mine = (await call('rules.create', { titulo: 'Mía', para: 'orb', texto: 'a', unlock: u })).after.id;
  assert.equal((await call('rules.save', { id: mine, titulo: 'Mía 2', para: 'orb', texto: 'b', unlock: u })).after.titulo, 'Mía 2');
});

test('the phone and the browser get 403 for every write of rails and shipped rules', async () => {
  const before = JSON.stringify(ctx.config);
  const calls = [['config.save', { patch: CHANGES.maxParallel() }], ['config.save', { patch: { rails: { publicar: { enabled: false } } } }], ['rails.set', { id: 'publicar', enabled: false }], ['rails.restore', {}], ['rules.save', { id: SEED, titulo: 'x', para: 'ambos', texto: 'x' }]];
  for (const [m, p] of calls) for (const who of [phone, browser]) {
    await assert.rejects(api.call(m, p, who), (e) => e instanceof PermissionError && e.status === 403, `${who.channel}: ${m}`);
    assert.notEqual(guardCall(board, m, p), null, `${m} refused by the link`);
  }
  assert.equal(JSON.stringify(ctx.config), before);
});

test('budget.windowHours: 1 to 24 whole hours, anything else is refused', async () => {
  for (const bad of [0, -1, 25, 2.5, '5']) await assert.rejects(call('config.save', { patch: { budget: { windowHours: bad } }, unlock: await fresh('rails') }), /windowHours/, String(bad));
  for (const good of [1, 24]) await call('config.save', { patch: { budget: { windowHours: good } }, unlock: await fresh('rails') });
  assert.equal(ctx.config.budget.windowHours, 24);
});

test('config.save: a rails token spent on a rail value still seals the connectors of the same save', async () => {
  const first = { name: 'gh', command: 'npx', args: ['a'], env: { TOKEN: 'ghp_DE_PRUEBA' } };
  await call('config.save', { patch: { mcpServers: [first] }, unlock: await normal() });
  const saved = ctx.config.mcpServers[0];
  assert.ok(Object.values(saved.env).every(isRef), 'the key went to the vault');
  const moved = { ...saved, command: 'node' };
  const next = ctx.config.maxParallel === 3 ? 4 : 3;
  await call('config.save', { patch: { maxParallel: next, mcpServers: [moved] }, unlock: await fresh('rails') });
  assert.equal(keysHeld(ctx.master, ctx.config.mcpServers[0]), false, 'keys follow the new command');
  // without a valid token the keys are not tied to the new command
  const other = { ...ctx.config.mcpServers[0], command: 'powershell' };
  await assert.rejects(call('config.save', { patch: { maxParallel: next + 1, mcpServers: [other] } }), needPassword);
});
