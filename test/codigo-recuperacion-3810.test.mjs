// 3.8.10, step 7 H3: the generated recovery code also opens the data key (maestra-codigo.json, in the vault). A clean PC with a
// copy and the code gets the secrets, a phrase of the user's own never opens the vault, backup.recovery proves the password or the
// code in the vault (a token is no proof), regenerating can make a new data key, a restore never brings old wraps back
// without proof, and nothing of the code leaks. Its rules in Rust: src-tauri/vault/src/code_ops.rs.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';
import { Master, FILES, KEPT, adoptStaged, keyIdOf, restoreMissing } from '../src/domain/security/master.mjs';
import { normalizeCode } from '../src/domain/security/recovery-code.mjs';
import * as K from '../src/domain/data/backup.mjs';

const PASS = 'una contraseña larga de prueba';
const GITHUB = { name: 'github', command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' } };
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const secretsOf = (home) => path.join(home, 'core', 'secretos');
const scan = (dir) => [...K.walkFiles(dir)].map((f) => { try { return fs.readFileSync(f, 'latin1'); } catch { return ''; } }).join('\n');

test('the normalization vectors give the same result as the vault', () => {
  const v = JSON.parse(fs.readFileSync(new URL('./fixtures/recovery-code-vectors.json', import.meta.url), 'utf8'));
  assert.ok(v.cases.length > 10);
  for (const c of v.cases) {
    assert.equal(normalizeCode(c.in), c.out, JSON.stringify(c.in));
    assert.equal(K.normalizePassphrase(c.in), c.out);
    assert.equal(/^[A-Z2-9]{32}$/.test(c.out), c.generated, JSON.stringify(c.in));
  }
});

test('a clean PC with the copy and the code gets the secrets; a phrase never opens the vault; the copy needs no wrap of the old PC', async () => {
  const t = tempHome({ mcpServers: [GITHUB] });
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex') });
  let made; let code;
  try {
    await e.call('master.create', { password: PASS });
    ({ code } = await e.call('backup.recovery', { password: PASS }));
    assert.match(code, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    assert.equal((await e.call('master.state')).hasCode, true);
    made = await e.call('backup.now', {});
    const live = read(secretsOf(t.home), FILES.code);
    assert.equal(live.keyId, read(secretsOf(t.home), FILES.master).keyId);
    assert.ok(live.kdf.N >= read(secretsOf(t.home), FILES.master).kdf.N, 'never cheaper than the password wrap');
  } finally { await e.stop(); }
  // A clean PC: another machine's secret, nothing of this PC's wrap.
  const pcB = crypto.randomBytes(32);
  const into = path.join(t.base, 'otro-pc');
  const adopt = (dir, c) => adoptStaged(dir, c, pcB);
  await K.restoreInto(into, made.path, { passphrase: code.toLowerCase(), secret: crypto.randomBytes(32), adopt });
  const dir = secretsOf(into);
  assert.ok(fs.existsSync(path.join(dir, FILES.code)), 'a code wrap written again for the restored key');
  const b = new Master(dir, { secret: pcB });
  try {
    assert.equal(b.openWithMachine(), true, 'this PC wraps the data key for itself');
    assert.equal(b.get('mcp/github/GITHUB_TOKEN'), 'ghp_DE_PRUEBA_123', 'the secrets came with the copy');
  } finally { b.close(); }
  const c = new Master(dir, { secret: crypto.randomBytes(32) });
  try {
    assert.equal(c.openWithMachine(), false, 'another PC again: closed');
    const copy = K.recoveryFile(into);
    const r = await c.unlockWithCode('una frase que no es el codigo de nada', copy);
    assert.equal(r.reason, 'wrong');
    assert.equal(c.unlocked(), false, 'a phrase does not open the vault');
    assert.equal((await c.unlockWithCode(code, copy)).ok, true);
    assert.equal(c.get('mcp/github/GITHUB_TOKEN'), 'ghp_DE_PRUEBA_123');
  } finally { c.close(); }
  // A phrase of the user's own: the copies take it, the vault never does.
  const t2 = tempHome({ mcpServers: [GITHUB] });
  const e2 = await startEngine(t2.home, { secret: crypto.randomBytes(32).toString('hex') });
  let made2;
  try {
    await e2.call('master.create', { password: PASS });
    const phrase = 'mi frase propia de recuperacion';
    const r = await e2.call('backup.recovery', { code: phrase, password: PASS });
    assert.equal(r.code, null);
    assert.equal((await e2.call('master.state')).hasCode, false);
    assert.equal(fs.existsSync(path.join(secretsOf(t2.home), FILES.code)), false);
    made2 = await e2.call('backup.now', {});
  } finally { await e2.stop(); }
  const into2 = path.join(t.base, 'otro-pc-2');
  await K.restoreInto(into2, made2.path, { passphrase: 'mi frase propia de recuperacion', secret: crypto.randomBytes(32), adopt: (d, cc) => adoptStaged(d, cc, pcB) });
  assert.equal(fs.existsSync(path.join(secretsOf(into2), FILES.code)), false);
  const p = new Master(secretsOf(into2), { secret: pcB });
  try {
    assert.equal(p.openWithMachine(), false, 'a phrase gives no wrap for this PC');
    assert.equal((await p.verify(PASS)).ok, true, 'the password still opens it');
  } finally { p.close(); }
  t.cleanup(); t2.cleanup();
});

test('backup.recovery needs the password or the current code, proved in the vault; regenerating can change the data key', async () => {
  const t = tempHome({ mcpServers: [GITHUB] });
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex') });
  const dir = secretsOf(t.home);
  try {
    const { unlock } = await e.call('master.create', { password: PASS });
    await assert.rejects(e.call('backup.recovery', { unlock }), /contraseña maestra o el código/, 'a token alone is rejected');
    await assert.rejects(e.call('backup.recovery', {}), /contraseña maestra o el código/);
    await assert.rejects(e.call('backup.recovery', { password: 'otra que no es' }), /incorrecta/);
    const first = await e.call('backup.recovery', { password: PASS });
    assert.equal(first.rekeyed, false, 'the first code leaves the data key as it is');
    assert.equal(first.warn, undefined);
    const key1 = read(dir, FILES.master).keyId;
    // regenerate with the current code (no new data key: that needs the password)
    await assert.rejects(e.call('backup.recovery', { current: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH', rekey: false }), /Código de recuperación incorrecto/);
    await assert.rejects(e.call('backup.recovery', { current: first.code, rekey: true }), /Cambiar también la clave de datos necesita la contraseña/);
    const second = await e.call('backup.recovery', { current: first.code, rekey: false });
    assert.equal(second.rekeyed, false);
    assert.match(second.warn, /cualquier copia hecha antes sigue llevando la envoltura vieja/, 'the unticked box is told what it leaves');
    assert.equal(read(dir, FILES.master).keyId, key1);
    const copyBefore = path.join(t.base, 'antes.orbbak'); // kept apart: a new copy of the day prunes the older one
    fs.copyFileSync((await e.call('backup.now', {})).path, copyBefore);
    // regenerate with the password: ticked by default → a new data key, the old code and the old copies open nothing of it
    const third = await e.call('backup.recovery', { password: PASS });
    assert.equal(third.rekeyed, true);
    assert.ok(third.unlock, 'the window goes on with a new token');
    assert.notEqual(read(dir, FILES.master).keyId, key1);
    assert.equal(read(dir, FILES.code).keyId, read(dir, FILES.master).keyId);
    assert.deepEqual((await e.call('secrets.connector', { name: 'github', unlock: third.unlock })).env, { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' }, 'the secrets go on');
    const copyAfter = await e.call('backup.now', {});
    const clean = path.join(t.base, 'limpio');
    await assert.rejects(K.restoreInto(clean, copyAfter.path, { passphrase: second.code }), (x) => x.code === 'wrongPassphrase', 'old code + new copy: does not open');
    const old = new Master(dir, { secret: crypto.randomBytes(32) });
    try {
      assert.equal((await old.unlockWithCode(second.code, K.recoveryFile(t.home))).reason, 'wrong', 'the old code opens nothing of the new key');
      assert.equal(old.unlocked(), false);
    } finally { old.close(); }
    // the copy made before still opens with the code of then (what the unticked box warns about)
    await K.restoreInto(path.join(t.base, 'vieja'), copyBefore, { passphrase: second.code });
    // a phrase takes the code's place only after saying so
    await assert.rejects(e.call('backup.recovery', { code: 'mi frase propia de recuperacion', password: PASS }), /dejará de servir/);
    assert.equal((await e.call('master.state')).hasCode, true);
    await e.call('backup.recovery', { code: 'mi frase propia de recuperacion', password: PASS, confirm: true });
    assert.equal((await e.call('master.state')).hasCode, false);
    assert.equal(fs.existsSync(path.join(dir, FILES.code)), false);
  } finally { await e.stop(); }
  t.cleanup();
});

test('restoring a copy of another data key brings no old wrap back without the password or the code', async () => {
  const t = tempHome({ mcpServers: [GITHUB] });
  const secret = crypto.randomBytes(32).toString('hex');
  let e = await startEngine(t.home, { secret });
  const dir = secretsOf(t.home);
  let old; let current;
  try {
    await e.call('master.create', { password: PASS });
    await e.call('backup.recovery', { password: PASS });
    old = { copy: await e.call('backup.now', {}), key: read(dir, FILES.master).keyId };
    const regen = await e.call('backup.recovery', { password: PASS });
    current = { key: read(dir, FILES.master).keyId, code: regen.code };
    const { unlock } = await e.call('master.unlock', { password: PASS });
    assert.notEqual(old.key, current.key);
    // no proof: the copy's data and the rest come back, the secrets stay as they are
    const r = await e.call('backup.restore', { file: old.copy.path, unlock });
    assert.equal(r.secretsKept, true);
  } finally { await e.stop(); }
  e = await startEngine(t.home, { secret });
  try {
    assert.equal(read(dir, FILES.master).keyId, current.key, 'the current data key and its wraps were not replaced');
    assert.equal(read(dir, FILES.code).keyId, current.key);
    const { unlock } = await e.call('master.unlock', { password: PASS });
    assert.deepEqual((await e.call('secrets.connector', { name: 'github', unlock })).env, { GITHUB_TOKEN: 'ghp_DE_PRUEBA_123' });
    // with the password: the old key comes back, with the wraps it had, and its old code wrap is not taken
    await assert.rejects(e.call('backup.restore', { file: old.copy.path, password: 'no es', unlock }), /incorrecta/);
    const r = await e.call('backup.restore', { file: old.copy.path, password: PASS, unlock });
    assert.equal(r.secretsKept, false);
  } finally { await e.stop(); }
  e = await startEngine(t.home, { secret });
  try {
    assert.equal(read(dir, FILES.master).keyId, old.key);
    assert.equal(fs.existsSync(path.join(dir, FILES.code)), false, 'the copy\'s code wrap never comes back as it was');
    assert.equal((await e.call('master.state')).hasCode, false);
  } finally { await e.stop(); }
  t.cleanup();
});

test('the copy outside core never brings the code wrap or a wrap of another data key back', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-test-espejo-'));
  const dir = path.join(base, 'core'); const mirror = path.join(base, 'espejo');
  fs.mkdirSync(dir); fs.mkdirSync(mirror);
  const put = (d, name, keyId) => fs.writeFileSync(path.join(d, name), JSON.stringify({ keyId, wrapped: 'x' }));
  put(dir, FILES.vault, 'K2');
  for (const n of KEPT) put(mirror, n, n === FILES.master ? 'K1' : 'K2');
  assert.deepEqual(restoreMissing(dir, mirror).sort(), [FILES.machine].sort(), 'only the PC wrap of the key of the secrets that are there');
  assert.equal(keyIdOf(path.join(dir, FILES.machine)), 'K2');
  assert.equal(fs.existsSync(path.join(dir, FILES.code)), false);
  assert.equal(fs.existsSync(path.join(dir, FILES.master)), false, 'an old password wrap is not put back');
  fs.rmSync(base, { recursive: true, force: true });
});

test('forgetting the password with the generated code keeps the keys; the code, its keys and the data key never show up in logs, tries or answers', async () => {
  const t = tempHome({ mcpServers: [GITHUB] });
  const e = await startEngine(t.home, { secret: crypto.randomBytes(32).toString('hex') });
  const dir = secretsOf(t.home);
  const said = [];
  try {
    await e.call('master.create', { password: PASS });
    const { code } = await e.call('backup.recovery', { password: PASS });
    const compact = normalizeCode(code);
    const key = read(dir, FILES.master).keyId;
    for (let i = 0; i < 2; i++) await assert.rejects(e.call('master.forgot', { code: 'BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ', password: 'contraseña nueva de verdad', confirm: true }).catch((x) => { said.push(x.message); throw x; }), /incorrecto/);
    await assert.rejects(e.call('master.forgot', { code: 'una frase cualquiera', password: 'contraseña nueva de verdad', confirm: true }), /incorrecto/);
    const r = await e.call('master.forgot', { code, password: 'contraseña nueva de verdad', confirm: true });
    said.push(JSON.stringify(r));
    assert.equal(r.unlinked, 0);
    assert.equal(read(dir, FILES.master).keyId, key, 'the same data key');
    assert.equal((await e.call('master.unlock', { password: 'contraseña nueva de verdad' })).unlock.length > 10, true);
    const byCode = await e.call('master.unlock', { code: code.toLowerCase().replaceAll('-', ' ') });
    said.push(JSON.stringify(byCode));
    assert.ok(byCode.unlock, 'the generated code also unlocks the window');
    const files = scan(t.home);
    for (const text of [files, said.join('\n')]) {
      assert.ok(!text.includes(compact) && !text.includes(code), 'the code is nowhere');
      assert.ok(!text.includes('contraseña nueva de verdad'.normalize('NFC')) || text === said.join('\n') || !files.includes(PASS), 'no password in a file');
    }
    assert.ok(fs.existsSync(path.join(dir, FILES.tries)) === false || !fs.readFileSync(path.join(dir, FILES.tries), 'utf8').includes('BBBB'), 'intentos.json says only counts');
  } finally { await e.stop(); }
  t.cleanup();
});
