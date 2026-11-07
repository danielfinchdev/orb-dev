// 3.6 (mensajería, paso M4): los avisos del móvil como los de una app de mensajería (src/core/notes.mjs): el dibujo de
// Orbe, el nombre del chat, el texto según la privacidad de cada persona, uno por chat, silenciados sin aviso, y las
// acciones (Responder, Aprobar, Rechazar; con PIN, en la app). Y el service worker que los muestra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNote, collapse, actionRoute, routeOf, chatKey, noteId, lineKind, NOTE_IDS } from '../src/core/notes.mjs';
import { SERVICE_WORKER } from '../src/engine/remote.mjs';

const orbChat = { kind: 'conversation', id: 12, name: 'Arreglar el login' };
const msg = (body, extra = {}) => ({ id: 40, role: 'orb', body, meta: { ...extra } });
const words = { hidden: 'Tienes un mensaje nuevo', reply: 'Responder', allow: 'Aprobar', deny: 'Rechazar' };

test('un mensaje de Orbe: el nombre del chat, su dibujo, el chat exacto y «Responder»', () => {
  const n = buildNote({ chat: orbChat, line: msg('Listo, ya está'), preview: 'chat', assistantName: 'Orbe', words });
  assert.equal(n.title, 'Arreglar el login');
  assert.equal(n.body, 'Listo, ya está');
  assert.equal(n.icon, '/icon.png');
  assert.deepEqual(n.route, { view: 'chat', id: 12 });
  assert.equal(n.key, 'conversation:12'); assert.equal(n.id, noteId('conversation:12'));
  assert.deepEqual(n.actions, [{ id: 'reply', title: 'Responder', input: true }]);
  assert.equal(n.hidden, false);
});

test('privacidad: «nada» ni siquiera dice qué chat; sin elección, «chat»', () => {
  const none = buildNote({ chat: orbChat, line: msg('secreto QZ'), preview: 'none', assistantName: 'Orbe', words });
  assert.equal(none.title, 'Orbe'); assert.equal(none.icon, '/icon.png');
  assert.equal(none.body, 'Tienes un mensaje nuevo'); assert.equal(none.hidden, true);
  assert.ok(!JSON.stringify(none).includes('login') && !JSON.stringify(none).includes('QZ'));
  assert.equal(buildNote({ chat: orbChat, line: msg('x'), preview: 'raro', words }).hidden, false);
  assert.equal(buildNote({ chat: orbChat, line: msg('x'), preview: 'all', words }).hidden, false);
});

test('silenciado: ningún aviso', () => {
  assert.equal(buildNote({ chat: orbChat, line: msg('hola'), muted: true, preview: 'all' }), null);
  assert.equal(buildNote({ chat: orbChat, line: { role: 'system', body: 'x', meta: { kind: 'approval', session: 's', request: 'r', status: 'pending' } }, muted: true, preview: 'all' }), null);
});

test('el permiso de un agente se contesta (sessions.approve); una tarea se aprueba en la app', () => {
  const ap = buildNote({ chat: orbChat, line: { role: 'system', body: 'Quiere ejecutar npm test', meta: { kind: 'task-approval', session: 'abc', request: 'r1', status: 'pending' } }, preview: 'chat', words });
  assert.equal(ap.kind, 'approval');
  assert.deepEqual(actionRoute(ap, 'allow'), { call: ['sessions.approve', { id: 'abc', request: 'r1', decision: 'allow' }] });
  assert.deepEqual(actionRoute(ap, 'deny'), { call: ['sessions.approve', { id: 'abc', request: 'r1', decision: 'deny' }] });
  const task = buildNote({ chat: orbChat, line: { role: 'system', body: '⚠️ «Publicar» necesita tu aprobación', meta: { kind: 'attention', task: 8 } }, preview: 'chat', words });
  assert.equal(task.kind, 'task');
  assert.deepEqual(actionRoute(task, 'allow'), { open: { view: 'chat', id: 12 }, approve: { method: 'tasks.approve', task: 8 } });
  assert.equal(lineKind({ meta: { kind: 'approval', session: 's', request: 'r', status: 'allowed' } }), null);
  // Con el texto oculto no se aprueba a ciegas: abre el chat.
  const blind = buildNote({ chat: orbChat, line: { role: 'system', body: 'x', meta: { kind: 'approval', session: 's', request: 'r', status: 'pending' } }, preview: 'none', words });
  assert.ok(actionRoute(blind, 'allow').open && !actionRoute(blind, 'allow').call);
  // Tocar el aviso: el chat.
  assert.deepEqual(actionRoute(ap, 'tap'), { open: { view: 'chat', id: 12 } });
});

test('bloqueo de la app (PIN): Responder, Aprobar y Rechazar abren la app; nada se hace desde el aviso', () => {
  const m = buildNote({ chat: orbChat, line: msg('hola'), preview: 'all', hasPin: true, words });
  assert.deepEqual(m.actions, [{ id: 'reply', title: 'Responder', open: true }], 'sin caja de texto');
  assert.deepEqual(actionRoute(m, 'reply', { text: 'escrito igual' }), { open: { view: 'chat', id: 12 } });
  const ap = buildNote({ chat: orbChat, line: { role: 'system', body: 'x', meta: { kind: 'approval', session: 's', request: 'r', status: 'pending' } }, preview: 'all', hasPin: true, words });
  for (const a of ['allow', 'deny']) assert.ok(!actionRoute(ap, a).call, a);
});

test('Responder: al chat de Orbe; sin texto, abre el chat', () => {
  const r = (chat, text) => actionRoute(buildNote({ chat, line: msg('x'), preview: 'all' }), 'reply', { text });
  assert.deepEqual(r(orbChat, ' sigue '), { call: ['chat.send', { text: 'sigue', conversation: 12 }] });
  assert.deepEqual(r({ kind: 'orb', id: null, name: 'Orbe' }, 'hola'), { call: ['chat.send', { text: 'hola' }] });
  assert.deepEqual(r(orbChat, '   '), { open: { view: 'chat', id: 12 } });
});

test('uno por chat: las líneas nuevas se juntan (las últimas cinco) y se cuentan', () => {
  let c = null;
  for (let i = 1; i <= 7; i++) c = collapse(c, buildNote({ chat: orbChat, line: msg(`m${i}`), preview: 'all' }));
  assert.equal(c.count, 7); assert.deepEqual(c.lines, ['m3', 'm4', 'm5', 'm6', 'm7']); assert.equal(c.body, 'm3\nm4\nm5\nm6\nm7');
  const h = collapse({ lines: ['a'], count: 1 }, buildNote({ chat: orbChat, line: msg('b'), preview: 'none', words }));
  assert.equal(h.body, 'Tienes un mensaje nuevo', 'oculto sigue oculto');
  assert.equal(chatKey(orbChat), 'conversation:12'); assert.deepEqual(routeOf({ kind: 'orb' }), { view: 'chat' });
  for (const k of ['conversation:4', 'orb']) {
    const id = noteId(k);
    assert.ok(id >= NOTE_IDS.first && id < NOTE_IDS.first + NOTE_IDS.size);
  }
});

test('el service worker se puede leer y junta los avisos por chat', () => {
  assert.doesNotThrow(() => new Function(SERVICE_WORKER));
  assert.match(SERVICE_WORKER, /getNotifications\(\{tag\}\)/);
  assert.match(SERVICE_WORKER, /\/api\/note-action/);
  assert.match(SERVICE_WORKER, /orbOpen/);
});
