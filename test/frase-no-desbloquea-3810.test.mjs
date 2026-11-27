// 3.8.10: a recovery phrase of the user's own (known only to the copies' wrap) is never a master password: unlocking with it
// is refused as wrong and no token of password strength comes out. Its rule: src-tauri/vault/src/code_ops.rs › unlock.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';

const PASS = 'una contraseña larga de prueba';
const PHRASE = 'mi frase propia de recuperacion';

test('a phrase of the user\'s own does not unlock as the master password', async () => {
  const t = tempHome({});
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex') });
  try {
    await e.call('master.create', { password: PASS });
    await e.call('backup.recovery', { code: PHRASE, password: PASS });
    for (const purpose of [undefined, 'approve.register']) {
      let r; try { r = await e.call('master.unlock', { code: PHRASE, ...(purpose ? { purpose } : {}) }); } catch (error) { r = { error: error.message }; }
      assert.equal(r.unlock, undefined, `no token (${purpose ?? 'window'})`);
      assert.equal(r.strength, undefined);
    }
  } finally { await e.stop(); t.cleanup?.(); }
});
