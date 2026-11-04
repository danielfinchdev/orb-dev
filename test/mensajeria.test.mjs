// 3.6: las listas de chats como una app de mensajería (src/engine/api-inbox.mjs, src/core/inbox.mjs). Ana (dueña) y Leo:
// cada uno ve solo sus chats (y los compartidos), con sus fijados, secciones, silencio y no leídos; los grupos como
// WhatsApp (bots y personas, @Nombre para hablar a uno, sin @ contesta primero el jefe) y la búsqueda.
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.mjs';
import { createPerson } from '../src/core/persons.mjs';
import { principalOf, AuthzError } from '../src/core/authz.mjs';
import { lendAccount } from '../src/core/budget.mjs';
import * as B from '../src/core/bots.mjs';
import * as I from '../src/core/inbox.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { Bots } from '../src/engine/bots.mjs';
import { buildApi } from '../src/engine/api.mjs';

let t; let board; let bots; let api; let ana; let leo; let asAna; let asLeo;
const events = []; const pushes = [];
const ids = {};
const call = (who, method, params = {}) => api.call(method, params, who);
const denied = (p) => assert.rejects(p, (e) => e instanceof AuthzError);
const item = (list, kind, id) => list.items.find((x) => x.kind === kind && x.id === Number(id));
const botSays = (bot, text, conv, extra = {}) => bots.say('bot', text, { bot: bot.id, name: bot.name, ...extra }, conv);
const inboxFor = (person) => events.filter((e) => e.event === 'inbox:changed' && e.payload.person === person);

before(async () => {
  t = tempHome();
  board = new Board();
  const emit = (event, payload) => events.push({ event, payload });
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, 'clave', { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  bots = new Bots(board, { emit, log: () => {}, push: (n) => pushes.push(n) }).start();
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null }, bots });
  ana = board.ownerId();
  leo = createPerson(board, { name: 'Leo' }).id;
  asAna = principalOf(board, { desktop: true });
  asLeo = principalOf(board, { desktop: true, person: leo });
  lendAccount(board, { account: 'claude', lender: ana, person: leo, bots: true, dev: false });
  ids.jefe = (await call(asAna, 'bots.create', { name: 'Jefe', role_text: 'Reparte', is_chief: true })).id;
  ids.agenda = (await call(asAna, 'bots.create', { name: 'Agenda', role_text: 'Citas' })).id;
  ids.casa = (await call(asAna, 'bots.create', { name: 'Casa', role_text: 'La casa' })).id;
  ids.secreto = (await call(asAna, 'bots.create', { name: 'Secreto', role_text: 'QZANA papel' })).id;
  ids.leoBot = (await call(asLeo, 'bots.create', { name: 'Leobot', role_text: 'De Leo' })).id;
});
after(() => { bots.shutdown(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('la lista de Bots: sus bots y grupos, con avatar, estado y último mensaje (de bot, de persona, entre bots)', async () => {
  const jefe = B.getBot(board, ids.jefe); const agenda = B.getBot(board, ids.agenda);
  const conv = B.botConversation(board, jefe, { person: ana });
  board.addChat('usuario', 'hola jefe', null, conv, { person: ana });
  botSays(jefe, '**Hola**, Ana: mira [esto](http://x) y `codigo`', conv);
  let list = await call(asAna, 'inbox.list', { zone: 'bots' });
  const it = item(list, 'bot', ids.jefe);
  assert.equal(it.title, 'Jefe'); assert.deepEqual(it.avatar, { type: 'bot', id: ids.jefe, icon: null, name: 'Jefe' });
  assert.equal(it.lastMessage.text, 'Hola, Ana: mira esto y codigo', 'texto corto y sin marcas');
  assert.deepEqual(it.lastMessage.from, { type: 'bot', bot: ids.jefe, name: 'Jefe' });
  assert.equal(it.lastMessage.kind, 'text'); assert.ok(it.lastMessage.at);
  assert.equal(it.unread, 1, 'la respuesta del bot, no lo que escribió Ana');
  assert.equal(it.state, 'idle'); assert.equal(it.pinned, false); assert.equal(it.section, null); assert.equal(it.muted, false);
  // entre bots
  botSays(agenda, 'Te paso la cita', conv, { kind: 'relay', to: ids.jefe });
  list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.deepEqual(item(list, 'bot', ids.jefe).lastMessage.from, { type: 'bot-to-bot', bot: ids.agenda, name: 'Agenda', to: ids.jefe, toName: 'Jefe' });
  // de una persona
  board.addChat('usuario', 'otra cosa', null, conv, { person: ana });
  list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.deepEqual(item(list, 'bot', ids.jefe).lastMessage.from, { type: 'user', person: ana, name: 'Ana' });
  assert.equal(item(list, 'bot', ids.jefe).unread, 0, 'escribir marca leído lo de antes');
  // en pausa
  await call(asAna, 'bots.pause', { id: ids.casa });
  assert.equal(item(await call(asAna, 'inbox.list', { zone: 'bots' }), 'bot', ids.casa).state, 'paused');
  await call(asAna, 'bots.pause', { id: ids.casa, paused: false });
  // un chat sin mensajes
  assert.equal(item(list, 'bot', ids.agenda).lastMessage, null);
  assert.equal(item(list, 'bot', ids.agenda).unread, 0);
});

test('no leídos: suben al llegar líneas, markRead los baja (también hasta una línea), y el aviso va solo a su persona', async () => {
  const agenda = B.getBot(board, ids.agenda);
  const conv = B.botConversation(board, agenda, { person: ana });
  const before = inboxFor(ana).length; const leoBefore = inboxFor(leo).length;
  const l1 = botSays(agenda, 'uno', conv); botSays(agenda, 'dos', conv); botSays(agenda, 'tres', conv);
  assert.equal(inboxFor(ana).length - before, 3, 'inbox:changed por línea');
  assert.equal(inboxFor(leo).length, leoBefore, 'a Leo no le llega nada de los chats de Ana');
  const ev = inboxFor(ana).at(-1).payload;
  assert.deepEqual(ev, { person: ana, kind: 'bot', id: ids.agenda, conversation: conv }, 'solo ids');
  assert.equal(item(await call(asAna, 'inbox.list', { zone: 'bots' }), 'bot', ids.agenda).unread, 3);
  const r = await call(asAna, 'inbox.markRead', { kind: 'bot', id: ids.agenda, upTo: l1.id });
  assert.equal(r.unread, 2);
  assert.equal((await call(asAna, 'inbox.markRead', { kind: 'bot', id: ids.agenda })).unread, 0);
  const list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.equal(item(list, 'bot', ids.agenda).unread, 0);
  // markRead nunca vuelve atrás
  assert.equal((await call(asAna, 'inbox.markRead', { kind: 'bot', id: ids.agenda, upTo: l1.id })).unread, 0);
  // los avisos (notice) no cuentan
  board.addChat('notice', 'pasajero', null, conv);
  assert.equal(item(await call(asAna, 'inbox.list', { zone: 'bots' }), 'bot', ids.agenda).unread, 0);
});

test('fijados: arriba y en su orden; secciones propias; al desfijar vuelve a su sección; borrar una sección no borra chats', async () => {
  const s1 = await call(asAna, 'inbox.sections.create', { zone: 'bots', name: 'Casa y familia' });
  const s2 = await call(asAna, 'inbox.sections.create', { zone: 'bots', name: 'Trabajo' });
  assert.deepEqual((await call(asAna, 'inbox.sections.list', { zone: 'bots' })).map((s) => s.name), ['Casa y familia', 'Trabajo']);
  assert.deepEqual(await call(asAna, 'inbox.sections.list', { zone: 'orb' }), [], 'cada zona las suyas');
  await call(asAna, 'inbox.sections.move', { kind: 'bot', id: ids.casa, section: s1.id });
  await call(asAna, 'inbox.sections.move', { kind: 'bot', id: ids.agenda, section: s2.id });
  await call(asAna, 'inbox.pin', { kind: 'bot', id: ids.secreto });
  await call(asAna, 'inbox.pin', { kind: 'bot', id: ids.casa });
  let list = await call(asAna, 'inbox.list', { zone: 'bots' });
  const order = () => list.items.map((x) => x.title);
  assert.deepEqual(order().slice(0, 4), ['Secreto', 'Casa', 'Agenda', 'Jefe'], 'fijados en su orden, luego secciones, luego el resto');
  assert.equal(item(list, 'bot', ids.casa).section, s1.id, 'fijado, recuerda su sección');
  assert.deepEqual([item(list, 'bot', ids.secreto).pinOrder, item(list, 'bot', ids.casa).pinOrder], [1, 2]);
  await call(asAna, 'inbox.reorderPins', { zone: 'bots', order: [{ kind: 'bot', id: ids.casa }, 'bot:' + ids.secreto] });
  list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.deepEqual(order().slice(0, 2), ['Casa', 'Secreto']);
  await call(asAna, 'inbox.unpin', { kind: 'bot', id: ids.casa });
  list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.deepEqual(order().slice(0, 3), ['Secreto', 'Casa', 'Agenda'], 'desfijado, vuelve a «Casa y familia» (antes que «Trabajo»)');
  assert.equal(item(list, 'bot', ids.casa).pinned, false); assert.equal(item(list, 'bot', ids.secreto).pinOrder, 1, 'los fijados se renumeran');
  assert.deepEqual(list.sections.map((s) => [s.name, s.count]), [['Casa y familia', 1], ['Trabajo', 1]]);
  await call(asAna, 'inbox.sections.reorder', { zone: 'bots', order: [s2.id, s1.id] });
  list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.deepEqual(order().slice(1, 3), ['Agenda', 'Casa']);
  await call(asAna, 'inbox.sections.rename', { id: s2.id, name: 'Curro' });
  assert.equal((await call(asAna, 'inbox.sections.list', { zone: 'bots' }))[0].name, 'Curro');
  await call(asAna, 'inbox.sections.delete', { id: s2.id });
  list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.equal(item(list, 'bot', ids.agenda).section, null);
  assert.ok(item(list, 'bot', ids.agenda), 'el chat sigue');
  // un chat de Orb no va a una sección de Bots
  const c = board.createConversation({ title: 'Una charla', person: ana });
  await assert.rejects(call(asAna, 'inbox.sections.move', { kind: 'conversation', id: c.id, section: s1.id }), /no es válid|inválid|kind/i);
  await call(asAna, 'inbox.unpin', { kind: 'bot', id: ids.secreto });
  ids.s1 = s1.id;
});

test('silenciar: sigue contando no leídos pero no avisa al móvil de las respuestas', async () => {
  const casa = B.getBot(board, ids.casa);
  const conv = B.botConversation(board, casa, { person: ana });
  await call(asAna, 'inbox.mute', { kind: 'bot', id: ids.casa });
  const n = pushes.length;
  botSays(casa, 'callado', conv);
  assert.equal(pushes.length, n, 'silenciado: sin aviso');
  const list = await call(asAna, 'inbox.list', { zone: 'bots' });
  assert.equal(item(list, 'bot', ids.casa).muted, true); assert.ok(item(list, 'bot', ids.casa).unread >= 1);
  await call(asAna, 'inbox.mute', { kind: 'bot', id: ids.casa, muted: false });
  botSays(casa, 'ya habla', conv);
  assert.equal(pushes.length, n + 1);
});

test('Ana y Leo: cada uno solo ve y marca lo suyo (ids ajenos, secciones ajenas, búsqueda, eventos)', async () => {
  const leoList = await call(asLeo, 'inbox.list', { zone: 'bots' });
  assert.deepEqual(leoList.items.map((x) => x.title), ['Leobot']);
  assert.ok(!JSON.stringify(leoList).includes('QZANA'));
  for (const m of ['inbox.pin', 'inbox.unpin', 'inbox.mute', 'inbox.markRead', 'inbox.sections.move']) await denied(call(asLeo, m, { kind: 'bot', id: ids.secreto, section: null }));
  await denied(call(asLeo, 'inbox.sections.rename', { id: ids.s1, name: 'mío' }));
  await denied(call(asLeo, 'inbox.sections.delete', { id: ids.s1 }));
  await denied(call(asLeo, 'inbox.sections.move', { kind: 'bot', id: ids.leoBot, section: ids.s1 }));
  assert.deepEqual(await call(asLeo, 'inbox.sections.list', { zone: 'bots' }), []);
  // la búsqueda de Leo no encuentra nada de Ana
  const conv = B.botConversation(board, B.getBot(board, ids.secreto), { person: ana });
  botSays(B.getBot(board, ids.secreto), 'el plan QZANA de Ana', conv);
  const found = await call(asLeo, 'inbox.search', { q: 'qzana', zone: 'bots' });
  assert.deepEqual([found.items, found.messages], [[], []]);
  assert.equal((await call(asAna, 'inbox.search', { q: 'qzana', zone: 'bots' })).messages.length, 1);
  // las marcas de Leo no tocan las de Ana
  await call(asLeo, 'inbox.pin', { kind: 'bot', id: ids.leoBot });
  assert.equal(I.mark(board, ana, 'bot', ids.leoBot).pinned, false);
  // un bot compartido: en la lista de Leo, con quién lo comparte, sin las líneas de Ana con él
  await call(asAna, 'shares.set', { type: 'bot', id: String(ids.casa), person: leo, right: 'talk' });
  const shared = item(await call(asLeo, 'inbox.list', { zone: 'bots' }), 'bot', ids.casa);
  assert.deepEqual(shared.sharedBy, { person: ana, name: 'Ana' });
  assert.equal(shared.lastMessage, null, 'la conversación de Ana con Casa es suya'); assert.equal(shared.muted, false, 'el silencio de Ana es suyo');
  await call(asLeo, 'inbox.pin', { kind: 'bot', id: ids.casa });
  assert.equal(I.mark(board, ana, 'bot', ids.casa).pinned, false);
  // Orb: las conversaciones de Ana no salen a Leo
  const anaConv = board.createConversation({ title: 'QZANA charla', person: ana });
  board.addChat('orb', 'respuesta QZANA', null, anaConv.id);
  await denied(call(asLeo, 'inbox.markRead', { kind: 'conversation', id: anaConv.id }));
  const orb = await call(asLeo, 'inbox.list', { zone: 'orb' });
  assert.ok(!JSON.stringify(orb).includes('QZANA'));
  assert.deepEqual((await call(asLeo, 'inbox.search', { q: 'QZANA', zone: 'orb' })).messages, []);
  assert.ok(!inboxFor(leo).some((e) => e.payload.conversation === anaConv.id || e.payload.conversation === conv));
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

test('@menciones: sin mayúsculas ni tildes, varias, nombre entero, el más largo gana', () => {
  const m = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Anabel' }, { id: 3, name: 'Bot dos' }, { id: 4, name: 'Cocina' }];
  const ids = (s) => B.mentionedMembers(s, m).map((b) => b.id);
  assert.deepEqual(ids('hola a todos'), []);
  assert.deepEqual(ids('@anabel mira'), [2]);
  assert.deepEqual(ids('@ANA y @cocína'), [1, 4]);
  assert.deepEqual(ids('@cocina, luego @Bot dos y otra vez @cocina'), [4, 3]);
  assert.deepEqual(ids('correo x@cocina.es'), [], 'dentro de una palabra no');
  assert.deepEqual(ids('@anax'), [], 'el nombre entero');
});

test('grupos como WhatsApp: sin @ contesta primero el jefe; con @ solo los nombrados, en su orden', async () => {
  const g = await call(asAna, 'bots.groups.create', { name: 'Familia', members: [ids.agenda, ids.jefe, ids.casa] });
  ids.group = g.id;
  const plain = bots.sendGroup(g.id, '¿Qué hay mañana?', { person: ana });
  assert.deepEqual(plain.members, [ids.jefe, ids.agenda, ids.casa], 'el jefe primero'); assert.deepEqual(plain.mentioned, []);
  const r1 = await plain.done;
  assert.equal(r1[0].name, 'Jefe');
  const botCount = () => board.chat(plain.conversation, 500).filter((l) => l.role === 'bot').length;
  const was = botCount();
  const sent = await call(asAna, 'bots.groups.send', { id: g.id, text: '@casa enciende y @AGENDA apunta' });
  assert.deepEqual(sent.mentioned, [ids.casa, ids.agenda]); assert.deepEqual(sent.members, [ids.casa, ids.agenda]);
  const conv = sent.conversation;
  await until(() => botCount() >= was + 2 && !bots.states(ana).length, 'respuestas de los nombrados');
  const after = board.chat(conv, 200).filter((l) => l.role === 'bot').slice(-2).map((l) => l.meta.name);
  assert.deepEqual(after, ['Casa', 'Agenda']);
  // en la lista: el avatar del grupo son sus miembros, y el último mensaje dice qué bot habló
  const it = item(await call(asAna, 'inbox.list', { zone: 'bots' }), 'group', g.id);
  assert.deepEqual(it.avatar.members.map((b) => b.name), ['Jefe', 'Agenda', 'Casa']);
  assert.equal(it.lastMessage.from.type, 'bot'); assert.equal(it.lastMessage.from.name, 'Agenda');
});

test('grupos: con personas a las que se comparte; añadir y quitar bots y personas; salir del grupo', async () => {
  const g = await call(asAna, 'bots.groups.create', { name: 'Con Leo', members: [ids.jefe], people: [leo] });
  assert.equal(board.one("SELECT right FROM shares WHERE resource_type = 'group' AND resource_id = ? AND person_id = ?", String(g.id), leo).right, 'talk');
  let info = await call(asLeo, 'bots.groups.get', { id: g.id });
  assert.deepEqual(info.people.map((p) => p.name), ['Leo']); assert.deepEqual(info.owner, { person: ana, name: 'Ana' });
  const leoItem = item(await call(asLeo, 'inbox.list', { zone: 'bots' }), 'group', g.id);
  assert.ok(leoItem); assert.deepEqual(leoItem.sharedBy, { person: ana, name: 'Ana' });
  // una línea del grupo avisa a los dos, cada uno con sus no leídos
  const conv = B.groupConversation(board, g.id);
  const before = inboxFor(leo).length;
  board.addChat('usuario', 'hola grupo', null, conv, { person: ana });
  assert.equal(inboxFor(leo).length, before + 1);
  assert.equal(item(await call(asLeo, 'inbox.list', { zone: 'bots' }), 'group', g.id).unread, 1);
  assert.equal(item(await call(asAna, 'inbox.list', { zone: 'bots' }), 'group', g.id).unread, 0, 'lo suyo no');
  // Leo (solo hablar) no cambia los miembros; Ana sí
  await denied(call(asLeo, 'bots.groups.members.add', { id: g.id, bot: ids.agenda }));
  await denied(call(asLeo, 'bots.groups.members.remove', { id: g.id, bot: ids.jefe }));
  info = await call(asAna, 'bots.groups.members.add', { id: g.id, bot: ids.agenda });
  assert.deepEqual(info.members.map((b) => b.name), ['Jefe', 'Agenda']);
  await assert.rejects(call(asAna, 'bots.groups.members.add', { id: g.id, bot: ids.leoBot }), /No hay ningún bot/, 'un bot de Leo no entra en un grupo de Ana');
  info = await call(asAna, 'bots.groups.members.remove', { id: g.id, bot: ids.agenda });
  assert.deepEqual(info.members.map((b) => b.name), ['Jefe']);
  // Leo sale del grupo; Ana lo vuelve a añadir y lo quita
  assert.deepEqual(await call(asLeo, 'bots.groups.members.remove', { id: g.id, person: leo }), { ok: true });
  assert.equal(item(await call(asLeo, 'inbox.list', { zone: 'bots' }), 'group', g.id), undefined);
  await call(asAna, 'bots.groups.members.add', { id: g.id, person: leo });
  assert.ok(item(await call(asLeo, 'inbox.list', { zone: 'bots' }), 'group', g.id));
  info = await call(asAna, 'bots.groups.members.remove', { id: g.id, person: leo });
  assert.deepEqual(info.people, []);
  // Leo no crea un grupo con los bots de Ana ni comparte uno de ella
  await assert.rejects(call(asLeo, 'bots.groups.create', { name: 'Mío', members: [ids.jefe] }), /No hay ningún bot/);
  await denied(call(asLeo, 'bots.groups.members.add', { id: ids.group, person: leo }));
});

test('M2: «Eliminar chat» vacía sus mensajes (no la tarjeta pendiente); el chat de un grupo solo lo vacía quien lo creó', async () => {
  const agenda = B.getBot(board, ids.agenda);
  const conv = B.botConversation(board, agenda, { person: ana });
  board.addChat('usuario', 'borrame', null, conv, { person: ana });
  botSays(agenda, 'vale', conv);
  botSays(agenda, 'tarjeta', conv, { kind: 'bot_card', status: 'pending' });
  await call(asAna, 'inbox.clear', { kind: 'bot', id: ids.agenda });
  const left = board.all('SELECT body FROM chat WHERE conversation_id = ?', conv).map((r) => r.body);
  assert.deepEqual(left, ['tarjeta'], 'solo queda la tarjeta que espera respuesta');
  assert.ok(B.getBot(board, ids.agenda), 'el bot sigue');
  await denied(call(asLeo, 'inbox.clear', { kind: 'bot', id: ids.agenda }));
  const g = await call(asAna, 'bots.groups.create', { name: 'Vaciar', members: [ids.jefe], people: [leo] });
  const gconv = B.groupConversation(board, g.id);
  board.addChat('usuario', 'en el grupo', null, gconv, { person: ana });
  await denied(call(asLeo, 'inbox.clear', { kind: 'group', id: g.id }));
  assert.equal(board.all('SELECT id FROM chat WHERE conversation_id = ?', gconv).length, 1, 'Leo no vacía el grupo de Ana');
  await call(asAna, 'inbox.clear', { kind: 'group', id: g.id });
  assert.equal(board.all('SELECT id FROM chat WHERE conversation_id = ?', gconv).length, 0);
  await assert.rejects(call(asAna, 'inbox.clear', { kind: 'conversation', id: gconv }));
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

test('3.6: las tarjetas de los bots dicen qué y por qué con palabras normales, sin datos en bruto', () => {
  const jefe = B.getBot(board, ids.jefe);
  const say = (kind, p) => bots.describeCard(kind, p, jefe);
  assert.equal(say('admin', { action: 'pause', id: ids.agenda, fields: { paused: true }, reason: 'de vacaciones' }), 'Jefe quiere pausar a Agenda. Motivo: de vacaciones.');
  assert.equal(say('admin', { action: 'pause', id: ids.agenda, fields: { paused: false } }), 'Jefe quiere reanudar a Agenda.');
  assert.equal(say('admin', { action: 'update', id: ids.agenda, fields: { role_text: 'x', tools: ['internet'] } }), 'Jefe quiere cambiar el papel y las herramientas de Agenda.');
  assert.equal(say('ha', { domain: 'light', service: 'turn_on', body: { entity_id: 'light.salon' } }), 'Jefe quiere encender salon.');
  assert.equal(say('srv', { action: 'docker_restart', target: 'nextcloud', reason: 'no responde' }), 'Jefe quiere reiniciar un contenedor en el servidor: nextcloud. Motivo: no responde.');
  for (const text of [say('admin', { action: 'create', fields: { name: 'Nuevo', role_text: 'Ayuda' } }), say('admin', { action: 'delete', id: ids.casa })]) assert.doesNotMatch(text, /[{}]|true|false|role_text/);
});
