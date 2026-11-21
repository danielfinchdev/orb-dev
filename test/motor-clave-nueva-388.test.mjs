// 3.8.8: «Empezar con una clave nueva» with the key opening fine (backup.newKey): this PC only, the master password every
// time (a token for this action alone), and it only writes the signal for the next start; no key is touched now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine } from './helpers.mjs';
import { paths } from '../src/platform/paths.mjs';
import { METHODS, REMOTE_METHODS, UNLOCK_METHODS, FRESH_UNLOCK, allowed, principalOf, needsUnlock, freshPurpose } from '../src/domain/security/permissions.mjs';

const PASSWORD = 'una frase larga de prueba';

test('backup.newKey: only this PC, never remote, always the master password', () => {
  assert.equal(METHODS['backup.newKey'], 'pc');
  assert.equal(REMOTE_METHODS.has('backup.newKey'), false);
  for (const kind of ['phone', 'browser']) assert.equal(allowed(principalOf({ device: { id: 'd', kind } }), 'backup.newKey'), false, kind);
  assert.ok(UNLOCK_METHODS.has('backup.newKey') && needsUnlock('backup.newKey', {}));
  assert.equal(FRESH_UNLOCK['backup.newKey'], 'newKey');
  assert.equal(freshPurpose('backup.newKey', {}), 'newKey');
});

test('backup.newKey: no unlock or another action\'s unlock fails; its own writes the signal once', async () => {
  const h = tempHome();
  const e = await startEngine(h.home);
  try {
    const signal = path.join(paths(h.home).data, 'clave-nueva.json');
    const back = path.join(paths(h.home).data, 'clave-volver.json');
    await assert.rejects(e.call('backup.newKey', {}), /Crea primero la contraseña maestra/);
    const { unlock } = await e.call('master.create', { password: PASSWORD });
    for (const params of [{}, { unlock: 'f'.repeat(48) }, { unlock }]) await assert.rejects(e.call('backup.newKey', params), /necesita tu contraseña maestra/);
    const other = (await e.call('master.unlock', { password: PASSWORD, purpose: 'deleteProject' })).unlock;
    await assert.rejects(e.call('backup.newKey', { unlock: other }), /necesita tu contraseña maestra/, 'another action\'s token is not valid');
    assert.ok(!fs.existsSync(signal), 'nothing written without the right token');
    // A way back that was waiting goes: the two signals never wait together.
    fs.writeFileSync(back, '{}');
    const fresh = (await e.call('master.unlock', { password: PASSWORD, purpose: 'newKey' })).unlock;
    await assert.rejects(e.call('master.check', { unlock: fresh }), /necesita tu contraseña maestra/, 'its token opens nothing else');
    assert.deepEqual(await e.call('backup.newKey', { unlock: fresh }), { restart: true });
    assert.ok(!Number.isNaN(Date.parse(JSON.parse(fs.readFileSync(signal, 'utf8')).at)));
    assert.ok(!fs.existsSync(back));
    await assert.rejects(e.call('backup.newKey', { unlock: fresh }), /necesita tu contraseña maestra/, 'one use');
  } finally { await e.stop(); h.cleanup(); }
});

test('backup.status says which key action waits for the next start (pendingKey); the last one asked wins', async () => {
  const h = tempHome();
  const e = await startEngine(h.home);
  try {
    const dir = paths(h.home).data;
    assert.equal((await e.call('backup.status')).pendingKey, null);
    fs.writeFileSync(path.join(dir, 'clave-nueva.json'), '{}');
    assert.equal((await e.call('backup.status')).pendingKey, 'nueva');
    fs.writeFileSync(path.join(dir, 'clave-volver.json'), '{}');
    assert.equal((await e.call('backup.status')).pendingKey, 'volver', 'the way back wins, as in the start (machine.rs)');
    fs.rmSync(path.join(dir, 'clave-volver.json'));
    fs.rmSync(path.join(dir, 'clave-nueva.json'));
    assert.equal((await e.call('backup.status')).pendingKey, null);
  } finally { await e.stop(); h.cleanup(); }
});

test('backup.previousKey removes a waiting new-key signal before writing its own (read as text: the engine\'s previousKey needs the app\'s vault)', () => {
  const src = fs.readFileSync(new URL('../src/engine/api/data.mjs', import.meta.url), 'utf8');
  const m = src.slice(src.indexOf("'backup.previousKey': () => {"), src.indexOf("'backup.newKey'"));
  assert.ok(m.indexOf('NEW_FILE') > 0 && m.indexOf('rmSync') < m.indexOf('writeFileSync'));
  assert.match(m, /fs\.rmSync\(path\.join\(dir, NEW_FILE\), \{ force: true \}\)/);
});

test('backup.cancelKey: this PC only, no password, removes whatever signal waits', async () => {
  assert.equal(METHODS['backup.cancelKey'], 'pc');
  assert.equal(REMOTE_METHODS.has('backup.cancelKey'), false);
  assert.equal(needsUnlock('backup.cancelKey', {}), false);
  for (const kind of ['phone', 'browser']) assert.equal(allowed(principalOf({ device: { id: 'd', kind } }), 'backup.cancelKey'), false, kind);
  const h = tempHome();
  const e = await startEngine(h.home);
  try {
    const dir = paths(h.home).data;
    for (const f of ['clave-nueva.json', 'clave-volver.json']) {
      fs.writeFileSync(path.join(dir, f), '{}');
      assert.equal((await e.call('backup.status')).pendingKey !== null, true);
      await e.call('backup.cancelKey');
      assert.equal((await e.call('backup.status')).pendingKey, null, f);
    }
    await e.call('backup.cancelKey'); // nothing waiting: no error
  } finally { await e.stop(); h.cleanup(); }
});
