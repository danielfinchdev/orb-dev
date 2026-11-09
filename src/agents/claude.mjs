// Claude Code adapter. 2.3: a live session through the official Claude Agent SDK, driving the
// Claude Code the user installed (pathToClaudeCodeExecutable): its login, its subscription, nothing is copied. One process
// per conversation stays open between turns; answers stream as they are written; every action that needs permission goes
// through the guard (src/core/guard.mjs) and, when it must ask, to an approval card in the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { IS_WIN, firstFile, inPath, npmPrefixes, userHome, clip, describeInput, cleanEnv, within, discoverDir, killTree, mcpEnvByRef } from './common.mjs';
import { Turn, Approvals } from './live.mjs';
import { decide, describeAction } from '../core/guard.mjs';
import { tr } from '../core/context.mjs';
import { logJson } from '../core/safety.mjs';

export const id = 'claude';
export const label = 'Claude Code';
export const kind = 'sdk';
// What this agent can do live: pictures in the message, steer the running turn, native fork, approval requests, models.
export const caps = { images: true, steer: true, fork: true, approvals: true, models: true, context: true, compact: true };

// The assistant's coordinator process never runs commands or edits (that is the agents' work).
// 3.8.2: a subagent (Claude Code's Agent tool, «Task» in older versions): its type, what it was asked and its model, so
// the conversation shows it as one row; the steps it takes name it as their parent (parent_tool_use_id).
export function subagentOf(name, input) {
  if (!['Agent', 'Task'].includes(name) || !input || typeof input !== 'object') return {};
  const text = (v, n) => (typeof v === 'string' && v.trim() ? clip(v.trim(), n) : null);
  return { agent: { name: text(input.subagent_type, 60) ?? 'general-purpose', description: text(input.description, 200), model: text(input.model, 60) } };
}
const stepOf = (m) => (m.parent_tool_use_id ? { parent: m.parent_tool_use_id } : {});
export const COORDINATOR_DENIED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Task', 'Skill'];
// Lighter processes: only the project's own settings, and only the MCP servers Orb passes (strict-mcp-config).
export const LEAN_SOURCES = ['project', 'local'];

// 3.8 (F2.6c): what in a project's .claude/settings*.json would let one agent change the next ones (a task can write that
// folder; the next agent may be another conversation's): programs Claude runs by itself (apiKeyHelper ran from a trusted
// project's settings in a real run, even with an API key set; the other *Helper, aws*/gcp* refresh, processWrapper,
// fileSuggestion, status lines), the environment of its commands and MCP servers (env: NODE_OPTIONS, PATH) and plugins.
// hooks are off anyway (disableAllHooks) and permission rules do not count (allowManagedPermissionRulesOnly). A file
// Orb cannot read as JSON counts too. → ["settings.json: env", …]
const RISKY_KEY = /^env$|helper|authrefresh|credential|wrapper|suggestion|statusline|plugin|marketplace|shell/i;
export function projectSettingsRisk(cwd) {
  const found = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(cwd, '.claude', name);
    if (!fs.existsSync(file)) continue;
    let json; try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { found.push(name); continue; }
    if (!json || typeof json !== 'object' || Array.isArray(json)) { found.push(name); continue; }
    for (const key of Object.keys(json)) if (RISKY_KEY.test(key)) found.push(`${name}: ${key}`);
  }
  return found;
}
// The project's CLAUDE.md files, for a Claude started without the project's settings (which also stops it reading them).
export function projectNotes(cwd) {
  const parts = [];
  for (const name of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']) {
    try { const text = fs.readFileSync(path.join(cwd, name), 'utf8').trim(); if (text) parts.push(`# ${name.replace(/\\/g, '/')}\n${text.slice(0, 40000)}`); } catch { /* none */ }
  }
  return parts.length ? `Instrucciones del proyecto (sus archivos CLAUDE.md):\n\n${parts.join('\n\n')}` : '';
}

export function detect(cfg = {}) {
  const home = userHome();
  const pkg = (dir) => path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', IS_WIN ? 'claude.exe' : 'claude');
  const candidates = [cfg.path, ...inPath('claude'), path.join(home, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude'), ...npmPrefixes('claude').map(pkg)];
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
// 3.5: signs in without a console (src/agents/login.mjs: `claude auth login`, hidden).
export const windowlessLogin = true;

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

// 2.6: the models this Claude Code offers (the SDK's supportedModels: what /model shows), before any conversation. The
// process starts with an input that never sends a message, so nothing is spent; it is closed once it has answered.
// The "default" row is not a model of its own: it marks which one Claude uses by default (resolvedModel).
export async function discoverModels(exe, cfg = {}, env = {}) {
  const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
  const abort = new AbortController();
  let release = null;
  const silent = { async *[Symbol.asyncIterator]() { await new Promise((r) => { release = r; }); } };
  let q = null;
  try {
    q = sdkQuery({ prompt: silent, options: { cwd: discoverDir(), pathToClaudeCodeExecutable: exe.cmd, env: cleanEnv(env), settingSources: [], extraArgs: { 'strict-mcp-config': null }, mcpServers: {}, abortController: abort, stderr: () => {} } });
    const rows = await within(q.supportedModels(), 40000);
    if (!Array.isArray(rows)) return null;
    const usual = rows.find((m) => m.value === 'default')?.resolvedModel ?? null;
    let marked = false;
    return rows.filter((m) => m?.value && m.value !== 'default').map((m) => {
      const isDefault = !marked && usual && (m.resolvedModel ?? m.value) === usual;
      if (isDefault) marked = true;
      // 3.6: the reasoning levels the model takes (Orb offers low, medium, high and, when the model has it, xhigh).
      const efforts = Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter((e) => ['low', 'medium', 'high', 'xhigh'].includes(e)) : null;
      return { id: m.value, label: m.displayName || m.value, ...(m.resolvedModel && m.resolvedModel !== m.value ? { resolved: m.resolvedModel } : {}), ...(isDefault ? { default: true } : {}), ...(efforts?.length ? { efforts } : {}) };
    });
  } catch { return null; } finally { release?.(); try { q?.close(); } catch { /* gone */ } try { abort.abort(); } catch { /* gone */ } }
}

// The SDK's error kinds, in plain words.
const RESULT_KEY = { error_during_execution: 'sys.agents.result.duringExecution', error_max_turns: 'sys.agents.result.maxTurns', error_max_budget_usd: 'sys.agents.result.maxBudget', error_max_structured_output_retries: 'sys.agents.result.structuredOutput' };

// 3.2.1: whether a result answers a message of Orb's (sent with origin «human»), not a notice Claude handles by itself.
export const answersOrb = (m) => !(m?.origin?.kind && m.origin.kind !== 'human');

// 3.8.1: Claude loads the skills of core by itself (a plugin); agents without this get them in their brief.
export const nativeSkills = true;

// 3.8.2: «total» is no longer bypassPermissions (which never calls canUseTool, so Orb's guard did not run): Claude asks
// for what it would ask in «default» and the guard allows all but the protected set (src/core/guard.mjs).
export const permissionModeOf = (p) => (p === 'editar' ? 'acceptEdits' : 'default');

// 3.8.3: Orb's own tools always in the prompt (Claude Code's alwaysLoad), never behind its tool search: Orbe reported
// spending three steps fetching orb_* tools before each use. The other servers (the user's connectors) stay deferrable.
export const orbAlwaysLoaded = (servers) => (servers?.orb ? { ...servers, orb: { ...servers.orb, alwaysLoad: true } } : servers);

// options: exe, cwd, model, reasoning, permission, resumeId, newSessionId, forkSession, mcpServers, env, systemPrompt
// (appended to Claude Code's own), tools ({ allowed, disallowed }), addDirs, budgetUsd, internalDir, log, onEvent, skills
// (3.8.1: { plugin, root, list }, the skills of core that are on)
export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const log = o.log ?? (() => {});
  const approvals = new Approvals(onEvent);
  const input = inputQueue();
  const abort = new AbortController();
  let permission = o.permission ?? 'editar';
  let turn = null; let query = null; let closed = false; let started = null; let child = null; let compactResult = null;
  const live = {
    sessionId: o.resumeId ?? o.newSessionId ?? null,
    caps: { steer: true, approvals: true, fork: true, interrupt: true, context: true, models: true, compact: true },
    pid: null,
    get busy() { return Boolean(turn && !turn.done); }
  };

  const canUseTool = async (toolName, toolInput, ctx = {}) => {
    const command = toolInput?.command ?? '';
    const paths = [toolInput?.file_path, toolInput?.path, toolInput?.notebook_path].filter(Boolean);
    // Glob and Grep patterns are checked too (where they reach).
    const patterns = [toolInput?.pattern, toolInput?.glob].filter((x) => typeof x === 'string' && x);
    const verdict = decide({ permission, tool: toolName, command, paths, patterns: toolName === 'Grep' ? patterns.slice(1) : patterns, internalDir: o.internalDir, cwd: o.cwd, lang: o.lang, android: Boolean(o.android?.()) });
    if (verdict.decision === 'allow') return { behavior: 'allow', updatedInput: toolInput };
    if (verdict.decision === 'deny') return { behavior: 'deny', message: `Orb no lo permite: ${verdict.reason}.` };
    // 3.1: summary: what the agent itself says the command is for (Claude's Bash tool asks it for a description).
    const answer = await approvals.ask({ id: ctx.toolUseID ?? `${toolName}-${Date.now()}`, tool: toolName, title: describeAction({ tool: toolName, command, paths, lang: o.lang }), reason: verdict.reason, input: describeInput(toolInput), summary: typeof toolInput?.description === 'string' ? toolInput.description.slice(0, 200) : undefined });
    if (answer === 'deny') return { behavior: 'deny', message: 'El usuario no lo ha permitido. Busca otra forma o explica qué necesitas.' };
    return { behavior: 'allow', updatedInput: toolInput, ...(answer === 'always' && ctx.suggestions ? { updatedPermissions: ctx.suggestions } : {}) };
  };

  const handle = (m) => {
    if (m.session_id && m.session_id !== live.sessionId) { live.sessionId = m.session_id; onEvent({ type: 'session', id: m.session_id }); }
    if (m.type === 'system' && m.subtype === 'init') onEvent({ type: 'item', role: 'system', kind: 'status', body: `${label} · ${m.model ?? ''}`.trim() });
    // 3.6: how a compaction went (/compact): the status line says whether it worked, the boundary how much was left.
    if (m.type === 'system' && m.subtype === 'status' && m.compact_result) compactResult = { ok: m.compact_result === 'success', error: m.compact_error ?? null };
    if (m.type === 'system' && m.subtype === 'compact_boundary') { compactResult ??= { ok: true, error: null }; onEvent({ type: 'compacted', before: m.compact_metadata?.pre_tokens ?? null, after: m.compact_metadata?.post_tokens ?? null }); }
    if (m.type === 'stream_event' && !m.parent_tool_use_id) {
      const e = m.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') onEvent({ type: 'delta', text: e.delta.text });
    }
    if (m.type === 'assistant') {
      const sub = Boolean(m.parent_tool_use_id); // a subagent's step: shown, but not part of the final answer
      for (const part of m.message?.content ?? []) {
        if (part.type === 'text' && part.text?.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: part.text, sub }); if (!sub) turn?.addText(part.text); }
        if (part.type === 'thinking' && part.thinking?.trim()) onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: clip(part.thinking, 4000) });
        if (part.type === 'tool_use') onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: part.id, name: String(part.name ?? '').replace(/^mcp__orb__/, 'orb:'), input: describeInput(part.input), sub, ...stepOf(m), ...subagentOf(part.name, part.input) } });
      }
    }
    if (m.type === 'user') {
      for (const part of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (part.type === 'tool_result') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: part.tool_use_id, output: clip(textOf(part.content), 3000), error: Boolean(part.is_error), ...stepOf(m) } });
      }
    }
    if (m.type === 'rate_limit_event') {
      const r = m.rate_limit_info ?? {};
      const resetAt = r.resetsAt ? r.resetsAt * 1000 : null;
      onEvent({ type: 'rate', status: r.status, resetAt, utilization: r.utilization ?? null, window: r.rateLimitType ?? null });
      if (r.status === 'rejected') { onEvent({ type: 'limit', resetAt, message: tr('sys.agents.limit', { name: 'Claude' }) }); if (turn) turn.limit = { resetAt }; }
    }
    // 3.2.1: a result that does not answer Orb's message (origin «task-notification»: Claude first handles a notice left by
    // the conversation it resumes, such as a background command of the previous session) does not end Orb's turn. Taking
    // it as the answer, a task resumed after a close passed as done in seconds while Claude was still working.
    if (m.type === 'result' && !answersOrb(m)) { log(`resultado de ${m.origin.kind}: no es la respuesta al mensaje de Orb`); return; }
    if (m.type === 'result') {
      const usage = { costUsd: m.total_cost_usd ?? null, inputTokens: m.usage?.input_tokens ?? null, outputTokens: m.usage?.output_tokens ?? null, cacheReadTokens: m.usage?.cache_read_input_tokens ?? null, cacheWriteTokens: m.usage?.cache_creation_input_tokens ?? null, turns: m.num_turns ?? null };
      onEvent({ type: 'item', role: 'system', kind: 'usage', body: usage });
      const isError = Boolean(m.is_error) || Boolean(m.subtype && m.subtype !== 'success');
      const final = typeof m.result === 'string' && m.result ? m.result : turn?.text ?? '';
      if (isError) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(final || (RESULT_KEY[m.subtype] && tr(RESULT_KEY[m.subtype])) || m.subtype || 'error', 3000) });
      if (isError && /usage limit|rate limit|limit reached|resets? (at|in)/i.test(final) && turn && !turn.limit) turn.limit = { resetAt: null };
      turn?.finish({ final, isError, usage, stopReason: m.subtype ?? null });
      // How full the context is, for the meter in the window (best effort; older CLIs do not answer).
      query?.getContextUsage?.().then((c) => onEvent({ type: 'context', used: c.totalTokens, size: c.maxTokens || c.rawMaxTokens })).catch(() => {});
      planUsage();
    }
  };
  // 2.6: the plan's windows (session, weekly, weekly of a model) as /usage shows them: Claude only sends them by itself
  // near a limit, so they are asked after a turn, at most every 90 s (experimental SDK call: best effort, any version).
  let usageAt = 0;
  // 3.8.2: force (the usage panel's «Recargar») asks now, whatever the 90 s; the engine limits how often (usage.refresh).
  const planUsage = ({ force = false } = {}) => {
    const ask = query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof ask !== 'function' || (!force && Date.now() - usageAt < 90_000)) return Promise.resolve(false);
    usageAt = Date.now();
    return Promise.resolve(ask.call(query, { skipBehaviors: true })).then((u) => {
      const r = u?.rate_limits;
      if (!r) return false;
      const send = (window, w) => { if (w?.utilization == null) return; onEvent({ type: 'rate', status: 'allowed', resetAt: w.resets_at ? Date.parse(w.resets_at) || null : null, utilization: w.utilization / 100, window }); };
      for (const k of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) send(k, r[k]);
      for (const m of r.model_scoped ?? []) if (m?.display_name) send(`seven_day_${String(m.display_name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, m);
      return true;
    }).catch(() => false);
  };

  const start = async () => {
    const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
    // The SDK hands mcpServers to Claude Code as --mcp-config <json>: the values go in Claude Code's environment and the
    // config only names them (Claude Code expands ${VAR} in --mcp-config, as in .mcp.json).
    const mcp = mcpEnvByRef(o.mcpServers, (name) => `\${${name}}`);
    // 3.8 (F2.6c): a project whose settings would run programs or change the environment is started without its settings
    // files; its CLAUDE.md still reaches Claude, through the system prompt.
    const risky = o.cwd ? projectSettingsRisk(o.cwd) : [];
    const notes = risky.length ? projectNotes(o.cwd) : '';
    if (risky.length) {
      log(`ajustes del proyecto sin cargar: ${risky.join(', ')}`);
      onEvent({ type: 'item', role: 'system', kind: 'status', body: tr('sys.agents.projectSettingsSkipped', { keys: risky.join(', ') }) });
    }
    const options = {
      cwd: o.cwd,
      pathToClaudeCodeExecutable: o.exe.cmd,
      env: cleanEnv({ ...(o.env ?? {}), ...mcp.env }),
      model: o.model || undefined,
      effort: o.reasoning || 'medium',
      includePartialMessages: true,
      settingSources: risky.length ? [] : LEAN_SOURCES,
      extraArgs: { 'strict-mcp-config': null },
      mcpServers: orbAlwaysLoaded(mcp.servers),
      additionalDirectories: o.addDirs ?? [],
      abortController: abort,
      canUseTool,
      permissionMode: permissionModeOf(permission),
      stderr: (d) => log(`stderr: ${d}`),
      // 3.8: no hooks of the project's .claude/settings*.json: a task could leave one there that later agents in the same
      // folder (other conversations) would run with their environment. (Managed policy hooks still apply.)
      // 3.8.1: nor the commands a skill or a slash command runs when it loads (!`…` in its text): checked with the real
      // Claude Code, they ran without asking canUseTool. (A skill's allowed-tools skipped it too: the skills of core reach
      // Claude without it, src/core/extensions.mjs › exposeSkills.)
      settings: { fastMode: false, disableAllHooks: true, disableSkillShellExecution: true },
      // 3.8 (F2.6c): nor its permission rules: an allow rule there (Bash, Edit…) would let Claude act without asking Orb's
      // guard (canUseTool), past «leer», «probar» and «Cosas que nadie toca». Only policy rules count (checked with the
      // real Claude Code: a trusted project's "allow": ["Bash"] no longer skips the guard, and CLAUDE.md still loads).
      managedSettings: { allowManagedPermissionRulesOnly: true },
      // 3.2.1: spawn Claude Code ourselves so Orb knows its process (live.pid) and can stop its whole tree when the task
      // ends — otherwise its background shells (bash.exe) can outlive the turn, holding an isolated copy's folder open and
      // leaving test servers behind. The signal is forwarded by the SDK after its own graceful stdin-close window.
      spawnClaudeCodeProcess: (opts) => {
        child = spawn(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, signal: opts.signal, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: !IS_WIN }); // 3.5: own process group on Linux (killTree)
        live.pid = child.pid ?? null;
        try { child.stderr?.setEncoding('utf8'); child.stderr?.on('data', (d) => log(`stderr: ${d}`)); child.stderr?.on('error', () => {}); } catch { /* best effort */ }
        return child;
      }
    };
    if (o.resumeId) options.resume = o.resumeId; else if (o.newSessionId) options.sessionId = o.newSessionId;
    if (o.forkSession) options.forkSession = true;
    const append = [o.systemPrompt, notes].filter(Boolean).join('\n\n');
    if (append) options.systemPrompt = { type: 'preset', preset: 'claude_code', append };
    if (o.tools?.allowed?.length) options.allowedTools = o.tools.allowed;
    const disallowed = [...(o.tools?.disallowed ?? []), ...(permission === 'leer' ? ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'] : permission === 'probar' ? ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'] : [])];
    if (disallowed.length) options.disallowedTools = disallowed;
    // 3.8.2 (owner's decision D8): no Claude in Chrome (it drives the user's own Chrome); every agent's browser is Orb's
    // (orb_browser_*), with Orb's browser rules. Under «Acceso total» the PC is used through the terminal.
    if (o.budgetUsd) options.maxBudgetUsd = o.budgetUsd;
    // 3.8.1: the skills of core that are on, as a plugin Orb makes (src/core/extensions.mjs › exposeSkills): Claude lists
    // them («orb-skills:<name>») and loads one when it fits. Checked with the real Claude Code (supportedCommands).
    if (o.skills?.list?.length) options.plugins = [{ type: 'local', path: o.skills.plugin }];
    query = sdkQuery({ prompt: input, options });
    (async () => {
      // 3.0: the streamed pieces of each answer are not written to the run log one by one (a disk write per token); the
      // whole message that follows them is.
      try { for await (const m of query) { if (m?.type !== 'stream_event') log(logJson(m)); handle(m); } }
      catch (error) {
        log(`fin con error: ${error?.stack ?? error}`);
        if (turn && !turn.done) turn.finish({ isError: true, final: closed ? tr('sys.agents.stopped') : tr('sys.agents.exitedWith', { name: label, error: error?.message ?? error }) });
      } finally {
        closed = true; approvals.clear();
        onEvent({ type: 'exit', code: 0, stderr: '' });
        if (turn && !turn.done) turn.finish({ isError: !turn.text, final: turn.text || tr('sys.agents.exitedEarly', { name: label }) });
      }
    })();
  };

  live.send = async ({ text, images = [] }) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: label }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn();
    const current = turn;
    started ??= start().catch((error) => { closed = true; current.finish({ isError: true, final: tr('sys.agents.startFailed', { name: label, error: error.message }) }); });
    await started;
    if (!closed) input.push(userMessage(text, images));
    return current.promise;
  };
  // A message for the running turn: Claude reads it at its next step (between tool calls) and it stays the same turn
  // ('now' would interrupt the turn instead).
  live.steer = ({ text }) => { if (closed || !turn || turn.done) return false; input.push({ ...userMessage(text), priority: 'next' }); return true; };
  // 3.6: Claude Code's own compaction (/compact): the conversation is summarised and goes on from the summary, with the
  // same session id. → { ok, error }
  live.compact = async ({ instructions = '' } = {}) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: label }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn(); compactResult = null;
    const current = turn;
    started ??= start().catch((error) => { closed = true; current.finish({ isError: true, final: tr('sys.agents.startFailed', { name: label, error: error.message }) }); });
    await started;
    if (!closed) input.push(userMessage(instructions ? `/compact ${instructions}` : '/compact'));
    const r = await current.promise;
    const ok = !r.isError && compactResult?.ok !== false;
    return { ok, error: ok ? null : compactResult?.error || r.final || null };
  };
  live.interrupt = async () => { approvals.clear(); try { await query?.interrupt(); } catch { /* not running */ } };
  live.respond = (requestId, decision) => approvals.respond(requestId, decision);
  live.setModel = async (model) => { o.model = model; try { await query?.setModel(model || undefined); } catch { /* next start */ } };
  live.setPermission = async (p) => { permission = p; try { await query?.setPermissionMode(permissionModeOf(p)); } catch { /* next start */ } };
  live.close = () => { if (closed && !query) return; closed = true; approvals.clear(); input.close(); try { query?.close(); } catch { /* gone */ } try { abort.abort(); } catch { /* gone */ } try { killTree(child); } catch { /* gone */ } };
  live.refreshUsage = () => (closed ? Promise.resolve(false) : planUsage({ force: true }));
  live.isClosed = () => closed;
  return live;
}
