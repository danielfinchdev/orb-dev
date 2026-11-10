// 3.6: la lista de chats como una app de mensajería (src/engine/api/inbox.mjs, src/domain/conversations/inbox.mjs): los chats, con sus
// fijados, secciones, silencio y no leídos, y la búsqueda.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { ctx } from '../src/platform/context.mjs';

let t; let board; let api;
const events = [];
const ids = {};
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const item = (list, kind, id) => list.items.find((x) => x.kind === kind && x.id === Number(id));
const conv = (title) => board.createConversation({ title }).id;
const orbSays = (c, text) => board.addChat('orb', text, null, c);
const told = () => events.filter((e) => e.event === 'inbox:changed');

before(async () => {
  t = tempHome();
  board = new Board();
  const emit = (event, payload) => events.push({ event, payload });
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  ctx.config = { ...ctx.config, userName: 'Ana' };
  ids.jefe = conv('Jefe'); ids.agenda = conv('Agenda'); ids.casa = conv('Casa'); ids.secreto = conv('Secreto QZANA');
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('cada chat: título, último mensaje en texto corto (de Orbe o del usuario) y no leídos', async () => {
  board.addChat('usuario', 'hola', null, ids.jefe);
  orbSays(ids.jefe, '**Hola**, Ana: mira [esto](http://x) y `codigo`');
  let list = await call('inbox.list', { zone: 'orb' });
  const it = item(list, 'conversation', ids.jefe);
  assert.equal(it.title, 'Jefe'); assert.deepEqual(it.avatar, { type: 'orbe' });
  assert.equal(it.lastMessage.text, 'Hola, Ana: mira esto y codigo', 'texto corto y sin marcas');
  assert.deepEqual(it.lastMessage.from, { type: 'orbe' });
  assert.equal(it.lastMessage.kind, 'text'); assert.ok(it.lastMessage.at);
  assert.equal(it.unread, 1, 'la respuesta, no lo que escribió Ana');
  assert.equal(it.pinned, false); assert.equal(it.section, null); assert.equal(it.muted, false);
  board.addChat('usuario', 'otra cosa', null, ids.jefe);
  list = await call('inbox.list', { zone: 'orb' });
  assert.deepEqual(item(list, 'conversation', ids.jefe).lastMessage.from, { type: 'user', name: 'Ana' });
  assert.equal(item(list, 'conversation', ids.agenda).lastMessage, null, 'un chat sin mensajes');
  assert.equal(item(list, 'conversation', ids.agenda).unread, 0);
  // 3.8: a bot's or a group's conversation of a 3.7 database is in no list.
  board.run("INSERT INTO conversations (title, titled, created_at, updated_at, bot_id) VALUES ('De un bot', 1, '2026-01-01', '2026-01-01', 1)");
  assert.ok(!(await call('inbox.list', { zone: 'orb' })).items.some((x) => x.title === 'De un bot'));
});

test('no leídos: suben al llegar líneas, markRead los baja (también hasta una línea), y la lista se entera', async () => {
  const before = told().length;
  const l1 = orbSays(ids.agenda, 'uno'); orbSays(ids.agenda, 'dos'); orbSays(ids.agenda, 'tres');
  assert.equal(item(await call('inbox.list', { zone: 'orb' }), 'conversation', ids.agenda).unread, 3);
  const r = await call('inbox.markRead', { kind: 'conversation', id: ids.agenda, upTo: l1.id });
  assert.equal(r.unread, 2);
  assert.equal((await call('inbox.markRead', { kind: 'conversation', id: ids.agenda })).unread, 0);
  assert.ok(told().length > before);
  // markRead nunca vuelve atrás
  assert.equal((await call('inbox.markRead', { kind: 'conversation', id: ids.agenda, upTo: l1.id })).unread, 0);
  // los avisos (notice) no cuentan
  board.addChat('notice', 'pasajero', null, ids.agenda);
  assert.equal(item(await call('inbox.list', { zone: 'orb' }), 'conversation', ids.agenda).unread, 0);
});

test('fijados: arriba y en su orden; secciones; al desfijar vuelve a su sección; borrar una sección no borra chats', async () => {
  const s1 = await call('inbox.sections.create', { zone: 'orb', name: 'Casa y familia' });
  const s2 = await call('inbox.sections.create', { zone: 'orb', name: 'Trabajo' });
  assert.deepEqual((await call('inbox.sections.list', { zone: 'orb' })).map((s) => s.name), ['Casa y familia', 'Trabajo']);
  await call('inbox.sections.move', { kind: 'conversation', id: ids.casa, section: s1.id });
  await call('inbox.sections.move', { kind: 'conversation', id: ids.agenda, section: s2.id });
  await call('inbox.pin', { kind: 'conversation', id: ids.secreto });
  await call('inbox.pin', { kind: 'conversation', id: ids.casa });
  let list = await call('inbox.list', { zone: 'orb' });
  const order = () => list.items.map((x) => x.title);
  assert.deepEqual(order().slice(0, 4), ['Secreto QZANA', 'Casa', 'Agenda', 'Jefe'], 'fijados en su orden, luego secciones, luego el resto');
  assert.equal(item(list, 'conversation', ids.casa).section, s1.id, 'fijado, recuerda su sección');
  assert.deepEqual([item(list, 'conversation', ids.secreto).pinOrder, item(list, 'conversation', ids.casa).pinOrder], [1, 2]);
  await call('inbox.reorderPins', { zone: 'orb', order: [{ kind: 'conversation', id: ids.casa }, 'conversation:' + ids.secreto] });
  list = await call('inbox.list', { zone: 'orb' });
  assert.deepEqual(order().slice(0, 2), ['Casa', 'Secreto QZANA']);
  await call('inbox.unpin', { kind: 'conversation', id: ids.casa });
  list = await call('inbox.list', { zone: 'orb' });
  assert.deepEqual(order().slice(0, 3), ['Secreto QZANA', 'Casa', 'Agenda'], 'desfijado, vuelve a «Casa y familia» (antes que «Trabajo»)');
  assert.equal(item(list, 'conversation', ids.casa).pinned, false); assert.equal(item(list, 'conversation', ids.secreto).pinOrder, 1, 'los fijados se renumeran');
  assert.deepEqual(list.sections.map((s) => [s.name, s.count]), [['Casa y familia', 1], ['Trabajo', 1]]);
  await call('inbox.sections.reorder', { zone: 'orb', order: [s2.id, s1.id] });
  list = await call('inbox.list', { zone: 'orb' });
  assert.deepEqual(order().slice(1, 3), ['Agenda', 'Casa']);
  await call('inbox.sections.rename', { id: s2.id, name: 'Curro' });
  assert.equal((await call('inbox.sections.list', { zone: 'orb' }))[0].name, 'Curro');
  await call('inbox.sections.delete', { id: s2.id });
  list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', ids.agenda).section, null);
  assert.ok(item(list, 'conversation', ids.agenda), 'el chat sigue');
  await call('inbox.unpin', { kind: 'conversation', id: ids.secreto });
});

test('silenciar: se marca, sigue contando no leídos y se puede quitar', async () => {
  await call('inbox.mute', { kind: 'conversation', id: ids.casa });
  orbSays(ids.casa, 'callado');
  let list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', ids.casa).muted, true); assert.ok(item(list, 'conversation', ids.casa).unread >= 1);
  await call('inbox.mute', { kind: 'conversation', id: ids.casa, muted: false });
  list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', ids.casa).muted, false);
});

test('la lista de Orb: conversaciones con Orbe agrupadas por proyecto, con su último progreso', async () => {
  await call('projects.create', { name: 'mi-web' });
  const a = board.createConversation({ title: 'Portada', project: 'mi-web' });
  const b = board.createConversation({ title: 'Suelta' });
  board.addChat('usuario', 'haz la portada', null, a.id);
  board.addChat('orb', 'He creado la **portada**', null, a.id);
  board.addChat('orb', 'hola', null, b.id);
  const list = await call('inbox.list', { zone: 'orb' });
  const pa = item(list, 'conversation', a.id);
  assert.equal(pa.project, 'mi-web'); assert.deepEqual(pa.avatar, { type: 'project', project: 'mi-web' });
  assert.deepEqual(pa.lastMessage.from, { type: 'orbe' }); assert.equal(pa.lastMessage.text, 'He creado la portada'); assert.equal(pa.unread, 1);
  assert.deepEqual(item(list, 'conversation', b.id).avatar, { type: 'orbe' });
  const web = list.projects.find((p) => p.project === 'mi-web');
  assert.ok(web.items.includes(`conversation:${a.id}`)); assert.equal(web.unread, 1);
  assert.ok(list.projects.some((p) => p.project === null && p.items.includes(`conversation:${b.id}`)));
  // fijar y buscar en Orb
  await call('inbox.pin', { kind: 'conversation', id: b.id });
  assert.equal((await call('inbox.list', { zone: 'orb' })).items[0].id, b.id);
  const s = await call('inbox.search', { q: 'pórtada', zone: 'orb' });
  assert.deepEqual(s.items.map((x) => x.id), [a.id], 'sin tildes ni mayúsculas, en el título');
  assert.ok(s.messages.some((m) => m.id === a.id && /portada/.test(m.line.text)));
  assert.equal(s.messages[0].line.text.includes('**'), false);
});

test('3.6: una conversación directa con un agente se fija y se silencia como las demás', async () => {
  const s = await call('sessions.create', { agent: 'claude', permission: 'leer', title: 'Directo' });
  await call('inbox.pin', { kind: 'session', id: s.id });
  await call('inbox.mute', { kind: 'session', id: s.id, muted: true });
  const row = (await call('inbox.list', { zone: 'orb' })).items.find((x) => x.kind === 'session' && String(x.id) === String(s.id));
  assert.ok(row?.pinned, 'fijada'); assert.equal(row.muted, true, 'silenciada');
  await call('inbox.unpin', { kind: 'session', id: s.id });
  assert.equal((await call('inbox.list', { zone: 'orb' })).items.find((x) => x.kind === 'session' && String(x.id) === String(s.id))?.pinned, false);
});

test('3.8.2: snooze hides a chat until its time, keeps its other marks and the scheduler brings it back', async () => {
  const c = conv('Snoozed chat');
  orbSays(c, 'something new');
  await call('inbox.pin', { kind: 'conversation', id: c });
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const m = await call('inbox.snooze', { kind: 'conversation', id: c, until: soon });
  assert.equal(m.snoozedUntil, soon); assert.equal(m.pinned, true, 'still pinned');
  let list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', c).snoozedUntil, soon);
  assert.equal(list.unread, list.items.filter((x) => !x.muted && !x.snoozedUntil).reduce((n, x) => n + x.unread, 0), 'a snoozed chat does not count as unread');
  await assert.rejects(call('inbox.snooze', { kind: 'conversation', id: c, until: '2000-01-01T00:00:00Z' }), 'not in the past');
  await assert.rejects(call('inbox.snooze', { kind: 'conversation', id: c, until: 'mañana' }), 'not a time');
  // The scheduler's tick wakes it once the time has passed.
  board.run("UPDATE inbox_items SET snoozed_until = '2000-01-01T00:00:00.000Z' WHERE kind = 'conversation' AND item_id = ?", String(c));
  const woke = [];
  new Scheduler(board, null, { emit: (e) => woke.push(e) }).wakeChats();
  assert.deepEqual(woke, ['inbox:changed']);
  list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', c).snoozedUntil, null); assert.equal(item(list, 'conversation', c).pinned, true);
  // Back now by hand.
  await call('inbox.snooze', { kind: 'conversation', id: c, until: soon });
  assert.equal((await call('inbox.snooze', { kind: 'conversation', id: c, until: null })).snoozedUntil, null);
});
