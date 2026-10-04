// Live sessions: a conversation with one agent in one folder. Direct conversations (T3 Code style) and task runs launched
// by the scheduler use the same machinery: every turn is one CLI process whose JSON events become items the window shows
// as they arrive; the next turn resumes the CLI's own conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ctx } from '../core/context.mjs';
import { adapter, executable } from '../agents/index.mjs';
import { cleanEnv, killTree, orbMcpServer } from '../agents/common.mjs';
import { writeMcpConfig } from '../agents/claude.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { git, isGitRepo, repoRoot } from '../core/workspace.mjs';
import { account as findAccount, defaultAccount, accountEnv } from '../core/accounts.mjs';
import { browserKey } from '../core/browser-key.mjs';

export const PERMISSIONS = ['leer', 'editar', 'total'];
export const ATTACH_DIR = '.orb-adjuntos';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const ATTACH_MAX = 20 * 1024 * 1024;
const now = () => new Date().toISOString();
const parseRow = (row) => row && { ...row, archived: Boolean(row.archived) };
const parseItem = (row) => { let body = row.body; if (/^[[{]/.test(body)) { try { body = JSON.parse(body); } catch { /* plain text */ } } return { ...row, body }; };

export const browserOn = () => Boolean(ctx.browser) && ctx.config.browser?.enabled !== false;
// What the agent process needs in its environment for the browser tools (Claude expands ${VAR} in its MCP file): the key of
// this conversation's page only.
export const browserEnv = (agent, session, task = '') => (browserOn() ? { ORB_BROWSER_TOKEN: browserKey(ctx.browser.token, { agent, session: String(session), task: String(task || '') }) } : {});

// MCP servers handed to an agent: the assistant's board (with the browser tools when the app offers them) plus the
// user's own connectors enabled for that agent. session: which conversation, so its next turn reuses the same page.
export function mcpServersFor(agent, { taskId = '', orchestrator = false, browser = !orchestrator, session = '' } = {}) {
  const who = orchestrator ? 'orb' : agent;
  const env = { ORB_HOME: ctx.home, ORB_AGENT: who, ...(taskId ? { ORB_TASK_ID: String(taskId) } : {}) };
  if (orchestrator) env.ORB_ORCH_KEY = '${ORB_ORCH_KEY}'; // expanded by Claude from its own environment, never written in the file
  if (browser && session && browserOn()) {
    env.ORB_BROWSER_PIPE = ctx.browser.pipe;
    env.ORB_SESSION = String(session);
    // Claude reads it from its own environment; Codex only takes values (its command line, like the rest of its config).
    env.ORB_BROWSER_TOKEN = agent === 'claude' ? '${ORB_BROWSER_TOKEN}' : browserEnv(who, session, taskId).ORB_BROWSER_TOKEN;
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
    let st; try { st = fs.lstatSync(file); } catch { throw new Error(`no existe el adjunto ${file}`); }
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`el adjunto no es un archivo: ${file}`);
    if (!IMAGE_EXT.test(file)) throw new Error(`solo se adjuntan imágenes (png, jpg, gif, webp, bmp): ${path.basename(file)}`);
    if (st.size > ATTACH_MAX) throw new Error(`la imagen ${path.basename(file)} pasa de 20 MB`);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(file).replace(/[^\w.-]+/g, '_'));
    fs.copyFileSync(file, target);
    out.push(target);
  }
  if (isGitRepo(cwd)) {
    // --git-path answers relative to the folder git ran in (cwd), or absolute for worktrees.
    const exclude = git(cwd, 'rev-parse', '--git-path', 'info/exclude').stdout.trim() || path.join(repoRoot(cwd), '.git', 'info', 'exclude');
    const abs = path.resolve(cwd, exclude);
    try {
      const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      if (!text.split(/\r?\n/).includes(`${ATTACH_DIR}/`)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.appendFileSync(abs, `${text && !text.endsWith('\n') ? '\n' : ''}${ATTACH_DIR}/\n`); }
    } catch { /* not fatal: the commit step also skips this folder */ }
  }
  return out;
}

// One line for the live view: what the agent is doing now.
export function describeItem(item) {
  const b = item.body;
  if (item.kind === 'tool') return oneLine(`${b?.name ?? 'herramienta'}${b?.input ? `: ${b.input}` : ''}`, 140);
  if (item.kind === 'file') return oneLine(`${{ add: 'crea', delete: 'borra' }[b?.change] ?? 'edita'} ${b?.path ?? ''}`, 140);
  if (item.kind === 'reasoning') return 'pensando…';
  if (item.kind === 'text' && item.role === 'assistant') return oneLine(`escribe: ${b}`, 140);
  if (item.role === 'error') return oneLine(`error: ${b}`, 140);
  return null;
}

export class Sessions {
  // emit(event, payload): pushes changes to the window. log(line): engine log.
  constructor(board, { emit = () => {}, log = () => {} } = {}) {
    this.board = board; this.emit = emit; this.log = log;
    this.running = new Map(); // session id -> { child, stopped }
    // Sessions left "running" by a closed app are idle now (their process is gone).
    board.run("UPDATE sessions SET status = 'idle' WHERE status = 'running'");
  }

  list({ archived = false, kind } = {}) {
    return this.board.all(`SELECT * FROM sessions WHERE archived = ? ${kind ? 'AND kind = ?' : ''} ORDER BY updated_at DESC LIMIT 200`, Number(archived), ...(kind ? [kind] : [])).map(parseRow);
  }
  get(id) { return parseRow(this.board.one('SELECT * FROM sessions WHERE id = ?', String(id))); }
  must(id) { const s = this.get(id); if (!s) throw new Error('esa conversación ya no existe'); return s; }

  create({ kind = 'chat', agent, account = null, model = null, reasoning = 'medium', permission = 'editar', project = null, cwd, title, taskId = null }) {
    adapter(agent);
    const acc = account ? findAccount(account) : defaultAccount(agent);
    if (!acc || acc.agent !== agent) throw new Error(`la cuenta ${account} no es de ${agent}`);
    if (!PERMISSIONS.includes(permission)) throw new Error('permiso no válido');
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`la carpeta de trabajo no existe: ${cwd}`);
    const id = crypto.randomUUID(); const at = now();
    this.board.run(`INSERT INTO sessions (id, kind, agent, account, model, reasoning, permission, project, cwd, task_id, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`, id, kind, agent, acc.id, model || null, reasoning, permission, project, cwd, taskId, oneLine(title || 'Conversación', 80), at, at);
    const s = this.get(id); this.emit('session:update', s); return s;
  }

  update(id, fields) {
    const allowed = ['title', 'model', 'reasoning', 'permission', 'archived', 'status', 'cli_session', 'cwd', 'account'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(id);
    if ('permission' in fields && !PERMISSIONS.includes(fields.permission)) throw new Error('permiso no válido');
    this.board.run(`UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k] ?? null)), now(), id);
    const s = this.get(id); this.emit('session:update', s); return s;
  }

  remove(id) {
    if (this.running.has(id)) throw new Error('la conversación está trabajando: detenla antes');
    const s = this.must(id); if (s.kind === 'task') throw new Error('la conversación de una tarea se borra con la tarea');
    this.board.run('DELETE FROM session_items WHERE session_id = ?', id);
    this.board.run('DELETE FROM sessions WHERE id = ?', id);
    this.emit('session:removed', { id });
  }

  items(id, { after = 0, limit = 400 } = {}) {
    const rows = this.board.all('SELECT * FROM (SELECT * FROM session_items WHERE session_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id', id, Number(after) || 0, Math.min(Number(limit) || 400, 2000));
    return rows.map(parseItem);
  }

  addItem(sessionId, role, kind, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const { lastInsertRowid } = this.board.run('INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, ?, ?, ?, ?)', sessionId, role, kind, text.slice(0, 20000), now());
    const item = { id: Number(lastInsertRowid), session_id: sessionId, role, kind, body, at: now() };
    this.emit('session:item', item);
    return item;
  }

  isRunning(id) { return this.running.has(id); }
  // What a running turn is doing right now (null when it is not running).
  live(id) { const r = this.running.get(id); return r ? { startedAt: r.startedAt, lastAt: r.lastAt, steps: r.steps, last: r.last } : null; }
  runningCount(agent) { return [...this.running.values()].filter((r) => !agent || r.agent === agent).length; }

  stop(id) {
    const run = this.running.get(id); if (!run) return false;
    run.stopped = true; killTree(run.child);
    return true;
  }
  stopAll() { for (const id of this.running.keys()) this.stop(id); }

  // One turn. options: images (absolute paths), prompt (what the agent receives, if it differs from what the user typed),
  // runDir (where the log goes), timeoutMs, budgetUsd, taskId, onFinish({ code, state, stderr, logFile, stopped }).
  send(id, text, { images = [], prompt, runDir, timeoutMs = (ctx.config.timeoutMinutes ?? 60) * 60_000, budgetUsd, taskId, onFinish, showUser = true } = {}) {
    const s = this.must(id);
    if (this.running.has(id)) throw new Error('el agente sigue trabajando en esta conversación: espera o detenlo');
    if (!String(text ?? '').trim() && !images.length) throw new Error('escribe un mensaje');
    // The conversation's own account: if it was removed, the turn does not silently move to another subscription.
    const acc = s.account ? findAccount(s.account) : defaultAccount(s.agent);
    if (!acc) throw new Error(`la cuenta ${s.account} ya no existe: empieza una conversación nueva con otra cuenta`);
    const exe = executable(s.agent);
    const a = adapter(s.agent);
    const dir = runDir ?? path.join(ctx.paths.runs, 'conversaciones', s.id);
    fs.mkdirSync(dir, { recursive: true });
    const attached = placeAttachments(images, s.cwd);
    if (showUser) this.addItem(id, 'user', 'text', attached.length ? { text, images: attached } : text);
    let body = prompt ?? text;
    if (attached.length && s.agent !== 'codex') body += `\n\nImágenes de referencia (ábrelas para verlas):\n${attached.map((f) => `- ${f}`).join('\n')}`;
    const promptFile = path.join(dir, 'ultimo-mensaje.md');
    fs.writeFileSync(promptFile, body);
    const servers = mcpServersFor(s.agent, { taskId, session: s.id });
    // Claude keeps the id the app chooses; Codex and Cursor report theirs in the first events.
    let session = s.cli_session ? { id: s.cli_session, resume: true } : null;
    if (s.agent === 'claude' && !session) { session = { id: crypto.randomUUID(), resume: false }; this.update(id, { cli_session: session.id }); }
    const mcpFile = s.agent === 'claude' ? writeMcpConfig(path.join(dir, 'mcp.json'), servers) : null;
    const cmd = a.buildTurn({ exe, cwd: s.cwd, prompt: body, promptFile, model: s.model, reasoning: s.reasoning, permission: s.permission, session, mcpFile, mcpServers: servers, images: s.agent === 'codex' ? attached : [], budgetUsd, cfg: ctx.config.agents[s.agent] });
    const logFile = path.join(dir, 'registro.jsonl');
    rotateIfBig(logFile);
    fs.appendFileSync(logFile, `${JSON.stringify({ orb: 'turno', at: now(), agent: s.agent, model: s.model, permission: s.permission, resume: Boolean(session?.resume) })}\n`);
    const parser = a.createParser();
    let child;
    try {
      // The account's login folder (CLAUDE_CONFIG_DIR / CODEX_HOME) goes last, so nothing else can point the CLI elsewhere.
      child = spawn(cmd.cmd, cmd.args, { cwd: s.cwd, env: cleanEnv({ ...(cmd.env ?? {}), ...accountEnv(acc), ...browserEnv(s.agent, s.id, taskId), ORB_HOME: ctx.home, ORB_AGENT: s.agent, ...(taskId ? { ORB_TASK_ID: String(taskId) } : {}) }), windowsHide: true, stdio: [cmd.stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this.addItem(id, 'error', 'text', `No se pudo arrancar ${a.label}: ${error.message}`);
      onFinish?.({ code: -1, state: parser.state, stderr: error.message, logFile, stopped: false });
      return null;
    }
    // Live view of the turn (Tareas and the chat show it): when it started, steps taken, last sign of life and what it did.
    const run = { child, agent: s.agent, stopped: false, startedAt: Date.now(), lastAt: Date.now(), steps: 0, last: 'arrancando…' };
    this.running.set(id, run);
    this.update(id, { status: 'running' });
    if (cmd.stdin != null) { child.stdin.on('error', () => {}); child.stdin.end(cmd.stdin); }
    const log = fs.openSync(logFile, 'a');
    let buffer = ''; let stderr = ''; let known = session?.id ?? null; // the CLI's session id, kept here instead of re-reading the row per line
    const handle = (line) => {
      if (!line.trim()) return;
      try { fs.writeSync(log, `${line}\n`); } catch { /* log closed */ }
      run.lastAt = Date.now();
      for (const item of parser.push(line)) { this.addItem(id, item.role, item.kind, item.body); const what = describeItem(item); if (what) run.last = what; if (item.kind === 'tool' || item.kind === 'file') run.steps++; }
      if (parser.state.cliSession && parser.state.cliSession !== known) { known = parser.state.cliSession; this.update(id, { cli_session: known }); }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
      if (buffer.length > 8 * 1024 * 1024) buffer = ''; // a single runaway line must not eat the memory
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); run.lastAt = Date.now(); });
    const timer = timeoutMs ? setTimeout(() => { this.addItem(id, 'error', 'text', `Tiempo máximo alcanzado (${Math.round(timeoutMs / 60000)} min): se detiene.`); run.stopped = true; run.timedOut = true; killTree(child); }, timeoutMs) : null;
    let ended = false;
    const end = (code) => {
      if (ended) return; ended = true;
      if (timer) clearTimeout(timer);
      if (buffer.trim()) handle(buffer);
      try { fs.writeSync(log, `${JSON.stringify({ orb: 'fin', at: now(), code, stderr: stderr.slice(-2000) })}\n`); fs.closeSync(log); } catch { /* closed */ }
      this.running.delete(id);
      const failed = code !== 0 && !run.stopped;
      if (failed && !parser.state.isError) this.addItem(id, 'error', 'text', `${a.label} terminó con un error (código ${code}). ${oneLine(stderr, 600)}`.trim());
      // A conversation that cannot be resumed (old or deleted on the CLI side) starts over on the next message.
      if (failed && session?.resume && !parser.state.text) { this.update(id, { cli_session: null }); this.addItem(id, 'system', 'status', 'No se pudo retomar la conversación del agente: el próximo mensaje empezará una nueva (este historial se conserva aquí).'); }
      if (run.stopped && !run.timedOut) this.addItem(id, 'system', 'status', 'Detenido.');
      this.update(id, { status: failed ? 'error' : 'idle' });
      try { onFinish?.({ code, state: parser.state, stderr, logFile, stopped: run.stopped, timedOut: Boolean(run.timedOut) }); } catch (error) { this.log(`onFinish ${id}: ${error.stack}`); }
    };
    child.on('error', (error) => { stderr += `\n${error.message}`; end(-1); });
    child.on('close', (code) => end(code ?? -1));
    return run;
  }
}
