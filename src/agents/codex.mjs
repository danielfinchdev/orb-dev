// Codex CLI adapter: "codex exec --json" for one turn and "codex exec resume <thread> --json" to continue it.
// Uses the user's own login (CODEX_HOME, ~/.codex by default); the app never reads or copies auth.json.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, shimDirs, userHome, clip } from './common.mjs';

export const id = 'codex';
export const label = 'Codex';

export function detect(cfg = {}) {
  const appData = process.env.APPDATA ?? path.join(userHome(), 'AppData', 'Roaming');
  const vendor = (dir) => ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'].flatMap((triple) => ['codex-win32-x64', 'codex-win32-arm64'].map((p) =>
    path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', p, 'vendor', triple, 'bin', 'codex.exe')));
  const candidates = [cfg.path, ...inPath('codex'), ...(IS_WIN ? [...vendor(path.join(appData, 'npm')), ...shimDirs('codex').flatMap(vendor)] : [])];
  const cmd = firstFile(candidates);
  return cmd ? { cmd, pre: [] } : null;
}

export const codexHome = () => process.env.CODEX_HOME || path.join(userHome(), '.codex');

export function loginState() {
  return firstFile([path.join(codexHome(), 'auth.json')]) ? 'si' : 'no';
}

export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, 'login'] });

const toml = (value) => JSON.stringify(value); // JSON strings and arrays are valid TOML values

// MCP servers through -c overrides (no config file is written in the user's Codex folder).
export function mcpArgs(servers) {
  const args = [];
  for (const [name, s] of Object.entries(servers ?? {})) {
    args.push('-c', `mcp_servers.${name}.command=${toml(s.command)}`, '-c', `mcp_servers.${name}.args=${toml(s.args ?? [])}`);
    const env = Object.entries(s.env ?? {});
    if (env.length) args.push('-c', `mcp_servers.${name}.env={${env.map(([k, v]) => `${k}=${toml(String(v))}`).join(', ')}}`);
    if (name === 'orb') args.push('-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`);
  }
  return args;
}

function sandbox(permission) {
  if (permission === 'leer') return 'read-only';
  if (permission === 'total') return 'danger-full-access';
  return 'workspace-write';
}

// session: { id, resume }. Codex chooses the thread id itself (thread.started), so a new conversation has no id yet.
export function buildTurn({ exe, cwd, prompt, model, reasoning = 'medium', permission = 'editar', session, mcpServers, images = [], cfg = {} }) {
  const common = ['--json', '--skip-git-repo-check', '-c', `model_reasoning_effort=${toml(reasoning === 'xhigh' ? 'high' : reasoning)}`, '-c', 'service_tier="default"',
    '-c', `sandbox_mode=${toml(sandbox(permission))}`, ...mcpArgs(mcpServers), ...(model ? ['-m', model] : []), ...images.flatMap((i) => ['--image', i])];
  // "exec resume" does not take -C: the folder is the process cwd (set by the caller).
  const args = session?.resume && session.id
    ? [...exe.pre, 'exec', 'resume', ...common, session.id, '-']
    : [...exe.pre, 'exec', ...common, '-C', cwd, '-'];
  return { cmd: exe.cmd, args, stdin: prompt, env: {} }; // the account's CODEX_HOME is added by the caller
}

export function createParser() {
  const state = { cliSession: null, final: '', isError: false, usage: null, text: '' };
  return {
    state,
    push(line) {
      let ev; try { ev = JSON.parse(line); } catch { return []; }
      const items = [];
      if (ev.type === 'thread.started' && ev.thread_id) state.cliSession = ev.thread_id;
      const item = ev.item;
      if (ev.type === 'item.started' && item?.type === 'command_execution') items.push({ role: 'tool', kind: 'tool', body: { id: item.id, name: 'Comando', input: clip(item.command, 300) } });
      if (ev.type === 'item.completed' && item) {
        if (item.type === 'agent_message' && item.text?.trim()) { items.push({ role: 'assistant', kind: 'text', body: item.text }); state.text = item.text; }
        if (item.type === 'reasoning' && item.text?.trim()) items.push({ role: 'assistant', kind: 'reasoning', body: clip(item.text, 4000) });
        if (item.type === 'command_execution') items.push({ role: 'tool', kind: 'tool_result', body: { id: item.id, output: clip(item.aggregated_output ?? '', 3000), error: item.exit_code != null && item.exit_code !== 0 } });
        if (item.type === 'file_change') for (const c of item.changes ?? []) items.push({ role: 'tool', kind: 'file', body: { path: c.path, change: c.kind } });
        if (item.type === 'mcp_tool_call') items.push({ role: 'tool', kind: 'tool', body: { id: item.id, name: `${item.server}:${item.tool}`, input: clip(item.arguments ?? '', 300) } });
        if (item.type === 'web_search') items.push({ role: 'tool', kind: 'tool', body: { id: item.id, name: 'Búsqueda web', input: clip(item.query ?? '', 300) } });
        if (item.type === 'error') items.push({ role: 'error', kind: 'text', body: clip(item.message ?? 'error', 3000) });
      }
      if (ev.type === 'turn.completed') {
        state.usage = { inputTokens: ev.usage?.input_tokens ?? null, outputTokens: ev.usage?.output_tokens ?? null, cachedTokens: ev.usage?.cached_input_tokens ?? null };
        state.final = state.text;
        items.push({ role: 'system', kind: 'usage', body: state.usage });
      }
      if (ev.type === 'turn.failed' || ev.type === 'error') {
        state.isError = true;
        const message = ev.error?.message ?? ev.message ?? 'error';
        state.final = message;
        items.push({ role: 'error', kind: 'text', body: clip(message, 3000) });
      }
      return items;
    }
  };
}
