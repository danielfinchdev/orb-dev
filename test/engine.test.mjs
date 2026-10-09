// The engine as the app runs it (its own process, messages in and out) with fake agents: the whole loop
// (request → tasks → agent → review and report → OK), isolated copies, secrets, quota and direct conversations.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, until, startEngine, fakeLog } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../src/core/workspace.mjs';

let t; let engine; let call; let taskDone; let events;

before(async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  ({ call, taskDone, events } = engine);
  await call('projects.create', { name: 'web' });
  await call('projects.setActive', { name: 'web' });
});
after(async () => { await engine?.stop(); t.cleanup(); });

test('ciclo completo: el asistente crea la tarea, el agente la hace, el asistente informa y el usuario da el OK', async () => {
  await call('chat.send', { text: 'CREA_TAREA web' });
  const task = await until(async () => (await call('tasks.list')).find((x) => x.title === 'Tarea del asistente'), 'tarea del asistente');
  assert.equal(task.created_by, 'orb');
  const done = await taskDone(task.id);
  assert.equal(done.status, 'done', done.result);
  assert.ok(done.hasCheckpoint, 'foto antes de trabajar en la carpeta');
  const report = await until(async () => (await call('chat.list')).find((m) => m.meta?.kind === 'report'), 'informe del asistente', 20000);
  assert.deepEqual(report.meta.tasks, [task.id]);
  assert.deepEqual(await call('chat.accept', { id: report.id }), [task.id]);
  assert.equal((await call('chat.list')).find((m) => m.id === report.id).meta.accepted, true);
  await assert.rejects(call('chat.accept', { id: report.id }), /pendientes de aceptar/);
  const log = await call('logs.read', { project: 'web' });
  assert.match(log, /Tarea #\d+: Tarea del asistente/); assert.match(log, /dio el OK/);
  assert.ok(events.some((e) => e.event === 'chat:new'), 'avisos para la ventana');
});

test('copia aislada: trabaja en su rama, el motor hace el commit y se puede integrar', async () => {
  // Start from a clean folder (the previous test left the agent's file there, uncommitted).
  const main = (await call('projects.list'))[0].path;
  fs.rmSync(path.join(main, 'hecho-por-claude.txt'), { force: true });
  const task = await call('tasks.create', { project: 'web', title: 'Rama', description: 'ESCRIBE en la copia', agent: 'claude', mode: 'aislada' });
  const done = await taskDone(task.id);
  assert.equal(done.status, 'done', done.result);
  assert.match(done.branch, /^orb\/\d+-rama$/);
  assert.match(git(done.workdir, 'log', '-1', '--format=%s').stdout, /orb: tarea/);
  const project = (await call('projects.list'))[0];
  assert.ok(!fs.existsSync(path.join(project.path, 'hecho-por-claude.txt')), 'la carpeta principal no se toca');
  await call('projects.merge', { name: 'web', branch: done.branch });
  assert.ok(fs.existsSync(path.join(project.path, 'hecho-por-claude.txt')));
});

test('los archivos que parecen secretos no pasan a la copia aislada', async () => {
  const project = (await call('projects.list'))[0];
  const task = await call('tasks.create', { project: 'web', title: 'Copia limpia', description: 'ESCRIBE algo', agent: 'claude', mode: 'aislada' });
  // The copy is created at launch; drop a .env into it while the agent "works" is racy, so create it in the main folder
  // before: an isolated copy starts from the folder as it is, but secret-looking files never travel.
  fs.writeFileSync(path.join(project.path, '.env.local'), 'API_KEY=x');
  const done = await taskDone(task.id);
  assert.equal(done.status, 'done', done.result);
  assert.ok(!fs.existsSync(path.join(done.workdir, '.env.local')), 'los secretos no pasan a la copia');
  fs.rmSync(path.join(project.path, '.env.local'));
});

test('si el agente solo dice «usage limit» en su respuesta, la tarea se bloquea y la cuenta queda en pausa', async () => {
  const task = await call('tasks.create', { project: 'web', title: 'Límite', description: 'LIMITE_TEXTO', agent: 'claude' });
  const done = await taskDone(task.id);
  assert.equal(done.status, 'blocked');
  assert.match(done.result, /sin cupo/);
  const usage = await call('usage.get');
  assert.ok(usage.find((u) => u.agent === 'claude').cooldownUntil > Date.now());
});

test('conversación directa con Codex: en directo y la segunda vez continúa la misma', async () => {
  const s = await call('sessions.create', { agent: 'codex', project: 'web' });
  await call('sessions.send', { id: s.id, text: 'hola' });
  await until(async () => (await call('sessions.items', { id: s.id })).some((i) => i.kind === 'text' && i.role === 'assistant'), 'respuesta');
  await until(async () => (await call('sessions.list')).find((x) => x.id === s.id).status === 'idle', 'turno terminado');
  await call('sessions.send', { id: s.id, text: 'sigue' });
  const items = await until(async () => { const all = await call('sessions.items', { id: s.id }); return all.some((i) => /Codex sigue/.test(i.body)) && all; }, 'continuación');
  assert.ok(items.some((i) => i.kind === 'file'));
  await assert.rejects(call('sessions.create', { agent: 'otro' }), /agente no es válido/);
  // Without a project the agent would sit in the assistant's own folder: read only.
  await assert.rejects(call('sessions.create', { agent: 'codex', permission: 'editar' }), /solo tiene acceso de lectura/);
  assert.equal((await call('sessions.create', { agent: 'codex' })).permission, 'leer');
  await assert.rejects(call('nada.raro'), /acción desconocida/);
});

test('varias cuentas: si una cuenta de Codex está sin cupo, el trabajo va a la otra con su propia carpeta', async () => {
  const acc = await call('accounts.add', { agent: 'codex', label: 'Codex Pro' });
  assert.equal(acc.id, 'codex-2');
  assert.ok(acc.home.includes(path.join('.orb', 'cuentas', 'codex-2')));
  await assert.rejects(call('accounts.add', { agent: 'cursor', label: 'otra' }), /solo admite una cuenta/);
  // The main Codex account runs out of quota: the next Codex task goes to the second account.
  const quota = await call('tasks.create', { project: 'web', title: 'Cupo', description: 'algo', agent: 'codex' });
  await taskDone(quota.id);
  const status = await call('agents.status');
  assert.equal(status.find((a) => a.id === 'codex').accounts.length, 2);
  const engineUsage = await call('usage.get');
  assert.ok(engineUsage.some((u) => u.account === 'codex-2'));
  // Simulate the main account hitting its limit through its cooldown setting, as the scheduler does.
  await call('config.save', { patch: { budget: { agents: { codex: { maxTasks: 1 } } } } });
  const next = await call('tasks.create', { project: 'web', title: 'Segunda', description: 'algo más', agent: 'codex' });
  const done = await taskDone(next.id);
  assert.equal(done.status, 'done', done.result);
  assert.equal(done.run_account, 'codex-2', 'la cuenta principal ya gastó su tope: va a la segunda');
  assert.equal(fakeLog(t.home, done.id).at(-1).codexHome, acc.home, 'Codex recibe CODEX_HOME de su cuenta');
  await assert.rejects(call('accounts.remove', { id: 'codex' }), /principal/);
  assert.equal(await call('accounts.remove', { id: 'codex-2' }), true);
  // A removed account's id is never given again (its usage and pauses must not pass to a new subscription).
  const again = await call('accounts.add', { agent: 'codex', label: 'Codex nueva' });
  assert.equal(again.id, 'codex-3');
  await call('accounts.remove', { id: 'codex-3' });
  // Login folders never where agents work, nor on a network share.
  const web = (await call('projects.list')).find((p) => p.name === 'web').path;
  await assert.rejects(call('accounts.add', { agent: 'claude', label: 'x', home: path.join(web, 'claude2') }), /no puede estar dentro/);
  await assert.rejects(call('accounts.add', { agent: 'claude', label: 'x', home: path.join(t.home, 'cosas') }), /no puede estar dentro/);
  await assert.rejects(call('accounts.add', { agent: 'claude', label: 'x', home: '//servidor/compartida/claude' }), /red/);
});
