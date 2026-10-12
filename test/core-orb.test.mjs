// 3.1, the CORE of Orb (request → tasks → agents → joined work → report): what failed in the real test of 11 Oct 2026
// must not come back. Regression tests with the fake agents; the real check is a run with real agents (see the log).
//  - only agents this PC can run; a queued task for one that is gone moves on by itself
//  - tasks work at the same time: the second writer works in its own copy and Orb joins it into the folder; whoever
//    depends on it waits for that
//  - a permission nobody answers is denied after a while and the agent goes on; the clock does not count that wait
//  - an agent that closes its task and keeps its program open is released
//  - messages between agents reach them while they work
//  - Cursor gets Orb's tools and the guard as its own rules, only for the turn
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome, until, wait, startEngine } from './helpers.mjs';
import { integrateInto, git, snapshotCommit } from '../src/core/workspace.mjs';
import { cursorRules, prepareCursorFolder } from '../src/agents/cursor.mjs';
import { Sessions } from '../src/engine/sessions.mjs';

// ---- pure pieces
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-unir-'));
  const g = (...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  g('init', '-q'); g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\ndos\ntres\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  return { dir, g };
}
// A copy that starts from the folder as it is (like prepareWorkdir) and changes what `change` says.
function copyWith({ dir, g }, change) {
  const base = snapshotCommit(dir, { always: true }).commit;
  const wt = `${dir}-copia`;
  g('worktree', 'add', '-q', '-b', 'orb/1-x', wt, base);
  change(wt);
  spawnSync('git', ['-C', wt, 'add', '-A']); spawnSync('git', ['-C', wt, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'tarea']);
  return { base, tip: git(dir, 'rev-parse', 'orb/1-x').stdout.trim() };
}

test('unir una copia: el trabajo llega a la carpeta sin pisar lo que otra tarea dejó sin commitear', () => {
  const r = repo();
  const { base, tip } = copyWith(r, (wt) => { fs.writeFileSync(path.join(wt, 'a.txt'), 'uno\ndos\ntres\ncuatro\n'); fs.writeFileSync(path.join(wt, 'nuevo.txt'), 'de la copia\n'); });
  fs.writeFileSync(path.join(r.dir, 'otra.txt'), 'de otra tarea, sin commit\n'); // written meanwhile in the folder
  fs.writeFileSync(path.join(r.dir, 'a.txt'), 'UNO\ndos\ntres\n'); // and another change of the same file, other line
  const out = integrateInto(r.dir, { base, tip });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), 'UNO\ndos\ntres\ncuatro\n', 'los dos cambios del mismo archivo');
  assert.equal(fs.readFileSync(path.join(r.dir, 'nuevo.txt'), 'utf8'), 'de la copia\n');
  assert.equal(fs.readFileSync(path.join(r.dir, 'otra.txt'), 'utf8'), 'de otra tarea, sin commit\n', 'lo de la otra tarea sigue');
  assert.equal(r.g('rev-list', '--count', 'HEAD'), '1', 'sin commits nuevos en la rama del usuario');
  assert.match(r.g('status', '--porcelain'), /otra\.txt/, 'el índice del usuario no se toca: todo sigue sin commitear');
});

test('unir una copia con conflicto: la carpeta no se toca y se dice qué choca', () => {
  const r = repo();
  const { base, tip } = copyWith(r, (wt) => fs.writeFileSync(path.join(wt, 'a.txt'), 'uno\nDOS de la copia\ntres\n'));
  fs.writeFileSync(path.join(r.dir, 'a.txt'), 'uno\ndos de la carpeta\ntres\n');
  const out = integrateInto(r.dir, { base, tip });
  assert.equal(out.ok, false);
  assert.deepEqual(out.conflicts, ['a.txt']);
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), 'uno\ndos de la carpeta\ntres\n');
});

test('Cursor: las reglas del guardia y las herramientas de Orb solo durante el turno, respetando los archivos del usuario', () => {
  assert.deepEqual(cursorRules('total'), []);
  const editar = cursorRules('editar', 'C:\\Orb\\.orb');
  for (const rule of ['Shell(git push)', 'Shell(taskkill)', 'Shell(*Remove-Item*-Recurse*)', 'Shell(gh pr)', 'Shell(*git push*)', 'Shell(*git -C * push*)']) assert.ok(editar.includes(rule), rule);
  assert.ok(!editar.includes('Write(**)'));
  assert.ok(editar.some((r) => /^Write\(.*datos/.test(r)), 'las carpetas privadas de Orb');
  assert.ok(cursorRules('probar').includes('Write(**)'), 'revisar y probar: no cambia archivos');
  assert.ok(cursorRules('preguntar').includes('Shell(*)'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-cursor-'));
  fs.mkdirSync(path.join(dir, '.cursor'));
  const mine = JSON.stringify({ permissions: { allow: ['Shell(ls)'], deny: ['Shell(rm)'] } }, null, 1);
  fs.writeFileSync(path.join(dir, '.cursor', 'cli.json'), mine);
  fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { delRepo: { command: 'evil' } } }));
  const restore = prepareCursorFolder(dir, { mcpServers: { orb: { command: 'node', args: ['x.mjs'], env: { ORB_AGENT_TOKEN: 'secreto123' } } }, deny: ['Shell(git push)'] });
  assert.equal(prepareCursorFolder(dir, { deny: ['Shell(x)'] })(), undefined, 'un segundo turno en la misma carpeta no toca nada');
  const cli = JSON.parse(fs.readFileSync(path.join(dir, '.cursor', 'cli.json'), 'utf8'));
  assert.deepEqual(cli.permissions.allow, ['Shell(ls)']);
  assert.deepEqual(cli.permissions.deny, ['Shell(rm)', 'Shell(git push)']);
  const mcpText = fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf8');
  const mcp = JSON.parse(mcpText);
  assert.deepEqual(Object.keys(mcp.mcpServers), ['orb'], 'durante el turno, solo las herramientas de Orb (no las que trae el repositorio)');
  assert.ok(!mcpText.includes('secreto123'), 'ninguna clave en la carpeta del proyecto');
  // Checked against the real CLI: it fills ${env:…} in from its own environment (and ignores envFile).
  assert.equal(mcp.mcpServers.orb.env.ORB_AGENT_TOKEN, '${env:ORB_MCP_orb_ORB_AGENT_TOKEN}');
  assert.deepEqual(restore.env, { ORB_MCP_orb_ORB_AGENT_TOKEN: 'secreto123' }, 'el valor va solo en el entorno del proceso de Cursor');
  restore();
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf8')).mcpServers), ['delRepo'], 'el del repositorio vuelve');
  assert.equal(fs.readFileSync(path.join(dir, '.cursor', 'cli.json'), 'utf8'), mine, 'el archivo del usuario vuelve igual');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-cursor-'));
  const undo = prepareCursorFolder(empty, { deny: ['Shell(x)'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(empty, '.cursor', 'cli.json'), 'utf8')).permissions, { allow: [], deny: ['Shell(x)'] }, 'Cursor exige las dos listas');
  undo();
  assert.ok(!fs.existsSync(path.join(empty, '.cursor')), 'sin rastro si no había carpeta .cursor');
});

test('el reloj de una tarea no cuenta el rato que espera tu permiso', () => {
  const stopped = [];
  const run = { startedAt: Date.now() - 10 * 60_000, waitMs: 0, pausedAt: Date.now() - 8 * 60_000 };
  const self = { running: new Map([['s', run]]), approvals: new Map(), pendingApprovals: () => ['x'], addItem: () => {}, stop: (id) => stopped.push(id), lives: new Map(), board: {} };
  // 10 min since it started, 8 of them waiting for a permission: 2 min of work, under a 5 min limit.
  Sessions.prototype.watchRun.call(self, 's', run, { timeoutMs: 5 * 60_000 });
  assert.deepEqual(stopped, []);
  // Answered: the wait is added up and the clock goes on from 2 min.
  self.pendingApprovals = () => [];
  Sessions.prototype.watchRun.call(self, 's', run, { timeoutMs: 5 * 60_000 });
  assert.equal(run.pausedAt, null); assert.ok(run.waitMs >= 8 * 60_000 - 50);
  assert.deepEqual(stopped, []);
  run.startedAt -= 4 * 60_000; // 4 more minutes of work: 6 > 5
  Sessions.prototype.watchRun.call(self, 's', run, { timeoutMs: 5 * 60_000 });
  assert.deepEqual(stopped, ['s']);
});

test('lo que pediste con tus palabras no vuelve a pedir aprobación; lo que no pediste, sí', async () => {
  const h = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const board = new Board();
    const dir = path.join(h.home, 'web', 'notas'); fs.mkdirSync(dir, { recursive: true });
    board.addProject({ name: 'notas', path: dir }, 'usuario');
    const make = () => board.createTask({ project: 'notas', title: 'API de notas', description: 'Servidor para guardar, listar y borrar notas', agent: 'claude' }, 'orb');
    assert.equal(make().status, 'awaiting_approval', 'sin que el usuario lo pidiera, «borrar» espera aprobación');
    board.addChat('usuario', 'Crea una web de notas rápidas donde se puedan escribir y borrar notas');
    const t = make();
    assert.equal(t.status, 'queued', 'el usuario pidió borrar notas: no hace falta otro clic');
    assert.ok(board.all("SELECT detail FROM events WHERE task_id = ? AND kind = 'note'", t.id).some((e) => /lo pidió el usuario/.test(e.detail)));
    assert.equal(board.createTask({ project: 'notas', title: 'Publicar', description: 'Publica la web en internet', agent: 'claude' }, 'orb').status, 'awaiting_approval', 'publicar no lo pidió: sigue esperando');
    board.addChat('usuario', 'Y publícala cuando esté');
    assert.equal(board.createTask({ project: 'notas', title: 'Publicar', description: 'Publica la web en internet', agent: 'claude' }, 'orb').status, 'awaiting_approval', 'publicar espera siempre su clic, aunque se pidiera');
    assert.equal(board.createTask({ project: 'notas', title: 'Unir', description: 'borrar notas', agent: 'claude', internal: true }, 'orb').status, 'awaiting_approval', 'las tareas que crea Orb solo no se benefician');
    // Two answers later the old request no longer counts.
    board.addChat('orb', 'Hecho.'); board.addChat('usuario', 'Gracias'); board.addChat('orb', 'De nada.');
    assert.equal(make().status, 'awaiting_approval', 'lo que se pidió antes no vale para siempre');
    board.db.close();
  } finally { h.cleanup(); }
});

test('al terminar una tarea, Orb para el servidor que dejó en marcha en su carpeta (y no los de antes ni los de otras carpetas)', { skip: process.platform !== 'win32' }, async () => {
  const { Scheduler } = await import('../src/engine/scheduler.mjs');
  const { spawn } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-restos-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-otro-'));
  for (const d of [dir, other]) fs.writeFileSync(path.join(d, 'server.js'), 'setInterval(() => {}, 1000);');
  const before = spawn(process.execPath, [path.join(dir, 'server.js')], { stdio: 'ignore' }); // already running before the task
  await wait(1500);
  const since = new Date().toISOString();
  await wait(300);
  const left = spawn(process.execPath, [path.join(dir, 'server.js')], { stdio: 'ignore' });
  const elsewhere = spawn(process.execPath, [path.join(other, 'server.js')], { stdio: 'ignore' });
  await wait(800);
  const events = [];
  const self = { running: new Map(), board: { task: () => null, one: () => ({ at: since }), event: (...a) => events.push(a) } };
  const saved = process.env.ORB_FAKE_AGENTS; delete process.env.ORB_FAKE_AGENTS;
  try { Scheduler.prototype.stopLeftovers.call(self, { id: 9, workdir: dir }); } finally { process.env.ORB_FAKE_AGENTS = saved; }
  const alive = (c) => { try { process.kill(c.pid, 0); return true; } catch { return false; } };
  await wait(500);
  try {
    assert.equal(alive(left), false, 'el que dejó la tarea, parado');
    assert.equal(alive(before), true, 'el que ya estaba antes, intacto');
    assert.equal(alive(elsewhere), true, 'el de otra carpeta, intacto');
    assert.match(events[0]?.[3] ?? '', /paró 1 programa/);
  } finally { for (const c of [before, left, elsewhere]) { try { c.kill(); } catch { /* gone */ } } }
});

test('parar por su número el servidor que arrancó la propia tarea no pregunta; cualquier otro proceso, sí', { skip: process.platform !== 'win32' }, async () => {
  const { pidKills } = await import('../src/core/guard.mjs');
  assert.deepEqual(pidKills('taskkill //PID 9824 //T //F; sleep 1; netstat -ano | grep ":5199 " | grep LISTEN | wc -l'), [9824]);
  assert.deepEqual(pidKills('Stop-Process -Id 12 -Force'), [12]);
  assert.deepEqual(pidKills('Stop-Process -Id 17624 -Confirm:$false; Start-Sleep 1; netstat -ano | Select-String ":5175 .*LISTENING"'), [17624], 'visto en una prueba real');
  for (const c of ['taskkill /IM node.exe /F', 'Get-Process node | Stop-Process -Force', 'Stop-Process -Name node', 'taskkill /PID 5 /F; git push', 'pkill node']) assert.equal(pidKills(c), null, c);
  const { spawn } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-propio-'));
  fs.writeFileSync(path.join(dir, 'server.js'), 'setInterval(() => {}, 1000);');
  const old = spawn(process.execPath, [path.join(dir, 'server.js')], { stdio: 'ignore' });
  await wait(1200);
  const since = Date.now();
  const mine = spawn(process.execPath, [path.join(dir, 'server.js')], { stdio: 'ignore' });
  await wait(800);
  try {
    assert.equal(Sessions.prototype.ownProcesses.call({}, `taskkill /PID ${mine.pid} /F`, dir, since), true, 'el suyo');
    assert.equal(Sessions.prototype.ownProcesses.call({}, `taskkill /PID ${old.pid} /F`, dir, since), false, 'uno de antes de la tarea');
    assert.equal(Sessions.prototype.ownProcesses.call({}, `taskkill /PID ${process.pid} /F`, dir, since), false, 'uno de fuera');
  } finally { old.kill(); mine.kill(); }
});

// ---- the engine with the fake agents (Claude and Codex available; Cursor and the ACP agents off, see helpers.mjs)
let t; let engine; let call;
before(async () => {
  t = tempHome();
  engine = await startEngine(t.home, { env: { ORB_APPROVAL_WAIT_MS: '1500', ORB_WATCH_MS: '300', ORB_RELEASE_MS: '1200' } });
  ({ call } = engine);
  await call('projects.create', { name: 'web' });
  await call('projects.setActive', { name: 'web' });
});
after(async () => { await engine?.stop(); t.cleanup(); });
const get = (id) => call('tasks.get', { id });
const kinds = (task) => task.events.map((e) => e.kind);

test('los ajustes nuevos del CORE se guardan desde la app y se validan', async () => {
  const c = await call('config.save', { patch: { oneAtATime: true, approvalWaitMinutes: 3 } });
  assert.equal(c.oneAtATime, true); assert.equal(c.approvalWaitMinutes, 3);
  await assert.rejects(call('config.save', { patch: { approvalWaitMinutes: 999 } }), /approvalWaitMinutes/);
  await call('config.save', { patch: { oneAtATime: false, approvalWaitMinutes: 10 } });
});

test('solo agentes disponibles: una tarea para uno que no hay se rechaza, y la que se queda sin agente pasa a otro', async () => {
  await assert.rejects(call('tasks.create', { project: 'web', title: 'X', description: 'algo', agent: 'gemini' }), /no está disponible/);
  await call('control.pause');
  const task = await call('tasks.create', { project: 'web', title: 'Para Codex', description: 'ESCRIBE algo', agent: 'codex' });
  await call('config.save', { patch: { agents: { codex: { enabled: false } } } });
  await call('control.resume');
  const done = await engine.taskDone(task.id, 20000);
  assert.equal(done.status, 'done');
  assert.equal(done.assigned_to, 'claude', 'la hizo un agente disponible');
  assert.ok(done.events.some((e) => e.kind === 'note' && /no está disponible/.test(e.detail)));
  await call('config.save', { patch: { agents: { codex: { enabled: true } } } });
});

test('a la vez: la segunda tarea que escribe trabaja en su copia, Orb la une a la carpeta y la que depende de ella espera', async () => {
  const a = await call('tasks.create', { project: 'web', title: 'Lenta', description: 'DUERME y ESCRIBE', agent: 'claude' });
  await until(async () => (await get(a.id)).status === 'running', 'la primera trabaja en la carpeta');
  const b = await call('tasks.create', { project: 'web', title: 'A la vez', description: 'ESCRIBE', agent: 'codex' });
  const c = await call('tasks.create', { project: 'web', title: 'Después de B', description: 'ESCRIBE otra vez', agent: 'codex', depends_on: [b.id] });
  const bDone = await until(async () => { const x = await get(b.id); return x.status === 'done' && x.pid == null && x; }, 'B terminada mientras A trabaja', 20000);
  assert.ok(bDone.events.some((e) => e.kind === 'workspace' && /su propia copia/.test(e.detail)), 'B trabajó en su copia');
  assert.equal((await get(a.id)).status, 'running', 'A sigue trabajando: B no esperó su turno');
  await wait(1500);
  assert.equal((await get(c.id)).status, 'queued', 'C espera a que el trabajo de B esté en la carpeta');
  const project = (await call('projects.list')).find((p) => p.name === 'web');
  assert.ok(!fs.existsSync(path.join(project.path, 'hecho-por-codex.txt')), 'mientras A escribe, la carpeta no se toca');
  await call('tasks.cancel', { id: a.id });
  const joined = await until(async () => { const x = await get(b.id); return kinds(x).includes('task.integrated') && x; }, 'B unida a la carpeta', 20000);
  assert.equal(joined.branch, null, 'la copia y su rama se quitan');
  assert.ok(fs.existsSync(path.join(project.path, 'hecho-por-codex.txt')), 'el trabajo de B está en la carpeta');
  const cDone = await engine.taskDone(c.id, 20000);
  assert.equal(cDone.status, 'done');
  const integratedAt = joined.events.find((e) => e.kind === 'task.integrated').at;
  assert.ok(cDone.events.find((e) => e.kind === 'task.launched').at >= integratedAt, 'C empezó después de unir B');
});

test('un permiso que nadie responde se deniega solo, el agente sigue y el aviso del chat lo dice', async () => {
  const task = await call('tasks.create', { project: 'web', title: 'Permiso sin respuesta', description: 'PIDE_PERMISO', agent: 'codex' });
  const done = await engine.taskDone(task.id, 20000);
  assert.equal(done.status, 'done');
  assert.match(done.result, /permiso denegado/);
  const line = (await call('chat.list')).find((m) => m.meta?.kind === 'task-approval' && m.meta.task === task.id);
  assert.equal(line?.meta?.status, 'timeout', 'la línea del chat ya no ofrece botones');
});

test('un agente que cierra su tarea y deja su programa abierto se libera solo', async () => {
  const task = await call('tasks.create', { project: 'web', title: 'Se cuelga', description: 'CIERRA_Y_CUELGA', agent: 'claude' });
  const done = await engine.taskDone(task.id, 15000);
  assert.equal(done.status, 'done');
  assert.ok(kinds(done).includes('task.released'), kinds(done).join(', '));
});

test('los mensajes entre agentes llegan mientras trabajan', async () => {
  const listener = await call('tasks.create', { project: 'web', title: 'Escucha', description: 'ESPERA_CORRECCION', agent: 'claude', readonly: true });
  await until(async () => (await get(listener.id)).status === 'running', 'escuchando');
  await wait(500);
  const sender = await call('tasks.create', { project: 'web', title: 'Avisa', description: 'MANDA_MENSAJE claude la API está en /api/v2', agent: 'codex', readonly: true });
  const heard = await engine.taskDone(listener.id, 20000);
  assert.match(heard.result, /MENSAJE DE CODEX.*la API está en \/api\/v2/);
  assert.ok(kinds(heard).includes('message.delivered'));
  await engine.taskDone(sender.id, 20000);
});
