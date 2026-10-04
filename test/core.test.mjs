// Core rules: assistant folder, settings, projects, task approvals, worker permissions, usage caps, undo and secrets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { tempHome } from './helpers.mjs';
import { createHome, folderName, isHome } from '../src/core/home.mjs';
import { PRODUCT } from '../src/core/product.mjs';
import { ctx, saveConfig } from '../src/core/context.mjs';
import { Board, checkProjectPath } from '../src/core/board.mjs';
import { createProject, syncProjects } from '../src/core/projects.mjs';
import { detectSensitivity, verify } from '../src/core/approval.mjs';
import { canLaunch, parseReset, startCooldown, isLimitText } from '../src/core/budget.mjs';
import { takeCheckpoint, snapshotCommit, undoCheckpoint } from '../src/core/workspace.mjs';
import { isSecretPath, redactSecrets } from '../src/core/safety.mjs';

let t; let board; let project;
before(() => { t = tempHome(); board = new Board(); project = createProject(board, { name: 'web' }, 'usuario'); });
after(() => t.cleanup());

test('el primer arranque crea la carpeta del asistente con todo lo necesario', () => {
  for (const f of ['orb.json', '.orb/datos/clave.bin', '.orb/ejecuciones', '.orb/copias', 'bitacoras/GENERAL.md', 'bitacoras/proyectos']) assert.ok(fs.existsSync(path.join(t.home, f)), f);
  assert.equal(fs.statSync(path.join(t.home, '.orb/datos/clave.bin')).size, 32);
  assert.equal(ctx.paths.projects, t.home, 'los proyectos van directamente en la carpeta del asistente');
  assert.equal(ctx.config.assistantName, 'Orb');
  // Reusing an existing home, and refusing a non-empty folder that is not one.
  assert.equal(createHome(t.home).home, t.home);
  fs.mkdirSync(path.join(t.base, 'Otro')); fs.writeFileSync(path.join(t.base, 'Otro', 'x.txt'), '1');
  assert.throws(() => createHome(t.base, { assistantName: 'Otro' }), /no está vacía/);
  assert.ok(isHome(t.home));
});

test('los nombres se convierten en nombres de carpeta válidos en Windows', () => {
  assert.equal(folderName('Mi: proyecto?*'), 'Mi proyecto');
  assert.equal(folderName('CON'), PRODUCT.assistant);
  assert.equal(folderName('  ..  '), PRODUCT.assistant);
});

test('los ajustes se validan antes de guardarse', () => {
  assert.throws(() => saveConfig({ maxParallel: 0 }), /maxParallel/);
  assert.throws(() => saveConfig({ secreto: 1 }), /desconocidos/);
  assert.throws(() => saveConfig({ orchestrator: { model: 'otro' } }), /modelo del asistente/);
  assert.throws(() => saveConfig({ mcpServers: [{ name: 'orb', command: 'x' }] }), /no válido/);
  assert.throws(() => saveConfig({ agents: { claude: { path: 'claude' } } }), /absoluta/);
  assert.throws(() => saveConfig({ agents: { claude: { path: path.join(t.home, 'no-existe') } } }), /no existe/);
  const c = saveConfig({ orchestrator: { model: 'claude-opus-5-5', orchestrate: false } });
  assert.equal(c.orchestrator.model, 'claude-opus-5-5');
  saveConfig({ orchestrator: { model: 'claude-sonnet-5-5', orchestrate: true } });
});

test('los proyectos nuevos son carpetas directas de la del asistente, con git, .gitignore y bitácora fuera del repositorio', () => {
  assert.equal(project.path, fs.realpathSync(path.join(t.home, 'web')));
  assert.throws(() => createProject(board, { name: 'bitacoras' }, 'usuario'), /reservado/);
  assert.ok(fs.existsSync(path.join(project.path, '.git')));
  assert.match(fs.readFileSync(path.join(project.path, '.gitignore'), 'utf8'), /\.env/);
  assert.ok(fs.existsSync(board.projectLogFile('web')));
  assert.ok(!board.projectLogFile('web').startsWith(project.path));
});

test('un agente solo registra carpetas dentro de la del asistente; el usuario puede vincular otras salvo las internas', () => {
  const outside = fs.mkdtempSync(path.join(t.base, 'fuera-'));
  assert.throws(() => board.addProject({ name: 'x', path: outside }, 'claude'), /fuera de la carpeta/);
  assert.equal(board.addProject({ name: 'x', path: outside }, 'usuario', { fromUser: true }).name, 'x');
  assert.equal(board.addProject({ name: 'otro nombre', path: outside }, 'usuario', { fromUser: true }).name, 'x', 'una carpeta, un proyecto');
  assert.throws(() => checkProjectPath(t.home, { fromUser: true }), /es la carpeta de/);
  assert.throws(() => checkProjectPath(path.join(t.home, '.orb'), { fromUser: true }), /interna/);
  assert.throws(() => checkProjectPath(path.join(t.home, 'bitacoras'), { fromUser: true }), /interna/);
  assert.throws(() => checkProjectPath(t.base, { fromUser: true }), /contiene/);
  assert.throws(() => board.addProject({ name: 'web', path: outside }, 'orb'), /otra carpeta/);
});

test('las carpetas creadas a mano en la del asistente aparecen como proyectos y desaparecen al borrarlas', () => {
  fs.mkdirSync(path.join(t.home, 'webviaproject'));
  assert.equal(syncProjects(board), true);
  assert.equal(board.project('webviaproject').path, fs.realpathSync(path.join(t.home, 'webviaproject')));
  assert.equal(syncProjects(board), false, 'sin cambios la segunda vez');
  assert.ok(!board.project('bitacoras') && !board.project('.orb'));
  fs.rmSync(path.join(t.home, 'webviaproject'), { recursive: true });
  assert.equal(syncProjects(board), true);
  assert.equal(board.project('webviaproject'), undefined);
});

test('aprobaciones: palabras de riesgo, tareas de agentes y razonamiento alto esperan; lo normal va a la cola', () => {
  assert.equal(board.createTask({ project: 'web', title: 'Página', description: 'Haz la portada. No hagas push.' }, 'orb').status, 'queued');
  const risky = board.createTask({ project: 'web', title: 'Publicar', description: 'despliega la web' }, 'orb');
  assert.equal(risky.status, 'awaiting_approval'); assert.deepEqual(risky.sensitivity, ['publish']);
  const byAgent = board.createTask({ project: 'web', title: 'x', description: 'algo' }, 'codex');
  assert.ok(byAgent.sensitivity.includes('creada_por_agente'));
  const high = board.createTask({ project: 'web', title: 'difícil', description: 'algo', agent: 'claude', model: 'opus', reasoning: 'high' }, 'orb');
  assert.ok(high.sensitivity.includes('razonamiento_alto'));
  const user = board.createTask({ project: 'web', title: 'borrar', description: 'borra los temporales' }, 'usuario');
  assert.equal(user.status, 'awaiting_approval', 'también las del usuario esperan su clic en Aprobar');
  assert.throws(() => board.createTask({ project: 'web', title: 'x', description: 'y', agent: 'claude', model: 'gpt-9' }, 'orb'), /no tiene el modelo/);
});

test('una aprobación firmada deja de valer si la tarea cambia', () => {
  const task = board.createTask({ project: 'web', title: 'Publicar 2', description: 'publica el blog', agent: 'claude' }, 'orb');
  assert.throws(() => board.approve(task.id, 'approved', 'usuario', 'huella-vieja'), /cambió/);
  const ok = board.approve(task.id, 'approved', 'usuario', board.previewHash(task));
  assert.equal(ok.status, 'queued'); assert.ok(verify(board.key, ok));
  // Someone edits the database by hand: the scheduler sends it back to approval.
  board.run('UPDATE tasks SET description = ? WHERE id = ?', 'publica y borra todo', task.id);
  assert.ok(board.revalidateQueued().includes(task.id));
  assert.equal(board.task(task.id).status, 'awaiting_approval');
});

test('un agente solo cierra su propia tarea en curso y no puede reasignarla', () => {
  const task = board.createTask({ project: 'web', title: 'mía', description: 'algo', agent: 'codex' }, 'orb');
  board.patch(task.id, { status: 'running', assigned_to: 'codex' }, 'orb');
  assert.throws(() => board.updateTask(task.id, { status: 'done' }, 'claude'), /no es tuya/);
  assert.throws(() => board.updateTask(task.id, { status: 'queued' }, 'codex'), /solo puede cerrar/);
  assert.throws(() => board.updateTask(task.id, { model: 'x' }, 'codex'), /solo Orb/);
  assert.throws(() => board.updateTask(task.id, { status: 'done' }, 'codex', { taskId: '999' }), /tu tarea es la #999/);
  assert.equal(board.updateTask(task.id, { status: 'done', result: 'hecho' }, 'codex', { taskId: String(task.id) }).status, 'done');
  assert.throws(() => board.updateTask(task.id, { status: 'queued' }, 'orb'), /transición no permitida/);
});

test('el OK del usuario solo acepta tareas hechas, una vez', () => {
  const task = board.createTask({ project: 'web', title: 'ok', description: 'algo' }, 'orb');
  assert.deepEqual(board.accept([task.id], 'usuario'), []);
  board.patch(task.id, { status: 'done' }, 'orb');
  assert.equal(board.accept([task.id], 'usuario').length, 1);
  assert.equal(board.accept([task.id], 'usuario').length, 0);
  assert.ok(board.isAccepted(task.id));
});

test('la red de palabras ignora las negaciones de su propia frase', () => {
  assert.deepEqual(detectSensitivity('No hagas push ni borres nada'), []);
  assert.deepEqual(detectSensitivity('No cambies el diseño, publica la web y borra lo viejo').sort(), ['destructive', 'publish']);
  assert.deepEqual(detectSensitivity('lee el token del .env'), ['credential_access']);
});

test('cupo: tope por ventana, enfriamiento al agotar el límite y lectura de la hora de reinicio', () => {
  for (let i = 0; i < 6; i++) board.event(null, 'orb', 'task.launch_options', JSON.stringify({ agent: 'codex', model: null }));
  assert.equal(canLaunch(board, 'codex', null).ok, false);
  assert.equal(canLaunch(board, 'claude', null).ok, true);
  assert.ok(isLimitText("You've hit your usage limit · resets 5pm"));
  const now = new Date('2026-10-04T10:00:00');
  assert.equal(new Date(parseReset('resets 5pm', now)).getHours(), 17);
  assert.equal(parseReset('reset in 2 hours', now), now.getTime() + 7_200_000);
  startCooldown(board, 'claude', 'resets in 1 hours');
  assert.match(canLaunch(board, 'claude', null).reason, /sin cupo/);
});

test('deshacer devuelve solo los archivos que cambió la tarea y respeta los cambios posteriores', () => {
  const dir = project.path;
  fs.writeFileSync(path.join(dir, 'a.txt'), 'original');
  const before = takeCheckpoint(dir, 'prueba', ctx.paths.checkpoints);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'cambiado por la tarea');
  fs.writeFileSync(path.join(dir, 'nuevo.txt'), 'creado');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'de la tarea');
  const after = { commit: snapshotCommit(dir, { always: true }).commit };
  fs.writeFileSync(path.join(dir, 'b.txt'), 'el usuario lo tocó después');
  const out = undoCheckpoint(before, after);
  assert.deepEqual(out.restored, ['a.txt']); assert.deepEqual(out.removed, ['nuevo.txt']); assert.deepEqual(out.skipped, ['b.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'original');
});

test('los archivos secretos nunca entran en commits y los secretos se ocultan en los textos', () => {
  for (const f of ['.env', 'config/.env.local', 'id_rsa', 'cert.pem', 'datos/clave.bin', 'BITACORA.md', 'x/credentials.json']) assert.ok(isSecretPath(f), f);
  assert.ok(!isSecretPath('.env.example'));
  assert.equal(redactSecrets('token ghp_abcdefghijklmnopqrstu y sk-1234567890abc'), 'token [secreto oculto] y [secreto oculto]');
});

test('una carpeta de la versión de prueba (jarvis.json, .jarvis) pasa a Orb.dev al abrirla', async () => {
  const { migrateOldHome } = await import('../src/core/home.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-migra-'));
  try {
    fs.mkdirSync(path.join(dir, '.jarvis', 'datos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'jarvis.json'), '{}'); fs.writeFileSync(path.join(dir, '.jarvis', 'datos', 'jarvis.db'), 'db');
    assert.equal(isHome(dir), true);
    assert.ok(fs.existsSync(path.join(dir, 'orb.json')) && fs.existsSync(path.join(dir, '.orb', 'datos', 'orb.db')));
    assert.equal(migrateOldHome(dir), false, 'solo una vez');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-15-'));
    fs.writeFileSync(path.join(other, 'jarvis.json'), '{}'); // something else (e.g. Jarvis 1.5): not touched
    assert.equal(isHome(other), false); assert.ok(fs.existsSync(path.join(other, 'jarvis.json')));
    fs.rmSync(other, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
