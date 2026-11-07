// 3.8 (F5b): which screen the PC's window opens on (src/ui/lib/startup.js, used by main.jsx › Root), asked to a real
// engine: a welcome closed halfway goes on where it stopped (never with the words of an Orb updated from 3.7, and still
// through «Preparando tu PC»), an Orb that already was there makes its master password, and then Orb opens. The blocked
// engine (data of 3.7 not updated) is in migracion-38.test.mjs (M2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';
import { startupPhase } from '../src/ui/lib/startup.js';

const PASS = 'una contraseña larga de prueba';

test('el orden de las preguntas: core, migración, contraseña, bienvenida a medias, carpetas; el móvil abre Orb', async () => {
  const asked = [];
  const engine = (answers) => async (method) => { asked.push(method); if (!(method in answers)) throw new Error(`no se preguntó: ${method}`); return answers[method]; };
  assert.deepEqual(await startupPhase(engine({}), { mobile: true }), { phase: 'app' });
  assert.deepEqual(asked, [], 'el móvil no pregunta nada de esto');
  const core = { missing: true, reason: 'gone' };
  assert.deepEqual(await startupPhase(engine({ 'app.coreState': core })), { phase: 'core', data: core });
  // A blocked engine answers only these two: the window reaches its screen.
  const failed = { failed: true, reason: 'x' };
  assert.deepEqual(await startupPhase(engine({ 'app.coreState': null, 'app.migrationState': failed })), { phase: 'migration', data: failed });
  const base = { 'app.coreState': null, 'app.migrationState': { failed: false }, 'app.layoutPlan': { pending: false }, 'app.state': { config: {} } };
  const locked = { exists: true, locked: true, lost: false };
  assert.equal((await startupPhase(engine({ ...base, 'master.state': locked }))).phase, 'unlock');
  assert.equal((await startupPhase(engine({ ...base, 'master.state': { exists: true, locked: false, lost: true } }))).phase, 'unlock');
  const open = { exists: true, locked: false, lost: false };
  assert.deepEqual(await startupPhase(engine({ ...base, 'master.state': open, 'app.layoutPlan': { pending: true, items: [] } })), { phase: 'layout', data: { pending: true, items: [] } });
  // A welcome left halfway: the folders first, then the password, then «Preparando tu PC».
  const pending = { ...base, 'app.state': { config: { setupPending: true, assistantName: 'Orbe' } } };
  const plan = { pending: true, items: [] };
  assert.deepEqual((await startupPhase(engine({ ...pending, 'master.state': { exists: false }, 'app.layoutPlan': plan }))).data, { step: 'carpetas', plan, name: 'Orbe' });
  assert.equal((await startupPhase(engine({ ...pending, 'master.state': { exists: false } }))).data.step, 'maestra');
  assert.equal((await startupPhase(engine({ ...pending, 'master.state': open }))).data.step, 'equipo');
  assert.equal((await startupPhase(engine({ ...pending, 'master.state': locked }))).phase, 'unlock', 'con la contraseña ya hecha y cerrada, primero se abre');
});

test('con el motor de verdad: la bienvenida cerrada a medias sigue donde iba y termina en Orb', async () => {
  const t = tempHome();
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex') });
  const call = (method, params) => e.call(method, params);
  try {
    // An Orb that was already there (no welcome pending) and not from 3.7: the password, without «actualizado».
    let start = await startupPhase(call);
    assert.equal(start.phase, 'master');
    assert.equal(start.data.upgraded, false);
    // The welcome made the folder (views/setup.jsx › create) and Orb was closed at the password.
    await call('config.save', { patch: { setupPending: true } });
    start = await startupPhase(call);
    assert.equal(start.phase, 'setup');
    assert.equal(start.data.step, 'maestra');
    // Closed again at «Preparando tu PC»: the agents are still installed.
    await call('master.create', { password: PASS });
    start = await startupPhase(call);
    assert.deepEqual([start.phase, start.data.step], ['setup', 'equipo']);
    // «Continuar»: over.
    await call('config.save', { patch: { setupPending: false } });
    assert.deepEqual(await startupPhase(call), { phase: 'app' });
    await assert.rejects(call('config.save', { patch: { setupPending: 'sí' } }), /setupPending/);
  } finally { await e.stop(); t.cleanup(); }
});
