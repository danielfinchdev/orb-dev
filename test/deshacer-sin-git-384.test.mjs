// Undo in a project without git must not destroy what the user did after the task finished.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cps from '../src/domain/tasks/checkpoints.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-undo-nogit-'));
after(() => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* temp */ } });
const w = (dir, f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
const r = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const later = (dir, f, ms = 5000) => { const t = new Date(Date.now() + ms); fs.utimesSync(path.join(dir, f), t, t); };

// The task's own files get an mtime just before its end (but after the checkpoint), as in real life (it wrote them, then finished).
const back = (dir, f, ms = 1000) => { const t = new Date(Date.now() - ms); fs.utimesSync(path.join(dir, f), t, t); };

async function setup(name, { map = true } = {}) {
  const dir = path.join(base, name); fs.mkdirSync(dir);
  w(dir, 'a.txt', 'original a'); w(dir, 'c.txt', 'original c'); w(dir, 'd.txt', 'original d');
  const before = cps.takeCheckpoint(dir, name, path.join(base, 'copias'));
  assert.equal(before.kind, 'copia');
  // The task edits a and d, deletes c and creates n and m.
  w(dir, 'a.txt', 'a changed by the task'); w(dir, 'd.txt', 'd changed by the task');
  fs.rmSync(path.join(dir, 'c.txt')); w(dir, 'n.txt', 'new by the task'); w(dir, 'm.txt', 'also new');
  for (const f of ['a.txt', 'd.txt', 'n.txt', 'm.txt']) back(dir, f);
  const at = Date.now();
  const end = { kind: 'copia', at, state: cps.stateFileOf(before.copy) };
  if (map) await cps.saveTreeState(end.state, at, await cps.treeState(dir));
  return { dir, before, end };
}

test('sin git: lo que el usuario hizo después de la tarea se queda, lo demás vuelve', async () => {
  const { dir, before, end } = await setup('despues');
  w(dir, 'a.txt', 'user edit after the task, longer'); later(dir, 'a.txt');
  w(dir, 'm.txt', 'user rewrote the new file'); later(dir, 'm.txt');
  w(dir, 'c.txt', 'user recreated c'); // the task had deleted it
  w(dir, 'b.txt', 'user file created after');
  const out = cps.undoCheckpoint(before, end);
  assert.equal(r(dir, 'a.txt'), 'user edit after the task, longer');
  assert.equal(r(dir, 'm.txt'), 'user rewrote the new file');
  assert.equal(r(dir, 'c.txt'), 'user recreated c');
  assert.equal(r(dir, 'b.txt'), 'user file created after');
  assert.deepEqual(out.skipped.sort(), ['a.txt', 'b.txt', 'c.txt', 'm.txt']);
  assert.equal(r(dir, 'd.txt'), 'original d');
  assert.ok(!fs.existsSync(path.join(dir, 'n.txt')));
  assert.deepEqual(out.restored, ['d.txt']); assert.deepEqual(out.removed, ['n.txt']);
});

test('sin git: sin cambios posteriores, deshacer lo devuelve todo', async () => {
  const { dir, before, end } = await setup('normal');
  const out = cps.undoCheckpoint(before, end);
  assert.deepEqual(out.skipped, []);
  assert.equal(r(dir, 'a.txt'), 'original a'); assert.equal(r(dir, 'c.txt'), 'original c'); assert.equal(r(dir, 'd.txt'), 'original d');
  assert.ok(!fs.existsSync(path.join(dir, 'n.txt')) && !fs.existsSync(path.join(dir, 'm.txt')));
});

test('sin git: una foto antigua (sin estado final) mantiene el comportamiento anterior', async () => {
  const { dir, before } = await setup('antigua');
  const out = cps.undoCheckpoint(before, {});
  assert.deepEqual(out.skipped, []);
  assert.equal(r(dir, 'a.txt'), 'original a'); assert.ok(!fs.existsSync(path.join(dir, 'n.txt')));
});

test('sin git: sin mapa (solo {kind, at}), lo que el usuario edita o crea después se queda', async () => {
  const { dir, before, end } = await setup('sinmapa', { map: false });
  const mark = { kind: end.kind, at: end.at };
  w(dir, 'a.txt', 'user edit'); later(dir, 'a.txt');
  w(dir, 'b.txt', 'user new file'); later(dir, 'b.txt');
  const out = cps.undoCheckpoint(before, mark);
  assert.equal(r(dir, 'a.txt'), 'user edit'); assert.equal(r(dir, 'b.txt'), 'user new file');
  assert.deepEqual(out.skipped.sort(), ['a.txt', 'b.txt']);
  assert.equal(r(dir, 'd.txt'), 'original d'); assert.equal(r(dir, 'c.txt'), 'original c');
  assert.ok(!fs.existsSync(path.join(dir, 'n.txt')) && !fs.existsSync(path.join(dir, 'm.txt')));
});

test('sin git: sin mapa y sin cambios posteriores, deshacer lo devuelve todo', async () => {
  const { dir, before, end } = await setup('sinmapa-normal', { map: false });
  const out = cps.undoCheckpoint(before, { kind: end.kind, at: end.at });
  assert.deepEqual(out.skipped, []);
  assert.equal(r(dir, 'a.txt'), 'original a'); assert.equal(r(dir, 'c.txt'), 'original c'); assert.equal(r(dir, 'd.txt'), 'original d');
  assert.ok(!fs.existsSync(path.join(dir, 'n.txt')) && !fs.existsSync(path.join(dir, 'm.txt')));
});

test('sin git: el mapa se lee del archivo junto a la copia; si falta, la regla de fechas protege igual', async () => {
  const { dir, before, end } = await setup('archivo');
  assert.equal(end.state, `${before.copy}.estado.json`);
  assert.ok(fs.existsSync(end.state)); assert.ok(!fs.existsSync(`${end.state}.tmp`));
  // Same size, different date: only the map can notice this edit (it is not newer than the end of the task).
  w(dir, 'd.txt', 'd changed by the user'); back(dir, 'd.txt', 5000);
  const out = cps.undoCheckpoint(before, end);
  assert.deepEqual(out.skipped, ['d.txt']); assert.equal(r(dir, 'd.txt'), 'd changed by the user');
  // Without the file: a later edit is still protected by its date.
  const s2 = await setup('archivo-falta');
  w(s2.dir, 'a.txt', 'user edit'); later(s2.dir, 'a.txt');
  fs.rmSync(s2.end.state);
  const out2 = cps.undoCheckpoint(s2.before, s2.end);
  assert.deepEqual(out2.skipped, ['a.txt']); assert.equal(r(s2.dir, 'a.txt'), 'user edit'); assert.equal(r(s2.dir, 'd.txt'), 'original d');
  // Unreadable content counts as no map.
  const s3 = await setup('archivo-roto');
  fs.writeFileSync(s3.end.state, '{not json');
  const out3 = cps.undoCheckpoint(s3.before, s3.end);
  assert.deepEqual(out3.skipped, []); assert.equal(r(s3.dir, 'a.txt'), 'original a');
});

test('sin git: un mapa de otra ronda (at distinto) no se usa', async () => {
  const { dir, before, end } = await setup('otra-ronda');
  await cps.saveTreeState(end.state, end.at - 1, {}); // would call every file "changed" if trusted
  const out = cps.undoCheckpoint(before, end);
  assert.deepEqual(out.skipped, []); assert.equal(r(dir, 'a.txt'), 'original a');
});
