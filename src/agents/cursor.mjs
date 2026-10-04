// Cursor CLI adapter ("cursor-agent -p --output-format stream-json", --resume <chat id> to continue).
// On Windows the CLI is installed as %LOCALAPPDATA%\cursor-agent\versions\<v>\ with its own node.exe and index.js.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, userHome, clip, describeInput } from './common.mjs';

export const id = 'cursor';
export const label = 'Cursor';

function windowsEntry() {
  const base = path.join(process.env.LOCALAPPDATA ?? path.join(userHome(), 'AppData', 'Local'), 'cursor-agent', 'versions');
  let dirs; try { dirs = fs.readdirSync(base).map((name) => path.join(base, name)); } catch { return null; }
  const latest = dirs.filter((dir) => firstFile([path.join(dir, 'index.js')]) && firstFile([path.join(dir, 'node.exe')]))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return latest ? { cmd: path.join(latest, 'node.exe'), pre: [path.join(latest, 'index.js')] } : null;
}

export function detect(cfg = {}) {
  if (cfg.path && firstFile([cfg.path])) return { cmd: cfg.path, pre: [] };
  if (IS_WIN) {
    // The node.exe + index.js of the newest version (what Jarvis 1.5 used, reliable); otherwise the executables some
    // installs place in the folder root.
    const entry = windowsEntry(); if (entry) return entry;
    const base = path.join(process.env.LOCALAPPDATA ?? path.join(userHome(), 'AppData', 'Local'), 'cursor-agent');
    const exe = firstFile([path.join(base, 'cursor-agent.exe'), path.join(base, 'agent.exe')]);
    if (exe) return { cmd: exe, pre: [] };
  }
  const found = firstFile([...inPath('cursor-agent'), ...inPath('agent'), path.join(userHome(), '.local', 'bin', IS_WIN ? 'cursor-agent.exe' : 'cursor-agent')]);
  return found ? { cmd: found, pre: [] } : null;
}

export function loginState() {
  return fs.existsSync(path.join(userHome(), '.cursor')) ? 'desconocido' : 'no';
}

export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, 'login'] });

// Windows refuses command lines near 32 767 characters and Cursor only takes the prompt as an argument:
// long prompts go as a pointer to the file where the caller saved them.
export const ARGV_PROMPT_MAX = 20000;

export function buildTurn({ exe, cwd, prompt, promptFile, model, permission = 'editar', session }) {
  const text = prompt.length > ARGV_PROMPT_MAX && promptFile ? `Tus instrucciones completas están en el archivo ${promptFile}. Léelo entero y síguelo como si fuera este mensaje.` : prompt;
  const args = [...exe.pre, '-p', '--output-format', 'stream-json', '--trust', '--workspace', cwd];
  if (permission !== 'leer') args.push('--force');
  // No --approve-mcps: Cursor's MCP servers are global (~/.cursor/mcp.json) and may belong to another program (e.g. Orb
  // 1.5's "jarvis"). The task reports through its final answer instead.
  if (model && model !== 'auto') args.push('--model', model);
  if (session?.resume && session.id) args.push('--resume', session.id);
  args.push(text);
  return { cmd: exe.cmd, args, stdin: null };
}

// Cursor's tool calls arrive as { tool_call: { <name>ToolCall: { args, result } } }.
function toolOf(call) {
  const [key, value] = Object.entries(call ?? {})[0] ?? [];
  return { name: String(key ?? 'herramienta').replace(/ToolCall$/, ''), args: value?.args, result: value?.result };
}

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
        const text = (ev.message?.content ?? []).map((c) => c.text ?? '').join('');
        if (text.trim()) { items.push({ role: 'assistant', kind: 'text', body: text }); state.text += text; }
      }
      if (ev.type === 'tool_call') {
        const tool = toolOf(ev.tool_call);
        if (ev.subtype === 'started') items.push({ role: 'tool', kind: 'tool', body: { id: ev.call_id, name: tool.name, input: describeInput(tool.args) } });
        if (ev.subtype === 'completed') {
          const r = tool.result ?? {};
          items.push({ role: 'tool', kind: 'tool_result', body: { id: ev.call_id, output: clip(r.success ?? r.error ?? r, 3000), error: Boolean(r.error) } });
        }
      }
      if (ev.type === 'result') {
        state.final = typeof ev.result === 'string' ? ev.result : state.text;
        state.isError = Boolean(ev.is_error) || (ev.subtype && ev.subtype !== 'success');
        state.usage = { durationMs: ev.duration_ms ?? null };
        if (state.isError) items.push({ role: 'error', kind: 'text', body: clip(state.final || 'error', 3000) });
      }
      return items;
    }
  };
}
