// 3.6: the bots' avatars (src/core/avatar.mjs): a fixed one from a bot's id (the same everywhere and on every run), the
// checks of { shape, color }, a bot made or changed with one, the old bots of a database given one, the templates' own,
// and the API that refuses a bad one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempHome, startEngine } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { openDb } from '../src/core/db.mjs';
import * as B from '../src/core/bots.mjs';
import * as A from '../src/core/avatar.mjs';
import { applyTemplate, getTemplate, listTemplates } from '../src/core/templates.mjs';
import { botPayload, newBotDraft } from '../src/ui/lib/bots.js';

const t = tempHome();
after(() => t.cleanup());

test('la familia: 12 formas y 10 colores, cada forma con su cara; el dibujo cambia con el estado', () => {
  assert.equal(A.SHAPE_IDS.length, 12);
  assert.equal(A.COLOR_IDS.length, 10);
  for (const s of A.SHAPE_IDS) {
    const p = A.avatarParts(s, 'cielo');
    assert.equal(p.eyes.length, 2, s);
    assert.ok(p.eyes.every((e) => e.kind === 'open' && Number.isFinite(e.tilt)), `${s}: dos trazos inclinados`);
  }
  assert.ok(A.avatarParts('mochi', 'coral', 'happy').eyes.every((e) => e.kind === 'arc'), 'aprobado: arcos');
  assert.ok(A.avatarParts('mochi', 'coral', 'paused').eyes.every((e) => e.kind === 'flat'), 'en pausa: líneas');
  assert.ok(A.avatarParts('mochi', 'coral', 'paused').z, 'en pausa: una «z»');
  assert.equal(A.avatarParts('mochi', 'coral').z, null);
  // Different bodies look different ways: not all eyes share one tilt.
  assert.ok(new Set(A.SHAPE_IDS.map((s) => A.SHAPES[s].eyes.tilt)).size >= 6);
  const svg = A.avatarSvg({ shape: 'gota', color: 'menta' }, { size: 64 });
  assert.match(svg, /^<svg[^>]+width="64"/);
  assert.doesNotMatch(svg, /<text/, 'sin «z» en reposo');
});

test('el avatar fijo de un bot sale de su id: siempre el mismo, válido y variado', () => {
  for (let id = 1; id <= 50; id++) {
    const a = A.avatarFor(id);
    assert.deepEqual(A.avatarFor(id), a, 'el mismo cada vez');
    assert.deepEqual(A.parseAvatar(a), a, 'una forma y un color de la familia');
  }
  assert.deepEqual(A.avatarFor(7), A.avatarFor('7'), 'el id como número o como texto');
  const first = Array.from({ length: 40 }, (_, i) => A.avatarFor(i + 1));
  assert.ok(new Set(first.map((a) => a.shape)).size >= 8, 'formas variadas');
  assert.ok(new Set(first.map((a) => a.color)).size >= 7, 'colores variados');
  assert.ok(new Set(first.map((a) => `${a.shape}:${a.color}`)).size >= 30, 'casi nunca dos iguales seguidos');
  assert.deepEqual(A.avatarOf({ id: 9 }), A.avatarFor(9));
  assert.deepEqual(A.avatarOf({ id: 9, avatar: '{"shape":"hoja","color":"rosa"}' }), { shape: 'hoja', color: 'rosa' });
  assert.deepEqual(A.avatarOf({}), A.DEFAULT_AVATAR);
});

test('validación: solo { shape, color } de la familia', () => {
  assert.deepEqual(A.parseAvatar({ shape: 'nube', color: 'lima' }), { shape: 'nube', color: 'lima' });
  assert.deepEqual(A.parseAvatar('{"shape":"nube","color":"lima"}'), { shape: 'nube', color: 'lima' });
  for (const bad of [null, undefined, '', 'nube', 42, [], { shape: 'nube' }, { color: 'lima' }, { shape: 'robot', color: 'lima' }, { shape: 'nube', color: '#ff0000' },
    { shape: 'nube', color: 'lima', extra: 1 }, { shape: 'toString', color: 'lima' }, { shape: 'nube', color: '__proto__' }, '{no json']) assert.equal(A.parseAvatar(bad), null, JSON.stringify(bad));
});

test('un bot nuevo: el avatar elegido, o el fijo de su id; cambiarlo, volver al fijo y rechazar uno malo', () => {
  const board = new Board();
  const own = B.createBot(board, { name: 'Lector', avatar: { shape: 'gota', color: 'lavanda' } });
  assert.deepEqual(own.avatar, { shape: 'gota', color: 'lavanda' });
  const plain = B.createBot(board, { name: 'Sin elegir' });
  assert.deepEqual(plain.avatar, A.avatarFor(plain.id));
  assert.equal(board.one('SELECT avatar FROM bots WHERE id = ?', plain.id).avatar, JSON.stringify(A.avatarFor(plain.id)), 'guardado: no cambia nunca');
  assert.deepEqual(B.updateBot(board, own.id, { avatar: { shape: 'estrella', color: 'limon' } }).avatar, { shape: 'estrella', color: 'limon' });
  assert.deepEqual(B.updateBot(board, own.id, { avatar: null }).avatar, A.avatarFor(own.id), 'null: el fijo de su id');
  for (const bad of [{ shape: 'robot', color: 'cielo' }, 'gota', { shape: 'gota', color: 'cielo', size: 9 }, 5]) {
    assert.throws(() => B.updateBot(board, own.id, { avatar: bad }), (e) => e.userFacing && /avatar/.test(e.message), JSON.stringify(bad));
    assert.throws(() => B.createBot(board, { name: `Malo ${Math.random()}`, avatar: bad }), /avatar/);
  }
  assert.deepEqual(B.getBot(board, own.id).avatar, A.avatarFor(own.id), 'lo rechazado no cambió nada');
  assert.deepEqual(B.updateBot(board, own.id, { name: 'Lector 2' }).avatar, A.avatarFor(own.id), 'cambiar otra cosa no toca el avatar');
});

test('una base de datos de antes: cada bot recibe el avatar fijo de su id, y no cambia al volver a abrirla', () => {
  const file = path.join(t.base, 'antes.db');
  let db = openDb(file);
  const at = '2026-10-01T10:00:00Z';
  for (const name of ['Uno', 'Dos', 'Tres']) db.prepare("INSERT INTO bots (name, icon, created_at, updated_at) VALUES (?, '🤖', ?, ?)").run(name, at, at);
  db.exec('UPDATE bots SET avatar = NULL');
  db.close();
  db = openDb(file);
  const rows = db.prepare('SELECT id, avatar FROM bots ORDER BY id').all();
  assert.equal(rows.length, 3);
  for (const r of rows) assert.deepEqual(JSON.parse(r.avatar), A.avatarFor(r.id), `bot ${r.id}`);
  db.prepare('UPDATE bots SET avatar = ? WHERE id = ?').run(JSON.stringify({ shape: 'hoja', color: 'menta' }), rows[0].id);
  db.close();
  db = openDb(file);
  assert.deepEqual(JSON.parse(db.prepare('SELECT avatar FROM bots WHERE id = ?').get(rows[0].id).avatar), { shape: 'hoja', color: 'menta' }, 'el elegido se queda');
  db.close();
});

test('las plantillas traen un avatar para cada bot (igual en es y en) y se aplican con él', () => {
  for (const lang of ['es', 'en']) for (const tpl of listTemplates(lang)) for (const b of tpl.bots) assert.ok(A.parseAvatar(b.avatar), `${lang}/${tpl.id}/${b.key}`);
  const es = listTemplates('es'); const en = listTemplates('en');
  assert.deepEqual(es.map((x) => x.bots.map((b) => b.avatar)), en.map((x) => x.bots.map((b) => b.avatar)));
  const { cleanup } = tempHome();
  try {
    const board = new Board();
    const made = applyTemplate(board, { id: 'negocio', lang: 'es' });
    const tpl = getTemplate('negocio', 'es');
    assert.deepEqual(made.bots.map((id) => B.getBot(board, id).avatar), tpl.bots.map((b) => b.avatar));
    const seeded = B.seedStarter(new Board());
    if (seeded) assert.deepEqual(seeded.avatar, { shape: 'mochi', color: 'cielo' });
  } finally { cleanup(); }
});

test('la ventana manda el avatar del editor solo si es válido', () => {
  assert.deepEqual(botPayload({ ...newBotDraft(), name: 'X', avatar: { shape: 'flor', color: 'rosa' } }).avatar, { shape: 'flor', color: 'rosa' });
  assert.equal(botPayload({ ...newBotDraft(), name: 'X', avatar: { shape: 'flor', color: 'gris' } }).avatar, undefined);
  assert.equal(botPayload({ ...newBotDraft(), name: 'X' }).avatar, undefined);
});

test('la API: bots.create y bots.update aceptan el avatar y rechazan uno malo', async () => {
  const home = tempHome();
  const E = await startEngine(home.home);
  try {
    const b = await E.call('bots.create', { name: 'Avatar', avatar: { shape: 'bollo', color: 'agua' } });
    assert.deepEqual(b.avatar, { shape: 'bollo', color: 'agua' });
    const listed = (await E.call('bots.list')).bots.find((x) => x.id === b.id);
    assert.deepEqual(listed.avatar, { shape: 'bollo', color: 'agua' });
    assert.deepEqual((await E.call('bots.update', { id: b.id, avatar: { shape: 'corazon', color: 'coral' } })).avatar, { shape: 'corazon', color: 'coral' });
    await assert.rejects(E.call('bots.update', { id: b.id, avatar: { shape: 'dragón', color: 'coral' } }), /avatar/);
    await assert.rejects(E.call('bots.create', { name: 'Otro', avatar: { shape: 'nube' } }), /avatar/);
    const plain = await E.call('bots.create', { name: 'Normal' });
    assert.deepEqual(plain.avatar, A.avatarFor(plain.id));
  } finally { await E.stop(); home.cleanup(); }
});
