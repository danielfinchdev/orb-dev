// Live sessions: a conversation with one agent in one folder. Direct conversations and task runs launched
// by the scheduler use the same machinery. Every conversation keeps ONE live process of its agent open between turns
// (src/agents/live.mjs): answers stream as they are written, the user can steer the running turn or queue messages,
// approval requests show up as cards, the context meter fills up, and a closed app resumes the agent's own conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../platform/context.mjs';
import { approvalWaitMinutes, taskTimeoutMinutes } from '../domain/rules/rails.mjs';
import { connectorKey } from '../platform/config.mjs';
import { AGENT_LABELS } from '../platform/config-file.mjs';
import { adapter, executable } from '../agents/index.mjs';
import { UNGUARDED_AGENTS, requireLevel } from '../agents/unguarded.mjs';
import { liveSkills } from './api/extensions.mjs';
import { orbMcpServer, connectorLauncher } from '../agents/common.mjs';
import { agentAuth } from '../domain/security/agent-auth.mjs';
import { connectorLaunch } from '../domain/security/connector-secrets.mjs';
import { connectorSafe, reaches } from '../domain/extensions/extensions.mjs';
import { CURSOR_FILES } from '../agents/cursor.mjs';
import { runLog } from '../platform/log.mjs';
import { oneLine } from '../shared/text.mjs';
import { buildHandoff, HANDOFF_LOOKBACK } from './handoff.mjs';
import { git, isGitRepo, repoRoot } from '../platform/git.mjs';
import { account as findAccount, accountEnv, brainAccount } from '../domain/usage/accounts.mjs';
import { agentKeyEnv } from '../domain/security/agent-keys.mjs';
import { pickAccount, recordSpend, resolveAccount, accountProblemText, accountSwitchText } from '../domain/usage/budget.mjs';
import { browserKey } from './browser/browser-key.mjs';
import { androidAllowed } from './host/android.mjs';
import { PERMISSIONS, plainAction, pidKills, unwrapShell, globalAutonomy, permissionOfAutonomy } from '../domain/security/guard.mjs';
import { askedByUser } from '../domain/security/approval.mjs';
import { processList, taskProcesses, powershell } from '../platform/proc-list.mjs';
import { explainFailure } from '../shared/agent-errors.mjs';
import { rememberModels, modelCatalog, levelsOf, nearestLevel } from './usage/catalog.mjs';
import { snapshotBeforeTurn, snapshotAfterTurn, dropTurns } from '../domain/conversations/turns.mjs';
import { dropRescues } from '../domain/conversations/rewind.mjs';
import { changedFiles, logDirect } from '../domain/journal/journal.mjs';
import { ATTACH_DIR, placeAttachments as copyAttachments, prepareAttachments } from './host/attachments.mjs';
import { goalAfterTurn, goalFailed, goalSteered, debugOn } from './modes.mjs';
import { SideChats } from './side.mjs';
import { Suggester } from './suggest.mjs';
import { liveStep, activityLine } from '../domain/conversations/live-line.mjs';

export { PERMISSIONS, ATTACH_DIR };
// a message that asks for a picture (or to change one): Codex gets a short note on how Orb wants it done.
const IMAGE_ASK = /\b(imagen|im[aá]genes|image|images|picture|ilustraci[oó]n|illustration|logo|icono|icon|dibujo|drawing|foto|photo|wallpaper|edita la imagen)\b/i;
const IDLE_CLOSE_MS = 20 * 60_000; // a live process with nothing to do for this long is closed (it resumes on the next message)
const WATCH_MS = Number(process.env.ORB_WATCH_MS) || 5000; // how often a running turn is checked (time limit, permissions)
const now = () => new Date().toISOString();
const parseJson = (v, fallback = null) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const parseRow = (row) => row && { ...row, archived: Boolean(row.archived), settled: Boolean(row.settled), titled: Boolean(row.titled), android: Boolean(row.android), context: parseJson(row.context) };
const parseItem = (row) => { let body = row.body; if (/^[[{]/.test(body)) { try { body = JSON.parse(body); } catch { /* plain text */ } } return { ...row, body }; };
const bodyText = (body) => (typeof body === 'string' ? body : body?.text ?? '');

export const browserOn = () => Boolean(ctx.browser) && ctx.config.browser?.enabled !== false;

// MCP servers handed to an agent: the assistant's board (with the browser tools when the app offers them) plus the
// user's own connectors enabled for that agent. session: which conversation or task run (its agent process), so its next
// turn reuses the same page. conversation: the coordinator's conversation (its questions, tasks and project).
// who each server is, and a connector's command and keys, stay in the engine's memory (agent-auth.mjs): the config
// carries only the pipe and a ticket per server, new for every agent process and taken back when it closes
// (Sessions.closeLive, the coordinator's Lane.closeLive). A worker's tools act only on its task (permissions.mjs ›
// ownsTask); two direct conversations of one agent are two identities.
// project: the chat or task's project (none in a chat without one): a connector with a scope of projects is handed over only
// to those, one without it to every project.
// Reusable: Cursor's tickets, new every turn (mcpServersEachTurn) and released when the turn ends (.release()).
export function mcpServersFor(agent, { project = null, taskId = '', orchestrator = false, browser = !orchestrator, session = '', conversation = null, reusable = false } = {}) {
  const who = orchestrator ? 'orb' : agent;
  const sid = session ? String(session) : null;
  const ticketed = (name, base, reply) => {
    const variable = `ORB_TICKET_${name}`.replace(/[^A-Za-z0-9_]/g, '_');
    const ticket = agentAuth.issue({ session: sid, reply, reusable });
    tickets.push(ticket);
    return { ...base, args: [...base.args, `--ticket-env=${variable}`], env: { ...base.env, ORB_AUTH_PIPE: agentAuth.address, [variable]: ticket } };
  };
  const tickets = [];
  // The browser's key for this conversation's page only.
  const nav = browser && sid && browserOn() ? { pipe: ctx.browser.pipe, session: sid, token: browserKey(ctx.browser.token, { agent: who, session: sid, task: String(taskId || '') }) } : null;
  const servers = { orb: ticketed('orb', orbMcpServer(), { home: ctx.home, browser: nav,
    who: { agent: who, boss: orchestrator, conversation: orchestrator && conversation ? Number(conversation) : null, task: !orchestrator && taskId ? Number(taskId) : null, session: sid } }) };
  if (!orchestrator) {
    const taken = new Set(['orb']);
    for (const s of ctx.config.mcpServers ?? []) {
      if (s.enabled === false || !reaches(s, project) || (s.agents?.length && !s.agents.includes(agent)) || taken.has(connectorKey(s.name))) continue;
      // a server of core\mcp whose folder is a link or a junction (or reaches out of core) never starts.
      if (!connectorSafe(ctx.paths.core, s)) continue;
      taken.add(connectorKey(s.name)); // never two servers on one variable name (config checks it too)
      // its keys only for its launcher (orb.json has references). Keys go as a one-time grant of the vault, made when
      // the launcher trades its ticket: the keys go from the vault to the launcher, never through the engine.
      servers[s.name] = ticketed(s.name, connectorLauncher(), () => ({ launch: { command: s.command, args: s.args ?? [], ...connectorLaunch(ctx.master, s) } }));
    }
  }
  return Object.defineProperty(servers, 'release', { value: () => { for (const t of tickets) agentAuth.revoke(t); } });
}
// What an adapter gets: its servers, or (an agent that starts them again every turn) a function giving new ones.
export const mcpServersOf = (a, agent, opts) => (a.mcpServersEachTurn ? () => mcpServersFor(agent, { ...opts, reusable: true }) : mcpServersFor(agent, opts));

// any file (src/engine/host/attachments.mjs), copied into <folder>/.orb-adjuntos/<stamp>/ so every agent of the
// conversation can read it, and kept out of git. → [{ path, name, kind, size }]
export function placeAttachments(files, cwd) {
  const placed = copyAttachments(files, cwd);
  if (placed.length) keepOutOfGit(cwd);
  return placed;
}

// The attachments folder (pictures, long instructions for Cursor) never goes into the project's git; nor do the files
// Orb gives Cursor for one turn (its tools and rules, see cursor.mjs).
function keepOutOfGit(cwd, entries = [`${ATTACH_DIR}/`]) {
  if (isGitRepo(cwd)) {
    // --git-path answers relative to the folder git ran in (cwd), or absolute for worktrees.
    const exclude = git(cwd, 'rev-parse', '--git-path', 'info/exclude').stdout.trim() || path.join(repoRoot(cwd), '.git', 'info', 'exclude');
    const abs = path.resolve(cwd, exclude);
    try {
      const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const missing = entries.filter((e) => !text.split(/\r?\n/).includes(e));
      if (missing.length) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.appendFileSync(abs, `${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`); }
    } catch { /* not fatal: the commit step also skips this folder */ }
  }
}

// One line for the live view: what the agent is doing now.
function describeItem(item) {
  const b = item.body;
  if (item.kind === 'tool') return oneLine(`${b?.name ?? tr('msg.sessions.tool')}${b?.input ? `: ${b.input}` : ''}`, 140);
  if (item.kind === 'file') return oneLine(`${{ add: tr('msg.sessions.fileAdd'), delete: tr('msg.sessions.fileDelete') }[b?.change] ?? tr('msg.sessions.fileEdit')} ${b?.path ?? ''}`, 140);
  if (item.kind === 'reasoning') return tr('msg.sessions.thinking');
  if (item.kind === 'approval') return oneLine(tr('msg.sessions.waitingPermission', { title: plainAction(b?.title ?? '', { lang: ctx.config?.language }) }), 140);
  if (item.kind === 'text' && item.role === 'assistant') return oneLine(tr('msg.sessions.writes', { text: bodyText(b) }), 140);
  if (item.role === 'error') return oneLine(tr('msg.sessions.errorLine', { text: bodyText(b) }), 140);
  return null;
}

// whether a permission request could be a task stopping its own processes by number (only then is the process list
// asked, asynchronously, before showing the card).
const mayBeOwnKill = (command) => process.platform === 'win32' && Boolean(pidKills(unwrapShell(command))?.length);

export class Sessions {
  // emit(event, payload): pushes changes to the window. log(line): engine log.
  constructor(board, { emit = () => {}, log = () => {} } = {}) {
    this.board = board; this.emit = emit; this.log = log;
    this.running = new Map();   // session id -> the running turn { agent, startedAt, lastAt, steps, last, stopped, live }
    this.lives = new Map();     // session id -> { live, key, lastUsed, logFile }
    this.deltas = new Map();    // session id -> { text, timer }: the streamed text not sent to the window yet
    this.approvals = new Map(); // `${session}:${request}` -> item id of its card
    this.asked = new Map();     // session id -> what the user's own message of this turn asked for (['publish'])
    this.onApproval = () => {}; // set by the engine: a notice in the chat when a task waits for a click
    this.onApprovalDone = () => {}; // set by the engine: that notice shows how it ended (allowed, denied, nobody answered)
    this.onApprovalExpired = () => {};
    this.onRate = () => {};     // set by the engine: the real usage each account reports (budget)
    // Sessions left "running" by a closed app: their process is gone. Marked "interrupted" so they can continue.
    board.run("UPDATE sessions SET status = 'interrupted' WHERE status = 'running'");
    // A «/goal» that was going when the app closed does not start by itself on the next launch: it waits for «continuar».
    for (const row of board.all("SELECT key FROM settings WHERE key LIKE 'goal:%'")) {
      const goal = board.settingJson(row.key);
      if (goal?.status === 'active') board.settingJson(row.key, { ...goal, status: 'paused', reason: tr('msg.modes.goalAppClosed') });
    }
    // Approval cards left open by a closed app can no longer be answered.
    for (const row of board.all("SELECT id, body FROM session_items WHERE kind = 'approval' AND body LIKE '%\"status\":\"pending\"%'")) {
      const item = parseItem(row); board.run('UPDATE session_items SET body = ? WHERE id = ?', JSON.stringify({ ...item.body, status: 'expired' }), row.id);
    }
    // the periodic sweep must never throw: a database already closed (the app is leaving) is not worth an uncaught error
    this.sweeper = setInterval(() => { try { this.closeIdle(); } catch (error) { this.log?.(`limpieza de sesiones: ${error.message}`); } }, 60_000);
    this.sweeper.unref?.();
    this.holds = new Map(); // chat id -> { problem, sig, timer }: a fixed chat whose account cannot take its queued messages
    this.side = new SideChats(this); // «/side»: questions apart, in memory only (side.mjs)
    this.suggest = new Suggester(this); // the grey next message in the box, when Ajustes has it on (suggest.mjs)
  }

  list({ archived = false, kind } = {}) {
    return this.board.all(`SELECT * FROM sessions WHERE archived = ? AND trashed_at IS NULL ${kind ? 'AND kind = ?' : ''} ORDER BY updated_at DESC LIMIT 300`, Number(archived), ...(kind ? [kind] : [])).map(parseRow);
  }
  get(id) { return parseRow(this.board.one('SELECT * FROM sessions WHERE id = ?', String(id))); }
  must(id) { const s = this.get(id); if (!s) throw new Error(tr('msg.sessions.noConversation')); return s; }

  // account: 'auto' (or nothing) or the id of the only account the chat may use; accountFixed overrides what that says (a copy
  // keeps its original's account without fixing it). A task's session always takes the account its run was given.
  create({ kind = 'chat', agent, account = null, accountFixed = null, model = null, reasoning = 'medium', permission = permissionOfAutonomy(globalAutonomy()), project = null, cwd, title, taskId = null, parentId = null }) {
    adapter(agent);
    if (account && findAccount(account) && findAccount(account).agent !== agent) throw new Error(tr('msg.sessions.accountNotOf', { account, agent }));
    const wanted = brainAccount(account, agent);
    const fixed = accountFixed == null ? wanted.account_fixed : Number(Boolean(accountFixed) && Boolean(wanted.account));
    // A chat: a chosen account that is not in Orb is refused here; one without a session or at its limit is told when the
    // message goes (the chat keeps the choice). Another account is never picked for it.
    const acc = kind === 'task' ? pickAccount(this.board, { agent, preferred: account })
      : resolveAccount(this.board, { agent, account: wanted.account, fixed: Boolean(fixed), model }).acc;
    if (!acc || acc.agent !== agent) throw new Error(tr('msg.sessions.accountNotOf', { account, agent }));
    if (!PERMISSIONS.includes(permission)) throw new Error(tr('msg.sessions.badPermission'));
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(tr('msg.sessions.noCwd', { cwd }));
    const id = crypto.randomUUID(); const at = now();
    // No model chosen = the agent's default from Agentes (Sonnet for Claude), never its CLI's own default (which can be the
    // most expensive one).
    const chosen = model || ctx.config.agents[agent]?.defaultModel || null;
    this.board.run(`INSERT INTO sessions (id, kind, agent, account, account_fixed, model, reasoning, permission, project, cwd, task_id, title, status, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`, id, kind, agent, acc.id, kind === 'task' ? 1 : fixed ? 1 : 0, chosen, reasoning, permission, project, cwd, taskId, oneLine(title || tr('msg.sessions.defaultTitle'), 80), parentId, at, at);
    const s = this.get(id); this.emit('session:update', s); return s;
  }

  update(id, fields) {
    this.flushDelta(id); // what was streamed goes before the change (the turn's end) it came before
    const allowed = ['title', 'model', 'reasoning', 'permission', 'archived', 'status', 'cli_session', 'cwd', 'account', 'account_fixed', 'settled', 'context', 'titled', 'android'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(id);
    // Another account while a turn runs waits for the end of that turn: its process is never closed from under it.
    if (keys.some((k) => k === 'account' || k === 'account_fixed') && this.running.has(id) && !fields.applyPending) {
      const later = {};
      if ('account' in fields) later.account = fields.account;
      if ('account_fixed' in fields) later.account_fixed = fields.account_fixed;
      this.board.settingJson(`pending_account:${id}`, later);
      const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'account' && k !== 'account_fixed'));
      this.emit('session:update', { ...this.must(id), pendingAccount: later });
      return Object.keys(rest).length ? this.update(id, rest) : this.get(id);
    }
    // A change made now replaces one that was waiting for the end of a turn.
    if (keys.some((k) => k === 'account' || k === 'account_fixed') && !fields.applyPending) this.board.settingJson(`pending_account:${id}`, null);
    // Another account: the agent's own conversation lives in the old account's folder, so the chat goes on from its summary.
    if ('account' in fields && fields.account !== this.get(id)?.account && !('cli_session' in fields)) { fields = { ...fields, cli_session: null, context: null }; keys.push('cli_session', 'context'); }
    if ('permission' in fields && !PERMISSIONS.includes(fields.permission)) throw new Error(tr('msg.sessions.badPermission'));
    const value = (k) => { const v = fields[k]; if (typeof v === 'boolean') return Number(v); if (v && typeof v === 'object') return JSON.stringify(v); return v ?? null; };
    this.board.run(`UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(value), now(), id);
    // an archived conversation leaves no photos in the user's repository (turns.mjs); un-archiving starts the panel again.
    if (fields.archived === true && !this.running.has(id)) { const c = this.get(id); if (c?.kind === 'chat' && c.project && c.cwd) dropTurns(c.cwd, id); }
    // The live process follows the changes it can take on the fly; the rest apply when it starts again.
    const entry = this.lives.get(id);
    if (entry) {
      if ('model' in fields) { if (entry.live.caps.models) entry.live.setModel?.(fields.model); else if (!this.running.has(id)) this.closeLive(id); }
      // a «/plan» turn runs in «Solo lectura»: a change made meanwhile applies from the next turn (its process is rebuilt then)
      if ('permission' in fields && !this.running.get(id)?.planOnly) entry.live.setPermission?.(fields.permission);
      if ('reasoning' in fields && !this.running.has(id)) this.closeLive(id);
      if ('cwd' in fields || 'account' in fields) this.closeLive(id); // not while running: that case waited above
    }
    const s = this.get(id); this.emit('session:update', s);
    // the messages a fixed chat held for its account go when the account is changed (a turn that just ended handles its own queue)
    if (this.holds.has(id) && ('account' in fields || 'account_fixed' in fields) && !fields.applyPending) this.kickQueue(id);
    return s;
  }

  remove(id) {
    if (this.running.has(id)) throw new Error(tr('msg.sessions.stopFirst'));
    const s = this.must(id); if (s.kind === 'task') throw new Error(tr('msg.sessions.taskSession'));
    this.closeLive(id); this.asked.delete(id); this.side.closeFor(id);
    if (s.project && s.cwd) { dropTurns(s.cwd, id); dropRescues(s.cwd, id); }
    // The rescue refs live in the project's repository, so they go even when the chat's own folder is already gone.
    if (s.project) for (const repo of new Set([this.board.settingJson(`chatwt:${id}`)?.repo, this.board.project(s.project)?.path])) { if (repo && repo !== s.cwd && fs.existsSync(repo)) dropRescues(repo, id); }
    this.board.run('DELETE FROM session_items WHERE session_id = ?', id);
    this.board.run('DELETE FROM session_queue WHERE session_id = ?', id);
    this.board.run('DELETE FROM sessions WHERE id = ?', id);
    this.board.settingJson(`goal:${id}`, null); this.board.settingJson(`debug:${id}`, null);
    this.emit('session:removed', { id });
    try { this.onRemoved?.(s); } catch { /* a listener must never break a removal */ }
  }

  // History in pages: the newest `limit` items, or those before `before` (older pages) / after `after` (new ones).
  items(id, { after = 0, before = 0, limit = 200 } = {}) {
    const n = Math.min(Number(limit) || 200, 2000);
    const rows = before
      ? this.board.all('SELECT * FROM (SELECT * FROM session_items WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?) ORDER BY id', id, Number(before), n)
      : this.board.all('SELECT * FROM (SELECT * FROM session_items WHERE session_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id', id, Number(after) || 0, n);
    return rows.map(parseItem);
  }

  addItem(sessionId, role, kind, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const at = now();
    const { lastInsertRowid } = this.board.run('INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, ?, ?, ?, ?)', sessionId, role, kind, text.slice(0, 20000), at);
    const item = { id: Number(lastInsertRowid), session_id: sessionId, role, kind, body, at };
    this.emit('session:item', item);
    return item;
  }
  updateItem(itemId, body) {
    const row = this.board.one('SELECT * FROM session_items WHERE id = ?', itemId); if (!row) return null;
    this.board.run('UPDATE session_items SET body = ? WHERE id = ?', JSON.stringify(body).slice(0, 20000), itemId);
    const item = { ...parseItem(row), body };
    this.emit('session:item', item);
    return item;
  }

  isRunning(id) { return this.running.has(id); }
  // What a running chat does now in one short phrase («Editando styles.css»); null when it is idle or has done nothing yet.
  liveLine(id) { const step = this.running.get(id)?.step; return step ? activityLine(step.name, step.target) : null; }
  // What a running turn is doing right now (null when it is not running).
  live(id) { const r = this.running.get(id); return r ? { startedAt: r.startedAt, lastAt: r.lastAt, steps: r.steps, last: r.last, waiting: this.pendingApprovals(id).length } : null; }
  runningCount(agent) { return [...this.running.values()].filter((r) => !agent || r.agent === agent).length; }
  liveCount() { return this.lives.size; }

  // ---- approvals: cards waiting for the user's click
  pendingApprovals(sessionId) {
    return [...this.approvals.entries()].filter(([key]) => key.startsWith(`${sessionId}:`)).map(([, itemId]) => itemId);
  }
  allPendingApprovals() {
    const out = [];
    for (const [key, itemId] of this.approvals) {
      const row = this.board.one('SELECT * FROM session_items WHERE id = ?', itemId); if (!row) continue;
      const item = parseItem(row); if (item.body?.status !== 'pending') continue;
      const s = this.get(item.session_id);
      out.push({ ...item, key, session: s ? { id: s.id, title: s.title, agent: s.agent, kind: s.kind, task_id: s.task_id, project: s.project } : null });
    }
    return out;
  }
  respond(sessionId, requestId, decision) {
    const key = `${sessionId}:${requestId}`;
    const ok = this.lives.get(sessionId)?.live.respond(requestId, decision);
    if (ok) return true;
    const itemId = this.approvals.get(key);
    if (itemId) { // the turn already ended (stopped, closed): the card can only be closed
      const row = this.board.one('SELECT * FROM session_items WHERE id = ?', itemId);
      if (row) this.updateItem(itemId, { ...parseItem(row).body, status: 'expired' });
      this.approvals.delete(key);
      try { this.onApprovalDone(this.get(sessionId), requestId, 'expired'); } catch { /* the chat line keeps its state */ }
      this.emit('approval:changed', { session: sessionId });
    }
    throw new Error(tr('msg.sessions.requestGone'));
  }

  // ---- the live process of a conversation
  // a new permission starts the agent again at its next turn (its tools, Codex's sandbox and
  // approvals are chosen when it starts).
  // A saved level the other agent or model does not take drops to the closest one it does, instead of breaking the turn.
  levelFor(level, agent, model, account) {
    try { return nearestLevel(level, levelsOf(modelCatalog(this.board), agent, model, account)); } catch { return level; }
  }
  liveKey(s, acc) { return [s.agent, acc.id, s.cwd, s.reasoning, s.permission].join('|'); }

  closeLive(id) {
    // Its MCP servers' grants end with its process (a new process gets new tickets).
    agentAuth.revokeSession(id);
    const entry = this.lives.get(id); if (!entry) return;
    this.lives.delete(id);
    try { entry.live.close(); } catch { /* gone */ }
  }
  // Frees an account of its live processes (conversations and side chats) so its login can be removed: false, and nothing
  // closed, when any of them is in the middle of a turn; otherwise the ones resting between turns are closed (they open
  // again on the next message).
  releaseAccount(accountId) {
    const mine = [...this.lives].filter(([, e]) => e.account === accountId);
    const side = this.side.processesOf(accountId);
    if (mine.some(([id]) => this.running.has(id)) || side.some((e) => e.status === 'running')) return false;
    for (const [id] of mine) this.closeLive(id);
    this.side.closeProcessesOf(accountId);
    return true;
  }
  // Whether a chat of this account is in a turn ('busy') or has messages waiting ('queued'), else null.
  workingOn(accountId) {
    const ids = this.board.all('SELECT id FROM sessions WHERE account = ?', accountId).map((r) => r.id);
    if (ids.some((id) => this.running.has(id))) return 'busy';
    if (this.side.processesOf(accountId).some((e) => e.status === 'running')) return 'busy';
    if (ids.some((id) => this.queue(id).length)) return 'queued';
    // an account change waiting for the end of a turn (also one saved before Orb restarted)
    return this.board.all("SELECT value FROM settings WHERE key LIKE 'pending_account:%'").some((r) => { try { return JSON.parse(r.value)?.account === accountId; } catch { return false; } }) ? 'pending' : null;
  }
  // The messages a fixed chat held (its account could not take them) go now, if it can: in order, one at a time.
  kickQueue(id) {
    const s = this.get(id);
    if (!s || s.kind !== 'chat' || this.running.has(id) || !this.queue(id).length || this.accountFor(s).problem) return;
    const hold = this.holds.get(id); if (hold?.timer) clearTimeout(hold.timer);
    this.holds.delete(id);
    const next = this.takeQueued(id);
    if (next) { try { this.send(id, next.text, { images: next.images }); } catch (error) { this.addItem(id, 'error', 'text', error.message); } }
  }
  // «Esperar»: the held messages go by themselves when the account's limit ends.
  holdWait(id) {
    const hold = this.holds.get(String(id));
    if (!hold) throw new Error(tr('msg.api.holdNone'));
    if (hold.timer) clearTimeout(hold.timer);
    const ms = hold.problem.until ? Math.max(1000, hold.problem.until - Date.now() + 5000) : 60_000;
    hold.timer = setTimeout(() => { hold.timer = null; this.kickQueue(String(id)); }, Math.min(ms, 2_147_000_000));
    hold.timer.unref?.();
    this.emit('session:account', { id: String(id), problem: hold.problem, waiting: true });
    return { ok: true };
  }
  // The account change asked for during a turn, now that it has ended.
  applyPendingAccount(id) {
    const later = this.board.settingJson(`pending_account:${id}`);
    if (!later || !this.get(id)) return;
    this.board.settingJson(`pending_account:${id}`, null);
    const moved = 'account' in later && later.account !== this.get(id).account;
    this.update(id, { ...later, applyPending: true });
    if (moved) this.addItem(id, 'system', 'status', tr('msg.acct.switchedFresh', { to: findAccount(later.account)?.label ?? later.account }));
  }
  // A chat's account for its next turn: fixed (its own or a problem) or automatic (stays, or moves between turns).
  // The conversation of the agent lives in its account's folder: an automatic chat that never talked is free to choose.
  accountFor(s) {
    if (s.kind !== 'chat') {
      const acc = s.account ? findAccount(s.account) : pickAccount(this.board, { agent: s.agent });
      return { acc, problem: acc ? null : { kind: 'gone', account: s.account }, switched: null };
    }
    return resolveAccount(this.board, { agent: s.agent, account: s.account_fixed || s.cli_session ? s.account : null, fixed: Boolean(s.account_fixed), model: s.model });
  }
  closeIdle() {
    for (const [id, entry] of this.lives) if (!this.running.has(id) && Date.now() - entry.lastUsed > IDLE_CLOSE_MS) this.closeLive(id);
    // a direct conversation quiet for a day, with nothing waiting, is done by itself (it opens again when written to).
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    for (const s of this.board.all("SELECT id FROM sessions WHERE kind = 'chat' AND settled = 0 AND archived = 0 AND status IN ('idle', 'done') AND updated_at < ?", since)) {
      if (this.running.has(s.id) || this.pendingApprovals(s.id).length) continue;
      this.board.run('UPDATE sessions SET settled = 1 WHERE id = ?', s.id);
      this.board.changed('sessions');
    }
  }

  getLive(s, acc, { taskId, budgetUsd } = {}) {
    const key = this.liveKey(s, acc);
    const existing = this.lives.get(s.id);
    if (existing && existing.key === key && !existing.live.isClosed?.()) { existing.lastUsed = Date.now(); return existing; }
    if (existing) this.closeLive(s.id);
    const a = adapter(s.agent);
    const exe = executable(s.agent);
    const dir = path.join(ctx.paths.runs, s.kind === 'task' && s.task_id ? String(s.task_id) : path.join('conversaciones', s.id));
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'registro.jsonl');
    const writeLog = runLog(logFile);
    // A fork waiting to happen: the agent copies the original conversation natively (Claude, Codex).
    const forkFrom = this.board.settingJson(`fork_pending:${s.id}`);
    if (forkFrom) this.board.settingJson(`fork_pending:${s.id}`, null);
    writeLog(JSON.stringify({ orb: 'sesion', at: now(), agent: s.agent, model: s.model, permission: s.permission, resume: Boolean(s.cli_session), fork: Boolean(forkFrom) }));
    // Claude keeps the id the app chooses; the other agents (and forks) report theirs in their first events.
    const newSessionId = !s.cli_session && !forkFrom && s.agent === 'claude' ? crypto.randomUUID() : null;
    if (newSessionId) this.update(s.id, { cli_session: newSessionId });
    const entry = { key, lastUsed: Date.now(), logFile, live: null, account: acc.id };
    // Long instructions Cursor gets in a file go to the attachments folder (out of git), not among the project's files.
    const promptDir = path.join(s.cwd, ATTACH_DIR);
    if (s.agent === 'cursor') keepOutOfGit(s.cwd, [`${ATTACH_DIR}/`, ...CURSOR_FILES]);
    // the agent's own API key from the vault (only the names of its table, src/domain/security/agent-keys.mjs): in its
    // process environment and nowhere else; its value is hidden from the agent's log and events (secretValues).
    const keyEnv = agentKeyEnv(ctx.master, s.agent);
    entry.live = a.createLive({
      promptDir, secretValues: Object.values(keyEnv),
      exe, cwd: s.cwd, model: s.model, reasoning: s.reasoning, permission: s.permission,
      resumeId: forkFrom || s.cli_session || null, forkSession: Boolean(forkFrom), newSessionId,
      mcpServers: mcpServersOf(a, s.agent, { taskId, session: s.id, project: s.project || null }), budgetUsd,
      env: { ...accountEnv(acc), ...keyEnv, ORB_AGENT: s.agent, ...(taskId ? { ORB_TASK_ID: String(taskId) } : {}) },
      internalDir: ctx.paths.internal, lang: ctx.config.language, log: writeLog, cfg: ctx.config.agents[s.agent] ?? {},
      // the project's folder for the guard's inside/outside rules (none in a chat without a project), and what the
      // user's own message of the turn asked for (read on every action: «súbelo» lets «Auto» push).
      projectDir: s.project ? s.cwd : null,
      userAsked: () => this.asked.get(s.id) ?? [],
      // read on every action (the owner may take it back at any moment): adb by hand needs it (src/domain/security/guard.mjs).
      android: () => androidAllowed(this.get(s.id)),
      skills: liveSkills(s.project || null), // the skills of core that are on (Claude and Codex load them themselves)
      onEvent: (ev) => this.onLiveEvent(s.id, ev)
    });
    this.lives.set(s.id, entry);
    return entry;
  }

  // the streamed text goes to the window (and to each linked phone, ciphered for each) in pieces of up to 50 ms, not
  // one event per token; anything else the agent does sends what was pending first, so the order stays the same.
  queueDelta(id, text) {
    const d = this.deltas.get(id);
    if (d) { d.text += text; return; }
    const timer = setTimeout(() => this.flushDelta(id), 50); timer.unref?.();
    this.deltas.set(id, { text, timer });
  }
  flushDelta(id) {
    const d = this.deltas.get(id); if (!d) return;
    clearTimeout(d.timer); this.deltas.delete(id);
    this.emit('session:delta', { id, text: d.text });
  }

  // A turn Orb itself ended (the guard caught a command, the working-time limit) is told in the conversation that asked
  // for the task, as a line with its cause and reason. It only informs: nothing here stops or allows anything.
  tellStop(id, cause, { why = '', body = '' } = {}) {
    try {
      const s = this.get(id);
      if (s?.kind !== 'task' || !s.task_id || !this.board.conversationOfTask(s.task_id)) return;
      this.board.addChat('system', body, { kind: 'turn-stopped', cause, task: s.task_id, ...(why ? { why } : {}), agent: s.agent, ...(s.model ? { model: s.model } : {}) });
    } catch (error) { this.log(`parada de ${id}: ${error.message}`); }
  }

  onLiveEvent(id, ev) {
    const run = this.running.get(id);
    if (run) run.lastAt = Date.now();
    if (ev.type === 'delta') { this.queueDelta(id, ev.text); return; }
    this.flushDelta(id);
    if (ev.type === 'models') { const s = this.get(id); if (s) rememberModels(this.board, s.agent, ev.list, s.account ?? s.agent); return; }
    if (ev.type === 'item') {
      const item = this.addItem(id, ev.role, ev.kind, ev.body);
      if (ev.stop) this.tellStop(id, ev.stop.cause, { why: ev.stop.why, body: ev.body });
      if (run) {
        const what = describeItem(item); if (what) run.last = what; if (ev.kind === 'tool' || ev.kind === 'file') run.steps++;
        // the same step kept apart, without paths, for the list rows (liveLine)
        if (ev.kind === 'tool') run.step = liveStep(ev.body?.name, ev.body?.input);
        else if (ev.kind === 'file') run.step = liveStep('edit', ev.body?.path);
      }
      return;
    }
    // something «Auto» let through that «Preguntar» would have asked: one quiet line in the chat (and the task's
    // activity), so nothing passes unsaid.
    if (ev.type === 'auto') {
      const what = plainAction(ev.title ?? '', { lang: ctx.config.language });
      this.addItem(id, 'system', 'status', tr('msg.sessions.autoAllowed', { what, why: ev.reason ?? '' }));
      const s = this.get(id);
      if (s?.kind === 'task' && s.task_id) try { this.board.event(s.task_id, 'orb', 'auto.allowed', `${what}: ${ev.reason ?? ''}`.slice(0, 400)); } catch { /* the task may be gone */ }
      return;
    }
    if (ev.type === 'session') { if (ev.id && this.get(id)?.cli_session !== ev.id) this.update(id, { cli_session: ev.id }); return; }
    if (ev.type === 'approval') {
      const r = ev.request;
      const s = this.get(id);
      // the agent already closed its task (orb_update_task) but its process is still asking for a
      // permission as it winds down. The task is over: the request is denied and the agent told, so nothing is left
      // hanging for the user to answer on a task that is already "Completada" (Orb stops its programs itself).
      if (s?.kind === 'task' && s.task_id) {
        const t = this.board.task(s.task_id);
        if (t && t.status !== 'running') {
          this.lives.get(id)?.live.respond(r.id, 'deny');
          this.addItem(id, 'system', 'approval', { id: r.id, tool: r.tool, title: r.title, reason: tr('msg.sessions.taskClosed'), input: r.input, status: 'denied' });
          return;
        }
      }
      // a task stopping its own test server by its number needs nobody: allowed at once, and said in its conversation.
      // checked asynchronously (the process list takes ~0.8 s); the card appears only if it is not the task's own.
      if (run && s?.kind === 'task' && mayBeOwnKill(r.title)) {
        this.ownProcesses(r.title, s.cwd, run.startedAt, { roots: [this.lives.get(id)?.live.pid].filter(Boolean) }).catch(() => false).then((own) => {
          if (own && this.lives.get(id)?.live.respond(r.id, 'allow')) this.addItem(id, 'system', 'approval', { id: r.id, tool: r.tool, title: r.title, reason: tr('msg.sessions.ownProcess'), input: r.input, status: 'allowed' });
          else if (this.running.has(id)) this.askApproval(id, r, this.running.get(id));
        }).catch((error) => this.log(`permiso: ${error.message}`));
        return;
      }
      this.askApproval(id, r, run);
      return;
    }
    if (ev.type === 'approval_done') {
      const key = `${id}:${ev.id}`; const itemId = this.approvals.get(key);
      if (itemId) {
        const row = this.board.one('SELECT * FROM session_items WHERE id = ?', itemId);
        const status = ev.decision === 'deny' ? 'denied' : ev.decision === 'always' ? 'always' : 'allowed';
        if (row) this.updateItem(itemId, { ...parseItem(row).body, status });
        this.approvals.delete(key);
        try { this.onApprovalDone(this.get(id), ev.id, status); } catch (error) { this.log(`aviso de permiso: ${error.message}`); }
      }
      this.emit('approval:changed', { session: id });
      return;
    }
    if (ev.type === 'context') { if (ev.size) this.update(id, { context: { used: ev.used, size: ev.size, at: now() } }); return; }
    if (ev.type === 'rate') { const s = this.get(id); try { this.onRate(s?.account ?? s?.agent, ev); } catch { /* budget only */ } return; }
    // The process is gone: its tickets go with it at once, even mid-turn (a process it left behind could trade them).
    if (ev.type === 'exit') { if (this.lives.get(id)?.live.isClosed?.()) { agentAuth.revokeSession(id); if (!this.running.has(id)) this.lives.delete(id); } }
  }

  // A permission the user answers: its card in the conversation, and the notice.
  askApproval(id, r, run) {
    const item = this.addItem(id, 'system', 'approval', { id: r.id, tool: r.tool, title: r.title, reason: r.reason, input: r.input, ...(r.summary ? { summary: r.summary } : {}), status: 'pending' });
    this.approvals.set(`${id}:${r.id}`, item.id);
    if (run) run.last = describeItem(item);
    this.emit('approval:changed', { session: id });
    try { this.onApproval(this.get(id), item); } catch (error) { this.log(`aviso de aprobación: ${error.message}`); }
  }

  // whether a command only stops processes this task started itself: every number it names is a process launched
  // after the turn began from the task's own folder (Windows). Anything else (by name, someone else's process, a
  // command cut short in the card) asks as always. Asynchronous (resolves with true or false).
  async ownProcesses(command, cwd, since, { roots = [] } = {}) {
    if (process.platform !== 'win32' || !cwd) return false;
    // Codex sends the whole command wrapped in powershell -Command and may keep the number in a variable
    // (`$p = 11188; Stop-Process -Id $p`); pidKills unwraps and resolves that, so no 400-char cap applies.
    const pids = pidKills(unwrapShell(command));
    if (!pids?.length || pids.length > 8) return false;
    const out = await powershell(`Get-CimInstance Win32_Process -Filter "${pids.map((p) => `ProcessId=${Number(p)}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ id = $_.ProcessId; cmd = $_.CommandLine; at = $_.CreationDate.ToUniversalTime().ToString('o') } } | ConvertTo-Json -Compress`, { timeout: 15_000 });
    let found = []; try { const j = JSON.parse(out || '[]'); found = Array.isArray(j) ? j : [j]; } catch { return false; }
    const dir = path.resolve(cwd).toLowerCase();
    const byCmd = (pid) => found.some((p) => p.id === pid && String(p.cmd ?? '').toLowerCase().includes(dir) && Date.parse(p.at) >= since - 1000);
    // a server started with a relative path does not name the folder in its command line (`node server.js`); it is
    // recognised instead as part of the task's process tree (descendant of the agent).
    const tree = new Set();
    if (roots.length && !pids.every(byCmd)) { const list = await processList(since); if (list) for (const p of taskProcesses(list, { since, roots: roots.map(Number), dir, engine: process.pid })) tree.add(p.id); }
    return pids.every((pid) => byCmd(pid) || tree.has(pid));
  }

  // ---- the queue: messages written while the agent works
  queue(id) { return this.board.all('SELECT * FROM session_queue WHERE session_id = ? ORDER BY position, id', id).map((r) => ({ ...r, images: parseJson(r.images, []) })); }
  enqueue(id, text, images = []) {
    const pos = Number(this.board.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM session_queue WHERE session_id = ?', id).p);
    this.board.run('INSERT INTO session_queue (session_id, text, images, position, created_at) VALUES (?, ?, ?, ?, ?)', id, String(text).slice(0, 20000), JSON.stringify(images), pos, now());
    this.emit('session:queue', { id, queue: this.queue(id) });
  }
  editQueued(id, queueId, { text, remove, move } = {}) {
    const row = this.board.one('SELECT * FROM session_queue WHERE id = ? AND session_id = ?', Number(queueId), id);
    if (!row) throw new Error(tr('msg.sessions.notQueued'));
    if (remove) this.board.run('DELETE FROM session_queue WHERE id = ?', row.id);
    else if (text !== undefined) this.board.run('UPDATE session_queue SET text = ? WHERE id = ?', String(text).slice(0, 20000), row.id);
    if (move && !remove) {
      const list = this.queue(id); const i = list.findIndex((q) => q.id === row.id); const j = move === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; list.forEach((q, k) => this.board.run('UPDATE session_queue SET position = ? WHERE id = ?', k + 1, q.id)); }
    }
    this.emit('session:queue', { id, queue: this.queue(id) });
    return this.queue(id);
  }
  takeQueued(id) {
    const next = this.queue(id)[0]; if (!next) return null;
    this.board.run('DELETE FROM session_queue WHERE id = ?', next.id);
    this.emit('session:queue', { id, queue: this.queue(id) });
    return next;
  }

  // A message to a conversation: a new turn if it is idle; if it is working, steer it (the agent reads it at its next
  // step) or queue it (sent when the turn ends). mode: 'auto' (steer when the agent can, else queue) | 'steer' | 'queue'.
  message(id, text, { images = [], mode = 'auto', context = '', asked } = {}) {
    // context: what @ attached (another task, conversation or log), added for the agent but not shown as typed.
    if (!this.running.has(id)) { const run = this.send(id, text, { images, asked, prompt: context ? `${text}${context}` : undefined }); return run ? { sent: true } : { queued: true, held: true }; }
    const entry = this.lives.get(id);
    const onFail = () => { this.addItem(id, 'system', 'status', tr('msg.sessions.steerLate')); this.enqueue(id, text, []); };
    if (mode !== 'queue' && !images.length && !this.running.get(id)?.compacting && entry?.live.caps.steer && entry.live.steer({ text: context ? `${text}${context}` : text, onFail })) {
      this.addItem(id, 'user', 'text', { text, steer: true });
      goalSteered(this, id);
      return { steered: true };
    }
    this.enqueue(id, text, images);
    return { queued: true };
  }

  stop(id) {
    const run = this.running.get(id); if (!run) return false;
    run.stopped = true;
    const entry = this.lives.get(id);
    Promise.resolve(entry?.live.interrupt()).catch(() => {});
    // An agent that does not stop on request is closed (its conversation resumes on the next message).
    const t = setTimeout(() => { if (this.running.get(id) === run) this.closeLive(id); }, 8000); t.unref?.();
    return true;
  }
  // a running turn, every few seconds.
  // - Time limit on working time: the minutes spent waiting for the user's permission do not count.
  // - A task's permission that nobody answers in approvalWaitMinutes (Ajustes, 10 by default; 0 = wait for ever) is
  //   denied, the agent is told why and goes on another way: a task never sits waiting with nobody looking.
  watchRun(id, run, { timeoutMs, taskId }) {
    if (this.running.get(id) !== run) return;
    const t = Date.now();
    const pending = this.pendingApprovals(id);
    if (pending.length && run.pausedAt == null) run.pausedAt = t;
    if (!pending.length && run.pausedAt != null) { run.waitMs += t - run.pausedAt; run.pausedAt = null; }
    const worked = t - run.startedAt - run.waitMs - (run.pausedAt != null ? t - run.pausedAt : 0);
    if (timeoutMs && worked >= timeoutMs && !run.timedOut) {
      run.timedOut = true;
      const timeoutText = tr('msg.sessions.timeout', { min: Math.round(timeoutMs / 60000) });
      this.addItem(id, 'error', 'text', timeoutText);
      this.tellStop(id, 'time', { body: timeoutText });
      this.stop(id);
      return;
    }
    const waitMin = approvalWaitMinutes();
    if (!taskId || !(waitMin > 0)) return;
    const waitMs = Number(process.env.ORB_APPROVAL_WAIT_MS) || waitMin * 60_000; // tests: seconds instead of minutes
    for (const [key, itemId] of [...this.approvals.entries()].filter(([k]) => k.startsWith(`${id}:`))) {
      const row = this.board.one('SELECT * FROM session_items WHERE id = ?', itemId); if (!row) continue;
      const item = parseItem(row);
      if (item.body?.status !== 'pending' || t - Date.parse(item.at) < waitMs) continue;
      const requestId = key.slice(id.length + 1);
      if (!this.lives.get(id)?.live.respond(requestId, 'deny')) continue;
      this.updateItem(itemId, { ...item.body, status: 'timeout' });
      try { this.onApprovalDone(this.get(id), requestId, 'timeout'); } catch { /* the chat line keeps its state */ }
      this.addItem(id, 'system', 'status', tr('msg.sessions.approvalTimedOut', { min: waitMin, title: item.body?.title ?? '' }));
      const entry = this.lives.get(id);
      if (entry?.live.caps.steer) entry.live.steer({ text: tr('msg.sessions.approvalTimedOutAgent', { min: waitMin, title: item.body?.title ?? '' }) });
      try { this.onApprovalExpired(this.get(id), item); } catch (error) { this.log(`permiso caducado: ${error.message}`); }
    }
  }

  // every open agent process asks its plan's usage now (the usage panel's «Recargar»). → promises
  refreshUsage() { return [...this.lives.values()].map((e) => { try { return e.live.refreshUsage?.(); } catch { return null; } }).filter(Boolean); }

  stopAll() { this.side.closeAll(); for (const id of [...this.suggest.pending.keys()]) this.suggest.cancel(id); for (const id of this.running.keys()) this.stop(id); for (const id of [...this.lives.keys()]) this.closeLive(id); clearInterval(this.sweeper); }

  // One turn. options: images (absolute paths), prompt (what the agent receives, if it differs from what the user typed),
  // timeoutMs, budgetUsd, taskId, showUser, onFinish({ code, state, stderr, logFile, stopped, timedOut, limit }).
  send(id, text, { images = [], prompt, timeoutMs = taskTimeoutMinutes() * 60_000, budgetUsd, taskId, onFinish, showUser = true, asked, turnPermission } = {}) {
    // turnPermission: this one turn runs with less permission than the chat has («/plan»). Only «leer» exists, and only to lower
    // it: nothing here can make a turn more permissive than the chat.
    let chat = this.must(id);
    this.suggest.cancel(id); // a message of the user ends the proposal for the box
    const planOnly = turnPermission === 'leer';
    let s = planOnly ? { ...chat, permission: 'leer' } : chat;
    // what this turn may do because the user's own words asked for it: a task's comes from the scheduler (the
    // request it came from); a chat's, from the message the user typed now (a turn Orb sends by itself keeps the last).
    if (this.editing?.has(id) || this.editing?.has(chat.cwd)) throw new Error(tr('msg.sessions.stillWorking')); // a message is being edited
    if (this.running.has(id)) throw new Error(tr('msg.sessions.stillWorking')); // before: a refused send must not change what the running turn may do
    if (Array.isArray(asked)) this.asked.set(id, asked);
    else if (showUser && s.kind !== 'task') this.asked.set(id, askedByUser(text));
    if (!String(text ?? '').trim() && !images.length) throw new Error(tr('msg.sessions.writeMessage'));
    // its project is being deleted (project-close.mjs): no new turn in a folder that is going away.
    if (s.kind !== 'task' && s.project && this.board.isDeleting(s.project)) throw new Error(tr('msg.projects.deleting', { name: s.project }));
    // An account change asked for during the last turn goes before the account is settled.
    if (this.board.settingJson(`pending_account:${id}`)) { this.applyPendingAccount(id); chat = this.must(id); s = planOnly ? { ...chat, permission: 'leer' } : chat; }
    // The conversation's own account. A fixed chat never moves: when its account cannot take the turn the message does not go
    // and the chat says why (an automatic one moves to another account of its agent, and says so).
    const res = this.accountFor(s);
    if (res.problem) {
      const line = accountProblemText(res.problem);
      const sig = `${res.problem.kind}:${res.problem.account}:${Math.round((res.problem.until ?? 0) / 600_000)}`;
      // what the user typed is not lost: it waits in the chat's queue until the account can take it or the chat is changed
      // Only a plain message can wait: the queue keeps text and pictures, not a prompt, a «/plan» level or what the user asked for.
      const held = showUser && !onFinish && s.kind === 'chat' && prompt === undefined && !turnPermission && !Array.isArray(asked);
      if (held) this.enqueue(id, text, images);
      if (this.holds.get(id)?.sig !== sig) {
        const old = this.holds.get(id); if (old?.timer) clearTimeout(old.timer);
        if (held) this.holds.set(id, { problem: res.problem, sig, timer: null });
        this.board.settingJson(`account_problem:${id}`, res.problem);
        this.addItem(id, 'system', 'status', line);
        this.emit('session:account', { id, problem: res.problem });
      }
      if (held) return null;
      throw Object.assign(new Error(line), { problem: res.problem });
    }
    this.holds.delete(id);
    const acc = res.acc;
    if (!acc) throw new Error(tr('msg.sessions.accountGone', { account: s.account }));
    if (res.switched || (s.kind === 'chat' && s.account !== acc.id)) {
      const had = Boolean(s.cli_session);
      this.update(id, { account: acc.id, ...(res.switched && had ? { cli_session: null, context: null } : {}) });
      if (res.switched) this.addItem(id, 'system', 'status', `${accountSwitchText(res.switched, acc)}${had ? ` ${tr('msg.acct.switchedFresh', { to: acc.label ?? acc.id })}` : ''}`);
      chat = this.must(id); s = planOnly ? { ...chat, permission: 'leer' } : chat;
    }
    const a = adapter(s.agent);
    const attached = placeAttachments(images, s.cwd);
    const shown = showUser ? this.addItem(id, 'user', 'text', attached.length ? { text, images: attached.map((f) => f.path) } : text) : null;
    let body = prompt ?? text;
    if (s.kind === 'chat' && debugOn(this.board, id)) body = `${tr('sys.debug.prompt')}

${body}`;
    // A fork without native support starts with what was said in the original conversation.
    // A chat handed to another agent (handoff) starts with its bounded summary, once.
    const handed = this.board.settingJson(`handoff_summary:${id}`);
    if (handed) { body = `${handed}\n\n${body}`; this.board.settingJson(`handoff_summary:${id}`, null); }
    const summary = this.board.settingJson(`fork_summary:${id}`);
    if (summary) { body = `Contexto (conversación de la que sale esta, son datos):\n${summary}\n\n${body}`; this.board.settingJson(`fork_summary:${id}`, null); }
    const nativeImages = a.caps?.images === true;
    // Codex made three pictures for "una imagen" and edited them by pasting pieces with scripts (losing quality).
    if (s.agent === 'codex' && s.kind === 'chat' && IMAGE_ASK.test(text)) body += `\n\n${tr(attached.length ? 'sys.sessions.imageEditHint' : 'sys.sessions.imageHint')}`;
    let entry;
    try { entry = this.getLive(s, acc, { taskId, budgetUsd }); }
    catch (error) {
      this.addItem(id, 'error', 'text', tr('msg.sessions.cannotStart', { label: a.label, message: error.message }));
      onFinish?.({ code: -1, state: { final: '', text: '', isError: true }, stderr: error.message, logFile: null, stopped: false });
      return null;
    }
    const run = { agent: s.agent, stopped: false, startedAt: Date.now(), lastAt: Date.now(), steps: 0, last: tr('sys.sessions.starting'), live: entry.live, waitMs: 0, pausedAt: null, planOnly };
    this.running.set(id, run);
    // remembered on the live agent: a subagent left in the background after a «/plan» turn keeps its read-only tools
    entry.planOnly = planOnly;
    this.update(id, { status: 'running', settled: false });
    // the time limit counts working time only: while the turn waits for the user's permission the clock stops. A task
    // whose permission nobody answers is not left hanging either (watchRun).
    const timer = setInterval(() => { try { this.watchRun(id, run, { timeoutMs, taskId }); } catch (error) { this.log(`vigilancia ${id}: ${error.message}`); } }, WATCH_MS);
    timer.unref?.();
    const resumed = Boolean(s.cli_session);
    // a direct conversation in a project leaves a log entry for the files its turn changed (logs.mjs logDirect).
    const direct = s.kind === 'chat' && s.project && s.permission !== 'leer';
    const alive = () => { const c = this.get(id); return Boolean(c && !c.archived && !c.trashed_at); };
    let before = null; if (direct) { try { before = changedFiles(s.cwd); } catch { /* no entry */ } }
    let finished = false; // onFinish runs exactly once, also when the adapter itself fails
    // what each attachment becomes for this agent (pictures natively, a video's frames, a document's text…).
    if (attached.length) run.last = tr('sys.attach.preparing');
    const prepared = attached.length ? prepareAttachments(attached, { nativeImages, log: (m) => this.log(m) }) : Promise.resolve({ images: [], text: '' });
    // the light photo of the folder for the «Cambios» panel (turns.mjs): the baseline before the first turn, one more when each ends.
    prepared.then(async (p) => { if (direct && !run.stopped) await snapshotBeforeTurn(s.cwd, id, alive, { mark: shown?.id }); return p; }).then((p) => (run.stopped ? { final: '', text: '', isError: true } : entry.live.send({ text: p.text ? `${body}\n\n${p.text}` : body, images: p.images }))).then((result) => {
      clearInterval(timer);
      entry.lastUsed = Date.now();
      if (this.running.get(id) === run) this.running.delete(id);
      try { this.applyPendingAccount(id); } catch (error) { this.log(`cambio de cuenta ${id}: ${error.message}`); }
      const failed = result.isError && !run.stopped;
      // A conversation that cannot be resumed (old or deleted on the agent's side) starts over on the next message.
      if (failed && resumed && !result.text && /resum|no conversation|not found|malformed|thread|session/i.test(result.final ?? '')) {
        this.update(id, { cli_session: null }); this.closeLive(id);
        this.addItem(id, 'system', 'status', tr('msg.sessions.cannotResume', { label: a.label }));
      }
      // A failure we recognise (no login, plan, model, network…) is explained with what to do.
      if (failed && !onFinish) { const why = explainFailure(a.label, result.final, ctx.config.language); if (why) this.addItem(id, 'system', 'status', `${why.reason[0].toUpperCase()}${why.reason.slice(1)}. ${why.advice}`); }
      if (run.stopped && !run.timedOut) this.addItem(id, 'system', 'status', tr('msg.sessions.stopped'));
      const limited = Boolean(result.limit);
      this.update(id, { status: limited ? 'limited' : failed ? 'error' : 'idle' });
      if (direct) snapshotAfterTurn(s.cwd, id, alive);
      if (before) { try { logDirect(this.board, this.get(id) ?? s, { before, request: text, answer: result.text || result.final }); } catch (error) { this.log(`bitácora de la conversación ${id}: ${error.message}`); } }
      try { recordSpend(this.board, { account: acc.id, session: s.id, task: taskId ?? null, usage: result.usage ?? {} }); } catch (error) { this.log(`uso ${id}: ${error.message}`); }
      const state = { final: result.final, text: result.text, isError: result.isError, usage: result.usage, cliSession: this.get(id)?.cli_session };
      finished = true;
      try { onFinish?.({ code: result.isError ? 1 : 0, state, stderr: result.isError ? result.final : '', logFile: entry.logFile, stopped: run.stopped, timedOut: Boolean(run.timedOut), limit: result.limit }); }
      catch (error) { this.log(`onFinish ${id}: ${error.stack}`); }
      // «/goal»: the next turn of the goal, or why it stops (modes.mjs). It goes before the queue: a queued message pauses it. A stopped turn or a limit reaches it too, to pause it.
      if (!onFinish && s.kind === 'chat') { try { goalAfterTurn(this, id, { result, run }); } catch (error) { this.log(`objetivo ${id}: ${error.message}`); } }
      if (!onFinish && s.kind === 'chat') { try { this.suggest.after(id, { request: text, result, stopped: run.stopped }); } catch (error) { this.log(`sugerencia ${id}: ${error.message}`); } }
      // Messages written while it worked go now, in order (not after a stop or a limit: then the user decides).
      if (!run.stopped && !limited && !onFinish) {
        // a fixed chat whose account cannot take it now keeps its queue: send() would say why and the message would be lost
        const blocked = s.kind === 'chat' && this.queue(id).length ? this.accountFor(this.get(id) ?? s).problem : null;
        if (blocked) { this.addItem(id, 'system', 'status', accountProblemText(blocked)); this.emit('session:account', { id, problem: blocked }); }
        const next = blocked ? null : this.takeQueued(id);
        if (next) { try { this.send(id, next.text, { images: next.images }); } catch (error) { this.addItem(id, 'error', 'text', error.message); } }
      }
    }).catch((error) => {
      // send() itself failed (the adapter threw instead of ending the turn): the turn is over all the same, and a task must
      // hear it, or it would stay "running" forever with its folder locked.
      this.log(`turno ${id}: ${error.stack}`);
      clearInterval(timer);
      if (this.running.get(id) === run) this.running.delete(id);
      try { this.applyPendingAccount(id); } catch (e) { this.log(`cambio de cuenta ${id}: ${e.message}`); }
      const final = `${a.label}: ${error.message}`;
      try { this.update(id, { status: 'error' }); this.addItem(id, 'error', 'text', final); } catch { /* the conversation may be gone */ }
      if (!onFinish && s.kind === 'chat') { try { goalFailed(this, id, final); } catch { /* the conversation may be gone */ } }
      if (!finished) {
        finished = true;
        try { onFinish?.({ code: 1, state: { final, text: '', isError: true }, stderr: error.message, logFile: entry.logFile, stopped: run.stopped, timedOut: Boolean(run.timedOut) }); }
        catch (inner) { this.log(`onFinish ${id}: ${inner.stack}`); }
      }
    });
    return run;
  }

  // One subagent of the running turn (Claude's Agent tool): «stop» ends only that one, «background» lets it go on without the turn
  // waiting for it. Only an agent that can do it does; the others say so (Codex: the whole turn has to be stopped), never pretend.
  async subagent(id, toolId, action) {
    this.must(id);
    const live = this.lives.get(id)?.live;
    const call = action === 'stop' ? live?.stopSubagent : action === 'background' ? live?.backgroundSubagent : null;
    if (!call || (action !== 'stop' && !this.running.has(id))) throw new Error(tr(action === 'stop' ? 'msg.subagent.noStop' : 'msg.subagent.noBackground'));
    const ok = await call.call(live, String(toolId ?? ''));
    if (!ok) throw new Error(tr('msg.subagent.notRunning'));
    return { ok: true };
  }

  // «Compactar»: the agent's own compaction of a long direct conversation (Claude /compact, Codex's thread
  // compaction). The history in Orb stays as it is; the agent goes on from its summary. While it works the conversation
  // is busy (what is written waits in the queue). → { ok }
  async compact(id) {
    const s = this.must(id);
    if (s.kind !== 'chat') throw new Error(tr('msg.sessions.compactNotHere'));
    if (this.running.has(id)) throw new Error(tr('msg.sessions.stillWorking'));
    const a = adapter(s.agent);
    if (!a.caps?.compact) throw new Error(tr('msg.sessions.cannotCompact', { label: a.label }));
    if (!s.cli_session) return { ok: true, how: 'none' };
    const res = this.accountFor(s);
    if (res.problem) throw new Error(accountProblemText(res.problem));
    const acc = res.acc;
    if (!acc) throw new Error(tr('msg.sessions.accountGone', { account: s.account }));
    const entry = this.getLive(s, acc);
    if (typeof entry.live.compact !== 'function') throw new Error(tr('msg.sessions.cannotCompact', { label: a.label }));
    const run = { agent: s.agent, stopped: false, startedAt: Date.now(), lastAt: Date.now(), steps: 0, last: tr('msg.sessions.compacting'), live: entry.live, waitMs: 0, pausedAt: null, compacting: true };
    this.running.set(id, run);
    this.update(id, { status: 'running', settled: false });
    let r;
    try { r = await entry.live.compact({}); }
    catch (error) { r = { ok: false, error: error.message }; }
    finally { entry.lastUsed = Date.now(); if (this.running.get(id) === run) this.running.delete(id); }
    this.update(id, { status: 'idle' });
    this.addItem(id, 'system', 'status', r?.ok ? tr('msg.sessions.compacted') : tr('msg.sessions.compactFailed', { label: a.label }));
    if (!r?.ok) this.log(`compactar ${id}: ${r?.error ?? 'sin respuesta'}`);
    // What was written meanwhile goes now.
    const next = this.takeQueued(id);
    if (next) { try { this.send(id, next.text, { images: next.images }); } catch (error) { this.addItem(id, 'error', 'text', error.message); } }
    return { ok: Boolean(r?.ok), how: r?.ok ? 'compacted' : 'failed' };
  }

  // «/clear»: the agent's process closes and the next message starts a new conversation of the agent in this same
  // chat (its model, permission and project stay; the lines shown in Orb too).
  clear(id) {
    const s = this.must(id);
    if (s.kind !== 'chat') throw new Error(tr('msg.sessions.compactNotHere'));
    if (this.running.has(id)) throw new Error(tr('msg.sessions.stillWorking'));
    this.closeLive(id);
    this.board.settingJson(`fork_summary:${id}`, null); this.board.settingJson(`fork_pending:${id}`, null); this.board.settingJson(`handoff_summary:${id}`, null);
    this.update(id, { cli_session: null, context: null });
    this.board.settingJson(`goal:${id}`, null); this.emit('session:goal', { id, goal: null });
    this.addItem(id, 'system', 'status', tr('msg.sessions.cleared'));
    return { ok: true };
  }

  // Continue a conversation stopped by a closed app or a usage limit: the agent resumes its own conversation.
  resume(id) {
    this.must(id);
    if (this.running.has(id)) return false;
    const next = this.takeQueued(id);
    this.send(id, next?.text ?? 'Continúa donde lo dejaste.', { images: next?.images ?? [], showUser: Boolean(next) });
    return true;
  }

  // A copy of a conversation from its current point, to try another idea without losing the first one. Agents with native
  // forks (Claude, Codex) carry their whole history; for the others the copy starts with a summary of what was said.
  // agent: «Continuar con otro agente», the copy goes on with that agent (its own account and default model) and
  // always starts with the summary. Without it, the fork of before.
  // from: the id of a text line of this chat; the copy holds the conversation up to and including that line. The agent's
  // native session also holds what came after, so a cut copy never uses it: it starts with the summary, like «Editar».
  // Only the conversation is copied; the project's files are not touched.
  fork(id, { title, agent, from } = {}) {
    const s = this.must(id);
    if (this.running.has(id)) throw new Error(tr('msg.sessions.forkWait'));
    const cut = from == null ? null : Number(from);
    // an «Editar» in progress is about to delete lines from this chat: a cut copy could carry them
    if (cut != null && [s.id, s.cwd].some((k) => this.editing?.has(k))) throw new Error(tr('msg.edit.busy'));
    if (cut != null && !this.board.one("SELECT id FROM session_items WHERE id = ? AND session_id = ? AND kind = 'text' AND role IN ('user', 'assistant')", cut, s.id)) throw new Error(tr('msg.edit.noMessage'));
    const other = agent && agent !== s.agent ? agent : null;
    const a = adapter(other ?? s.agent);
    if (other && UNGUARDED_AGENTS.includes(other)) requireLevel('leer', AGENT_LABELS[other] ?? other); // the copy never keeps «total»
    // what was given with the master password stays with the original (also «total» of a project's chat).
    const copy = this.create({ kind: 'chat', agent: other ?? s.agent, account: other ? null : s.account, accountFixed: other ? null : Boolean(s.account_fixed), model: other ? null : s.model, reasoning: other ? this.levelFor(s.reasoning, other, null, null) : s.reasoning, permission: s.permission !== 'total' ? s.permission : s.project ? permissionOfAutonomy(globalAutonomy()) : 'leer',
      project: s.project, cwd: s.cwd, title: title || (other ? tr('msg.sessions.switchTitle', { title: s.title, agent: AGENT_LABELS[other] ?? other }) : tr('msg.sessions.forkTitle', { title: s.title })), parentId: s.id });
    this.board.run('UPDATE sessions SET titled = 1 WHERE id = ?', copy.id); // its title stays (not renamed by its next message)
    const old = this.board.all(`SELECT role, kind, body, at FROM session_items WHERE session_id = ? AND kind = 'text' AND role IN ('user', 'assistant')${cut != null ? ' AND id <= ?' : ''} ORDER BY id DESC LIMIT 40`, s.id, ...(cut != null ? [cut] : [])).reverse();
    for (const it of old) this.board.run('INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, ?, ?, ?, ?)', copy.id, it.role, it.kind, it.body, it.at);
    this.addItem(copy.id, 'system', 'status', other ? tr('msg.sessions.switched', { title: s.title, agent: AGENT_LABELS[other] ?? other }) : tr('msg.sessions.forked', { title: s.title }));
    if (!other && cut == null && a.caps?.fork && s.cli_session) this.board.settingJson(`fork_pending:${copy.id}`, s.cli_session);
    else if (old.length) this.board.settingJson(`fork_summary:${copy.id}`, old.map((it) => `${it.role === 'user' ? 'Usuario' : 'Agente'}: ${oneLine(bodyText(parseItem(it).body), 400)}`).join('\n'));
    return copy;
  }

  // «Pasar a otro agente»: the same chat goes on with another agent (same folder, same lines in Orb). The old agent's
  // process closes; its native session, hidden reasoning and subagents do not travel. The new one starts with a bounded
  // summary (handoff.mjs) in front of the next message. The chat's permission is kept, never raised: «total» (given with
  // the master password to the agent that had it) is not handed to another one. Refused while a turn runs or a permission
  // waits. → the chat
  handoff(id, { agent } = {}) {
    const s = this.must(id);
    if (s.kind !== 'chat') throw new Error(tr('msg.sessions.compactNotHere'));
    if (!agent || agent === s.agent) throw new Error(tr('msg.sessions.handoffSame'));
    if (this.running.has(id)) throw new Error(tr('msg.sessions.handoffWait'));
    if (this.pendingApprovals(id).length) throw new Error(tr('msg.sessions.handoffApproval'));
    adapter(agent); // throws for an unknown agent
    if (UNGUARDED_AGENTS.includes(agent)) requireLevel('leer', AGENT_LABELS[agent] ?? agent); // «total» is never carried over
    const acc = resolveAccount(this.board, { agent, model: ctx.config.agents[agent]?.defaultModel || null }).acc;
    if (!acc || acc.agent !== agent) throw new Error(tr('msg.sessions.accountNotOf', { account: agent, agent }));
    const rows = this.board.all("SELECT role, kind, body, at FROM session_items WHERE session_id = ? AND kind = 'text' AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?", id, HANDOFF_LOOKBACK).reverse().map(parseItem);
    const from = AGENT_LABELS[s.agent] ?? s.agent; const to = AGENT_LABELS[agent] ?? agent;
    const summary = buildHandoff(rows, { fromLabel: from, toLabel: to });
    // «total» goes back to what the chat had before it (as grants.mjs does when it is taken back); never above that.
    const prev = this.board.settingJson(`grant_prev:${id}`);
    const permission = s.permission !== 'total' ? s.permission : s.project ? (['leer', 'probar', 'editar', 'preguntar', 'auto'].includes(prev) ? prev : permissionOfAutonomy(globalAutonomy())) : 'leer';
    this.board.settingJson(`grant_prev:${id}`, null);
    this.asked.delete(id); // what the user's words allowed the old agent is not the new agent's
    this.closeLive(id);
    this.board.settingJson(`fork_summary:${id}`, null); this.board.settingJson(`fork_pending:${id}`, null);
    this.board.run('UPDATE sessions SET agent = ?, account = ?, account_fixed = 0, model = ?, reasoning = ?, permission = ?, cli_session = NULL, context = NULL, android = 0, updated_at = ? WHERE id = ?',
      agent, acc.id, ctx.config.agents[agent]?.defaultModel || null, this.levelFor(s.reasoning, agent, ctx.config.agents[agent]?.defaultModel || null, acc.id), permission, now(), id);
    this.board.settingJson(`handoff_summary:${id}`, summary.text);
    if (Number(s.android) === 1) this.addItem(id, 'system', 'status', tr('msg.grants.androidOff')); // given to the old agent, not to the new one
    // the item keeps what fits in a stored line (20.000 characters); the agent gets the whole summary
    const shown = summary.text.length > 18000;
    this.addItem(id, 'system', 'handoff', { from: s.agent, to: agent, at: now(), summary: shown ? summary.text.slice(0, 18000) : summary.text, count: summary.count, truncated: summary.truncated || shown });
    const out = this.get(id); this.emit('session:update', out); return out;
  }
}

// «Auto» arrives on in an install that already had chats, once: the chats with a project that were at «Editar
// archivos» (the old default) move to «Auto» like the new ones; the window says so once, with «Usar Preguntar» at hand
// (src/ui/components/autonomy-switch.jsx › AutoNotice). A chat the owner had set to «Preguntar antes», «Solo lectura» or
// «Revisar y probar» keeps it. Nothing changes when the owner already chose «Preguntar» for everything.
export function adoptAuto(board) {
  if (board.setting('auto_mode_383')) return 0;
  board.setting('auto_mode_383', new Date().toISOString());
  if (globalAutonomy() !== 'auto') return 0;
  const moved = board.run("UPDATE sessions SET permission = 'auto' WHERE kind = 'chat' AND project IS NOT NULL AND permission = 'editar'").changes;
  return moved;
}
