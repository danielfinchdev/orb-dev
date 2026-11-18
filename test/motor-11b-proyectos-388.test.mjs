// 3.8.8 paso 11b (tanda 4A), motor de Proyectos: crear solo la carpeta (sin plantilla ni git), cambiar un proyecto de
// categoría (mueve la carpeta con sus rutas guardadas y se niega en cada caso) y «Ordenar carpetas» a demanda.
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

const REMOTE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('projects.create: sin el parámetro crea la plantilla y el repositorio; con template:false, solo la carpeta vacía', async () => {
  const full = await call('projects.create', { name: 'con-git', category: 'web' });
  assert.ok(fs.existsSync(path.join(full.path, '.git')));
  assert.ok(fs.existsSync(path.join(full.path, '.gitignore')));
  const bare = await call('projects.create', { name: 'solo-carpeta', category: 'web', template: false });
  assert.equal(bare.path, path.join(t.home, 'web', 'solo-carpeta'));
  assert.deepEqual(fs.readdirSync(bare.path), [], 'sin .git ni archivos');
  assert.ok((await call('projects.list')).some((p) => p.name === 'solo-carpeta'));
  // multi sin plantilla: tampoco subcarpetas de plataforma ni LEEME
  const multi = await call('projects.create', { name: 'multi-vacio', category: 'multi', platforms: ['web', 'android'], template: false });
  assert.deepEqual(fs.readdirSync(multi.path), []);
  // un nombre malo se sigue negando
  await assert.rejects(() => call('projects.create', { name: 'mal/nombre', category: 'web', template: false }), /no puede llevar/);
});

test('projects.setCategory: solo la ventana del PC; mueve la carpeta y las rutas guardadas', async () => {
  const p = await call('projects.create', { name: 'viajero', category: 'web' });
  await assert.rejects(() => call('projects.setCategory', { name: 'viajero', category: 'windows' }, REMOTE));
  const task = board.createTask({ project: 'viajero', title: 'Hola', description: 'x', agent: 'claude' }, 'usuario');
  board.run("UPDATE tasks SET status = 'done', workdir = ?, project_path = ? WHERE id = ?", path.join(p.path, 'src'), p.path, task.id);
  board.run("INSERT INTO sessions (id, project, cwd, status, kind, agent, title, created_at, updated_at) VALUES ('s-viajero', 'viajero', ?, 'closed', 'chat', 'claude', 't', 'x', 'x')", p.path);
  const r = await call('projects.setCategory', { name: 'viajero', category: 'windows' });
  const target = path.join(t.home, 'windows', 'viajero');
  assert.equal(r.moved, true); assert.equal(r.category, 'windows'); assert.equal(r.path, target);
  assert.ok(fs.existsSync(path.join(target, '.git')) && !fs.existsSync(p.path), 'la carpeta está en un solo sitio');
  assert.equal(board.task(task.id).workdir, path.join(target, 'src'));
  assert.equal(board.task(task.id).project_path, target);
  assert.equal(board.one("SELECT cwd FROM sessions WHERE id = 's-viajero'").cwd, target);
  const listed = (await call('projects.list')).find((x) => x.name === 'viajero');
  assert.equal(listed.path, target); assert.equal(listed.category, 'windows');
  // el proyecto sigue funcionando: se puede volver a cambiar de categoría y la misma otra vez no hace nada
  assert.equal((await call('projects.setCategory', { name: 'viajero', category: 'windows' })).moved, false);
  assert.equal((await call('projects.setCategory', { name: 'viajero', category: 'web' })).path, p.path);
});

test('projects.setCategory: se niega con trabajo en curso, destino existente, categoría mala, multi y carpeta vinculada', async () => {
  const p = await call('projects.create', { name: 'quieto', category: 'web' });
  const keep = () => assert.ok(fs.existsSync(p.path) && board.project('quieto').path === p.path, 'no se ha movido nada');
  // trabajo en curso
  const task = board.createTask({ project: 'quieto', title: 'Hola', description: 'x', agent: 'claude' }, 'usuario');
  await assert.rejects(() => call('projects.setCategory', { name: 'quieto', category: 'linux' }), /trabajando/); keep();
  board.run("UPDATE tasks SET status = 'done' WHERE id = ?", task.id);
  board.run("INSERT INTO sessions (id, project, cwd, status, kind, agent, title, created_at, updated_at) VALUES ('s-quieto', 'quieto', ?, 'running', 'chat', 'claude', 't', 'x', 'x')", p.path);
  await assert.rejects(() => call('projects.setCategory', { name: 'quieto', category: 'linux' }), /trabajando/); keep();
  board.run("UPDATE sessions SET status = 'closed' WHERE id = 's-quieto'");
  // destino que ya existe
  fs.mkdirSync(path.join(t.home, 'linux', 'quieto'), { recursive: true });
  await assert.rejects(() => call('projects.setCategory', { name: 'quieto', category: 'linux' }), /ya existe/); keep();
  // categorías no válidas: nombres de carpeta, escapes, reservados, vacía
  for (const bad of ['', 'core', '..', '../fuera', 'web\\x', 'con', 'otra', 'C:\\']) await assert.rejects(() => call('projects.setCategory', { name: 'quieto', category: bad }), undefined, bad || 'vacía');
  keep();
  // multi: ni entra ni sale
  await assert.rejects(() => call('projects.setCategory', { name: 'quieto', category: 'multi' }), /multi/); keep();
  const m = await call('projects.create', { name: 'varios', category: 'multi', platforms: ['web', 'android'] });
  await assert.rejects(() => call('projects.setCategory', { name: 'varios', category: 'web' }), /multi/);
  assert.ok(fs.existsSync(path.join(m.path, 'web')));
  // una carpeta vinculada de fuera de Orb no se mueve
  const outside = path.join(t.base, 'fuera-de-orb'); fs.mkdirSync(outside);
  await call('projects.import', { name: 'vinculado', folder: outside });
  await assert.rejects(() => call('projects.setCategory', { name: 'vinculado', category: 'web' }), /vinculada/);
  assert.ok(fs.existsSync(outside));
  await assert.rejects(() => call('projects.setCategory', { name: 'no-existe', category: 'web' }));
});

test('projects.setCategory: si falla la base de datos la carpeta vuelve a su sitio', async () => {
  const p = await call('projects.create', { name: 'roto', category: 'web' });
  const real = board.transaction.bind(board);
  board.transaction = () => { throw new Error('disco lleno'); };
  try { await assert.rejects(() => call('projects.setCategory', { name: 'roto', category: 'linux' }), /disco lleno/); } finally { board.transaction = real; }
  assert.ok(fs.existsSync(path.join(p.path, '.git')) && !fs.existsSync(path.join(t.home, 'linux', 'roto')));
  assert.equal(board.project('roto').path, p.path);
});

test('projects.setCategory: se niega si el nombre de la carpeta está reservado en la categoría de destino', async () => {
  const folder = path.join(t.home, 'web', 'adb-tools'); fs.mkdirSync(folder, { recursive: true });
  await call('projects.import', { name: 'reservado', folder });
  await assert.rejects(() => call('projects.setCategory', { name: 'reservado', category: 'android' }), /reservado/);
  assert.ok(fs.existsSync(folder) && !fs.existsSync(path.join(t.home, 'android', 'adb-tools', 'x')));
  assert.equal(board.project('reservado').path, folder, 'no se ha movido nada');
});

test('projects.setCategory: si falla la base de datos y la carpeta no vuelve, el error dice dónde ha quedado', async () => {
  const p = await call('projects.create', { name: 'varado', category: 'web' });
  const real = board.transaction.bind(board);
  const fsReal = fs.renameSync;
  const target = path.join(t.home, 'linux', 'varado');
  board.transaction = () => { throw new Error('disco lleno'); };
  // the way back fails (something took the old place); only this test's own folders are involved
  fs.renameSync = (from, to) => { if (path.resolve(from) === path.resolve(target)) throw new Error('bloqueada'); return fsReal(from, to); };
  try {
    await assert.rejects(() => call('projects.setCategory', { name: 'varado', category: 'linux' }), (e) => e.message.includes(target) && e.message.includes(p.path));
  } finally { board.transaction = real; fs.renameSync = fsReal; }
  assert.ok(fs.existsSync(target), 'the folder is where the error says');
  assert.equal(board.project('varado').path, p.path, 'the database still has the old path');
});

test('«Ordenar carpetas» a demanda: el mismo plan del arranque, solo en el PC, y no se aplica con trabajo en curso', async () => {
  await assert.rejects(() => call('projects.layoutPlan', {}, REMOTE));
  const none = await call('projects.layoutPlan');
  assert.equal(none.pending, false); assert.equal(none.busy, false);
  assert.deepEqual(none.items, (await call('app.layoutPlan')).items);
  // lo que dejó una versión anterior arriba del todo: el plan lo ve y es el de app.layoutPlan
  fs.mkdirSync(path.join(t.home, 'android', 'adb-tools'), { recursive: true });
  const plan = await call('projects.layoutPlan');
  assert.equal(plan.pending, true);
  assert.ok(plan.items.some((i) => i.kind === 'adb'));
  assert.equal(plan.home, (await call('app.layoutPlan')).home);
  // con una tarea en curso no se aplica nada
  const p = await call('projects.create', { name: 'ocupado', category: 'web' });
  const task = board.createTask({ project: p.name, title: 'Hola', description: 'x', agent: 'claude' }, 'usuario');
  assert.equal((await call('projects.layoutPlan')).busy, true);
  await assert.rejects(() => call('projects.layoutApply', { choices: {} }), /trabajando/);
  assert.ok(fs.existsSync(path.join(t.home, 'android', 'adb-tools')), 'no se movió nada');
  await assert.rejects(() => call('projects.layoutApply', { choices: {} }, REMOTE));
  // sin trabajo, se aplica con «Conservar» y queda ordenado (nada pendiente)
  board.run("UPDATE tasks SET status = 'done' WHERE id = ?", task.id);
  const done = await call('projects.layoutApply', { choices: { adb: 'keep' } });
  assert.equal(done.pending, false);
  assert.ok(fs.existsSync(path.join(t.home, 'android', 'adb-tools')));
});
