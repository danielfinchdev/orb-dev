// SQLite database of one assistant folder: board (projects, tasks, events, messages), the assistant's chat and the live
// sessions (direct conversations and task runs) with their items.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from './context.mjs';
import { titleFrom } from './titles.mjs';

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
-- 3.2: each conversation with the assistant is its own (title, project, brain, its agent's conversation id and context),
-- listed in the sidebar and continued later. The chat lines and the tasks it asked for point to it (conversation_id).
CREATE TABLE IF NOT EXISTS conversations (
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
);
CREATE INDEX IF NOT EXISTS conversations_updated ON conversations (status, updated_at);
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
  if (!REASONING.includes(reasoning)) throw new Error(tr('sys.db.badReasoning'));
  if (typeof fast !== 'boolean') throw new Error(tr('sys.db.badFast'));
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
  if (!filename) throw new Error(tr('sys.db.noHome'));
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
// (a Task Review of that task), tasks.schedule_id (created by a schedule).
const ADDED = [['tasks', 'account', 'TEXT'], ['tasks', 'run_account', 'TEXT'], ['sessions', 'account', 'TEXT'], ['chat', 'meta', 'TEXT'],
  ['sessions', 'context', 'TEXT'], ['sessions', 'settled', 'INTEGER NOT NULL DEFAULT 0'], ['sessions', 'parent_id', 'TEXT'],
  ['tasks', 'parent_id', 'INTEGER'], ['tasks', 'limited_until', 'TEXT'], ['tasks', 'review_of', 'INTEGER'], ['tasks', 'schedule_id', 'INTEGER'],
  // 2.7: how hard the task is (simple / normal / complejo), for Orb to choose its model and reasoning.
  ['tasks', 'level', 'TEXT'],
  // 2.7: the multiplatform group a project belongs to (tienda-android and tienda-ios share «tienda»).
  ['projects', 'grupo', 'TEXT'],
  // 2.3.3: each phone has its own key (end-to-end encryption), the way it was paired and its notifications.
  ['devices', 'public_key', 'TEXT'], ['devices', 'route', 'TEXT'], ['devices', 'push', 'TEXT'],
  // 3.2: the conversation a chat line belongs to and the one that asked for a task.
  ['chat', 'conversation_id', 'INTEGER'], ['tasks', 'conversation_id', 'INTEGER']];
export function migrate(db) {
  // 3.2: whether a direct conversation already has its title (Orb names a new one from its first message); the ones made
  // before keep theirs.
  if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'titled')) {
    db.exec('ALTER TABLE sessions ADD COLUMN titled INTEGER NOT NULL DEFAULT 0; UPDATE sessions SET titled = 1;');
  }
  for (const [table, column, type] of ADDED) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // 3.0: indexes for lookups that run on every refresh of an open task or at start (on columns that may have just been
  // added above, so not in SCHEMA).
  db.exec(`CREATE INDEX IF NOT EXISTS messages_task ON messages (task_id, id);
    CREATE INDEX IF NOT EXISTS tasks_parent ON tasks (parent_id);
    CREATE INDEX IF NOT EXISTS tasks_review ON tasks (review_of);
    CREATE INDEX IF NOT EXISTS session_items_approval ON session_items (id) WHERE kind = 'approval';
    CREATE INDEX IF NOT EXISTS chat_conversation ON chat (conversation_id, id);
    CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks (conversation_id);`);
  migrateConversations(db);
  // 2.7.3: the notices saved as grey system lines before 2.7 (working folder, mode, brain, new conversation…) become
  // notices too, so the old ones leave the chat like the new ones. Only system lines with those exact openings. 3.0: once
  // per database (no grey line of those is written any more), not at every start of the engine and of each MCP server.
  if (db.prepare("SELECT value FROM settings WHERE key = 'notices_migrated'").get()) return;
  const where = OLD_NOTICES.map(() => 'body LIKE ?').join(' OR ');
  db.prepare(`UPDATE chat SET role = 'notice' WHERE role = 'system' AND (${where})`).run(...OLD_NOTICES);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('notices_migrated', '1')").run();
}
// 3.2: the chat before 3.2 was one long line cut by «Nueva conversación» notices. Once per database, each piece with
// something the user wrote becomes a conversation of its own (the pieces without, such as the lines of a task that ended
// later, join the one before); the tasks the assistant created go with the conversation they were asked in, and the
// assistant's live conversation continues in the last one. Nothing is deleted.
function migrateConversations(db) {
  const get = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  if (get('conversations_migrated')) return;
  // Inside one write lock, looked at again: the engine and the MCP servers open the database at the same time.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!get('conversations_migrated')) splitChat(db, get);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('conversations_migrated', '1')").run();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function splitChat(db, get) {
  const rows = db.prepare('SELECT id, role, body, meta, at FROM chat WHERE conversation_id IS NULL ORDER BY id').all();
  const pieces = []; let current = null;
  for (const r of rows) {
    if ((r.role === 'notice' || r.role === 'system') && /^(Nueva conversación|New conversation)/.test(r.body)) { current = null; continue; }
    if (r.role === 'notice') continue;
    if (!current) { current = { lines: [] }; pieces.push(current); }
    current.lines.push(r);
  }
  // A piece without a message of the user joins the one before it (or the next one, at the start).
  const kept = [];
  for (const p of pieces) {
    if (p.lines.some((l) => l.role === 'usuario')) kept.push(p);
    else if (kept.length) kept.at(-1).lines.push(...p.lines);
    else p.orphan = true;
  }
  const firstOrphans = pieces.filter((p) => p.orphan).flatMap((p) => p.lines);
  if (kept.length && firstOrphans.length) kept[0].lines.unshift(...firstOrphans);
  const active = get('active_project') || null;
  kept.forEach((p, i) => {
    const last = i === kept.length - 1;
    const from = p.lines[0].at; const to = kept[i + 1]?.lines[0]?.at ?? '9999';
    const tasks = db.prepare("SELECT id, project FROM tasks WHERE created_by = 'orb' AND conversation_id IS NULL AND created_at >= ? AND created_at < ?").all(from, to);
    const counts = {}; for (const t of tasks) counts[t.project] = (counts[t.project] ?? 0) + 1;
    const project = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (last ? active : null);
    const first = p.lines.find((l) => l.role === 'usuario');
    const title = titleFrom(first.body) || 'Conversación';
    const at = p.lines.at(-1).at;
    // With the brain configured then (its account and model: the live conversation of the last one continues there).
    const o = ctx.config?.orchestrator ?? {};
    const { lastInsertRowid } = db.prepare(`INSERT INTO conversations (title, titled, project, agent, account, model, reasoning, status, done_at, created_at, updated_at, session_id, turns)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, project, o.agent || 'claude', o.account || null, o.model || null, o.reasoning || 'medium', last ? 'open' : 'done', last ? null : at, from, at,
      last ? (get('orchestrator_session') || null) : null, last ? Number(get('orchestrator_turns') ?? 0) : 0);
    const id = Number(lastInsertRowid);
    const ids = p.lines.map((l) => l.id);
    for (let k = 0; k < ids.length; k += 400) { const part = ids.slice(k, k + 400); db.prepare(`UPDATE chat SET conversation_id = ? WHERE id IN (${part.map(() => '?').join(',')})`).run(id, ...part); }
    for (const t of tasks) db.prepare('UPDATE tasks SET conversation_id = ? WHERE id = ?').run(id, t.id);
  });
}

const OLD_NOTICES = ['Carpeta de trabajo:%', '📁 Carpeta de trabajo:%', 'Working folder:%', '📁 Working folder:%',
  'Modo orquestador:%', 'Modo libre:%', 'Orchestrator mode:%', 'Free mode:%', 'Modelo del asistente:%', 'Assistant model:%',
  '% usará % con razonamiento %', '% will use % reasoning.', 'Nueva conversación.%', 'New conversation.%', 'Detenido.', 'Stopped.',
  'La conversación se ha reiniciado%', 'The conversation has been restarted%', 'Nuevo dispositivo vinculado:%', 'New device paired:%',
  'Tarea programada «%', 'Scheduled task “%', 'Task Review: %', 'Se ha restablecido el cupo.%', 'The usage limit has been reset.%',
  '👍 Aceptad%', '👍 Accepted%', 'El modo libre requiere un proyecto.%', 'Free mode requires a project.%'];
