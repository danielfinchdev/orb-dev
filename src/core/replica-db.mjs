// 3.7 (Orb Server, WS3): the database side of «one home per bot, a live replica elsewhere» (docs/BOTS.md › «One home per bot»).
// - Every bot, group, reminder, chat line of a bot or a group, memory change and card request has a uid: the same row is
//   the same on every Orb (the local integer ids and the bots/<id>/ folders stay as they are).
// - bots.home is the identity of the Orb that runs the bot (orbId of src/core/backup.mjs › orbIdOf, kept in settings
//   «orb_self» so SQL can compare with it); a replica row has another Orb's id there and is never run here.
// - bot_changes: what changed in a bot this Orb runs (appended by triggers, so the MCP processes' writes count too); a
//   replica asks for the changes after the last one it has (replica_cursor) and applies them by uid (idempotent).
// - link_persons: who a person of a linked Orb is here (WS2 builds the flow; src/core/link-persons.mjs reads it).
// No engine imports: db.mjs runs this in every process that opens the database.
import crypto from 'node:crypto';
import path from 'node:path';
import { ctx } from './context.mjs';
import { orbIdOf } from './backup.mjs';

export const HOME_SCHEMA = `
CREATE TABLE IF NOT EXISTS bot_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_uid TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_changes_bot ON bot_changes (bot_uid, seq);
CREATE TABLE IF NOT EXISTS replica_cursor (
  peer TEXT NOT NULL,
  bot_uid TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  files TEXT,
  at TEXT,
  PRIMARY KEY (peer, bot_uid)
);
CREATE TABLE IF NOT EXISTS link_persons (
  peer TEXT NOT NULL,
  local_person TEXT NOT NULL,
  remote_person TEXT NOT NULL,
  confirmed_at TEXT,
  PRIMARY KEY (peer, local_person)
);
CREATE TABLE IF NOT EXISTS bot_moves (
  id TEXT PRIMARY KEY,
  bot_uid TEXT NOT NULL,
  from_home TEXT,
  to_home TEXT NOT NULL,
  phase TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_moves_bot ON bot_moves (bot_uid, started_at);
`;

// A random uid in the form of a UUID, made by SQLite itself (one per row in an UPDATE).
export const SQL_UUID = "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))";
const SELF = "(SELECT value FROM settings WHERE key = 'orb_self')";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// The bot (or group) of a conversation, when this Orb runs it.
const homeOfConv = (conv) => `SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id
  WHERE c.id = ${conv} AND COALESCE(b.uid, g.uid) IS NOT NULL AND (COALESCE(b.home, g.home) IS NULL OR COALESCE(b.home, g.home) = ${SELF})`;
const botHere = (id) => `SELECT uid FROM bots WHERE id = ${id} AND uid IS NOT NULL AND (home IS NULL OR home = ${SELF})`;
// memory_log.scope: 'bot:<id>' or 'bot:<id>:<person>' (global:<person> belongs to no bot).
const scopeBot = (scope) => `CASE WHEN ${scope} LIKE 'bot:%' THEN CAST(substr(${scope}, 5) AS INTEGER) END`;

const TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS home_bots_ins AFTER INSERT ON bots BEGIN
  UPDATE bots SET uid = COALESCE(uid, ${SQL_UUID}), home = COALESCE(home, ${SELF}) WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS home_bots_upd AFTER UPDATE ON bots WHEN NEW.uid IS NOT NULL AND (NEW.home IS NULL OR NEW.home = ${SELF}) BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (NEW.uid, 'bot', NEW.uid, ${NOW});
END;
CREATE TRIGGER IF NOT EXISTS home_bots_del BEFORE DELETE ON bots WHEN OLD.uid IS NOT NULL AND (OLD.home IS NULL OR OLD.home = ${SELF}) BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (OLD.uid, 'delete', OLD.uid, ${NOW});
END;
CREATE TRIGGER IF NOT EXISTS home_groups_ins AFTER INSERT ON bot_groups BEGIN
  UPDATE bot_groups SET uid = COALESCE(uid, ${SQL_UUID}), home = COALESCE(home, ${SELF}) WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS home_groups_upd AFTER UPDATE ON bot_groups WHEN NEW.uid IS NOT NULL AND (NEW.home IS NULL OR NEW.home = ${SELF}) BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (NEW.uid, 'group', NEW.uid, ${NOW});
END;
CREATE TRIGGER IF NOT EXISTS home_chat_ins AFTER INSERT ON chat WHEN NEW.conversation_id IS NOT NULL BEGIN
  UPDATE chat SET uid = ${SQL_UUID} WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${homeOfConv('NEW.conversation_id')}), 'chat', (SELECT uid FROM chat WHERE id = NEW.id), ${NOW}
    WHERE (${homeOfConv('NEW.conversation_id')}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_chat_upd AFTER UPDATE OF body, meta ON chat WHEN NEW.conversation_id IS NOT NULL AND NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${homeOfConv('NEW.conversation_id')}), 'chat', NEW.uid, ${NOW}
    WHERE (${homeOfConv('NEW.conversation_id')}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_rem_ins AFTER INSERT ON bot_reminders BEGIN
  UPDATE bot_reminders SET uid = ${SQL_UUID} WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${botHere('NEW.bot_id')}), 'reminder', (SELECT uid FROM bot_reminders WHERE id = NEW.id), ${NOW}
    WHERE (${botHere('NEW.bot_id')}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_rem_upd AFTER UPDATE OF text, every, start_at, weekdays, next_run, last_run, enabled, tz, local_at, skip_missed ON bot_reminders WHEN NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${botHere('NEW.bot_id')}), 'reminder', NEW.uid, ${NOW}
    WHERE (${botHere('NEW.bot_id')}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_memlog_ins AFTER INSERT ON memory_log BEGIN
  UPDATE memory_log SET uid = ${SQL_UUID} WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${botHere(scopeBot('NEW.scope'))}), 'memlog', (SELECT uid FROM memory_log WHERE id = NEW.id), ${NOW}
    WHERE (${botHere(scopeBot('NEW.scope'))}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_memlog_upd AFTER UPDATE OF status, text, before ON memory_log WHEN NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${botHere(scopeBot('NEW.scope'))}), 'memlog', NEW.uid, ${NOW}
    WHERE (${botHere(scopeBot('NEW.scope'))}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_req_ins AFTER INSERT ON bot_requests BEGIN
  UPDATE bot_requests SET uid = ${SQL_UUID} WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${botHere('NEW.bot_id')}), 'request', (SELECT uid FROM bot_requests WHERE id = NEW.id), ${NOW}
    WHERE (${botHere('NEW.bot_id')}) IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS home_req_upd AFTER UPDATE OF status, result, answered_by ON bot_requests WHEN NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (${botHere('NEW.bot_id')}), 'request', NEW.uid, ${NOW}
    WHERE (${botHere('NEW.bot_id')}) IS NOT NULL;
END;
CREATE UNIQUE INDEX IF NOT EXISTS bots_uid ON bots (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bot_groups_uid ON bot_groups (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_uid ON chat (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bot_reminders_uid ON bot_reminders (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS memory_log_uid ON memory_log (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bot_requests_uid ON bot_requests (uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS bots_home ON bots (home, home_state);
`;

// A UUIDv7 (time first, so ids made later sort later): the bots' uid.
export function uuidv7(at = Date.now()) {
  const b = crypto.randomBytes(16);
  let t = BigInt(Math.max(0, Math.floor(Number(at) || Date.now())));
  for (let i = 5; i >= 0; i--) { b[i] = Number(t & 0xffn); t >>= 8n; }
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const isUid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

// This Orb's identity for a database: the one of its home folder (main database), else what the database remembers.
function selfFor(db, file) {
  const main = Boolean(file && file !== ':memory:' && ctx.paths?.db && path.resolve(file) === path.resolve(ctx.paths.db));
  if (main || (file === ':memory:' && ctx.home)) { try { return orbIdOf(ctx.home).orbId; } catch { /* no folder */ } }
  try { return db.prepare("SELECT value FROM settings WHERE key = 'orb_self'").get()?.value ?? null; } catch { return null; }
}

// Idempotent, inside one write lock (the engine and the MCP servers open the database at the same time).
export function migrateHome(db, { file = null } = {}) {
  db.exec(HOME_SCHEMA);
  const self = selfFor(db, file);
  const get = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
  const needs = () => (self && get('orb_self') !== self) || !get('home_migrated') || (self && db.prepare('SELECT 1 FROM bots WHERE home IS NULL LIMIT 1').get());
  if (needs()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const before = get('orb_self');
      if (self && before !== self) {
        // This folder became another Orb («Mantener los dos» of a move gives it a new identity): the bots it ran are
        // still run here, under the new identity.
        if (before) { db.prepare('UPDATE bots SET home = ? WHERE home = ?').run(self, before); db.prepare('UPDATE bot_groups SET home = ? WHERE home = ?').run(self, before); }
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('orb_self', ?)").run(self);
      }
      if (!get('home_migrated')) {
        // 3.6 → 3.7: every bot gets its uid (from its creation time), and every row a replica copies its own.
        for (const r of db.prepare('SELECT id, created_at FROM bots WHERE uid IS NULL').all()) db.prepare('UPDATE bots SET uid = ? WHERE id = ?').run(uuidv7(Date.parse(r.created_at) || Date.now()), r.id);
        db.exec(`UPDATE bot_groups SET uid = ${SQL_UUID} WHERE uid IS NULL;
          UPDATE bot_reminders SET uid = ${SQL_UUID} WHERE uid IS NULL;
          UPDATE bot_requests SET uid = ${SQL_UUID} WHERE uid IS NULL;
          UPDATE memory_log SET uid = ${SQL_UUID} WHERE uid IS NULL;
          UPDATE chat SET uid = ${SQL_UUID} WHERE uid IS NULL AND conversation_id IN (SELECT id FROM conversations WHERE bot_id IS NOT NULL OR group_id IS NOT NULL);`);
        // The rows that already exist go into the change log once, so a copy made on another Orb gets the whole history.
        db.exec(`INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT b.uid, 'chat', c.uid, c.at FROM chat c JOIN conversations v ON v.id = c.conversation_id JOIN bots b ON b.id = v.bot_id WHERE v.group_id IS NULL AND c.uid IS NOT NULL ORDER BY c.id;
          INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT g.uid, 'chat', c.uid, c.at FROM chat c JOIN conversations v ON v.id = c.conversation_id JOIN bot_groups g ON g.id = v.group_id WHERE c.uid IS NOT NULL ORDER BY c.id;
          INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT b.uid, 'reminder', r.uid, r.created_at FROM bot_reminders r JOIN bots b ON b.id = r.bot_id;
          INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT b.uid, 'request', r.uid, r.created_at FROM bot_requests r JOIN bots b ON b.id = r.bot_id;
          INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT b.uid, 'memlog', m.uid, m.at FROM memory_log m JOIN bots b ON m.scope = 'bot:' || b.id OR m.scope LIKE 'bot:' || b.id || ':%';`);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('home_migrated', '1')").run();
      }
      // A bot made before (or while this Orb did not know its identity) runs here.
      if (self) { db.prepare('UPDATE bots SET home = ? WHERE home IS NULL').run(self); db.prepare('UPDATE bot_groups SET home = ? WHERE home IS NULL').run(self); }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec(TRIGGERS);
}
