// 3.8.8: the lock screen's subtitle needs the truth (master.state › lockedAt / lockReason, only while the screen is locked)
// and a wrong try says how long the wait will be once the free tries are gone (nextWait, from the vault's own table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, startEngine, wait } from './helpers.mjs';
import { refused } from '../src/engine/api/master.mjs';
import { REMOTE_METHODS } from '../src/domain/security/permissions.mjs';

const PASS = 'una frase larga de prueba';

test('master.state tells when and why the screen locked, only while it is locked', async () => {
  const t = tempHome();
  let e = await startEngine(t.home);
  try {
    await e.call('master.create', { password: PASS });
    const open = await e.call('master.state');
    assert.equal(open.screenLocked, false);
    assert.ok(!('lockedAt' in open) && !('lockReason' in open), 'nothing about a lock that is not there');

    const before = Date.now();
    await e.call('master.lock', { reason: 'idle' });
    const idle = await e.call('master.state');
    assert.equal(idle.screenLocked, true);
    assert.equal(idle.lockReason, 'idle');
    assert.ok(Date.parse(idle.lockedAt) >= before - 1000 && Date.parse(idle.lockedAt) <= Date.now() + 1000, 'the real time of the lock');

    // A second lock while the screen is up (Windows locks over it) does not rewrite when or why.
    await wait(30);
    await e.call('master.lock', { reason: 'windows' });
    const again = await e.call('master.state');
    assert.equal(again.lockedAt, idle.lockedAt);
    assert.equal(again.lockReason, 'idle');

    await e.call('master.unlock', { password: PASS });
    const unlocked = await e.call('master.state');
    assert.equal(unlocked.screenLocked, false);
    assert.ok(!('lockedAt' in unlocked) && !('lockReason' in unlocked));

    for (const [reason, want] of [['hand', 'manual'], ['windows', 'windows'], ['sleep', 'sleep'], [undefined, null], ['nonsense', null], ['__proto__', null], ['toString', null]]) {
      await e.call('master.lock', reason === undefined ? {} : { reason });
      const s = await e.call('master.state');
      assert.equal(s.lockReason, want, String(reason));
      assert.ok(Date.parse(s.lockedAt) > 0, 'the hour is known even when the reason is not');
      await e.call('master.unlock', { password: PASS });
    }

    // An engine restarted under the lock screen knows neither: the window falls back to the plain subtitle.
    await e.stop();
    e = await startEngine(t.home, { screenLocked: true });
    const restarted = await e.call('master.state');
    assert.equal(restarted.screenLocked, true);
    assert.equal(restarted.lockedAt, null);
    assert.equal(restarted.lockReason, null);
  } finally { await e.stop(); t.cleanup(); }
});

test('master.state is this PC window only: the phone never gets the lock reason or hour', () => {
  assert.equal(REMOTE_METHODS.has('master.state'), false);
});

test('a wrong password says how many tries are left before the wait, and how long it is', () => {
  const t = tempHome();
  try {
    const msg = (r, o) => refused({ ok: false, reason: 'wrong', ...r }, o);
    assert.equal(msg({ left: 4, nextWait: 30 }).message, 'Contraseña incorrecta. Te quedan 4 intentos antes de esperar 30 segundos.');
    assert.equal(msg({ left: 1, nextWait: 30 }).message, 'Contraseña incorrecta. Te queda 1 intento antes de esperar 30 segundos.');
    assert.equal(msg({ left: 3, nextWait: 60 }).message, 'Contraseña incorrecta. Te quedan 3 intentos antes de esperar 1 minuto.');
    assert.equal(msg({ left: 3, nextWait: 120 }).message, 'Contraseña incorrecta. Te quedan 3 intentos antes de esperar 2 minutos.');
    assert.equal(msg({ left: 2, nextWait: 30 }, { code: true }).message, 'Código de recuperación incorrecto. Te quedan 2 intentos antes de esperar 30 segundos.');
    assert.equal(msg({ left: 1, nextWait: 30 }, { code: true }).message, 'Código de recuperación incorrecto. Te queda 1 intento antes de esperar 30 segundos.');
    const err = msg({ left: 4, nextWait: 30 });
    assert.deepEqual([err.reason, err.left, err.nextWait], ['wrong', 4, 30]);
    // An older vault says no nextWait: the words of before.
    assert.equal(msg({ left: 4 }).message, 'Contraseña incorrecta. Te quedan 4 intentos.');
    assert.equal(msg({ left: 1 }).message, 'Contraseña incorrecta. Te queda 1 intento.');
    assert.equal(msg({ left: 4 }, { code: true }).message, 'Código de recuperación incorrecto. Te quedan 4 intentos.');
    assert.equal(msg({ left: 4 }).nextWait, undefined);
  } finally { t.cleanup(); }
});

test('the real vault sends nextWait with a wrong try, and the engine puts it in the error', async () => {
  const t = tempHome();
  const e = await startEngine(t.home);
  try {
    await e.call('master.create', { password: PASS });
    await assert.rejects(e.call('master.unlock', { password: 'otra frase distinta' }), /Te quedan 4 intentos antes de esperar 30 segundos\./);
  } finally { await e.stop(); t.cleanup(); }
});
