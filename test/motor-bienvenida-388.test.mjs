// 3.8.8: the welcome's password step gives the recovery code right after creating the password: master.create hands the unlock
// that backup.recovery needs, and from then on «He olvidado la contraseña» can keep the secrets (canForget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';

test('a new home: master.create → backup.recovery with its unlock → canForget', async () => {
  const t = tempHome();
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex') });
  try {
    assert.equal((await e.call('backup.status')).recovery, false, 'no recovery code yet');
    assert.equal((await e.call('master.state')).canForget, false);
    const made = await e.call('master.create', { password: 'una frase larga de prueba' });
    assert.match(made.unlock, /^[0-9a-f]{48}$/);
    const r = await e.call('backup.recovery', { password: 'una frase larga de prueba' });
    assert.equal(typeof r.code, 'string');
    assert.ok(r.code.length >= 12);
    assert.equal((await e.call('master.state')).canForget, true, 'with the code the secrets can be kept after a forgotten password');
    assert.equal((await e.call('backup.status')).recovery, true);
  } finally { await e.stop(); t.cleanup?.(); }
});
