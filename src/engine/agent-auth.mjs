// 3.8: who an agent's MCP process is lives only in the engine's memory, never in a file an agent could write. Each MCP
// server Orb hands an agent (its own board and the user's connectors) gets a ticket: a random value the engine keeps
// with what it grants (who the process is, or how to start a connector with its keys). The server trades it on a local
// pipe for that grant when it starts and asks again on every call; the ticket stays bound to that connection while it
// is open, so the copy in the agent's environment (its shell sees it) is worth nothing while the server runs. A ticket
// ends with its agent's process (revoke) and with the engine: a new start knows no ticket of before.
// F2.6c: a ticket is traded once. The server confirms it got the grant (ack); from then on only the reconnect secret that
// came with the grant (kept in the server's memory, never in the environment) trades it again, so a ticket set free (its
// server died) is no use to whoever copied it. Cursor starts its servers again every turn: its tickets are new every
// turn, may be traded again during that turn and are taken back when it ends (reusable).
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const RELEASE_WAIT_MS = 3000; // a server that restarts waits for the old connection to go
const HELLO_WITHIN_MS = 10_000; // a connection that never says hello is closed

export class AgentAuth {
  constructor() { this.grants = new Map(); this.server = null; this.pipe = null; }

  // The pipe's name (the server starts listening the first time it is needed).
  get address() { this.listen(); return this.pipe; }
  listen() {
    if (this.server) return;
    const id = crypto.randomBytes(12).toString('hex');
    this.pipe = process.platform === 'win32' ? `\\\\.\\pipe\\orb-agentes-${id}` : path.join(os.tmpdir(), `orb-agentes-${id}.sock`);
    this.server = net.createServer((socket) => this.serve(socket));
    this.server.on('error', () => { /* a client that goes away mid-hello */ });
    this.server.listen(this.pipe);
    this.server.unref();
  }

  // grant: { session, reply, reusable } — reply is what the MCP process receives; session, which agent process it
  // belongs to; reusable, traded again without the secret until revoked (Cursor's servers of one turn).
  issue(grant) {
    this.listen();
    const ticket = crypto.randomBytes(32).toString('hex');
    this.grants.set(ticket, { session: grant.session == null ? null : String(grant.session), reply: grant.reply, reusable: Boolean(grant.reusable), holder: null, secret: null, acked: false });
    return ticket;
  }
  // The tickets of one agent process (its session id), when it closes: their servers lose their grant at once.
  revokeSession(session) { for (const [ticket, g] of this.grants) if (g.session === String(session)) this.revoke(ticket); }
  revoke(ticket) {
    const g = this.grants.get(ticket); if (!g) return;
    this.grants.delete(ticket);
    try { g.holder?.destroy(); } catch { /* gone */ }
  }
  valid(ticket) { return this.grants.has(ticket); }

  serve(socket) {
    socket.setEncoding('utf8');
    let buf = ''; let ticket = null; let busy = Promise.resolve();
    const send = (m) => { try { socket.write(`${JSON.stringify(m)}\n`); } catch { /* gone */ } };
    const idle = setTimeout(() => { if (ticket == null) socket.destroy(); }, this.helloWithin ?? HELLO_WITHIN_MS);
    idle.unref?.();
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(idle); const g = ticket && this.grants.get(ticket); if (g?.holder === socket) g.holder = null; });
    const handle = async (m) => {
      if (ticket == null) {
        const t = typeof m?.hello === 'string' ? m.hello : '';
        let g = this.grants.get(t);
        for (let waited = 0; g && g.holder && !g.holder.destroyed && waited < RELEASE_WAIT_MS; waited += 50) { await new Promise((r) => setTimeout(r, 50)); g = this.grants.get(t); }
        const traded = g && g.acked && !g.reusable && !(typeof m.secret === 'string' && m.secret === g.secret);
        if (!g || (g.holder && !g.holder.destroyed) || traded || socket.destroyed) { send({ ok: false }); socket.end(); return; }
        ticket = t; g.holder = socket; clearTimeout(idle);
        g.secret ??= crypto.randomBytes(32).toString('hex');
        // reply: a function when it is made at each trade (a connector's one-time grant of the vault, sessions.mjs).
        send({ ok: true, ...(typeof g.reply === 'function' ? g.reply() : g.reply), secret: g.secret });
        return;
      }
      const g = this.grants.get(ticket);
      if (m?.op === 'ack' && g?.holder === socket) g.acked = true;
      if (m?.op === 'check') send({ id: m.id, ok: g?.holder === socket });
    };
    socket.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 64 * 1024) { socket.destroy(); return; }
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        let m; try { m = JSON.parse(buf.slice(0, nl)); } catch { m = null; }
        buf = buf.slice(nl + 1);
        busy = busy.then(() => handle(m)).catch(() => socket.destroy());
      }
    });
  }
}

// The engine's one instance (the tests' in-process engines share it too).
export const agentAuth = new AgentAuth();
