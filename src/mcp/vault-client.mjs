// 3.8.1: a connector's keys come to its launcher (launch.mjs) straight from the vault (src-tauri/vault › grants.rs), not
// through the engine: the engine's grant is a one-time name, traded here once, within a minute, for the keys.
// → the keys ({ NAME: value }), or {} when the grant is no good (used, late, or the vault is gone).
import net from 'node:net';

export function tradeGrant(vault, { timeoutMs = 10_000 } = {}) {
  if (!vault?.pipe || !vault?.grant) return Promise.resolve({});
  return new Promise((resolve) => {
    let buf = ''; let done = false;
    const end = (env) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(env && typeof env === 'object' && !Array.isArray(env) ? env : {}); };
    const socket = net.connect(vault.pipe, () => socket.write(`${JSON.stringify({ grant: vault.grant })}\n`));
    const timer = setTimeout(() => end({}), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) { if (buf.length > 1 << 20) end({}); return; }
      let env = null; try { env = JSON.parse(buf.slice(0, nl)).env; } catch { env = null; }
      end(env);
    });
    socket.on('error', () => end({}));
    socket.on('close', () => end({}));
  });
}
