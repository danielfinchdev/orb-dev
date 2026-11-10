// The MCP side of src/domain/security/agent-auth.mjs: trades this server's ticket for its grant on the engine's pipe and keeps
// the connection, so the engine can tell on every call whether the grant still holds. The ticket comes in an environment
// variable whose name is given on the command line (--ticket-env=NAME: one per server, so they never clash).
// F2.6c: the grant comes with a reconnect secret (only in this process's memory): a connection that drops while the grant
// still holds is traded again with it. An engine that is busy (its loop held by a long job) is not a lost grant: a hello
// that takes too long is tried again, and a check that does not answer in time says «busy» (null), not «no».
import net from 'node:net';

const HELLO_MS = 8000;
const CHECK_MS = 8000;

export const ticketFromArgs = (argv = process.argv, env = process.env) => {
  const name = argv.find((a) => a.startsWith('--ticket-env='))?.slice('--ticket-env='.length);
  return name ? String(env[name] ?? '') : '';
};

// → { reply, check(): Promise<true | false | null>, onClose(fn) } or null (no pipe, no ticket, or the engine said no).
// check: true while the grant holds, false once it ended, null when the engine did not answer in time.
// onClose: the grant ended (its connection closed and could not be traded again with the secret).
export async function redeem(pipe, ticket, { attempts = 20, helloMs = HELLO_MS, checkMs = CHECK_MS, reconnect = true } = {}) {
  if (!pipe || !/^[0-9a-f]{64}$/.test(ticket ?? '')) return null;
  const first = await connect(pipe, ticket, null, attempts, helloMs);
  if (!first) return null;
  let link = first; const closers = []; let ended = false;
  const end = () => { if (ended) return; ended = true; for (const fn of closers.splice(0)) { try { fn(); } catch { /* best effort */ } } };
  // The connection dropped: once more with the secret (the engine says no if the grant was taken back).
  const watch = (l) => l.closed.then(async () => {
    if (ended) return;
    const again = reconnect ? await connect(pipe, ticket, first.secret, 3, helloMs) : null;
    if (!again) { end(); return; }
    link = again; watch(again);
  });
  watch(first);
  return {
    reply: first.reply,
    check: async () => {
      if (ended) return false;
      if (link.socket.destroyed) await new Promise((r) => setTimeout(r, 200)); // a reconnect on its way
      return ended ? false : link.check(checkMs);
    },
    onClose: (fn) => { if (ended) fn(); else closers.push(fn); },
    // 3.8.2: a request for the engine (the phone's tools). → its result; throws its error.
    call: async (method, args = {}, ms = 330_000) => {
      if (ended) throw new Error('closed');
      if (link.socket.destroyed) await new Promise((r) => setTimeout(r, 200));
      return link.call(method, args, ms);
    }
  };
}

// One connection: retried while the pipe is not there yet (the engine starting) or the hello is not answered in time.
async function connect(pipe, ticket, secret, attempts, helloMs) {
  for (let i = 0; i < attempts; i++) {
    const out = await once(pipe, ticket, secret, helloMs).catch((error) => (error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED' ? 'retry' : null));
    if (out === 'slow') { i = Math.max(i, attempts - 3); continue; } // at most a few slow hellos
    if (out !== 'retry') return out;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// → { reply, secret, socket, closed: Promise, check(ms) } | null (refused) | 'slow' (no answer in time); throws on connect errors.
function once(pipe, ticket, secret, helloMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    socket.setEncoding('utf8');
    let buf = ''; let link = null; let seq = 0; let markClosed;
    const closed = new Promise((r) => { markClosed = r; });
    const waiting = new Map(); const calls = new Map();
    const timer = setTimeout(() => { if (!link) { socket.destroy(); resolve('slow'); } }, helloMs);
    socket.on('connect', () => socket.write(`${JSON.stringify(secret ? { hello: ticket, secret } : { hello: ticket })}\n`));
    socket.on('error', (error) => { if (!link) { clearTimeout(timer); reject(error); } });
    socket.on('close', () => { clearTimeout(timer); if (!link) resolve(null); for (const w of waiting.values()) w(false); waiting.clear(); for (const c of calls.values()) c({ ok: false, error: 'closed' }); calls.clear(); markClosed(); });
    socket.on('data', (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        let m; try { m = JSON.parse(buf.slice(0, nl)); } catch { m = {}; } buf = buf.slice(nl + 1);
        if (!link) {
          clearTimeout(timer);
          if (!m.ok) { socket.destroy(); resolve(null); return; }
          const { ok, secret: got, ...reply } = m;
          socket.write(`${JSON.stringify({ op: 'ack' })}\n`);
          link = {
            reply, secret: got, socket, closed,
            check: (ms) => new Promise((done) => {
              if (socket.destroyed) { done(false); return; }
              const id = ++seq;
              const t = setTimeout(() => { waiting.delete(id); done(null); }, ms);
              waiting.set(id, (v) => { clearTimeout(t); done(v); });
              socket.write(`${JSON.stringify({ op: 'check', id })}\n`);
            }),
            call: (method, args, ms) => new Promise((done, fail) => {
              if (socket.destroyed) { fail(new Error('closed')); return; }
              const id = ++seq;
              const t = setTimeout(() => { calls.delete(id); fail(new Error('timeout')); }, ms);
              calls.set(id, (m) => { clearTimeout(t); if (m.ok) done(m.result); else fail(new Error(String(m.error ?? 'error'))); });
              socket.write(`${JSON.stringify({ op: 'call', id, method, args })}\n`);
            })
          };
          resolve(link);
          continue;
        }
        if (m.call === true) { const c = calls.get(m.id); calls.delete(m.id); c?.(m); continue; }
        const w = waiting.get(m.id); waiting.delete(m.id); w?.(m.ok === true);
      }
    });
  });
}
