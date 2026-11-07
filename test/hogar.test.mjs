// 3.7 (WS3): one home per bot. The 3.6 database migrates: each bot gets its uid, this Orb is its home and its history
// enters the change log. (3.8: Orbs no longer link with each other; the copies on other Orbs are gone.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { paths } from '../src/core/home.mjs';
import { orbIdOf } from '../src/core/backup.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const tmp = [];
const db = (home, fn) => { const d = new DatabaseSync(paths(home).db); d.exec('PRAGMA busy_timeout = 8000'); try { return fn(d); } finally { d.close(); } };
after(() => { for (const t of tmp) t.cleanup(); });

test('migración de 3.6: cada bot recibe su uid, este Orb es su casa y su historia entra en el registro', async () => {
  const t = tempHome(); tmp.push(t);
  const { Board } = await import('../src/core/board.mjs');
  const B = await import('../src/core/bots.mjs');
  let board = new Board();
  const b = B.createBot(board, { name: 'Antiguo' });
  board.addChat('usuario', 'hola de 3.6', null, B.botConversation(board, b));
  B.createReminder(board, { bot_id: b.id, text: 'Regar', when: '2099-01-01T10:00' });
  board.db.close();
  // As a 3.6 database: no uid, no home, no change log, no triggers.
  db(t.home, (d) => {
    for (const r of d.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) d.exec(`DROP TRIGGER ${r.name}`);
    for (const i of ['bots_uid', 'bots_home', 'chat_uid', 'bot_reminders_uid', 'memory_log_uid', 'bot_requests_uid', 'bot_groups_uid']) d.exec(`DROP INDEX IF EXISTS ${i}`);
    for (const [tb, c] of [['bots', 'uid'], ['bots', 'home'], ['bots', 'home_epoch'], ['bots', 'home_state'], ['bots', 'home_fork'], ['bots', 'needs'], ['chat', 'uid'], ['bot_reminders', 'uid'], ['memory_log', 'uid'], ['bot_requests', 'uid'], ['bot_groups', 'uid'], ['bot_groups', 'home'], ['bot_groups', 'home_epoch']]) d.exec(`ALTER TABLE ${tb} DROP COLUMN ${c}`);
    d.exec("DROP TABLE bot_changes; DROP TABLE replica_cursor; DELETE FROM settings WHERE key IN ('home_migrated', 'orb_self')");
  });
  board = new Board();
  const row = board.one('SELECT * FROM bots WHERE id = ?', b.id);
  assert.match(row.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'uid UUIDv7');
  assert.equal(row.home, orbIdOf(t.home).orbId, 'su casa es este Orb (su identidad, nunca «self»)');
  assert.equal(row.home_epoch, 0); assert.equal(row.home_state, 'active');
  assert.ok(board.one("SELECT uid FROM chat WHERE body = 'hola de 3.6'").uid, 'la línea tiene uid');
  assert.ok(board.one('SELECT uid FROM bot_reminders WHERE bot_id = ?', b.id).uid);
  const kinds = board.all('SELECT kind FROM bot_changes WHERE bot_uid = ?', row.uid).map((r) => r.kind);
  assert.ok(kinds.includes('chat') && kinds.includes('reminder'), 'la historia entra en el registro de cambios');
  const R = await import('../src/core/replica.mjs');
  assert.equal(R.isHomeHere(board, row), true);
  // A single Orb behaves as 3.6: the reminder is there to ring.
  board.run('UPDATE bot_reminders SET next_run = ? WHERE bot_id = ?', new Date(Date.now() - 1000).toISOString(), b.id);
  assert.equal(B.takeDueReminders(board).length, 1);
  board.db.close();
});

