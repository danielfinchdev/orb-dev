// Codex adapter. 2.3: a live session through "codex app-server" (JSON-RPC over stdio, the protocol of Codex's own apps
// and the one T3 Code uses): one process per conversation, a thread that stays open, streamed answers, steer, interrupt,
// approval requests answered by the guard, native fork, context and the account's real usage limits.
// It uses the user's own login (CODEX_HOME, ~/.codex by default): ChatGPT or API key, the app never reads auth.json.
import path from 'node:path';
import { IS_WIN, firstFile, inPath, shimDirs, userHome, clip } from './common.mjs';
import { Turn, Approvals, JsonRpcPeer, spawnAgent, killTree } from './live.mjs';
import { decide } from '../core/guard.mjs';
import { tr } from '../core/context.mjs';

export const id = 'codex';
export const label = 'Codex';
export const kind = 'app-server';
export const caps = { images: true, steer: true, fork: true, approvals: true, models: true, context: true };

export function detect(cfg = {}) {
  const appData = process.env.APPDATA ?? path.join(userHome(), 'AppData', 'Roaming');
  const vendor = (dir) => ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'].flatMap((triple) => ['codex-win32-x64', 'codex-win32-arm64'].map((p) =>
    path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', p, 'vendor', triple, 'bin', 'codex.exe')));
  const candidates = [cfg.path, ...inPath('codex'), ...(IS_WIN ? [...vendor(path.join(appData, 'npm')), ...shimDirs('codex').flatMap(vendor)] : [])];
  const cmd = firstFile(candidates);
  return cmd ? { cmd, pre: [] } : null;
}

export const codexHome = () => process.env.CODEX_HOME || path.join(userHome(), '.codex');
export function loginState() { return firstFile([path.join(codexHome(), 'auth.json')]) ? 'si' : 'no'; }
export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, 'login'] });

const toml = (value) => JSON.stringify(value); // JSON strings and arrays are valid TOML values

// MCP servers through -c overrides (no config file is written in the user's Codex folder).
export function mcpArgs(servers) {
  const args = [];
  for (const [name, s] of Object.entries(servers ?? {})) {
    args.push('-c', `mcp_servers.${name}.command=${toml(s.command)}`, '-c', `mcp_servers.${name}.args=${toml(s.args ?? [])}`);
    const env = Object.entries(s.env ?? {});
    if (env.length) args.push('-c', `mcp_servers.${name}.env={${env.map(([k, v]) => `${k}=${toml(String(v))}`).join(', ')}}`);
    if (name === 'orb') args.push('-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`, '-c', `mcp_servers.${name}.tool_timeout_sec=960`);
  }
  return args;
}

// The guard decides every action, so Codex asks for anything that is not plainly safe ("untrusted"); the sandbox keeps
// writes inside the folder. Read-only conversations cannot write at all; "total" runs without sandbox or questions.
function policy(permission) {
  if (permission === 'leer') return { approvalPolicy: 'never', sandbox: 'read-only' };
  if (permission === 'total') return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
}
const effort = (r) => (r === 'xhigh' ? 'high' : r || 'medium');

const ITEM_TOOL = (item) => {
  if (item.type === 'commandExecution') return { name: tr('sys.agents.tool.execute'), input: clip(item.command, 300) };
  if (item.type === 'mcpToolCall') return { name: `${item.server}:${item.tool}`, input: clip(item.arguments ?? '', 300) };
  if (item.type === 'webSearch') return { name: tr('sys.agents.tool.webSearch'), input: clip(item.query ?? item.action?.query ?? '', 300) };
  if (item.type === 'dynamicToolCall') return { name: item.tool, input: clip(item.arguments ?? '', 300) };
  if (item.type === 'collabAgentToolCall') return { name: tr('sys.agents.tool.subagent', { tool: item.tool }), input: clip(item.prompt ?? '', 300) };
  return null;
};

// options: exe, cwd, model, reasoning, permission, resumeId, forkSession, mcpServers, env, internalDir, log, onEvent
export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const log = o.log ?? (() => {});
  const approvals = new Approvals(onEvent);
  let permission = o.permission ?? 'editar';
  let model = o.model || null;
  let child = null; let peer = null; let threadId = null; let turn = null; let turnId = null; let started = null; let closed = false;
  const live = { sessionId: o.resumeId ?? null, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };

  const guardAsk = async ({ itemId, command, paths = [], tool, kind }) => {
    const verdict = decide({ permission, tool, kind, command, paths, internalDir: o.internalDir, lang: o.lang });
    if (verdict.decision !== 'ask') return verdict.decision;
    return approvals.ask({ id: itemId, tool, title: command || paths.join(', ') || tool, reason: verdict.reason, input: clip(command || paths.join(', '), 400) });
  };

  const onRequest = async (method, p) => {
    if (method === 'item/commandExecution/requestApproval') {
      const d = await guardAsk({ itemId: p.approvalId || p.itemId, command: p.command ?? '', tool: 'Bash', kind: 'execute' });
      return { decision: d === 'deny' ? 'decline' : d === 'always' ? 'acceptForSession' : 'accept' };
    }
    if (method === 'item/fileChange/requestApproval') {
      const d = await guardAsk({ itemId: p.itemId, paths: p.grantRoot ? [p.grantRoot] : [], tool: 'Edit', kind: 'edit' });
      return { decision: d === 'deny' ? 'decline' : d === 'always' ? 'acceptForSession' : 'accept' };
    }
    if (method === 'execCommandApproval') { // older servers
      const d = await guardAsk({ itemId: p.callId, command: (p.command ?? []).join(' '), tool: 'Bash', kind: 'execute' });
      return { decision: d === 'deny' ? { denied: { rejection: 'El usuario no lo ha permitido.' } } : d === 'always' ? 'approved_for_session' : 'approved' };
    }
    if (method === 'applyPatchApproval') {
      const d = await guardAsk({ itemId: p.callId, paths: Object.keys(p.fileChanges ?? {}), tool: 'Edit', kind: 'edit' });
      return { decision: d === 'deny' ? { denied: { rejection: 'El usuario no lo ha permitido.' } } : 'approved' };
    }
    if (method === 'item/permissions/requestApproval') {
      // Asking for more than the sandbox gives (another folder, network…): the user decides.
      const d = await approvals.ask({ id: p.itemId, tool: tr('sys.agents.permissions'), title: p.reason || tr('sys.agents.morePermissions', { name: 'Codex' }), reason: tr('sys.agents.morePermissionsWhy'), input: clip(p.permissions, 400) });
      return { permissions: d === 'deny' ? {} : p.permissions, scope: d === 'always' ? 'session' : 'turn' };
    }
    if (method === 'item/tool/requestUserInput') return { answers: {} }; // questions are answered in the conversation instead
    if (method === 'mcpServer/elicitation/request') return { action: 'decline' };
    throw new Error(tr('sys.agents.requestNotSupported', { method }));
  };

  const onNotification = (method, p) => {
    if (p.threadId && threadId && p.threadId !== threadId) return; // a subagent's own thread: its steps arrive as items of ours
    if (method === 'item/agentMessage/delta') { onEvent({ type: 'delta', text: p.delta }); return; }
    if (method === 'item/started') {
      const tool = ITEM_TOOL(p.item); if (tool) onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: p.item.id, ...tool } });
      return;
    }
    if (method === 'item/completed') {
      const item = p.item;
      if (item.type === 'agentMessage' && item.text?.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: item.text }); turn?.addText(item.text); }
      if (item.type === 'reasoning') { const t = [...(item.summary ?? []), ...(item.content ?? [])].join('\n').trim(); if (t) onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: clip(t, 4000) }); }
      if (item.type === 'commandExecution') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: item.id, output: clip(item.aggregatedOutput ?? '', 3000), error: item.exitCode != null && item.exitCode !== 0 } });
      if (item.type === 'fileChange') for (const c of item.changes ?? []) onEvent({ type: 'item', role: 'tool', kind: 'file', body: { path: c.path, change: typeof c.kind === 'string' ? c.kind : c.kind?.type ?? 'update' } });
      if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: item.id, output: clip(item.result ?? item.error ?? item.contentItems ?? '', 3000), error: Boolean(item.error) || item.success === false } });
      if (item.type === 'webSearch') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: item.id, output: '', error: false } });
      if (item.type === 'plan' && item.text?.trim()) onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: clip(item.text, 4000) });
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage;
      if (u?.modelContextWindow) onEvent({ type: 'context', used: u.last?.inputTokens ?? u.total?.inputTokens ?? 0, size: u.modelContextWindow });
      if (turn) turn.usage = { inputTokens: u?.total?.inputTokens ?? null, outputTokens: u?.total?.outputTokens ?? null, cachedTokens: u?.total?.cachedInputTokens ?? null };
      return;
    }
    if (method === 'account/rateLimits/updated') {
      const r = p.rateLimits ?? {}; const w = r.primary ?? r.secondary;
      const resetAt = w?.resetsAt ? w.resetsAt * 1000 : null;
      onEvent({ type: 'rate', status: r.rateLimitReachedType ? 'rejected' : 'allowed', resetAt, utilization: w?.usedPercent != null ? w.usedPercent / 100 : null, window: w?.windowDurationMins ? `${w.windowDurationMins}min` : null });
      if (r.rateLimitReachedType) { onEvent({ type: 'limit', resetAt, message: tr('sys.agents.limit', { name: 'Codex' }) }); if (turn) turn.limit = { resetAt }; }
      return;
    }
    if (method === 'error') {
      const e = p.error ?? {};
      if (!p.willRetry) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(e.message ?? 'error', 3000) });
      if (/usageLimitExceeded|rateLimitExceeded/.test(JSON.stringify(e.codexErrorInfo ?? '')) && turn) turn.limit = turn.limit ?? { resetAt: null };
      return;
    }
    if (method === 'turn/completed') {
      const t = p.turn ?? {};
      if (t.id && turnId && t.id !== turnId) return;
      const isError = t.status === 'failed';
      const errInfo = JSON.stringify(t.error?.codexErrorInfo ?? '');
      if (/usageLimitExceeded|rateLimitExceeded/.test(errInfo) && turn) turn.limit = turn.limit ?? { resetAt: null };
      if (turn?.usage) onEvent({ type: 'item', role: 'system', kind: 'usage', body: turn.usage });
      turn?.finish({ isError, stopReason: t.status, final: isError ? (t.error?.message ?? turn.text) : turn.text });
      turnId = null;
    }
  };

  const start = async () => {
    const args = [...o.exe.pre, 'app-server', ...mcpArgs(o.mcpServers)];
    child = spawnAgent(o.exe.cmd, args, { cwd: o.cwd, env: o.env, log });
    live.pid = child.pid;
    peer = new JsonRpcPeer(child, { onNotification, onRequest, log });
    child.on('exit', (code) => {
      closed = true; approvals.clear(); peer.close();
      onEvent({ type: 'exit', code, stderr: child.stderrText() });
      if (turn && !turn.done) turn.finish({ isError: true, final: turn.text || tr('sys.agents.exitedCode', { name: 'Codex', code, detail: child.stderrText().trim().split('\n').slice(-2).join(' ') }).trim() });
    });
    child.on('error', (error) => { closed = true; if (turn && !turn.done) turn.finish({ isError: true, final: tr('sys.agents.startFailed', { name: 'Codex', error: error.message }) }); });
    await peer.request('initialize', { clientInfo: { name: 'orb_dev', title: 'Orb', version: '2.4.1' }, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs: 30000 });
    peer.notify('initialized', {});
    const common = { cwd: o.cwd, model, ...policy(permission), config: { model_reasoning_effort: effort(o.reasoning), service_tier: 'default' } };
    let res;
    if (o.resumeId && o.forkSession) res = await peer.request('thread/fork', { threadId: o.resumeId, ...common }, { timeoutMs: 60000 });
    else if (o.resumeId) res = await peer.request('thread/resume', { threadId: o.resumeId, ...common }, { timeoutMs: 60000 });
    else res = await peer.request('thread/start', common, { timeoutMs: 60000 });
    threadId = res.thread?.id;
    if (threadId && threadId !== live.sessionId) { live.sessionId = threadId; onEvent({ type: 'session', id: threadId }); }
    onEvent({ type: 'item', role: 'system', kind: 'status', body: `Codex · ${res.model ?? model ?? ''}`.trim() });
  };

  const input = (text, images = []) => [{ type: 'text', text, text_elements: [] }, ...images.map((p) => ({ type: 'localImage', path: p }))];

  live.send = async ({ text, images = [] }) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: 'Codex' }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn();
    const current = turn;
    try {
      // A start that fails (no reply, thread not found) closes this live: the next message gets a fresh process.
      started ??= start().catch((error) => { live.close(); throw error; });
      await started;
      const res = await peer.request('turn/start', { threadId, input: input(text, images), ...(model ? { model } : {}), effort: effort(o.reasoning) });
      turnId = res?.turn?.id ?? null;
    } catch (error) {
      current.finish({ isError: true, final: /malformed|resume|not found/i.test(error.message) ? tr('sys.agents.resumeFailed', { name: 'Codex', error: error.message }) : `Codex: ${error.message}` });
    }
    return current.promise;
  };
  live.steer = ({ text }) => {
    if (closed || !turn || turn.done || !turnId) return false;
    peer.request('turn/steer', { threadId, input: input(text), expectedTurnId: turnId }).catch((error) => log(`steer: ${error.message}`));
    return true;
  };
  live.interrupt = async () => { approvals.clear(); if (threadId && turnId) { try { await peer.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 8000 }); } catch { /* finishing anyway */ } } };
  live.respond = (requestId, decision) => approvals.respond(requestId, decision);
  live.setModel = (m) => { model = m || null; }; // applied on the next turn/start
  live.setPermission = (p) => { permission = p; };
  live.close = () => { if (closed && !child) return; closed = true; approvals.clear(); peer?.close(); killTree(child); };
  live.isClosed = () => closed;
  return live;
}

