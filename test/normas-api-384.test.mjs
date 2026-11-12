// 3.8.4: the API of the text rules and the rails: who may call what, and which calls ask for the master password
// every time. Runs the real dispatcher (buildApi) in-process on a throwaway home.
import './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { METHODS, PermissionError, principalOf, needsUnlock, freshPurpose, FRESH_PURPOSES, UNLOCK_METHODS } from '../src/domain/security/permissions.mjs';
import { guardCall, shapeResult } from '../src/engine/transport/remote.mjs';
import { ensureDefaultRules } from '../src/domain/rules/rules.mjs';
import { DEFAULT_RULES } from '../src/domain/rules/defaults.mjs';
import { RAILS, isRailOn, switchableIds } from '../src/domain/rules/rails.mjs';
import { DEFAULT_CONFIG } from '../src/platform/config-file.mjs';
import * as K from '../src/domain/data/backup.mjs';

const PASSWORD = 'una frase larga de prueba';
const desktop = principalOf();
const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
const browser = principalOf({ device: { id: 'b1', kind: 'browser' } });
const SEED = DEFAULT_RULES[0].id;
const RAIL = 'publicar';
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
const needPassword = /necesita tu contraseña maestra/;
const ruleFile = (id) => path.join(ctx.paths.rules, `${id}.md`);

test('the table: the phone reads the rules and the rails, everything else here', () => {
  const remote = ['rules.list', 'rules.read', 'rails.list'];
  const pc = ['rules.save', 'rules.create', 'rules.pause', 'rules.resume', 'rules.delete', 'rules.restoreDefaults', 'rails.set', 'rails.restore'];
  for (const m of remote) assert.equal(METHODS[m], 'remote', m);
  for (const m of pc) assert.equal(METHODS[m], 'pc', m);
  for (const m of [...remote, ...pc]) assert.ok(Object.hasOwn(METHODS, m) && api.methodNames().includes(m), m);
  for (const p of ['rails', 'ruleSeed']) assert.ok(FRESH_PURPOSES.includes(p), p);
});

test('the phone and the browser cannot change anything (403), and can read', async () => {
  const state = () => JSON.stringify(ctx.config.rails) + fs.readdirSync(ctx.paths.rules).join();
  const before = state();
  const calls = [['rules.save', { id: SEED, titulo: 'x', para: 'ambos', texto: 'x' }], ['rules.create', { titulo: 'x', texto: 'x' }], ['rules.pause', { id: SEED }], ['rules.resume', { id: SEED }],
    ['rules.delete', { id: SEED }], ['rules.restoreDefaults', {}], ['rails.set', { id: RAIL, enabled: false }], ['rails.restore', {}]];
  for (const [m, p] of calls) for (const who of [phone, browser]) {
    await assert.rejects(api.call(m, p, who), (e) => e instanceof PermissionError && e.status === 403, `${who.channel}: ${m}`);
    assert.notEqual(guardCall(board, m, p), null, `${m} is refused by the phone link too`);
  }
  assert.equal(state(), before, 'nothing changed');
  for (const who of [phone, browser]) {
    const list = await api.call('rules.list', {}, who);
    assert.ok(list.length >= DEFAULT_RULES.length);
    assert.equal((await api.call('rules.read', { id: SEED }, who)).id, SEED);
    const rails = shapeResult('rails.list', await api.call('rails.list', {}, who));
    assert.equal(rails.length, RAILS.length);
    // no path of this PC reaches a phone: the protected items are left out of the answer
    assert.ok(!JSON.stringify(rails).includes('protected'), 'protected paths not sent to the phone');
  }
  assert.ok((await call('rails.list')).find((r) => r.id === 'rutas-protegidas').valores.protected.length > 0, 'the PC does get them');
});

test('reading needs no password', async () => {
  assert.ok((await call('rules.list')).length >= DEFAULT_RULES.length);
  assert.equal((await call('rules.read', { id: SEED })).de_serie, true);
  assert.equal((await call('rails.list')).length, RAILS.length);
  await assert.rejects(call('rules.read', { id: 'no-existe' }), /no existe/);
});

test('your own rules: create, save, pause, resume and delete with the usual 5-minute unlock', async () => {
  for (const [m, p] of [['rules.create', { titulo: 'Mía', texto: 'Hola' }], ['rules.save', { id: 'x', titulo: 'a', para: 'ambos', texto: 'b' }]]) await assert.rejects(call(m, p), needPassword, m);
  const u = await normal();
  const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const made = await call('rules.create', { titulo: 'Mía', para: 'orb', texto: `No uses sudo. ${key}`, unlock: u });
  assert.equal(made.before, null);
  assert.equal(made.after.de_serie, false);
  assert.ok(!made.after.texto.includes(key), 'a pasted key is masked in the answer');
  const id = made.after.id;
  // the same unlock serves every time, for yours
  const saved = await call('rules.save', { id, titulo: 'Mía 2', para: 'ambos', texto: 'Texto nuevo', unlock: u });
  assert.equal(saved.before.titulo, 'Mía'); assert.equal(saved.after.titulo, 'Mía 2');
  await assert.rejects(call('rules.pause', { id }), needPassword);
  assert.equal((await call('rules.pause', { id, unlock: u })).after.estado, 'pausada');
  await assert.rejects(call('rules.resume', { id }), needPassword);
  assert.equal((await call('rules.resume', { id, unlock: u })).after.estado, 'activa');
  assert.equal((await call('rules.delete', { id, unlock: u })).after, null);
  assert.ok(!fs.existsSync(ruleFile(id)));
  await assert.rejects(call('rules.create', { titulo: '', texto: 'x', unlock: u }), /necesita un título/);
  await assert.rejects(call('rules.save', { id: 'no-existe', titulo: 'a', para: 'ambos', texto: 'b', unlock: u }), /no existe/);
  await assert.rejects(call('rules.create', { titulo: 'a', para: 'nadie', texto: 'b', unlock: u }), /orb, subagentes o ambos/);
});

test('a shipped rule: pausing and deleting ask for the password every time; resuming takes the usual unlock', async () => {
  assert.equal(needsUnlock('rules.pause', { id: SEED }), true);
  assert.equal(freshPurpose('rules.pause', { id: SEED }, { seedRule: true }), 'ruleSeed');
  assert.equal(freshPurpose('rules.pause', { id: SEED }, { seedRule: false }), null);
  assert.ok(UNLOCK_METHODS.has('rules.resume') && freshPurpose('rules.resume', { id: SEED }, { seedRule: true }) === null);
  const u = await normal();
  await assert.rejects(call('rules.pause', { id: SEED, unlock: u }), needPassword, 'a normal unlock does not pause a shipped rule');
  await assert.rejects(call('rules.delete', { id: SEED, unlock: u }), needPassword, 'nor delete it');
  await assert.rejects(call('rules.pause', { id: SEED, unlock: await fresh('rails') }), needPassword, 'a rails token is not for rules');
  const f1 = await fresh('ruleSeed');
  assert.equal((await call('rules.pause', { id: SEED, unlock: f1 })).after.estado, 'pausada');
  await assert.rejects(call('rules.delete', { id: SEED, unlock: f1 }), needPassword, 'a token serves once');
  assert.equal((await call('rules.resume', { id: SEED, unlock: u })).after.estado, 'activa');
  const f2 = await fresh('ruleSeed');
  assert.equal((await call('rules.delete', { id: SEED, unlock: f2 })).after.estado, 'eliminada');
  // hidden, a shipped id still asks every time (no state skips the password)
  await assert.rejects(call('rules.delete', { id: SEED, unlock: u }), needPassword);
  const f3 = await fresh('ruleSeed');
  const back = await call('rules.restoreDefaults', { unlock: f3 });
  assert.ok(back.after.some((r) => r.id === SEED && r.estado === 'activa'));
  await assert.rejects(call('rules.restoreDefaults', { unlock: f3 }), needPassword, 'once');
  await assert.rejects(call('rules.restoreDefaults', { unlock: u }), needPassword, 'never with the usual unlock');
});

test('the rails: every change asks for the password every time, with its own purpose', async () => {
  const u = await normal();
  await assert.rejects(call('rails.set', { id: RAIL, enabled: false }), needPassword);
  await assert.rejects(call('rails.set', { id: RAIL, enabled: false, unlock: u }), needPassword, 'the 5-minute unlock is not enough');
  await assert.rejects(call('rails.set', { id: RAIL, enabled: false, unlock: await fresh('ruleSeed') }), needPassword, 'another purpose');
  await assert.rejects(call('rails.set', { id: RAIL, enabled: false, unlock: await fresh('deleteProject') }), needPassword);
  assert.equal(isRailOn(RAIL), true, 'nothing changed');
  const f = await fresh('rails');
  const list = await call('rails.set', { id: RAIL, enabled: false, unlock: f });
  assert.equal(list.find((r) => r.id === RAIL).activo, false);
  assert.equal(isRailOn(RAIL), false);
  assert.equal(JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8')).rails[RAIL].enabled, false, 'saved in orb.json');
  await assert.rejects(call('rails.set', { id: RAIL, enabled: true, unlock: f }), needPassword, 'a token serves once');
  await assert.rejects(call('rails.restore', { unlock: u }), needPassword);
  const g = await fresh('rails');
  await assert.rejects(call('master.check', { unlock: g }), needPassword, 'it opens nothing else');
  await call('rails.restore', { unlock: g });
  await assert.rejects(call('rails.restore', { unlock: g }), needPassword);
});

test('rails.set: switch back on, values of its own keys only, no fixed rails, no unknown ids', async () => {
  const set = async (p) => call('rails.set', { ...p, unlock: await fresh('rails') });
  await set({ id: 'freno-uso', enabled: false });
  assert.equal(isRailOn('freno-uso'), false);
  await set({ id: 'freno-uso', enabled: true, values: { 'budget.stopAt': 0.8 } });
  assert.equal(isRailOn('freno-uso'), true);
  assert.equal(ctx.config.budget.stopAt, 0.8);
  assert.equal(ctx.config.rails['freno-uso'].enabled, true);
  await assert.rejects(set({ id: 'freno-uso', values: { 'budget.stopAt': 5 } }), Error, 'validated like config.save');
  assert.equal(ctx.config.budget.stopAt, 0.8, 'a refused change leaves the file alone');
  await assert.rejects(set({ id: 'freno-uso', values: { timeoutMinutes: 5 } }), /no pertenece al raíl/, 'only the keys of that rail');
  await assert.rejects(set({ id: 'freno-uso', values: { language: 'en' } }), /no pertenece/);
  await assert.rejects(set({ id: 'freno-uso' }), /nada que cambiar/);
  for (const r of RAILS.filter((x) => x.fixed)) await assert.rejects(set({ id: r.id, enabled: false }), /es fijo/, r.id);
  await assert.rejects(set({ id: 'inventado', enabled: false }), /no existe/);
  await assert.rejects(set({ id: '__proto__', enabled: false }), /no existe/);
  for (const r of RAILS.filter((x) => x.fixed)) assert.equal(isRailOn(r.id), true);
  assert.ok(!Object.keys(ctx.config.rails).some((id) => !switchableIds().includes(id)));
  await set({ id: 'permiso-sin-respuesta', values: { approvalWaitMinutes: 3 } });
  assert.equal(ctx.config.approvalWaitMinutes, 3);
});

test('rails.restore: every switch on and every rail value as shipped', async () => {
  const f = async () => ({ unlock: await fresh('rails') });
  await call('rails.set', { id: 'publicar', enabled: false, ...(await f()) });
  await call('rails.set', { id: 'tiempo-maximo', enabled: false, values: { timeoutMinutes: 10 }, ...(await f()) });
  await call('rails.set', { id: 'rutas-protegidas', values: { protected: ['C:\\solo-esto'] }, ...(await f()) });
  assert.equal(ctx.config.timeoutMinutes, 10);
  const list = await call('rails.restore', await f());
  assert.ok(Object.values(ctx.config.rails).every((v) => v.enabled !== false), 'nothing paused');
  assert.ok(list.every((r) => r.activo));
  assert.equal(ctx.config.timeoutMinutes, DEFAULT_CONFIG.timeoutMinutes);
  assert.deepEqual(ctx.config.protected, DEFAULT_CONFIG.protected);
  assert.equal(ctx.config.budget.stopAt, DEFAULT_CONFIG.budget.stopAt);
  assert.equal(ctx.config.approvalWaitMinutes, DEFAULT_CONFIG.approvalWaitMinutes);
  assert.equal(ctx.config.language, 'es', 'settings that are not rails stay');
});

test('config.save with rails is the same door: password every time; the rest of config.save as before', async () => {
  const u = await normal();
  assert.equal(freshPurpose('config.save', { patch: { rails: {} } }), 'rails');
  assert.equal(freshPurpose('config.save', { patch: { userName: 'Ana' } }), null);
  assert.equal(needsUnlock('config.save', { patch: { userName: 'Ana' } }, ctx.config), false);
  const patch = { rails: { publicar: { enabled: false } } };
  await assert.rejects(call('config.save', { patch }), needPassword);
  await assert.rejects(call('config.save', { patch, unlock: u }), needPassword, 'the 5-minute unlock is not enough');
  await assert.rejects(call('config.save', { patch, unlock: await fresh('deleteProject') }), needPassword);
  await assert.rejects(call('config.save', { patch: { rails: {} }, unlock: u }), needPassword, 'not even an empty object');
  assert.equal(isRailOn('publicar'), true, 'nothing changed');
  const f = await fresh('rails');
  await call('config.save', { patch, unlock: f });
  assert.equal(isRailOn('publicar'), false);
  await assert.rejects(call('config.save', { patch, unlock: f }), needPassword, 'once');
  await call('config.save', { patch: { userName: 'Bea' } });
  assert.equal(ctx.config.userName, 'Bea');
  await call('rails.restore', { unlock: await fresh('rails') });
});

test('an agent or a linked device never reaches the window API', async () => {
  for (const who of [phone, browser]) for (const m of ['rails.set', 'rules.save']) await assert.rejects(api.call(m, {}, who), PermissionError);
  const agent = { channel: 'agent', agent: 'claude', task: 1 };
  for (const m of ['rails.set', 'rules.list', 'rails.list', 'rules.save']) await assert.rejects(api.call(m, {}, agent), PermissionError, m);
  await assert.rejects(api.call('rails.list', {}, null), PermissionError);
});

test('backup: core/normas travels in a copy and comes back with your rule and the changed shipped one', async () => {
  const u = await normal();
  const mine = (await call('rules.create', { titulo: 'Para la copia', para: 'ambos', texto: 'Texto de la copia', unlock: u })).after.id;
  await call('rules.save', { id: SEED, titulo: 'Cambiada', para: 'ambos', texto: 'Texto cambiado de serie', unlock: u });
  const secret = crypto.randomBytes(32);
  board.db.close();
  const { file } = await K.createBackup({ home: t.home, secret, version: 'test' });
  fs.rmSync(ruleFile(mine)); fs.writeFileSync(ruleFile(SEED), 'roto');
  await K.stageRestore(t.home, file, { secret });
  const r = K.applyPendingRestore(t.home);
  assert.ok(r.units.includes('core/normas'), 'the folder is a swap unit');
  assert.match(fs.readFileSync(ruleFile(mine), 'utf8'), /Texto de la copia/);
  assert.match(fs.readFileSync(ruleFile(SEED), 'utf8'), /Texto cambiado de serie/);
  board = new Board();
});
