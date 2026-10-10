// Agents that speak ACP (Agent Client Protocol, agentclientprotocol.com): JSON-RPC over stdio, the open standard that
// T3 Code and Zed use to drive many coding agents with one client. One adapter serves them all (Gemini CLI, OpenCode,
// Qwen Code, GitHub Copilot CLI…); each one is a small spec: how to find it, how to start it in ACP mode, where its login
// lives and how to install it. The agent's own program and login are used: Orb never sees credentials.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, shimDirs, userHome, clip } from './common.mjs';
import { Turn, Approvals, JsonRpcPeer, spawnAgent, killTree } from './live.mjs';
import { decide } from '../core/guard.mjs';
import { tr } from '../core/context.mjs';

// An npm-installed CLI on Windows is a .cmd shim that cannot be started without a shell: Orb runs `node <script>` instead,
// reading the script from the package's "bin" (the same thing the shim does).
export function npmBin(pkg, bin) {
  const appData = process.env.APPDATA ?? path.join(userHome(), 'AppData', 'Roaming');
  const prefixes = [...new Set([path.join(appData, 'npm'), ...shimDirs(bin)])];
  const node = firstFile(inPath('node'));
  for (const prefix of prefixes) {
    const dir = IS_WIN ? path.join(prefix, 'node_modules', pkg) : path.join(prefix, '..', 'lib', 'node_modules', pkg);
    let meta; try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin?.[bin] ?? Object.values(meta.bin ?? {})[0];
    const script = rel && firstFile([path.join(dir, rel)]);
    if (!script) continue;
    if (/\.(c|m)?js$/i.test(script) || !IS_WIN) return node ? { cmd: node, pre: [script] } : null;
    return { cmd: script, pre: [] }; // a native binary shipped in the package
  }
  return null;
}

// The ACP agents Orb knows. install: what the installer runs (official packages); acpArgs: ACP mode of the program;
// login: files that show a saved login; loginArgs: the program's own login (opens in a console window).
export const ACP_SPECS = {
  gemini: {
    label: 'Gemini CLI', pkg: '@google/gemini-cli', bin: 'gemini', acpArgs: ['--acp'], altArgs: ['--experimental-acp'],
    login: ['.gemini/oauth_creds.json', '.gemini/google_accounts.json'], loginArgs: [], install: 'npm install -g @google/gemini-cli',
    strengths: 'contexto enorme, leer proyectos grandes, investigar y documentar', models: ['gemini-3-pro', 'gemini-3-flash'], defaultModel: ''
  },
  opencode: {
    label: 'OpenCode', pkg: 'opencode-ai', bin: 'opencode', acpArgs: ['acp'],
    login: ['.local/share/opencode/auth.json'], loginArgs: ['auth', 'login'], install: 'npm install -g opencode-ai',
    strengths: 'agente abierto con muchos proveedores y modelos', models: [], defaultModel: ''
  },
  qwen: {
    label: 'Qwen Code', pkg: '@qwen-code/qwen-code', bin: 'qwen', acpArgs: ['--acp'], altArgs: ['--experimental-acp'],
    login: ['.qwen/oauth_creds.json', '.qwen/settings.json'], loginArgs: [], install: 'npm install -g @qwen-code/qwen-code',
    strengths: 'implementación rápida y barata, tareas repetitivas', models: [], defaultModel: ''
  },
  copilot: {
    label: 'GitHub Copilot', pkg: '@github/copilot', bin: 'copilot', acpArgs: ['--acp'],
    login: ['.copilot/config.json'], loginArgs: [], install: 'npm install -g @github/copilot',
    strengths: 'cambios con contexto de GitHub, issues y pull requests', models: [], defaultModel: ''
  }
};

const TOOL_KIND_KEY = { read: 'read', edit: 'edit', delete: 'delete', move: 'move', search: 'search', execute: 'execute', think: 'think', fetch: 'fetch', switch_mode: 'switchMode', other: 'other' };
const toolKindName = (kind) => (Object.hasOwn(TOOL_KIND_KEY, kind ?? '') ? tr(`sys.agents.tool.${TOOL_KIND_KEY[kind]}`) : null);
const textOfContent = (content) => (Array.isArray(content) ? content : [content]).map((c) => {
  if (!c) return '';
  if (c.type === 'content') return textOfContent(c.content);
  if (c.type === 'text') return c.text ?? '';
  if (c.type === 'diff') return `${c.path ?? ''}\n${clip(c.newText ?? '', 1500)}`;
  if (c.type === 'terminal') return `[terminal ${c.terminalId ?? ''}]`;
  return '';
}).filter(Boolean).join('\n');

export function acpAgent(id, spec) {
  const caps = { images: false, steer: false, fork: false, approvals: true, models: false, context: true };
  const detect = (cfg = {}) => {
    if (cfg.path && firstFile([cfg.path])) return /\.(c|m)?js$/i.test(cfg.path) ? { cmd: firstFile(inPath('node')) ?? process.execPath, pre: [cfg.path] } : { cmd: cfg.path, pre: [] };
    return npmBin(spec.pkg, spec.bin) ?? (firstFile(inPath(spec.bin)) ? { cmd: firstFile(inPath(spec.bin)), pre: [] } : null);
  };
  const loginState = () => (spec.login.some((f) => firstFile([path.join(userHome(), f)])) ? 'si' : 'desconocido');
  const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, ...spec.loginArgs] });

  function createLive(o) {
    const onEvent = o.onEvent ?? (() => {});
    const log = o.log ?? (() => {});
    const approvals = new Approvals(onEvent);
    let permission = o.permission ?? 'editar';
    let child = null; let peer = null; let sessionId = o.resumeId ?? null; let turn = null; let started = null; let closed = false;
    let agentCaps = {}; let loading = false; let text = ''; let thought = '';
    const live = { sessionId, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };

    const flush = () => {
      if (thought.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: clip(thought, 4000) }); thought = ''; }
      if (text.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: text }); turn?.addText(text); text = ''; }
    };
    const onNotification = (method, p) => {
      if (method !== 'session/update' || loading) return; // a loaded session replays its history: not shown twice
      const u = p.update ?? {};
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': { const t = textOfContent(u.content); if (t) { text += t; onEvent({ type: 'delta', text: t }); } break; }
        case 'agent_thought_chunk': thought += textOfContent(u.content); break;
        case 'tool_call': flush(); onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: u.toolCallId, name: u.name || toolKindName(u.kind) || u.title || tr('sys.agents.tool.other'), input: clip(u.title ?? u.rawInput ?? '', 300) } }); break;
        case 'tool_call_update':
          if (u.status === 'completed' || u.status === 'failed') onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: u.toolCallId, output: clip(textOfContent(u.content ?? []) || (u.rawOutput ? JSON.stringify(u.rawOutput) : ''), 3000), error: u.status === 'failed' } });
          break;
        case 'plan': flush(); onEvent({ type: 'item', role: 'assistant', kind: 'reasoning', body: (u.entries ?? []).map((e) => `${e.status === 'completed' ? '✓' : '·'} ${e.content}`).join('\n') }); break;
        case 'usage_update': if (u.size) onEvent({ type: 'context', used: u.used, size: u.size }); break;
        default: break;
      }
    };
    const onRequest = async (method, p) => {
      if (method === 'session/request_permission') {
        const tc = p.toolCall ?? {};
        const command = tc.rawInput?.command ? [].concat(tc.rawInput.command).join(' ') : '';
        const paths = (tc.locations ?? []).map((l) => l.path).filter(Boolean);
        const verdict = decide({ permission, tool: tc.name ?? tc.title, kind: tc.kind, command, paths, internalDir: o.internalDir, lang: o.lang });
        let d = verdict.decision;
        if (d === 'ask') d = await approvals.ask({ id: tc.toolCallId ?? `p-${Date.now()}`, tool: tc.title ?? tc.kind ?? tr('sys.agents.tool.action'), title: command || tc.title || paths.join(', '), reason: verdict.reason, input: clip(tc.rawInput ?? tc.title, 400) });
        // In order of preference (not in the order the agent lists its options): "always" must pick allow_always even
        // when allow_once comes first, and a single "deny" must never pick reject_always.
        const pick = (kinds) => kinds.map((k) => (p.options ?? []).find((opt) => opt.kind === k)).find(Boolean);
        const option = d === 'deny' ? pick(['reject_once', 'reject_always']) : d === 'always' ? pick(['allow_always', 'allow_once']) : pick(['allow_once', 'allow_always']);
        return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
      }
      throw new Error(tr('sys.agents.methodNotSupported', { method })); // fs/* and terminal/* are not offered (the agent uses its own tools)
    };

    const mcpList = () => Object.entries(o.mcpServers ?? {}).map(([name, s]) => ({ name, command: s.command, args: s.args ?? [], env: Object.entries(s.env ?? {}).map(([k, v]) => ({ name: k, value: String(v) })) }));
    // Starts the program in ACP mode and says hello. Versions change their flag (--acp / --experimental-acp): when the
    // first one makes the program quit before answering, the alternative is tried once.
    const connect = async (args) => {
      const proc = spawnAgent(o.exe.cmd, [...o.exe.pre, ...args], { cwd: o.cwd, env: o.env, log });
      const p = new JsonRpcPeer(proc, { onNotification, onRequest, log });
      const quit = new Promise((resolve) => {
        proc.once('exit', (code) => resolve(new Error(tr('sys.agents.exitedAtStart', { name: spec.label, code, detail: proc.stderrText().trim().split('\n').slice(-2).join(' ') }).trim())));
        proc.once('error', resolve);
      });
      const hello = p.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'orb-dev', title: 'Orb', version: '2.4.0' } }, { timeoutMs: 60000 });
      const first = await Promise.race([hello.then((init) => ({ init }), (error) => ({ error })), quit.then((error) => ({ error }))]);
      if (first.error) { p.close(); killTree(proc); throw first.error; } // no reply or an early exit: nothing left running
      return { proc, p, init: first.init };
    };
    const start = async () => {
      let c;
      try { c = await connect(spec.acpArgs); }
      catch (error) { if (!spec.altArgs) throw error; log(`reintento con ${spec.altArgs.join(' ')}: ${error.message}`); c = await connect(spec.altArgs); }
      child = c.proc; peer = c.p; const init = c.init;
      live.pid = child.pid;
      child.on('exit', (code) => {
        closed = true; approvals.clear(); peer.close();
        onEvent({ type: 'exit', code, stderr: child.stderrText() });
        if (turn && !turn.done) { flush(); turn.finish({ isError: true, final: turn.text || tr('sys.agents.exitedCode', { name: spec.label, code, detail: child.stderrText().trim().split('\n').slice(-2).join(' ') }).trim() }); }
      });
      child.on('error', (error) => { closed = true; if (turn && !turn.done) turn.finish({ isError: true, final: tr('sys.agents.startFailed', { name: spec.label, error: error.message }) }); });
      agentCaps = init?.agentCapabilities ?? {};
      let res = null;
      if (sessionId && agentCaps.loadSession) {
        loading = true;
        try { res = await peer.request('session/load', { sessionId, cwd: o.cwd, mcpServers: mcpList() }, { timeoutMs: 120000 }); }
        catch (error) { log(`no se pudo cargar la sesión: ${error.message}`); sessionId = null; }
        finally { loading = false; }
      } else sessionId = null;
      if (!sessionId) {
        res = await peer.request('session/new', { cwd: o.cwd, mcpServers: mcpList() }, { timeoutMs: 120000 });
        sessionId = res?.sessionId;
        live.sessionId = sessionId; onEvent({ type: 'session', id: sessionId });
      }
      // Read-only: the agent's own read-only mode when it has one (the guard denies changes anyway).
      const modes = res?.modes?.availableModes ?? [];
      const ro = permission === 'leer' && modes.find((m) => /plan|read|ask/i.test(`${m.id} ${m.name}`));
      if (ro) peer.request('session/set_mode', { sessionId, modeId: ro.id }).catch(() => {});
      if (o.model) {
        const opt = (res?.configOptions ?? []).find((c) => c.category === 'model' || c.id === 'model');
        if (opt) peer.request('session/set_config_option', { sessionId, configId: opt.id, value: o.model }).catch(() => {});
      }
      onEvent({ type: 'item', role: 'system', kind: 'status', body: `${spec.label}${o.model ? ` · ${o.model}` : ''}` });
    };

    live.send = async ({ text: message }) => {
      if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: spec.label }));
      if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
      turn = new Turn(); const current = turn; text = ''; thought = '';
      try {
        // A start that fails closes this live: the next message gets a fresh process instead of the same error again.
        started ??= start().catch((error) => { live.close(); throw error; });
        await started;
        const res = await peer.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: message }] });
        flush();
        const stop = res?.stopReason ?? 'end_turn';
        if (res?.usage) onEvent({ type: 'item', role: 'system', kind: 'usage', body: { inputTokens: res.usage.inputTokens ?? null, outputTokens: res.usage.outputTokens ?? null } });
        current.finish({ stopReason: stop, isError: stop === 'refusal', final: current.text });
      } catch (error) {
        flush();
        const msg = String(error.message ?? error);
        const limit = /quota|rate limit|usage limit|429|exhausted/i.test(msg) ? { resetAt: null } : null;
        if (!current.done) { onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(msg, 3000) }); current.finish({ isError: true, final: `${spec.label}: ${msg}`, limit }); }
      }
      return current.promise;
    };
    live.steer = () => false;
    live.interrupt = async () => { approvals.clear(); if (peer && sessionId) peer.notify('session/cancel', { sessionId }); };
    live.respond = (requestId, decision) => approvals.respond(requestId, decision);
    live.setModel = (m) => { o.model = m; };
    live.setPermission = (p) => { permission = p; };
    live.close = () => { closed = true; approvals.clear(); peer?.close(); killTree(child); };
    live.isClosed = () => closed;
    return live;
  }

  return { id, label: spec.label, kind: 'acp', caps, spec, detect, loginState, loginCommand, createLive, install: spec.install };
}
