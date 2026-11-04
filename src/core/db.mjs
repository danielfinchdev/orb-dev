// SQLite database of one assistant folder: board (projects, tasks, events, messages), the assistant's chat and the live
// sessions (direct conversations and task runs) with their items.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr, migrateConfigPersons } from './context.mjs';
import { avatarFor } from './avatar.mjs';
import { titleFrom } from './titles.mjs';
import { dbLike, ensureOwner, ownerId, systemTz } from './persons.mjs';
import { migrateHome } from './replica-db.mjs';

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
-- 3.5 (Magic Link): calls for the linked workshop Orb left waiting while it was off (sent when it comes back).
CREATE TABLE IF NOT EXISTS link_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  from_device TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  result TEXT,
  done_at TEXT
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
-- 3.5: the user's own bots (none fixed in the code: only an empty «Asistente» on the first run). Each one has its brain
-- (any installed agent, model and effort), its tool groups and accounts, the topics only it handles (exclusive) and whether
-- it is the chief. Its live conversation id (session_id) continues after a restart.
CREATE TABLE IF NOT EXISTS bots (
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
CREATE TABLE IF NOT EXISTS bot_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_group_members (
  group_id INTEGER NOT NULL,
  bot_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, bot_id)
);
-- 3.5: what a bot's tools (src/mcp/bot.mjs, another process) ask the engine to do: a message to another bot, a card the
-- user approves (create/change/pause a bot, a change on the server, Home Assistant, a purchase…), grouped questions.
CREATE TABLE IF NOT EXISTS bot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- 3.5: the bots' reminders: once, daily, weekly, monthly or yearly; each one goes to its bot's chat and to the phone.
CREATE TABLE IF NOT EXISTS bot_reminders (
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
-- 3.6 «Personas» (docs/PERSONAS-INTERNALS.md): the people of this Orb, their own settings, what they share, the accounts
-- lent, what each one spent, each bot's live conversation per person, the history of the memories, the forwarded calls
-- already answered and the audit of refused calls (ids and names only, never content).
CREATE TABLE IF NOT EXISTS persons (
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
CREATE UNIQUE INDEX IF NOT EXISTS persons_owner ON persons (role) WHERE role = 'owner' AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS person_settings (
  person_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (person_id, key)
);
CREATE TABLE IF NOT EXISTS shares (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('bot', 'group', 'project', 'integration')),
  resource_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  right TEXT NOT NULL CHECK (right IN ('view', 'talk', 'edit')),
  granted_by TEXT,
  created_at TEXT,
  PRIMARY KEY (resource_type, resource_id, person_id)
);
CREATE TABLE IF NOT EXISTS account_loans (
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
CREATE TABLE IF NOT EXISTS usage_ledger (
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
CREATE INDEX IF NOT EXISTS usage_day ON usage_ledger (day, account_id, person_id, bot_id);
CREATE TABLE IF NOT EXISTS bot_sessions (
  bot_id INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  session_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, person_id)
);
CREATE TABLE IF NOT EXISTS memory_log (
  id INTEGER PRIMARY KEY,
  at TEXT,
  person_id TEXT,
  scope TEXT,
  actor TEXT,
  op TEXT,
  status TEXT CHECK (status IN ('applied', 'pending', 'rejected', 'undone')),
  text TEXT,
  before TEXT
);
CREATE TABLE IF NOT EXISTS link_seen (
  request_id TEXT PRIMARY KEY,
  peer TEXT,
  result TEXT,
  at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
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
-- 3.6 (messaging lists): each person's own marks on a chat of the lists (a bot, a group, a conversation with Orbe):
-- pinned and its order, the section it is in (kept while pinned: unpinning puts it back), muted, and the last chat
-- line read (0: none yet, the person's starting point in settings «inbox_since:<person>» counts instead).
CREATE TABLE IF NOT EXISTS inbox_items (
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
-- The sections a person makes in each zone's list («Casa», «Trabajo»…).
CREATE TABLE IF NOT EXISTS inbox_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('bots', 'orb')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_sections_person ON inbox_sections (person_id, zone, position);
CREATE INDEX IF NOT EXISTS bot_requests_status ON bot_requests (status, id);
CREATE INDEX IF NOT EXISTS bot_reminders_next ON bot_reminders (enabled, next_run);
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
  const existed = filename !== ':memory:' && fs.existsSync(filename);
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON;');
  if (existed) preCopy(db, filename);
  db.exec(SCHEMA);
  migrate(db, { file: filename });
  return db;
}

// 3.6: before the first change of a database made by an older Orb, a copy of it as it was (<data>/orb-pre-3.6.db), once.
const PRE_COPY = 'orb-pre-3.6.db';
function preCopy(db, filename) {
  let migrated = false; let old = false;
  try { migrated = Boolean(db.prepare("SELECT value FROM settings WHERE key = 'persons_migrated'").get()); old = true; } catch { /* no settings table: an empty file */ }
  if (migrated || !old) return;
  const target = path.join(path.dirname(filename), PRE_COPY);
  if (fs.existsSync(target)) return;
  // Another process (an MCP server) may be making it at the same moment: VACUUM INTO refuses a file that exists.
  try { db.prepare('VACUUM INTO ?').run(target); } catch { /* made by the other process, or no room: the migration goes on */ }
}

// 3.6 «Personas»: once per database, inside one write lock (the engine and the MCP servers open it at the same time):
// the owner is made and becomes the person of every row; each bot's live conversation is the owner's; reminders get
// their wall time and time zone; the global memory moves to the owner's folder and the settings' accounts and
// connectors are the owner's. Idempotent: each step only fills what is missing.
function migratePersons(db, { file }) {
  const b = dbLike(db);
  const main = Boolean(file && file !== ':memory:' && ctx.paths?.db && path.resolve(file) === path.resolve(ctx.paths.db));
  const done = () => b.one("SELECT value FROM settings WHERE key = 'persons_migrated'");
  let owner = done() ? ownerId(b) : null;
  let now = false;
  if (!owner) {
    db.exec('BEGIN IMMEDIATE');
    try {
      owner = ensureOwner(b);
      if (!done()) {
        now = true;
        for (const t of PERSON_TABLES) b.run(`UPDATE ${t} SET person_id = ? WHERE person_id IS NULL`, owner);
        b.run('INSERT OR IGNORE INTO bot_sessions (bot_id, person_id, session_id, turns) SELECT id, ?, session_id, turns FROM bots WHERE session_id IS NOT NULL OR turns > 0', owner);
        const tz = b.one('SELECT tz FROM persons WHERE id = ?', owner)?.tz || systemTz();
        for (const r of b.all('SELECT id, start_at FROM bot_reminders WHERE local_at IS NULL')) b.run('UPDATE bot_reminders SET local_at = ?, tz = COALESCE(tz, ?) WHERE id = ?', wallTime(r.start_at, tz), tz, r.id);
        b.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('persons_migrated', '1')");
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (main) {
    ctx.owner = owner; ctx.personStore = db;
    moveGlobalMemory(owner);
    if (now) { try { migrateConfigPersons(owner); } catch { /* the settings stay as they are: a missing person reads as the owner */ } }
  }
}
// «2026-03-29T09:00» in that time zone for an ISO instant (null when it is not one).
export function wallTime(iso, tz) {
  const t = Date.parse(String(iso ?? '')); if (!Number.isFinite(t)) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch { return null; }
}
// <home>/bots/memoria-global.md → <home>/bots/personas/<owner>/memoria-global.md (once; never over a newer one).
function moveGlobalMemory(owner) {
  const dir = ctx.paths?.bots; if (!dir) return;
  const from = path.join(dir, 'memoria-global.md'); const to = path.join(dir, 'personas', owner, 'memoria-global.md');
  try {
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } catch { /* in use by another process: the next start moves it */ }
}

// 3.6: the tables whose rows belong to a person (person_id).
export const PERSON_TABLES = ['conversations', 'chat', 'tasks', 'sessions', 'schedules', 'projects', 'bots', 'bot_groups', 'bot_reminders', 'bot_requests', 'link_queue', 'events', 'devices'];
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
  // 3.5 (Magic Link): what was linked (phone, browser or another Orb), the role of a linked Orb, its last address and
  // what it told about itself (hostname, MAC addresses for Wake-on-LAN, version).
  ['devices', 'kind', 'TEXT'], ['devices', 'role', 'TEXT'], ['devices', 'ip', 'TEXT'], ['devices', 'meta', 'TEXT'],
  // 3.5: «Puede administrar» (Ajustes › Magic Link): the device manages this Orb's bots and links from afar.
  ['devices', 'admin', 'INTEGER NOT NULL DEFAULT 0'],
  // 3.5.1: the rights chosen by whoever made the QR: kind_ok (the device is the kind the QR was made for; an «orb» that
  // only said so is 0 until the owner confirms it), approve (may answer the bots' cards), dev_ok (an Orb the owner
  // confirmed as the one that programs for this one). Who answered each bot's card.
  ['devices', 'kind_ok', 'INTEGER'], ['devices', 'approve', 'INTEGER NOT NULL DEFAULT 1'], ['devices', 'dev_ok', 'INTEGER NOT NULL DEFAULT 0'],
  ['bot_requests', 'decided_by', 'TEXT'],
  // 3.2: the conversation a chat line belongs to and the one that asked for a task.
  ['chat', 'conversation_id', 'INTEGER'], ['tasks', 'conversation_id', 'INTEGER'],
  // 3.5: a bot's own conversation (bot_id) and a group's (group_id); the assistant's conversations have neither.
  ['conversations', 'bot_id', 'INTEGER'], ['conversations', 'group_id', 'INTEGER'],
  // 3.6 «Personas»: whose each row is (NULL on rows written by code that does not stamp it yet: they are the owner's).
  // Children inherit it from their parent (session_items/session_queue → session, messages → task, members → group).
  // chat.person_id: the author of a line in a shared group.
  ...PERSON_TABLES.map((t) => [t, 'person_id', 'TEXT']),
  // 3.6: reminders in the wall time of a time zone (local_at in tz), whether a missed one is skipped and how late it rang.
  ['bot_reminders', 'tz', 'TEXT'], ['bot_reminders', 'local_at', 'TEXT'], ['bot_reminders', 'skip_missed', 'INTEGER NOT NULL DEFAULT 0'], ['bot_reminders', 'fired_late_ms', 'INTEGER'],
  // 3.6: who may answer a bot's card (JSON list of person ids) and who did.
  ['bot_requests', 'approvers', 'TEXT'], ['bot_requests', 'answered_by', 'TEXT'],
  // 3.6: a forwarded call's own id (the same id twice runs once; status may also be 'desconocido').
  ['link_queue', 'request_id', 'TEXT'],
  // 3.6: a bot's daily caps { daily_turns, daily_tokens, daily_usd }.
  ['bots', 'caps', 'TEXT'],
  // 3.6: a bot's avatar { shape, color } (src/core/avatar.mjs); the ones before get a fixed one from their id.
  ['bots', 'avatar', 'TEXT'],
  // 3.6: whose agent sent a message between agents (NULL: the owner's): it only reaches that person's agents.
  ['messages', 'person_id', 'TEXT'],
  // 3.7 (Orb Server, WS3): one home per bot. uid: the bot's id on every Orb (UUIDv7; local ids and folders stay as they
  // are); home: the identity (orbId) of the Orb that runs it; home_epoch: grows by one at every change of home (the
  // higher one wins after a crash or a split); home_state: active | pending (a move is copying it here) | moving (its
  // home is handing it over) | archived (a frozen copy after unlinking); home_fork: { from, seq } after a forced
  // takeover (where the old home's lines start); needs: what is missing on this Orb after a move ({ connectors, ha }).
  ['bots', 'uid', 'TEXT'], ['bots', 'home', 'TEXT'], ['bots', 'home_epoch', 'INTEGER NOT NULL DEFAULT 0'], ['bots', 'home_state', "TEXT NOT NULL DEFAULT 'active'"],
  ['bots', 'home_fork', 'TEXT'], ['bots', 'needs', 'TEXT'],
  ['bot_groups', 'uid', 'TEXT'], ['bot_groups', 'home', 'TEXT'], ['bot_groups', 'home_epoch', 'INTEGER NOT NULL DEFAULT 0'],
  // The rows a replica copies are known by uid everywhere (the local ids differ from one Orb to another).
  ['bot_reminders', 'uid', 'TEXT'], ['chat', 'uid', 'TEXT'], ['memory_log', 'uid', 'TEXT'], ['bot_requests', 'uid', 'TEXT']];
export function migrate(db, { file = null } = {}) {
  // 3.2: whether a direct conversation already has its title (Orb names a new one from its first message); the ones made
  // before keep theirs.
  if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'titled')) {
    db.exec('ALTER TABLE sessions ADD COLUMN titled INTEGER NOT NULL DEFAULT 0; UPDATE sessions SET titled = 1;');
  }
  for (const [table, column, type] of ADDED) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // 3.6: every bot has an avatar; one made before gets the fixed one of its id (the same on every run).
  const plain = db.prepare("SELECT id FROM bots WHERE avatar IS NULL OR avatar = ''").all();
  if (plain.length) { const set = db.prepare('UPDATE bots SET avatar = ? WHERE id = ?'); for (const r of plain) set.run(JSON.stringify(avatarFor(r.id)), r.id); }
  // 3.5.1: devices linked before: phones, browsers and terminals keep their rights; a device that said it was an «orb» is
  // asked again (the owner confirms it in Ajustes › Magic Link) and loses «Puede administrar» meanwhile.
  db.exec("UPDATE devices SET kind_ok = CASE WHEN kind = 'orb' THEN 0 ELSE 1 END, admin = CASE WHEN kind = 'orb' THEN 0 ELSE admin END, dev_ok = 0 WHERE kind_ok IS NULL");
  // 3.0: indexes for lookups that run on every refresh of an open task or at start (on columns that may have just been
  // added above, so not in SCHEMA).
  db.exec(`CREATE INDEX IF NOT EXISTS messages_task ON messages (task_id, id);
    CREATE INDEX IF NOT EXISTS tasks_parent ON tasks (parent_id);
    CREATE INDEX IF NOT EXISTS tasks_review ON tasks (review_of);
    CREATE INDEX IF NOT EXISTS session_items_approval ON session_items (id) WHERE kind = 'approval';
    CREATE INDEX IF NOT EXISTS chat_conversation ON chat (conversation_id, id);
    CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks (conversation_id);
    CREATE INDEX IF NOT EXISTS conversations_bot ON conversations (bot_id, group_id);
    CREATE INDEX IF NOT EXISTS conversations_person ON conversations (person_id);
    CREATE INDEX IF NOT EXISTS tasks_person ON tasks (person_id);
    CREATE INDEX IF NOT EXISTS sessions_person ON sessions (person_id);
    CREATE INDEX IF NOT EXISTS bots_person ON bots (person_id);
    CREATE INDEX IF NOT EXISTS devices_person ON devices (person_id);
    CREATE INDEX IF NOT EXISTS shares_person ON shares (person_id, resource_type);
    CREATE UNIQUE INDEX IF NOT EXISTS link_queue_request ON link_queue (request_id) WHERE request_id IS NOT NULL;`);
  // 3.6 (B6): a bot's name is unique for its person (an old database with two bots of the same name keeps working).
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS bots_person_name ON bots (person_id, name COLLATE NOCASE)'); } catch { /* duplicates from before */ }
  // 3.6: the direct conversations with an agent get marks too (pinned, muted): an inbox_items made before that only took
  // bots, groups and conversations is rebuilt with the wider check (same rows).
  // Inside a write lock and checked again there: the engine and the MCP servers may open the database at the same moment.
  const inboxSql = () => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inbox_items'").get()?.sql;
  if (inboxSql() && !inboxSql().includes("'session'")) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const sql = inboxSql();
      if (sql && !sql.includes("'session'")) {
        db.exec(`ALTER TABLE inbox_items RENAME TO inbox_items_old;
          ${sql.replace("'conversation')", "'conversation', 'session')")};
          INSERT INTO inbox_items SELECT * FROM inbox_items_old; DROP TABLE inbox_items_old;`);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  migrateConversations(db);
  migratePersons(db, { file });
  // 3.7 (WS3): uids, this Orb as the home of its bots, the change log and the replicas' cursors (src/core/replica-db.mjs).
  migrateHome(db, { file });
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
