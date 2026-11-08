// 3.8.1 (review Tauri D-fix A1): a backup restored with another key keeps that key at every later start, in Orb 3.8.0
// (its real code, test/fixtures), Electron 3.8.1 and Tauri, and when they take turns. Before, the next start of 3.8.1
// opened the sealed key from before the restore (clave2.enc or the copy outside) and deleted the restored clave.bin.
// The reviewer's repro (restore-repro.mjs), with the real applyPendingRestore instead of a simulated one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadApprovalSecret as load380 } from './fixtures/approval-secret-3.8.0.mjs';
import { loadApprovalSecret, loadHostSecret, secret2Files } from '../src/engine/approval-secret.mjs';
import { applyPendingRestore, pendingDir } from '../src/core/backup.mjs';
import { RESTORE_MARKER } from '../src/core/restored-key.mjs';

const bases = [];
after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5 }); });
const electron = { seal: (h) => Buffer.from('v10' + h), unseal: (b) => { const s = b.toString('latin1'); if (!s.startsWith('v10')) throw new Error('x'); return s.slice(3); } };
const tauriSeal = { seal: async (h) => Buffer.from('ORB2' + h), unseal: async (b) => { const s = b.toString('latin1'); if (s.startsWith('ORB2')) return s.slice(4); if (s.startsWith('v10')) return s.slice(3); throw Object.assign(new Error('f'), { code: 'format' }); } };
// Tauri with Orb on Electron's Local State on this PC (it can make 3.8.0's clave.enc) or without it.
const withV10 = { ...tauriSeal, sealV10: async (h) => Buffer.from('v10' + h) };
const noV10 = { ...tauriSeal, sealV10: async () => { throw Object.assign(new Error('falta Local State'), { code: 'missing' }); } };
function mk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-restaurar-')); bases.push(base);
  const dir = path.join(base, 'core', 'datos'); fs.mkdirSync(dir, { recursive: true });
  return { base, dir, copy: path.join(base, 'claves', 'k.enc') };
}
// A backup staged by stageRestore whose clave.bin is 0xAB × 32, applied as the engine does it (Tauri passes its copy
// outside; Electron passes none).
const R = 'ab'.repeat(32);
function restore(k, outside = []) {
  const ready = pendingDir(k.base);
  fs.mkdirSync(path.join(ready, 'core', 'datos'), { recursive: true });
  fs.writeFileSync(path.join(ready, 'core', 'datos', 'clave.bin'), Buffer.alloc(32, 0xab));
  fs.writeFileSync(path.join(ready, 'listo.json'), JSON.stringify({ from: 'x.orbbak', header: {} }));
  const r = applyPendingRestore(k.base, { outside });
  assert.equal(r.secretChanged, true);
}
// The same backup restored by Orb 3.8.0's own engine (its applyPendingRestore only knew clave.enc): clave.enc into
// corentes-de-restaurar-<date>, clave.bin written; Tauri's ORB2 files left as they were.
function restoreBy380(k) {
  const aside = path.join(k.base, 'core', `antes-de-restaurar-${Date.now()}`, 'core', 'datos');
  fs.mkdirSync(aside, { recursive: true });
  const e = path.join(k.dir, 'clave.enc'); if (fs.existsSync(e)) fs.renameSync(e, path.join(aside, 'clave.enc'));
  fs.writeFileSync(path.join(k.dir, 'clave.bin'), Buffer.alloc(32, 0xab));
}
const apps = {
  '3.8.0': (k) => load380({ ...k, ...electron }),
  'Electron 3.8.1': (k) => loadApprovalSecret({ ...k, ...electron }),
  Tauri: (k) => loadHostSecret({ ...k, ...withV10 }),
  'Tauri sin Local State': (k) => loadHostSecret({ ...k, ...noV10 })
};
const outsideOf = (name, k) => (name.startsWith('Tauri') ? [secret2Files(k.dir, k.copy).copy2] : []);

for (const [name, load] of Object.entries(apps)) {
  test(`${name}: a backup restored with another key keeps it at the next two starts`, async () => {
    const k = mk();
    const before = await load(k);
    assert.notEqual(before, R);
    restore(k, outsideOf(name, k));
    assert.equal(await load(k), R, 'primer arranque');
    assert.equal(await load(k), R, 'segundo arranque');
    assert.equal(fs.existsSync(path.join(k.dir, 'clave.bin')), false, 'clave.bin sellado y borrado');
    if (name !== '3.8.0') assert.equal(fs.existsSync(path.join(k.dir, RESTORE_MARKER)), false, 'marca consumida');
    // The key from before is kept aside somewhere (old backups may need it), never lost.
    const kept = [...fs.readdirSync(k.base, { recursive: true })].map((f) => path.join(k.base, f)).filter((f) => fs.statSync(f).isFile() && /\.enc$/.test(f)).map((f) => fs.readFileSync(f, 'latin1'));
    assert.ok(kept.some((t) => t.endsWith(before)), 'la clave anterior queda apartada');
  });
}

test('restored in Tauri, then 3.8.0, then Tauri (and the other way round): always the restored key', async () => {
  for (const [by, order] of [['Tauri', ['Tauri', '3.8.0', 'Tauri', '3.8.0']], ['3.8.0', ['3.8.0', 'Tauri', '3.8.0', 'Tauri']], ['Electron 3.8.1', ['Electron 3.8.1', 'Tauri', '3.8.0']], ['3.8.0 (su código)', ['3.8.0', 'Tauri', 'Tauri', '3.8.0']]]) {
    const k = mk();
    // Both apps used this workspace before: 3.8.0's v10 files and Tauri's ORB2 files hold the old secret.
    const old = load380({ ...k, ...electron }); assert.equal(await loadHostSecret({ ...k, ...withV10 }), old);
    await new Promise((r) => setTimeout(r, 20)); // the restore comes after Tauri's files were written
    if (by === '3.8.0 (su código)') restoreBy380(k); else restore(k, by === 'Tauri' ? outsideOf('Tauri', k) : []);
    for (const app of order) assert.equal(await apps[app](k), R, `${by}: ${order.join(' → ')}: ${app}`);
  }
});

test('core repaired from a backup (onlyMissing): clave.bin never comes back beside a sealed key of either app', async () => {
  const k = mk();
  const s = await loadHostSecret({ ...k, ...noV10 });
  const ready = pendingDir(k.base);
  fs.mkdirSync(path.join(ready, 'core', 'datos'), { recursive: true });
  fs.writeFileSync(path.join(ready, 'core', 'datos', 'clave.bin'), Buffer.alloc(32, 0xab));
  fs.writeFileSync(path.join(ready, 'listo.json'), JSON.stringify({ from: 'x.orbbak', header: {} }));
  applyPendingRestore(k.base, { onlyMissing: true });
  assert.equal(fs.existsSync(path.join(k.dir, 'clave.bin')), false);
  assert.equal(fs.existsSync(path.join(k.dir, RESTORE_MARKER)), false);
  assert.equal(await loadHostSecret({ ...k, ...noV10 }), s);
});

test('a marker that is not about the clave.bin there (or no clave.bin) is dropped: B11 holds', async () => {
  const k = mk();
  const s = await loadHostSecret({ ...k, ...noV10 });
  fs.writeFileSync(path.join(k.dir, 'clave.bin'), Buffer.alloc(32, 9));
  fs.writeFileSync(path.join(k.dir, RESTORE_MARKER), JSON.stringify({ sha256: '0'.repeat(64) }));
  assert.equal(await loadHostSecret({ ...k, ...noV10 }), s);
  assert.equal(fs.existsSync(path.join(k.dir, RESTORE_MARKER)), false);
});
