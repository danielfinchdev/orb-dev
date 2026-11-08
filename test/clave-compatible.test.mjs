// 3.8.1 (decision 20 d): this PC's secret is opened in Rust (src-tauri/vault/src/machine.rs, through the tests' vault
// with its fake sealing: ORB2 + the text) and the engine gets only the keys made from it. The loader's own cases (cut
// writes, two starts at once, the way back to an older key) are Rust's unit tests; these check the engine's side of it.
// Orb 3.8.0's key files are not read any more: when only they are there, the start stops and nothing is touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMachine } from '../src/core/master.mjs';
import { keysOf } from '../src/core/machine-keys.mjs';

const bases = [];
after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 }); });
const setup = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-clave-')); bases.push(base);
  const dir = path.join(base, 'core', 'datos'); const copy = path.join(base, 'claves', 'orb-1234abcd.enc');
  return { base, dir, copy, enc2: path.join(dir, 'clave2.enc'), copy2: copy.replace(/\.enc$/, '.v2.enc') };
};
const read = (f) => fs.readFileSync(f, 'latin1');
const fake = {}; // the tests' sealing with no knobs
const open = (k, more = {}) => openMachine({ dir: k.dir, copy: k.copy, fake, reveal: true, ...more });

test('the same secret at every start, sealed in core and outside; the engine gets only the keys made from it', () => {
  const k = setup();
  const a = open(k);
  assert.match(a.hex, /^[0-9a-f]{64}$/);
  assert.equal(read(k.enc2), `ORB2${a.hex}`); assert.equal(read(k.copy2), `ORB2${a.hex}`);
  const keys = keysOf(Buffer.from(a.hex, 'hex'));
  assert.ok(a.approval.equals(keys.approval) && a.backup.equals(keys.backup), 'las mismas claves que hace Node');
  assert.equal(open(k).hex, a.hex);
  // Orb.exe's vault never says the secret, nor takes a test's knobs (here the tests' vault does, asked to).
  assert.equal(openMachine({ dir: k.dir, copy: k.copy, fake }).hex, undefined);
  fs.rmSync(path.join(k.base, 'core'), { recursive: true });
  assert.equal(open(k).hex, a.hex, 'core borrado: vuelve de la copia de fuera');
});

test('Orb 3.8.0\'s key files: the start stops with «old» and nothing is written or deleted; a new key leaves them', () => {
  const k = setup();
  fs.mkdirSync(k.dir, { recursive: true }); fs.mkdirSync(path.dirname(k.copy), { recursive: true });
  fs.writeFileSync(path.join(k.dir, 'clave.enc'), 'v10abc'); fs.writeFileSync(k.copy, 'v10abc');
  assert.throws(() => open(k), (e) => e.code === 'old' && /clave\.enc/.test(e.detail));
  assert.deepEqual(fs.readdirSync(k.dir), ['clave.enc']);
  const fresh = open(k, { allowNew: true });
  assert.equal(read(k.enc2), `ORB2${fresh.hex}`);
  assert.equal(read(path.join(k.dir, 'clave.enc')), 'v10abc'); assert.equal(read(k.copy), 'v10abc');
});

test('a key that cannot be read now stops the start (busy); sealed keys that none opens are the user\'s call', () => {
  const k = setup();
  const s = open(k).hex;
  assert.throws(() => open(k, { fake: { unsealError: 'io' } }), (e) => e.code === 'busy');
  assert.throws(() => open(k, { fake: { unsealError: 'dpapi' } }), (e) => e.code === 'unreadable');
  assert.equal(read(k.enc2), `ORB2${s}`, 'nada escrito');
  assert.throws(() => open(setup(), { fake: { seal: 'fail' } }), (e) => e.code === 'busy', 'una clave nueva que no se puede guardar no se usa');
});
