// Orb 3.0: «Nuevo chat» starts a clean conversation with the assistant (also after 2.7 turned «Nueva conversación» into a
// notice), with no folder or with the project chosen, and the earlier conversations are still there («Ver conversación
// anterior»); Security Review creates a read-only audit task that does not wait for approval.
import { tempHome, until, startEngine } from './helpers.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let t; let engine;
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });

test('3.2: cada «Nuevo chat» es una conversación propia, con título y proyecto, que se puede retomar, completar, buscar y borrar', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'web' });
  await call('projects.setActive', { name: 'web' });
  const a = (await call('chat.send', { text: 'Quiero que me hagas una web de recetas con buscador' })).conversation;
  await until(async () => (await call('chat.list', { conversation: a })).some((m) => m.role === 'orb'), 'respuesta del asistente');
  const b = (await call('chat.send', { text: 'Revisa las dependencias', project: null })).conversation;
  assert.notEqual(a, b, 'sin conversación, el mensaje empieza una nueva');
  await until(async () => (await call('chat.list', { conversation: b })).some((m) => m.role === 'orb'), 'respuesta en la segunda');
  const list = await call('conversations.list');
  const ca = list.find((c) => c.id === a); const cb = list.find((c) => c.id === b);
  assert.equal(ca.title, 'Web de recetas con buscador', 'título corto sacado del primer mensaje');
  assert.equal(ca.project, 'web', 'con la carpeta de trabajo');
  assert.equal(cb.project, null, 'o sin carpeta, si se elige así');
  assert.ok(!(await call('chat.list', { conversation: b })).some((m) => /recetas/.test(m.body)), 'no se mezclan');

  // Taken up again: the message goes to its own conversation.
  await call('chat.send', { text: 'Y que tenga modo oscuro', conversation: a });
  await until(async () => (await call('chat.list', { conversation: a })).filter((m) => m.role === 'orb').length === 2, 'segunda respuesta en la primera');
  assert.equal((await call('chat.list', { conversation: b })).filter((m) => m.role === 'usuario').length, 1);

  // Rename, done by hand (and open again when written to), search and delete.
  await call('conversations.update', { id: a, title: 'Recetas' });
  await call('sidebar.complete', { key: `c${b}` });
  assert.equal((await call('conversations.list')).find((c) => c.id === b).status, 'done');
  await call('chat.send', { text: 'Una cosa más', conversation: b });
  assert.equal((await call('conversations.list')).find((c) => c.id === b).status, 'open', 'escribir en una completada la abre');
  assert.deepEqual((await call('conversations.search', { q: 'modo oscuro' })).conversations, [a], 'busca también en los mensajes');
  await until(async () => !(await call('app.state')).chats.some((x) => x.busy), 'el asistente terminó');
  await call('conversations.remove', { id: b });
  assert.ok(!(await call('conversations.list')).some((c) => c.id === b));
  await assert.rejects(call('chat.list', { conversation: b }), /ya no existe/);
});

test('Security Review: auditoría de solo lectura del proyecto, sin esperar aprobación', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'web' });
  const review = await call('projects.securityReview', { name: 'web' });
  assert.equal(review.readonly, true, 'solo lectura');
  assert.match(review.title, /^Security Review/);
  assert.notEqual(review.status, 'awaiting_approval', 'la lista de comprobación (secretos, credenciales) no pide aprobación');
  // The same words written by the user still go through the keyword net.
  const user = await call('tasks.create', { project: 'web', title: 'Mira las credenciales', description: 'Revisa las credenciales y los secretos', agent: 'claude', readonly: true });
  assert.equal(user.status, 'awaiting_approval', 'lo que escribe el usuario sí pasa por la red de palabras clave');
});
