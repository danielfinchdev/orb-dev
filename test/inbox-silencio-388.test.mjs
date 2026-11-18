// A mute with an end (inbox.mute until): it counts as muted until then and by itself stops after it.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP } from '../src/domain/security/permissions.mjs';
import { isMuted } from '../src/domain/conversations/inbox.mjs';
import { ctx } from '../src/platform/context.mjs';

let t; let board; let api; let sessions; let orchestrator;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const item = (list, id) => list.items.find((x) => x.kind === 'conversation' && x.id === Number(id));
const orbSays = (c, text) => board.addChat('orb', text, null, c);
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  ctx.config = { ...ctx.config, userName: 'Ana' };
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('mute until: muted with its end, not counted, and back to counting once it has passed', async () => {
  const c = board.createConversation({ title: 'Con fecha' }).id;
  orbSays(c, 'uno');
  const until = inHours(8);
  const m = await call('inbox.mute', { kind: 'conversation', id: c, until });
  assert.equal(m.muted, true); assert.equal(m.mutedUntil, until);
  let list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, c).muted, true); assert.equal(item(list, c).mutedUntil, until);
  assert.equal(list.unread, list.items.filter((x) => !x.muted && !x.snoozedUntil).reduce((n, x) => n + x.unread, 0));
  assert.equal(isMuted(board, c), true);
  const before = list.unread;
  // The date passes with no timer: the row still says muted in the table, every reader says it is not.
  board.run("UPDATE inbox_items SET muted_until = '2000-01-01T00:00:00.000Z' WHERE kind = 'conversation' AND item_id = ?", String(c));
  list = await call('inbox.list', { zone: 'orb' });
  assert.equal(item(list, c).muted, false); assert.equal(item(list, c).mutedUntil, null);
  assert.equal(list.unread, before + item(list, c).unread, 'its unread lines count again');
  assert.equal(isMuted(board, c), false);
});

test('mute: without until it is for ever, muted:false lifts it and clears the date, a bad until is refused', async () => {
  const c = board.createConversation({ title: 'Siempre' }).id;
  let m = await call('inbox.mute', { kind: 'conversation', id: c });
  assert.equal(m.muted, true); assert.equal(m.mutedUntil, null);
  m = await call('inbox.mute', { kind: 'conversation', id: c, muted: true, until: inHours(1) });
  assert.ok(m.mutedUntil);
  m = await call('inbox.mute', { kind: 'conversation', id: c, muted: false });
  assert.equal(m.muted, false); assert.equal(m.mutedUntil, null);
  assert.equal(board.one("SELECT muted_until FROM inbox_items WHERE kind = 'conversation' AND item_id = ?", String(c)).muted_until, null);
  await assert.rejects(call('inbox.mute', { kind: 'conversation', id: c, until: '2000-01-01T00:00:00Z' }), 'not in the past');
  await assert.rejects(call('inbox.mute', { kind: 'conversation', id: c, until: 'mañana' }), 'not a time');
  await assert.rejects(call('inbox.mute', { kind: 'conversation', id: c, until: new Date(Date.now() + 400 * 86400e3).toISOString() }), 'not more than a year ahead');
  assert.equal(isMuted(board, c), false, 'a refused call changes nothing');
});
