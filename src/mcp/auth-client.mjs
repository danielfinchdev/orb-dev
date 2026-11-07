// The MCP side of src/engine/agent-auth.mjs: trades this server's ticket for its grant on the engine's pipe and keeps
// the connection, so the engine can tell on every call whether the grant still holds. The ticket comes in an environment
// variable whose name is given on the command line (--ticket-env=NAME: one per server, so they never clash).
import net from 'node:net';

export const ticketFromArgs = (argv = process.argv, env = process.env) => {
  const name = argv.find((a) => a.startsWith('--ticket-env='))?.slice('--ticket-env='.length);
  return name ? String(env[name] ?? '') : '';
};

// → { reply, check(): Promise<boolean>, onClose(fn) } or null (no pipe, no ticket, or the engine said no).
export async function redeem(pipe, ticket, { attempts = 20 } = {}) {
  if (!pipe || !/^[0-9a-f]{64}$/.test(ticket ?? '')) return null;
  for (let i = 0; i < attempts; i++) {
    const out = await once(pipe, ticket).catch((error) => (error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED' ? 'retry' : null));
    if (out !== 'retry') return out;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function once(pipe, ticket) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    socket.setEncoding('utf8');
    let buf = ''; let hello = null; let seq = 0;
    const waiting = new Map(); const closers = [];
    const gone = () => { for (const w of waiting.values()) w(false); waiting.clear(); for (const fn of closers.splice(0)) { try { fn(); } catch { /* best effort */ } } };
    socket.on('connect', () => socket.write(`${JSON.stringify({ hello: ticket })}\n`));
    socket.on('error', (error) => { if (!hello) reject(error); });
    socket.on('close', () => { if (!hello) resolve(null); gone(); });
    socket.on('data', (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        let m; try { m = JSON.parse(buf.slice(0, nl)); } catch { m = {}; } buf = buf.slice(nl + 1);
        if (!hello) {
          if (!m.ok) { socket.destroy(); resolve(null); return; }
          const { ok, ...reply } = m;
          hello = {
            reply,
            check: () => new Promise((done) => {
              if (socket.destroyed) { done(false); return; }
              const id = ++seq;
              const timer = setTimeout(() => { waiting.delete(id); done(false); }, 5000);
              waiting.set(id, (v) => { clearTimeout(timer); done(v); });
              socket.write(`${JSON.stringify({ op: 'check', id })}\n`);
            }),
            onClose: (fn) => { if (socket.destroyed) fn(); else closers.push(fn); }
          };
          resolve(hello);
          continue;
        }
        const w = waiting.get(m.id); waiting.delete(m.id); w?.(m.ok === true);
      }
    });
  });
}
