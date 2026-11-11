// Soft delete with undo for the mobile app: conversations.trash / sessions.trash hide a chat from every list without
// moving anything, restore brings it back whole, and after TRASH_DAYS the purge runs the usual removal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, principalOf, METHODS, REMOTE_METHODS } from '../src/domain/security/permissions.mjs';
import { guardCall } from '../src/engine/transport/remote-calls.mjs';
import { TRASH_DAYS } from '../src/domain/conversations/trash.mjs';
import { openDb } from '../src/domain/data/db.mjs';

let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const phone = principalOf({ device: { id: 'p1', kind: 'phone' } });
const DAY = 24 * 3_600_000;
const inList = async (id) => (await call('conversations.list')).some((c) => c.id === id);
const sessionInList = async (id) => (await call('sessions.list')).some((s) => s.id === id);
const lines = (c) => board.all('SELECT id FROM chat WHERE conversation_id = ?', c).length;
const addItem = (id, body) => board.run("INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, 'user', 'text', ?, ?)", id, body, new Date().toISOString());

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  fs.mkdirSync(path.join(t.home, 'web', 'tienda'), { recursive: true });
  board.addProject({ name: 'tienda', path: path.join(t.home, 'web', 'tienda') }, 'usuario', { fromUser: true });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const newConversation = (title, text) => {
  const c = board.createConversation({ title });
  board.addChat('usuario', text, null, c.id);
  board.addChat('orb', `respuesta ${text}`, null, c.id);
  return c;
};

test('policy: the new methods are remote, the definitive removals stay on the PC', () => {
  for (const m of ['conversations.trash', 'conversations.restore', 'sessions.trash', 'sessions.restore']) { assert.equal(METHODS[m], 'remote', m); assert.ok(REMOTE_METHODS.has(m), m); }
  assert.equal(METHODS['conversations.remove'], 'pc');
  assert.equal(METHODS['sessions.remove'], 'pc');
});

test('conversations.trash hides it from the lists, inbox and searches; restore brings it back with its lines', async () => {
  const keep = newConversation('Otra cosa', 'nada');
  const c = newConversation('Receta de papelera', 'cuántos huevos');
  assert.ok(await inList(c.id));
  const out = await call('conversations.trash', { id: c.id }, phone);
  assert.ok(Date.parse(out.undo) > Date.now() + (TRASH_DAYS - 0.01) * DAY && Date.parse(out.undo) < Date.now() + (TRASH_DAYS + 0.01) * DAY);
  assert.equal(await inList(c.id), false);
  assert.ok(await inList(keep.id), 'the others stay');
  assert.ok(!(await call('inbox.list', {})).items.some((x) => x.key === `conversation:${c.id}`));
  assert.ok(!(await call('inbox.search', { q: 'papelera' })).items.some((x) => x.id === c.id));
  assert.ok(!(await call('inbox.search', { q: 'huevos' })).messages.some((x) => x.conversation === c.id));
  const found = await call('conversations.search', { q: 'huevos' });
  assert.ok(!found.conversations.includes(c.id));
  assert.equal(lines(c.id), 2, 'nothing was deleted');
  assert.ok((await call('chat.list', { conversation: c.id })).length >= 2, 'reading by id still works');
  const restored = await call('conversations.restore', { id: c.id }, phone);
  assert.equal(restored.id, c.id);
  assert.equal(restored.trashed_at, null);
  assert.ok(await inList(c.id));
  assert.ok((await call('inbox.list', {})).items.some((x) => x.key === `conversation:${c.id}`));
  assert.equal(lines(c.id), 2);
  assert.equal((await call('conversations.restore', { id: c.id }, phone)).id, c.id, 'restoring one not in the trash is fine');
});

test('trashing twice keeps the first date', async () => {
  const c = newConversation('Doble', 'x');
  await call('conversations.trash', { id: c.id }, phone);
  const first = new Date(Date.now() - DAY).toISOString();
  board.run('UPDATE conversations SET trashed_at = ? WHERE id = ?', first, c.id);
  const again = await call('conversations.trash', { id: c.id }, phone);
  assert.equal(board.conversation(c.id).trashed_at, first);
  assert.equal(again.undo, new Date(Date.parse(first) + TRASH_DAYS * DAY).toISOString());
});

test('writing to a chat in the trash fails with a clear message', async () => {
  const c = newConversation('Escribir', 'x');
  await call('conversations.trash', { id: c.id }, phone);
  await assert.rejects(call('chat.send', { text: 'hola', conversation: c.id }, phone), /papelera/);
  const s = await call('sessions.create', { agent: 'claude', title: 'Directo' }, phone);
  await call('sessions.trash', { id: s.id }, phone);
  await assert.rejects(call('sessions.send', { id: s.id, text: 'hola' }, phone), /papelera/);
  await assert.rejects(call('sessions.resume', { id: s.id }, phone), /papelera/);
});

test('sessions.trash hides it, restore returns the row; a task session cannot be trashed', async () => {
  const s = await call('sessions.create', { agent: 'claude', title: 'Para borrar' }, phone);
  addItem(s.id, 'hola mundo');
  assert.ok(await sessionInList(s.id));
  const out = await call('sessions.trash', { id: s.id }, phone);
  assert.ok(out.undo);
  assert.equal(await sessionInList(s.id), false);
  assert.ok(!(await call('conversations.search', { q: 'hola mundo' })).sessions.includes(s.id));
  assert.ok(!(await call('inbox.list', {})).items.some((x) => x.key === `session:${s.id}`));
  assert.equal((await call('sessions.items', { id: s.id })).length, 1, 'items are still read by id');
  const row = await call('sessions.restore', { id: s.id }, phone);
  assert.equal(row.id, s.id); assert.equal(row.trashed_at, null);
  assert.ok(await sessionInList(s.id));
  board.run("UPDATE sessions SET kind = 'task' WHERE id = ?", s.id);
  await assert.rejects(call('sessions.trash', { id: s.id }, phone), /tarea/);
  board.run("UPDATE sessions SET kind = 'chat' WHERE id = ?", s.id);
});

test('a session with total permission cannot be trashed or restored from the phone', () => {
  const at = new Date().toISOString();
  board.run("INSERT INTO sessions (id, kind, agent, title, status, permission, cwd, created_at, updated_at) VALUES ('s-total', 'chat', 'claude', 'T', 'idle', 'total', '', ?, ?)", at, at);
  assert.notEqual(guardCall(board, 'sessions.trash', { id: 's-total' }), null);
  assert.notEqual(guardCall(board, 'sessions.restore', { id: 's-total' }), null);
  assert.equal(guardCall(board, 'sessions.trash', { id: 'nope' }), null);
});

test('purge after the term removes only that chat; the others and the finished tasks stay', async () => {
  const gone = newConversation('Caducada', 'adiós');
  const fresh = newConversation('Reciente', 'sigo');
  const other = newConversation('Normal', 'normal');
  const done = board.createTask({ project: 'tienda', title: 'Hecha', description: 'd' }, 'usuario');
  board.run("UPDATE tasks SET conversation_id = ?, status = 'done' WHERE id = ?", gone.id, done.id);
  const s = await call('sessions.create', { agent: 'claude', title: 'Vieja' }, phone);
  addItem(s.id, 'x');
  const keepSession = await call('sessions.create', { agent: 'claude', title: 'Otra' }, phone);
  addItem(keepSession.id, 'y');
  await call('conversations.trash', { id: gone.id }, phone); await call('conversations.trash', { id: fresh.id }, phone); await call('sessions.trash', { id: s.id }, phone);
  const old = new Date(Date.now() - (TRASH_DAYS + 1) * DAY).toISOString();
  board.run('UPDATE conversations SET trashed_at = ? WHERE id = ?', old, gone.id);
  board.run('UPDATE sessions SET trashed_at = ? WHERE id = ?', old, s.id);
  // restoring after the term is refused even before the purge ran
  await assert.rejects(call('conversations.restore', { id: gone.id }, phone), /ya no existe/);
  assert.equal(api.purgeTrash(), 2);
  assert.equal(board.conversation(gone.id), null);
  assert.equal(lines(gone.id), 0);
  assert.ok(!sessions.get(s.id));
  assert.equal(board.all('SELECT id FROM session_items WHERE session_id = ?', s.id).length, 0);
  const task = board.one('SELECT conversation_id AS c, status FROM tasks WHERE id = ?', done.id);
  assert.equal(task.c, null, 'the finished task stays, in Tareas'); assert.equal(task.status, 'done');
  assert.equal(lines(other.id), 2); assert.equal(lines(fresh.id), 2);
  assert.ok(board.conversation(fresh.id).trashed_at, 'a recent one waits');
  assert.equal(board.all('SELECT id FROM session_items WHERE session_id = ?', keepSession.id).length, 1);
  await assert.rejects(call('conversations.restore', { id: gone.id }, phone), /ya no existe/);
  await assert.rejects(call('sessions.restore', { id: s.id }, phone), /ya no existe/);
});

test('a running session trashed long ago is left for the next purge', async () => {
  const s = await call('sessions.create', { agent: 'claude', title: 'Corre' }, phone);
  await call('sessions.trash', { id: s.id }, phone);
  board.run('UPDATE sessions SET trashed_at = ? WHERE id = ?', new Date(Date.now() - 9 * DAY).toISOString(), s.id);
  sessions.running.set(s.id, { stopped: false });
  assert.doesNotThrow(() => api.purgeTrash());
  assert.ok(sessions.get(s.id), 'still there');
  sessions.running.delete(s.id);
  api.purgeTrash();
  assert.ok(!sessions.get(s.id));
});

test('remove from the PC still works, also on something in the trash', async () => {
  const c = newConversation('Directo', 'x');
  await call('conversations.trash', { id: c.id }, phone);
  assert.deepEqual(await call('conversations.remove', { id: c.id }), { ok: true });
  assert.equal(board.conversation(c.id), null);
  const s = await call('sessions.create', { agent: 'claude', title: 'S' }, phone);
  await call('sessions.trash', { id: s.id }, phone);
  await call('sessions.remove', { id: s.id });
  assert.ok(!sessions.get(s.id));
  await assert.rejects(call('conversations.remove', { id: 1 }, phone));
});

test('migration adds trashed_at to an old database without losing rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-trash-mig-'));
  try {
    const file = path.join(dir, 'orb.db');
    let db = openDb(file);
    db.exec('ALTER TABLE conversations DROP COLUMN trashed_at; ALTER TABLE sessions DROP COLUMN trashed_at;');
    db.exec("INSERT INTO conversations (title, titled, agent, reasoning, created_at, updated_at) VALUES ('vieja', 1, 'claude', 'medium', 'a', 'a')");
    db.close();
    db = openDb(file);
    for (const table of ['conversations', 'sessions']) assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'trashed_at'), table);
    assert.equal(db.prepare("SELECT trashed_at FROM conversations WHERE title = 'vieja'").get().trashed_at, null);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
