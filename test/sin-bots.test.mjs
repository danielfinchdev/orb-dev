// 3.8: Orb has no bots. A new database gets none of the replicas' tables or triggers; a 3.7 database, with its home_*
// triggers still on chat, keeps working (the bots' tables stay until the 3.8 migration drops them).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { openDb } from '../src/core/db.mjs';
import { Board } from '../src/core/board.mjs';
import { POLICY, EVENTS } from '../src/core/policy.mjs';

const t = tempHome();
after(() => t.cleanup());

test('una base nueva: sin tablas ni disparadores de las réplicas, y sin métodos ni eventos de bots', () => {
  const board = new Board();
  const names = (type) => board.all('SELECT name FROM sqlite_master WHERE type = ?', type).map((r) => r.name);
  assert.deepEqual(names('trigger'), []);
  for (const gone of ['bot_changes', 'replica_cursor', 'bot_moves', 'link_persons']) assert.ok(!names('table').includes(gone), gone);
  const c = board.createConversation({ title: 'Hola' });
  board.addChat('usuario', 'una línea', null, c.id);
  assert.equal(board.chat(c.id).length, 1);
  assert.deepEqual(Object.keys(POLICY).filter((m) => /^(bots|replica|templates|centro)\./.test(m)), []);
  assert.deepEqual(Object.keys(EVENTS).filter((e) => /^(bot\.|bots\.|link:queue)/.test(e)), []);
});

test('una base de 3.7 con los disparadores de las réplicas sigue funcionando', () => {
  const file = path.join(t.base, 'orb-3.7.db');
  const db = openDb(file);
  // What 3.7's src/core/replica-db.mjs left: the uid columns, the change log and a trigger on chat.
  for (const sql of ['ALTER TABLE bots ADD COLUMN uid TEXT', 'ALTER TABLE bots ADD COLUMN home TEXT', 'ALTER TABLE bot_groups ADD COLUMN uid TEXT', 'ALTER TABLE bot_groups ADD COLUMN home TEXT', 'ALTER TABLE chat ADD COLUMN uid TEXT']) db.exec(sql);
  db.exec(`CREATE TABLE bot_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, bot_uid TEXT NOT NULL, kind TEXT NOT NULL, ref_uid TEXT, at TEXT NOT NULL);
    CREATE TRIGGER home_chat_ins AFTER INSERT ON chat WHEN NEW.conversation_id IS NOT NULL BEGIN
      UPDATE chat SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id AND uid IS NULL;
      INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id WHERE c.id = NEW.conversation_id AND COALESCE(b.uid, g.uid) IS NOT NULL), 'chat', (SELECT uid FROM chat WHERE id = NEW.id), 'now'
        WHERE (SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id WHERE c.id = NEW.conversation_id) IS NOT NULL;
    END;
    INSERT INTO bots (name, created_at, updated_at, uid) VALUES ('Casa', 'now', 'now', 'u-casa');
    INSERT INTO conversations (title, titled, created_at, updated_at, bot_id) VALUES ('Casa', 1, 'now', 'now', 1);`);
  db.close();
  // Opened again by 3.8: the trigger is left alone (the 3.8 migration drops it) and chat keeps taking lines.
  const board = new Board(openDb(file));
  try {
    assert.equal(board.one("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'home_chat_ins'").n, 1);
    const c = board.createConversation({ title: 'De Orb' });
    board.addChat('usuario', 'hola', null, c.id);
    board.addChat('orb', 'hola, Ana', null, c.id);
    assert.deepEqual(board.chat(c.id).map((l) => l.body), ['hola', 'hola, Ana']);
    board.addChat('usuario', 'al bot', null, 1);
    assert.equal(board.one('SELECT COUNT(*) AS n FROM bot_changes').n, 1, 'el disparador viejo sigue escribiendo donde escribía');
  } finally { board.db.close(); }
});
