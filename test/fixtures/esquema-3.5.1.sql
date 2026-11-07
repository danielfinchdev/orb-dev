-- The schema of an Orb 3.5.1 database (dumped from that version's openDb), for test/migracion-38.test.mjs.
CREATE TABLE bot_group_members (
  group_id INTEGER NOT NULL,
  bot_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, bot_id)
);
CREATE TABLE bot_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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
, decided_by TEXT);
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
);
CREATE TABLE chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  meta TEXT,
  at TEXT NOT NULL
, conversation_id INTEGER);
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
, bot_id INTEGER, group_id INTEGER);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT
, public_key TEXT, route TEXT, push TEXT, kind TEXT, role TEXT, ip TEXT, meta TEXT, admin INTEGER NOT NULL DEFAULT 0, kind_ok INTEGER, approve INTEGER NOT NULL DEFAULT 1, dev_ok INTEGER NOT NULL DEFAULT 0);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE link_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  from_device TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  result TEXT,
  done_at TEXT
);
CREATE TABLE message_reads (
  message_id INTEGER NOT NULL,
  agent TEXT NOT NULL,
  PRIMARY KEY (message_id, agent)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  task_id INTEGER,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE projects (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  path TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
, grupo TEXT);
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
);
CREATE TABLE session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE session_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
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
, titled INTEGER NOT NULL DEFAULT 0, context TEXT, settled INTEGER NOT NULL DEFAULT 0, parent_id TEXT);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
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
, parent_id INTEGER, limited_until TEXT, review_of INTEGER, schedule_id INTEGER, level TEXT, conversation_id INTEGER);
CREATE INDEX bot_reminders_next ON bot_reminders (enabled, next_run);
CREATE INDEX bot_requests_status ON bot_requests (status, id);
CREATE INDEX chat_conversation ON chat (conversation_id, id);
CREATE INDEX conversations_bot ON conversations (bot_id, group_id);
CREATE INDEX conversations_updated ON conversations (status, updated_at);
CREATE INDEX events_kind_at ON events (kind, at);
CREATE INDEX events_task ON events (task_id, id);
CREATE INDEX messages_task ON messages (task_id, id);
CREATE INDEX messages_to ON messages (to_agent, id);
CREATE INDEX session_items_approval ON session_items (id) WHERE kind = 'approval';
CREATE INDEX session_items_session ON session_items (session_id, id);
CREATE INDEX session_queue_session ON session_queue (session_id, position, id);
CREATE INDEX sessions_updated ON sessions (archived, updated_at);
CREATE INDEX tasks_conversation ON tasks (conversation_id);
CREATE INDEX tasks_parent ON tasks (parent_id);
CREATE INDEX tasks_review ON tasks (review_of);
CREATE INDEX tasks_status ON tasks (status, id);
