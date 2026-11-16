// Antigravity (Google). It has no live protocol: only a «print» mode that answers one prompt and quits. So each turn is one
// process (`<bin> --print -- <prompt>`, the prompt on stdin when it is long), its standard output is the answer, and there is no
// conversation to resume (every turn starts from the prompt alone). No streaming, no tools shown.
// NOT verified: Antigravity's CLI was not installed when this was written, so the program name («antigravity», or «agy»)
// and the flag come from public documentation and are checked only against a simulated process
// (test/agentes-pi-antigravity.test.mjs). Off by default; run `antigravity --help` by hand before turning it on.
// It has no permission system Orb can use: see unguarded.mjs.
import path from 'node:path';
import { IS_WIN, firstFile, inPath, userHome } from '../platform/proc.mjs';
import { Turn, spawnAgent, killTree, hidingEnvValues, maskingValues } from './live.mjs';
import { tr } from '../platform/context.mjs';
import { requireLevel, UNGUARDED_LEVELS } from './unguarded.mjs';

export const id = 'antigravity';
export const label = 'Antigravity';
export const kind = 'cli-stream';
export const unverified = true;
export const caps = { images: false, steer: false, fork: false, approvals: false, models: false, context: false };
export const install = null;
export const strengths = 'agente de Google con ventanas de contexto muy grandes';
export const printArgs = ['--print'];
export const PROMPT_MAX = 20000; // longer prompts go on stdin (Windows refuses command lines near 32 767 characters)

export function detect(cfg = {}) {
  if (cfg.path && firstFile([cfg.path])) return { cmd: cfg.path, pre: [] };
  const names = (n) => (IS_WIN ? [`${n}.exe`] : [n]);
  const found = firstFile([...inPath('antigravity'), ...inPath('agy')])
    ?? firstFile(['antigravity', 'agy'].flatMap((n) => names(n).map((x) => path.join(userHome(), '.local', 'bin', x))));
  return found ? { cmd: found, pre: [] } : null;
}
export function loginState() { return firstFile([path.join(userHome(), '.antigravity', 'auth.json'), path.join(userHome(), '.config', 'antigravity', 'auth.json')]) ? 'si' : 'desconocido'; }
export const loginCommand = (exe) => ({ cmd: exe.cmd, args: [...exe.pre] });

export function createLive(o) {
  const onEvent = o.onEvent ?? (() => {});
  const mask = maskingValues(o.secretValues);
  const log = hidingEnvValues(o.log ?? (() => {}), o.mcpServers, o.secretValues);
  requireLevel(o.permission, label);
  let child = null; let turn = null; let closed = false;
  const live = { sessionId: null, caps, pid: null, get busy() { return Boolean(turn && !turn.done); } };

  live.send = async ({ text: message }) => {
    if (closed) throw new Error(tr('sys.agents.sessionClosed', { name: label }));
    if (turn && !turn.done) throw new Error(tr('sys.agents.busy'));
    turn = new Turn(); const current = turn;
    const long = String(message).length > PROMPT_MAX;
    const args = [...o.exe.pre, ...printArgs, ...(o.model ? ['--model', o.model] : []), ...(long ? [] : ['--', String(message)])];
    child = spawnAgent(o.exe.cmd, args, { cwd: o.cwd, env: o.env, log });
    live.pid = child.pid;
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => { if (out.length < 4_000_000) out += c; });
    child.stdin.on('error', () => {});
    try { child.stdin.end(long ? String(message) : undefined); } catch { /* gone */ }
    child.on('error', (error) => { if (!current.done) current.finish({ isError: true, final: tr('sys.agents.startFailed', { name: label, error: error.message }) }); });
    child.on('close', (code) => {
      if (current.done) return;
      const answer = mask(out).trim();
      if (code === 0) {
        if (answer) { onEvent({ type: 'delta', text: answer }); onEvent({ type: 'item', role: 'assistant', kind: 'text', body: answer }); current.addText(answer); }
        current.finish({ stopReason: 'end_turn', final: current.text });
      } else {
        const detail = mask(child.stderrText()).trim().split('\n').slice(-2).join(' ');
        current.finish({ isError: true, final: answer || tr('sys.agents.exitedCode', { name: label, code, detail }).trim() });
      }
    });
    onEvent({ type: 'item', role: 'system', kind: 'status', body: `${label}${o.model ? ` · ${o.model}` : ''}` });
    return current.promise;
  };
  live.steer = () => false;
  live.interrupt = async () => { killTree(child); };
  live.respond = () => false;
  live.setModel = (m) => { o.model = m; };
  // a level it cannot keep (the chat was taken off «total» or Orb locked): the process ends, nothing throws (the caller goes on revoking)
  live.setPermission = (p) => { o.permission = p; if (!UNGUARDED_LEVELS.includes(p)) live.close(); };
  live.close = () => { closed = true; killTree(child); };
  live.isClosed = () => closed;
  return live;
}
