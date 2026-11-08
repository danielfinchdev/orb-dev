// 3.8.1: Orb's lock screen after a while without use (src/ui/lib/idle-lock.js, master.lock/master.state in
// src/engine/api-master.mjs, lib/startup.js), opening core's data only with the master password (desktop-home.mjs ›
// guardedCore, decision 19 f) and the owner's private folder kept from the agents (workspace-layout.mjs, decision 19 g).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { watchIdle, lockMinutesOf, DEFAULT_LOCK_MINUTES } from '../src/ui/lib/idle-lock.js';
import { startupPhase } from '../src/ui/lib/startup.js';
import { guardedCore } from '../src/engine/desktop-home.mjs';
import { guardOutside, privateDir } from '../src/engine/workspace-layout.mjs';
import { isOrbData, decide } from '../src/core/guard.mjs';
import { paths } from '../src/core/home.mjs';
import { ctx, saveConfig } from '../src/core/context.mjs';

test('sin usar Orb los minutos elegidos: se bloquea una vez; cualquier uso vuelve a contar desde cero', () => {
  let clock = 0; const listeners = {}; const docListeners = {};
  const target = { addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener: (e) => { delete listeners[e]; } };
  const doc = { visibilityState: 'visible', addEventListener: (e, f) => { docListeners[e] = f; }, removeEventListener: (e) => { delete docListeners[e]; } };
  let fired = 0;
  const realSet = globalThis.setInterval; const realClear = globalThis.clearInterval; let tick = null;
  globalThis.setInterval = (fn) => { tick = fn; return 1; }; globalThis.clearInterval = () => { tick = null; };
  try {
    const stop = watchIdle({ minutes: () => 15, onIdle: () => fired++, target, doc, now: () => clock });
    clock = 14 * 60_000; tick();
    assert.equal(fired, 0, 'aún no');
    listeners.pointermove(); clock += 14 * 60_000; tick();
    assert.equal(fired, 0, 'el ratón cuenta como uso');
    clock += 60_000; tick(); tick();
    assert.equal(fired, 1, 'a los 15 min sin usar, y solo una vez');
    listeners.keydown(); clock += 15 * 60_000; docListeners.visibilitychange();
    assert.equal(fired, 2, 'al volver a la ventana también se mira');
    stop();
    assert.equal(tick, null); assert.deepEqual(Object.keys(listeners), []);
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }
  assert.equal(lockMinutesOf({}), DEFAULT_LOCK_MINUTES);
  assert.equal(DEFAULT_LOCK_MINUTES, 15);
  assert.equal(lockMinutesOf({ ui: { lockMinutes: 30 } }), 30);
  assert.equal(lockMinutesOf({ ui: { lockMinutes: 'x' } }), 15);
});

test('la pantalla de bloqueo sigue tras recargar la ventana; los minutos se guardan en orb.json (15 por defecto)', async () => {
  const base = { 'app.coreState': null, 'app.migrationState': { failed: false }, 'app.layoutPlan': { pending: false }, 'app.state': { config: {} } };
  const engine = (answers) => async (method) => answers[method];
  assert.equal((await startupPhase(engine({ ...base, 'master.state': { exists: true, locked: false, lost: false, screenLocked: true } }))).phase, 'unlock');
  assert.equal((await startupPhase(engine({ ...base, 'master.state': { exists: true, locked: false, lost: false, screenLocked: false } }))).phase, 'app');
  const t = tempHome();
  try {
    assert.equal(ctx.config.ui.lockMinutes, 15);
    assert.equal(saveConfig({ ui: { lockMinutes: 60 } }).ui.lockMinutes, 60);
    assert.throws(() => saveConfig({ ui: { lockMinutes: 0 } }), /lockMinutes/);
  } finally { t.cleanup(); }
});

test('core: solo sus carpetas de herramientas se abren sin la contraseña maestra (sus datos, no)', () => {
  const t = tempHome();
  try {
    const p = paths(t.home);
    for (const d of [p.core, p.data, p.secrets, p.runs, path.join(p.data, 'otra')]) assert.equal(guardedCore(t.home, d), true, d);
    for (const d of [p.mcp, path.join(p.mcp, 'gmail'), p.skills, p.staging, p.tools, p.worktrees, path.join(p.core, 'bitacora'), t.home, path.join(t.home, 'web')]) assert.equal(guardedCore(t.home, d), false, d);
  } finally { t.cleanup(); }
});

test('la carpeta personal del dueño: ningún agente la lee ni la toca', () => {
  const t = tempHome();
  try {
    fs.mkdirSync(path.join(privateDir(t.home)), { recursive: true });
    fs.writeFileSync(path.join(privateDir(t.home), 'notas.md'), 'privado');
    guardOutside();
    const internal = paths(t.home).internal;
    const project = path.join(t.home, 'web', 'tienda'); fs.mkdirSync(project, { recursive: true });
    assert.equal(isOrbData(path.join(privateDir(t.home), 'notas.md'), internal, project, { read: true }), true, 'leer');
    assert.equal(isOrbData('..\\..\\personal\\notas.md', internal, project, { read: true }), true, 'por ruta relativa');
    assert.equal(isOrbData(path.join(t.home, 'personalidad', 'x.md'), internal, project, { read: true }), false, 'otra carpeta');
    const read = decide({ tool: 'Read', paths: [path.join(privateDir(t.home), 'notas.md')], cwd: project, permission: 'editar', internalDir: internal });
    assert.equal(read.decision, 'deny');
    const cmd = decide({ tool: 'Bash', command: `type "${path.join(privateDir(t.home), 'notas.md')}"`, cwd: project, permission: 'total', internalDir: internal });
    assert.notEqual(cmd.decision, 'allow', 'ni con permiso total');
    // Review final M3 (hardening): quotes, escapes and wildcards in the name are seen through.
    const home = t.home.replace(/\\/g, '/');
    for (const command of [`cat ${home}/pers''onal/notas.md`, `cat "${home}/pers"onal/notas.md`, 'cd ../.. && cat pers*/notas.md', `cat ${home}/p?rsonal/notas.md`, `type ${t.home}\\pers^onal\\notas.md`, `cat ${home}/*/notas.md`, 'cd ../.. && cat co*/datos/orb.db']) {
      assert.notEqual(decide({ tool: 'Bash', command, cwd: project, permission: 'total', internalDir: internal }).decision, 'allow', command);
    }
    for (const command of ['cat src/*.js', 'ls *.md', 'cat ../tienda/pers*.txt']) {
      assert.equal(decide({ tool: 'Bash', command, cwd: project, permission: 'total', internalDir: internal }).decision, 'allow', command);
    }
  } finally { t.cleanup(); }
});
