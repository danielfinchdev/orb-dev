// 3.8.4 rails: each switchable rail, paused, lifts only its own block; the core ones cannot be paused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/platform/context.mjs';
import { decide } from '../src/domain/security/guard.mjs';
import { deletionHold } from '../src/engine/scheduler/safety.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { recordRate, canLaunch, usageBrake } from '../src/domain/usage/budget.mjs';
import { fixRoundGate } from '../src/domain/tasks/rounds.mjs';
import { RAILS, isRailOn, railList, switchableIds, approvalWaitMinutes, taskTimeoutMinutes, parallelLimits } from '../src/domain/rules/rails.mjs';
import { saveConfig, validateConfig } from '../src/platform/config.mjs';
import { configFrom } from '../src/platform/config-file.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';

const t = tempHome();
let proj; let internal; let outside; let oldTemp; let oldTmp;
before(() => {
  // the system temp folder counts as the project, so it points to a folder of its own here
  oldTemp = process.env.TEMP; oldTmp = process.env.TMP; process.env.TEMP = process.env.TMP = path.join(t.base, 'tmp');
  fs.mkdirSync(process.env.TEMP, { recursive: true });
  proj = path.join(t.base, 'proyectos', 'web'); internal = path.join(t.base, 'Orb', 'core'); outside = path.join(t.base, 'otro');
  for (const d of [proj, path.join(internal, 'datos'), outside]) fs.mkdirSync(d, { recursive: true });
});
after(() => {
  for (const [k, v] of [['TEMP', oldTemp], ['TMP', oldTmp]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.cleanup();
});
const pause = (...ids) => { ctx.config.rails = Object.fromEntries(ids.map((id) => [id, { enabled: false }])); };
const reset = () => { ctx.config.rails = {}; };
const sh = (permission, command, extra = {}) => decide({ permission, tool: 'Bash', command, internalDir: internal, cwd: proj, projectDir: proj, ...extra });
const verdict = (permission, command, extra) => sh(permission, command, extra).decision;

// [rail, command, verdict with the rail on / paused, per permission level]
const TABLE = [
  ['publicar', 'git push origin main', { auto: ['ask', 'allow'], editar: ['ask', 'ask'], preguntar: ['ask', 'ask'] }],
  ['borrar-carpetas', 'rm -rf build', { auto: ['allow', 'allow'], editar: ['ask', 'ask'], preguntar: ['ask', 'ask'] }],
  ['reescribir-git', 'git reset --hard HEAD~1', { auto: ['allow', 'allow'], editar: ['ask', 'ask'], preguntar: ['ask', 'ask'] }],
  ['formatear-disco', 'format d:', { auto: ['deny', 'ask'], editar: ['ask', 'ask'], preguntar: ['ask', 'ask'] }],
  ['usar-adb', 'adb devices', { auto: ['deny', 'allow'], editar: ['deny', 'allow'], preguntar: ['deny', 'ask'] }],
];
for (const [rail, command, per] of TABLE) {
  test(`rail ${rail}: paused lifts only its own block`, () => {
    for (const [mode, [on, off]] of Object.entries(per)) {
      reset(); assert.equal(verdict(mode, command), on, `${mode} on`);
      pause(rail); assert.equal(verdict(mode, command), off, `${mode} paused`);
    }
    reset();
  });
}

test('reescribir-git paused: git clean -x still asks in Auto (ignored files are not in the checkpoint)', () => {
  for (const cmd of ['git clean -fdx', 'git clean -xfd']) {
    reset(); assert.equal(verdict('auto', cmd), 'ask', cmd + ' on');
    pause('reescribir-git'); assert.equal(verdict('auto', cmd), 'ask', cmd + ' paused');
  }
  reset();
});

test('rutas-protegidas paused: the owner list opens, the password vaults stay closed', () => {
  const saved = ctx.config.protected;
  ctx.config.protected = ['bitwarden', 'mis-secretos'];
  try {
    for (const mode of ['auto', 'preguntar']) {
      reset(); assert.equal(verdict(mode, 'ls mis-secretos'), 'deny', mode + ' on');
      pause('rutas-protegidas');
      assert.equal(verdict(mode, 'ls mis-secretos'), mode === 'auto' ? 'allow' : 'ask', mode + ' owner entry paused');
      assert.equal(verdict(mode, 'Get-Content C:\\Users\\x\\Documents\\claves.kdbx'), 'deny', mode + ' kdbx');
      assert.equal(verdict(mode, 'ls bitwarden'), 'deny', mode + ' default entry');
    }
    const read = decide({ permission: 'auto', tool: 'Read', kind: 'read', paths: ['C:\\Users\\x\\Documents\\claves.kdbx'], internalDir: internal, cwd: proj, projectDir: proj });
    assert.equal(read.decision, 'deny');
  } finally { ctx.config.protected = saved; reset(); }
});

test('paused risk rails change nothing in probar, leer or total; formatear-disco never drops below asking', () => {
  const cases = [['publicar', 'git push origin main'], ['borrar-carpetas', 'rm -rf build'], ['reescribir-git', 'git reset --hard HEAD~1'], ['formatear-disco', 'format d:']];
  for (const [rail, cmd] of cases) {
    for (const mode of ['probar', 'leer', 'total']) {
      reset(); const on = sh(mode, cmd);
      pause(rail); assert.deepEqual(sh(mode, cmd), on, rail + ' ' + mode);
    }
  }
  pause('formatear-disco');
  assert.equal(verdict('total', 'format d:'), 'ask');
  assert.equal(verdict('auto', 'format d:'), 'ask');
  assert.equal(verdict('preguntar', 'format d:'), 'ask');
  reset();
});

test('publicar paused: Auto publishes, Preguntar still asks, other risks keep asking', () => {
  pause('publicar');
  assert.equal(verdict('auto', 'git push origin main'), 'allow');
  assert.equal(verdict('preguntar', 'git push origin main'), 'ask');
  assert.equal(verdict('auto', 'curl -X POST https://example.com -d x'), 'ask', 'sendData has no rail');
  reset();
});

test('a paused rail does not lift the others', () => {
  pause('publicar', 'usar-adb');
  assert.equal(verdict('auto', 'format d:'), 'deny');
  assert.equal(verdict('auto', 'ls bitwarden'), 'deny');
  assert.equal(verdict('auto', 'git push origin main'), 'allow');
  assert.equal(verdict('auto', 'adb devices'), 'allow');
  reset();
});

test('fuera-del-proyecto: paused stops asking about writes outside, folder deletes still stay inside the project', () => {
  const file = path.join(outside, 'a.txt');
  const edit = (mode) => decide({ permission: mode, tool: 'Write', kind: 'edit', paths: [file], internalDir: internal, cwd: proj, projectDir: proj }).decision;
  reset();
  assert.equal(edit('auto'), 'ask'); assert.equal(edit('preguntar'), 'ask');
  assert.equal(verdict('auto', `echo x > "${file}"`), 'ask');
  pause('fuera-del-proyecto');
  assert.equal(edit('auto'), 'allow'); assert.equal(edit('preguntar'), 'allow');
  assert.equal(verdict('auto', `echo x > "${file}"`), 'allow');
  assert.equal(verdict('auto', `rm -rf "${outside}"`), 'ask', 'deleting a folder outside still asks in Auto');
  reset();
});

test('borrado-masivo: deletionHold', () => {
  const many = Array.from({ length: 60 }, (_, i) => `src/f${i}.js`);
  assert.equal(deletionHold(many, 100, 'auto').held, true);
  assert.equal(deletionHold(many, 100, 'preguntar').held, true);
  pause('borrado-masivo');
  assert.equal(deletionHold(many, 100, 'auto').held, false);
  assert.equal(deletionHold(many, 100, 'preguntar').held, false);
  assert.equal(deletionHold(many, 100, 'auto').deleted, 60);
  reset();
});

test('approval wait and task timeout: paused = no limit, the stored values are untouched', () => {
  ctx.config.approvalWaitMinutes = 7; ctx.config.timeoutMinutes = 30;
  assert.equal(approvalWaitMinutes(), 7); assert.equal(taskTimeoutMinutes(), 30);
  pause('permiso-sin-respuesta', 'tiempo-maximo');
  assert.equal(approvalWaitMinutes(), 0); assert.equal(taskTimeoutMinutes(), 0);
  assert.equal(ctx.config.approvalWaitMinutes, 7);
  reset(); ctx.config.approvalWaitMinutes = 10; ctx.config.timeoutMinutes = 60;
});

test('tareas-a-la-vez: paused removes maxParallel, perAgent and oneAtATime', () => {
  ctx.config.maxParallel = 2; ctx.config.perAgent = 1; ctx.config.oneAtATime = true;
  assert.deepEqual(parallelLimits(), { oneAtATime: true, maxParallel: 2, perAgent: 1 });
  pause('tareas-a-la-vez');
  assert.deepEqual(parallelLimits(), { oneAtATime: false, maxParallel: Infinity, perAgent: Infinity });
  reset(); ctx.config.oneAtATime = false; ctx.config.maxParallel = 3;
});

const hour = 3_600_000;
const clean = (board) => { board.settingJson('rate:claude', null); board.settingJson('rates:claude', null); return board; };
const rate = (board, window, utilization) => recordRate(board, 'claude', { utilization, resetAt: Date.now() + 40 * hour, window, status: 'allowed' });

test('freno-uso and freno-semanal are independent', () => {
  const b = clean(new Board()); rate(b, 'five_hour', 0.95); rate(b, 'seven_day', 0.9);
  reset(); assert.equal(canLaunch(b, 'claude', null).ok, false);
  pause('freno-uso'); assert.equal(usageBrake(b, 'claude')?.ok, false, 'weekly still stops');
  pause('freno-semanal'); assert.equal(usageBrake(b, 'claude')?.ok, false, 'the 5-hour brake still stops');
  pause('freno-uso', 'freno-semanal'); assert.equal(usageBrake(b, 'claude'), null); assert.equal(canLaunch(b, 'claude', null).ok, true);
  reset();
});

test('tope-5h: paused skips the launch counts only, not the real usage brake', () => {
  const b = clean(new Board());
  const saved = ctx.config.budget.agents.claude; ctx.config.budget.agents.claude = { maxTasks: 0, maxHeavy: 0 };
  try {
    reset(); assert.equal(canLaunch(b, 'claude', null).ok, false, 'the cap stops it');
    pause('tope-5h'); assert.equal(canLaunch(b, 'claude', null).ok, true);
    rate(b, 'five_hour', 0.99); assert.equal(canLaunch(b, 'claude', null).ok, false, 'real usage still stops');
  } finally { ctx.config.budget.agents.claude = saved; reset(); clean(b); }
});

test('rondas-correccion: the gate applies only while the rail is on', () => {
  const board = clean(new Board());
  const cfg = { budget: { maxFixRounds: 0 } };
  const conv = board.createConversation({ title: 'Web' }).id;
  board.addChat('usuario', 'pide', null, conv);
  reset(); assert.equal(fixRoundGate(board, conv, cfg).max, 0);
  pause('rondas-correccion');
  const g = fixRoundGate(board, conv, cfg); assert.equal(g.allowed, true); assert.equal(g.rounds, 0);
  reset();
});

test('core rails: written by hand as disabled, they stay on and decide keeps denying', () => {
  ctx.config.rails = { core: { enabled: false }, privilegios: { enabled: false }, credenciales: { enabled: false }, 'secretos-registros': { enabled: false } };
  for (const r of RAILS.filter((x) => x.fixed)) assert.equal(isRailOn(r.id), true, r.id);
  assert.equal(isRailOn('desconocido'), true);
  for (const mode of ['auto', 'preguntar', 'total']) {
    assert.equal(verdict(mode, `cat "${path.join(internal, 'datos', 'orb.db')}"`), 'deny', `core ${mode}`);
    assert.equal(verdict(mode, 'sudo rm x'), 'deny', `sudo ${mode}`);
    assert.equal(verdict(mode, 'cmdkey /list'), 'deny', `credential store ${mode}`);
  }
  assert.equal(railList().filter((r) => r.fijo && !r.activo).length, 0);
  reset();
});

test('saveConfig: core and unknown rails are rejected, switchable ones toggle back on', () => {
  for (const id of ['core', 'privilegios', 'credenciales', 'secretos-registros', 'inventado']) assert.throws(() => saveConfig({ rails: { [id]: { enabled: false } } }), undefined, id);
  assert.throws(() => saveConfig({ rails: { publicar: { enabled: 'no' } } }));
  assert.throws(() => saveConfig({ rails: { publicar: true } }));
  saveConfig({ rails: { publicar: { enabled: false } } });
  assert.equal(isRailOn('publicar'), false);
  saveConfig({ rails: { publicar: { enabled: true } } });
  assert.equal(isRailOn('publicar'), true);
  // a hand-written core entry does not block saving other settings
  ctx.config.rails = { core: { enabled: false } };
  saveConfig({ maxParallel: 3 });
  assert.equal(ctx.config.rails.core, undefined);
  reset();
});

test('validateConfig: weeklyStopAt and maxFixRounds', () => {
  const ok = structuredClone(ctx.config);
  const withBudget = (b) => ({ ...structuredClone(ok), budget: { ...ok.budget, ...b } });
  assert.equal(validateConfig(ok), true);
  for (const v of [0.4, 1.1]) assert.throws(() => validateConfig(withBudget({ weeklyStopAt: v })), /50/);
  for (const v of [-1, 11, 1.5]) assert.throws(() => validateConfig(withBudget({ maxFixRounds: v })));
  assert.equal(validateConfig(withBudget({ weeklyStopAt: 0.5, maxFixRounds: 10 })), true);
  assert.equal(validateConfig(withBudget({ weeklyStopAt: 1, maxFixRounds: 0 })), true);
});

test('railList: 4 fixed and 16 switchable, with values and texts in es and en', () => {
  const list = railList('es');
  assert.equal(list.length, 20); assert.equal(list.filter((r) => r.fijo).length, 4); assert.equal(switchableIds().length, 16);
  assert.deepEqual(list.filter((r) => r.fijo).map((r) => r.id), ['core', 'privilegios', 'credenciales', 'secretos-registros']);
  for (const lang of ['es', 'en']) {
    for (const r of railList(lang)) {
      assert.ok(r.titulo && !r.titulo.startsWith('rails.'), `${lang} ${r.id}`);
      assert.ok(r.descripcion && !r.descripcion.startsWith('rails.'), `${lang} ${r.id} desc`);
    }
  }
  assert.equal(list.find((r) => r.id === 'freno-uso').valores['budget.stopAt'], 0.92);
  assert.deepEqual(Object.keys(list.find((r) => r.id === 'tareas-a-la-vez').valores), ['maxParallel', 'perAgent', 'oneAtATime']);
  pause('publicar'); assert.equal(railList().find((r) => r.id === 'publicar').activo, false); reset();
  assert.deepEqual([...new Set(list.map((r) => r.grupo))].sort(), ['orb', 'subagentes']);
});

test('an old orb.json without rails loads with the defaults', () => {
  const c = configFrom({ version: 5, assistantName: 'Orbe', budget: { stopAt: 0.9 } });
  assert.deepEqual(c.rails, {}); assert.equal(c.budget.stopAt, 0.9); assert.equal(c.budget.weeklyStopAt, 0.85); assert.equal(c.budget.maxFixRounds, 2);
  const prev = ctx.config; ctx.config = c;
  try { assert.equal(RAILS.every((r) => isRailOn(r.id)), true); } finally { ctx.config = prev; }
});

test('tiempo-maximo paused: the live view carries no timeout instead of 0', () => {
  const stub = { running: new Map([['t1', { agent: 'claude', account: 'a', sessionId: 's' }]]), sessions: { live: () => ({ lastAt: Date.now() }) }, board: { task: () => null, settingJson: () => null } };
  ctx.config.timeoutMinutes = 30;
  assert.equal(Scheduler.prototype.live.call(stub)[0].timeoutMin, 30);
  pause('tiempo-maximo');
  assert.equal(Scheduler.prototype.live.call(stub)[0].timeoutMin, null);
  reset(); ctx.config.timeoutMinutes = 60;
});

test('saveConfig: values left in orb.json by 3.8.3 or by hand do not block saving something else', () => {
  const keep = structuredClone(ctx.config);
  try {
    for (const legacy of [{ budget: { ...keep.budget, maxFixRounds: 15 } }, { budget: { ...keep.budget, maxFixRounds: '3' } }, { rails: null }, { rails: { publicar: false, core: { enabled: false }, 'freno-uso': { enabled: false } } }]) {
      ctx.config = { ...structuredClone(keep), ...legacy };
      assert.doesNotThrow(() => saveConfig({ userName: 'Ana' }), JSON.stringify(legacy));
      assert.equal(ctx.config.userName, 'Ana');
      assert.ok(ctx.config.rails === undefined || (ctx.config.rails && !('publicar' in ctx.config.rails) && !('core' in ctx.config.rails)));
    }
    ctx.config = { ...structuredClone(keep), budget: { ...keep.budget, maxFixRounds: '3' } };
    saveConfig({ userName: 'Ana' });
    assert.equal(ctx.config.budget.maxFixRounds, 3);
    ctx.config = { ...structuredClone(keep), rails: { 'freno-uso': { enabled: false } } };
    saveConfig({ userName: 'Ana' });
    assert.equal(isRailOn('freno-uso'), false, 'a valid paused rail is kept');
    // what the patch brings is still validated strictly
    ctx.config = { ...structuredClone(keep), budget: { ...keep.budget, maxFixRounds: 15 } };
    assert.throws(() => saveConfig({ budget: { maxFixRounds: 15 } }));
    assert.throws(() => saveConfig({ rails: { publicar: false } }));
    assert.throws(() => saveConfig({ rails: null }));
  } finally { ctx.config = keep; }
});
