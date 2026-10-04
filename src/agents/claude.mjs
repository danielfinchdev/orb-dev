// Claude Code adapter: finds the CLI the user installed, builds one turn ("claude -p" with stream-json output, the
// conversation continues with --resume) and turns its JSON events into the app's items.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, shimDirs, userHome, clip, describeInput } from './common.mjs';

export const id = 'claude';
export const label = 'Claude Code';

// Bash stays available for normal work (git, npm, tests) but the obvious ways out that a task never needs are denied.
// A deny list is not airtight; the real barriers are the approvals, the clean environment and the undo checkpoints.
export const DENIED = ['Bash(git push:*)', 'Bash(git remote:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(Invoke-WebRequest:*)', 'Bash(Invoke-RestMethod:*)', 'Bash(iwr:*)', 'Bash(irm:*)',
  'Bash(rm -rf:*)', 'Bash(sqlite3:*)', 'Bash(schtasks:*)', 'Bash(taskkill:*)', 'Bash(gh:*)'];
// Keeps every process light: without these each turn re-reads the user's whole setup (plugins, connectors, skills, hooks).
export const LEAN = ['--setting-sources', 'project,local', '--disable-slash-commands', '--strict-mcp-config'];

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

// permission: "leer" (look but never change), "editar" (edit files and run commands in its folder), "total" (no checks).
function permissionArgs(permission) {
  if (permission === 'leer') return ['--permission-mode', 'default', '--allowedTools', 'Read', 'Glob', 'Grep', 'mcp__orb', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit'];
  if (permission === 'total') return ['--permission-mode', 'bypassPermissions'];
  return ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'mcp__orb', '--disallowedTools', ...DENIED];
}

// One turn. session: { id, resume } — a new conversation gets the id chosen by the app, later turns resume it.
// tools: overrides for the assistant's own process: { allowed, disallowed, systemPrompt, addDirs, permissionMode }.
export function buildTurn({ exe, prompt, model, reasoning = 'medium', permission = 'editar', session, mcpFile, budgetUsd, tools }) {
  const args = [...exe.pre, '-p', '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  if (reasoning) args.push('--effort', reasoning);
  args.push('--settings', JSON.stringify({ fastMode: false }), ...LEAN);
  if (mcpFile) args.push('--mcp-config', mcpFile);
  if (budgetUsd) args.push('--max-budget-usd', String(budgetUsd));
  if (session?.id) args.push(session.resume ? '--resume' : '--session-id', session.id);
  if (tools) {
    if (tools.permissionMode) args.push('--permission-mode', tools.permissionMode);
    if (tools.allowed?.length) args.push('--allowedTools', ...tools.allowed);
    if (tools.disallowed?.length) args.push('--disallowedTools', ...tools.disallowed);
    if (tools.systemPrompt) args.push('--append-system-prompt', tools.systemPrompt);
    for (const dir of tools.addDirs ?? []) args.push('--add-dir', dir);
  } else args.push(...permissionArgs(permission));
  return { cmd: exe.cmd, args, stdin: prompt };
}

// MCP config file for --mcp-config (written per run; ${VAR} values are expanded by Claude from its own environment).
export function writeMcpConfig(file, servers) {
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
  return file;
}

const textOf = (content) => Array.isArray(content) ? content.map((c) => c.text ?? (c.type === 'image' ? '[imagen]' : '')).join('\n') : String(content ?? '');

export function createParser() {
  const state = { cliSession: null, final: '', isError: false, usage: null, text: '' };
  return {
    state,
    push(line) {
      let ev; try { ev = JSON.parse(line); } catch { return []; }
      if (ev.session_id) state.cliSession = ev.session_id;
      const items = [];
      if (ev.type === 'system' && ev.subtype === 'init') items.push({ role: 'system', kind: 'status', body: `${label} · ${ev.model ?? ''}`.trim() });
      if (ev.type === 'assistant') {
        for (const part of ev.message?.content ?? []) {
          if (part.type === 'text' && part.text?.trim()) { items.push({ role: 'assistant', kind: 'text', body: part.text }); state.text += (state.text ? '\n\n' : '') + part.text.trim(); }
          if (part.type === 'thinking' && part.thinking?.trim()) items.push({ role: 'assistant', kind: 'reasoning', body: clip(part.thinking, 4000) });
          if (part.type === 'tool_use') items.push({ role: 'tool', kind: 'tool', body: { id: part.id, name: String(part.name ?? '').replace(/^mcp__orb__/, 'orb:'), input: describeInput(part.input) } });
        }
      }
      if (ev.type === 'user') {
        for (const part of ev.message?.content ?? []) {
          if (part.type === 'tool_result') items.push({ role: 'tool', kind: 'tool_result', body: { id: part.tool_use_id, output: clip(textOf(part.content), 3000), error: Boolean(part.is_error) } });
        }
      }
      if (ev.type === 'result') {
        state.final = typeof ev.result === 'string' ? ev.result : state.text;
        state.isError = Boolean(ev.is_error) || (ev.subtype && ev.subtype !== 'success');
        state.usage = { costUsd: ev.total_cost_usd ?? null, inputTokens: ev.usage?.input_tokens ?? null, outputTokens: ev.usage?.output_tokens ?? null, turns: ev.num_turns ?? null };
        items.push({ role: 'system', kind: 'usage', body: state.usage });
        if (state.isError) items.push({ role: 'error', kind: 'text', body: clip(state.final || ev.subtype || 'error', 3000) });
      }
      return items;
    }
  };
}
