// Pi (the coding agent of pi.dev / badlogic's pi-mono). It is not ACP: its own RPC mode is JSON lines over stdio
// (`pi --mode rpc`): a command per line in ({ type: 'prompt', message } / { type: 'abort' }) and events per line out
// (message_update with text deltas, tool_execution_start / _end, agent_end). One process per conversation.
// NOT verified: Pi was not installed when this was written, so the protocol below comes from its public documentation and
// is checked only against a simulated process (test/agentes-pi-antigravity.test.mjs). Off by default; check `pi --help`
// and `pi --mode rpc` by hand before turning it on. Pi has no permission system of its own: see unguarded.mjs.
import path from 'node:path';
import { IS_WIN, firstFile, inPath, userHome } from '../platform/proc.mjs';
import { clip } from './common.mjs';
import { Turn, spawnAgent, killTree, hidingEnvValues, maskingValues } from './live.mjs';
import { tr } from '../platform/context.mjs';
import { requireLevel, UNGUARDED_LEVELS } from './unguarded.mjs';
import { npmBin } from './acp.mjs';

export const id = 'pi';
export const label = 'Pi';
export const kind = 'cli-stream';
export const unverified = true;
export const caps = { images: false, steer: false, fork: false, approvals: false, models: false, context: false };
export const install = null;
export const strengths = 'agente minimalista y extensible, con muchos proveedores de modelos';
const rpcArgs = ['--mode', 'rpc'];

export function detect(cfg = {}) {
  if (cfg.path && firstFile([cfg.path])) return { cmd: cfg.path, pre: [] };
  const npm = npmBin('@mariozechner/pi-coding-agent', 'pi');
  if (npm) return npm;
  const names = IS_WIN ? ['pi.exe'] : ['pi'];
  const found = firstFile(inPath('pi')) ?? firstFile(names.map((n) => path.join(userHome(), '.local', 'bin', n)));
  return found ? { cmd: found, pre: [] } : null;
}
// Pi keeps its settings and provider logins in ~/.pi/agent (auth.json); a good sign, not a proof.
export function loginState() { return firstFile([path.join(userHome(), '.pi', 'agent', 'auth.json')]) ? 'si' : 'desconocido'; }
export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre] });

export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const mask = maskingValues(o.secretValues);
  const log = hidingEnvValues(o.log ?? (() => {}), o.mcpServers, o.secretValues);
  requireLevel(o.permission, label);
  let child = null; let turn = null; let closed = false; let buffer = ''; let text = '';
  const live = { sessionId: o.resumeId ?? null, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };
  const send = (cmd) => { try { child.stdin.write(`${JSON.stringify(cmd)}\n`); return true; } catch { return false; } };
  const flush = () => { if (text.trim()) { onEvent({ type: 'item', role: 'assistant', kind: 'text', body: text }); turn?.addText(text); } text = ''; };

  function handle(line) {
    let ev; try { ev = JSON.parse(line); } catch { log(`línea no JSON: ${line.slice(0, 200)}`); return; }
    log(line);
    switch (ev.type) {
      case 'message_update': {
        const d = ev.assistantMessageEvent;
        if (d?.type === 'text_delta' && d.delta) { text += d.delta; onEvent({ type: 'delta', text: d.delta }); }
        break;
      }
      case 'tool_execution_start': flush(); onEvent({ type: 'item', role: 'tool', kind: 'tool', body: { id: ev.toolCallId, name: ev.toolName || tr('sys.agents.tool.other'), input: clip(JSON.stringify(ev.args ?? ''), 300) } }); break;
      case 'tool_execution_end': onEvent({ type: 'item', role: 'tool', kind: 'tool_result', body: { id: ev.toolCallId, output: clip(typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? ''), 3000), error: ev.isError === true } }); break;
      case 'response': if (ev.success === false && turn && !turn.done) { flush(); turn.finish({ isError: true, final: mask(String(ev.error ?? 'error')) }); } break;
      case 'agent_end': if (turn && !turn.done) { flush(); turn.finish({ stopReason: 'end_turn', final: turn.text }); } break;
      default: break;
    }
  }

  function start() {
    const args = [...o.exe.pre, ...rpcArgs, ...(o.model ? ['--model', o.model] : [])];
    child = spawnAgent(o.exe.cmd, args, { cwd: o.cwd, env: o.env, log });
    live.pid = child.pid;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1); if (line) { try { handle(line); } catch (error) { log(`mensaje del agente: ${error.stack}`); } } }
      if (buffer.length > 16 * 1024 * 1024) buffer = '';
    });
    child.stdin.on('error', () => {});
    child.on('exit', (code) => {
      closed = true;
      onEvent({ type: 'exit', code, stderr: mask(child.stderrText()) });
      if (turn && !turn.done) { flush(); turn.finish({ isError: true, final: turn.text || tr('sys.agents.exitedCode', { name: label, code, detail: mask(child.stderrText()).trim().split('\n').slice(-2).join(' ') }).trim() }); }
    });
    child.on('error', (error) => { closed = true; if (turn && !turn.done) turn.finish({ isError: true, final: tr('sys.agents.startFailed', { name: label, error: error.message }) }); });
    onEvent({ type: 'item', role: 'system', kind: 'status', body: `${label}${o.model ? ` · ${o.model}` : ''}` });
  }

  live.send = async ({ text: message }) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: label }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn(); const current = turn; text = '';
    if (!child) start();
    if (!send({ type: 'prompt', message })) current.finish({ isError: true, final: tr('sys.agents.sessionClosed', { name: label }) });
    return current.promise;
  };
  live.steer = () => false;
  live.interrupt = async () => { if (child && turn && !turn.done) send({ type: 'abort' }); };
  live.respond = () => false;
  live.setModel = (m) => { o.model = m; };
  // a level it cannot keep (the chat was taken off «total» or Orb locked): the process ends, nothing throws (the caller goes on revoking)
  live.setPermission = (p) => { o.permission = p; if (!UNGUARDED_LEVELS.includes(p)) live.close(); };
  live.close = () => { closed = true; killTree(child); };
  live.isClosed = () => closed;
  return live;
}
