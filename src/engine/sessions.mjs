// Live sessions: a conversation with one agent in one folder. Direct conversations (T3 Code style) and task runs launched
// by the scheduler use the same machinery. 2.3: every conversation keeps ONE live process of its agent open between turns
// (src/agents/live.mjs): answers stream as they are written, the user can steer the running turn or queue messages,
// approval requests show up as cards, the context meter fills up, and a closed app resumes the agent's own conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../core/context.mjs';
import { adapter, executable } from '../agents/index.mjs';
import { orbMcpServer } from '../agents/common.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { git, isGitRepo, repoRoot } from '../core/workspace.mjs';
import { account as findAccount, defaultAccount, accountEnv } from '../core/accounts.mjs';
import { browserKey } from '../core/browser-key.mjs';
import { PERMISSIONS } from '../core/guard.mjs';
import { explainFailure } from '../core/agent-errors.mjs';
import { rememberModels } from './catalog.mjs';

export { PERMISSIONS };
export const ATTACH_DIR = '.orb-adjuntos';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const ATTACH_MAX = 20 * 1024 * 1024;
const IDLE_CLOSE_MS = 20 * 60_000; // a live process with nothing to do for this long is closed (it resumes on the next message)
const now = () => new Date().toISOString();
const parseJson = (v, fallback = null) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const parseRow = (row) => row && { ...row, archived: Boolean(row.archived), settled: Boolean(row.settled), context: parseJson(row.context) };
const parseItem = (row) => { let body = row.body; if (/^[[{]/.test(body)) { try { body = JSON.parse(body); } catch { /* plain text */ } } return { ...row, body }; };
const bodyText = (body) => (typeof body === 'string' ? body : body?.text ?? '');

export const browserOn = () => Boolean(ctx.browser) && ctx.config.browser?.enabled !== false;
// What the agent process needs in its environment for the browser tools: the key of this conversation's page only.
export const browserEnv = (agent, session, task = '') => (browserOn() ? { ORB_BROWSER_TOKEN: browserKey(ctx.browser.token, { agent, session: String(session), task: String(task || '') }) } : {});

// Orb's signature of who a worker's MCP process is (agent and task): made with a key that lives only in the engine's
// memory (a new one each start, which retires the old signatures); the database keeps just the hash, for the MCP to look
// it up. The same agent and task always get the same signature, so the table does not grow with every turn.
export function agentToken(board, agent, taskId = '') {
  if (!agentKey) { agentKey = crypto.randomBytes(32); board.run("DELETE FROM settings WHERE key LIKE 'agent_id:%'"); }
  const token = crypto.createHmac('sha256', agentKey).update(`${agent}|${taskId}`).digest('hex');
  board.settingJson(`agent_id:${crypto.createHash('sha256').update(token).digest('hex')}`, { agent, task: taskId ? Number(taskId) : null });
  return token;
}
let agentKey = null;

// MCP servers handed to an agent: the assistant's board (with the browser tools when the app offers them) plus the
// user's own connectors enabled for that agent. session: which conversation, so its next turn reuses the same page.
export function mcpServersFor(agent, { board, taskId = '', orchestrator = false, browser = !orchestrator, session = '', orchKey = '' } = {}) {
  const who = orchestrator ? 'orb' : agent;
  const env = { ORB_HOME: ctx.home, ORB_AGENT: who, ...(taskId ? { ORB_TASK_ID: String(taskId) } : {}) };
  if (!orchestrator && board) env.ORB_AGENT_TOKEN = agentToken(board, who, taskId);
  // The coordinator's key goes to its own MCP process only (handed in memory by the SDK, never written to a file).
  if (orchestrator && orchKey) env.ORB_ORCH_KEY = orchKey;
  if (browser && session && browserOn()) {
    env.ORB_BROWSER_PIPE = ctx.browser.pipe;
    env.ORB_SESSION = String(session);
    env.ORB_BROWSER_TOKEN = browserEnv(who, session, taskId).ORB_BROWSER_TOKEN;
  }
  const servers = { orb: orbMcpServer(env) };
  if (!orchestrator) {
    for (const s of ctx.config.mcpServers ?? []) {
      if (s.enabled === false || (s.agents?.length && !s.agents.includes(agent))) continue;
      servers[s.name] = { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) };
    }
  }
  return servers;
}

// Reference pictures: copied into <folder>/.orb-adjuntos/<stamp>/ so every agent can read them, and kept out of git.
export function placeAttachments(files, cwd) {
  const list = (files ?? []).slice(0, 10);
  if (!list.length) return [];
  const dir = path.join(cwd, ATTACH_DIR, String(Date.now()));
  const out = [];
  for (const file of list) {
    let st; try { st = fs.lstatSync(file); } catch { throw new Error(tr('msg.sessions.noAttachment', { file })); }
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(tr('msg.sessions.attachNotFile', { file }));
    if (!IMAGE_EXT.test(file)) throw new Error(tr('msg.sessions.imagesOnly', { name: path.basename(file) }));
    if (st.size > ATTACH_MAX) throw new Error(tr('msg.sessions.imageTooBig', { name: path.basename(file) }));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(file).replace(/[^\w.-]+/g, '_'));
    fs.copyFileSync(file, target);
    out.push(target);
  }
  keepOutOfGit(cwd);
  return out;
}

// The attachments folder (pictures, long instructions for Cursor) never goes into the project's git.
function keepOutOfGit(cwd) {
  if (isGitRepo(cwd)) {
    // --git-path answers relative to the folder git ran in (cwd), or absolute for worktrees.
    const exclude = git(cwd, 'rev-parse', '--git-path', 'info/exclude').stdout.trim() || path.join(repoRoot(cwd), '.git', 'info', 'exclude');
    const abs = path.resolve(cwd, exclude);
    try {
      const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      if (!text.split(/\r?\n/).includes(`${ATTACH_DIR}/`)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.appendFileSync(abs, `${text && !text.endsWith('\n') ? '\n' : ''}${ATTACH_DIR}/\n`); }
    } catch { /* not fatal: the commit step also skips this folder */ }
  }
}

// One line for the live view: what the agent is doing now.
export function describeItem(item) {
  const b = item.body;
  if (item.kind === 'tool') return oneLine(`${b?.name ?? tr('msg.sessions.tool')}${b?.input ? `: ${b.input}` : ''}`, 140);
  if (item.kind === 'file') return oneLine(`${{ add: tr('msg.sessions.fileAdd'), delete: tr('msg.sessions.fileDelete') }[b?.change] ?? tr('msg.sessions.fileEdit')} ${b?.path ?? ''}`, 140);
  if (item.kind === 'reasoning') return tr('msg.sessions.thinking');
  if (item.kind === 'approval') return oneLine(tr('msg.sessions.waitingPermission', { title: b?.title ?? '' }), 140);
  if (item.kind === 'text' && item.role === 'assistant') return oneLine(tr('msg.sessions.writes', { text: bodyText(b) }), 140);
  if (item.role === 'error') return oneLine(tr('msg.sessions.errorLine', { text: bodyText(b) }), 140);
  return null;
}

export class Sessions {
  // emit(event, payload): pushes changes to the window. log(line): engine log.
  constructor(board, { emit = () => {}, log = () => {} } = {}) {
    this.board = board; this.emit = emit; this.log = log;
    this.running = new Map();   // session id -> the running turn { agent, startedAt, lastAt, steps, last, stopped, live }
    this.lives = new Map();     // session id -> { live, key, lastUsed, logFile }
    this.approvals = new Map(); // `${session}:${request}` -> item id of its card
    this.onApproval = () => {}; // set by the engine: a notice in the chat when a task waits for a click
    this.onRate = () => {};     // set by the engine: the real usage each account reports (budget)
    // Sessions left "running" by a closed app: their process is gone. Marked "interrupted" so they can continue.
    board.run("UPDATE sessions SET status = 'interrupted' WHERE status = 'running'");
    // Approval cards left open by a closed app can no longer be answered.
    for (const row of board.all("SELECT id, body FROM session_items WHERE kind = 'approval' AND body LIKE '%\"status\":\"pending\"%'")) {
      const item = parseItem(row); board.run('UPDATE session_items SET body = ? WHERE id = ?', JSON.stringify({ ...item.body, status: 'expired' }), row.id);
    }
    this.sweeper = setInterval(() => this.closeIdle(), 60_000);
    this.sweeper.unref?.();
  }

  list({ archived = false, kind } = {}) {
    return this.board.all(`SELECT * FROM sessions WHERE archived = ? ${kind ? 'AND kind = ?' : ''} ORDER BY updated_at DESC LIMIT 300`, Number(archived), ...(kind ? [kind] : [])).map(parseRow);
  }
  get(id) { return parseRow(this.board.one('SELECT * FROM sessions WHERE id = ?', String(id))); }
  must(id) { const s = this.get(id); if (!s) throw new Error(tr('msg.sessions.noConversation')); return s; }

  create({ kind = 'chat', agent, account = null, model = null, reasoning = 'medium', permission = 'editar', project = null, cwd, title, taskId = null, parentId = null }) {
    adapter(agent);
    const acc = account ? findAccount(account) : defaultAccount(agent);
    if (!acc || acc.agent !== agent) throw new Error(tr('msg.sessions.accountNotOf', { account, agent }));
    if (!PERMISSIONS.includes(permission)) throw new Error(tr('msg.sessions.badPermission'));
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(tr('msg.sessions.noCwd', { cwd }));
    const id = crypto.randomUUID(); const at = now();
    // No model chosen = the agent's default from Agentes (Sonnet for Claude), never its CLI's own default (which can be the
    // most expensive one).
    const chosen = model || ctx.config.agents[agent]?.defaultModel || null;
    this.board.run(`INSERT INTO sessions (id, kind, agent, account, model, reasoning, permission, project, cwd, task_id, title, status, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`, id, kind, agent, acc.id, chosen, reasoning, permission, project, cwd, taskId, oneLine(title || tr('msg.sessions.defaultTitle'), 80), parentId, at, at);
    const s = this.get(id); this.emit('session:update', s); return s;
  }

  update(id, fields) {
    const allowed = ['title', 'model', 'reasoning', 'permission', 'archived', 'status', 'cli_session', 'cwd', 'account', 'settled', 'context'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(id);
    if ('permission' in fields && !PERMISSIONS.includes(fields.permission)) throw new Error(tr('msg.sessions.badPermission'));
    const value = (k) => { const v = fields[k]; if (typeof v === 'boolean') return Number(v); if (v && typeof v === 'object') return JSON.stringify(v); return v ?? null; };
    this.board.run(`UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(value), now(), id);
    // The live process follows the changes it can take on the fly; the rest apply when it starts again.
    const entry = this.lives.get(id);
    if (entry) {
      if ('model' in fields) { if (entry.live.caps.models) entry.live.setModel?.(fields.model); else if (!this.running.has(id)) this.closeLive(id); }
      if ('permission' in fields) entry.live.setPermission?.(fields.permission);
      if ('reasoning' in fields && !this.running.has(id)) this.closeLive(id);
      if ('cwd' in fields || 'account' in fields) this.closeLive(id);
    }
    const s = this.get(id); this.emit('session:update', s); return s;
  }

  remove(id) {
    if (this.running.has(id)) throw new Error(tr('msg.sessions.stopFirst'));
    const s = this.must(id); if (s.kind === 'task') throw new Error(tr('msg.sessions.taskSession'));
    this.closeLive(id);
    this.board.run('DELETE FROM session_items WHERE session_id = ?', id);
    this.board.run('DELETE FROM session_queue WHERE session_id = ?', id);
    this.board.run('DELETE FROM sessions WHERE id = ?', id);
    this.emit('session:removed', { id });
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
      this.emit('approval:changed', { session: sessionId });
    }
    throw new Error(tr('msg.sessions.requestGone'));
  }

  // ---- the live process of a conversation
  liveKey(s, acc) { return [s.agent, acc.id, s.cwd, s.reasoning].join('|'); }

  closeLive(id) {
    const entry = this.lives.get(id); if (!entry) return;
    this.lives.delete(id);
    try { entry.live.close(); } catch { /* gone */ }
  }
  closeIdle() {
    for (const [id, entry] of this.lives) if (!this.running.has(id) && Date.now() - entry.lastUsed > IDLE_CLOSE_MS) this.closeLive(id);
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
    rotateIfBig(logFile);
    const writeLog = (line) => { try { fs.appendFileSync(logFile, `${String(line).replace(/\r?\n/g, ' ')}\n`); } catch { /* log unavailable */ } };
    // A fork waiting to happen: the agent copies the original conversation natively (Claude, Codex).
    const forkFrom = this.board.settingJson(`fork_pending:${s.id}`);
    if (forkFrom) this.board.settingJson(`fork_pending:${s.id}`, null);
    writeLog(JSON.stringify({ orb: 'sesion', at: now(), agent: s.agent, model: s.model, permission: s.permission, resume: Boolean(s.cli_session), fork: Boolean(forkFrom) }));
    // Claude keeps the id the app chooses; the other agents (and forks) report theirs in their first events.
    const newSessionId = !s.cli_session && !forkFrom && s.agent === 'claude' ? crypto.randomUUID() : null;
    if (newSessionId) this.update(s.id, { cli_session: newSessionId });
    const entry = { key, lastUsed: Date.now(), logFile, live: null };
    // Long instructions Cursor gets in a file go to the attachments folder (out of git), not among the project's files.
    const promptDir = path.join(s.cwd, ATTACH_DIR);
    if (s.agent === 'cursor') keepOutOfGit(s.cwd);
    entry.live = a.createLive({
      promptDir,
      exe, cwd: s.cwd, model: s.model, reasoning: s.reasoning, permission: s.permission,
      resumeId: forkFrom || s.cli_session || null, forkSession: Boolean(forkFrom), newSessionId,
      mcpServers: mcpServersFor(s.agent, { board: this.board, taskId, session: s.id }), budgetUsd,
      env: { ...accountEnv(acc), ...browserEnv(s.agent, s.id, taskId), ORB_HOME: ctx.home, ORB_AGENT: s.agent, ...(taskId ? { ORB_TASK_ID: String(taskId) } : {}) },
      internalDir: ctx.paths.internal, lang: ctx.config.language, log: writeLog, cfg: ctx.config.agents[s.agent] ?? {},
      onEvent: (ev) => this.onLiveEvent(s.id, ev)
    });
    this.lives.set(s.id, entry);
    return entry;
  }

  onLiveEvent(id, ev) {
    const run = this.running.get(id);
    if (run) run.lastAt = Date.now();
    if (ev.type === 'models') { const s = this.get(id); if (s) rememberModels(this.board, s.agent, ev.list); return; }
    if (ev.type === 'item') {
      const item = this.addItem(id, ev.role, ev.kind, ev.body);
      if (run) { const what = describeItem(item); if (what) run.last = what; if (ev.kind === 'tool' || ev.kind === 'file') run.steps++; }
      return;
    }
    if (ev.type === 'delta') { this.emit('session:delta', { id, text: ev.text }); return; }
    if (ev.type === 'session') { if (ev.id && this.get(id)?.cli_session !== ev.id) this.update(id, { cli_session: ev.id }); return; }
    if (ev.type === 'approval') {
      const r = ev.request;
      const item = this.addItem(id, 'system', 'approval', { id: r.id, tool: r.tool, title: r.title, reason: r.reason, input: r.input, status: 'pending' });
      this.approvals.set(`${id}:${r.id}`, item.id);
      if (run) run.last = describeItem(item);
      this.emit('approval:changed', { session: id });
      try { this.onApproval(this.get(id), item); } catch (error) { this.log(`aviso de aprobación: ${error.message}`); }
      return;
    }
    if (ev.type === 'approval_done') {
      const key = `${id}:${ev.id}`; const itemId = this.approvals.get(key);
      if (itemId) {
        const row = this.board.one('SELECT * FROM session_items WHERE id = ?', itemId);
        if (row) this.updateItem(itemId, { ...parseItem(row).body, status: ev.decision === 'deny' ? 'denied' : ev.decision === 'always' ? 'always' : 'allowed' });
        this.approvals.delete(key);
      }
      this.emit('approval:changed', { session: id });
      return;
    }
    if (ev.type === 'context') { if (ev.size) this.update(id, { context: { used: ev.used, size: ev.size, at: now() } }); return; }
    if (ev.type === 'rate') { const s = this.get(id); try { this.onRate(s?.account ?? s?.agent, ev); } catch { /* budget only */ } return; }
    if (ev.type === 'exit') { if (!this.running.has(id) && this.lives.get(id)?.live.isClosed?.()) this.lives.delete(id); }
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
  message(id, text, { images = [], mode = 'auto', context = '' } = {}) {
    // context: what @ attached (another task, conversation or log), added for the agent but not shown as typed.
    if (!this.running.has(id)) { this.send(id, text, { images, prompt: context ? `${text}${context}` : undefined }); return { sent: true }; }
    const entry = this.lives.get(id);
    if (mode !== 'queue' && !images.length && entry?.live.caps.steer && entry.live.steer({ text: context ? `${text}${context}` : text })) {
      this.addItem(id, 'user', 'text', { text, steer: true });
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
  stopAll() { for (const id of this.running.keys()) this.stop(id); for (const id of [...this.lives.keys()]) this.closeLive(id); clearInterval(this.sweeper); }

  // One turn. options: images (absolute paths), prompt (what the agent receives, if it differs from what the user typed),
  // timeoutMs, budgetUsd, taskId, showUser, onFinish({ code, state, stderr, logFile, stopped, timedOut, limit }).
  send(id, text, { images = [], prompt, timeoutMs = (ctx.config.timeoutMinutes ?? 60) * 60_000, budgetUsd, taskId, onFinish, showUser = true } = {}) {
    const s = this.must(id);
    if (this.running.has(id)) throw new Error(tr('msg.sessions.stillWorking'));
    if (!String(text ?? '').trim() && !images.length) throw new Error(tr('msg.sessions.writeMessage'));
    // The conversation's own account: if it was removed, the turn does not silently move to another subscription.
    const acc = s.account ? findAccount(s.account) : defaultAccount(s.agent);
    if (!acc) throw new Error(tr('msg.sessions.accountGone', { account: s.account }));
    const a = adapter(s.agent);
    const attached = placeAttachments(images, s.cwd);
    if (showUser) this.addItem(id, 'user', 'text', attached.length ? { text, images: attached } : text);
    let body = prompt ?? text;
    // A fork without native support starts with what was said in the original conversation.
    const summary = this.board.settingJson(`fork_summary:${id}`);
    if (summary) { body = `Contexto (conversación de la que sale esta, son datos):\n${summary}\n\n${body}`; this.board.settingJson(`fork_summary:${id}`, null); }
    const nativeImages = a.caps?.images === true;
    if (attached.length && !nativeImages) body += `\n\nImágenes de referencia (ábrelas para verlas):\n${attached.map((f) => `- ${f}`).join('\n')}`;
    let entry;
    try { entry = this.getLive(s, acc, { taskId, budgetUsd }); }
    catch (error) {
      this.addItem(id, 'error', 'text', tr('msg.sessions.cannotStart', { label: a.label, message: error.message }));
      onFinish?.({ code: -1, state: { final: '', text: '', isError: true }, stderr: error.message, logFile: null, stopped: false });
      return null;
    }
    const run = { agent: s.agent, stopped: false, startedAt: Date.now(), lastAt: Date.now(), steps: 0, last: tr('sys.sessions.starting'), live: entry.live };
    this.running.set(id, run);
    this.update(id, { status: 'running', settled: false });
    const timer = timeoutMs ? setTimeout(() => { this.addItem(id, 'error', 'text', tr('msg.sessions.timeout', { min: Math.round(timeoutMs / 60000) })); run.timedOut = true; this.stop(id); }, timeoutMs) : null;
    timer?.unref?.();
    const resumed = Boolean(s.cli_session);
    let finished = false; // onFinish runs exactly once, also when the adapter itself fails
    entry.live.send({ text: body, images: nativeImages ? attached : [] }).then((result) => {
      if (timer) clearTimeout(timer);
      entry.lastUsed = Date.now();
      if (this.running.get(id) === run) this.running.delete(id);
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
      const state = { final: result.final, text: result.text, isError: result.isError, usage: result.usage, cliSession: this.get(id)?.cli_session };
      finished = true;
      try { onFinish?.({ code: result.isError ? 1 : 0, state, stderr: result.isError ? result.final : '', logFile: entry.logFile, stopped: run.stopped, timedOut: Boolean(run.timedOut), limit: result.limit }); }
      catch (error) { this.log(`onFinish ${id}: ${error.stack}`); }
      // Messages written while it worked go now, in order (not after a stop or a limit: then the user decides).
      if (!run.stopped && !limited && !onFinish) {
        const next = this.takeQueued(id);
        if (next) { try { this.send(id, next.text, { images: next.images }); } catch (error) { this.addItem(id, 'error', 'text', error.message); } }
      }
    }).catch((error) => {
      // send() itself failed (the adapter threw instead of ending the turn): the turn is over all the same, and a task must
      // hear it, or it would stay "running" forever with its folder locked.
      this.log(`turno ${id}: ${error.stack}`);
      if (timer) clearTimeout(timer);
      if (this.running.get(id) === run) this.running.delete(id);
      const final = `${a.label}: ${error.message}`;
      try { this.update(id, { status: 'error' }); this.addItem(id, 'error', 'text', final); } catch { /* the conversation may be gone */ }
      if (!finished) {
        finished = true;
        try { onFinish?.({ code: 1, state: { final, text: '', isError: true }, stderr: error.message, logFile: entry.logFile, stopped: run.stopped, timedOut: Boolean(run.timedOut) }); }
        catch (inner) { this.log(`onFinish ${id}: ${inner.stack}`); }
      }
    });
    return run;
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
  fork(id, { title } = {}) {
    const s = this.must(id);
    if (this.running.has(id)) throw new Error(tr('msg.sessions.forkWait'));
    const a = adapter(s.agent);
    const copy = this.create({ kind: 'chat', agent: s.agent, account: s.account, model: s.model, reasoning: s.reasoning, permission: s.permission,
      project: s.project, cwd: s.cwd, title: title || tr('msg.sessions.forkTitle', { title: s.title }), parentId: s.id });
    const old = this.board.all("SELECT role, kind, body, at FROM session_items WHERE session_id = ? AND kind = 'text' AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT 40", s.id).reverse();
    for (const it of old) this.board.run('INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, ?, ?, ?, ?)', copy.id, it.role, it.kind, it.body, it.at);
    this.addItem(copy.id, 'system', 'status', tr('msg.sessions.forked', { title: s.title }));
    if (a.caps?.fork && s.cli_session) this.board.settingJson(`fork_pending:${copy.id}`, s.cli_session);
    else if (old.length) this.board.settingJson(`fork_summary:${copy.id}`, old.map((it) => `${it.role === 'user' ? 'Usuario' : 'Agente'}: ${oneLine(bodyText(parseItem(it).body), 400)}`).join('\n'));
    return copy;
  }
}
