-- The schema of an Orb 3.7 database (dumped from openDb at ab70dbd, with the replicas' home_* triggers), for test/migracion-38.test.mjs.
CREATE TABLE projects (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  path TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
, grupo TEXT, person_id TEXT);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'any',
  model TEXT,
  reasoning TEXT CHECK (reasoning IN ('low', 'medium', 'high', 'xhigh')),
  fast INTEGER CHECK (fast IN (0, 1)),
  launch TEXT NOT NULL DEFAULT 'auto',
  priority INTEGER NOT NULL DEFAULT 2,
  depends_on TEXT NOT NULL DEFAULT '[]',
  sensitivity TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  approved_by TEXT,
  approval_hash TEXT,
  approval_sig TEXT,
  created_by TEXT NOT NULL,
  assigned_to TEXT,
  branch TEXT,
  workdir TEXT,
  project_path TEXT,
  mode TEXT NOT NULL DEFAULT 'carpeta',
  readonly INTEGER NOT NULL DEFAULT 0,
  pid INTEGER,
  session_id TEXT,
  account TEXT,
  run_account TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, parent_id INTEGER, limited_until TEXT, review_of INTEGER, schedule_id INTEGER, level TEXT, conversation_id INTEGER, person_id TEXT);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT DEFAULT '',
  at TEXT NOT NULL
, person_id TEXT);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  task_id INTEGER,
  body TEXT NOT NULL,
  at TEXT NOT NULL
, person_id TEXT);
CREATE TABLE message_reads (
  message_id INTEGER NOT NULL,
  agent TEXT NOT NULL,
  PRIMARY KEY (message_id, agent)
);
CREATE TABLE chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  meta TEXT,
  at TEXT NOT NULL
, conversation_id INTEGER, person_id TEXT, uid TEXT);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'task')),
  agent TEXT NOT NULL,
  model TEXT,
  reasoning TEXT,
  permission TEXT NOT NULL DEFAULT 'editar',
  project TEXT,
  cwd TEXT NOT NULL,
  task_id INTEGER,
  account TEXT,
  title TEXT NOT NULL,
  cli_session TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, titled INTEGER NOT NULL DEFAULT 0, context TEXT, settled INTEGER NOT NULL DEFAULT 0, parent_id TEXT, person_id TEXT);
CREATE TABLE session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT
, public_key TEXT, route TEXT, push TEXT, kind TEXT, role TEXT, ip TEXT, meta TEXT, admin INTEGER NOT NULL DEFAULT 0, kind_ok INTEGER, approve INTEGER NOT NULL DEFAULT 1, dev_ok INTEGER NOT NULL DEFAULT 0, person_id TEXT);
CREATE TABLE link_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  from_device TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  result TEXT,
  done_at TEXT
, person_id TEXT, request_id TEXT);
CREATE TABLE session_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'any',
  model TEXT,
  readonly INTEGER NOT NULL DEFAULT 0,
  every TEXT NOT NULL,
  at_time TEXT,
  weekdays TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  approved INTEGER NOT NULL DEFAULT 0,
  next_run TEXT,
  last_run TEXT,
  last_task INTEGER,
  created_at TEXT NOT NULL
, person_id TEXT);
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  titled INTEGER NOT NULL DEFAULT 0,
  project TEXT,
  agent TEXT NOT NULL DEFAULT 'claude',
  account TEXT,
  model TEXT,
  reasoning TEXT NOT NULL DEFAULT 'medium',
  session_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, bot_id INTEGER, group_id INTEGER, person_id TEXT);
CREATE TABLE bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  role_text TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT 'claude',
  model TEXT,
  effort TEXT NOT NULL DEFAULT 'medium',
  tools TEXT NOT NULL DEFAULT '[]',
  accounts TEXT NOT NULL DEFAULT '{}',
  exclusive TEXT NOT NULL DEFAULT '[]',
  is_chief INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, person_id TEXT, caps TEXT, avatar TEXT, uid TEXT, home TEXT, home_epoch INTEGER NOT NULL DEFAULT 0, home_state TEXT NOT NULL DEFAULT 'active', home_fork TEXT, needs TEXT);
CREATE TABLE bot_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, person_id TEXT, uid TEXT, home TEXT, home_epoch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE bot_group_members (
  group_id INTEGER NOT NULL,
  bot_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, bot_id)
);
CREATE TABLE bot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, decided_by TEXT, person_id TEXT, approvers TEXT, answered_by TEXT, uid TEXT);
CREATE TABLE bot_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  every TEXT NOT NULL DEFAULT 'once',
  start_at TEXT NOT NULL,
  weekdays TEXT NOT NULL DEFAULT '[]',
  next_run TEXT,
  last_run TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT 'usuario',
  created_at TEXT NOT NULL
, person_id TEXT, tz TEXT, local_at TEXT, skip_missed INTEGER NOT NULL DEFAULT 0, fired_late_ms INTEGER, uid TEXT);
CREATE TABLE persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'user')),
  language TEXT,
  tz TEXT,
  pin_hash TEXT,
  pin_salt TEXT,
  pin_fails INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TEXT,
  caps TEXT NOT NULL DEFAULT '{}',
  color TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE person_settings (
  person_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (person_id, key)
);
CREATE TABLE shares (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('bot', 'group', 'project', 'integration')),
  resource_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  right TEXT NOT NULL CHECK (right IN ('view', 'talk', 'edit')),
  granted_by TEXT,
  created_at TEXT,
  PRIMARY KEY (resource_type, resource_id, person_id)
);
CREATE TABLE account_loans (
  account_id TEXT NOT NULL,
  lender TEXT NOT NULL,
  person_id TEXT NOT NULL,
  daily_turns INTEGER,
  daily_tokens INTEGER,
  daily_usd REAL,
  reserve_pct INTEGER NOT NULL DEFAULT 20,
  bots INTEGER NOT NULL DEFAULT 1,
  dev INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT,
  PRIMARY KEY (account_id, person_id)
);
CREATE TABLE usage_ledger (
  id INTEGER PRIMARY KEY,
  at TEXT,
  day TEXT,
  person_id TEXT,
  account_id TEXT,
  bot_id INTEGER,
  conversation_id INTEGER,
  session_id TEXT,
  task_id INTEGER,
  turns INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  usd REAL
);
CREATE TABLE bot_sessions (
  bot_id INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  session_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, person_id)
);
CREATE TABLE memory_log (
  id INTEGER PRIMARY KEY,
  at TEXT,
  person_id TEXT,
  scope TEXT,
  actor TEXT,
  op TEXT,
  status TEXT CHECK (status IN ('applied', 'pending', 'rejected', 'undone')),
  text TEXT,
  before TEXT
, uid TEXT);
CREATE TABLE link_seen (
  request_id TEXT PRIMARY KEY,
  peer TEXT,
  result TEXT,
  at TEXT
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  at TEXT,
  person_id TEXT,
  device_id TEXT,
  channel TEXT,
  method TEXT,
  resource TEXT,
  decision TEXT,
  reason TEXT
);
CREATE TABLE inbox_items (
  person_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bot', 'group', 'conversation', 'session')),
  item_id TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_order INTEGER,
  section_id INTEGER,
  muted INTEGER NOT NULL DEFAULT 0,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, kind, item_id)
);
CREATE TABLE inbox_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('bots', 'orb')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE bot_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_uid TEXT,
  at TEXT NOT NULL
);
CREATE TABLE replica_cursor (
  peer TEXT NOT NULL,
  bot_uid TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  files TEXT,
  at TEXT,
  PRIMARY KEY (peer, bot_uid)
);
CREATE TABLE link_persons (
  peer TEXT NOT NULL,
  local_person TEXT NOT NULL,
  remote_person TEXT NOT NULL,
  confirmed_at TEXT,
  PRIMARY KEY (peer, local_person)
);
CREATE TABLE bot_moves (
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
CREATE UNIQUE INDEX persons_owner ON persons (role) WHERE role = 'owner' AND deleted_at IS NULL;
CREATE INDEX usage_day ON usage_ledger (day, account_id, person_id, bot_id);
CREATE INDEX inbox_sections_person ON inbox_sections (person_id, zone, position);
CREATE INDEX bot_requests_status ON bot_requests (status, id);
CREATE INDEX bot_reminders_next ON bot_reminders (enabled, next_run);
CREATE INDEX conversations_updated ON conversations (status, updated_at);
CREATE INDEX session_queue_session ON session_queue (session_id, position, id);
CREATE INDEX events_task ON events (task_id, id);
CREATE INDEX events_kind_at ON events (kind, at);
CREATE INDEX messages_to ON messages (to_agent, id);
CREATE INDEX tasks_status ON tasks (status, id);
CREATE INDEX session_items_session ON session_items (session_id, id);
CREATE INDEX sessions_updated ON sessions (archived, updated_at);
CREATE INDEX messages_task ON messages (task_id, id);
CREATE INDEX tasks_parent ON tasks (parent_id);
CREATE INDEX tasks_review ON tasks (review_of);
CREATE INDEX session_items_approval ON session_items (id) WHERE kind = 'approval';
CREATE INDEX chat_conversation ON chat (conversation_id, id);
CREATE INDEX tasks_conversation ON tasks (conversation_id);
CREATE INDEX conversations_bot ON conversations (bot_id, group_id);
CREATE INDEX conversations_person ON conversations (person_id);
CREATE INDEX tasks_person ON tasks (person_id);
CREATE INDEX sessions_person ON sessions (person_id);
CREATE INDEX bots_person ON bots (person_id);
CREATE INDEX devices_person ON devices (person_id);
CREATE INDEX shares_person ON shares (person_id, resource_type);
CREATE UNIQUE INDEX link_queue_request ON link_queue (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX bots_person_name ON bots (person_id, name COLLATE NOCASE);
CREATE INDEX bot_changes_bot ON bot_changes (bot_uid, seq);
CREATE INDEX bot_moves_bot ON bot_moves (bot_uid, started_at);
CREATE UNIQUE INDEX bots_uid ON bots (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX bot_groups_uid ON bot_groups (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX chat_uid ON chat (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX bot_reminders_uid ON bot_reminders (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX memory_log_uid ON memory_log (uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX bot_requests_uid ON bot_requests (uid) WHERE uid IS NOT NULL;
CREATE INDEX bots_home ON bots (home, home_state);
CREATE TRIGGER home_bots_ins AFTER INSERT ON bots BEGIN
  UPDATE bots SET uid = COALESCE(uid, lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))), home = COALESCE(home, (SELECT value FROM settings WHERE key = 'orb_self')) WHERE id = NEW.id;
END;
CREATE TRIGGER home_bots_upd AFTER UPDATE ON bots WHEN NEW.uid IS NOT NULL AND (NEW.home IS NULL OR NEW.home = (SELECT value FROM settings WHERE key = 'orb_self')) BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (NEW.uid, 'bot', NEW.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER home_bots_del BEFORE DELETE ON bots WHEN OLD.uid IS NOT NULL AND (OLD.home IS NULL OR OLD.home = (SELECT value FROM settings WHERE key = 'orb_self')) BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (OLD.uid, 'delete', OLD.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER home_groups_ins AFTER INSERT ON bot_groups BEGIN
  UPDATE bot_groups SET uid = COALESCE(uid, lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))), home = COALESCE(home, (SELECT value FROM settings WHERE key = 'orb_self')) WHERE id = NEW.id;
END;
CREATE TRIGGER home_groups_upd AFTER UPDATE ON bot_groups WHEN NEW.uid IS NOT NULL AND (NEW.home IS NULL OR NEW.home = (SELECT value FROM settings WHERE key = 'orb_self')) BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) VALUES (NEW.uid, 'group', NEW.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER home_chat_ins AFTER INSERT ON chat WHEN NEW.conversation_id IS NOT NULL BEGIN
  UPDATE chat SET uid = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id
  WHERE c.id = NEW.conversation_id AND COALESCE(b.uid, g.uid) IS NOT NULL AND (COALESCE(b.home, g.home) IS NULL OR COALESCE(b.home, g.home) = (SELECT value FROM settings WHERE key = 'orb_self'))), 'chat', (SELECT uid FROM chat WHERE id = NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id
  WHERE c.id = NEW.conversation_id AND COALESCE(b.uid, g.uid) IS NOT NULL AND (COALESCE(b.home, g.home) IS NULL OR COALESCE(b.home, g.home) = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_chat_upd AFTER UPDATE OF body, meta ON chat WHEN NEW.conversation_id IS NOT NULL AND NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id
  WHERE c.id = NEW.conversation_id AND COALESCE(b.uid, g.uid) IS NOT NULL AND (COALESCE(b.home, g.home) IS NULL OR COALESCE(b.home, g.home) = (SELECT value FROM settings WHERE key = 'orb_self'))), 'chat', NEW.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT COALESCE(b.uid, g.uid) FROM conversations c LEFT JOIN bots b ON b.id = c.bot_id LEFT JOIN bot_groups g ON g.id = c.group_id
  WHERE c.id = NEW.conversation_id AND COALESCE(b.uid, g.uid) IS NOT NULL AND (COALESCE(b.home, g.home) IS NULL OR COALESCE(b.home, g.home) = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_rem_ins AFTER INSERT ON bot_reminders BEGIN
  UPDATE bot_reminders SET uid = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))), 'reminder', (SELECT uid FROM bot_reminders WHERE id = NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_rem_upd AFTER UPDATE OF text, every, start_at, weekdays, next_run, last_run, enabled, tz, local_at, skip_missed ON bot_reminders WHEN NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))), 'reminder', NEW.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_memlog_ins AFTER INSERT ON memory_log BEGIN
  UPDATE memory_log SET uid = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT uid FROM bots WHERE id = CASE WHEN NEW.scope LIKE 'bot:%' THEN CAST(substr(NEW.scope, 5) AS INTEGER) END AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))), 'memlog', (SELECT uid FROM memory_log WHERE id = NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT uid FROM bots WHERE id = CASE WHEN NEW.scope LIKE 'bot:%' THEN CAST(substr(NEW.scope, 5) AS INTEGER) END AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_memlog_upd AFTER UPDATE OF status, text, before ON memory_log WHEN NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT uid FROM bots WHERE id = CASE WHEN NEW.scope LIKE 'bot:%' THEN CAST(substr(NEW.scope, 5) AS INTEGER) END AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))), 'memlog', NEW.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT uid FROM bots WHERE id = CASE WHEN NEW.scope LIKE 'bot:%' THEN CAST(substr(NEW.scope, 5) AS INTEGER) END AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_req_ins AFTER INSERT ON bot_requests BEGIN
  UPDATE bot_requests SET uid = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) WHERE id = NEW.id AND uid IS NULL;
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))), 'request', (SELECT uid FROM bot_requests WHERE id = NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
CREATE TRIGGER home_req_upd AFTER UPDATE OF status, result, answered_by ON bot_requests WHEN NEW.uid IS NOT NULL BEGIN
  INSERT INTO bot_changes (bot_uid, kind, ref_uid, at) SELECT (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))), 'request', NEW.uid, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE (SELECT uid FROM bots WHERE id = NEW.bot_id AND uid IS NOT NULL AND (home IS NULL OR home = (SELECT value FROM settings WHERE key = 'orb_self'))) IS NOT NULL;
END;
