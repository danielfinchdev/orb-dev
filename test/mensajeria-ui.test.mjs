// 3.6 (messaging, M2): the pure pieces of the Bots zone's chat list and conversation (src/ui/lib/inbox.js), plus two
// regression checks of the React «insertBefore … not a child of this node» crash (the app went blank after «Guardar» in
// the bot editor): nothing removes React's own toast nodes, and Select never copies its option into the trigger through
// Radix's portal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import * as M from '../src/ui/lib/inbox.js';
import { translate } from '../src/core/i18n.mjs';

const t = (k, v) => translate('es', k, v);
const it = (o) => ({ kind: 'bot', id: 1, title: 'X', pinned: false, section: null, muted: false, unread: 0, at: null, ...o });

test('la lista: fijados solo arriba y en su orden; cada uno en su sección; el resto en «Sin asignar»; lo más reciente primero', () => {
  const data = { sections: [{ id: 7, name: 'Trabajo' }, { id: 8, name: 'Casa' }], items: [
    it({ key: 'bot:1', id: 1, pinned: true, pinOrder: 1, section: 7 }), it({ key: 'bot:2', id: 2, pinned: true, pinOrder: 0 }),
    it({ key: 'bot:3', id: 3, section: 7, at: '2026-11-01T10:00:00Z', unread: 2 }), it({ key: 'bot:4', id: 4, section: 7, at: '2026-11-03T10:00:00Z', unread: 5, muted: true }),
    it({ key: 'bot:5', id: 5, at: '2026-11-02T10:00:00Z' }), it({ key: 'group:1', kind: 'group', id: 1, section: 99 })
  ] };
  const s = M.splitInbox(data);
  assert.deepEqual(s.pinned.map((x) => x.key), ['bot:2', 'bot:1']);
  assert.deepEqual(s.sections.map((x) => x.items.map((y) => y.key)), [['bot:4', 'bot:3'], []], 'un fijado no se repite en su sección');
  assert.equal(s.sections[0].unread, 2, 'los silenciados no cuentan');
  assert.deepEqual(s.loose.map((x) => x.key), ['bot:5', 'group:1'], 'una sección que ya no existe: sin asignar');
  assert.equal(M.unreadOf(data), 2);
  assert.deepEqual(M.splitInbox(null), { pinned: [], sections: [], loose: [] });
});

test('sin inbox.list (un Orb anterior): la misma forma desde bots.list', () => {
  const f = M.fallbackInbox([{ id: 1, name: 'Jefe', is_chief: 1, paused: 0 }, { id: 2, name: 'B', paused: 1 }], [{ id: 3, name: 'G', members: [1, 2] }], { 1: { busy: true } });
  assert.deepEqual(f.items.map((x) => [x.key, x.state]), [['bot:1', 'working'], ['bot:2', 'paused'], ['group:3', 'idle']]);
  assert.deepEqual(f.items[2].members, [1, 2]);
});

test('la hora de una fila y los separadores de día', () => {
  const now = new Date(2026, 10, 4, 18, 0);
  assert.match(M.shortTime(new Date(2026, 10, 4, 9, 5).toISOString(), { now, locale: 'es-ES' }), /^09:05$/);
  assert.equal(M.shortTime(new Date(2026, 10, 3, 9, 5).toISOString(), { now, locale: 'es-ES', yesterday: 'Ayer' }), 'Ayer');
  assert.match(M.shortTime(new Date(2026, 9, 2).toISOString(), { now, locale: 'es-ES' }), /2 oct/);
  assert.equal(M.shortTime('nada'), '');
  const lines = [{ id: 1, at: new Date(2026, 10, 3, 10).toISOString() }, { id: 2, at: new Date(2026, 10, 3, 11).toISOString() }, { id: 3, at: new Date(2026, 10, 4, 8).toISOString() }];
  const rows = M.withDays(lines, { now, locale: 'es-ES', today: 'Hoy', yesterday: 'Ayer' });
  assert.deepEqual(rows.map((r) => r.label ?? r.line.id), ['Ayer', 1, 2, 'Hoy', 3]);
});

test('la vista previa: tú, otra persona, el bot de un grupo, un bot a otro, tarjetas y estados', () => {
  const at = '2026-11-04T10:00:00Z';
  assert.deepEqual(M.previewOf(it({ lastMessage: { text: 'hola', at, from: { type: 'user', person: 1, name: 'Ana' }, kind: 'text' } }), t, { me: 1 }), { prefix: 'Tú: ', text: 'hola' });
  assert.deepEqual(M.previewOf(it({ kind: 'group', lastMessage: { text: 'hola', at, from: { type: 'user', person: 2, name: 'Leo' }, kind: 'text' } }), t, { me: 1 }), { prefix: 'Leo: ', text: 'hola' });
  assert.deepEqual(M.previewOf(it({ kind: 'group', lastMessage: { text: 'hecho', at, from: { type: 'bot', bot: 3, name: 'Agenda' }, kind: 'text' } }), t), { prefix: 'Agenda: ', text: 'hecho' });
  const relay = M.previewOf(it({ lastMessage: { text: 'lista', at, from: { type: 'bot-to-bot', bot: 3, toName: 'Jefe' }, kind: 'text' } }), t);
  assert.equal(relay.relay, true); assert.equal(relay.prefix, 'A Jefe: ');
  assert.equal(M.previewOf(it({ lastMessage: { text: 'Comprar', at, from: { type: 'bot' }, kind: 'card' } }), t).text, 'Pide tu aprobación · Comprar');
  assert.equal(M.previewOf(it({ state: 'working' }), t).tone, 'live');
  assert.equal(M.previewOf(it({ state: 'paused' }), t).text, 'En pausa');
  assert.equal(M.previewOf(it({}), t).text, 'Sin mensajes');
});

test('«@» en el compositor de un grupo: la palabra que se escribe, los miembros que encajan y el texto con la elegida', () => {
  const members = [{ id: 1, name: 'Jefe' }, { id: 2, name: 'Agenda' }, { id: 3, name: 'Ágata' }];
  assert.equal(M.mentionQuery('hola @Ag'), 'Ag');
  assert.equal(M.mentionQuery('correo@ejemplo'), null, 'no en medio de una palabra');
  assert.equal(M.mentionQuery('hola'), null);
  assert.deepEqual(M.mentionMatches(members, 'ag').map((b) => b.id), [2, 3], 'sin tildes ni mayúsculas');
  assert.deepEqual(M.mentionMatches(members, null), []);
  assert.deepEqual(M.insertMention('dile a @Ag que venga', 10, 'Agenda'), { text: 'dile a @Agenda  que venga', caret: 15 });
  assert.match(M.nameColor({ avatar: { shape: 'mochi', color: 'menta' } }), /oklch\(0\.5 0\.14 168\)/);
});

test('regresión insertBefore: ninguna prueba quita a mano los avisos (nodos de React) y Select pinta su opción él mismo', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter((x) => x.endsWith('.mjs') && x !== 'mensajeria-ui.test.mjs')) {
    const src = fs.readFileSync(path.join(ROOT, 'test', f), 'utf8');
    assert.doesNotMatch(src, /querySelectorAll\(['\"]\[data-sonner-toast\]['\"]\)[^\n]*\.remove\(\)/, `${f} quita avisos del DOM: React inserta el siguiente antes de uno que ya no está`);
  }
  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'ui', 'overlay.jsx'), 'utf8');
  assert.match(overlay, /<SelectPrimitive\.Value[^>]*>\{chosen \?/, 'el Value de Select con hijos (sin el portal de Radix)');
});

test('la zona Bots en el móvil: Chats · Recordatorios · Casa, y la lista es una pantalla', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'main.jsx'), 'utf8');
  assert.match(main, /'bot-chats': BotChatsScreen/);
  const tabs = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'mobile-tabs.jsx'), 'utf8');
  assert.match(tabs, /id: 'bot-chats'[\s\S]*id: 'bot-reminders'[\s\S]*id: 'bot-home'/);
  assert.doesNotMatch(tabs, /id: 'bots', icon/, 'la lista de tarjetas de bots ya no es una pestaña (está en ☰)');
});
