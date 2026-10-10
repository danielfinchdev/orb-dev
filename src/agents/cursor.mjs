// Cursor adapter. Cursor's SDK needs a separate API-key login, so Orb keeps using the official Cursor CLI the user already
// signed in to ("cursor-agent -p --output-format stream-json --stream-partial-output"), wrapped in the same live interface
// as the other agents: answers stream as they are written, a turn can be stopped, and the next turn resumes the same chat
// (--resume <chat id>). Each turn is one CLI process (the CLI has no long-lived protocol), so steer becomes "queue".
// On Windows the CLI is installed as %LOCALAPPDATA%\cursor-agent\versions\<v>\ with its own node.exe and index.js.
import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN, firstFile, inPath, appDataDirs, userHome, clip, describeInput } from './common.mjs';
import { Turn, spawnAgent, killTree } from './live.mjs';
import { tr } from '../core/context.mjs';

export const id = 'cursor';
export const label = 'Cursor';
export const kind = 'cli-stream';
export const caps = { images: false, steer: false, fork: false, approvals: false, models: true, context: false };

// In this user's Local AppData or in one moved to another drive (appDataDirs).
function windowsEntry() {
  const dirs = appDataDirs().flatMap(({ local }) => { const base = path.join(local, 'cursor-agent', 'versions'); try { return fs.readdirSync(base).map((name) => path.join(base, name)); } catch { return []; } });
  const latest = dirs.filter((dir) => firstFile([path.join(dir, 'index.js')]) && firstFile([path.join(dir, 'node.exe')]))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return latest ? { cmd: path.join(latest, 'node.exe'), pre: [path.join(latest, 'index.js')] } : null;
}

export function detect(cfg = {}) {
  if (cfg.path && firstFile([cfg.path])) return { cmd: cfg.path, pre: [] };
  if (IS_WIN) {
    // The node.exe + index.js of the newest version (the most reliable way to start it); otherwise the executables some
    // installs place in the folder root.
    const entry = windowsEntry(); if (entry) return entry;
    const exe = firstFile(appDataDirs().flatMap(({ local }) => [path.join(local, 'cursor-agent', 'cursor-agent.exe'), path.join(local, 'cursor-agent', 'agent.exe')]));
    if (exe) return { cmd: exe, pre: [] };
  }
  const found = firstFile([...inPath('cursor-agent'), ...inPath('agent'), path.join(userHome(), '.local', 'bin', IS_WIN ? 'cursor-agent.exe' : 'cursor-agent')]);
  return found ? { cmd: found, pre: [] } : null;
}

// The CLI keeps its login in ~/.cursor (cli-config.json); the file is a good sign, not a proof.
export function loginState() {
  const dir = path.join(userHome(), '.cursor');
  if (firstFile([path.join(dir, 'cli-config.json')])) return 'si';
  return fs.existsSync(dir) ? 'desconocido' : 'no';
}
export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre, 'login'] });

// Windows refuses command lines near 32 767 characters and Cursor only takes the prompt as an argument:
// long prompts go as a pointer to a file next to the conversation's log.
export const ARGV_PROMPT_MAX = 20000;

// Cursor's tool calls arrive as { tool_call: { <name>ToolCall: { args, result } } }.
function toolOf(call) {
  const [key, value] = Object.entries(call ?? {})[0] ?? [];
  return { name: key ? String(key).replace(/ToolCall$/, '') : tr('sys.agents.tool.other'), args: value?.args, result: value?.result };
}

// options: exe, cwd, model, permission, resumeId, promptDir, env, log, onEvent
export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const log = o.log ?? (() => {});
  let model = o.model || null; let permission = o.permission ?? 'editar';
  let child = null; let turn = null; let closed = false;
  const live = { sessionId: o.resumeId ?? null, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };

  live.send = async ({ text }) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: 'Cursor' }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn(); const current = turn;
    let prompt = text;
    if (text.length > ARGV_PROMPT_MAX) {
      const file = path.join(o.promptDir ?? o.cwd, `orb-encargo-${Date.now()}.md`);
      try { fs.writeFileSync(file, text); prompt = `Tus instrucciones completas están en el archivo ${file}. Léelo entero y síguelo como si fuera este mensaje.`; } catch { /* sent as is */ }
    }
    const args = [...o.exe.pre, '-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust', '--workspace', o.cwd];
    if (permission === 'leer') args.push('--mode', 'ask'); else args.push('--force');
    if (model && model !== 'auto') args.push('--model', model);
    if (live.sessionId) args.push('--resume', live.sessionId);
    args.push(prompt);
    child = spawnAgent(o.exe.cmd, args, { cwd: o.cwd, env: o.env, log });
    live.pid = child.pid;
    let buffer = ''; let streamed = '';
    const handle = (line) => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      log(line);
      if (ev.session_id && ev.session_id !== live.sessionId) { live.sessionId = ev.session_id; onEvent({ type: 'session', id: ev.session_id }); }
      if (ev.type === 'system' && ev.subtype === 'init') onEvent({ type: 'item', role: 'system', kind: 'status', body: `${label} · ${ev.model ?? ''}`.trim() });
      if (ev.type === 'assistant') {
        const t = (ev.message?.content ?? []).map((c) => c.text ?? '').join('');
        // With --stream-partial-output the text arrives in pieces (they carry timestamp_ms), then once complete.
        if (t && ev.timestamp_ms) { streamed += t; onEvent({ type: 'delta', text: t }); }
        else if (t.trim()) { streamed = ''; onEvent({ type: 'item', role: 'assistant', kind: 'text', body: t }); current.addText(t); }
      }
      if (ev.type === 'tool_call') {
        if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); streamed = ''; }
        const tool = toolOf(ev.tool_call);
        if (ev.subtype === 'started') onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: ev.call_id, name: tool.name, input: describeInput(tool.args) } });
        if (ev.subtype === 'completed') {
          const r = tool.result ?? {};
          onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: ev.call_id, output: clip(r.success ?? r.error ?? r, 3000), error: Boolean(r.error) } });
        }
      }
      if (ev.type === 'result') {
        if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); streamed = ''; }
        const isError = Boolean(ev.is_error) || Boolean(ev.subtype && ev.subtype !== 'success');
        const final = typeof ev.result === 'string' && ev.result ? ev.result : current.text;
        if (isError) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(final || 'error', 3000) });
        if (ev.duration_ms) onEvent({ type: 'item', role: 'system', kind: 'usage', body: { durationMs: ev.duration_ms } });
        current.finish({ final, isError, limit: isError && /usage limit|rate limit|quota/i.test(final) ? { resetAt: null } : null });
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk; let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1); if (line) handle(line); }
      if (buffer.length > 8 * 1024 * 1024) buffer = '';
    });
    child.on('exit', (code) => {
      if (buffer.trim()) handle(buffer.trim());
      if (streamed.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: streamed }); current.addText(streamed); }
      const stderr = child.stderrText();
      if (!current.done) {
        const msg = current.text || tr('sys.agents.exitedCode', { name: 'Cursor', code, detail: stderr.trim().split('\n').slice(-3).join(' ') }).trim();
        if (code !== 0 && !current.text) onEvent({ type: 'item', role: 'error', kind: 'text', body: clip(msg, 3000) });
        current.finish({ isError: code !== 0, final: msg });
      }
    });
    child.on('error', (error) => { if (!current.done) current.finish({ isError: true, final: tr('sys.agents.startFailed', { name: 'Cursor', error: error.message }) }); });
    return current.promise;
  };
  live.steer = () => false;
  live.interrupt = async () => { killTree(child); };
  live.respond = () => false;
  live.setModel = (m) => { model = m || null; };
  live.setPermission = (p) => { permission = p; };
  live.close = () => { closed = true; killTree(child); };
  live.isClosed = () => closed;
  return live;
}
