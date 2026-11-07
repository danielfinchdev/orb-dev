// 3.6 «Personas» (WS1): una base de datos de la 3.5.1 pasa a la 3.6 una vez, con copia previa, y todo es del dueño.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, ROOT } from './helpers.mjs';
import { ctx, useHome } from '../src/core/context.mjs';
import { openDb, PERSON_TABLES } from '../src/core/db.mjs';
import { Board } from '../src/core/board.mjs';
import { buildApi } from '../src/engine/api.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const home = tempHome();
after(() => home.cleanup());

// A database as Orb 3.5.1 left it (its exact schema), with a bit of everything.
function oldDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'esquema-3.5.1.sql'), 'utf8'));
  const at = '2026-10-01T08:00:00.000Z';
  db.exec(`INSERT INTO settings (key, value) VALUES ('conversations_migrated', '1'), ('notices_migrated', '1'), ('active_project', 'web');
    INSERT INTO projects (name, path, created_at) VALUES ('web', '${home.home.replace(/\\/g, '/')}/web', '${at}');
    INSERT INTO conversations (title, titled, project, created_at, updated_at) VALUES ('Plan de la web', 1, 'web', '${at}', '${at}');
    INSERT INTO chat (role, body, at, conversation_id) VALUES ('usuario', 'hola', '${at}', 1), ('orb', 'hola, Ana', '${at}', 1);
    INSERT INTO tasks (project, title, description, status, created_by, created_at, updated_at, conversation_id) VALUES ('web', 'Portada', 'hazla', 'done', 'orb', '${at}', '${at}', 1);
    INSERT INTO events (task_id, actor, kind, detail, at) VALUES (1, 'orb', 'task.created', 'queued', '${at}');
    INSERT INTO sessions (id, kind, agent, cwd, title, created_at, updated_at) VALUES ('s1', 'chat', 'claude', '/x', 'Charla', '${at}', '${at}');
    INSERT INTO schedules (project, title, description, every, created_at) VALUES ('web', 'Revisar', 'deps', 'daily', '${at}');
    INSERT INTO bots (name, session_id, turns, created_at, updated_at) VALUES ('Casa', 'sesion-casa', 3, '${at}', '${at}'), ('Nuevo', NULL, 0, '${at}', '${at}');
    INSERT INTO bot_groups (name, created_at, updated_at) VALUES ('Todos', '${at}', '${at}');
    INSERT INTO bot_reminders (bot_id, text, every, start_at, next_run, created_at) VALUES (1, 'Regar', 'daily', '2026-10-02T07:30:00.000Z', '2026-10-02T07:30:00.000Z', '${at}');
    INSERT INTO bot_requests (bot_id, kind, created_at, updated_at) VALUES (1, 'ha', '${at}', '${at}');
    INSERT INTO link_queue (method, created_at) VALUES ('tasks.list', '${at}');
    INSERT INTO devices (id, name, token_hash, created_at, kind, kind_ok) VALUES ('d1', 'Móvil', 'h1', '${at}', 'phone', 1);`);
  db.close();
}

test('una base de la 3.5.1: copia previa, el dueño en todas las filas, sesiones de los bots y recordatorios', () => {
  const file = ctx.paths.db;
  // The engine of this test home has not opened its database yet: replace it by an old one.
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  oldDatabase(file);
  const botsDir = path.join(home.home, 'bots');
  fs.mkdirSync(botsDir, { recursive: true });
  fs.writeFileSync(path.join(botsDir, 'memoria-global.md'), 'Ana prefiere el té.\n');
  useHome(home.home);
  const board = new Board(openDb());
  const owner = board.ownerId();
  assert.ok(owner);

  // The copy is the 3.5.1 database as it was (no table of 3.6 in it).
  const pre = path.join(ctx.paths.data, 'orb-pre-3.6.db');
  assert.ok(fs.existsSync(pre), 'copia previa');
  const copy = new DatabaseSync(pre, { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'persons'").get().n, 0);
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM chat').get().n, 2);
  copy.close();

  const people = board.all('SELECT * FROM persons');
  assert.equal(people.length, 1);
  assert.deepEqual([people[0].role, people[0].name], ['owner', 'Ana'], 'con el nombre de los ajustes');
  for (const t of PERSON_TABLES) {
    const rows = board.all(`SELECT person_id FROM ${t}`);
    assert.ok(rows.length > 0, `${t} tiene filas`);
    assert.ok(rows.every((r) => r.person_id === owner), `${t}: todo del dueño`);
  }
  assert.deepEqual({ ...board.one('SELECT * FROM bot_sessions') }, { bot_id: 1, person_id: owner, session_id: 'sesion-casa', turns: 3 }, 'la conversación viva del bot sigue, ahora del dueño');
  const rem = board.one('SELECT tz, local_at FROM bot_reminders WHERE id = 1');
  assert.equal(rem.tz, people[0].tz);
  assert.match(rem.local_at, /^2026-10-02T\d\d:30$/);
  assert.equal(board.one('SELECT session_id FROM bots WHERE id = 1').session_id, 'sesion-casa', 'lo de antes no se toca');
  // 3.8: the bots' files stay where they were (the 3.8 migration archives them).
  assert.equal(fs.readFileSync(path.join(botsDir, 'memoria-global.md'), 'utf8'), 'Ana prefiere el té.\n');
  // Settings: accounts and connectors are the owner's.
  const config = JSON.parse(fs.readFileSync(ctx.paths.config, 'utf8'));
  assert.ok(config.accounts.length && config.accounts.every((a) => a.person === owner));
  assert.ok(ctx.config.accounts.every((a) => a.person === owner));
  assert.equal(board.setting('persons_migrated'), '1');
  assert.equal(board.setting('active_project'), 'web', 'los ajustes de antes siguen donde estaban');
  assert.equal(board.personSetting(owner, 'active_project'), 'web');
});

test('la migración se hace una vez: abrir otra vez no cambia nada ni rehace la copia', () => {
  const pre = path.join(ctx.paths.data, 'orb-pre-3.6.db');
  const before = fs.statSync(pre).mtimeMs;
  const a = new Board(openDb()); const b = new Board(openDb());
  assert.equal(a.ownerId(), b.ownerId());
  assert.equal(a.one('SELECT COUNT(*) AS n FROM persons').n, 1);
  assert.equal(a.one('SELECT COUNT(*) AS n FROM bot_sessions').n, 1);
  assert.equal(fs.statSync(pre).mtimeMs, before);
});

test('con una sola persona, la API responde como en la 3.5.1', async () => {
  const board = new Board(openDb());
  const api = buildApi({ board, sessions: {}, orchestrator: { states: () => [] }, scheduler: {}, emit: () => {}, log: () => {}, version: 'test' });
  const list = await api.call('conversations.list', {}, api.desktopPrincipal());
  assert.deepEqual(list.map((c) => c.title), ['Plan de la web']);
  const lines = await api.call('chat.list', { conversation: 1 }, api.desktopPrincipal());
  assert.deepEqual(lines.map((l) => l.body), ['hola', 'hola, Ana']);
  // Without a principal (a call from inside the engine) and from the owner's phone, too.
  assert.equal((await api.call('chat.list', { conversation: 1 })).length, 2);
  const { principalOf } = await import('../src/core/authz.mjs');
  const phone = principalOf(board, { device: board.one("SELECT * FROM devices WHERE id = 'd1'") });
  assert.equal(phone.person, board.ownerId());
  assert.equal((await api.call('chat.list', { conversation: 1 }, phone)).length, 2);
  await assert.rejects(api.call('config.save', { patch: {} }, phone), /solo se puede hacer desde el PC/, 'el techo del móvil, como antes');
  await assert.rejects(api.call('chat.list', { conversation: 99 }, api.desktopPrincipal()), /conversación/i, 'lo que no existe lo dice el método, como antes');
});
