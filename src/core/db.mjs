// SQLite database of one assistant folder: board (projects, tasks, events, messages), the assistant's chat and the live
// sessions (direct conversations and task runs) with their items.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from './context.mjs';

// node:sqlite may print an ExperimentalWarning; it would pollute the MCP stdout/stderr and the logs.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (/sqlite/i.test(String(warning?.message ?? warning))) return;
  return emitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  path TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
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
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  task_id INTEGER,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_reads (
  message_id INTEGER NOT NULL,
  agent TEXT NOT NULL,
  PRIMARY KEY (message_id, agent)
);
CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  meta TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
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
);
CREATE TABLE IF NOT EXISTS session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT
);
-- 2.3: messages waiting for a running turn (sent in order when it ends, or steered into it).
CREATE TABLE IF NOT EXISTS session_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- 2.3: scheduled tasks ("cada lunes a las 9 revisa las dependencias").
CREATE TABLE IF NOT EXISTS schedules (
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
CREATE INDEX IF NOT EXISTS session_queue_session ON session_queue (session_id, position, id);
CREATE INDEX IF NOT EXISTS events_task ON events (task_id, id);
CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at);
CREATE INDEX IF NOT EXISTS messages_to ON messages (to_agent, id);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks (status, id);
CREATE INDEX IF NOT EXISTS session_items_session ON session_items (session_id, id);
CREATE INDEX IF NOT EXISTS sessions_updated ON sessions (archived, updated_at);
`;

export const REASONING = ['low', 'medium', 'high', 'xhigh'];

export function taskOptions({ reasoning, fast } = {}) {
  reasoning = reasoning ?? ctx.config?.orchestrator?.defaultTaskReasoning ?? 'medium';
  fast = fast ?? false;
  if (!REASONING.includes(reasoning)) throw new Error('reasoning debe ser low, medium, high o xhigh');
  if (typeof fast !== 'boolean') throw new Error('fast debe ser true o false');
  return { reasoning, fast };
}

// The user's model policy (config.policy). Returns { approval: true } when the task must wait for the user's approval.
export function checkPolicy({ model, reasoning, fast }) {
  const policy = ctx.config?.policy ?? {};
  if (fast && policy.fast === false) throw new Error(tr('msg.db.fastOff'));
  if (model && (policy.banned ?? []).includes(model)) throw new Error(tr('msg.db.modelBanned', { model }));
  if (policy.reasoning && !policy.reasoning.includes(reasoning)) throw new Error(tr('msg.db.reasoningNotAllowed', { reasoning, allowed: policy.reasoning.join(', ') }));
  return { approval: (reasoning === 'high' || reasoning === 'xhigh') && policy.highNeedsApproval !== false };
}

export function openDb(filename = ctx.paths?.db) {
  if (!filename) throw new Error('no hay carpeta del asistente');
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Columns added after a database was created (each one only if it is missing).
// tasks.account: account chosen on purpose for the task (optional); tasks.run_account: account it last ran on.
// 2.3: sessions.context (how full the context is, JSON), sessions.settled (done, moved down in the menu), sessions.parent_id
// (forked from), tasks.parent_id (subtask of), tasks.limited_until (waiting for the usage limit to reset), tasks.review_of
// (a Contrapunto of that task), tasks.schedule_id (created by a schedule).
const ADDED = [['tasks', 'account', 'TEXT'], ['tasks', 'run_account', 'TEXT'], ['sessions', 'account', 'TEXT'], ['chat', 'meta', 'TEXT'],
  ['sessions', 'context', 'TEXT'], ['sessions', 'settled', 'INTEGER NOT NULL DEFAULT 0'], ['sessions', 'parent_id', 'TEXT'],
  ['tasks', 'parent_id', 'INTEGER'], ['tasks', 'limited_until', 'TEXT'], ['tasks', 'review_of', 'INTEGER'], ['tasks', 'schedule_id', 'INTEGER'],
  // 2.3.3: each phone has its own key (end-to-end encryption), the way it was paired and its notifications.
  ['devices', 'public_key', 'TEXT'], ['devices', 'route', 'TEXT'], ['devices', 'push', 'TEXT']];
export function migrate(db) {
  for (const [table, column, type] of ADDED) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
