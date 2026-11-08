// 3.8.1: the end of a project (src/core/project-close.mjs): «Finalizar proyecto» (it leaves Orb, its folder stays, the
// sync does not bring it back, «Reabrir» lists it again) and «Eliminar proyecto» (its folder goes; the master password
// and this PC only; never anything but a project folder of a category, also through a junction or a link).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome, startEngine } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createProject, syncProjects } from '../src/core/projects.mjs';
import { createSchedule } from '../src/core/schedules.mjs';
import { finishProject, reopenProject, finishedProjects, deletableFolder, checkDelete, deleteProject } from '../src/core/project-close.mjs';
import { METHODS, UNLOCK_METHODS, needsUnlock } from '../src/core/permissions.mjs';

let t; let board;
before(() => { t = tempHome(); board = new Board(); });
after(() => t.cleanup());
const names = () => board.projects().map((p) => p.name);
const task = (project, extra = {}) => board.createTask({ project, title: 'Algo', description: 'Haz algo', launch: 'manual', agent: 'codex', ...extra }, 'usuario');

test('Finalizar: todo se da por cerrado, deja de aparecer aunque su carpeta siga y «Reabrir» lo devuelve', () => {
  const p = createProject(board, { name: 'tienda', category: 'web' }, 'usuario');
  const queued = task('tienda'); const failed = task('tienda'); board.patch(failed.id, { status: 'failed' }, 'codex', 'task.updated');
  const conv = board.createConversation({ title: 'De la tienda', project: 'tienda' }).id;
  const sched = createSchedule(board, { project: 'tienda', title: 'Revisar', description: 'Revisa', every: 'daily', at_time: '09:00' }, 'usuario');
  board.setActiveProject('tienda', 'usuario');
  finishProject(board, 'tienda', 'usuario', { category: 'web' });
  assert.ok(!names().includes('tienda'));
  assert.ok(fs.existsSync(path.join(p.path, '.git')), 'la carpeta se queda');
  assert.equal(board.task(queued.id).status, 'cancelled', 'lo pendiente no se lanzará');
  assert.equal(board.task(failed.id).status, 'failed');
  assert.deepEqual(board.settingJson('sidebar_completed').slice(0, 2).sort(), [`t${failed.id}`, `t${queued.id}`].sort(), 'en «Completadas»');
  assert.equal(board.conversation(conv).status, 'done');
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', sched.id).enabled, 0, 'su programada, en pausa');
  assert.equal(board.activeName(), '');
  // The sync (every 5 s, and each list) does not bring it back.
  syncProjects(board); syncProjects(board);
  assert.ok(!names().includes('tienda'), 'la sincronización no lo vuelve a añadir');
  const [item] = finishedProjects(board);
  assert.deepEqual([item.name, item.category, item.path], ['tienda', 'web', p.path]);
  // Reopened: listed again, its schedule back on.
  assert.equal(reopenProject(board, item.key, 'usuario').name, 'tienda');
  assert.ok(names().includes('tienda'));
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', sched.id).enabled, 1);
  assert.equal(finishedProjects(board).length, 0);
  assert.throws(() => reopenProject(board, item.key, 'usuario'), /no está entre los finalizados/);
});

test('Finalizar y Eliminar se niegan mientras algo del proyecto trabaja', () => {
  createProject(board, { name: 'ocupado', category: 'windows' }, 'usuario');
  const running = task('ocupado'); board.patch(running.id, { status: 'running' }, 'codex', 'task.claimed');
  assert.throws(() => finishProject(board, 'ocupado', 'usuario'), /tiene tareas o conversaciones trabajando/);
  assert.throws(() => checkDelete(board, t.home, 'ocupado'), /tiene tareas o conversaciones trabajando/);
  assert.throws(() => deleteProject(board, t.home, 'ocupado', 'usuario'), /trabajando/);
  assert.ok(fs.existsSync(path.join(t.home, 'windows', 'ocupado')) && names().includes('ocupado'), 'nada cambió');
  board.patch(running.id, { status: 'done' }, 'codex', 'task.updated');
});

test('Eliminar: solo una carpeta de proyecto dentro de una categoría, comparada por su ruta real', () => {
  const home = t.home;
  const own = createProject(board, { name: 'borrable', category: 'android' }, 'usuario');
  assert.equal(deletableFolder(home, own.path).toLowerCase(), fs.realpathSync.native(own.path).toLowerCase());
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-fuera-'));
  fs.writeFileSync(path.join(outside, 'importante.txt'), 'no se toca');
  try {
    for (const bad of [home, path.join(home, 'web'), path.join(home, 'core'), path.join(home, 'core', 'datos'), path.join(home, 'web', '..', 'core'), outside, path.join(home, 'web', 'no-existe'), 'relativa\\web\\x']) {
      assert.throws(() => deletableFolder(home, bad), (e) => e.userFacing === true, bad);
    }
    // A junction (or a link) inside a category that leads out of the workspace, or into core.
    const junction = path.join(home, 'web', 'escapa'); fs.symlinkSync(outside, junction, 'junction');
    const intoCore = path.join(home, 'linux', 'nucleo'); fs.symlinkSync(path.join(home, 'core'), intoCore, 'junction');
    for (const bad of [junction, intoCore, path.join(junction, '.')]) assert.throws(() => deletableFolder(home, bad), /Solo se pueden eliminar/, bad);
    // A category that is itself a junction to somewhere else.
    const ios = path.join(home, 'ios'); fs.rmSync(ios, { recursive: true, force: true });
    fs.mkdirSync(path.join(outside, 'app')); fs.symlinkSync(outside, ios, 'junction');
    assert.throws(() => deletableFolder(home, path.join(ios, 'app')), /Solo se pueden eliminar/);
    // A linked folder outside Orb's folder: Orb never deletes it (only «Desvincular»).
    board.addProject({ name: 'enlazado', path: path.join(outside, 'app') }, 'usuario', { fromUser: true });
    assert.throws(() => checkDelete(board, home, 'enlazado'), /Solo se pueden eliminar/);
    assert.equal(fs.readFileSync(path.join(outside, 'importante.txt'), 'utf8'), 'no se toca');
    fs.rmSync(junction); fs.rmSync(intoCore); fs.rmSync(ios); fs.mkdirSync(ios);
    board.removeProject('enlazado', 'usuario');
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  assert.ok(fs.existsSync(path.join(home, 'core', 'orb.json')), 'core intacta');
});

test('Eliminar: a la papelera (main.mjs) o para siempre; sale de Orb con sus programadas', () => {
  const a = createProject(board, { name: 'papelera', category: 'web' }, 'usuario');
  const q = task('papelera');
  createSchedule(board, { project: 'papelera', title: 'Cada día', description: 'x', every: 'daily', at_time: '09:00' }, 'usuario');
  // trashed: the folder must already be gone.
  assert.throws(() => deleteProject(board, t.home, 'papelera', 'usuario', { trashed: true }), /no se ha eliminado nada/);
  fs.renameSync(a.path, path.join(t.base, 'papelera-de-windows'));
  deleteProject(board, t.home, 'papelera', 'usuario', { trashed: true });
  assert.ok(!names().includes('papelera'));
  assert.equal(board.task(q.id).status, 'cancelled');
  assert.equal(board.one("SELECT COUNT(*) AS n FROM schedules WHERE project = 'papelera'").n, 0);
  // For good.
  const b = createProject(board, { name: 'parasiempre', category: 'multi', platforms: ['web', 'android'] }, 'usuario');
  deleteProject(board, t.home, 'parasiempre', 'usuario');
  assert.ok(!fs.existsSync(b.path) && !names().includes('parasiempre'));
  syncProjects(board);
  assert.ok(!names().includes('parasiempre'));
});

test('permisos: Finalizar también desde el móvil; Eliminar solo en el PC y con la contraseña maestra', async () => {
  for (const m of ['projects.finish', 'projects.finished', 'projects.reopen']) assert.equal(METHODS[m], 'remote', m);
  for (const m of ['projects.deleteCheck', 'projects.delete']) { assert.equal(METHODS[m], 'pc', m); assert.ok(UNLOCK_METHODS.has(m) && needsUnlock(m, {}), m); }
  assert.equal(needsUnlock('projects.finish', {}), false);
  const h = tempHome();
  const e = await startEngine(h.home);
  try {
    await e.call('projects.create', { name: 'motor', category: 'web' });
    await assert.rejects(e.call('projects.deleteCheck', { name: 'motor' }), /Crea primero la contraseña maestra/);
    const { unlock } = await e.call('master.create', { password: 'una frase larga de prueba' });
    for (const [method, params] of [['projects.deleteCheck', { name: 'motor' }], ['projects.delete', { name: 'motor' }], ['projects.delete', { name: 'motor', unlock: 'f'.repeat(48) }]]) {
      await assert.rejects(e.call(method, params), /necesita tu contraseña maestra/, method);
    }
    assert.ok(fs.existsSync(path.join(h.home, 'web', 'motor')), 'sin la contraseña, nada');
    const check = await e.call('projects.deleteCheck', { name: 'motor', unlock });
    assert.equal(check.path.toLowerCase(), fs.realpathSync.native(path.join(h.home, 'web', 'motor')).toLowerCase());
    await e.call('projects.delete', { name: 'motor', unlock });
    assert.ok(!fs.existsSync(path.join(h.home, 'web', 'motor')));
    // Finish and reopen through the API.
    await e.call('projects.create', { name: 'acabado', category: 'linux' });
    await e.call('projects.finish', { name: 'acabado' });
    assert.ok(!(await e.call('projects.list')).some((p) => p.name === 'acabado'));
    const [f] = await e.call('projects.finished');
    assert.deepEqual([f.name, f.category], ['acabado', 'linux']);
    assert.equal(await e.call('projects.reopen', { key: f.key }), 'acabado');
    assert.ok((await e.call('projects.list')).some((p) => p.name === 'acabado'));
  } finally { await e.stop(); h.cleanup(); }
});
