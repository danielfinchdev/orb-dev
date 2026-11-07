// 3.6: encrypted backups (src/core/backup.mjs and the backup.* calls). A copy holds the database (conversations,
// settings…), orb.json, the logs and the app's secret; a changed chunk does not open; on a
// clean machine it opens only with the recovery code; restoring swaps the data at the next start of the engine.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';
import { useHome, ctx } from '../src/core/context.mjs';
import { Board } from '../src/core/board.mjs';
import * as K from '../src/core/backup.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

// An Orb with two conversations (one with a line), a project's log, the general log and a setting.
const projectLog = () => path.join(ctx.paths.projectLogs, 'casa.md');
function seed() {
  const t = tempHome();
  const board = new Board();
  const conv = board.createConversation({ title: 'Leo' });
  board.run('INSERT INTO chat (role, body, at, conversation_id) VALUES (?, ?, ?, ?)', 'usuario', 'Regar las plantas', new Date().toISOString(), conv.id);
  board.createConversation({ title: 'Casa' });
  fs.mkdirSync(ctx.paths.projectLogs, { recursive: true });
  fs.writeFileSync(projectLog(), 'A Ana le gusta el té verde.\n');
  board.setting('pin_probe', 'hash-de-prueba'); // stands in for a secret kept in the database
  fs.mkdirSync(ctx.paths.logs, { recursive: true });
  fs.writeFileSync(path.join(ctx.paths.logs, 'GENERAL.md'), '# Bitácora\nLínea de prueba\n');
  const secret = crypto.randomBytes(32);
  return { ...t, board, conv, secret };
}

test('a copy round-trips: verify, tampered chunk fails, wrong or missing code refused', async () => {
  const s = seed();
  try {
    const code = K.newRecoveryCode();
    assert.match(code, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    K.setRecovery(s.home, s.secret, code);
    const { file, header } = await K.createBackup({ home: s.home, secret: s.secret, kind: 'manual', version: 'test' });
    assert.ok(file.endsWith('.orbbak') && fs.existsSync(file));
    assert.equal(header.kind, 'manual'); assert.ok(header.wrapped.machine && header.wrapped.passphrase);
    assert.match(header.orbId, /^[0-9a-f]{32}$/); assert.equal(header.incarnation, 1);
    // The header says what it is, never what it holds.
    const raw = fs.readFileSync(file);
    for (const secretText of ['té verde', 'Regar las plantas', 'Línea de prueba', 'hash-de-prueba']) assert.ok(!raw.includes(Buffer.from(secretText)), `en claro: ${secretText}`);
    const ok = await K.verifyBackup(file, { secret: s.secret });
    assert.ok(ok.files >= 5);
    // With the recovery code typed differently (lower case, spaces) it opens too.
    await K.verifyBackup(file, { passphrase: code.toLowerCase().replace(/-/g, ' ') });
    await assert.rejects(K.verifyBackup(file, {}), { code: 'needsPassphrase' });
    await assert.rejects(K.verifyBackup(file, { secret: crypto.randomBytes(32), passphrase: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH' }), { code: 'wrongPassphrase' });
    // One byte changed in the middle of the body: the chunk does not open.
    const bad = path.join(path.dirname(file), 'cambiada.orbbak');
    const copy = Buffer.from(raw); copy[copy.length - 40] ^= 0x01; fs.writeFileSync(bad, copy);
    await assert.rejects(K.verifyBackup(bad, { secret: s.secret }), { code: 'damaged' });
    // Cut short: refused as well.
    fs.writeFileSync(bad, raw.subarray(0, raw.length - 10));
    await assert.rejects(K.verifyBackup(bad, { secret: s.secret }), { code: 'damaged' });
    // A changed header (another orbId) breaks every chunk.
    const { header: h, bodyAt } = await K.readHeader(file);
    const forged = Buffer.from(JSON.stringify({ ...h, orbId: 'f'.repeat(32) }));
    const len = Buffer.alloc(4); len.writeUInt32BE(forged.length);
    fs.writeFileSync(bad, Buffer.concat([K.MAGIC, len, forged, raw.subarray(bodyAt)]));
    await assert.rejects(K.verifyBackup(bad, { secret: s.secret }), { code: 'damaged' });
    fs.writeFileSync(bad, 'no soy una copia');
    await assert.rejects(K.readHeader(bad), { code: 'notBackup' });
  } finally { s.board.db.close(); s.cleanup(); }
});

test('restore on a clean machine with the recovery code brings everything back', async () => {
  const s = seed();
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-limpio-'));
  try {
    const code = K.newRecoveryCode();
    K.setRecovery(s.home, s.secret, code);
    const { file } = await K.createBackup({ home: s.home, secret: s.secret, version: 'test' });
    const moved = path.join(clean, 'copia.orbbak'); fs.copyFileSync(file, moved);
    const target = path.join(clean, 'Orb');
    // The new machine has another secret: only the code opens it.
    await assert.rejects(K.restoreInto(target, moved, { secret: crypto.randomBytes(32) }), { code: 'needsPassphrase' });
    assert.ok(!fs.existsSync(path.join(target, 'orb.json')));
    const r = await K.restoreInto(target, moved, { secret: crypto.randomBytes(32), passphrase: code });
    assert.ok(r.files >= 5);
    assert.ok(fs.existsSync(path.join(target, 'orb.json')));
    assert.equal(fs.readFileSync(path.join(target, 'bitacora', 'proyectos', 'casa.md'), 'utf8').trim(), 'A Ana le gusta el té verde.');
    assert.match(fs.readFileSync(path.join(target, 'bitacora', 'GENERAL.md'), 'utf8'), /Línea de prueba/);
    // The secret travels inside (the approvals keep working there).
    assert.ok(fs.readFileSync(path.join(target, '.orb', 'datos', 'clave.bin')).equals(s.secret));
    const db = new DatabaseSync(path.join(target, '.orb', 'datos', 'orb.db'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT title FROM conversations WHERE id = ?').get(s.conv.id).title, 'Leo');
      assert.equal(db.prepare('SELECT body FROM chat WHERE conversation_id = ?').get(s.conv.id).body, 'Regar las plantas');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n, 2);
      assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'pin_probe'").get().value, 'hash-de-prueba');
    } finally { db.close(); }
    // The same Orb (same orbId), so peers know it.
    assert.equal(K.orbIdOf(target).orbId, K.orbIdOf(s.home).orbId);
    // And it starts: the engine opens the restored folder with its conversations.
    const e = await startEngine(target);
    try { const list = await e.call('conversations.list'); assert.ok(list.some((c) => c.title === 'Leo')); } finally { await e.stop(); }
  } finally { s.board.db.close(); s.cleanup(); fs.rmSync(clean, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('restore in place swaps at the next start; what was there is kept aside', async () => {
  const s = seed();
  try {
    const { file } = await K.createBackup({ home: s.home, secret: s.secret, version: 'test' });
    fs.writeFileSync(projectLog(), 'Cambiado después de la copia.\n');
    s.board.run('DELETE FROM chat');
    s.board.db.close();
    const staged = await K.stageRestore(s.home, file, { secret: s.secret });
    assert.ok(staged.files >= 5);
    // Nothing changes until the swap.
    assert.match(fs.readFileSync(projectLog(), 'utf8'), /Cambiado/);
    const r = K.applyPendingRestore(s.home);
    assert.ok(r && fs.existsSync(r.aside));
    assert.equal(r.secretChanged, true); // the old folder had no clave.bin of its own
    assert.match(fs.readFileSync(projectLog(), 'utf8'), /té verde/);
    assert.match(fs.readFileSync(path.join(r.aside, 'bitacora', 'proyectos', 'casa.md'), 'utf8'), /Cambiado/);
    useHome(s.home);
    const b2 = new Board();
    try { assert.equal(b2.one('SELECT COUNT(*) AS n FROM chat').n, 1); } finally { b2.db.close(); }
    assert.equal(K.applyPendingRestore(s.home), null); // once
  } finally { s.cleanup(); }
});

test('several 1 MiB chunks: a big file round-trips; swapping or changing a middle chunk fails', async () => {
  const s = seed();
  try {
    const big = crypto.randomBytes(Math.floor(2.5 * K.CHUNK));
    fs.writeFileSync(path.join(ctx.paths.projectLogs, 'grande.bin'), big);
    const { file, header } = await K.createBackup({ home: s.home, secret: s.secret });
    const { bodyAt } = await K.readHeader(file);
    const raw = fs.readFileSync(file);
    // The chunk frames: u32 length, then the frame.
    const frames = []; for (let at = bodyAt; at < raw.length;) { const len = raw.readUInt32BE(at); frames.push([at, 4 + len]); at += 4 + len; }
    assert.ok(frames.length >= 3, `chunks: ${frames.length}`);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-grande-'));
    try {
      await K.restoreInto(out, file, { secret: s.secret });
      assert.ok(fs.readFileSync(path.join(out, 'bitacora', 'proyectos', 'grande.bin')).equals(big));
      const bad = path.join(out, 'mal.orbbak');
      const changed = Buffer.from(raw); changed[frames[1][0] + 100] ^= 0xff; fs.writeFileSync(bad, changed);
      await assert.rejects(K.verifyBackup(bad, { secret: s.secret }), { code: 'damaged' });
      const [a, b] = [frames[0], frames[1]];
      const swapped = Buffer.concat([raw.subarray(0, a[0]), raw.subarray(b[0], b[0] + b[1]), raw.subarray(a[0], a[0] + a[1]), raw.subarray(b[0] + b[1])]);
      fs.writeFileSync(bad, swapped);
      await assert.rejects(K.verifyBackup(bad, { secret: s.secret }), { code: 'damaged' });
      // Dropping the last chunk (a cut at a chunk boundary) is refused too.
      const last = frames[frames.length - 1];
      fs.writeFileSync(bad, raw.subarray(0, last[0]));
      await assert.rejects(K.verifyBackup(bad, { secret: s.secret }), { code: 'damaged' });
      assert.equal(header.counts.files >= 6, true);
    } finally { fs.rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  } finally { s.board.db.close(); s.cleanup(); }
});

test('retention keeps 7 daily, 4 weekly, 6 monthly and the last copies before updates', () => {
  const list = [];
  const start = Date.parse('2026-11-04T03:00:00Z');
  for (let i = 0; i < 400; i++) list.push({ file: `d${i}`, kind: 'daily', created: new Date(start - i * 86_400_000).toISOString() });
  for (let i = 0; i < 5; i++) list.push({ file: `u${i}`, kind: 'preupdate', created: new Date(start - i * 7 * 86_400_000).toISOString() });
  list.push({ file: 'm0', kind: 'move', move: true, created: new Date(start - 500 * 86_400_000).toISOString() });
  const gone = new Set(K.toPrune(list));
  const kept = list.filter((b) => !gone.has(b.file)).map((b) => b.file);
  for (let i = 0; i < 7; i++) assert.ok(kept.includes(`d${i}`), `día ${i}`);
  assert.ok(!kept.includes('d8'));
  assert.ok(kept.includes('u0') && kept.includes('u2') && !kept.includes('u3'));
  assert.ok(kept.includes('m0'));
  const daily = kept.filter((f) => f.startsWith('d'));
  assert.ok(daily.length <= 7 + 4 + 6 && daily.length >= 12, `kept ${daily.length}`);
  assert.ok(Math.max(...daily.map((f) => Number(f.slice(1)))) < 190); // nothing older than ~6 months
});

test('engine: backup.now, list, verify, recovery code and restore staged for the next start', async () => {
  const { home, cleanup } = tempHome();
  const e = await startEngine(home);
  let stopped = false;
  try {
    const st = await e.call('backup.status');
    assert.equal(st.recovery, false); assert.equal(st.enabled, true);
    const { code } = await e.call('backup.recovery', {});
    assert.match(code, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    assert.equal((await e.call('backup.status')).recovery, true);
    await e.call('projects.create', { name: 'casa' });
    await e.call('schedules.create', { project: 'casa', title: 'Antes', description: 'd', every: 'daily' });
    const made = await e.call('backup.now', {});
    assert.ok(made.file.endsWith('.orbbak') && made.recovery);
    const list = await e.call('backup.list');
    assert.equal(list.length, 1); assert.equal(list[0].kind, 'manual');
    assert.equal((await e.call('backup.verify', { file: made.file })).ok, true);
    await assert.rejects(e.call('backup.verify', { file: 'no-existe.orbbak' }), /No encuentro esa copia/);
    await assert.rejects(e.call('backup.verify', { file: '../../orb.json' }), /no es una copia/);
    await e.call('schedules.create', { project: 'casa', title: 'Después', description: 'd', every: 'daily' });
    const r = await e.call('backup.restore', { file: made.file });
    assert.equal(r.restartNeeded, true);
    await e.stop(); stopped = true;
    const again = await startEngine(home);
    try {
      const names = (await again.call('schedules.list')).map((x) => x.title);
      assert.ok(names.includes('Antes') && !names.includes('Después'), names.join(', '));
    } finally { await again.stop(); }
  } finally { if (!stopped) await e.stop(); cleanup(); }
});

