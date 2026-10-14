// 3.2.1: the chat and the interface after the user tests of 14 Oct 2026. Messages written while the assistant answers are
// never lost (finding 24), a late answer does not pull the user back to the previous conversation (23), «Detener» keeps
// what was written (55), a rejected task is told in its conversation (68), and texts read as product copy: no internal
// names, no raw JSON, no escaped commands, no «tarea(s)» (12, 20, 11, 53, 56, 57, 18, 45, 6, 10).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { ctx } from '../src/core/context.mjs';
import { Board, tagWords } from '../src/core/board.mjs';
import { Orchestrator, answerOf } from '../src/engine/orchestrator.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { plainAction, looksEnglish, deleteTarget } from '../src/core/guard.mjs';
import { bumpNav, navTicket, stillHere } from '../src/ui/lib/nav.js';
import { readableCommand, readableInput, prettyModel } from '../src/ui/lib/tools.js';
import { activityLabel, activityDetail } from '../src/ui/lib/activity.js';
import { cutWords } from '../src/ui/lib/text.js';
import { pickGreeting, suggestionsFor } from '../src/ui/lib/greeting.js';
import { createT } from '../src/core/i18n.mjs';

const home = tempHome();
after(() => home.cleanup());
const tick = () => new Promise((r) => setImmediate(r));

// An assistant whose turns are held until the test lets them finish (as in asistente.test.mjs), with a live process that
// records any attempt to put a message into the running turn.
function assistant(board) {
  const o = new Orchestrator(board, 'clave');
  o.turns = []; o.steered = [];
  const make = o.lane.bind(o);
  o.lane = (id) => {
    const l = make(id);
    if (!l.held) {
      l.held = true;
      l.live = { steer: ({ text }) => { o.steered.push(text); return true; }, interrupt: () => {}, close: () => {}, isClosed: () => false };
      l.run = (text) => new Promise((resolve) => o.turns.push({ text, conversation: l.id, resolve: () => { l.busy = false; resolve({ ok: true }); } }));
    }
    return l;
  };
  return o;
}

test('24: un mensaje escrito mientras el asistente responde espera su turno y se suma al anterior; nunca se pierde', async () => {
  const board = new Board();
  const o = assistant(board);
  const { conversation } = o.ask('di solo la palabra tres');
  assert.equal(o.turns.length, 1);
  o.ask('di solo la palabra cuatro', '', { conversation });
  assert.deepEqual(o.steered, [], 'nada se mete en el turno en curso');
  assert.equal(o.state(conversation).queued, 1, 'el segundo espera en la cola de su conversación');
  o.ask('y luego cinco', '', { conversation });
  assert.equal(o.state(conversation).queued, 1, 'los que llegan mientras tanto van juntos, en un solo turno');
  o.turns[0].resolve(); await tick(); await tick();
  assert.equal(o.turns.length, 2, 'al terminar el primero, se contesta el siguiente');
  assert.match(o.turns[1].text, /se suma a lo anterior/);
  assert.match(o.turns[1].text, /di solo la palabra cuatro[\s\S]*y luego cinco/);
  assert.deepEqual(board.chat(conversation).filter((m) => m.role === 'usuario').map((m) => m.body), ['di solo la palabra tres', 'di solo la palabra cuatro', 'y luego cinco'], 'el chat los muestra tal como se escribieron');
  o.turns[1].resolve(); await tick();
  assert.equal(o.turns.length, 2);
});

test('24: un mensaje en una conversación libre se contesta enseguida, sin la nota de «se suma»', () => {
  const board = new Board();
  const o = assistant(board);
  o.ask('hola');
  assert.equal(o.turns.length, 1);
  assert.equal(o.turns[0].text, 'hola');
});

test('45: la respuesta de un turno es su mensaje final, no todos los intermedios pegados', () => {
  const long = 'He revisado el trabajo: la verificación encontró que las letras no reciben ataques y he encargado una corrección a Cursor.';
  assert.equal(answerOf({ final: 'Informe final', text: 'Voy a mirar\n\nInforme final' }, ['Voy a mirar', 'Informe final']), 'Informe final', 'el final del agente, si lo da');
  assert.equal(answerOf({ final: '', text: `Voy a revisar.\n\n${long}\n\n${long}` }, ['Voy a revisar.', long, long]), long, 'Codex: solo el último');
  assert.equal(answerOf({ final: '', text: `${long}\n\nListo.` }, [long, 'Listo.']), `${long}\n\nListo.`, 'un cierre corto se queda con el anterior');
  assert.equal(answerOf({ final: 'Hola', text: 'Hola' }, ['Hola']), 'Hola');
  assert.equal(answerOf({ final: '', text: '' }, []), '');
});

test('55: «Detener» deja lo que ya había escrito, marcado como respuesta detenida', () => {
  const board = new Board();
  const o = new Orchestrator(board, 'clave');
  const c = board.createConversation({ title: 'Explicación' });
  const lane = o.lane(c.id);
  lane.busy = true; lane.said = ['Primero, el motor.']; lane.partial = 'Después, la ventana';
  o.stop(c.id);
  const last = board.chat(c.id).at(-1);
  assert.equal(last.role, 'orb');
  assert.match(last.body, /Primero, el motor\.\n\nDespués, la ventana\n\n\*Respuesta detenida\.\*/);
  // Nothing written yet: the mark alone.
  lane.busy = true; lane.said = []; lane.partial = '';
  o.stop(c.id);
  assert.equal(board.chat(c.id).at(-1).body, 'Respuesta detenida.');
});

test('68 y 56: rechazar una tarea lo dice en su conversación y avisa al asistente; la aprobación sale en palabras', async () => {
  const board = new Board();
  const dir = path.join(ctx.paths.categories.web, 'rechazos'); fs.mkdirSync(dir, { recursive: true });
  board.addProject({ name: 'rechazos', path: dir }, 'usuario');
  const c = board.createConversation({ title: 'Borrados', project: 'rechazos' });
  const task = board.createTask({ project: 'rechazos', title: 'Borrar saludo.html', description: 'Elimina saludo.html', agent: 'any', sensitivity: ['destructive'], conversation_id: c.id }, 'orb');
  assert.equal(task.status, 'awaiting_approval');
  const notice = board.chat(c.id).find((m) => m.meta?.kind === 'attention');
  assert.match(notice.body, /necesita tu aprobación \(elimina datos\)/, 'la etiqueta, traducida');
  assert.doesNotMatch(notice.body, /destructive/);
  assert.equal(notice.meta.task, task.id, 'con su tarea, para los botones del chat');
  const internal = [];
  const api = buildApi({ board, sessions: {}, orchestrator: { internal: (...args) => internal.push(args) }, scheduler: {}, emit: () => {}, log: () => {}, version: 'test' });
  const out = await api.call('tasks.approve', { id: task.id, decision: 'rejected', hash: board.previewHash(board.task(task.id)) });
  assert.equal(out.status, 'cancelled');
  assert.equal(internal.length, 1, 'el asistente se entera');
  assert.match(internal[0][0], /ha rechazado la tarea #\d+/);
  assert.match(internal[0][1], /Rechazaste la tarea #\d+ «Borrar saludo\.html»/, 'y la conversación tiene su línea');
  assert.equal(internal[0][3].conversation, c.id);
});

test('tagWords: las etiquetas internas de una tarea, en palabras', () => {
  assert.equal(tagWords(['destructive', 'publish', 'destructive']), 'elimina datos, publica');
  assert.equal(tagWords(['algo_nuevo']), 'algo_nuevo', 'una desconocida, tal cual');
});

test('23: una respuesta tardía no lleva al usuario a otra parte si ya se movió', () => {
  const ticket = navTicket();
  assert.equal(stillHere(ticket), true, 'sin moverse, se va a la conversación creada');
  bumpNav(); // «Nuevo chat» mientras llegaba la respuesta
  assert.equal(stillHere(ticket), false, 'se movió: se queda donde está');
  assert.equal(stillHere(navTicket()), true);
});

test('53: el permiso de un borrado dice qué borra, y lo que el agente escribe en inglés no se cita en español', () => {
  assert.equal(plainAction('rm -rf /tmp/tierra-build-check'), 'borrar «/tmp/tierra-build-check»');
  assert.equal(plainAction('rm -rf /tmp/x', { lang: 'en' }), 'delete “/tmp/x”');
  assert.equal(deleteTarget(`Remove-Item -Recurse -Force ${'C:\\carpeta\\'.repeat(12)}fin`).length, 58, 'una ruta larga, recortada por la izquierda');
  assert.equal(deleteTarget('rm -rf $tmp'), null);
  assert.equal(looksEnglish('Start Vite dev server'), true);
  assert.equal(looksEnglish('Arrancar el servidor de pruebas'), false);
  assert.equal(looksEnglish('Vite'), false, 'una sola palabra sin pistas no cuenta');
});

test('11 y 20: los comandos y las llamadas de las herramientas se leen sin escapes ni JSON', () => {
  const codex = `"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command '$paths = @('"'"'D:\\\\Orb\\\\web'"'"'); Get-ChildItem $paths'`;
  assert.equal(readableCommand(codex), "$paths = @('D:\\Orb\\web'); Get-ChildItem $paths");
  assert.equal(readableCommand('npm run dev'), 'npm run dev');
  assert.equal(readableInput('{"action":"clean_temp","reason":"x"}', 'mcp__opti__opti_propose'), 'clean_temp');
  assert.equal(readableInput('{"command":"npm test"}', 'Bash'), 'npm test');
  assert.equal(readableInput('select:mcp__opti__opti_health,mcp__opti__opti_propose', 'ToolSearch'), '', 'buscar sus herramientas no tiene nada que leer');
  assert.equal(readableInput('{"a":1, "b"', 'x'), '', 'un JSON cortado no se enseña');
  assert.equal(prettyModel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(prettyModel('gpt-6-luna'), 'GPT-6-Luna');
  assert.equal(prettyModel('haiku'), 'Haiku');
});

test('57: la actividad en palabras, sin nombres internos ni JSON', () => {
  const t = createT('es');
  assert.equal(activityLabel(t, 'task.usage'), 'Uso de la tarea');
  assert.equal(activityLabel(t, 'evento.raro'), 'evento.raro');
  assert.equal(activityDetail(t, { kind: 'task.usage', detail: '{"minutes":1,"tokens":0,"costUsd":null}' }, 'es-ES'), '1 min');
  assert.equal(activityDetail(t, { kind: 'task.launch_options', detail: '{"agent":"cursor","model":"composer-2.5","reasoning":"low"}' }, 'es-ES', { cursor: 'Cursor' }), 'Cursor · composer-2.5 · razonamiento bajo');
  assert.equal(activityDetail(t, { kind: 'checkpoint', detail: 'foto de la carpeta antes de la tarea (refs/orb/t24-1791970229048)' }, 'es-ES'), 'foto de la carpeta antes de la tarea');
});

test('18: un aviso largo se corta por palabra, con «…»', () => {
  const text = 'La tarea #3 (Claude) pide permiso para cerrar un programa. El agente dice que es para: «Parar el servidor»';
  const cut = cutWords(text, 95);
  assert.ok(cut.endsWith('…'));
  assert.ok(!/«Par…$/.test(cut), cut);
  assert.ok(text.startsWith(cut.slice(0, -1)));
  assert.equal(cutWords('corto', 10), 'corto');
});

test('10 y 6: saludo y sugerencias acordes a lo que pasa', () => {
  const running = [{ status: 'running' }];
  for (let i = 0; i < 40; i++) {
    const g = pickGreeting({ tasks: running, random: () => 0.99 - (i % 10) * 0.001 });
    assert.notEqual(g.key, 'greet.rested', 'nunca «descansados» con tareas en marcha');
  }
  assert.ok(!suggestionsFor('prueba-notas').includes('chat.suggestion1'), 'con proyecto, nada de «Crea un proyecto»');
  assert.ok(!suggestionsFor(null).includes('chat.suggestion3'), 'sin proyecto, nada de «Revisa el proyecto»');
});

test('12: «una tarea» / «2 tareas», nunca «tarea(s)»', () => {
  const es = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'core', 'locales', 'es', 'msg.mjs'), 'utf8');
  assert.doesNotMatch(es.match(/"msg\.orch\.playWhileWaiting": "[^"]*"/)[0], /\(s\)/);
});
