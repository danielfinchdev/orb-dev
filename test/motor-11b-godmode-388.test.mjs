// 3.8.8 paso 11b (tanda 10), motor del God mode: «Nuevo archivo» (la única escritura de la ventana) con todas sus
// negativas, y la codificación y las líneas que da la lectura de un archivo.
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
import { DESKTOP, principalOf } from '../src/domain/security/permissions.mjs';
import { userLogFile } from '../src/domain/activity/user-log.mjs';
import { createFile } from '../src/engine/host/expert.mjs';

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions; let scheduler; let repo; let outside;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const create = (name, dir) => call('expert.createFile', { project: 'godmode', name, ...(dir === undefined ? {} : { dir }) });
const refused = (promise, re) => assert.rejects(promise, (e) => { if (re) assert.match(e.message, re); return true; });

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  repo = path.join(t.home, 'web', 'godmode'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  for (const d of ['.git', '.orb', '.orb-adjuntos', 'pizarra']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'untouched');
  board.addProject({ name: 'godmode', path: repo }, 'usuario', { fromUser: true });
  outside = path.join(t.home, 'web', 'outside'); fs.mkdirSync(outside, { recursive: true });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('crea un archivo vacío en la raíz y en una carpeta, y lo deja en el registro del usuario', async () => {
  const a = await create('nuevo.txt');
  assert.deepEqual(a, { path: 'nuevo.txt', name: 'nuevo.txt', dir: '' });
  assert.equal(fs.readFileSync(path.join(repo, 'nuevo.txt'), 'utf8'), '');
  const b = await create('b.mjs', 'src');
  assert.equal(b.path, 'src/b.mjs');
  assert.ok(fs.existsSync(path.join(repo, 'src', 'b.mjs')));
  assert.match(fs.readFileSync(userLogFile(), 'utf8'), /"kind":"file\.create".*src\/b\.mjs/);
});

test('nunca sobrescribe: si ya existe (también si aparece justo antes de crear) se niega y no toca nada', async () => {
  await refused(create('keep.txt'), /ya existe|already exists/);
  assert.equal(fs.readFileSync(path.join(repo, 'keep.txt'), 'utf8'), 'untouched');
  // the race: the file appears after the caller's checks; «wx» still refuses.
  fs.writeFileSync(path.join(repo, 'carrera.txt'), 'other');
  assert.throws(() => createFile(repo, '', 'carrera.txt'), /ya existe|already exists/);
  assert.equal(fs.readFileSync(path.join(repo, 'carrera.txt'), 'utf8'), 'other');
});

test('nombres negados: rutas, dos puntos, reservados de Windows, punto o espacio al final, caracteres raros', async () => {
  const before = fs.readdirSync(repo).sort();
  await refused(create(''), /nombre/); await refused(create('  '), /nombre/);
  for (const bad of ['..', '.', 'a/b.txt', 'a\\b.txt', '../x', 'C:x', 'x:y', 'a.txt:stream', 'CON', 'nul.txt', 'com1', 'LPT9.log', 'nul .txt', 'CONIN$', 'conout$.log', 'COM¹', 'clock$', 'x.', 'a*b', 'a?b', 'a<b', 'a|b', 'a\u0001b', 'x'.repeat(201)]) {
    await refused(create(bad), /nombre no válido|invalid name|demasiado largo|too long/);
  }
  assert.deepEqual(fs.readdirSync(repo).sort(), before);
});

test('carpetas protegidas y nombres secretos: .git, .orb, .orb-adjuntos, pizarra, .env y claves', async () => {
  for (const d of ['.git', '.orb', '.orb-adjuntos', 'pizarra', '.GIT']) await refused(create('x.txt', d));
  for (const n of ['.git', '.ORB', 'Pizarra']) await refused(create(n), /Orb o git|Orb or git/);
  for (const n of ['.env', '.env.local', 'id_rsa']) await refused(create(n), /sensibles|sensitive/);
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'x.txt')));
  assert.ok(!fs.existsSync(path.join(repo, '.env')));
});

test('carpeta fuera del proyecto: .., absoluta, inexistente y archivo en vez de carpeta', async () => {
  for (const d of ['..', '../outside', outside, 'C:/', 'no-existe', 'keep.txt', 'src/../..']) await refused(create('x.txt', d));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('un enlace que sale del proyecto no sirve de carpeta ni de destino', async (ctx) => {
  const link = path.join(repo, 'salida');
  try { fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch { return ctx.skip('no se pueden crear enlaces aquí'); }
  await refused(create('x.txt', 'salida'), /fuera del proyecto|outside/);
  assert.deepEqual(fs.readdirSync(outside), []);
  try { fs.symlinkSync(path.join(outside, 'destino.txt'), path.join(repo, 'src', 'enlace.txt'), 'file'); } catch { return; }
  await refused(create('enlace.txt', 'src')); // it exists as a link: «wx» refuses and never follows it
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('se niega mientras una tarea trabaja en el proyecto o está retenido', async () => {
  const task = board.createTask({ project: 'godmode', title: 'Trabajo', description: 'x' }, 'usuario');
  board.run("UPDATE tasks SET status = 'running' WHERE id = ?", task.id);
  await refused(create('ocupado.txt'), /trabajando|working/);
  assert.ok(!fs.existsSync(path.join(repo, 'ocupado.txt')));
  board.run("UPDATE tasks SET status = 'done' WHERE id = ?", task.id);
  const release = scheduler.hold('godmode');
  await refused(create('retenido.txt'), /trabajando|working/);
  release();
  assert.equal((await create('libre.txt')).path, 'libre.txt');
});

test('un proyecto dentro de core no admite archivos nuevos', async (ctx) => {
  const core = path.join(t.home, 'core', 'dentro'); fs.mkdirSync(core, { recursive: true });
  try { board.addProject({ name: 'coreproj', path: core }, 'usuario', { fromUser: true }); } catch { return ctx.skip('core no se puede registrar como proyecto: ya lo impide el alta'); }
  await refused(call('expert.createFile', { project: 'coreproj', name: 'x.txt' }), /interna|internal/);
  assert.deepEqual(fs.readdirSync(core), []);
});

test('solo la ventana del PC: un móvil enlazado no puede crear archivos', async () => {
  await refused(call('expert.createFile', { project: 'godmode', name: 'movil.txt' }, REMOTE));
  assert.ok(!fs.existsSync(path.join(repo, 'movil.txt')));
});

test('la lectura da la codificación, el BOM y las líneas (campos nuevos; los de siempre siguen)', async () => {
  fs.writeFileSync(path.join(repo, 'tres.txt'), 'a\nb\nc\n');
  const r = await call('expert.read', { project: 'godmode', path: 'tres.txt' });
  assert.equal(r.text, 'a\nb\nc\n'); assert.equal(r.size, 6); assert.equal(r.binary, false);
  assert.deepEqual([r.encoding, r.bom, r.lines], ['utf-8', false, 3]);
  fs.writeFileSync(path.join(repo, 'bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hola')]));
  const b = await call('expert.read', { project: 'godmode', path: 'bom.txt' });
  assert.deepEqual([b.encoding, b.bom, b.lines], ['utf-8', true, 1]);
  fs.writeFileSync(path.join(repo, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  assert.equal((await call('expert.read', { project: 'godmode', path: 'latin.txt' })).encoding, 'unknown');
  fs.writeFileSync(path.join(repo, 'vacio.txt'), '');
  assert.equal((await call('expert.read', { project: 'godmode', path: 'vacio.txt' })).lines, 0);
  fs.writeFileSync(path.join(repo, 'grande.txt'), 'é'.repeat(300 * 1024));
  const g = await call('expert.read', { project: 'godmode', path: 'grande.txt' });
  assert.equal(g.cut, true); assert.equal(g.lines, null); assert.equal(g.encoding, 'utf-8');
});
