// Codex adapter. 2.3: a live session through "codex app-server" (JSON-RPC over stdio, the protocol of Codex's own
// apps): one process per conversation, a thread that stays open, streamed answers, steer, interrupt,
// approval requests answered by the guard, native fork, context and the account's real usage limits.
// It uses the user's own login (CODEX_HOME, ~/.codex by default): ChatGPT or API key, the app never reads auth.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, npmPrefixes, appDataDirs, userHome, clip, discoverDir } from './common.mjs';
import { Turn, Approvals, JsonRpcPeer, spawnAgent, killTree, hidingEnvValues } from './live.mjs';
import { decide } from '../core/guard.mjs';
import { tr } from '../platform/context.mjs';

// Who connects to the app-server (def. 11: the product's version, read from Orb's own package.json).
const CLIENT = { name: 'orb_dev', title: 'Orb', version: (() => { try { return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch { return '0.0.0'; } })() };

export const id = 'codex';
export const label = 'Codex';
export const kind = 'app-server';
export const caps = { images: true, steer: true, fork: true, approvals: true, models: true, context: true, compact: true };

export function detect(cfg = {}) {
  const vendor = (dir) => ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'].flatMap((triple) => ['codex-win32-x64', 'codex-win32-arm64'].map((p) =>
    path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', p, 'vendor', triple, 'bin', 'codex.exe')));
  // The Codex app also leaves its CLI in <Local>\OpenAI\Codex\bin\<build>\codex.exe (the newest build wins).
  const appBuilds = (local) => { const base = path.join(local, 'OpenAI', 'Codex', 'bin'); try { return fs.readdirSync(base).map((b) => path.join(base, b, 'codex.exe')).filter((f) => firstFile([f])).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); } catch { return []; } };
  // 3.5: on Linux and macOS Orb installs it for the user only (npm --prefix ~/.local): its bin folder may not be in PATH.
  const candidates = [cfg.path, ...inPath('codex'), ...(IS_WIN ? [...npmPrefixes('codex').flatMap(vendor), ...appDataDirs().flatMap((d) => appBuilds(d.local))] : [path.join(userHome(), '.local', 'bin', 'codex')])];
  const cmd = firstFile(candidates);
  return cmd ? { cmd, pre: [] } : null;
}

export const codexHome = () => process.env.CODEX_HOME || path.join(userHome(), '.codex');
export function loginState() { return firstFile([path.join(codexHome(), 'auth.json')]) ? 'si' : 'no'; }
export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, 'login'] });
// 3.5: signs in without a console (src/agents/login.mjs: account/login/start over app-server).
export const windowlessLogin = true;

// 2.7: whose account a session folder holds, asked to Codex itself (account/read; auth.json is never opened): the plan
// and a short fingerprint of the account, so «Buscar y añadir» does not offer the same subscription twice. The e-mail
// never leaves this function. null if Codex does not answer.
export async function accountInfo(exe, dir, { timeoutMs = 20000 } = {}) {
  let child; let peer;
  try {
    child = spawnAgent(exe.cmd, [...exe.pre, 'app-server'], { cwd: os.tmpdir(), env: { CODEX_HOME: dir }, log: () => {} });
    peer = new JsonRpcPeer(child, { onNotification: () => {}, onRequest: async () => ({}), log: () => {} });
    await peer.request('initialize', { clientInfo: CLIENT, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs });
    peer.notify('initialized', {});
    const r = await peer.request('account/read', { refreshToken: false }, { timeoutMs });
    const acc = r?.account; if (!acc) return null;
    // The e-mail and the workspace together: a personal plan and a Team one with the same e-mail are two accounts.
    const id = acc.email || acc.accountId ? `${acc.email ?? ''}|${acc.accountId ?? ''}` : null;
    return { plan: typeof acc.planType === 'string' ? acc.planType : null, who: id ? crypto.createHash('sha256').update(String(id).toLowerCase()).digest('hex').slice(0, 16) : null };
  } catch { return null; } finally {
    try { peer?.close(); } catch { /* gone */ }
    try { killTree(child); } catch { /* gone */ }
  }
}

const toml = (value) => JSON.stringify(value); // JSON strings and arrays are valid TOML values

// 3.8: no value of an MCP server's env goes on the command line, which any process of the user can read: each one rides
// in Codex's own environment under a name of its own (ORB_MCP_<server>_<name>, so two connectors' API_KEY never clash) and
// the server gets it by that name (env_vars); the config names only what is plainly not secret (PLAIN). Orb's servers
// read their ticket from the variable their --ticket-env names; connectors start through launch.mjs, which gets their
// real keys from the engine. Codex's own commands never see any of it (shell_environment_policy, see start()).
const PLAIN = new Set(['ORB_AUTH_PIPE']);
const envName = (server, key) => `ORB_MCP_${server}_${key}`.replace(/[^A-Za-z0-9_]/g, '_');
export function mcpSecrets(servers) {
  return Object.fromEntries(Object.entries(servers ?? {}).flatMap(([name, s]) => Object.entries(s.env ?? {}).filter(([k]) => !PLAIN.has(k)).map(([k, v]) => [envName(name, k), String(v)])));
}

// MCP servers through -c overrides (no config file is written in the user's Codex folder).
export function mcpArgs(servers) {
  const args = [];
  for (const [name, s] of Object.entries(servers ?? {})) {
    const secret = Object.keys(s.env ?? {}).filter((k) => !PLAIN.has(k));
    // The secret's own name in the server's env is the renamed one: the ticket's --ticket-env follows it.
    const rename = (a) => { const m = /^--ticket-env=(.+)$/.exec(a); return m && secret.includes(m[1]) ? `--ticket-env=${envName(name, m[1])}` : a; };
    args.push('-c', `mcp_servers.${name}.command=${toml(s.command)}`, '-c', `mcp_servers.${name}.args=${toml((s.args ?? []).map(rename))}`);
    const env = Object.entries(s.env ?? {}).filter(([k]) => PLAIN.has(k));
    if (env.length) args.push('-c', `mcp_servers.${name}.env={${env.map(([k, v]) => `${k}=${toml(String(v))}`).join(', ')}}`);
    if (secret.length) args.push('-c', `mcp_servers.${name}.env_vars=${toml(secret.map((k) => envName(name, k)))}`);
    if (name === 'orb') args.push('-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`, '-c', `mcp_servers.${name}.tool_timeout_sec=960`);
  }
  // Orb's variables (tickets, the pipe) stay out of the commands Codex runs.
  if (Object.keys(servers ?? {}).length) args.push('-c', 'shell_environment_policy.exclude=["ORB_*"]');
  return args;
}

// The guard decides every action, so Codex asks for anything that is not plainly safe ("untrusted"); the sandbox keeps
// writes inside the folder. Read-only conversations cannot write at all; "total" runs without sandbox (3.8.2: still asking the guard).
function policy(permission) {
  // 2.6: read-only also asks Orb's guard (which denies anything that changes something) instead of trusting only the
  // sandbox: this is how a Codex brain coordinates.
  if (permission === 'leer') return { approvalPolicy: 'untrusted', sandbox: 'read-only' };
  // 3.8.2: «total» keeps asking Orb's guard (it allows all but the protected set); it only drops the sandbox.
  if (permission === 'total') return { approvalPolicy: 'untrusted', sandbox: 'danger-full-access' };
  return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
}
// 3.6: «Extra» (xhigh) goes through as it is: Orb only offers it for the models whose model/list says they take it.
const effort = (r) => r || 'medium';

const ITEM_TOOL = (item) => {
  if (item.type === 'commandExecution') return { name: tr('sys.agents.tool.execute'), input: clip(item.command, 300) };
  if (item.type === 'mcpToolCall') return { name: `${item.server}:${item.tool}`, input: clip(item.arguments ?? '', 300) };
  if (item.type === 'webSearch') return { name: tr('sys.agents.tool.webSearch'), input: clip(item.query ?? item.action?.query ?? '', 300) };
  if (item.type === 'dynamicToolCall') return { name: item.tool, input: clip(item.arguments ?? '', 300) };
  if (item.type === 'collabAgentToolCall') return { name: tr('sys.agents.tool.subagent', { tool: item.tool }), input: clip(item.prompt ?? '', 300), ...collabAgent(item) };
  if (item.type === 'imageGeneration') return { name: tr('sys.agents.tool.imageGen'), input: '' }; // 2.7
  return null;
};

// 3.8.2: a subagent Codex starts (collabAgentToolCall spawnAgent): its model and threads, so the conversation shows it as
// one row; the state of its threads comes with each collab call's end (agentsStates: pendingInit, running, completed…).
export function collabAgent(item) {
  if (item?.type !== 'collabAgentToolCall' || item.tool !== 'spawnAgent') return {};
  return { agent: { name: null, description: item.prompt ? clip(item.prompt, 200) : null, model: item.model ?? null, threads: Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.slice(0, 20) : [] } };
}
export function collabResult(item) {
  const states = Object.fromEntries(Object.entries(item?.agentsStates ?? {}).slice(0, 20).map(([id, st]) => [id, String(st?.status ?? '')]));
  const output = Object.values(item?.agentsStates ?? {}).map((st) => st?.message).filter((m) => typeof m === 'string' && m.trim()).join('\n\n');
  return { id: item.id, output: clip(output, 3000), error: item.status === 'failed', states };
}

// 2.6: the answer of app-server's model/list as the brain selector wants it: the models Codex shows (hidden ones are left
// out), with their own names, and which one Codex uses when none is chosen.
export function codexModels(r) {
  const rows = Array.isArray(r?.data) ? r.data : Array.isArray(r?.models) ? r.models : [];
  // 3.6: the reasoning levels each model takes (supportedReasoningEfforts: strings or { reasoningEffort }).
  const effortsOf = (m) => { const list = (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : []).map((e) => (typeof e === 'string' ? e : e?.reasoningEffort)).filter((e) => ['low', 'medium', 'high', 'xhigh'].includes(e)); return list.length ? { efforts: [...new Set(list)] } : {}; };
  return rows.filter((m) => m && !m.hidden).map((m) => ({ id: m.model ?? m.id, label: m.displayName || m.model || m.id, ...(m.isDefault ? { default: true } : {}), ...effortsOf(m) })).filter((m) => m.id);
}

// 2.6: the models of this Codex before any conversation: a short app-server (no thread, no prompt, nothing is spent) asked
// for model/list, page by page, and closed.
export async function discoverModels(exe, cfg = {}, env = {}) {
  const child = spawnAgent(exe.cmd, [...exe.pre, 'app-server'], { cwd: discoverDir(), env });
  const peer = new JsonRpcPeer(child, { onRequest: async () => { throw new Error('no'); } });
  child.on('error', () => peer.close());
  child.on('exit', () => peer.close());
  try {
    await peer.request('initialize', { clientInfo: CLIENT, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs: 30000 });
    peer.notify('initialized', {});
    const list = []; let cursor = null;
    for (let page = 0; page < 5; page++) {
      const r = await peer.request('model/list', cursor ? { cursor } : {}, { timeoutMs: 20000 });
      list.push(...codexModels(r));
      cursor = r?.nextCursor; if (!cursor) break;
    }
    return list;
  } catch { return null; } finally { peer.close(); killTree(child); }
}

// 3.2.1: what one turn spent, from Codex's token reports. Its totals are the whole thread's (they grow turn after turn) and
// its input includes the cached part: counted as they came, a small task looked like 280 k new tokens when most of them
// were the same context read again. Per turn: the total now minus the total before the turn's first request (that one's
// own figure, «last», tells where it started); cached input apart (cacheReadTokens), as Claude reports it.
const TOKEN_KEYS = ['inputTokens', 'cachedInputTokens', 'outputTokens'];
export function turnUsage(u, turn) {
  const total = u.total ?? {};
  turn.tokenBase ??= Object.fromEntries(TOKEN_KEYS.map((k) => [k, Math.max(0, (total[k] ?? 0) - (u.last?.[k] ?? total[k] ?? 0))]));
  const spent = (k) => Math.max(0, (total[k] ?? 0) - turn.tokenBase[k]);
  const cached = Math.min(spent('cachedInputTokens'), spent('inputTokens'));
  return { inputTokens: total.inputTokens == null ? null : spent('inputTokens') - cached, outputTokens: total.outputTokens == null ? null : spent('outputTokens'), cacheReadTokens: total.cachedInputTokens == null ? null : cached };
}

// options: exe, cwd, model, reasoning, permission, resumeId, forkSession, mcpServers, env, internalDir, log, onEvent, skills
// 3.8.1: Codex loads the skills of core by itself (an extra root); agents without this get them in their brief.
export const nativeSkills = true;
export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const log = hidingEnvValues(o.log ?? (() => {}), o.mcpServers);
  const approvals = new Approvals(onEvent);
  let permission = o.permission ?? 'editar';
  let model = o.model || null;
  let child = null; let peer = null; let threadId = null; let turn = null; let turnId = null; let started = null; let closed = false; let compacting = null;
  const live = { sessionId: o.resumeId ?? null, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };

  const guardAsk = async ({ itemId, command, paths = [], tool, kind }) => {
    const verdict = decide({ permission, tool, kind, command, paths, internalDir: o.internalDir, cwd: o.cwd, lang: o.lang, android: Boolean(o.android?.()) });
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
    // 3.6: the end of a compaction (thread/compact/start): the item of the summary or the thread's own notice. 3.8.1: the
    // compaction runs as a turn of its own; when the server says so (turn/started), it ends with that turn's
    // turn/completed, which could otherwise arrive after the next turn/start and end that turn empty.
    if (method === 'turn/started' && compacting && !compacting.done && !compacting.turnId) { compacting.turnId = p.turn?.id ?? null; return; }
    if ((method === 'thread/compacted' || (method === 'item/completed' && p.item?.type === 'contextCompaction')) && compacting && !compacting.done) {
      if (!compacting.compacted) onEvent({ type: 'compacted', before: null, after: null });
      compacting.compacted = true;
      if (!compacting.turnId) compacting.finish({});
      return;
    }
    if (method === 'turn/completed' && compacting && !compacting.done && compacting.turnId && p.turn?.id === compacting.turnId) {
      const failed = p.turn.status === 'failed' && !compacting.compacted;
      compacting.finish(failed ? { isError: true, final: p.turn.error?.message ?? 'thread/compact/start' } : {});
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
      if (item.type === 'collabAgentToolCall') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: collabResult(item) });
      if (item.type === 'plan' && item.text?.trim()) onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: clip(item.text, 4000) });
      // 2.7: a picture Codex made (image_gen): kept as a file (Codex's own savedPath, or written next to Orb's runs when
      // it only came inline), never as base64 in the conversation.
      if (item.type === 'imageGeneration') {
        let file = item.savedPath ?? null;
        if (!file && item.result && o.internalDir) {
          try { const dir = path.join(o.internalDir, 'imagenes'); fs.mkdirSync(dir, { recursive: true }); file = path.join(dir, `${String(item.id).replace(/[^\w-]/g, '')}.png`); fs.writeFileSync(file, Buffer.from(item.result, 'base64')); } catch { file = null; }
        }
        if (item.status === 'failed' && item.failure?.resetsAt) onEvent({ type: 'limit', resetAt: item.failure.resetsAt * 1000, message: tr('sys.agents.limit', { name: 'Codex' }) });
        onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: item.id, output: item.revisedPrompt ? clip(item.revisedPrompt, 400) : '', error: item.status === 'failed' } });
        if (file && item.status !== 'failed') onEvent({ type: 'item', role: 'assistant', kind: 'image', body: { path: file, prompt: item.revisedPrompt ? clip(item.revisedPrompt, 600) : null, transparent: Boolean(item.transparentBackground) } });
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage;
      if (u?.modelContextWindow) onEvent({ type: 'context', used: u.last?.inputTokens ?? u.total?.inputTokens ?? 0, size: u.modelContextWindow });
      if (turn && u?.total) turn.usage = turnUsage(u, turn);
      return;
    }
    if (method === 'account/rateLimits/updated') {
      // Both windows of the plan (5 h and weekly), each as its own report: the usage panel shows them all.
      const r = p.rateLimits ?? {};
      // The limit reached (if any) is the one whose window ran out: the weekly one only when Codex says so.
      const weekly = /second|week/i.test(String(r.rateLimitReachedType ?? ''));
      for (const w of [r.primary, r.secondary].filter(Boolean)) {
        const resetAt = w.resetsAt ? w.resetsAt * 1000 : null;
        const reached = Boolean(r.rateLimitReachedType) && (w === r.secondary ? weekly || !r.primary : !weekly);
        onEvent({ type: 'rate', status: reached ? 'rejected' : 'allowed', resetAt, utilization: w.usedPercent != null ? w.usedPercent / 100 : null, window: w.windowDurationMins ? `${w.windowDurationMins}min` : null });
      }
      // The cooldown lasts until the window that ran out resets.
      const out = (weekly ? r.secondary : r.primary) ?? r.primary ?? r.secondary;
      const resetAt = out?.resetsAt ? out.resetsAt * 1000 : null;
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
    child = spawnAgent(o.exe.cmd, args, { cwd: o.cwd, env: { ...(o.env ?? {}), ...mcpSecrets(o.mcpServers) }, log });
    live.pid = child.pid;
    peer = new JsonRpcPeer(child, { onNotification, onRequest, log });
    child.on('exit', (code) => {
      closed = true; approvals.clear(); peer.close();
      onEvent({ type: 'exit', code, stderr: child.stderrText() });
      if (turn && !turn.done) turn.finish({ isError: true, final: turn.text || tr('sys.agents.exitedCode', { name: 'Codex', code, detail: child.stderrText().trim().split('\n').slice(-2).join(' ') }).trim() });
    });
    child.on('error', (error) => { closed = true; if (turn && !turn.done) turn.finish({ isError: true, final: tr('sys.agents.startFailed', { name: 'Codex', error: error.message }) }); });
    await peer.request('initialize', { clientInfo: CLIENT, capabilities: { experimentalApi: true, requestAttestation: false } }, { timeoutMs: 30000 });
    peer.notify('initialized', {});
    // 3.8.1: the skills of core that are on (src/core/extensions.mjs › exposeSkills), one more root where Codex looks for
    // skills, before the thread starts (checked with the real app-server: skills/list shows them). Older versions: none.
    if (o.skills?.list?.length) await peer.request('skills/extraRoots/set', { extraRoots: [o.skills.root] }, { timeoutMs: 15000 }).catch((error) => log(`skills: ${error?.message ?? error}`));
    const common = { cwd: o.cwd, model, ...policy(permission), config: { model_reasoning_effort: effort(o.reasoning), service_tier: 'default' } };
    let res;
    if (o.resumeId && o.forkSession) res = await peer.request('thread/fork', { threadId: o.resumeId, ...common }, { timeoutMs: 60000 });
    else if (o.resumeId) res = await peer.request('thread/resume', { threadId: o.resumeId, ...common }, { timeoutMs: 60000 });
    else res = await peer.request('thread/start', common, { timeoutMs: 60000 });
    threadId = res.thread?.id;
    if (threadId && threadId !== live.sessionId) { live.sessionId = threadId; onEvent({ type: 'session', id: threadId }); }
    onEvent({ type: 'item', role: 'system', kind: 'status', body: `Codex · ${res.model ?? model ?? ''}`.trim() });
    // 2.6: the models this Codex offers, for the brain selector (older versions without model/list: nothing).
    peer.request('model/list', {}, { timeoutMs: 15000 }).then((r) => {
      const list = codexModels(r);
      if (list.length) onEvent({ type: 'models', list });
    }).catch(() => {});
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
      // 3.8.3: a turn that ended at once (its turn/completed read in the same piece of output as this answer, before this
      // line runs) keeps no id: a stale one made the next turn's turn/completed look like another turn's, and that turn
      // never ended (the Ubuntu CI hang).
      if (!current.done) turnId = res?.turn?.id ?? null;
    } catch (error) {
      current.finish({ isError: true, final: /malformed|resume|not found/i.test(error.message) ? tr('sys.agents.resumeFailed', { name: 'Codex', error: error.message }) : `Codex: ${error.message}` });
    }
    return current.promise;
  };
  // 3.2.1: the answer of turn/steer arrives later; when it fails (the turn had just ended), onFail gets the message so the
  // caller sends it as the next turn instead of losing it.
  live.steer = ({ text, onFail }) => {
    if (closed || !turn || turn.done || !turnId) return false;
    peer.request('turn/steer', { threadId, input: input(text), expectedTurnId: turnId }).catch((error) => { log(`steer: ${error.message}`); try { onFail?.(error); } catch { /* caller gone */ } });
    return true;
  };
  // 3.6: Codex's own compaction of the thread (app-server thread/compact/start): the history is summarised and the
  // thread goes on from the summary. An older Codex without the method answers an error, which is passed on. → { ok, error }
  live.compact = async () => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: 'Codex' }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn(); compacting = turn;
    const current = turn;
    const timer = setTimeout(() => current.finish({ isError: true, final: tr('sys.agents.noReply', { method: 'thread/compact/start' }) }), 10 * 60_000);
    try {
      started ??= start().catch((error) => { live.close(); throw error; });
      await started;
      await peer.request('thread/compact/start', { threadId }, { timeoutMs: 60000 });
    } catch (error) { current.finish({ isError: true, final: error.message }); }
    const r = await current.promise;
    clearTimeout(timer); compacting = null;
    return { ok: !r.isError, error: r.isError ? r.final : null };
  };
  live.interrupt = async () => { approvals.clear(); if (threadId && turnId) { try { await peer.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 8000 }); } catch { /* finishing anyway */ } } };
  live.respond = (requestId, decision) => approvals.respond(requestId, decision);
  live.setModel = (m) => { model = m || null; }; // applied on the next turn/start
  live.setPermission = (p) => { permission = p; };
  live.close = () => { if (closed && !child) return; closed = true; approvals.clear(); peer?.close(); killTree(child); };
  // 3.8.2: the plan's windows now (the usage panel's «Recargar»), handled as if Codex had sent them.
  live.refreshUsage = async () => {
    if (closed || !peer) return false;
    try { const r = await peer.request('account/rateLimits/read', {}, { timeoutMs: 8000 }); if (!r?.rateLimits) return false; onNotification('account/rateLimits/updated', { rateLimits: r.rateLimits }); return true; } catch { return false; }
  };
  live.isClosed = () => closed;
  return live;
}

