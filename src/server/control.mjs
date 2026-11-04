// 3.5, Orb Núcleo: a local door into the running engine for the commands of the same user on the same machine
// («orb-nucleo enlazar» while systemd runs the server). A Unix socket in <home>/.orb (0600) or, on Windows, a named pipe.
// One JSON per line: { id, method, params } → { id, ok, result | error }. Only a short list of methods: making a link
// code and seeing the devices; everything else stays with the engine's own interfaces.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

// 3.5.1: also closing a device's link (orb-nucleo quitar): whoever is on the server itself is its owner, so a lost or
// stolen phone that administers it can be taken out from here.
export const CONTROL_METHODS = new Set(['link.qr', 'link.devices', 'link.status', 'link.revoke', 'app.state']);

// 3.5.1 (orb-nucleo quitar): the device named by its id (or the start of it, 4+ characters) or its exact name.
export function pickDevice(list, target) {
  const q = String(target ?? '').trim().toLowerCase();
  if (!q) return { error: 'none' };
  const byId = list.filter((d) => d.id.toLowerCase() === q || (q.length >= 4 && d.id.toLowerCase().startsWith(q)));
  const found = byId.length ? byId : list.filter((d) => String(d.name).toLowerCase() === q);
  return found.length === 1 ? { device: found[0] } : { error: found.length ? 'many' : 'none' };
}
export function controlPath(home) {
  const dir = path.join(path.resolve(home), '.orb');
  if (process.platform === 'win32') return `\\\\.\\pipe\\orb-nucleo-${crypto.createHash('sha256').update(path.resolve(home).toLowerCase()).digest('hex').slice(0, 16)}`;
  const file = path.join(dir, 'nucleo.sock');
  // Unix sockets have a short path limit (about 104 bytes): a long home gets a socket in the temp folder, by its hash.
  return Buffer.byteLength(file) < 100 ? file : path.join('/tmp', `orb-nucleo-${crypto.createHash('sha256').update(path.resolve(home)).digest('hex').slice(0, 16)}.sock`);
}

export function serveControl({ home, call, log = () => {} }) {
  const where = controlPath(home);
  if (process.platform !== 'win32') { try { fs.unlinkSync(where); } catch { /* none left */ } }
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 64_000) { sock.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        const answer = (o) => { try { sock.write(`${JSON.stringify({ id: m.id, ...o })}\n`); } catch { /* gone */ } };
        if (!CONTROL_METHODS.has(m?.method)) { answer({ ok: false, error: 'no permitido' }); continue; }
        Promise.resolve().then(() => call(m.method, m.params && typeof m.params === 'object' ? m.params : {}))
          .then((result) => answer({ ok: true, result: result ?? null }), (error) => answer({ ok: false, error: String(error?.message ?? error) }));
      }
    });
  });
  server.on('error', (error) => log(`control: ${error.message}`));
  const ready = new Promise((resolve) => {
    server.listen(where, () => {
      if (process.platform !== 'win32') { try { fs.chmodSync(where, 0o600); } catch { /* best effort */ } }
      resolve(where);
    });
    server.once('error', () => resolve(null));
  });
  return { where, ready, close: () => new Promise((r) => { server.close(() => r()); if (process.platform !== 'win32') { try { fs.unlinkSync(where); } catch { /* gone */ } } }) };
}

// A call to the running Orb Núcleo of this home. Rejects with { code: 'ENOENT' | 'ECONNREFUSED' } when it is not running.
export function controlCall(home, method, params = {}, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(controlPath(home));
    let buf = ''; const id = crypto.randomUUID();
    const timer = setTimeout(() => { sock.destroy(); reject(Object.assign(new Error('el motor no contesta'), { code: 'ETIMEDOUT' })); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('connect', () => sock.write(`${JSON.stringify({ id, method, params })}\n`));
    sock.on('data', (chunk) => {
      buf += chunk; const i = buf.indexOf('\n'); if (i < 0) return;
      clearTimeout(timer); sock.end();
      let m; try { m = JSON.parse(buf.slice(0, i)); } catch { return reject(new Error('respuesta no válida')); }
      return m.ok ? resolve(m.result) : reject(new Error(m.error));
    });
  });
}
