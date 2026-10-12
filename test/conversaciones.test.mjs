// 3.2: conversations of their own. The chat from before 3.2 is split into conversations without losing anything, titles are
// short and clear, a subtask or a review belongs to the conversation of its task, and each project shows its own icon.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { migrate } from '../src/core/db.mjs';
import { titleFrom, cleanTitle } from '../src/core/titles.mjs';
import { ctx } from '../src/core/context.mjs';
import { projectIcon, setProjectIcon, clearProjectIcon } from '../src/engine/project-icons.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';

const t = tempHome();
after(() => t.cleanup());

test('el chat de antes de la 3.2 se parte en conversaciones, con sus líneas y sus tareas, sin perder nada', () => {
  const board = new Board();
  const dir = path.join(ctx.paths.categories.web, 'web'); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'web', path: dir }, 'usuario');
  const line = (role, body, at) => board.run('INSERT INTO chat (role, body, meta, at) VALUES (?, ?, NULL, ?)', role, body, at);
  line('usuario', 'Quiero que me hagas una web de recetas', '2026-10-01T10:00:00.000Z');
  line('orb', 'Hecho el plan.', '2026-10-01T10:01:00.000Z');
  board.run("INSERT INTO tasks (project, title, description, status, created_by, created_at, updated_at) VALUES ('web', 'Recetas', 'x', 'done', 'orb', '2026-10-01T10:02:00.000Z', '2026-10-01T10:05:00.000Z')");
  line('notice', 'Nueva conversación. Orbe no conserva el contexto anterior.', '2026-10-02T09:00:00.000Z');
  line('system', '✅ Claude terminó la tarea #9 (una línea suelta)', '2026-10-02T09:00:30.000Z');
  line('usuario', 'Hola! revisa las dependencias por favor', '2026-10-02T09:01:00.000Z');
  line('orb', 'Revisadas.', '2026-10-02T09:02:00.000Z');
  board.setting('orchestrator_session', 'sesion-viva'); board.setting('orchestrator_turns', '7');
  board.setting('conversations_migrated', '');
  board.run('DELETE FROM settings WHERE key = ?', 'conversations_migrated');
  migrate(board.db);

  const list = board.conversations().sort((a, b) => a.id - b.id);
  assert.equal(list.length, 2, 'una por cada «Nueva conversación»');
  assert.equal(list[0].title, 'Web de recetas');
  assert.equal(list[0].status, 'done', 'las anteriores, completadas');
  assert.equal(list[0].project, 'web', 'con el proyecto de sus tareas');
  assert.equal(list[1].title, 'Revisa las dependencias');
  assert.equal(list[1].status, 'open', 'la última sigue abierta');
  assert.equal(list[1].session_id, 'sesion-viva', 'y continúa la conversación del asistente');
  assert.equal(list[1].turns, 7);
  assert.deepEqual(board.chat(list[0].id).map((m) => m.body), ['Quiero que me hagas una web de recetas', 'Hecho el plan.']);
  assert.equal(board.chat(list[1].id).length, 3, 'la línea suelta va con la conversación de su momento');
  assert.equal(board.one("SELECT conversation_id AS c FROM tasks WHERE title = 'Recetas'").c, list[0].id, 'la tarea, con la conversación que la pidió');
  assert.equal(board.one("SELECT COUNT(*) AS n FROM chat WHERE role != 'notice' AND conversation_id IS NULL").n, 0, 'ninguna línea sin conversación');
  migrate(board.db);
  assert.equal(board.conversations().length, 2, 'solo una vez');
});

test('una subtarea o una revisión es de la conversación de su tarea', () => {
  const board = new Board();
  const dir = path.join(ctx.paths.categories.web, 'otra'); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'otra', path: dir }, 'usuario');
  const c = board.createConversation({ title: 'Pedido', project: 'otra' });
  const task = board.createTask({ project: 'otra', title: 'Base', description: 'Haz la base', agent: 'any', conversation_id: c.id }, 'orb');
  const sub = board.createTask({ project: 'otra', title: 'Parte', description: 'Haz una parte', agent: 'any', parent_id: task.id }, 'claude');
  const review = board.createTask({ project: 'otra', title: 'Revisión', description: 'Revisa', agent: 'any', review_of: task.id, readonly: true }, 'orb');
  assert.equal(task.conversation_id, c.id);
  assert.equal(sub.conversation_id, c.id);
  assert.equal(review.conversation_id, c.id);
  assert.equal(board.openTasksOf(c.id), 3);
  const line = board.addChat('system', 'La tarea terminó', { task: sub.id });
  assert.equal(line.conversation, c.id, 'las líneas de la tarea van a su conversación');
});

test('títulos cortos y claros', () => {
  assert.equal(titleFrom('Quiero que me hagas una web de recetas con buscador. Que sea bonita'), 'Web de recetas con buscador');
  assert.equal(titleFrom('Hola! puedes revisar el proyecto y proponer mejoras?'), 'Revisar el proyecto y proponer mejoras');
  assert.equal(titleFrom('arregla el bug del login @tarea:12'), 'Arregla el bug del login');
  assert.ok(titleFrom('Construye un Hello World 3D con planeta y armas: terremoto, martillo y nuclear').split(' ').length <= 6);
  assert.equal(cleanTitle('Título: "Web de recetas".'), 'Web de recetas');
  assert.equal(cleanTitle('{"title": "x"}'), '', 'nada raro');
});

test('cada proyecto con su icono: el suyo, uno elegido o ninguno', () => {
  const dir = path.join(ctx.paths.categories.web, 'con-icono'); fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  const project = { name: 'con-icono', path: dir };
  assert.equal(projectIcon(project), null, 'sin icono, la ventana dibuja sus iniciales');
  fs.writeFileSync(path.join(dir, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.match(projectIcon(project), /^data:image\/svg\+xml;base64,/, 'el favicon del proyecto');
  const png = path.join(t.home, 'mio.png'); fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.match(setProjectIcon(project, png), /^data:image\/png;base64,/, 'el elegido gana');
  assert.ok(!fs.readdirSync(path.join(dir, 'public')).includes('mio.png'), 'el proyecto no se toca');
  assert.match(clearProjectIcon(project), /^data:image\/svg/, 'quitado, vuelve el suyo');
  const big = path.join(t.home, 'grande.png'); fs.writeFileSync(big, Buffer.alloc(600 * 1024));
  assert.throws(() => setProjectIcon(project, big), /demasiado grande/);
});

// Found by the review of 3.2: each conversation keeps to its own project, and one opened again is not completed at once.
test('una subtarea se comprueba contra el proyecto de su conversación, aunque otra haya cambiado la carpeta de trabajo', () => {
  const board = new Board();
  for (const name of ['xa', 'xb']) { const dir = path.join(ctx.paths.categories.web, name); fs.mkdirSync(dir, { recursive: true }); board.addProject({ name, path: dir }, 'usuario'); }
  const a = board.createConversation({ title: 'A', project: 'xa' });
  const task = board.createTask({ project: 'xa', title: 'Base', description: 'Haz la base', agent: 'any', conversation_id: a.id }, 'orb');
  const b = board.createConversation({ title: 'B' });
  board.setConversationProject(b.id, 'xb', 'orb'); // the other conversation moves the app's working folder
  assert.equal(board.activeProject().name, 'xb');
  const sub = board.createTask({ project: 'xa', title: 'Parte', description: 'Haz una parte', agent: 'any', parent_id: task.id }, 'claude');
  assert.equal(sub.conversation_id, a.id, 'la subtarea se crea en su conversación');
  const review = board.createTask({ project: 'xa', title: 'Revisión', description: 'Revisa', agent: 'any', review_of: task.id, readonly: true }, 'orb');
  assert.equal(review.conversation_id, a.id, 'y la revisión también');
});

test('una conversación vuelta a abrir no se completa sola enseguida; una con su informe sin OK, tampoco', () => {
  const board = new Board();
  const o = new Orchestrator(board, 'clave');
  try {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const quiet = board.createConversation({ title: 'Tranquila' });
    board.updateConversation(quiet.id, { updated_at: old });
    o.settleIdle();
    assert.equal(board.conversation(quiet.id).status, 'done', 'un día sin nada abierto: completada');
    board.setConversationDone(quiet.id, false); // the user brings it back
    o.settleIdle();
    assert.equal(board.conversation(quiet.id).status, 'open', 'abierta otra vez cuenta como actividad');
    const waiting = board.createConversation({ title: 'Con informe' });
    board.addChat('orb', 'Informe', { kind: 'report', tasks: [9999] }, waiting.id);
    board.updateConversation(waiting.id, { updated_at: old });
    o.settleIdle();
    assert.equal(board.conversation(waiting.id).status, 'open', 'su informe espera el OK: no se esconde');
  } finally { clearInterval(o.sweeper); }
});