// 3.8.7 (step 8): the tray «Te necesita» (priority order that does not move under the user, Ctrl+Alt+A to the next chat
// that needs them) and the summary of the day (built from the logs and the board; also for the phone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, ROOT } from './helpers.mjs';
import * as M from '../src/ui/lib/inbox.js';
import { digestLines } from '../src/ui/lib/day-digest.js';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, principalOf, METHODS } from '../src/domain/security/permissions.mjs';
import { ctx } from '../src/platform/context.mjs';
import { dayDigest, morningDue, logEntriesOf, previousDay } from '../src/domain/activity/day-digest.mjs';

const it = (key, over = {}) => ({ key, id: Number(key.split(':')[1]), kind: 'conversation', title: key, at: '2026-11-15T10:00:00Z', unread: 0, busy: false, done: false, tasks: [], ...over });
const asks = { asking: true };

// ---- the order
test('Prioridad: lo que te necesita, luego lo terminado sin ver, luego lo que trabaja y el resto; lo completado al final', () => {
  const items = [
    it('conversation:1'),
    it('conversation:2', { busy: true }),
    it('conversation:3', { unread: 2 }),
    it('conversation:4', { ...asks }),
    it('conversation:5', { done: true, unread: 3 }),
    it('conversation:6', { tasks: [{ id: 1, status: 'awaiting_approval' }] }),
    it('conversation:7', { unread: 1, muted: true })
  ];
  assert.deepEqual(items.map(M.priorityRank), [3, 2, 1, 0, 3, 0, 3]);
  assert.deepEqual(M.priorityKeys(items).slice(0, 4), ['conversation:6', 'conversation:4', 'conversation:3', 'conversation:2']);
});

test('Prioridad: las filas no se mueven mientras las atiendes; lo nuevo entra arriba', () => {
  const items = [it('conversation:1', { ...asks }), it('conversation:2', { busy: true }), it('conversation:3', { unread: 1 })];
  const frozen = M.priorityKeys(items);
  assert.deepEqual(frozen, ['conversation:1', 'conversation:3', 'conversation:2']);
  // the user answers chat 1 and chat 2 finishes: with the snapshot nothing changes place
  const later = [it('conversation:1'), it('conversation:2', { unread: 1 }), it('conversation:3', { unread: 1 })];
  const order = (list) => M.groupOrb(list, { order: 'priority', frozen }).groups.flatMap((g) => g.items.map((x) => x.key));
  assert.deepEqual(order(later), frozen, 'mismo orden aunque cambien de estado');
  assert.deepEqual(order([...later, it('conversation:9', { ...asks })]), ['conversation:9', ...frozen], 'lo que llega después se ve arriba');
  assert.deepEqual(M.priorityKeys(later), ['conversation:3', 'conversation:2', 'conversation:1'], '«Reordenar» toma otra foto');
});

test('Prioridad: un solo grupo sin cabecera de proyecto, los fijados arriba y los filtros siguen valiendo', () => {
  const items = [it('conversation:1', { project: 'a', pinned: true, pinOrder: 1 }), it('conversation:2', { project: 'a', ...asks }), it('conversation:3', { project: 'b', unread: 1 }), it('conversation:4', { project: 'b', done: true })];
  const r = M.groupOrb(items, { order: 'priority' });
  assert.deepEqual(r.pinned.map((x) => x.key), ['conversation:1']);
  assert.equal(r.groups.length, 1); assert.equal(r.groups[0].flat, true);
  assert.deepEqual(r.groups[0].items.map((x) => x.key), ['conversation:2', 'conversation:3']);
  assert.equal(r.hidden, 1, 'el completado sigue contándose como oculto');
  const att = M.groupOrb(items, { order: 'priority', filter: { state: 'attention', agent: 'all' } });
  assert.deepEqual(att.groups[0].items.map((x) => x.key), ['conversation:2']);
  assert.equal(M.groupOrb(items).groups.length, 2, 'el orden por defecto sigue agrupando por proyecto');
});

test('Ctrl+Alt+A salta al siguiente que te necesita, da la vuelta y no cuenta lo completado ni lo pospuesto', () => {
  const shown = [it('conversation:1'), it('conversation:2', { ...asks }), it('conversation:3', { done: true, ...asks }), it('conversation:4', { ...asks, snoozedUntil: 'x' }), it('conversation:5', { ...asks })];
  assert.equal(M.nextNeedingYou(shown, null).key, 'conversation:2');
  assert.equal(M.nextNeedingYou(shown, 'conversation:2').key, 'conversation:5');
  assert.equal(M.nextNeedingYou(shown, 'conversation:5').key, 'conversation:2', 'da la vuelta');
  assert.equal(M.nextNeedingYou(shown, 'conversation:1').key, 'conversation:2', 'desde un chat que no necesita nada');
  assert.equal(M.nextNeedingYou([it('conversation:1')], null), null);
  const key = (o) => ({ ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, code: 'KeyA', key: 'a', ...o });
  assert.equal(M.isNextNeedsKey(key()), true);
  assert.equal(M.isNextNeedsKey(key({ ctrlKey: false })), false);
  assert.equal(M.isNextNeedsKey(key({ shiftKey: true })), false);
  assert.equal(M.isNextNeedsKey(key({ key: 'æ' })), false, 'AltGr de otra distribución escribe un carácter');
});

test('la interfaz: el atajo, el orden y la tarjeta están conectados y los textos existen en es y en', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'views', 'orb', 'inbox.jsx'), 'utf8');
  assert.match(src, /isNextNeedsKey/); assert.match(src, /nextNeedingYou/); assert.match(src, /DayDigestCard/);
  for (const lang of ['es', 'en']) {
    const m = (await import(`../src/shared/locales/${lang}/orbchats.mjs`)).default;
    for (const k of ['order', 'orderPriority', 'reorder', 'digestTitle', 'digestDone', 'digestUsage']) assert.ok(m[`orbchats.${k}`], `${lang}: ${k}`);
  }
});

// ---- the summary of the day
let t; let board; let api; let sessions;
before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const DAY = '2026-11-15';
const addTask = (title, status, at) => board.run("INSERT INTO tasks (project, title, description, status, created_by, created_at, updated_at) VALUES ('p', ?, '', ?, 'usuario', ?, ?)", title, status, at, at);

test('el resumen sale de las tareas y la bitácora del día, y no inventa lo que no hay', () => {
  assert.equal(dayDigest(board, { day: DAY }).empty, true, 'sin nada registrado no hay tarjeta');
  addTask('Arreglar enlaces', 'done', `${DAY}T12:00:00.000Z`);
  addTask('Otro día', 'done', '2026-11-10T12:00:00.000Z');
  addTask('Se rompió', 'failed', `${DAY}T13:00:00.000Z`);
  addTask('Pendiente de OK', 'awaiting_approval', '2026-11-01T12:00:00.000Z');
  fs.mkdirSync(path.dirname(ctx.paths.generalLog), { recursive: true });
  fs.writeFileSync(ctx.paths.generalLog, `# Bitácora\n\n### ${DAY} 09:30 — Claude (Code) — Tema de ayer\n- Hecho: secreto-privado\n\n### 2026-11-10 09:30 — Claude — Otro día\n`);
  board.run("INSERT INTO usage_ledger (at, day, person_id, account_id, turns, tokens_in, tokens_out, usd) VALUES (?, ?, 'owner', 'x', 4, 10, 10, 0.5)", `${DAY}T10:00:00Z`, DAY);
  const d = dayDigest(board, { day: DAY });
  assert.equal(d.empty, false);
  assert.deepEqual(d.done.items.map((x) => x.title), ['Arreglar enlaces']);
  assert.equal(d.failed.count, 1);
  assert.deepEqual(d.entries.items.map((x) => x.topic), ['Tema de ayer']);
  assert.equal(d.waiting.approvals, 1);
  assert.equal(d.usage.length, 1); assert.equal(d.usage[0].turns, 4);
  assert.ok(!JSON.stringify(d).includes('secreto-privado'), 'el cuerpo de la bitácora no sale, solo el tema');
});

test('qué día es «ayer» y cuándo toca la tarjeta de la mañana (una vez al día, no antes de las 5)', () => {
  assert.equal(previousDay(new Date('2026-03-29T12:00:00Z'), 'Europe/Madrid'), '2026-03-28');
  assert.equal(previousDay(new Date('2026-11-16T00:30:00Z'), 'Europe/Madrid'), '2026-11-15');
  assert.deepEqual(logEntriesOf('### 2026-11-15 09:30 — A — Uno\n### 2026-11-14 09:30 — B — Dos', DAY).map((e) => e.topic), ['Uno']);
  const morning = new Date('2026-11-16T09:00:00Z');
  assert.equal(morningDue(null, morning, 'UTC'), true);
  assert.equal(morningDue('2026-11-16', morning, 'UTC'), false, 'ya mostrada hoy');
  assert.equal(morningDue('2026-11-15', morning, 'UTC'), true);
  assert.equal(morningDue(null, new Date('2026-11-16T03:00:00Z'), 'UTC'), false, 'de madrugada no');
});

test('la tarjeta: solo pinta lo registrado', () => {
  const t2 = (k, v = {}) => `${k}${JSON.stringify(v)}`;
  assert.deepEqual(digestLines({ empty: true }, t2), []);
  const lines = digestLines({ empty: false, done: { count: 2, items: [{ id: 1, title: 'A' }] }, failed: { count: 0, items: [] }, entries: { count: 0, items: [] }, usage: [], waiting: { approvals: 1, held: 0 } }, t2);
  assert.deepEqual(lines.map((l) => l.key), ['done', 'approvals']);
});

test('el resumen viaja al móvil: solo lectura y marca por dispositivo', async () => {
  assert.equal(METHODS['inbox.digest'], 'remote'); assert.equal(METHODS['inbox.digestSeen'], 'remote');
  const phone = principalOf({ device: { id: 'p1', kind: 'phone' } });
  const a = await api.call('inbox.digest', { day: DAY }, phone);
  assert.equal(a.day, DAY); assert.equal(a.due, true);
  await api.call('inbox.digestSeen', {}, phone);
  assert.equal((await api.call('inbox.digest', { day: DAY }, phone)).due, false, 'el móvil ya la vio');
  assert.equal((await api.call('inbox.digest', { day: DAY }, DESKTOP)).due, true, 'el PC la mantiene pendiente: cada dispositivo la suya');
});

test('una fecha imposible no rompe la llamada y el móvil no recibe rutas del PC', async () => {
  const phone = principalOf({ device: { id: 'p2', kind: 'phone' } });
  assert.match((await api.call('inbox.digest', { day: '2026-13-45' }, phone)).day, /^\d{4}-\d{2}-\d{2}$/);
  addTask(`Mirar ${ctx.home}${path.sep}secreto`, 'done', '2026-11-14T12:00:00.000Z');
  const d = await api.call('inbox.digest', { day: '2026-11-14' }, phone);
  assert.ok(!JSON.stringify(d).includes(String(ctx.home).split(path.sep).join('/')) && !d.done.items[0].title.includes(String(ctx.home)), 'la ruta del PC no viaja');
  assert.ok((await api.call('inbox.digest', { day: '2026-11-14' }, DESKTOP)).done.items[0].title.includes(String(ctx.home)), 'el PC la ve entera');
});
