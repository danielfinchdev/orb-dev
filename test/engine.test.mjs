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

test('2.7: lo que solo informa (carpeta de trabajo) pasa como notificación, no como línea del chat', async () => {
  await until(async () => events.some((e) => e.event === 'notice' && /Carpeta de trabajo: web/.test(e.payload?.body) && e.payload.tone === 'info'), 'aviso de la carpeta', 5000);
  assert.ok(!(await call('chat.list')).some((m) => /Carpeta de trabajo/.test(m.body)));
  // 3.2: the same folder again (the assistant sets it on each request) says nothing more.
  const count = () => events.filter((e) => e.event === 'notice' && /Carpeta de trabajo/.test(e.payload?.body)).length;
  const before = count();
  await call('projects.setActive', { name: 'web' }); await call('projects.setActive', { name: 'web' });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(count(), before, 'sin avisos repetidos de la misma carpeta');
});

test('3.2: el plan Pro Lite de Codex se reconoce con su nombre', async () => {
  const { codexPlan, PLAN_LABELS } = await import('../src/engine/plans.mjs');
  assert.equal(codexPlan('prolite'), 'prolite');
  assert.equal(codexPlan('Pro Lite'), 'prolite');
  assert.equal(PLAN_LABELS.prolite, 'Pro Lite');
});

test('2.7: Pizarra: se guarda en la carpeta pizarra del proyecto, fuera de git, con resumen para el asistente', async () => {
  const web = (await call('projects.list')).find((p) => p.name === 'web');
  const dir = path.join(web.path, 'pizarra');
  assert.deepEqual((await call('whiteboard.load', { project: 'web' })).elements, [], 'empieza vacía');
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const elements = [{ id: 'a', type: 'text', text: 'Botón de pagar arriba', x: 0, y: 10, version: 1 }, { id: 'b', type: 'arrow', x: 0, y: 40, version: 1 }, { id: 'c', type: 'text', text: 'borrado', x: 0, y: 0, version: 1, isDeleted: true }];
  await call('whiteboard.save', { project: 'web', elements, appState: { viewBackgroundColor: '#fff' }, files: { img1: { mimeType: 'image/png', dataURL: `data:image/png;base64,${png}` } }, png: `data:image/png;base64,${png}` });
  assert.ok(fs.existsSync(path.join(dir, 'pizarra.excalidraw')) && fs.existsSync(path.join(dir, 'pizarra.png')) && fs.existsSync(path.join(dir, 'imagenes', 'img1.png')));
  const loaded = await call('whiteboard.load', { project: 'web' });
  assert.deepEqual(loaded.elements.map((e) => e.id), ['a', 'b'], 'lo borrado no se guarda');
  assert.match(loaded.files.img1.dataURL, /^data:image\/png;base64,/);
  // An attachment from the PC, with its note; then taken out (kept in .papelera, never deleted).
  const src = path.join(t.home, 'referencia.txt'); fs.writeFileSync(src, 'hola');
  const list = await call('whiteboard.attach', { project: 'web', paths: [src] });
  assert.equal(list[0].name, 'referencia.txt');
  await call('whiteboard.note', { project: 'web', file: 'referencia.txt', note: 'Así quiero el texto de bienvenida' });
  const md = fs.readFileSync(path.join(dir, 'PIZARRA.md'), 'utf8');
  assert.match(md, /Botón de pagar arriba/); assert.match(md, /Contiene: 1 texto, 1 flecha\./); assert.match(md, /referencia\.txt .*Así quiero el texto de bienvenida/); assert.doesNotMatch(md, /borrado/);
  await assert.rejects(call('whiteboard.note', { project: 'web', file: '../../orb.json', note: 'x' }));
  assert.deepEqual(await call('whiteboard.remove', { project: 'web', file: 'referencia.txt' }), []);
  assert.equal(fs.readdirSync(path.join(dir, '.papelera')).length, 1);
  assert.match(fs.readFileSync(path.join(web.path, '.git', 'info', 'exclude'), 'utf8'), /^\/pizarra\/$/m, 'fuera de git');
  assert.ok(!git(web.path, 'status', '--porcelain').stdout.includes('pizarra'), 'git no la ve');
});

test('2.7: imagen de un agente: se ve, se marca una zona y se guarda en el proyecto; fuera de las carpetas permitidas, no', async () => {
  const s = await call('sessions.create', { agent: 'codex', project: 'web', title: 'Imágenes' });
  await call('sessions.send', { id: s.id, text: 'CREA_IMAGEN' });
  const img = await until(async () => (await call('sessions.items', { id: s.id })).find((i) => i.kind === 'image'), 'imagen en la conversación', 20000);
  assert.match((await call('images.read', { path: img.body.path })).dataUrl, /^data:image\/png;base64,/);
  const mark = await call('images.mark', { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' });
  assert.ok(fs.existsSync(mark.path));
  const saved = await call('images.save', { path: img.body.path, project: 'web' });
  const web = (await call('projects.list')).find((p) => p.name === 'web');
  assert.ok(saved.path.startsWith(path.join(web.path, 'imagenes')) && fs.existsSync(saved.path));
  fs.rmSync(path.join(web.path, 'imagenes'), { recursive: true, force: true }); // the next tests want a clean project folder
  const outside = path.join(path.dirname(t.home), `fuera-${Date.now()}.png`); fs.copyFileSync(mark.path, outside);
  try { await assert.rejects(call('images.read', { path: outside }), /no se puede abrir/); } finally { fs.rmSync(outside, { force: true }); }
});

// 3.2: whether the assistant is answering in a conversation (or in any, without one).
const busy = async (conversation = null) => (await call('app.state')).chats.some((x) => x.busy && (conversation == null || x.conversation === conversation));

test('2.7: un pedido grande: el consejo de usar la pizarra sale con su botón, debajo de la respuesta', async () => {
  await until(async () => !(await busy()), 'asistente libre');
  const { conversation } = await call('chat.send', { text: 'PIDE_PIZARRA' });
  const tip = await until(async () => (await call('chat.list', { conversation })).find((m) => m.meta?.kind === 'board'), 'consejo de la pizarra', 20000);
  assert.match(tip.body, /tres pantallas/); assert.equal(tip.meta.project, 'web');
  await until(async () => !(await busy(conversation)), 'fin del turno');
});

test('2.7: pregunta con opciones: tarjeta debajo de la respuesta, actividad en vivo y la respuesta llega al asistente', async () => {
  const { conversation } = await call('chat.send', { text: 'PREGUNTA_OPCIONES' });
  const card = await until(async () => (await call('chat.list', { conversation })).find((m) => m.meta?.kind === 'question'), 'tarjeta de pregunta', 20000);
  assert.equal(card.meta.status, 'pending');
  assert.deepEqual(card.meta.options.map((o) => o.label), ['Rápido (Recomendado)', 'Completo']);
  const list = await call('chat.list', { conversation });
  assert.ok(list.some((m) => m.role === 'orb' && !m.meta && m.id < card.id), 'la tarjeta va debajo de la respuesta del turno');
  assert.ok(events.some((e) => e.event === 'chat:state' && e.payload.conversation === conversation && e.payload.busy && e.payload.since && e.payload.tools?.some((s) => s.name === 'orb_ask' && s.at)), 'pasos con nombre y hora');
  await until(async () => !(await busy(conversation)), 'fin del turno');
  assert.equal((await call('conversations.list')).find((c) => c.id === conversation).asking, true, 'la conversación dice que espera una respuesta');
  await call('chat.answer', { id: card.id, choices: ['Completo', 'otra que no existe'] });
  const after = await call('chat.list', { conversation });
  assert.equal(after.find((m) => m.id === card.id).meta.answer, 'Completo');
  assert.ok(after.some((m) => m.role === 'usuario' && m.body === 'Mi respuesta a «¿Qué enfoque prefieres?»: Completo'), 'la respuesta va a la misma conversación');
  await assert.rejects(call('chat.answer', { id: card.id, skip: true }), /ya está respondida/);
  await until(async () => !(await busy(conversation)), 'respuesta a la elección');
});

test('ciclo completo: el asistente crea la tarea, el agente la hace, el asistente informa en esa conversación y el usuario da el OK', async () => {
  const { conversation } = await call('chat.send', { text: 'CREA_TAREA web' });
  const other = (await call('chat.send', { text: 'otra conversación a la vez' })).conversation;
  const task = await until(async () => (await call('tasks.list')).find((x) => x.title === 'Tarea del asistente'), 'tarea del asistente');
  assert.equal(task.created_by, 'orb');
  assert.equal(task.conversation_id, conversation, 'la tarea es de la conversación que la pidió');
  const done = await taskDone(task.id);
  assert.equal(done.status, 'done', done.result);
  assert.ok(done.hasCheckpoint, 'foto antes de trabajar en la carpeta');
  const report = await until(async () => (await call('chat.list', { conversation })).find((m) => m.meta?.kind === 'report'), 'informe del asistente', 20000);
  assert.deepEqual(report.meta.tasks, [task.id]);
  assert.ok(!(await call('chat.list', { conversation: other })).some((m) => m.meta?.kind === 'report' || /#\d+/.test(m.body) && m.role === 'system'), 'el informe y las líneas de la tarea no van a la otra conversación');
  await until(async () => !(await busy(conversation)), 'informe escrito');
  assert.deepEqual(await call('chat.accept', { id: report.id }), [task.id]);
  assert.equal((await call('chat.list', { conversation })).find((m) => m.id === report.id).meta.accepted, true);
  assert.equal((await call('conversations.list')).find((c) => c.id === conversation).status, 'done', 'con el OK y nada abierto, la conversación queda completada');
  await assert.rejects(call('chat.accept', { id: report.id }), /pendientes de aceptar/);
  const log = await call('logs.read', { project: 'web' });
  assert.match(log, /Tarea #\d+: Tarea del asistente/); assert.match(log, /dio el OK/);
  assert.ok(events.some((e) => e.event === 'chat:new' && e.payload.conversation === conversation), 'avisos para la ventana, con su conversación');
});

test('parar al asistente y escribirle enseguida: el mensaje nuevo espera a que acabe el turno parado', async () => {
  const { conversation } = await call('chat.send', { text: 'DUERME PARA_LENTO' });
  const log = path.join(t.home, '.orb', 'ejecuciones', 'asistente.log');
  await until(() => { try { return fs.readFileSync(log, 'utf8').includes('DUERME PARA_LENTO'); } catch { return false; } }, 'el asistente empezó');
  await call('chat.stop', { conversation });
  await call('chat.send', { text: 'hola tras parar', conversation });
  const answer = await until(async () => (await call('chat.list', { conversation })).find((m) => m.role === 'orb' && /hola tras parar/.test(m.body)), 'respuesta tras parar', 15000);
  assert.ok(answer);
  const after = await call('chat.list', { conversation });
  assert.ok(!after.some((m) => m.role === 'system' && /trabajando|ocupad|busy/i.test(m.body)), after.map((m) => m.body).join(' / '));
});

test('2.6: el cerebro del asistente puede ser cualquier agente instalado (Codex), con sus instrucciones al empezar', async () => {
  const catalog = await call('models.catalog');
  assert.ok(catalog.some((a) => a.id === 'claude' && a.models.some((m) => m.id === 'claude-opus-5-5' && m.heavy)), 'Opus gasta más uso');
  assert.ok(catalog.some((a) => a.id === 'codex'));
  const info = await call('chat.settings', { agent: 'codex', model: '', reasoning: 'high' });
  assert.equal(info.agent, 'codex'); assert.equal(info.reasoning, 'high');
  const { conversation } = await call('chat.send', { text: 'hola con otro cerebro' });
  assert.equal((await call('conversations.list')).find((c) => c.id === conversation).agent, 'codex', 'la conversación nueva empieza con el cerebro elegido');
  const answer = await until(async () => (await call('chat.list', { conversation })).find((m) => m.role === 'orb'), 'respuesta de Codex como cerebro', 15000);
  assert.match(answer.body, /^Codex empieza:/, 'responde Codex');
  const log = fs.readFileSync(path.join(t.home, '.orb', 'ejecuciones', 'asistente.log'), 'utf8');
  assert.match(log, /"fake":"codex"[^\n]*Eres/, 'Codex recibe las instrucciones del asistente al empezar');
  // The brain of one conversation changes only that one (and the next new ones).
  await until(async () => !(await busy(conversation)), 'fin del turno');
  const back = await call('chat.settings', { conversation, agent: 'claude', model: 'claude-sonnet-5-5', reasoning: 'medium' });
  assert.equal(back.conversation, conversation); assert.equal(back.agent, 'claude');
  await assert.rejects(call('chat.settings', { agent: 'noexiste' }));
  await call('chat.settings', { agent: 'claude', model: 'claude-sonnet-5-5', reasoning: 'medium' });
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
  assert.match(done.result, /límite de uso/);
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

test('varias cuentas: si una cuenta de Codex llega a su límite de uso, el trabajo va a la otra con su propia carpeta', async () => {
  const acc = await call('accounts.add', { agent: 'codex', label: 'Codex Pro' });
  assert.equal(acc.id, 'codex-2');
  assert.ok(acc.home.includes(path.join('.orb', 'cuentas', 'codex-2')));
  await assert.rejects(call('accounts.add', { agent: 'cursor', label: 'otra' }), /solo admite una cuenta/);
  // The main Codex account runs out of quota: the next Codex task goes to the second account.
  const quota = await call('tasks.create', { project: 'web', title: 'Uso', description: 'algo', agent: 'codex' });
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

test('3.2: acciones del proyecto: se guardan con su atajo y su vista previa, y solo con datos válidos', async () => {
  const a = await call('actions.save', { project: 'web', action: { name: 'Probar', command: 'npm test', shortcut: 'Ctrl+Shift+T', preview: 'http://localhost:5173', openPreview: true } });
  assert.equal(a.name, 'Probar'); assert.equal(a.openPreview, true);
  assert.deepEqual((await call('actions.list', { project: 'web' })).map((x) => x.id), [a.id]);
  await call('actions.save', { project: 'web', action: { id: a.id, name: 'Probar todo', command: 'npm test -- --all', shortcut: 'Ctrl+Shift+T' } });
  assert.equal((await call('actions.list', { project: 'web' }))[0].name, 'Probar todo', 'editar no la duplica');
  await assert.rejects(call('actions.save', { project: 'web', action: { name: 'Otra', command: 'x', shortcut: 'Ctrl+Shift+T' } }), /otra acción/);
  await assert.rejects(call('actions.save', { project: 'web', action: { name: 'Mal', command: 'x', shortcut: 'T' } }), /atajo/);
  await assert.rejects(call('actions.save', { project: 'web', action: { name: 'Fuera', command: 'x', preview: 'https://ejemplo.com' } }), /este PC/);
  await call('actions.remove', { project: 'web', id: a.id });
  assert.deepEqual(await call('actions.list', { project: 'web' }), []);
});

test('3.2: una acción se abre en una ventana de terminal en la carpeta del proyecto, sin pasar por cmd.exe', async () => {
  const { actionPlan } = await import('../src/main/editors.mjs');
  const found = { wt: 'C:\\wt.exe', powershell: 'C:\\ps.exe', cmd: 'C:\\cmd.exe' };
  const wt = actionPlan('npm test; npm run dev', 'D:\\Orb\\web\\a;b', found, 'auto', 'win32');
  assert.equal(wt.cmd, 'C:\\wt.exe');
  assert.deepEqual(wt.args, ['-d', 'D:\\Orb\\web\\a\\;b', 'C:\\ps.exe', '-NoExit', '-NoLogo', '-Command', 'npm test\\; npm run dev'], 'el punto y coma de Windows Terminal, escapado');
  assert.deepEqual(actionPlan('npm test', 'D:\\p', { ...found, wt: null }, 'auto', 'win32').args, ['-NoExit', '-NoLogo', '-Command', 'npm test']);
  assert.deepEqual(actionPlan('npm test', 'D:\\p', found, 'cmd', 'win32').args, ['/k', 'npm test']);
});
