// 3.2.1: fixes from the user tests of 2026-10-14 (secrets in commits, project names and renaming, local times and sizes,
// the whiteboard summary, Opti Bot's cards, the one rule for deletions, translated Activity, logs and the build contract).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx, saveConfig } from '../src/core/context.mjs';
import { Board, eventKey, eventText } from '../src/core/board.mjs';
import { createProject, renameProject } from '../src/core/projects.mjs';
import { projectNameProblem } from '../src/core/product.mjs';
import { isSecretPath, looksSecretText, secretsInDiff, localStamp, localText, sizeText } from '../src/core/safety.mjs';
import { deletionAskedByUser, filesToDelete } from '../src/core/approval.mjs';
import { programLabel, backup } from '../src/core/pc-health.mjs';
import { git } from '../src/core/workspace.mjs';
import { commitAll, unpushedSecrets } from '../src/engine/github.mjs';
import { Scheduler, contractNote } from '../src/engine/scheduler.mjs';
import { drawingContents } from '../src/engine/whiteboard.mjs';
import { opti } from '../src/engine/opti.mjs';
import { cutWords, agentAuthor, changedFiles, logDirect } from '../src/engine/logs.mjs';

const GHP = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
let t; let board;
before(() => { t = tempHome(); board = new Board(); });
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('60: los secretos se buscan también por contenido, y los *.env por nombre', () => {
  assert.equal(isSecretPath('config-prueba.env'), true);
  assert.equal(isSecretPath('web/prod.env'), true);
  assert.equal(isSecretPath('.env.example'), false);
  assert.equal(isSecretPath('notas.txt'), false);
  assert.equal(looksSecretText('OPENAI_API_KEY=sk-proj-abc123def456'), true);
  assert.equal(looksSecretText(`const t = '${GHP}'`), true);
  assert.equal(looksSecretText('-----BEGIN RSA PRIVATE KEY-----'), true);
  assert.equal(looksSecretText('AWS_KEY=AKIAABCDEFGHIJKLMNOP'), true);
  assert.equal(looksSecretText('DB_PASSWORD = "Xk29fjQm3pLz81Vb"'), true);
  assert.equal(looksSecretText('TOKEN_LIMIT = 123456789012'), false, 'solo números: no es una clave');
  assert.equal(looksSecretText('apiKey: process.env.API_KEY'), false);
  assert.equal(looksSecretText('password: "your_password_here_123"'), false);
  assert.equal(looksSecretText('La tarea de riesgo-alto-medio'), false);
  const diff = ['diff --git a/notas.txt b/notas.txt', '--- /dev/null', '+++ b/notas.txt', '@@ -0,0 +1 @@', `+clave: ${GHP}`,
    'diff --git a/viejo.js b/viejo.js', '--- a/viejo.js', '+++ b/viejo.js', '@@ -1 +0,0 @@', '-const k = "sk-proj-abcdefgh12345678"',
    'diff --git a/.env.example b/.env.example', '--- /dev/null', '+++ b/.env.example', '@@ -0,0 +1 @@', '+OPENAI_API_KEY=sk-proj-abc123def456'].join('\n');
  assert.deepEqual(secretsInDiff(diff), ['notas.txt'], 'lo que se quita y los .env.example no cuentan');
});

test('60: «Guardar cambios» no hace commit de una clave escrita en cualquier archivo; el .gitignore nuevo cubre *.env y dist/', () => {
  const p = createProject(board, { name: 'secretos' }, 'usuario');
  const ignore = fs.readFileSync(path.join(p.path, '.gitignore'), 'utf8');
  assert.match(ignore, /^\*\.env$/m); assert.match(ignore, /^dist\/$/m);
  fs.writeFileSync(path.join(p.path, 'notas.txt'), `mi token es ${GHP}\n`);
  assert.throws(() => commitAll(p, 'notas'), /notas\.txt contiene algo que parece una clave/);
  assert.equal(git(p.path, 'diff', '--cached', '--name-only').stdout.trim(), '', 'el índice queda vacío');
  fs.writeFileSync(path.join(p.path, 'notas.txt'), 'sin secretos\n');
  fs.writeFileSync(path.join(p.path, 'config-prueba.env'), 'OPENAI_API_KEY=sk-proj-abc123def456\n');
  fs.mkdirSync(path.join(p.path, 'dist')); fs.writeFileSync(path.join(p.path, 'dist', 'app.js'), 'compilado');
  assert.equal(commitAll(p, 'notas limpias').files, 1);
  assert.deepEqual(git(p.path, 'ls-files').stdout.trim().split(/\r?\n/).sort(), ['.gitignore', 'notas.txt'], 'ni el .env ni dist/ entran');
  // A key that reached a commit some other way is caught before any push.
  fs.writeFileSync(path.join(p.path, 'claves.md'), `# Claves\n${GHP}\n`);
  git(p.path, 'add', 'claves.md'); git(p.path, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'claves');
  assert.deepEqual(unpushedSecrets(p.path, 'HEAD'), ['claves.md']);
});

test('60: el commit automático de una copia aislada tampoco guarda claves', () => {
  const p = createProject(board, { name: 'aislada' }, 'usuario');
  fs.writeFileSync(path.join(p.path, 'app.js'), `const key = "${GHP}";\n`);
  const self = { board };
  const r = Scheduler.prototype.commitIsolated.call(self, { id: 1, title: 'x', branch: 'orb/x', workdir: p.path });
  assert.match(r, /app\.js/);
  assert.equal(git(p.path, 'diff', '--cached', '--name-only').stdout.trim(), '');
});

test('5: el nombre de un proyecto es el de su carpeta: se rechaza lo que la carpeta no puede llevar', () => {
  assert.equal(projectNameProblem('con/barra:*?'), 'msg.projects.badChars');
  assert.equal(projectNameProblem('web.'), 'msg.projects.badEnd');
  assert.equal(projectNameProblem('con'), 'msg.projects.windowsName');
  assert.equal(projectNameProblem('x'.repeat(61)), 'msg.projects.tooLong');
  assert.equal(projectNameProblem('mi web'), null);
  assert.throws(() => createProject(board, { name: 'con/barra:*?' }, 'usuario'), /no puede llevar/);
  assert.equal(createProject(board, { name: 'mi web' }, 'usuario').name, 'mi web');
});

test('34: renombrar un proyecto mueve su carpeta, su bitácora y sus referencias; con tareas abiertas, no', () => {
  const p = createProject(board, { name: 'viejo' }, 'usuario');
  const conv = board.createConversation({ project: 'viejo' }).id;
  const task = board.createTask({ project: 'viejo', title: 'Hola', description: 'crea hola.txt', agent: 'claude' }, 'usuario');
  assert.throws(() => renameProject(board, { name: 'viejo', to: 'nuevo' }, 'usuario'), /pendientes o en curso/);
  board.run("UPDATE tasks SET status = 'done', workdir = ? WHERE id = ?", p.path, task.id);
  board.setActiveProject('viejo', 'usuario');
  board.setting(`wb_seen:viejo:${conv}`, '5');
  fs.appendFileSync(board.projectLogFile('viejo'), '\n### entrada anterior\n');
  assert.throws(() => renameProject(board, { name: 'viejo', to: 'mal/nombre' }, 'usuario'), /no puede llevar/);
  const r = renameProject(board, { name: 'viejo', to: 'nuevo' }, 'usuario');
  assert.equal(r.name, 'nuevo'); assert.equal(path.basename(r.path), 'nuevo');
  assert.ok(fs.existsSync(path.join(r.path, '.git'))); assert.ok(!fs.existsSync(p.path));
  assert.equal(board.task(task.id).project, 'nuevo'); assert.equal(board.task(task.id).workdir, r.path);
  assert.equal(board.conversation(conv).project, 'nuevo');
  assert.equal(board.setting('active_project'), 'nuevo');
  assert.equal(board.setting(`wb_seen:nuevo:${conv}`), '5');
  assert.match(fs.readFileSync(board.projectLogFile('nuevo'), 'utf8'), /entrada anterior/, 'la bitácora conserva sus entradas');
  assert.ok(!fs.existsSync(board.projectLogFile('viejo')));
  assert.equal(board.project('viejo'), undefined);
});

test('22 y 27: horas locales y tamaños legibles en las copias y la pizarra', () => {
  const d = new Date(2026, 9, 14, 9, 35, 36);
  assert.equal(localStamp(d), '20261014-093536'); assert.equal(localText(d), '2026-10-14 09:35');
  assert.equal(sizeText(445 * 1024), '445 KB'); assert.equal(sizeText(0), '0 KB'); assert.equal(sizeText(300), '1 KB');
  assert.equal(sizeText(3.14 * 1048576), '3.1 MB'); assert.equal(sizeText(25 * 1048576), '25 MB');
  const before = Date.now();
  const b = backup(t.home, board.db);
  assert.match(b.name, /^\d{8}-\d{6}$/); assert.match(b.size, /^\d+(\.\d)? (KB|MB)$/);
  const [y, mo, da, h] = [b.name.slice(0, 4), b.name.slice(4, 6), b.name.slice(6, 8), b.name.slice(9, 11)].map(Number);
  assert.ok(Math.abs(new Date(y, mo - 1, da, h).getTime() - before) < 2 * 3600_000, 'el nombre va en la hora del PC');
  assert.equal(drawingContents([]), 'El dibujo está vacío.');
  assert.equal(drawingContents([{ type: 'text', text: 'Hola' }]), 'Contiene: 1 texto.', 'un texto no es un dibujo vacío');
  assert.equal(drawingContents([{ type: 'rectangle' }, { type: 'rectangle' }, { type: 'text' }, { type: 'arrow', isDeleted: true }]), 'Contiene: 1 texto, 2 rectángulos.');
});

test('31: Opti Bot: «Rechazar» devuelve datos que cruzan a la ventana, y la tarjeta enseña el nombre del programa', async () => {
  assert.equal(programLabel('MicrosoftEdgeAutoLaunch_60E4EE12BF689B5262806EAC5AE6112E'), 'Microsoft Edge');
  assert.equal(programLabel('OneDrive'), 'OneDrive');
  assert.equal(programLabel('Teams.exe'), 'Teams');
  saveConfig({ monitor: { enabled: true } });
  const sent = [];
  const fakeSession = { id: 'opti-1', agent: 'claude' };
  const sessions = {
    get: (id) => (id === 'opti-1' ? fakeSession : null), isRunning: () => false,
    send: (id, text) => { sent.push(text); return { promise: Promise.resolve(), stop: () => {} }; }, // like the real run object: not cloneable
    updateItem: (id, body) => board.run('UPDATE session_items SET body = ? WHERE id = ?', JSON.stringify(body), id)
  };
  board.setting('opti_session', 'opti-1');
  const { lastInsertRowid } = board.run('INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, ?, ?, ?, ?)', 'opti-1', 'system', 'opti_action', JSON.stringify({ action: 'clean_temp', reason: 'x', status: 'pending' }), new Date().toISOString());
  const r = await opti({ board, sessions }).act({ item: Number(lastInsertRowid), decision: 'deny' });
  assert.deepEqual(structuredClone(r), { ok: true, denied: true });
  assert.equal(sent.length, 1, 'Opti Bot se entera');
  assert.equal(JSON.parse(board.one('SELECT body FROM session_items WHERE id = ?', Number(lastInsertRowid)).body).status, 'denied');
});

test('58: una sola regla para los borrados: el pedido actual pide borrar y nombra los archivos que borra la tarea', () => {
  assert.equal(deletionAskedByUser('Borra saludo.html y despedida.html de este proyecto, ya no los necesito.', 'Borra saludo.html y despedida.html del proyecto.'), true);
  assert.equal(deletionAskedByUser('Borra juego.html del proyecto.', 'Elimina juego.html de la carpeta web/prueba.'), true);
  assert.equal(deletionAskedByUser('Borra juego.html', 'Borra juego.html e index.html.'), false, 'index.html no lo nombró');
  assert.equal(deletionAskedByUser('Crea una web de notas donde se puedan borrar notas', 'Servidor para guardar, listar y borrar notas'), true, 'sin archivos: basta con que lo pida');
  assert.equal(deletionAskedByUser('No borres nada, solo revisa', 'Borra x.html'), false);
  assert.equal(deletionAskedByUser('Haz una web', 'Borra x.html'), false);
  assert.deepEqual(filesToDelete('Crea index.html. Después borra viejo.css y src/tmp.js.'), ['viejo.css', 'tmp.js']);
  createProject(board, { name: 'borrados' }, 'usuario');
  const conv = board.createConversation({ project: 'borrados' }).id;
  const make = (sensitivity, description = 'Borra saludo.html y despedida.html del proyecto.') => board.createTask({ project: 'borrados', title: 'Borrar', description, agent: 'claude', sensitivity, conversation_id: conv }, 'orb');
  assert.equal(make(['destructive']).status, 'awaiting_approval', 'sin pedirlo, espera aprobación');
  board.addChat('usuario', 'Borra saludo.html y despedida.html de este proyecto, ya no los necesito.', null, conv);
  assert.equal(make(['destructive']).status, 'queued', 'lo marque Orbe…');
  assert.equal(make([]).status, 'queued', '…o lo encuentre la red de palabras, la regla es la misma');
  const both = make(['destructive', 'publish']);
  assert.equal(both.status, 'awaiting_approval'); assert.deepEqual(both.sensitivity, ['publish'], 'solo espera por publicar');
  assert.equal(make(['destructive'], 'Borra saludo.html, despedida.html e index.html.').status, 'awaiting_approval', 'borra algo que no nombró');
});

test('28: la Actividad se cuenta en el idioma de la app, no en el del momento en que pasó', () => {
  const task = board.createTask({ project: 'borrados', title: 'Idioma', description: 'crea a.txt', agent: 'claude' }, 'usuario');
  board.event(task.id, 'orb', 'checkpoint', eventKey('sys.events.checkpointGit', { ref: 'refs/orb/t1' }));
  board.event(task.id, 'orb', 'model.auto', eventKey('msg.scheduler.autoModel', { model: 'Haiku', tier: { k: 'msg.tier.light' }, level: { k: 'msg.level.simple' }, reasoning: { k: 'msg.reasoning.low' } }));
  const es = board.taskDetail(task.id).events.find((e) => e.kind === 'checkpoint').detail;
  assert.equal(es, 'foto de la carpeta antes de la tarea (refs/orb/t1)');
  saveConfig({ language: 'en' });
  try {
    assert.equal(board.recentEvents(10).find((e) => e.kind === 'checkpoint').detail, 'snapshot of the folder before the task (refs/orb/t1)');
    assert.doesNotMatch(board.recentEvents(10).find((e) => e.kind === 'model.auto').detail, /@t:|ha elegido/);
  } finally { saveConfig({ language: 'es' }); }
  assert.equal(eventText('un texto antiguo'), 'un texto antiguo');
});

test('52 y 26: las bitácoras firman con el agente, no cortan palabras y recogen las conversaciones directas', () => {
  assert.equal(agentAuthor('codex', { model: 'gpt-6-luna', via: 'tarea #12' }), 'Codex (tarea #12, gpt-6-luna)');
  assert.equal(agentAuthor('cursor'), 'Cursor');
  const cut = cutWords('Diálogo de confirmación antes de borrar todas las notas', 30);
  assert.ok(cut.endsWith('…') && cut.length <= 30); assert.doesNotMatch(cut, /confirmac…/);
  const p = createProject(board, { name: 'directa' }, 'usuario');
  const s = { project: 'directa', cwd: p.path, agent: 'claude', model: 'sonnet', title: 'Juego' };
  const before = changedFiles(p.path);
  fs.writeFileSync(path.join(p.path, 'juego.html'), '<h1>Juego</h1>');
  assert.equal(logDirect(board, s, { before, request: 'Haz un juego en juego.html', answer: 'Hecho: juego.html con el juego.' }), true);
  const log = fs.readFileSync(board.projectLogFile('directa'), 'utf8');
  assert.match(log, /— Claude \(conversación directa, sonnet\) — Conversación «Juego»/); assert.match(log, /juego\.html/);
  assert.equal(logDirect(board, s, { before: changedFiles(p.path), request: 'hola', answer: 'hola' }), false, 'sin cambios, sin entrada');
});

test('44: las piezas que escriben leen el CONTRATO.md de la base', () => {
  const dir = fs.mkdtempSync(path.join(t.base, 'contrato-'));
  assert.equal(contractNote(dir, { readonly: false }), '');
  fs.writeFileSync(path.join(dir, 'CONTRATO.md'), '# Contrato');
  assert.match(contractNote(dir, { readonly: false }), /CONTRATO\.md.*ids, clases/);
  assert.equal(contractNote(dir, { readonly: true }), '', 'la verificación no escribe');
  assert.equal(ctx.config.language, 'es');
});
