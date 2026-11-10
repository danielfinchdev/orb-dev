// 3.6: encrypted backups (src/domain/data/backup.mjs and the backup.* calls). A copy holds the database (conversations,
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
import { useHome, ctx } from '../src/platform/context.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import * as K from '../src/domain/data/backup.mjs';

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
    assert.ok(!fs.existsSync(path.join(target, 'core', 'orb.json')));
    const r = await K.restoreInto(target, moved, { secret: crypto.randomBytes(32), passphrase: code });
    assert.ok(r.files >= 5);
    assert.ok(fs.existsSync(path.join(target, 'core', 'orb.json')));
    assert.equal(fs.readFileSync(path.join(target, 'core', 'bitacora', 'proyectos', 'casa.md'), 'utf8').trim(), 'A Ana le gusta el té verde.');
    assert.match(fs.readFileSync(path.join(target, 'core', 'bitacora', 'GENERAL.md'), 'utf8'), /Línea de prueba/);
    // 3.8.1: this PC's secret never travels (the new PC has its own).
    assert.equal(fs.existsSync(path.join(target, 'core', 'datos', 'clave.bin')), false);
    const db = new DatabaseSync(path.join(target, 'core', 'datos', 'orb.db'), { readOnly: true });
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
    assert.match(fs.readFileSync(projectLog(), 'utf8'), /té verde/);
    assert.match(fs.readFileSync(path.join(r.aside, 'core', 'bitacora', 'proyectos', 'casa.md'), 'utf8'), /Cambiado/);
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
      assert.ok(fs.readFileSync(path.join(out, 'core', 'bitacora', 'proyectos', 'grande.bin')).equals(big));
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
    // 3.8: a new recovery code, checking a copy and restoring one need the master password (a fresh unlock).
    await assert.rejects(e.call('backup.recovery', {}), /contraseña maestra/);
    const { unlock } = await e.call('master.create', { password: 'contraseña de copias' });
    const { code } = await e.call('backup.recovery', { unlock });
    assert.match(code, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    assert.equal((await e.call('backup.status')).recovery, true);
    await e.call('projects.create', { name: 'casa' });
    await e.call('schedules.create', { project: 'casa', title: 'Antes', description: 'd', every: 'daily' });
    const made = await e.call('backup.now', {});
    assert.ok(made.file.endsWith('.orbbak') && made.recovery);
    const list = await e.call('backup.list');
    assert.equal(list.length, 1); assert.equal(list[0].kind, 'manual');
    await assert.rejects(e.call('backup.verify', { file: made.file }), /contraseña maestra/);
    assert.equal((await e.call('backup.verify', { file: made.file, unlock })).ok, true);
    await assert.rejects(e.call('backup.verify', { file: 'no-existe.orbbak', unlock }), /No encuentro esa copia/);
    await assert.rejects(e.call('backup.verify', { file: '../../orb.json', unlock }), /no es una copia/);
    await e.call('schedules.create', { project: 'casa', title: 'Después', description: 'd', every: 'daily' });
    await assert.rejects(e.call('backup.restore', { file: made.file }), /contraseña maestra/);
    const r = await e.call('backup.restore', { file: made.file, unlock });
    assert.equal(r.restartNeeded, true);
    await e.stop(); stopped = true;
    const again = await startEngine(home);
    try {
      const names = (await again.call('schedules.list')).map((x) => x.title);
      assert.ok(names.includes('Antes') && !names.includes('Después'), names.join(', '));
    } finally { await again.stop(); }
  } finally { if (!stopped) await e.stop(); cleanup(); }
});


test('3.8: las copias van fuera de la carpeta de Orb, las de 3.7 se mudan allí y nunca pueden ir dentro de core', async () => {
  const s = seed();
  try {
    const def = K.defaultBackupDir(s.home);
    assert.equal(path.dirname(def), path.resolve(process.env.ORB_BACKUP_ROOT), 'carpeta propia de este espacio en la raíz de copias');
    assert.ok(!path.relative(s.home, def).match(/^[^.]/) || path.relative(s.home, def).startsWith('..'), 'fuera del espacio de trabajo');
    const { file } = await K.createBackup({ home: s.home, secret: s.secret, kind: 'manual', version: 'test' });
    assert.equal(path.dirname(file), def);
    assert.equal(JSON.parse(fs.readFileSync(path.join(def, 'ultima.json'), 'utf8')).file, file, 'la última, anotada fuera de core');
    // A copy of 3.7, inside the old data folder: moved where copies go now, and found.
    const old = K.oldBackupDir(s.home);
    fs.mkdirSync(old, { recursive: true });
    const older = (await K.createBackup({ home: s.home, secret: s.secret, kind: 'daily', version: '3.7.0', folder: old, now: new Date('2026-10-01T03:00:00Z') })).file;
    assert.equal(K.adoptOldBackups(s.home), 1);
    assert.ok(!fs.existsSync(old) && fs.existsSync(path.join(def, path.basename(older))));
    assert.equal(K.adoptOldBackups(s.home), 0, 'la segunda vez, nada');
    assert.equal((await K.latestBackup(s.home)).file, file);
    // Another folder chosen by the user: the newest copy is still found from the note in the default folder.
    const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-mis-copias-'));
    const later = await K.createBackup({ home: s.home, secret: s.secret, kind: 'manual', version: 'test', folder: mine, now: new Date(Date.now() + 60_000) });
    assert.equal((await K.latestBackup(s.home)).file, later.file);
    fs.rmSync(mine, { recursive: true, force: true });
    // A 3.7 copy's names go into core.
    assert.equal(K.legacyName('.orb/datos/orb.db'), 'core/datos/orb.db');
    assert.equal(K.legacyName('orb.json'), 'core/orb.json');
    assert.equal(K.legacyName('bitacora/proyectos/x.md'), 'core/bitacora/proyectos/x.md');
    assert.equal(K.legacyName('web/tienda/pizarra/a.png'), 'web/tienda/pizarra/a.png');
  } finally { s.cleanup(); }
});

test('3.8: Ajustes › Datos elige otra carpeta de copias, nunca dentro del espacio (tampoco por una unión) ni una que lo contenga', async () => {
  const { home, cleanup } = tempHome();
  const e = await startEngine(home);
  try {
    assert.equal((await e.call('backup.status')).custom, false);
    const { unlock } = await e.call('master.create', { password: 'contraseña de copias' });
    await assert.rejects(e.call('config.save', { patch: { backup: { folder: path.join(home, 'core', 'copias') } }, unlock }), /dentro de la carpeta de Orb/);
    await assert.rejects(e.call('config.save', { patch: { backup: { folder: path.join(home, 'web', 'copias') } }, unlock }), /dentro de la carpeta de Orb/, 'tampoco en un proyecto');
    await assert.rejects(e.call('config.save', { patch: { backup: { folder: path.dirname(home) } }, unlock }), /ni en una carpeta que la contenga/);
    const link = path.join(path.dirname(home), 'enlace-a-orb');
    fs.symlinkSync(home, link, 'junction');
    await assert.rejects(e.call('config.save', { patch: { backup: { folder: path.join(link, 'web') } }, unlock }), /dentro de la carpeta de Orb/, 'una unión que lleva dentro');
    const mine = path.join(path.dirname(home), 'mis-copias');
    await assert.rejects(e.call('config.save', { patch: { backup: { folder: mine } } }), /contraseña maestra/, '3.8: sin desbloquear, no');
    await e.call('config.save', { patch: { backup: { folder: mine } }, unlock });
    const st = await e.call('backup.status');
    assert.equal(st.folder, mine); assert.equal(st.custom, true);
    await e.call('config.save', { patch: { backup: { folder: '' } }, unlock });
    assert.equal((await e.call('backup.status')).folder, K.defaultBackupDir(home));
  } finally { await e.stop(); cleanup(); }
});

test('3.8.1 (decision 20 d): a backup never carries this PC\'s secret; one made before (with clave.bin) is refused with a clear message', async () => {
  const t = tempHome();
  try {
    fs.mkdirSync(ctx.paths.data, { recursive: true });
    fs.writeFileSync(ctx.paths.key, crypto.randomBytes(32));
    const { file } = await K.createBackup({ home: t.home, secret: crypto.randomBytes(32), passphrase: 'codigo-de-prueba-largo' });
    const into = path.join(t.base, 'limpia');
    await K.restoreInto(into, file, { passphrase: 'codigo-de-prueba-largo' });
    assert.equal(fs.existsSync(path.join(into, 'core', 'datos', 'clave.bin')), false, 'sin clave.bin en la copia');
    for (const name of ['core/datos/clave.bin', '.orb/datos/clave.bin']) assert.equal(K.oldKeyEntry(name), true, name);
    for (const name of ['core/archivo-3.7/datos/clave.bin', 'mi-proyecto/datos/clave.bin', 'core/datos/copia-clave.json']) assert.equal(K.oldKeyEntry(name), false, name);
    assert.match(new K.BackupError('oldKey').message, /versión anterior de Orb.*ya no se puede restaurar/);
  } finally { t.cleanup(); }
});

test('review M2: restored on another PC with the recovery code, the code keeps working there (and the scheduled copies keep its wrap)', async () => {
  const t = tempHome();
  try {
    const pcA = crypto.randomBytes(32); const pcB = crypto.randomBytes(32);
    const code = K.newRecoveryCode();
    K.setRecovery(t.home, pcA, code, { kdf: { N: 2 ** 10, r: 8, p: 1 } });
    const { file } = await K.createBackup({ home: t.home, secret: pcA });
    const into = path.join(t.base, 'otro-pc');
    await K.restoreInto(into, file, { secret: pcB, passphrase: code });
    assert.equal(K.isRecoveryCode(into, pcB, code), true, 'el código vale en el PC nuevo');
    await K.restoreInto(path.join(t.base, 'mismo-pc'), file, { secret: pcA });
    assert.equal(K.isRecoveryCode(path.join(t.base, 'mismo-pc'), pcA, code), true, 'en el mismo PC, tal cual');
  } finally { t.cleanup(); }
});

test('3.8.2: a copy reports its progress up to the end, and what a copy cut short left is cleaned only when it is old and Orb’s own', async () => {
  const s = seed();
  try {
    const seen = [];
    const { file } = await K.createBackup({ home: s.home, secret: s.secret, kind: 'preupdate', version: 'test', progress: (x) => seen.push(x) });
    assert.ok(seen.length >= 3, `progreso: ${seen.join(' ')}`);
    assert.ok(seen.every((x, i) => x >= 0 && x <= 1 && (i === 0 || x >= seen[i - 1])), `progreso no creciente: ${seen.join(' ')}`);
    assert.ok(seen.at(-1) > 0.9, `progreso final: ${seen.at(-1)}`);
    assert.ok((await K.verifyBackup(file, { secret: s.secret })).files >= 5);
    const dir = path.dirname(file);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.preparando-')), [], 'la copia no deja su carpeta');
    // What a copy cut short leaves (its stage with files, its unfinished file), and what is not Orb's.
    const stale = path.join(dir, '.preparando-1yGvmE'); fs.mkdirSync(path.join(stale, 'core', 'datos'), { recursive: true }); fs.writeFileSync(path.join(stale, 'core', 'datos', 'orb.db'), 'x');
    const partial = path.join(dir, 'orb-20261109-172444Z-preupdate.orbbak.1234.tmp'); fs.writeFileSync(partial, 'x');
    const young = path.join(dir, '.preparando-AbC123'); fs.mkdirSync(young);
    const others = ['.preparando-de-dani', 'notas.tmp', '.preparandoX-123456'].map((n) => path.join(dir, n));
    fs.mkdirSync(others[0]); fs.writeFileSync(others[1], 'x'); fs.mkdirSync(others[2]);
    const fileNamedLikeStage = path.join(dir, '.preparando-Zz9999'); fs.writeFileSync(fileNamedLikeStage, 'x');
    const old = (Date.now() - 2 * 60 * 60_000) / 1000;
    for (const f of [stale, partial, fileNamedLikeStage, ...others]) fs.utimesSync(f, old, old);
    const now = Date.now() + 2 * 60 * 60_000; // birth times cannot be set: the clock moves instead (the young one is made "now")
    fs.utimesSync(young, now / 1000, now / 1000);
    assert.equal(await K.cleanStaleStages(dir, { now }), 2);
    assert.ok(!fs.existsSync(stale) && !fs.existsSync(partial));
    for (const f of [young, fileNamedLikeStage, ...others, file]) assert.ok(fs.existsSync(f), `no debía irse: ${path.basename(f)}`);
    assert.equal(await K.cleanStaleStages(path.join(dir, 'no-existe')), 0);
  } finally { s.board.db.close(); s.cleanup(); }
});
