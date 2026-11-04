// 3.6 (mensajería, paso M4): los avisos del móvil como los de una app de mensajería (src/core/notes.mjs): quién escribe
// (avatar del bot, Orbe, el grupo junto), el nombre del chat, el texto según la privacidad de cada persona, uno por chat,
// silenciados sin aviso, y las acciones (Responder, Aprobar, Rechazar; con PIN, en la app). Y los dibujos de los avatares
// (src/engine/avatar-png.mjs) y el service worker que los muestra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildNote, collapse, actionRoute, routeOf, chatKey, noteId, lineKind, NOTE_IDS } from '../src/core/notes.mjs';
import { avatarPng, groupPng, pngForPath, avatarUrl, groupUrl, androidIconName, flattenPath, oklchToRgb } from '../src/engine/avatar-png.mjs';
import { SHAPE_IDS, COLOR_IDS } from '../src/core/avatar.mjs';
import { SERVICE_WORKER } from '../src/engine/remote.mjs';
import { REMINDER_IDS } from '../src/ui/lib/reminder-notes.js';

const bot = { kind: 'bot', id: '7', name: 'Agenda', avatar: { shape: 'gota', color: 'coral' } };
const group = { kind: 'group', id: '3', name: 'Familia', members: [{ shape: 'nube', color: 'cielo' }, { shape: 'flor', color: 'limon' }] };
const orbChat = { kind: 'conversation', id: 12, name: 'Arreglar el login' };
const msg = (body, extra = {}) => ({ id: 40, role: 'bot', body, meta: { bot: 7, name: 'Agenda', ...extra } });
const words = { hidden: 'Tienes un mensaje nuevo', reply: 'Responder', allow: 'Aprobar', deny: 'Rechazar' };

test('un mensaje de un bot: su nombre, su avatar, el chat exacto y «Responder»', () => {
  const n = buildNote({ chat: bot, line: msg('La cita es mañana a las 10'), preview: 'all', words });
  assert.equal(n.title, 'Agenda');
  assert.equal(n.body, 'La cita es mañana a las 10');
  assert.deepEqual(n.icon, { avatar: { shape: 'gota', color: 'coral' } });
  assert.deepEqual(n.route, { view: 'bot-chat', id: '7' });
  assert.equal(n.key, 'bot:7'); assert.equal(n.id, noteId('bot:7'));
  assert.deepEqual(n.actions, [{ id: 'reply', title: 'Responder', input: true }]);
  assert.equal(n.hidden, false);
});

test('privacidad: «chat» oculta el texto de los bots (no el de Orb); «nada» ni siquiera dice quién', () => {
  const hidden = buildNote({ chat: bot, line: msg('secreto QZ'), preview: 'chat', words });
  assert.equal(hidden.title, 'Agenda', 'el nombre del chat sí');
  assert.equal(hidden.body, 'Tienes un mensaje nuevo'); assert.equal(hidden.hidden, true);
  assert.ok(!JSON.stringify(hidden).includes('QZ'));
  const orb = buildNote({ chat: orbChat, line: { role: 'orb', body: 'Listo, ya está' }, preview: 'chat', assistantName: 'Orbe', words });
  assert.equal(orb.title, 'Arreglar el login'); assert.equal(orb.body, 'Listo, ya está');
  assert.equal(orb.icon, '/icon.png', 'la zona Orb lleva el dibujo de Orbe');
  assert.deepEqual(orb.route, { view: 'chat', id: 12 });
  const none = buildNote({ chat: bot, line: msg('secreto QZ'), preview: 'none', assistantName: 'Orbe', words });
  assert.equal(none.title, 'Orbe'); assert.equal(none.icon, '/icon.png');
  assert.ok(!JSON.stringify(none).includes('Agenda') && !JSON.stringify(none).includes('gota'), 'ni el nombre ni el avatar del bot');
  assert.ok(!JSON.stringify(none).includes('QZ'));
  // Lo de antes de 3.6: sin elección, «chat».
  assert.equal(buildNote({ chat: bot, line: msg('x'), preview: 'raro', words }).hidden, true);
});

test('un grupo: el dibujo de sus miembros juntos y cada línea con quién habla', () => {
  const n = buildNote({ chat: group, line: { id: 9, role: 'bot', body: 'Hecho', meta: { bot: 1, name: 'Casa' } }, preview: 'all', words });
  assert.equal(n.title, 'Familia'); assert.equal(n.body, 'Casa: Hecho');
  assert.deepEqual(n.icon, { members: group.members });
  assert.deepEqual(n.route, { view: 'bot-group', id: '3' });
});

test('silenciado: ningún aviso (solo los recordatorios que puso la persona)', () => {
  assert.equal(buildNote({ chat: bot, line: msg('hola'), muted: true, preview: 'all' }), null);
  assert.equal(buildNote({ chat: bot, line: { id: 1, role: 'system', body: 'Necesito permiso', meta: { kind: 'bot_card', card: 'send', status: 'pending' } }, muted: true, preview: 'all' }), null);
  assert.equal(buildNote({ chat: bot, line: msg('⏰ Llama a mamá', { kind: 'reminder' }), muted: true, preview: 'all' }).kind, 'reminder');
  assert.deepEqual(buildNote({ chat: bot, line: msg('⏰ x', { kind: 'reminder' }), preview: 'all' }).actions, [], 'un recordatorio no se responde');
  assert.equal(buildNote({ chat: bot, line: { id: 2, role: 'system', body: 'x', meta: { kind: 'bot_card', status: 'done' } }, preview: 'all' }), null, 'una tarjeta ya contestada no avisa');
});

test('una tarjeta: Aprobar y Rechazar desde el aviso; sensible con PIN, «Aprobar» abre la app para el PIN', () => {
  const card = { id: 55, role: 'system', body: 'Agenda quiere enviar un correo', meta: { kind: 'bot_card', card: 'send', bot: 7, status: 'pending' } };
  const n = buildNote({ chat: bot, line: card, preview: 'all', words });
  assert.equal(n.kind, 'card');
  assert.deepEqual(n.actions.map((a) => [a.id, Boolean(a.open)]), [['deny', false], ['allow', false]]);
  assert.deepEqual(actionRoute(n, 'allow'), { call: ['bots.decide', { item: 55, decision: 'allow' }] });
  assert.deepEqual(actionRoute(n, 'deny'), { call: ['bots.decide', { item: 55, decision: 'deny' }] });
  // Sensible: Aprobar y Rechazar abren la app (con PIN, allí se pide).
  const s = buildNote({ chat: bot, line: { ...card, meta: { ...card.meta, card: 'confirm' } }, preview: 'all', sensitive: true, hasPin: true, words });
  assert.equal(s.pin, true);
  assert.deepEqual(actionRoute(s, 'allow'), { open: { view: 'bot-chat', id: '7' }, approve: { method: 'bots.decide', item: 55 } });
  assert.deepEqual(actionRoute(s, 'deny'), { open: { view: 'bot-chat', id: '7' }, approve: null });
  const noPin = buildNote({ chat: bot, line: card, preview: 'all', sensitive: true, hasPin: false, words });
  assert.ok(!actionRoute(noPin, 'allow').call && !actionRoute(noPin, 'deny').call, 'sensible: nunca desde el aviso');
  // Con el texto oculto no se aprueba a ciegas: abre el chat.
  const blind = buildNote({ chat: bot, line: card, preview: 'chat', words });
  assert.ok(actionRoute(blind, 'allow').open && !actionRoute(blind, 'allow').call);
  // Tocar el aviso: el chat.
  assert.deepEqual(actionRoute(n, 'tap'), { open: { view: 'bot-chat', id: '7' } });
});

test('zona Orb: el permiso de un agente se contesta (sessions.approve); una tarea se aprueba en la app', () => {
  const ap = buildNote({ chat: orbChat, line: { role: 'system', body: 'Quiere ejecutar npm test', meta: { kind: 'task-approval', session: 'abc', request: 'r1', status: 'pending' } }, preview: 'chat', words });
  assert.equal(ap.kind, 'approval');
  assert.deepEqual(actionRoute(ap, 'allow'), { call: ['sessions.approve', { id: 'abc', request: 'r1', decision: 'allow' }] });
  assert.deepEqual(actionRoute(ap, 'deny'), { call: ['sessions.approve', { id: 'abc', request: 'r1', decision: 'deny' }] });
  const task = buildNote({ chat: orbChat, line: { role: 'system', body: '⚠️ «Publicar» necesita tu aprobación', meta: { kind: 'attention', task: 8 } }, preview: 'chat', words });
  assert.equal(task.kind, 'task');
  assert.deepEqual(actionRoute(task, 'allow'), { open: { view: 'chat', id: 12 }, approve: { method: 'tasks.approve', task: 8 } });
  assert.equal(lineKind({ meta: { kind: 'approval', session: 's', request: 'r', status: 'allowed' } }), null);
});

test('bloqueo de la app (PIN): Responder, Aprobar y Rechazar abren la app; nada se hace desde el aviso', () => {
  const m = buildNote({ chat: bot, line: msg('hola'), preview: 'all', hasPin: true, words });
  assert.deepEqual(m.actions, [{ id: 'reply', title: 'Responder', open: true }], 'sin caja de texto');
  assert.deepEqual(actionRoute(m, 'reply', { text: 'escrito igual' }), { open: { view: 'bot-chat', id: '7' } });
  const card = buildNote({ chat: bot, line: { id: 5, role: 'system', body: 'x', meta: { kind: 'bot_card', card: 'send', status: 'pending' } }, preview: 'all', hasPin: true, words });
  for (const a of ['allow', 'deny']) assert.ok(!actionRoute(card, a).call, a);
  const ap = buildNote({ chat: orbChat, line: { role: 'system', body: 'x', meta: { kind: 'approval', session: 's', request: 'r', status: 'pending' } }, preview: 'all', hasPin: true, words });
  for (const a of ['allow', 'deny']) assert.ok(!actionRoute(ap, a).call, a);
});

test('Responder: cada chat a su método; sin texto, abre el chat', () => {
  const r = (chat, text) => actionRoute(buildNote({ chat, line: msg('x'), preview: 'all' }), 'reply', { text });
  assert.deepEqual(r(bot, ' hola '), { call: ['bots.send', { id: '7', text: 'hola' }] });
  assert.deepEqual(r(group, 'vale'), { call: ['bots.groups.send', { id: '3', text: 'vale' }] });
  assert.deepEqual(r(orbChat, 'sigue'), { call: ['chat.send', { text: 'sigue', conversation: 12 }] });
  assert.deepEqual(r({ kind: 'orb', id: null, name: 'Orbe' }, 'hola'), { call: ['chat.send', { text: 'hola' }] });
  assert.deepEqual(r(bot, '   '), { open: { view: 'bot-chat', id: '7' } });
});

test('uno por chat: las líneas nuevas se juntan (las últimas cinco) y se cuentan; ids lejos de los recordatorios', () => {
  let c = null;
  for (let i = 1; i <= 7; i++) c = collapse(c, buildNote({ chat: bot, line: msg(`m${i}`), preview: 'all' }));
  assert.equal(c.count, 7); assert.deepEqual(c.lines, ['m3', 'm4', 'm5', 'm6', 'm7']); assert.equal(c.body, 'm3\nm4\nm5\nm6\nm7');
  const h = collapse({ lines: ['a'], count: 1 }, buildNote({ chat: bot, line: msg('b'), preview: 'chat', words }));
  assert.equal(h.body, 'Tienes un mensaje nuevo', 'oculto sigue oculto');
  assert.equal(chatKey(group), 'group:3'); assert.deepEqual(routeOf({ kind: 'orb' }), { view: 'chat' });
  for (const k of ['bot:1', 'group:9', 'conversation:4', 'orb']) {
    const id = noteId(k);
    assert.ok(id >= NOTE_IDS.first && id < NOTE_IDS.first + NOTE_IDS.size);
    assert.ok(id < REMINDER_IDS.first || id >= REMINDER_IDS.first + REMINDER_IDS.size, 'sin chocar con los recordatorios');
  }
});

// ---- the pictures
const pngSize = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const pixels = (png) => {
  // IDAT → raw rows (filter byte + RGBA)
  let o = 8; const idat = [];
  while (o < png.length) { const len = png.readUInt32BE(o); const type = png.toString('ascii', o + 4, o + 8); if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  return zlib.inflateSync(Buffer.concat(idat));
};

test('los avatares en PNG: forma y color del bot, transparente alrededor, grupo junto', () => {
  const png = avatarPng({ shape: 'mochi', color: 'cielo' }, 64);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(pngSize(png), [64, 64]);
  const raw = pixels(png); const at = (x, y) => { const o = y * (64 * 4 + 1) + 1 + x * 4; return [...raw.subarray(o, o + 4)]; };
  assert.equal(at(0, 0)[3], 0, 'la esquina, transparente');
  const mid = at(32, 46); assert.equal(mid[3], 255, 'el cuerpo, opaco');
  assert.ok(mid[2] > mid[0], 'cielo: más azul que rojo');
  const coral = pixels(avatarPng({ shape: 'mochi', color: 'coral' }, 64)); const o = 46 * (64 * 4 + 1) + 1 + 32 * 4;
  assert.ok(coral[o] > coral[o + 2], 'coral: más rojo que azul');
  assert.deepEqual(pngSize(groupPng([{ shape: 'gota', color: 'coral' }, { shape: 'nube', color: 'cielo' }, { shape: 'flor', color: 'lima' }], 96)), [96, 96]);
  assert.notDeepEqual(avatarPng({ shape: 'gota', color: 'coral' }, 64), avatarPng({ shape: 'hoja', color: 'coral' }, 64));
  for (const s of SHAPE_IDS) assert.ok(avatarPng({ shape: s, color: COLOR_IDS[0] }, 64).length > 200, s);
  assert.equal(flattenPath('M0 0h10v10H0z')[0].length, 4);
  assert.deepEqual(oklchToRgb(1, 0, 0).map((x) => Math.round(x * 255)), [255, 255, 255]);
});

test('las direcciones de los avatares: solo formas y colores conocidos', () => {
  assert.equal(avatarUrl({ shape: 'gota', color: 'coral' }), '/avatars/gota-coral.png');
  assert.equal(groupUrl([{ shape: 'gota', color: 'coral' }, { shape: 'nube', color: 'cielo' }]), '/avatars/g/gota-coral~nube-cielo.png');
  assert.equal(androidIconName({ shape: 'flor', color: 'menta' }), 'av_flor_menta');
  assert.ok(pngForPath('/avatars/gota-coral.png'));
  assert.ok(pngForPath('/avatars/g/gota-coral~nube-cielo~flor-lima.png'));
  for (const bad of ['/avatars/gota-negro.png', '/avatars/../x.png', '/avatars/g/a-b.png', '/avatars/g/gota-coral~gota-coral~gota-coral~gota-coral.png', '/avatars/gota-coral.svg']) assert.equal(pngForPath(bad), null, bad);
});

test('el service worker se puede leer y junta los avisos por chat', () => {
  assert.doesNotThrow(() => new Function(SERVICE_WORKER));
  assert.match(SERVICE_WORKER, /getNotifications\(\{tag\}\)/);
  assert.match(SERVICE_WORKER, /\/api\/note-action/);
  assert.match(SERVICE_WORKER, /orbOpen/);
});
