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
import { spawn } from 'node:child_process';
import { finishProject, reopenProject, finishedProjects, deletableFolder, checkDelete, deleteProject, abortDelete, settleDeleting, deletingProjects, folderInUse, TICKET_MS } from '../src/core/project-close.mjs';
import { paths } from '../src/core/home.mjs';
import { ctx } from '../src/core/context.mjs';
import { readLog } from '../src/engine/logs.mjs';
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
  // Its rows wait under a name no project can have («:»), so a new «tienda» would start clean.
  assert.equal(board.task(queued.id).project, 'tienda: finalizado');
  assert.equal(board.one('SELECT project FROM schedules WHERE id = ?', sched.id).project, 'tienda: finalizado');
  // The sync (every 5 s, and each list) does not bring it back.
  syncProjects(board); syncProjects(board);
  assert.ok(!names().includes('tienda'), 'la sincronización no lo vuelve a añadir');
  const [item] = finishedProjects(board);
  assert.deepEqual([item.name, item.category, item.path], ['tienda', 'web', p.path]);
  // Reopened: listed again, its schedule back on.
  assert.equal(reopenProject(board, item.key, 'usuario').name, 'tienda');
  assert.ok(names().includes('tienda'));
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', sched.id).enabled, 1);
  assert.equal(board.task(queued.id).project, 'tienda');
  assert.equal(board.conversation(conv).project, 'tienda');
  assert.equal(finishedProjects(board).length, 0);
  assert.throws(() => reopenProject(board, item.key, 'usuario'), /no está entre los finalizados/);
});

test('Finalizar y Eliminar se niegan mientras algo del proyecto trabaja', () => {
  createProject(board, { name: 'ocupado', category: 'windows' }, 'usuario');
  const running = task('ocupado'); board.patch(running.id, { status: 'running' }, 'codex', 'task.claimed');
  assert.throws(() => finishProject(board, 'ocupado', 'usuario'), /tiene tareas o conversaciones trabajando/);
  assert.throws(() => checkDelete(board, t.home, 'ocupado'), /tiene tareas o conversaciones trabajando/);
  assert.throws(() => deleteProject(board, t.home, 'ocupado', 'usuario'), /ya no está en curso/, 'sin la comprobación, nada');
  assert.ok(fs.existsSync(path.join(t.home, 'windows', 'ocupado')) && names().includes('ocupado'), 'nada cambió');
  board.patch(running.id, { status: 'done' }, 'codex', 'task.updated');
  // A coordinator in the middle of a turn in one of its conversations (it could create a task right after).
  const busy = (name) => name === 'ocupado';
  assert.throws(() => finishProject(board, 'ocupado', 'usuario', { busy }), /trabajando/);
  assert.throws(() => checkDelete(board, t.home, 'ocupado', { busy }), /trabajando/);
  assert.equal(deletingProjects(board).length, 0);
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

test('Eliminar: a la papelera (main.mjs) o para siempre, con el ticket de la comprobación; sale de Orb con sus programadas', () => {
  const a = createProject(board, { name: 'papelera', category: 'web' }, 'usuario');
  const q = task('papelera');
  createSchedule(board, { project: 'papelera', title: 'Cada día', description: 'x', every: 'daily', at_time: '09:00' }, 'usuario');
  const { ticket } = checkDelete(board, t.home, 'papelera');
  assert.equal(board.task(q.id).status, 'cancelled', 'lo pendiente, cancelado al comprobar');
  // trashed: the folder must already be gone.
  assert.throws(() => deleteProject(board, t.home, 'papelera', 'usuario', { ticket, trashed: true }), /no se ha eliminado nada/);
  fs.renameSync(a.path, path.join(t.base, 'papelera-de-windows'));
  // The sync meanwhile (every 5 s) does not take it out half-way: the engine still has to finish.
  syncProjects(board);
  assert.ok(names().includes('papelera'));
  assert.throws(() => deleteProject(board, t.home, 'papelera', 'usuario', { ticket: 'f'.repeat(48), trashed: true }), /ya no está en curso/, 'otro ticket no vale');
  deleteProject(board, t.home, 'papelera', 'usuario', { ticket, trashed: true });
  assert.ok(!names().includes('papelera'));
  assert.equal(board.one("SELECT COUNT(*) AS n FROM schedules WHERE project LIKE 'papelera%'").n, 0);
  assert.equal(board.task(q.id).project, 'papelera: eliminado', 'su historial no pasa a un proyecto nuevo con el mismo nombre');
  createProject(board, { name: 'papelera', category: 'web' }, 'usuario');
  assert.equal(board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = 'papelera'").n, 0, 'el nuevo empieza limpio');
  // For good.
  const b = createProject(board, { name: 'parasiempre', category: 'multi', platforms: ['web', 'android'] }, 'usuario');
  const check = checkDelete(board, t.home, 'parasiempre');
  deleteProject(board, t.home, 'parasiempre', 'usuario', { ticket: check.ticket });
  assert.ok(!fs.existsSync(b.path) && !names().includes('parasiempre'));
  syncProjects(board);
  assert.ok(!names().includes('parasiempre'));
});

test('Eliminar: al comprobar no arranca nada del proyecto; cancelar lo devuelve con sus programadas', () => {
  createProject(board, { name: 'carrera', category: 'linux' }, 'usuario');
  const q = task('carrera');
  const s = createSchedule(board, { project: 'carrera', title: 'Cada hora', description: 'x', every: 'hourly' }, 'usuario');
  const paused = createSchedule(board, { project: 'carrera', title: 'Parada', description: 'x', every: 'hourly' }, 'usuario');
  board.run('UPDATE schedules SET enabled = 0 WHERE id = ?', paused.id);
  const { ticket } = checkDelete(board, t.home, 'carrera');
  assert.equal(board.task(q.id).status, 'cancelled');
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', s.id).enabled, 0, 'sus programadas, en pausa');
  assert.ok(board.isDeleting('carrera'));
  assert.throws(() => task('carrera'), /se está eliminando/, 'ni un agente ni una programada crean tareas');
  assert.throws(() => finishProject(board, 'carrera', 'usuario'), /se está eliminando/);
  assert.throws(() => abortDelete(board, 'carrera', 'otro'), /ya no está en curso/);
  abortDelete(board, 'carrera', ticket);
  assert.ok(!board.isDeleting('carrera'));
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', s.id).enabled, 1, 'vuelve la que estaba activa');
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', paused.id).enabled, 0, 'la que ya estaba parada sigue parada');
  assert.throws(() => deleteProject(board, t.home, 'carrera', 'usuario', { ticket }), /ya no está en curso/, 'un ticket sirve una vez');
  task('carrera');
  // A ticket that expired (the window closed half-way): undone while the folder is there, finished once it is gone.
  const second = checkDelete(board, t.home, 'carrera');
  board.settingJson('projects_deleting', deletingProjects(board).map((x) => ({ ...x, until: Date.now() - 1 })));
  syncProjects(board);
  assert.ok(!board.isDeleting('carrera') && names().includes('carrera'));
  assert.equal(board.one('SELECT enabled FROM schedules WHERE id = ?', s.id).enabled, 1);
  assert.throws(() => deleteProject(board, t.home, 'carrera', 'usuario', { ticket: second.ticket, trashed: true }), /ya no está en curso/);
  const third = checkDelete(board, t.home, 'carrera');
  assert.ok(third.ticket && TICKET_MS > 60_000);
  fs.renameSync(path.join(t.home, 'linux', 'carrera'), path.join(t.base, 'carrera-en-la-papelera'));
  settleDeleting(board, t.home, { all: true }); // what the engine does when it starts
  assert.ok(!names().includes('carrera') && !board.isDeleting('carrera'));
  assert.equal(board.one("SELECT COUNT(*) AS n FROM schedules WHERE project LIKE 'carrera%'").n, 0);
});

test('Eliminar para siempre: nunca con la carpeta en uso; con la papelera hecha, lo que trabaja se detiene', { skip: process.platform !== 'win32' }, async () => {
  const p = createProject(board, { name: 'enuso', category: 'web' }, 'usuario');
  fs.writeFileSync(path.join(p.path, 'a.txt'), 'x');
  // A program with its working folder there (a terminal, a dev server, an idle direct conversation).
  const running = task('enuso'); board.patch(running.id, { status: 'done' }, 'codex', 'task.updated');
  // Its working folder is opened by the new process itself while it starts, after `spawn` has fired (a busy PC made the
  // first check see a free folder): wait until its script runs.
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ok"); setTimeout(() => {}, 20000)'], { cwd: p.path, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  await new Promise((r, reject) => { child.stdout.once('data', r); child.once('exit', () => reject(new Error('the child left early'))); });
  try {
    assert.equal(folderInUse(p.path), true);
    const { ticket } = checkDelete(board, t.home, 'enuso');
    assert.throws(() => deleteProject(board, t.home, 'enuso', 'usuario', { ticket }), /Algún programa está usando/);
    assert.ok(fs.existsSync(path.join(p.path, 'a.txt')) && names().includes('enuso'), 'no se ha borrado nada');
    child.kill();
    await new Promise((r) => child.once('exit', r));
    assert.equal(folderInUse(p.path), false);
    assert.ok(!fs.readdirSync(path.dirname(p.path)).some((n) => n.includes('orb-comprobando')), 'la prueba deja la carpeta como estaba');
    // trashed with a task still running (one that started before the mark): it is stopped instead of refused (the
    // folder is already gone).
    board.patch(running.id, { status: 'running' }, 'codex', 'task.claimed');
    fs.renameSync(p.path, path.join(t.base, 'enuso-papelera'));
    const stopped = [];
    deleteProject(board, t.home, 'enuso', 'usuario', { ticket, trashed: true, stop: (n) => stopped.push(n) });
    assert.deepEqual(stopped, ['enuso']);
    assert.equal(board.task(running.id).status, 'cancelled');
    assert.ok(!names().includes('enuso'));
  } finally { child.kill(); }
});

test('Reabrir con otro nombre: su historial y sus programadas vuelven con él, no pasan al proyecto que tomó el nombre', () => {
  const old = createProject(board, { name: 'gemelo', category: 'web' }, 'usuario');
  const q = task('gemelo'); board.patch(q.id, { status: 'done' }, 'codex', 'task.updated');
  const s = createSchedule(board, { project: 'gemelo', title: 'Diaria', description: 'x', every: 'daily', at_time: '08:00' }, 'usuario');
  fs.appendFileSync(board.projectLogFile('gemelo'), '\n### entrada vieja\n');
  finishProject(board, 'gemelo', 'usuario', { category: 'web' });
  // Another project takes the name meanwhile: it does not inherit the old one's history, schedules or log.
  createProject(board, { name: 'gemelo', category: 'android' }, 'usuario');
  assert.equal(board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = 'gemelo'").n, 0);
  assert.equal(board.one("SELECT COUNT(*) AS n FROM schedules WHERE project = 'gemelo'").n, 0);
  assert.ok(!fs.readFileSync(board.projectLogFile('gemelo'), 'utf8').includes('entrada vieja'));
  const item = finishedProjects(board).find((x) => x.path === old.path);
  const back = reopenProject(board, item.key, 'usuario');
  assert.equal(back.name, 'gemelo (web)');
  assert.equal(board.task(q.id).project, 'gemelo (web)');
  assert.deepEqual({ ...board.one('SELECT project, enabled FROM schedules WHERE id = ?', s.id) }, { project: 'gemelo (web)', enabled: 1 }, 'su programada vuelve, con su nombre nuevo');
  assert.ok(fs.readFileSync(board.projectLogFile('gemelo (web)'), 'utf8').includes('entrada vieja'), 'y su bitácora');
});

test('un finalizado cuya carpeta falta un momento sigue finalizado cuando vuelve', () => {
  const p = createProject(board, { name: 'disco', category: 'linux' }, 'usuario');
  finishProject(board, 'disco', 'usuario', { category: 'linux' });
  const away = path.join(t.base, 'disco-fuera');
  fs.renameSync(p.path, away);
  syncProjects(board);
  assert.ok(finishedProjects(board).find((x) => x.path === p.path)?.missingSince, 'se queda en la lista');
  fs.renameSync(away, p.path);
  syncProjects(board);
  assert.ok(!names().includes('disco'), 'no vuelve como activo');
  assert.equal(finishedProjects(board).find((x) => x.path === p.path).missingSince, undefined);
  // Missing for longer than a month: it leaves the list.
  fs.renameSync(p.path, away);
  syncProjects(board);
  board.settingJson('projects_finished', finishedProjects(board).map((x) => (x.path === p.path ? { ...x, missingSince: '2020-01-01T00:00:00.000Z' } : x)));
  syncProjects(board);
  assert.ok(!finishedProjects(board).some((x) => x.path === p.path));
});

test('permisos: Finalizar también desde el móvil; Eliminar solo en el PC y con la contraseña maestra', async () => {
  for (const m of ['projects.finish', 'projects.finished', 'projects.reopen']) assert.equal(METHODS[m], 'remote', m);
  for (const m of ['projects.deleteCheck', 'projects.delete', 'projects.deleteAbort']) assert.equal(METHODS[m], 'pc', m);
  assert.ok(UNLOCK_METHODS.has('projects.deleteCheck') && needsUnlock('projects.deleteCheck', {}));
  // The end of the delete takes the one-off ticket of the check instead (a token could expire while the Recycle Bin works).
  for (const m of ['projects.delete', 'projects.deleteAbort']) assert.equal(needsUnlock(m, {}), false, m);
  assert.equal(needsUnlock('projects.finish', {}), false);
  const h = tempHome();
  const e = await startEngine(h.home);
  try {
    await e.call('projects.create', { name: 'motor', category: 'web' });
    await assert.rejects(e.call('projects.deleteCheck', { name: 'motor' }), /Crea primero la contraseña maestra/);
    const { unlock } = await e.call('master.create', { password: 'una frase larga de prueba' });
    for (const params of [{ name: 'motor' }, { name: 'motor', unlock: 'f'.repeat(48) }]) {
      await assert.rejects(e.call('projects.deleteCheck', params), /necesita tu contraseña maestra/);
    }
    for (const params of [{ name: 'motor' }, { name: 'motor', ticket: 'f'.repeat(48) }, { name: 'motor', unlock }]) {
      await assert.rejects(e.call('projects.delete', params), /ya no está en curso/, 'sin el ticket de la comprobación, nada');
    }
    assert.ok(fs.existsSync(path.join(h.home, 'web', 'motor')), 'sin la contraseña, nada');
    // 3.8.1: the password is asked again every time: an unlock still good for other actions does not delete a project,
    // and a token made for deleting opens nothing else.
    await assert.rejects(e.call('projects.deleteCheck', { name: 'motor', unlock }), /necesita tu contraseña maestra/, 'un desbloqueo de otra acción no vale');
    assert.equal(await e.call('master.check', { unlock }), true);
    const fresh = (await e.call('master.unlock', { password: 'una frase larga de prueba', purpose: 'deleteProject' })).unlock;
    await assert.rejects(e.call('master.check', { unlock: fresh }), /necesita tu contraseña maestra/, 'el de eliminar no abre otra cosa');
    const check = await e.call('projects.deleteCheck', { name: 'motor', unlock: fresh });
    assert.equal(check.path.toLowerCase(), fs.realpathSync.native(path.join(h.home, 'web', 'motor')).toLowerCase());
    // Cancelled: it works again; checked again and deleted with the ticket (the password token is no longer needed).
    await e.call('projects.deleteAbort', { name: 'motor', ticket: check.ticket });
    await assert.rejects(e.call('projects.delete', { name: 'motor', ticket: check.ticket }), /ya no está en curso/);
    // H1c-fix (B1): the token for deleting is used up by its first check: checking again asks for the password again.
    await assert.rejects(e.call('projects.deleteCheck', { name: 'motor', unlock: fresh }), /necesita tu contraseña maestra/, 'un solo uso');
    const fresh2 = (await e.call('master.unlock', { password: 'una frase larga de prueba', purpose: 'deleteProject' })).unlock;
    const again = await e.call('projects.deleteCheck', { name: 'motor', unlock: fresh2 });
    await e.call('projects.delete', { name: 'motor', ticket: again.ticket });
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

test('la ventana pide la contraseña cada vez para eliminar, aunque haya otro desbloqueo vigente', async () => {
  const { setMasterAsker, keepUnlock, dropUnlock, unlockCore, heldUnlock } = await import('../src/ui/lib/core-access.js');
  const asked = [];
  setMasterAsker(async (action, opts) => { asked.push([action, Boolean(opts?.fresh)]); return { unlock: `token-${action}`, until: Date.now() + 120_000 }; });
  try {
    keepUnlock({ unlock: 'general', until: Date.now() + 300_000 });
    assert.equal(await unlockCore('open'), 'general', 'lo demás usa el desbloqueo de 5 minutos');
    assert.equal(await unlockCore('deleteProject'), 'token-deleteProject');
    assert.equal(await unlockCore('deleteProject'), 'token-deleteProject');
    assert.deepEqual(asked, [['deleteProject', true], ['deleteProject', true]], 'se pide las dos veces');
    assert.equal(heldUnlock(), 'general', 'el token de eliminar no se guarda para otra acción');
  } finally { dropUnlock(); setMasterAsker(null); }
});

test('bitácora: movida a core, una «bitacora» que reaparece arriba no la sustituye; «GENERAL.md» por su nombre es la general', () => {
  const h = tempHome();
  try {
    const top = path.join(h.home, 'bitacora');
    const inCore = path.join(h.home, 'core', 'bitacora');
    fs.rmSync(inCore, { recursive: true, force: true });
    fs.mkdirSync(top, { recursive: true });
    assert.equal(paths(h.home).logs, top, 'sin decidir y sin la de core: se usa la de arriba');
    fs.writeFileSync(path.join(h.home, 'core', 'carpetas.json'), JSON.stringify({ v: 1, decided: { bitacora: 'move' }, logsAsked: 2 }));
    assert.equal(paths(h.home).logs, inCore, 'decidido moverla: siempre core');
    fs.writeFileSync(path.join(h.home, 'core', 'carpetas.json'), JSON.stringify({ v: 1, decided: {} }));
    fs.mkdirSync(inCore, { recursive: true });
    assert.equal(paths(h.home).logs, top, 'una carpeta vacía en core no cuenta');
    fs.writeFileSync(path.join(inCore, 'GENERAL.md'), '# General\n');
    assert.equal(paths(h.home).logs, inCore, 'sin decidir, con la general ya en core (un espacio nuevo): core');
    fs.writeFileSync(path.join(h.home, 'core', 'carpetas.json'), JSON.stringify({ v: 1, decided: { bitacora: 'keep' }, logsAsked: 2 }));
    assert.equal(paths(h.home).logs, top, 'la dejó arriba: se respeta');
    fs.rmSync(top, { recursive: true });
    fs.writeFileSync(ctx.paths.generalLog, '# General\n\n### una entrada\n');
    assert.match(readLog(board, 'general', { file: 'GENERAL.md' }), /una entrada/);
  } finally { h.cleanup(); }
});
