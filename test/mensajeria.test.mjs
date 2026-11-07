// 3.6: la lista de chats como una app de mensajería (src/engine/api-inbox.mjs, src/core/inbox.mjs). Ana (dueña) y Leo:
// cada uno ve solo sus chats, con sus fijados, secciones, silencio y no leídos, y la búsqueda.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.mjs';
import { createPerson } from '../src/core/persons.mjs';
import { principalOf, AuthzError } from '../src/core/authz.mjs';
import * as I from '../src/core/inbox.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';

let t; let board; let api; let ana; let leo; let asAna; let asLeo;
const events = [];
const ids = {};
const call = (who, method, params = {}) => api.call(method, params, who);
const denied = (p) => assert.rejects(p, (e) => e instanceof AuthzError);
const item = (list, kind, id) => list.items.find((x) => x.kind === kind && x.id === Number(id));
const conv = (title, person) => board.createConversation({ title, person }).id;
const orbSays = (c, text) => board.addChat('orb', text, null, c);
const inboxFor = (person) => events.filter((e) => e.event === 'inbox:changed' && e.payload.person === person);

before(async () => {
  t = tempHome();
  board = new Board();
  const emit = (event, payload) => events.push({ event, payload });
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, 'clave', { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  ana = board.ownerId();
  leo = createPerson(board, { name: 'Leo' }).id;
  asAna = principalOf(board, { desktop: true });
  asLeo = principalOf(board, { desktop: true, person: leo });
  ids.jefe = conv('Jefe', ana); ids.agenda = conv('Agenda', ana); ids.casa = conv('Casa', ana); ids.secreto = conv('Secreto QZANA', ana);
  ids.leo = conv('De Leo', leo);
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('cada chat: título, último mensaje en texto corto (de Orbe o de una persona) y no leídos', async () => {
  board.addChat('usuario', 'hola', null, ids.jefe, { person: ana });
  orbSays(ids.jefe, '**Hola**, Ana: mira [esto](http://x) y `codigo`');
  let list = await call(asAna, 'inbox.list', { zone: 'orb' });
  const it = item(list, 'conversation', ids.jefe);
  assert.equal(it.title, 'Jefe'); assert.deepEqual(it.avatar, { type: 'orbe' });
  assert.equal(it.lastMessage.text, 'Hola, Ana: mira esto y codigo', 'texto corto y sin marcas');
  assert.deepEqual(it.lastMessage.from, { type: 'orbe' });
  assert.equal(it.lastMessage.kind, 'text'); assert.ok(it.lastMessage.at);
  assert.equal(it.unread, 1, 'la respuesta, no lo que escribió Ana');
  assert.equal(it.pinned, false); assert.equal(it.section, null); assert.equal(it.muted, false);
  board.addChat('usuario', 'otra cosa', null, ids.jefe, { person: ana });
  list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.deepEqual(item(list, 'conversation', ids.jefe).lastMessage.from, { type: 'user', person: ana, name: 'Ana' });
  assert.equal(item(list, 'conversation', ids.agenda).lastMessage, null, 'un chat sin mensajes');
  assert.equal(item(list, 'conversation', ids.agenda).unread, 0);
  // 3.8: a bot's or a group's conversation of a 3.7 database is in no list.
  board.run("INSERT INTO conversations (title, titled, created_at, updated_at, person_id, bot_id) VALUES ('De un bot', 1, '2026-01-01', '2026-01-01', ?, 1)", ana);
  assert.ok(!(await call(asAna, 'inbox.list', { zone: 'orb' })).items.some((x) => x.title === 'De un bot'));
});

test('no leídos: suben al llegar líneas, markRead los baja (también hasta una línea), y el aviso va solo a su persona', async () => {
  const before = inboxFor(ana).length; const leoBefore = inboxFor(leo).length;
  const l1 = orbSays(ids.agenda, 'uno'); orbSays(ids.agenda, 'dos'); orbSays(ids.agenda, 'tres');
  assert.equal(item(await call(asAna, 'inbox.list', { zone: 'orb' }), 'conversation', ids.agenda).unread, 3);
  const r = await call(asAna, 'inbox.markRead', { kind: 'conversation', id: ids.agenda, upTo: l1.id });
  assert.equal(r.unread, 2);
  assert.equal((await call(asAna, 'inbox.markRead', { kind: 'conversation', id: ids.agenda })).unread, 0);
  assert.ok(inboxFor(ana).length > before); assert.equal(inboxFor(ana).at(-1).payload.person, ana);
  assert.equal(inboxFor(leo).length, leoBefore, 'a Leo no le llega nada de los chats de Ana');
  // markRead nunca vuelve atrás
  assert.equal((await call(asAna, 'inbox.markRead', { kind: 'conversation', id: ids.agenda, upTo: l1.id })).unread, 0);
  // los avisos (notice) no cuentan
  board.addChat('notice', 'pasajero', null, ids.agenda);
  assert.equal(item(await call(asAna, 'inbox.list', { zone: 'orb' }), 'conversation', ids.agenda).unread, 0);
});

test('fijados: arriba y en su orden; secciones propias; al desfijar vuelve a su sección; borrar una sección no borra chats', async () => {
  const s1 = await call(asAna, 'inbox.sections.create', { zone: 'orb', name: 'Casa y familia' });
  const s2 = await call(asAna, 'inbox.sections.create', { zone: 'orb', name: 'Trabajo' });
  assert.deepEqual((await call(asAna, 'inbox.sections.list', { zone: 'orb' })).map((s) => s.name), ['Casa y familia', 'Trabajo']);
  await call(asAna, 'inbox.sections.move', { kind: 'conversation', id: ids.casa, section: s1.id });
  await call(asAna, 'inbox.sections.move', { kind: 'conversation', id: ids.agenda, section: s2.id });
  await call(asAna, 'inbox.pin', { kind: 'conversation', id: ids.secreto });
  await call(asAna, 'inbox.pin', { kind: 'conversation', id: ids.casa });
  let list = await call(asAna, 'inbox.list', { zone: 'orb' });
  const order = () => list.items.map((x) => x.title);
  assert.deepEqual(order().slice(0, 4), ['Secreto QZANA', 'Casa', 'Agenda', 'Jefe'], 'fijados en su orden, luego secciones, luego el resto');
  assert.equal(item(list, 'conversation', ids.casa).section, s1.id, 'fijado, recuerda su sección');
  assert.deepEqual([item(list, 'conversation', ids.secreto).pinOrder, item(list, 'conversation', ids.casa).pinOrder], [1, 2]);
  await call(asAna, 'inbox.reorderPins', { zone: 'orb', order: [{ kind: 'conversation', id: ids.casa }, 'conversation:' + ids.secreto] });
  list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.deepEqual(order().slice(0, 2), ['Casa', 'Secreto QZANA']);
  await call(asAna, 'inbox.unpin', { kind: 'conversation', id: ids.casa });
  list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.deepEqual(order().slice(0, 3), ['Secreto QZANA', 'Casa', 'Agenda'], 'desfijado, vuelve a «Casa y familia» (antes que «Trabajo»)');
  assert.equal(item(list, 'conversation', ids.casa).pinned, false); assert.equal(item(list, 'conversation', ids.secreto).pinOrder, 1, 'los fijados se renumeran');
  assert.deepEqual(list.sections.map((s) => [s.name, s.count]), [['Casa y familia', 1], ['Trabajo', 1]]);
  await call(asAna, 'inbox.sections.reorder', { zone: 'orb', order: [s2.id, s1.id] });
  list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.deepEqual(order().slice(1, 3), ['Agenda', 'Casa']);
  await call(asAna, 'inbox.sections.rename', { id: s2.id, name: 'Curro' });
  assert.equal((await call(asAna, 'inbox.sections.list', { zone: 'orb' }))[0].name, 'Curro');
  await call(asAna, 'inbox.sections.delete', { id: s2.id });
  list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', ids.agenda).section, null);
  assert.ok(item(list, 'conversation', ids.agenda), 'el chat sigue');
  await call(asAna, 'inbox.unpin', { kind: 'conversation', id: ids.secreto });
  ids.s1 = s1.id;
});

test('silenciar: se marca, sigue contando no leídos y se puede quitar', async () => {
  await call(asAna, 'inbox.mute', { kind: 'conversation', id: ids.casa });
  orbSays(ids.casa, 'callado');
  let list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', ids.casa).muted, true); assert.ok(item(list, 'conversation', ids.casa).unread >= 1);
  await call(asAna, 'inbox.mute', { kind: 'conversation', id: ids.casa, muted: false });
  list = await call(asAna, 'inbox.list', { zone: 'orb' });
  assert.equal(item(list, 'conversation', ids.casa).muted, false);
});

test('Ana y Leo: cada uno solo ve y marca lo suyo (ids ajenos, secciones ajenas, búsqueda, eventos)', async () => {
  const leoList = await call(asLeo, 'inbox.list', { zone: 'orb' });
  assert.deepEqual(leoList.items.map((x) => x.title), ['De Leo']);
  assert.ok(!JSON.stringify(leoList).includes('QZANA'));
  for (const m of ['inbox.pin', 'inbox.unpin', 'inbox.mute', 'inbox.markRead', 'inbox.sections.move']) await denied(call(asLeo, m, { kind: 'conversation', id: ids.secreto, section: null }));
  await denied(call(asLeo, 'inbox.sections.rename', { id: ids.s1, name: 'mío' }));
  await denied(call(asLeo, 'inbox.sections.delete', { id: ids.s1 }));
  await denied(call(asLeo, 'inbox.sections.move', { kind: 'conversation', id: ids.leo, section: ids.s1 }));
  assert.deepEqual(await call(asLeo, 'inbox.sections.list', { zone: 'orb' }), []);
  // la búsqueda de Leo no encuentra nada de Ana
  orbSays(ids.secreto, 'el plan QZANA de Ana');
  const found = await call(asLeo, 'inbox.search', { q: 'qzana', zone: 'orb' });
  assert.deepEqual([found.items, found.messages], [[], []]);
  assert.equal((await call(asAna, 'inbox.search', { q: 'qzana', zone: 'orb' })).messages.length, 1);
  // las marcas de Leo no tocan las de Ana
  await call(asLeo, 'inbox.pin', { kind: 'conversation', id: ids.leo });
  assert.equal(I.mark(board, ana, 'conversation', ids.leo).pinned, false);
  assert.ok(!inboxFor(leo).some((e) => String(e.payload.id) === String(ids.secreto)));
});

test('la lista de Orb: conversaciones con Orbe agrupadas por proyecto, con su último progreso', async () => {
  await call(asAna, 'projects.create', { name: 'mi-web' });
  const a = board.createConversation({ title: 'Portada', project: 'mi-web', person: ana });
  const b = board.createConversation({ title: 'Suelta', person: ana });
  board.addChat('usuario', 'haz la portada', null, a.id, { person: ana });
  board.addChat('orb', 'He creado la **portada**', null, a.id);
  board.addChat('orb', 'hola', null, b.id);
  const list = await call(asAna, 'inbox.list', { zone: 'orb' });
  const pa = item(list, 'conversation', a.id);
  assert.equal(pa.project, 'mi-web'); assert.deepEqual(pa.avatar, { type: 'project', project: 'mi-web' });
  assert.deepEqual(pa.lastMessage.from, { type: 'orbe' }); assert.equal(pa.lastMessage.text, 'He creado la portada'); assert.equal(pa.unread, 1);
  assert.deepEqual(item(list, 'conversation', b.id).avatar, { type: 'orbe' });
  const web = list.projects.find((p) => p.project === 'mi-web');
  assert.ok(web.items.includes(`conversation:${a.id}`)); assert.equal(web.unread, 1);
  assert.ok(list.projects.some((p) => p.project === null && p.items.includes(`conversation:${b.id}`)));
  // fijar y buscar en Orb
  await call(asAna, 'inbox.pin', { kind: 'conversation', id: b.id });
  assert.equal((await call(asAna, 'inbox.list', { zone: 'orb' })).items[0].id, b.id);
  const s = await call(asAna, 'inbox.search', { q: 'pórtada', zone: 'orb' });
  assert.deepEqual(s.items.map((x) => x.id), [a.id], 'sin tildes ni mayúsculas, en el título');
  assert.ok(s.messages.some((m) => m.id === a.id && /portada/.test(m.line.text)));
  assert.equal(s.messages[0].line.text.includes('**'), false);
});

test('3.6: una conversación directa con un agente se fija y se silencia como las demás, y solo para quien la tiene', async () => {
  const s = await call(asAna, 'sessions.create', { agent: 'claude', permission: 'leer', title: 'Directo' });
  await call(asAna, 'inbox.pin', { kind: 'session', id: s.id });
  await call(asAna, 'inbox.mute', { kind: 'session', id: s.id, muted: true });
  const row = (await call(asAna, 'inbox.list', { zone: 'orb' })).items.find((x) => x.kind === 'session' && String(x.id) === String(s.id));
  assert.ok(row?.pinned, 'fijada'); assert.equal(row.muted, true, 'silenciada');
  await denied(call(asLeo, 'inbox.pin', { kind: 'session', id: s.id }));
  await call(asAna, 'inbox.unpin', { kind: 'session', id: s.id });
  assert.equal((await call(asAna, 'inbox.list', { zone: 'orb' })).items.find((x) => x.kind === 'session' && String(x.id) === String(s.id))?.pinned, false);
});
