// 3.6: moving an Orb to another machine (src/core/export.mjs). The move copy opens only with its passphrase; the new
// machine gets the same orbId with incarnation + 1, the conversations and the logs (the secret travels inside); the old Orb
// stops serving until the user undoes the move or keeps both (a new orbId); peers tell a move from a clone.
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { ctx } from '../src/core/context.mjs';
import * as K from '../src/core/backup.mjs';
import { moveExport, moveImport, moveUndo, movedAway } from '../src/core/export.mjs';

const PASS = 'una frase larga de prueba';

test('move export → import on a new machine: same Orb, next incarnation, its data; the old one is marked', async () => {
  const { home, cleanup } = tempHome();
  const board = new Board();
  const away = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-nuevo-'));
  try {
    board.createConversation({ title: 'Leo' });
    fs.mkdirSync(ctx.paths.projectLogs, { recursive: true });
    fs.writeFileSync(path.join(ctx.paths.projectLogs, 'leo.md'), 'Bitácora de Leo.');
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
    assert.equal(fs.readFileSync(path.join(target, 'bitacora', 'proyectos', 'leo.md'), 'utf8').trim(), 'Bitácora de Leo.');
    assert.ok(fs.readFileSync(path.join(target, '.orb', 'datos', 'clave.bin')).equals(secret));
    // A normal backup is not a move.
    const plain = await K.createBackup({ home, secret, passphrase: PASS });
    await assert.rejects(moveImport({ target: path.join(away, 'Otro'), file: plain.file, passphrase: PASS }), /mover/);
    // Undo: the old one serves again.
    moveUndo(home); assert.equal(movedAway(home), null);
    // The new one starts with its conversations.
    const e = await startEngine(target);
    try { assert.ok((await e.call('conversations.list')).some((c) => c.title === 'Leo')); assert.equal((await e.call('app.state')).moved, null); } finally { await e.stop(); }
  } finally { board.db.close(); cleanup(); fs.rmSync(away, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

test('engine: data.moveExport stops serving; the moved Orb refuses calls until «mantener ambos»', async () => {
  const { home, cleanup } = tempHome();
  let e = await startEngine(home);
  let stopped = false;
  try {
    await e.call('projects.create', { name: 'casa' });
    await assert.rejects(e.call('data.moveExport', { passphrase: 'corta' }), /12/);
    const r = await e.call('data.moveExport', { passphrase: PASS });
    assert.ok(r.file.endsWith('.orbbak'));
    assert.ok((await e.call('app.state')).moved?.at);
    await assert.rejects(e.call('projects.list'), /se ha movido/);
    await e.stop(); stopped = true;
    e = await startEngine(home); stopped = false;
    assert.ok((await e.call('app.state')).moved);
    await assert.rejects(e.call('projects.list'), /se ha movido/);
    const id = K.orbIdOf(home).orbId;
    const kept = await e.call('data.moveKeepBoth', {});
    assert.notEqual(kept.orbId, id);
    assert.ok((await e.call('projects.list')).some((p) => p.name === 'casa'));
  } finally { if (!stopped) await e.stop(); cleanup(); }
});
