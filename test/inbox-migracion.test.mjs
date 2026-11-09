// 3.6: inbox_items took only bots, groups and conversations at first; the direct conversations with an agent («session»)
// came later. A database made in between gets its table rebuilt once with the wider check, keeping every row.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempHome } from './helpers.mjs';
import { openDb } from '../src/core/db.mjs';

const home = tempHome();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-inbox-mig-'));
after(() => { home.cleanup(); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp folder */ } });

const OLD = `CREATE TABLE inbox_items (
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bot', 'group', 'conversation')),
  item_id TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_order INTEGER,
  section_id INTEGER,
  muted INTEGER NOT NULL DEFAULT 0,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, kind, item_id)
)`;
const tableSql = (db) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inbox_items'").get()?.sql ?? '';
const rows = (db) => db.prepare('SELECT * FROM inbox_items ORDER BY kind, item_id').all().map((r) => ({ ...r }));

test('inbox_items de antes de los chats directos: se rehace una vez, con las mismas filas, y acepta «session»', () => {
  const file = path.join(dir, 'orb.db');
  // A database of the current Orb, then its inbox_items put back as the first 3.6 builds made it, with marks in it.
  let db = openDb(file);
  db.exec(`DROP TABLE inbox_items; ${OLD};
    INSERT INTO inbox_items (person_id, kind, item_id, pinned, pin_order, section_id, muted, last_read) VALUES
      ('p1', 'bot', '1', 1, 2, NULL, 0, 7), ('p1', 'group', '3', 0, NULL, 4, 1, 0), ('p1', 'conversation', '9', 1, 1, NULL, 1, 12);`);
  assert.throws(() => db.prepare("INSERT INTO inbox_items (person_id, kind, item_id) VALUES ('p1', 'session', 's1')").run(), /CHECK/, 'la tabla vieja no acepta chats directos');
  const before = rows(db);
  db.close();

  // Opened again: rebuilt with the wider check, same rows, no table left behind.
  db = openDb(file);
  assert.match(tableSql(db), /'session'/);
  // 3.8.2: the rebuilt table also gets the snooze column, empty.
  assert.deepEqual(rows(db).map(({ snoozed_until: snoozed, ...r }) => (assert.equal(snoozed, null), r)), before, 'las marcas de antes se quedan');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'inbox_items_old'").get().n, 0, 'sin la tabla vieja');
  db.prepare("INSERT INTO inbox_items (person_id, kind, item_id, pinned) VALUES ('p1', 'session', 's1', 1)").run();
  assert.throws(() => db.prepare("INSERT INTO inbox_items (person_id, kind, item_id) VALUES ('p1', 'otra', 'x')").run(), /CHECK/, 'el resto de tipos sigue sin entrar');
  const sql = tableSql(db);
  db.close();

  // Once: a later start leaves the table (and the new mark) as it is.
  db = openDb(file);
  assert.equal(tableSql(db), sql);
  assert.equal(rows(db).length, 4);
  assert.equal(db.prepare("SELECT pinned FROM inbox_items WHERE kind = 'session' AND item_id = 's1'").get().pinned, 1);
  db.close();
});
