// Orb 3.0: «Nuevo chat» starts a clean conversation with the assistant (also after 2.7 turned «Nueva conversación» into a
// notice), with no folder or with the project chosen, and the earlier conversations are still there («Ver conversación
// anterior»); Security Review creates a read-only audit task that does not wait for approval.
import { tempHome, until, startEngine } from './helpers.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let t; let engine;
afterEach(async () => { await engine?.stop(); engine = null; t?.cleanup(); });

test('Nuevo chat: conversación limpia sin carpeta, y la anterior sigue disponible', async () => {
  t = tempHome();
  engine = await startEngine(t.home);
  const { call } = engine;
  await call('projects.create', { name: 'web' });
  await call('projects.setActive', { name: 'web' });
  await call('chat.send', { text: 'Primera pregunta' });
  await until(async () => (await call('chat.list')).some((m) => m.role === 'orb'), 'respuesta del asistente');
  const first = await call('chat.list');
  assert.ok(first.some((m) => m.body === 'Primera pregunta'));

  await call('chat.new', { project: null });
  await until(async () => (await call('chat.list')).length === 0, 'la conversación nueva empieza vacía');
  assert.equal((await call('app.state')).activeProject, null, 'sin carpeta seleccionada');
  const older = await call('chat.older', { before: 2 ** 31 });
  assert.ok(older.some((m) => m.body === 'Primera pregunta'), 'la conversación anterior se puede volver a ver');
  assert.equal((await call('chat.older', { before: 2 ** 31, limit: 1 })).length, 1, 'basta con una línea para saber que hay más');

  // An empty conversation is not started again (no extra «Nueva conversación»), and a project can come with it.
  await call('chat.new', { project: 'web' });
  assert.equal((await call('app.state')).activeProject?.name, 'web', 'con el proyecto elegido');
  await call('chat.send', { text: 'Segunda pregunta' });
  await until(async () => (await call('chat.list')).some((m) => m.role === 'orb'), 'segunda respuesta');
  assert.ok(!(await call('chat.list')).some((m) => m.body === 'Primera pregunta'), 'lo de la conversación anterior no se mezcla');
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
