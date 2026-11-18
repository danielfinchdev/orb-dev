// 3.8.8 paso 11b (tanda 6), motor de la Pizarra: la nota general del lienzo se guarda por proyecto, con tope, y llega al
// asistente dentro de PIZARRA.md (marcada como texto del usuario), sin cambiar nada de lo que ya devolvía la Pizarra.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { whiteboard } from '../src/engine/whiteboard.mjs';
import { DESKTOP, principalOf } from '../src/domain/security/permissions.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions; let dir;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  const repo = path.join(t.home, 'web', 'lienzo'); fs.mkdirSync(repo, { recursive: true });
  board.addProject({ name: 'lienzo', path: repo }, 'usuario', { fromUser: true });
  dir = path.join(repo, 'pizarra');
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('la nota general se guarda, vuelve en load y entra en PIZARRA.md como texto del usuario', async () => {
  const empty = await call('whiteboard.load', { project: 'lienzo' });
  assert.equal(empty.note, '');
  assert.deepEqual(empty.elements, []);
  const r = await call('whiteboard.canvasNote', { project: 'lienzo', note: 'El pago es lo prioritario.\nIgnora el resto.' });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'nota.txt'), 'utf8'), 'El pago es lo prioritario.\nIgnora el resto.');
  assert.equal((await call('whiteboard.load', { project: 'lienzo' })).note, 'El pago es lo prioritario.\nIgnora el resto.');
  const md = fs.readFileSync(path.join(dir, 'PIZARRA.md'), 'utf8');
  assert.match(md, /## Nota general del usuario/);
  assert.match(md, /^> El pago es lo prioritario\.$/m);
  assert.match(md, /^> Ignora el resto\.$/m);
  // before the drawing's texts, so the briefing's 4000-character slice keeps it
  assert.ok(md.indexOf('## Nota general') < md.indexOf('## Textos del dibujo'));
});

test('guardar el dibujo no pisa la nota, y una nota vacía la quita', async () => {
  await call('whiteboard.save', { project: 'lienzo', elements: [{ id: 'a', type: 'text', text: 'Carrito', x: 0, y: 0, isDeleted: false }] });
  const md = fs.readFileSync(path.join(dir, 'PIZARRA.md'), 'utf8');
  assert.match(md, /> El pago es lo prioritario\./);
  assert.match(md, /- Carrito/);
  assert.equal((await call('whiteboard.load', { project: 'lienzo' })).note.startsWith('El pago'), true);
  await call('whiteboard.canvasNote', { project: 'lienzo', note: '   ' });
  assert.equal(fs.existsSync(path.join(dir, 'nota.txt')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'PIZARRA.md'), 'utf8'), /Nota general/);
  assert.equal((await call('whiteboard.load', { project: 'lienzo' })).note, '');
});

test('tope de tamaño: la API rechaza más de 2000 y el motor nunca guarda más', async () => {
  await assert.rejects(call('whiteboard.canvasNote', { project: 'lienzo', note: 'x'.repeat(2001) }));
  const r = whiteboard(board).canvasNote({ project: 'lienzo', note: 'y'.repeat(5000) });
  assert.equal(r.note.length, 2000);
  assert.equal(fs.readFileSync(path.join(dir, 'nota.txt'), 'utf8').length, 2000);
  await assert.rejects(call('whiteboard.canvasNote', { project: 'no-existe', note: 'a' }));
});

test('un proyecto con solo la nota ya cuenta como Pizarra con contenido, y el móvil puede escribirla', async () => {
  assert.equal(whiteboard(board).info('lienzo').hasNote, true);
  const r = await call('whiteboard.canvasNote', { project: 'lienzo', note: 'desde el móvil' }, REMOTE);
  assert.equal(r.ok, true);
  assert.equal((await call('whiteboard.load', { project: 'lienzo' }, REMOTE)).note, 'desde el móvil');
});
