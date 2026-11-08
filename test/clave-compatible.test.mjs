// 3.8.1 (Tauri D-fix, review D6 A1/M1/M2): the approval secret when Orb 3.8.0 (Electron, still installed, reinstalled
// or portable) and 3.8.1 (Tauri) take turns on the same workspace. 3.8.0's real code (test/fixtures/approval-secret-
// 3.8.0.mjs, from git) only reads v10 and makes a NEW secret when its clave.enc does not open; 3.8.1 keeps ORB2 in its
// own files and never touches 3.8.0's. Sealings faked: Electron's v10 opens only v10; Tauri's opens ORB2 and v10.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadApprovalSecret as load380 } from './fixtures/approval-secret-3.8.0.mjs';
import { loadHostSecret, SecretError } from '../src/engine/approval-secret.mjs';

const bases = [];
after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 }); });
const setup = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-clave-')); bases.push(base);
  const dir = path.join(base, 'core', 'datos'); const copy = path.join(base, 'claves', 'orb-1234abcd.enc');
  return { base, dir, copy, enc: path.join(dir, 'clave.enc'), enc2: path.join(dir, 'clave2.enc'), copy2: copy.replace(/\.enc$/, '.v2.enc') };
};
const later = (v) => new Promise((r) => setTimeout(() => r(v), 1));
const electron = { seal: (hex) => Buffer.from(`v10${hex}`), unseal: (b) => { const s = b.toString('latin1'); if (!s.startsWith('v10')) throw new Error('no abre'); return s.slice(3); } };
const coded = (code) => Object.assign(new Error(code), { code });
const tauri = (over = {}) => ({
  seal: (hex) => later(Buffer.from(`ORB2${hex}`)),
  unseal: async (b) => { const s = b.toString('latin1'); await later(); if (s.startsWith('ORB2')) return s.slice(4); if (s.startsWith('v10')) return s.slice(3); throw coded('format'); },
  ...over
});
const read = (f) => fs.readFileSync(f, 'latin1');
const files = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);

test('3.8.0 → 3.8.1 → 3.8.0 → 3.8.1: always the same secret, and 3.8.0\'s files never change', async () => {
  const k = setup();
  const s = load380({ dir: k.dir, copy: k.copy, ...electron }); // 3.8.0 (synchronous): makes the secret
  const v10core = read(k.enc); const v10copy = read(k.copy);
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() }), s); // 3.8.1
  assert.equal(read(k.enc), v10core, 'clave.enc de 3.8.0 intacto'); assert.equal(read(k.copy), v10copy, 'su copia intacta');
  assert.equal(read(k.enc2), `ORB2${s}`); assert.equal(read(k.copy2), `ORB2${s}`);
  assert.equal(load380({ dir: k.dir, copy: k.copy, ...electron }), s); // 3.8.0 again
  assert.equal(read(k.enc), v10core); assert.equal(read(k.copy), v10copy);
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() }), s); // 3.8.1 again
  assert.deepEqual(files(k.dir), ['clave.enc', 'clave2.enc'], 'nada apartado ni temporales');
  assert.deepEqual(files(path.dirname(k.copy)), ['orb-1234abcd.enc', 'orb-1234abcd.v2.enc']);
  // core deleted by mistake: 3.8.1 brings it back from its copy outside (3.8.0's copy still untouched).
  fs.rmSync(path.join(k.base, 'core'), { recursive: true });
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() }), s);
  assert.equal(read(k.enc2), `ORB2${s}`); assert.equal(fs.existsSync(k.enc), false); assert.equal(read(k.copy), v10copy);
  // …and 3.8.0 afterwards puts its own clave.enc back from its v10 copy: the same secret.
  assert.equal(load380({ dir: k.dir, copy: k.copy, ...electron }), s);
});

test('3.8.1 on a new workspace, then 3.8.0: with the Local State of Electron on this PC, 3.8.0 opens the same key', async () => {
  const k = setup();
  fs.mkdirSync(k.dir, { recursive: true }); fs.writeFileSync(path.join(k.dir, 'clave.bin'), Buffer.alloc(32, 7));
  const v10 = (hex) => later(Buffer.from(`v10${hex}`));
  const s = await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ sealV10: v10 }) });
  assert.equal(s, '07'.repeat(32), 'la clave del espacio nuevo'); assert.equal(fs.existsSync(path.join(k.dir, 'clave.bin')), false);
  assert.equal(read(k.enc), `v10${s}`, 'clave.enc de la 3.8.0 creado');
  assert.equal(load380({ dir: k.dir, copy: k.copy, ...electron }), s, 'la 3.8.0 abre la misma clave');
  assert.equal(read(k.copy), `v10${s}`, 'y deja su copia');
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ sealV10: v10 }) }), s);
  // A clave.enc that exists is never replaced, even by the same app: one of another secret is told, not touched.
  fs.writeFileSync(k.enc, `v10${'c'.repeat(64)}`);
  const warned = [];
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ sealV10: v10 }), warn: (code) => warned.push(code) }), s);
  assert.deepEqual(warned, ['twoKeys']); assert.equal(read(k.enc), `v10${'c'.repeat(64)}`);
});

test('3.8.1 on a new workspace with no Local State of Electron (3.8.0 never ran here): no clave.enc; if 3.8.0 makes its own later, the user is told', async () => {
  const k = setup();
  const missing = async () => { throw coded('missing'); };
  const warned = [];
  const s = await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ sealV10: missing }), warn: (code) => warned.push(code) });
  assert.equal(fs.existsSync(k.enc), false); assert.deepEqual(warned, []);
  load380({ dir: k.dir, copy: k.copy, ...electron }); // 3.8.0 finds no v10: makes its own, in its own files
  assert.equal(read(k.enc2), `ORB2${s}`);
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ sealV10: missing }), warn: (code) => warned.push(code) }), s);
  assert.deepEqual(warned, ['twoKeys']);
});

test('a key that cannot be read now stops the start; keys that none opens are the user\'s call; never a new one alone', async () => {
  const k = setup();
  const s = load380({ dir: k.dir, copy: k.copy, ...electron });
  const before = { core: read(k.enc), copy: read(k.copy) };
  // Local State busy (Rust: 'io') or the app not answering: 'busy', nothing written.
  for (const code of ['io', 'timeout', 'noApp']) {
    await assert.rejects(loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ unseal: async () => { throw coded(code); } }) }), (e) => e instanceof SecretError && e.code === 'busy', code);
  }
  assert.deepEqual(files(k.dir), ['clave.enc']);
  // DPAPI says «another user or damaged», Local State gone, the tag does not match: 'unreadable', nothing written.
  for (const code of ['dpapi', 'missing', 'tag', 'format']) {
    await assert.rejects(loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ unseal: async () => { throw coded(code); } }) }), (e) => e.code === 'unreadable', code);
  }
  assert.deepEqual(files(k.dir), ['clave.enc']); assert.equal(read(k.enc), before.core); assert.equal(read(k.copy), before.copy);
  // The user chose a new key: a new secret in 3.8.1's files; 3.8.0's stay as they were (it keeps opening its own).
  const fresh = await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ unseal: async (b) => { const t = b.toString('latin1'); if (t.startsWith('ORB2')) return t.slice(4); throw coded('dpapi'); } }), allowNew: true });
  assert.notEqual(fresh, s); assert.equal(read(k.enc2), `ORB2${fresh}`);
  assert.equal(read(k.enc), before.core); assert.equal(read(k.copy), before.copy);
  // An unreadable clave2.enc with allowNew: kept aside, never overwritten in place.
  fs.writeFileSync(k.enc2, 'ORB2basura');
  fs.writeFileSync(k.copy2, 'ORB2basura');
  const third = await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ unseal: async (b) => { const t = b.toString('latin1'); if (/^ORB2[0-9a-f]{64}$/.test(t)) return t.slice(4); throw coded('dpapi'); } }), allowNew: true });
  assert.ok(files(k.dir).some((n) => /^clave2\..*\.ilegible\.enc$/.test(n) && read(path.join(k.dir, n)) === 'ORB2basura'));
  assert.equal(read(k.enc2), `ORB2${third}`);
  // A clave.bin never wins over a sealed key that exists.
  const k2 = setup();
  fs.mkdirSync(k2.dir, { recursive: true }); fs.writeFileSync(k2.enc, 'v10x'); fs.writeFileSync(path.join(k2.dir, 'clave.bin'), Buffer.alloc(32, 9));
  const n = await loadHostSecret({ dir: k2.dir, copy: k2.copy, ...tauri({ unseal: async () => { throw coded('tag'); } }), allowNew: true }).catch((e) => e);
  assert.notEqual(n, '09'.repeat(32));
});

test('the move to ORB2 is atomic: checked first, a cut write is adopted, a seal that does not open again changes nothing', async () => {
  const k = setup();
  const s = load380({ dir: k.dir, copy: k.copy, ...electron });
  // A sealing that does not open again to the same secret: nothing written, the v10 still serves.
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ seal: async () => Buffer.from('ORB2' + 'f'.repeat(64)) }) }), s);
  assert.deepEqual(files(k.dir), ['clave.enc']);
  // Sealing refused: the same.
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri({ seal: async () => { throw new Error('DPAPI'); } }) }), s);
  assert.deepEqual(files(k.dir), ['clave.enc']);
  // A write cut before its rename (the first clave2.enc): the temporary that opens is adopted, even with 3.8.0's
  // files gone.
  fs.writeFileSync(`${k.enc2}.123-abcd.tmp`, `ORB2${s}`);
  fs.rmSync(k.enc); fs.rmSync(k.copy);
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() }), s);
  assert.equal(read(k.enc2), `ORB2${s}`); assert.equal(files(k.dir).some((n) => n.endsWith('.tmp')), false);
  // A cut write of ANOTHER secret (a new key whose rename never happened) is not adopted while the rest agree on one.
  const k3 = setup();
  const s3 = load380({ dir: k3.dir, copy: k3.copy, ...electron });
  fs.writeFileSync(`${k3.enc2}.9-ffff.tmp`, `ORB2${'d'.repeat(64)}`);
  assert.equal(await loadHostSecret({ dir: k3.dir, copy: k3.copy, ...tauri() }), s3);
  assert.equal(read(k3.enc2), `ORB2${s3}`);
  // A new secret that cannot be kept on disk is never used.
  const k2 = setup();
  await assert.rejects(loadHostSecret({ dir: k2.dir, copy: k2.copy, ...tauri({ seal: async () => { throw new Error('DPAPI'); } }) }), (e) => e.code === 'busy');
});

test('two apps at once: one waits for the other (clave.lock); a lock left by a dead app is taken over', async () => {
  const k = setup();
  const s = load380({ dir: k.dir, copy: k.copy, ...electron });
  const slow = tauri({ unseal: async (b) => { await new Promise((r) => setTimeout(r, 30)); return tauri().unseal(b); } });
  const [a, b, c] = await Promise.all([loadHostSecret({ dir: k.dir, copy: k.copy, ...slow }), loadHostSecret({ dir: k.dir, copy: k.copy, ...slow }), loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() })]);
  assert.deepEqual([a, b, c], [s, s, s]);
  assert.deepEqual(files(k.dir), ['clave.enc', 'clave2.enc']);
  const lock = path.join(k.dir, 'clave.lock');
  fs.writeFileSync(lock, '999999'); const old = new Date(Date.now() - 60_000); fs.utimesSync(lock, old, old);
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() }), s);
  assert.equal(fs.existsSync(lock), false);
  // Held by a live app (on Windows a handle open with no sharing, however old the file): the other one waits, and a
  // slow unseal (longer than the old 30 s age) never loses it.
  const { exclusiveOpen } = await import('../src/engine/approval-secret.mjs');
  const fd = exclusiveOpen(lock); assert.ok(fd > 0);
  if (process.platform === 'win32') {
    fs.utimesSync(lock, old, old);
    assert.equal(exclusiveOpen(lock), null, 'abierto por otro: no se toma');
    assert.throws(() => fs.rmSync(lock), 'ni se borra');
  }
  const waiting = loadHostSecret({ dir: k.dir, copy: k.copy, ...tauri() });
  await new Promise((r) => setTimeout(r, 300));
  fs.closeSync(fd); fs.rmSync(lock, { force: true });
  assert.equal(await waiting, s);
});

test('after «Empezar con una clave nueva»: when Windows opens the old key again the user is offered it, and going back keeps the new one aside', async () => {
  const k = setup();
  const old = load380({ dir: k.dir, copy: k.copy, ...electron });
  let windowsOpensV10 = false;
  const t = (over = {}) => tauri({ unseal: async (b) => { const s = b.toString('latin1'); if (s.startsWith('ORB2')) return s.slice(4); if (s.startsWith('v10') && windowsOpensV10) return s.slice(3); throw coded('dpapi'); }, ...over });
  const fresh = await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), allowNew: true });
  assert.notEqual(fresh, old);
  assert.ok(fs.existsSync(path.join(k.dir, 'clave-anterior.json')), 'lo que no abrió queda anotado');
  const warned = [];
  const warn = (code) => warned.push(code);
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), warn }), fresh);
  assert.deepEqual(warned, [], 'mientras no abre, nada');
  windowsOpensV10 = true; // Windows can open 3.8.0's clave.enc again
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), warn }), fresh, 'sin pedirlo, sigue la nueva');
  assert.ok(warned.includes('previousOpens'));
  fs.writeFileSync(path.join(k.dir, 'clave-volver.json'), '{}'); // backup.previousKey
  warned.length = 0;
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), warn }), old, 'pedido: vuelve la anterior');
  assert.ok(warned.includes('previousBack'));
  assert.equal(read(k.enc2), `ORB2${old}`); assert.equal(read(k.copy2), `ORB2${old}`);
  assert.ok(files(k.dir).some((n) => /^clave2\..*\.nueva\.enc$/.test(n) && read(path.join(k.dir, n)) === `ORB2${fresh}`), 'la nueva, apartada');
  assert.equal(fs.existsSync(path.join(k.dir, 'clave-volver.json')), false);
  // Review D10 M6: and a way back to the new key, offered quietly (the button in Ajustes › Datos, no notice).
  assert.equal(JSON.parse(read(path.join(k.dir, 'clave-anterior.json'))).back, true);
  warned.length = 0;
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), warn }), old);
  assert.deepEqual(warned, ['newAvailable']);
  fs.writeFileSync(path.join(k.dir, 'clave-volver.json'), '{}');
  warned.length = 0;
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), warn }), fresh, 'pedido: vuelve la nueva');
  assert.ok(warned.includes('previousNew'));
  assert.equal(read(k.enc2), `ORB2${fresh}`);
  warned.length = 0;
  assert.equal(await loadHostSecret({ dir: k.dir, copy: k.copy, ...t(), warn }), fresh);
  assert.deepEqual(warned.filter((c) => c !== 'twoKeys'), ['previousQuiet'], 'la vuelta a la anterior sigue ofrecida, sin aviso en cada arranque');
});

test('Local State not there: «for now» while missingIsBusy (the first starts), then the user\'s call', async () => {
  const k = setup();
  load380({ dir: k.dir, copy: k.copy, ...electron });
  const missing = tauri({ unseal: async () => { throw coded('missing'); } });
  await assert.rejects(loadHostSecret({ dir: k.dir, copy: k.copy, ...missing, missingIsBusy: true }), (e) => e.code === 'busy');
  await assert.rejects(loadHostSecret({ dir: k.dir, copy: k.copy, ...missing }), (e) => e.code === 'unreadable');
});
