// 3.6: moving an Orb to another machine (src/core/export.mjs). The move copy opens only with its passphrase; the new
// machine gets the same orbId with incarnation + 1, the bots and the links (their secret travels inside); the old Orb
// stops serving until the user undoes the move or keeps both (a new orbId); peers tell a move from a clone.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';
import { ctx } from '../src/core/context.mjs';
import { Board } from '../src/core/board.mjs';
import * as B from '../src/core/bots.mjs';
import * as K from '../src/core/backup.mjs';
import { moveExport, moveImport, moveUndo, cloneVerdict, movedAway } from '../src/core/export.mjs';

const PASS = 'una frase larga de prueba';

test('move export → import on a new machine: same Orb, next incarnation, bots and links; the old one is marked', async () => {
  const { home, cleanup } = tempHome();
  const board = new Board();
  const away = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-nuevo-'));
  try {
    const bot = B.createBot(board, { name: 'Leo' });
    B.writeMemory(bot.id, 'Memoria de Leo.', { mode: 'replace' });
    fs.writeFileSync(path.join(ctx.paths.data, 'enlaces.json'), JSON.stringify({ box: 'enlaces-sellados' }));
    const secret = crypto.randomBytes(32);
    const before = K.orbIdOf(home);
    await assert.rejects(moveExport({ home, secret, passphrase: 'corta' }), /12/);
    const { file, header } = await moveExport({ home, secret, passphrase: PASS, version: 'test' });
    assert.equal(header.move, true); assert.equal(header.kind, 'move');
    assert.ok(!header.wrapped.machine, 'a move copy opens only with its passphrase');
    assert.ok(movedAway(home)?.at);
    // Not into a folder that already has something.
    fs.writeFileSync(path.join(away, 'algo.txt'), 'x');
    await assert.rejects(moveImport({ target: away, file, passphrase: PASS }), /carpeta/);
    const target = path.join(away, 'Orb');
    await assert.rejects(moveImport({ target, file, passphrase: 'otra frase equivocada' }), { code: 'wrongPassphrase' });
    const r = await moveImport({ target, file, passphrase: PASS });
    assert.equal(r.orbId, before.orbId); assert.equal(r.incarnation, before.incarnation + 1);
    assert.equal(K.orbIdOf(target).moved, null);
    assert.equal(fs.readFileSync(path.join(target, 'bots', String(bot.id), 'memoria.md'), 'utf8').trim(), 'Memoria de Leo.');
    assert.ok(fs.readFileSync(path.join(target, '.orb', 'datos', 'clave.bin')).equals(secret));
    assert.equal(fs.readFileSync(path.join(target, '.orb', 'datos', 'enlaces.json'), 'utf8'), JSON.stringify({ box: 'enlaces-sellados' }));
    // A normal backup is not a move.
    const plain = await K.createBackup({ home, secret, passphrase: PASS });
    await assert.rejects(moveImport({ target: path.join(away, 'Otro'), file: plain.file, passphrase: PASS }), /mover/);
    // Undo: the old one serves again.
    moveUndo(home); assert.equal(movedAway(home), null);
    // The new one starts with its bots.
    const e = await startEngine(target);
    try { assert.ok((await e.call('bots.list')).bots.some((b) => b.name === 'Leo')); assert.equal((await e.call('app.state')).moved, null); } finally { await e.stop(); }
  } finally { board.db.close(); cleanup(); fs.rmSync(away, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('peers tell a move from a clone', () => {
  const id = 'a'.repeat(32);
  assert.equal(cloneVerdict(null, { orbId: id, incarnation: 1 }), 'new');
  assert.equal(cloneVerdict({ orbId: id, incarnation: 1, host: 'pc-1' }, { orbId: id, incarnation: 1, host: 'pc-1' }), 'same');
  assert.equal(cloneVerdict({ orbId: id, incarnation: 1, host: 'pc-1' }, { orbId: id, incarnation: 2, host: 'pc-2' }), 'moved');
  assert.equal(cloneVerdict({ orbId: id, incarnation: 2, host: 'pc-2' }, { orbId: id, incarnation: 1, host: 'pc-1' }), 'clone');
  assert.equal(cloneVerdict({ orbId: id, incarnation: 2, host: 'pc-2' }, { orbId: id, incarnation: 2, host: 'pc-3' }), 'clone');
  assert.equal(cloneVerdict({ orbId: id, incarnation: 1 }, { orbId: 'b'.repeat(32), incarnation: 1 }), 'new');
});

test('engine: data.moveExport stops serving; the moved Orb refuses calls until «mantener ambos»', async () => {
  const { home, cleanup } = tempHome();
  let e = await startEngine(home);
  let stopped = false;
  try {
    await e.call('bots.create', { name: 'Ana bot' });
    await assert.rejects(e.call('data.moveExport', { passphrase: 'corta' }), /12/);
    const r = await e.call('data.moveExport', { passphrase: PASS });
    assert.ok(r.file.endsWith('.orbbak'));
    assert.ok((await e.call('app.state')).moved?.at);
    await assert.rejects(e.call('bots.list'), /se ha movido/);
    await e.stop(); stopped = true;
    e = await startEngine(home); stopped = false;
    assert.ok((await e.call('app.state')).moved);
    await assert.rejects(e.call('bots.list'), /se ha movido/);
    const id = K.orbIdOf(home).orbId;
    const kept = await e.call('data.moveKeepBoth', {});
    assert.notEqual(kept.orbId, id);
    assert.ok((await e.call('bots.list')).bots.some((b) => b.name === 'Ana bot'));
  } finally { if (!stopped) await e.stop(); cleanup(); }
});
