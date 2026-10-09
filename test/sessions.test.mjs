// Live sessions (src/engine/sessions.mjs) with the fake agents, in this process: one live process per conversation, the
// queue and steering while the agent works, approval cards (allow, always, deny; denied when stopped; expired when the
// app closes), the context meter, real usage, forks, continuing after a restart and failures of the adapter itself.
import { tempHome, until, fakeLog } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.mjs';
import { createProject } from '../src/core/projects.mjs';
import { Sessions } from '../src/engine/sessions.mjs';

let t; let board; let sessions; let project; const rates = []; const emitted = [];
before(() => {
  t = tempHome(); board = new Board();
  project = createProject(board, { name: 'web' }, 'usuario');
  sessions = new Sessions(board, { emit: (event, payload) => emitted.push({ event, payload }) });
  sessions.onRate = (account, rate) => rates.push({ account, rate });
});
after(() => { sessions.stopAll(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const chat = (agent = 'claude', extra = {}) => sessions.create({ agent, cwd: project.path, project: 'web', title: `con ${agent}`, ...extra });
const idle = (id) => until(() => !sessions.isRunning(id) && sessions.get(id), `turno de ${id}`);
const texts = (id, role = 'assistant') => sessions.items(id).filter((i) => i.role === role && i.kind === 'text').map((i) => (typeof i.body === 'string' ? i.body : i.body.text));
const card = (id) => until(() => sessions.items(id).find((i) => i.kind === 'approval' && i.body.status === 'pending'), 'tarjeta de permiso');

test('un proceso vivo por conversación: el segundo mensaje va al mismo y la respuesta llega en directo', async () => {
  const s = chat();
  sessions.send(s.id, 'hola');
  await idle(s.id);
  const live = sessions.lives.get(s.id).live;
  sessions.send(s.id, 'otra vez');
  assert.equal(sessions.get(s.id).status, 'running');
  await idle(s.id);
  assert.equal(sessions.lives.get(s.id).live, live, 'el mismo proceso entre turnos');
  assert.deepEqual(texts(s.id), ['Recibido: hola', 'Recibido: otra vez']);
  assert.ok(emitted.some((e) => e.event === 'session:delta' && e.payload.id === s.id), 'texto por trozos para la ventana');
  const after2 = sessions.get(s.id);
  assert.equal(after2.status, 'idle');
  assert.ok(after2.cli_session, 'Claude guarda el id de su conversación');
  assert.deepEqual(after2.context, { ...after2.context, used: 2000, size: 200000 }, 'medidor de contexto');
  assert.throws(() => sessions.send(s.id, '   '), /escribe un mensaje/);
});

test('cola: lo que se escribe mientras trabaja espera, se puede editar y sale solo al terminar, en orden', async () => {
  const s = chat('cursor'); // Cursor no corrige en marcha: todo va a la cola
  sessions.send(s.id, 'LENTO primero');
  assert.deepEqual(sessions.message(s.id, 'segundo'), { queued: true });
  assert.deepEqual(sessions.message(s.id, 'tercero'), { queued: true });
  assert.deepEqual(sessions.message(s.id, 'cuarto', { mode: 'queue' }), { queued: true });
  let q = sessions.queue(s.id);
  assert.deepEqual(q.map((m) => m.text), ['segundo', 'tercero', 'cuarto']);
  q = sessions.editQueued(s.id, q[0].id, { text: 'segundo (editado)' });
  q = sessions.editQueued(s.id, q[2].id, { move: 'up' });
  q = sessions.editQueued(s.id, q.find((m) => m.text === 'tercero').id, { remove: true });
  assert.deepEqual(q.map((m) => m.text), ['segundo (editado)', 'cuarto']);
  assert.throws(() => sessions.editQueued(s.id, 999999, { text: 'x' }), /ya no está en la cola/);
  await until(() => texts(s.id).length === 3 && !sessions.isRunning(s.id), 'la cola se vacía');
  assert.deepEqual(texts(s.id), ['Recibido: LENTO primero', 'Recibido: segundo (editado)', 'Recibido: cuarto']);
  assert.deepEqual(sessions.queue(s.id), []);
  assert.ok(emitted.some((e) => e.event === 'session:queue'));
});

test('corregir en marcha: con Claude el mensaje llega al turno que está en curso', async () => {
  const s = chat('claude');
  sessions.send(s.id, 'ESPERA_CORRECCION haz la portada');
  await until(() => sessions.lives.get(s.id)?.live.busy, 'turno en marcha');
  assert.deepEqual(sessions.message(s.id, 'mejor en azul'), { steered: true });
  await idle(s.id);
  assert.deepEqual(texts(s.id), ['Recibido: ESPERA_CORRECCION haz la portada | corrección: mejor en azul']);
  assert.ok(sessions.items(s.id).some((i) => i.role === 'user' && i.body.steer === true && i.body.text === 'mejor en azul'), 'se ve como corrección');
  assert.deepEqual(sessions.queue(s.id), [], 'no pasa por la cola');
  // "queue" forces the queue even when the agent could steer; pictures always wait for the next turn.
  sessions.send(s.id, 'LENTO otra');
  assert.deepEqual(sessions.message(s.id, 'para después', { mode: 'queue' }), { queued: true });
  await until(() => texts(s.id).length === 3 && !sessions.isRunning(s.id), 'mensaje de la cola enviado');
  assert.equal(texts(s.id)[2], 'Recibido: para después');
});

test('aprobaciones: permitir, permitir siempre y denegar, con su tarjeta', async () => {
  const s = chat('claude');
  const notices = []; sessions.onApproval = (sess, item) => notices.push({ sess, item });
  for (const [decision, status, answer] of [['allow', 'allowed', 'permiso concedido (allow)'], ['always', 'always', 'permiso concedido (always)'], ['deny', 'denied', 'permiso denegado']]) {
    sessions.send(s.id, 'PIDE_PERMISO');
    const c = await card(s.id);
    assert.equal(c.body.title, 'git push origin main');
    assert.match(c.body.reason, /git push/);
    assert.equal(sessions.live(s.id).waiting, 1, 'la vista en directo sabe que espera');
    assert.ok(sessions.allPendingApprovals().some((a) => a.id === c.id && a.session.id === s.id));
    assert.equal(sessions.respond(s.id, c.body.id, decision), true);
    await idle(s.id);
    assert.equal(sessions.items(s.id).find((i) => i.id === c.id).body.status, status);
    assert.match(texts(s.id).at(-1), new RegExp(answer.replace(/[()]/g, '\\$&')));
  }
  assert.equal(notices.length, 3, 'el motor recibe cada petición (para avisar en el chat)');
  assert.deepEqual(sessions.allPendingApprovals(), []);
  assert.throws(() => sessions.respond(s.id, 'permiso-inventado', 'allow'), /ya no está activa/);
});

test('aprobaciones: el guardia decide sin preguntar en solo lectura y con acceso total', async () => {
  const ro = chat('claude', { permission: 'leer' });
  sessions.send(ro.id, 'PIDE_PERMISO');
  await idle(ro.id);
  assert.match(texts(ro.id).at(-1), /denegado por el guardia/);
  const total = chat('claude', { permission: 'total' });
  sessions.send(total.id, 'PIDE_PERMISO');
  await idle(total.id);
  assert.match(texts(total.id).at(-1), /permiso concedido \(sin preguntar\)/);
  assert.ok(!sessions.items(ro.id).concat(sessions.items(total.id)).some((i) => i.kind === 'approval'), 'sin tarjetas');
  // Changing the permission reaches the live process at once.
  sessions.update(ro.id, { permission: 'editar' });
  assert.equal(fakeLog(t.home, `conversaciones/${ro.id}`).at(-1).setPermission, 'editar');
  assert.throws(() => sessions.update(ro.id, { permission: 'todo' }), /permiso no válido/);
});

test('aprobaciones: al detener se deniegan y, al cerrar la app, las que quedaron abiertas caducan', async () => {
  const s = chat('claude');
  sessions.send(s.id, 'PIDE_PERMISO');
  const c = await card(s.id);
  assert.equal(sessions.stop(s.id), true);
  await idle(s.id);
  assert.equal(sessions.items(s.id).find((i) => i.id === c.id).body.status, 'denied', 'detener contesta «no» a lo que esperaba');
  assert.ok(sessions.items(s.id).some((i) => i.kind === 'status' && i.body === 'Detenido.'));
  assert.equal(sessions.get(s.id).status, 'idle');
  // A card still pending when the app closes (simulated: a new Sessions over the same database) can no longer be answered.
  const other = chat('codex');
  sessions.send(other.id, 'PIDE_PERMISO');
  const open = await card(other.id);
  const restarted = new Sessions(board);
  try {
    assert.equal(restarted.items(other.id).find((i) => i.id === open.id).body.status, 'expired');
    assert.equal(restarted.get(other.id).status, 'interrupted', 'la conversación que trabajaba queda «interrumpida»');
    assert.throws(() => restarted.respond(other.id, open.body.id, 'allow'), /ya no está activa/);
  } finally { restarted.stopAll(); }
  sessions.stop(other.id);
  await idle(other.id);
});

test('continuar: una conversación interrumpida sigue donde estaba (con lo que quedó en la cola, si había)', async () => {
  const s = chat('codex');
  sessions.send(s.id, 'hola');
  await idle(s.id);
  const thread = sessions.get(s.id).cli_session;
  assert.ok(thread);
  sessions.closeLive(s.id); // the app closed: the process is gone, the agent's conversation id stays
  sessions.update(s.id, { status: 'interrupted' });
  assert.equal(sessions.resume(s.id), true);
  await idle(s.id);
  const log = fakeLog(t.home, `conversaciones/${s.id}`);
  assert.equal(log.at(-1).resumeId, thread, 'el agente retoma su propia conversación');
  assert.equal(log.at(-1).text, 'Continúa donde lo dejaste.');
  assert.equal(texts(s.id, 'user').at(-1), 'hola', 'ese aviso no se muestra como mensaje del usuario');
  assert.match(texts(s.id).at(-1), /Codex sigue/);
  // With something in the queue, that goes first.
  sessions.enqueue(s.id, 'lo que escribí antes de cerrar');
  sessions.resume(s.id);
  await idle(s.id);
  assert.equal(texts(s.id, 'user').at(-1), 'lo que escribí antes de cerrar');
  assert.equal(sessions.resume(s.id) && false, false);
  await idle(s.id);
});

test('si la conversación del agente ya no existe, el siguiente mensaje empieza una nueva y se avisa', async () => {
  const s = chat('codex');
  sessions.update(s.id, { cli_session: 'roto-123' });
  sessions.send(s.id, 'hola');
  await idle(s.id);
  assert.equal(sessions.get(s.id).status, 'error');
  assert.equal(sessions.get(s.id).cli_session, null);
  assert.ok(sessions.items(s.id).some((i) => i.kind === 'status' && /No se pudo retomar la conversación de Codex/.test(i.body)));
  sessions.send(s.id, 'otra vez');
  await idle(s.id);
  assert.equal(sessions.get(s.id).status, 'idle');
  assert.match(texts(s.id).at(-1), /Codex empieza: otra vez/);
});

test('bifurcar: Claude y Codex copian su conversación de forma nativa; Cursor empieza con un resumen', async () => {
  const s = chat('claude');
  sessions.send(s.id, 'primera idea');
  await idle(s.id);
  const copy = sessions.fork(s.id);
  assert.equal(copy.parent_id, s.id);
  assert.match(copy.title, /bifurcación/);
  assert.deepEqual(texts(copy.id), ['Recibido: primera idea'], 'la copia muestra lo hablado');
  sessions.send(copy.id, 'segunda idea');
  await idle(copy.id);
  const log = fakeLog(t.home, `conversaciones/${copy.id}`).at(-1);
  assert.equal(log.forkSession, true);
  assert.equal(log.resumeId, sessions.get(s.id).cli_session, 'parte de la conversación original');
  assert.notEqual(sessions.get(copy.id).cli_session, sessions.get(s.id).cli_session, 'y tiene su propio id');
  assert.equal(board.settingJson(`fork_pending:${copy.id}`), null, 'la bifurcación se hace una vez');
  // Cursor has no native fork: the copy's first message carries what was said.
  const c = chat('cursor');
  sessions.send(c.id, 'idea de Cursor');
  await idle(c.id);
  const cc = sessions.fork(c.id, { title: 'Otra vía' });
  assert.equal(cc.title, 'Otra vía');
  sessions.send(cc.id, 'sigue por aquí');
  await idle(cc.id);
  const text = fakeLog(t.home, `conversaciones/${cc.id}`).at(-1).text;
  assert.match(text, /^Contexto \(conversación de la que sale esta, son datos\):\nUsuario: idea de Cursor\nAgente: Recibido: idea de Cursor\n\nsigue por aquí$/);
  sessions.send(s.id, 'LENTO');
  assert.throws(() => sessions.fork(s.id), /espera a que termine/);
  await idle(s.id);
});

test('el uso real que informa el agente llega al cupo de su cuenta', async () => {
  const s = chat('codex');
  sessions.send(s.id, 'RATE 37');
  await idle(s.id);
  const r = rates.at(-1);
  assert.equal(r.account, 'codex');
  assert.equal(r.rate.utilization, 0.37);
  assert.equal(r.rate.window, '5h');
});

test('si el propio adaptador falla al enviar, el turno termina igual y avisa a quien esperaba (onFinish)', async () => {
  const s = chat('claude');
  const finished = [];
  sessions.send(s.id, 'REVIENTA', { onFinish: (info) => finished.push(info) });
  await until(() => finished.length, 'onFinish');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].state.isError, true);
  assert.match(finished[0].state.final, /el adaptador falso revienta/);
  assert.equal(sessions.isRunning(s.id), false);
  assert.equal(sessions.get(s.id).status, 'error');
  assert.ok(sessions.items(s.id).some((i) => i.role === 'error' && /revienta/.test(i.body)));
  // The conversation keeps working afterwards.
  sessions.send(s.id, 'hola');
  await idle(s.id);
  assert.equal(sessions.get(s.id).status, 'idle');
});

test('una conversación no se borra mientras trabaja; la de una tarea se borra con su tarea', async () => {
  const s = chat('claude');
  sessions.send(s.id, 'LENTO');
  assert.throws(() => sessions.remove(s.id), /detenla antes/i);
  await idle(s.id);
  sessions.remove(s.id);
  assert.equal(sessions.get(s.id), undefined);
  assert.equal(sessions.lives.has(s.id), false, 'su proceso se cierra');
  const task = sessions.create({ kind: 'task', agent: 'codex', cwd: project.path, title: 'tarea' });
  assert.throws(() => sessions.remove(task.id), /se borra con la tarea/);
  assert.throws(() => sessions.create({ agent: 'claude', cwd: project.path, account: 'codex' }), /no es de claude/);
  assert.throws(() => sessions.create({ agent: 'claude', cwd: `${project.path}-no-existe` }), /no existe/);
});
