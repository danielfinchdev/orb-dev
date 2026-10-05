// Claude Code adapter. 2.3: a live session through the official Claude Agent SDK (the same one T3 Code uses), driving the
// Claude Code the user installed (pathToClaudeCodeExecutable): its login, its subscription, nothing is copied. One process
// per conversation stays open between turns; answers stream as they are written; every action that needs permission goes
// through the guard (src/core/guard.mjs) and, when it must ask, to an approval card in the app.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, shimDirs, userHome, clip, describeInput, cleanEnv } from './common.mjs';
import { Turn, Approvals } from './live.mjs';
import { decide, describeAction } from '../core/guard.mjs';

export const id = 'claude';
export const label = 'Claude Code';
export const kind = 'sdk';
// What this agent can do live: pictures in the message, steer the running turn, native fork, approval requests, models.
export const caps = { images: true, steer: true, fork: true, approvals: true, models: true, context: true };

// The assistant's coordinator process never runs commands or edits (that is the agents' work).
export const COORDINATOR_DENIED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Task', 'Skill'];
// Lighter processes: only the project's own settings, and only the MCP servers Orb passes (strict-mcp-config).
export const LEAN_SOURCES = ['project', 'local'];

export function detect(cfg = {}) {
  const home = userHome();
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  const pkg = (dir) => path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', IS_WIN ? 'claude.exe' : 'claude');
  const candidates = [cfg.path, ...inPath('claude'), path.join(home, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude'),
    pkg(path.join(appData, 'npm')), ...shimDirs('claude').map(pkg)];
  const cmd = firstFile(candidates);
  return cmd ? { cmd, pre: [] } : null;
}

export function loginState() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(userHome(), '.claude');
  if (firstFile([path.join(dir, '.credentials.json')])) return 'si';
  // On some systems the credentials live in the OS keychain: the file is not proof of a missing login.
  return fs.existsSync(dir) ? 'desconocido' : 'no';
}

export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre] });

const textOf = (content) => Array.isArray(content) ? content.map((c) => c.text ?? (c.type === 'image' ? '[imagen]' : '')).join('\n') : String(content ?? '');
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// An endless input stream for the SDK (streaming input mode): send() pushes messages, close() ends it.
function inputQueue() {
  const items = []; let wake = null; let closed = false;
  return {
    push(msg) { items.push(msg); wake?.(); },
    close() { closed = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length) yield items.shift();
        if (closed) return;
        await new Promise((r) => { wake = r; });
        wake = null;
      }
    }
  };
}

function userMessage(text, images = []) {
  const content = [{ type: 'text', text }];
  for (const file of images) {
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type) continue;
    try { content.push({ type: 'image', source: { type: 'base64', media_type: type, data: fs.readFileSync(file).toString('base64') } }); } catch { /* unreadable: the path is in the text too */ }
  }
  return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } };
}

export const permissionModeOf = (p) => (p === 'total' ? 'bypassPermissions' : p === 'editar' ? 'acceptEdits' : 'default');

// options: exe, cwd, model, reasoning, permission, resumeId, newSessionId, forkSession, mcpServers, env, systemPrompt
// (appended to Claude Code's own), tools ({ allowed, disallowed }), addDirs, budgetUsd, internalDir, log, onEvent
export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const log = o.log ?? (() => {});
  const approvals = new Approvals(onEvent);
  const input = inputQueue();
  const abort = new AbortController();
  let permission = o.permission ?? 'editar';
  let turn = null; let query = null; let closed = false; let started = null;
  const live = {
    sessionId: o.resumeId ?? o.newSessionId ?? null,
    caps: { steer: true, approvals: true, fork: true, interrupt: true, context: true, models: true },
    pid: null,
    get busy() { return Boolean(turn && !turn.done); }
  };

  const canUseTool = async (toolName, toolInput, ctx = {}) => {
    const command = toolInput?.command ?? '';
    const paths = [toolInput?.file_path, toolInput?.path, toolInput?.notebook_path].filter(Boolean);
    const verdict = decide({ permission, tool: toolName, command, paths, internalDir: o.internalDir });
    if (verdict.decision === 'allow') return { behavior: 'allow', updatedInput: toolInput };
    if (verdict.decision === 'deny') return { behavior: 'deny', message: `Orb no lo permite: ${verdict.reason}.` };
    const answer = await approvals.ask({ id: ctx.toolUseID ?? `${toolName}-${Date.now()}`, tool: toolName, title: describeAction({ tool: toolName, command, paths }), reason: verdict.reason, input: describeInput(toolInput) });
    if (answer === 'deny') return { behavior: 'deny', message: 'El usuario no lo ha permitido. Busca otra forma o explica qué necesitas.' };
    return { behavior: 'allow', updatedInput: toolInput, ...(answer === 'always' && ctx.suggestions ? { updatedPermissions: ctx.suggestions } : {}) };
  };

  const handle = (m) => {
    if (m.session_id && m.session_id !== live.sessionId) { live.sessionId = m.session_id; onEvent({ type: 'session', id: m.session_id }); }
    if (m.type === 'system' && m.subtype === 'init') onEvent({ type: 'item', role: 'system', kind: 'status', body: `${label} · ${m.model ?? ''}`.trim() });
    if (m.type === 'stream_event' && !m.parent_tool_use_id) {
      const e = m.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') onEvent({ type: 'delta', text: e.delta.text });
    }
    if (m.type === 'assistant') {
      const sub = Boolean(m.parent_tool_use_id); // a subagent's step: shown, but not part of the final answer
      for (const part of m.message?.content ?? []) {
        if (part.type === 'text' && part.text?.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: part.text, sub }); if (!sub) turn?.addText(part.text); }
        if (part.type === 'thinking' && part.thinking?.trim()) onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: clip(part.thinking, 4000) });
        if (part.type === 'tool_use') onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: part.id, name: String(part.name ?? '').replace(/^mcp__orb__/, 'orb:'), input: describeInput(part.input), sub } });
      }
    }
    if (m.type === 'user') {
      for (const part of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (part.type === 'tool_result') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: part.tool_use_id, output: clip(textOf(part.content), 3000), error: Boolean(part.is_error) } });
      }
    }
    if (m.type === 'rate_limit_event') {
      const r = m.rate_limit_info ?? {};
      const resetAt = r.resetsAt ? r.resetsAt * 1000 : null;
      onEvent({ type: 'rate', status: r.status, resetAt, utilization: r.utilization ?? null, window: r.rateLimitType ?? null });
      if (r.status === 'rejected') { onEvent({ type: 'limit', resetAt, message: 'límite de uso de Claude alcanzado' }); if (turn) turn.limit = { resetAt }; }
    }
    if (m.type === 'result') {
      const usage = { costUsd: m.total_cost_usd ?? null, inputTokens: m.usage?.input_tokens ?? null, outputTokens: m.usage?.output_tokens ?? null, cacheReadTokens: m.usage?.cache_read_input_tokens ?? null, cacheWriteTokens: m.usage?.cache_creation_input_tokens ?? null, turns: m.num_turns ?? null };
      onEvent({ type: 'item', role: 'system', kind: 'usage', body: usage });
      const isError = Boolean(m.is_error) || Boolean(m.subtype && m.subtype !== 'success');
      const final = typeof m.result === 'string' && m.result ? m.result : turn?.text ?? '';
      if (isError) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(final || m.subtype || 'error', 3000) });
      if (isError && /usage limit|rate limit|limit reached|resets? (at|in)/i.test(final) && turn && !turn.limit) turn.limit = { resetAt: null };
      turn?.finish({ final, isError, usage, stopReason: m.subtype ?? null });
      // How full the context is, for the meter in the window (best effort; older CLIs do not answer).
      query?.getContextUsage?.().then((c) => onEvent({ type: 'context', used: c.totalTokens, size: c.maxTokens || c.rawMaxTokens })).catch(() => {});
    }
  };

  const start = async () => {
    const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
    const options = {
      cwd: o.cwd,
      pathToClaudeCodeExecutable: o.exe.cmd,
      env: cleanEnv(o.env ?? {}),
      model: o.model || undefined,
      effort: o.reasoning || 'medium',
      includePartialMessages: true,
      settingSources: LEAN_SOURCES,
      extraArgs: { 'strict-mcp-config': null },
      mcpServers: o.mcpServers ?? {},
      additionalDirectories: o.addDirs ?? [],
      abortController: abort,
      canUseTool,
      permissionMode: permissionModeOf(permission),
      stderr: (d) => log(`stderr: ${d}`),
      settings: { fastMode: false }
    };
    if (o.resumeId) options.resume = o.resumeId; else if (o.newSessionId) options.sessionId = o.newSessionId;
    if (o.forkSession) options.forkSession = true;
    if (o.systemPrompt) options.systemPrompt = { type: 'preset', preset: 'claude_code', append: o.systemPrompt };
    if (o.tools?.allowed?.length) options.allowedTools = o.tools.allowed;
    const disallowed = [...(o.tools?.disallowed ?? []), ...(permission === 'leer' ? ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'] : [])];
    if (disallowed.length) options.disallowedTools = disallowed;
    if (permission === 'total') options.allowDangerouslySkipPermissions = true;
    if (o.budgetUsd) options.maxBudgetUsd = o.budgetUsd;
    query = sdkQuery({ prompt: input, options });
    (async () => {
      try { for await (const m of query) { log(JSON.stringify(m).slice(0, 4000)); handle(m); } }
      catch (error) {
        log(`fin con error: ${error?.stack ?? error}`);
        if (turn && !turn.done) turn.finish({ isError: true, final: closed ? 'Detenido.' : `${label} se cerró: ${error?.message ?? error}` });
      } finally {
        closed = true; approvals.clear();
        onEvent({ type: 'exit', code: 0, stderr: '' });
        if (turn && !turn.done) turn.finish({ isError: !turn.text, final: turn.text || `${label} se cerró antes de terminar.` });
      }
    })();
  };

  live.send = async ({ text, images = [] }) => {
    if (closed) throw new Error(`la sesión de ${label} se ha cerrado`);
    if (turn && !turn.done) throw new Error('el agente sigue trabajando');
    turn = new Turn();
    const current = turn;
    started ??= start().catch((error) => { closed = true; current.finish({ isError: true, final: `No se pudo arrancar ${label}: ${error.message}` }); });
    await started;
    if (!closed) input.push(userMessage(text, images));
    return current.promise;
  };
  // A message for the running turn: Claude reads it at its next step (between tool calls).
  live.steer = ({ text }) => { if (closed || !turn || turn.done) return false; input.push({ ...userMessage(text), priority: 'now' }); return true; };
  live.interrupt = async () => { approvals.clear(); try { await query?.interrupt(); } catch { /* not running */ } };
  live.respond = (requestId, decision) => approvals.respond(requestId, decision);
  live.setModel = async (model) => { o.model = model; try { await query?.setModel(model || undefined); } catch { /* next start */ } };
  live.setPermission = async (p) => { permission = p; try { await query?.setPermissionMode(permissionModeOf(p)); } catch { /* next start */ } };
  live.close = () => { if (closed && !query) return; closed = true; approvals.clear(); input.close(); try { query?.close(); } catch { /* gone */ } try { abort.abort(); } catch { /* gone */ } };
  live.isClosed = () => closed;
  return live;
}
