// Live sessions with the agents (2.3): one process per conversation that stays open between turns, instead of one
// process per message. Every agent adapter returns an object with the same shape, so sessions, tasks and the assistant
// do not care which agent is behind it:
//
//   live.send({ text, images })   → Promise<TurnResult>   one turn; resolves when the agent finishes it
//   live.steer({ text })          → boolean               adds a message to the running turn (when the agent can)
//   live.interrupt()                                      stops the running turn (the session stays open)
//   live.respond(requestId, decision)                     answers an approval request: 'allow' | 'always' | 'deny'
//   live.setModel(model) / live.setPermission(p)          for the next turns (when the agent can)
//   live.close()                                          ends the process
//   live.sessionId                                        the agent's own conversation id (to resume it later)
//   live.caps                                             { steer, approvals, fork, interrupt, context }
//
// Events go to onEvent(ev):
//   { type: 'item', role, kind, body }        what the window shows (same items as before: text, reasoning, tool…)
//   { type: 'delta', text }                   streamed text of the answer being written (not stored)
//   { type: 'session', id }                   the agent's conversation id
//   { type: 'approval', request }             { id, tool, title, input, kind } waiting for respond()
//   { type: 'approval_done', id, decision }
//   { type: 'context', used, size }           how full the context window is
//   { type: 'limit', resetAt, message }       the account hit its usage limit (resetAt: ms epoch or null)
//   { type: 'exit', code, stderr }            the process ended
// TurnResult: { final, text, isError, stopReason, usage, limit }
import { spawn } from 'node:child_process';
import { killTree, cleanEnv } from './common.mjs';
import { tr } from '../core/context.mjs';

export const DECISIONS = ['allow', 'always', 'deny'];

// A turn that finishes once: send() returns its promise, the adapter calls finish() when the agent says it is over.
export class Turn {
  constructor() {
    this.text = ''; this.final = ''; this.isError = false; this.usage = null; this.stopReason = null; this.limit = null; this.done = false;
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }
  addText(t) { if (t && t.trim()) this.text += (this.text ? '\n\n' : '') + t.trim(); }
  finish(patch = {}) {
    if (this.done) return; this.done = true;
    Object.assign(this, patch);
    if (!this.final) this.final = this.text;
    this.resolve({ final: this.final, text: this.text, isError: this.isError, stopReason: this.stopReason, usage: this.usage, limit: this.limit });
  }
}

// Tokens Orb hands to the agents' MCP servers ({"ORB_BROWSER_TOKEN":"…"} or {"name":"ORB_…TOKEN","value":"…"}) stay out
// of the session logs.
const LOGGED_SECRET = /(ORB_[A-Z_]*(?:TOKEN|KEY)"(?:\s*,\s*"value")?\s*:\s*")[^"]*/g;

// JSON-RPC 2.0 over a child's stdin/stdout, one message per line (Codex app-server and ACP agents).
export class JsonRpcPeer {
  constructor(child, { onNotification = () => {}, onRequest = async () => { throw new Error(tr('sys.agents.notSupported')); }, log = () => {} } = {}) {
    this.child = child; this.onNotification = onNotification; this.onRequest = onRequest; this.log = log;
    this.nextId = 1; this.pending = new Map(); this.buffer = ''; this.closed = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) { const line = this.buffer.slice(0, nl).trim(); this.buffer = this.buffer.slice(nl + 1); if (line) this.handle(line); }
      if (this.buffer.length > 16 * 1024 * 1024) this.buffer = ''; // a runaway line must not eat the memory
    });
    child.stdin.on('error', () => {});
  }
  handle(line) {
    let msg; try { msg = JSON.parse(line); } catch { this.log(`línea no JSON: ${line.slice(0, 200)}`); return; }
    this.log(line);
    if (msg.id != null && msg.method) { // a request from the agent
      Promise.resolve().then(() => this.onRequest(msg.method, msg.params ?? {}, msg.id))
        .then((result) => this.write({ jsonrpc: '2.0', id: msg.id, result: result ?? null }))
        .catch((error) => this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(error?.message ?? error) } }));
      return;
    }
    if (msg.id != null) { // a response to one of ours
      const p = this.pending.get(msg.id); if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) { const e = new Error(msg.error.message ?? 'error'); e.code = msg.error.code; e.data = msg.error.data; p.reject(e); } else p.resolve(msg.result);
      return;
    }
    if (msg.method) this.onNotification(msg.method, msg.params ?? {});
  }
  write(obj) {
    if (this.closed) return;
    const text = JSON.stringify(obj);
    this.log(`→ ${text.replace(LOGGED_SECRET, '$1***').slice(0, 2000)}`);
    try { this.child.stdin.write(`${text}\n`); } catch { /* closed */ }
  }
  request(method, params, { timeoutMs = 0 } = {}) {
    if (this.closed) return Promise.reject(new Error(tr('sys.agents.disconnected')));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.pending.delete(id); reject(new Error(tr('sys.agents.noReply', { method }))); }, timeoutMs) : null;
      this.pending.set(id, { resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); }, reject: (e) => { if (timer) clearTimeout(timer); reject(e); } });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }
  close(reason = tr('sys.agents.closed')) {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }
}

// Starts an agent's process for a live session: no shell, clean environment, stderr kept for error messages.
export function spawnAgent(cmd, args, { cwd, env = {}, log = () => {} } = {}) {
  const child = spawn(cmd, args, { cwd, env: cleanEnv(env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-8000); log(`stderr: ${c}`); });
  child.stderrText = () => stderr;
  return child;
}

// Pending approval requests of one live session: the adapter registers each request with how to answer it; respond()
// resolves it. Requests are cleared (denied) when the turn is interrupted or the process ends.
export class Approvals {
  constructor(onEvent) { this.onEvent = onEvent; this.waiting = new Map(); }
  ask(request) {
    return new Promise((resolve) => {
      this.waiting.set(request.id, resolve);
      this.onEvent({ type: 'approval', request });
    });
  }
  respond(id, decision) {
    const resolve = this.waiting.get(id); if (!resolve) return false;
    this.waiting.delete(id);
    const d = DECISIONS.includes(decision) ? decision : 'deny';
    this.onEvent({ type: 'approval_done', id, decision: d });
    resolve(d);
    return true;
  }
  clear() { for (const id of [...this.waiting.keys()]) this.respond(id, 'deny'); }
}

export { killTree };
