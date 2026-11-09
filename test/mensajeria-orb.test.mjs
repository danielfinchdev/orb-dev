// 3.6 (messaging, step M3): the pure pieces of the Orb zone's chat list (src/ui/lib/inbox.js): the rows (conversations with
// their marks and tasks, direct conversations), each row's progress line and the list grouped by project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import * as M from '../src/ui/lib/inbox.js';

const t = (key, v = {}) => `${key}${Object.keys(v).length ? JSON.stringify(v) : ''}`;
const at = (min) => new Date(Date.UTC(2026, 10, 4, 12, 0) - min * 60_000).toISOString();

test('las filas de Orb: las conversaciones con sus marcas y tareas, y las directas con un agente', () => {
  const items = M.orbItems({
    inbox: { items: [{ key: 'conversation:1', pinned: true, pinOrder: 1, muted: true, unread: 2, lastMessage: { at: at(1), text: 'hola', from: { type: 'orbe' } } }] },
    conversations: [{ id: 1, title: 'Enlaces', project: 'mi-web', status: 'open', updated_at: at(5) }, { id: 2, title: 'Pago', project: 'tienda', status: 'done', updated_at: at(90) }],
    tasks: [{ id: 7, conversation_id: 1, status: 'done', updated_at: at(30), title: 'A' }, { id: 8, conversation_id: 1, status: 'running', updated_at: at(3), title: 'B' }, { id: 9, conversation_id: null, status: 'queued' }],
    sessions: [{ id: 's1', kind: 'chat', title: 'Directo', project: 'mi-web', agent: 'codex', status: 'interrupted', updated_at: at(10) }, { id: 's2', kind: 'task', title: 'De una tarea' }, { id: 'opti', kind: 'chat', title: 'Opti' }],
    chats: [{ conversation: 2, busy: true }], skip: 'opti'
  });
  assert.deepEqual(items.map((x) => x.key), ['conversation:1', 'conversation:2', 'session:s1'], 'sin las sesiones de tareas ni la de Opti Bot');
  const [a, b, s] = items;
  assert.equal(a.pinned, true); assert.equal(a.muted, true); assert.equal(a.unread, 2);
  assert.deepEqual(a.tasks.map((x) => x.id), [8, 7], 'sus tareas, la más reciente primero');
  assert.equal(a.at, at(1), 'la hora de la última línea');
  assert.equal(a.open, 1);
  assert.equal(b.done, true); assert.equal(b.busy, true, 'contestando ahora');
  assert.equal(s.kind, 'session'); assert.equal(s.stalled, true);
});

test('3.8.1 (H1e): el avatar de cada fila: el proyecto en grande y en la esquina los agentes que trabajaron, apilados', () => {
  assert.deepEqual(M.agentsOf('claude', []), ['claude'], 'solo su cerebro');
  assert.deepEqual(M.agentsOf('claude', [{ agent: 'claude' }, { agent: 'any' }]), ['claude'], '«cualquiera» sin asignar no cuenta');
  assert.deepEqual(M.agentsOf('claude', [{ agent: 'any', assigned_to: 'codex' }]), ['claude', 'codex'], 'una tarea que hizo otro agente');
  // tasks come newest first: the order is the brain, then the oldest task's agent
  assert.deepEqual(M.agentsOf('claude', [{ agent: 'gemini' }, { agent: 'codex' }, { agent: 'gemini' }]), ['claude', 'gemini', 'codex'], 'cada agente una vez, siempre en el mismo orden');
  assert.deepEqual(M.agentsOf(null, [{ agent: 'codex' }]), ['codex'], 'sin cerebro conocido');
  const items = M.orbItems({
    conversations: [{ id: 1, title: 'A', project: 'web', agent: 'codex' }, { id: 2, title: 'B', project: null, agent: 'claude' }],
    tasks: [{ id: 5, conversation_id: 2, agent: 'codex', status: 'done' }],
    sessions: [{ id: 's1', kind: 'chat', title: 'Directo', project: 'web', agent: 'cursor' }]
  });
  assert.deepEqual(items.map((x) => x.agents), [['codex'], ['claude', 'codex'], ['cursor']]);
  const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'orb', 'inbox.jsx'), 'utf8');
  const avatar = ui.slice(ui.indexOf('export function OrbAvatar'), ui.indexOf('// ---- what can be done with a chat'));
  assert.match(avatar, /<ProjectIcon name=\{item\.project\} size=\{size\} \/>/, 'grande: el icono del proyecto');
  assert.match(avatar, /shown\.map\(\(a, i\) =>[\s\S]*<AgentIcon agent=\{a\}/, 'esquina: la marca de cada agente');
  assert.match(avatar, /\+\{more\}/, 'más de tres: «+N»');
  assert.doesNotMatch(avatar, /Orchestrator/, 'nunca el icono del orquestador');
  assert.match(avatar, /Intl\.ListFormat/, 'su nombre lista los agentes («Claude y Codex»)');
  assert.match(avatar, /aria-label=/, 'con su nombre para los lectores de pantalla');
  assert.equal((ui.match(/<OrbAvatar /g) ?? []).length, 3, 'filas, hoja del móvil y mensajes encontrados usan el mismo avatar');
});

test('el avance de cada fila: primero lo que espera al usuario, luego lo que trabaja, luego cómo acabó', () => {
  const base = { kind: 'conversation', tasks: [], lastMessage: null };
  assert.deepEqual(M.orbProgress({ ...base, tasks: [{ id: 3, status: 'running', title: 'X' }, { id: 4, status: 'awaiting_approval' }] }, t), { text: 'orbchats.awaiting', tone: 'warn', badge: true });
  assert.equal(M.orbProgress({ ...base, asking: true }, t).text, 'orbchats.asking');
  assert.equal(M.orbProgress({ kind: 'session', tasks: [], asks: true }, t).text, 'orbchats.permission');
  assert.deepEqual(M.orbProgress({ ...base, tasks: [{ id: 3, status: 'running', title: 'Enlaces' }] }, t), { text: 'orbchats.running{"id":3,"title":"Enlaces"}', tone: 'live' });
  assert.equal(M.orbProgress({ ...base, busy: true }, t).text, 'chats.working');
  assert.equal(M.orbProgress({ ...base, tasks: [{ status: 'queued' }, { status: 'queued' }] }, t).text, 'orbchats.queued{"n":2}');
  // A finished task newer than the last line says how it ended; an older one leaves the last line.
  const done = { id: 5, status: 'done', title: 'Formulario', updated_at: at(10) };
  assert.deepEqual(M.orbProgress({ ...base, tasks: [done], lastMessage: { at: at(20), text: 'x', from: { type: 'orbe' } } }, t), { text: 'orbchats.done{"title":"Formulario"}', tone: 'done' });
  assert.deepEqual(M.orbProgress({ ...base, tasks: [done], lastMessage: { at: at(5), text: 'Te  propongo\nun plan', from: { type: 'orbe' } } }, t, { assistant: 'Orbe' }), { prefix: 'Orbe: ', text: 'Te propongo un plan', tone: 'muted' });
  assert.equal(M.orbProgress({ ...base, tasks: [{ ...done, status: 'failed' }] }, t).tone, 'error');
  assert.equal(M.orbProgress({ ...base, lastMessage: { at: at(1), text: 'hola', from: { type: 'user' } } }, t).prefix, 'chats.you');
  assert.equal(M.orbProgress(base, t).text, 'chats.noMessages');
  assert.equal(M.orbProgress({ kind: 'session', tasks: [], agentName: 'Codex' }, t).text, 'orbchats.direct{"agent":"Codex"}');
});

test('la lista agrupada: fijados arriba sin repetirse, un grupo por proyecto (Sin proyecto al final) y los completados aparte', () => {
  const row = (id, project, min, extra = {}) => ({ key: `conversation:${id}`, kind: 'conversation', id, title: `c${id}`, project, at: at(min), tasks: [], unread: 0, ...extra });
  const items = [row(1, 'mi-web', 5, { unread: 2 }), row(2, 'tienda', 1), row(3, null, 0), row(4, 'mi-web', 50, { done: true }), row(5, 'mi-web', 2, { pinned: true, pinOrder: 2 }), row(6, 'tienda', 9, { pinned: true, pinOrder: 1, muted: true, unread: 4 }),
    row(7, 'tienda', 3, { busy: true, agent: 'codex' }), row(8, 'mi-web', 4, { tasks: [{ status: 'awaiting_approval' }] })];
  const g = M.groupOrb(items);
  assert.deepEqual(g.pinned.map((x) => x.id), [6, 5], 'en su orden');
  assert.deepEqual(g.groups.map((x) => x.project), ['tienda', 'mi-web', null], 'el más reciente primero; sin proyecto al final');
  assert.deepEqual(g.groups[1].items.map((x) => x.id), [8, 1], 'sin el fijado ni el completado');
  assert.equal(g.groups[1].hidden, 1); assert.equal(g.hidden, 1);
  assert.equal(g.groups[1].unread, 2); assert.equal(g.groups[1].waiting, 1); assert.equal(g.groups[0].working, 1);
  assert.deepEqual(M.groupOrb(items, { showDone: true }).groups[1].items.map((x) => x.id), [8, 1, 4], 'con los completados');
  assert.deepEqual(M.groupOrb(items, { filter: { state: 'attention', agent: 'all' } }).groups.flatMap((x) => x.items.map((y) => y.id)), [8]);
  assert.deepEqual(M.groupOrb(items, { filter: { state: 'done', agent: 'all' } }).groups.flatMap((x) => x.items.map((y) => y.id)), [4]);
  assert.deepEqual(M.groupOrb(items, { filter: { state: 'all', agent: 'codex' } }).groups.flatMap((x) => x.items.map((y) => y.id)), [7]);
  assert.equal(M.unreadOf({ items }), 2, 'los silenciados no cuentan');
});

test('la zona Orb en la interfaz: su lista en la barra lateral y en «Chats», pestañas Chats · Tareas · Proyectos, el panel de información', () => {
  const read = (...f) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...f), 'utf8');
  assert.match(read('components', 'sidebar.jsx'), /<OrbInbox \/>/);
  const main = read('main.jsx');
  assert.match(main, /const ChatsView = OrbChatsView/);
  assert.match(main, /<OrbInfoHost \/>/);
  const tabs = read('components', 'mobile-tabs.jsx');
  assert.match(tabs, /id: 'chats'[\s\S]*id: 'tasks'[\s\S]*id: 'projects'/);
  assert.doesNotMatch(tabs, /id: 'chat', icon/, 'sin la pestaña «Orbe»: los chats están en la lista');
  const chat = read('views', 'chat.jsx');
  assert.doesNotMatch(chat, /LiveTasksStrip/, 'las tareas, en una línea dentro de la conversación');
  assert.match(chat, /<TaskLines conversation=\{id\} \/>/);
  // Every key used by the new screens exists in both languages.
  const keys = new Set([...read('views', 'orb', 'inbox.jsx').matchAll(/t\('(orbchats\.[\w.]+)'/g), ...read('views', 'orb', 'info.jsx').matchAll(/t\('(orbchats\.[\w.]+)'/g), ...chat.matchAll(/t\('(orbchats\.[\w.]+)'/g)].map((m) => m[1]));
  const es = fs.readFileSync(path.join(ROOT, 'src', 'core', 'locales', 'es', 'orbchats.mjs'), 'utf8');
  const en = fs.readFileSync(path.join(ROOT, 'src', 'core', 'locales', 'en', 'orbchats.mjs'), 'utf8');
  for (const k of keys) { assert.ok(es.includes(`'${k}'`), `es sin ${k}`); assert.ok(en.includes(`'${k}'`), `en sin ${k}`); }
});

test('3.8.2: el avatar con 4 o más agentes: marcas apiladas y «+N» dentro del avatar, en cualquier tamaño, y la lista al pasar', () => {
  for (const size of [28, 34, 40, 46]) {
    for (let n = 1; n <= 12; n++) {
      const s = M.avatarStack(n, size);
      assert.equal(s.marks.length + s.more, n, `${n} agentes en ${size}px: ninguno se pierde`);
      assert.ok(s.marks.length >= 1 && s.marks.length <= 3);
      if (n <= 3 && size >= 34) assert.equal(s.more, 0, `${n} caben sin «+N» en ${size}px`);
      if (n > 3) assert.ok(s.more >= 2, 'pasado tres, «+N» con al menos dos');
      const left = Math.max(...s.marks.map((r) => r + s.badge), s.more ? s.moreRight + s.badge : 0);
      assert.ok(left <= size + 3, `${n} agentes en ${size}px no salen por la izquierda (${left})`);
      assert.ok(!s.more || s.moreRight - s.marks.at(-1) >= Math.round(s.badge * 0.8), '«+N» se lee: el último solo lo tapa un poco');
      assert.ok(s.moreFont * String(`+${s.more}`).length * 0.62 <= s.badge, '«+N» cabe en su círculo');
    }
  }
  const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'orb', 'inbox.jsx'), 'utf8');
  const avatar = ui.slice(ui.indexOf('export function OrbAvatar'), ui.indexOf('// ---- what can be done with a chat'));
  assert.match(avatar, /avatarStack\(agents\.length, size/);
  assert.match(avatar, /title=\{who \|\| undefined\}/, 'al pasar el ratón, todos los agentes');
});
