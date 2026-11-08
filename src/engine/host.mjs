// Calls from the engine to the app that runs it, the other way round of the window's calls: what only the app can do.
// Open a link or a folder with the system, and start a program that must outlive Orb (a terminal, an editor): under
// Tauri the engine runs inside a Job Object that ends with Orb, and only the app can start something outside it. Later
// steps add the secret's sealing (host.seal / host.unseal) and the agents' browser windows (host.browser.*).
// The same transport as the rest of the engine's messages (engine.mjs):
//   engine → app  { type: 'host', id, method, params }
//   app → engine  { type: 'hostReply', id, ok, result | error }
// The app checks every request again (checkHostRequest): the engine is trusted, but a link or a path in it may come from
// a project's settings or an agent's text.
import path from 'node:path';

export const HOST_METHODS = Object.freeze(['host.openUrl', 'host.openPath', 'host.spawnDetached']);

let send = null; let next = 0; const pending = new Map();

// The transport's send: set once the engine's transport exists.
export function attachHost(fn) { send = fn; }

export function hostCall(method, params = {}, timeoutMs = 30_000) {
  if (!HOST_METHODS.includes(method)) return Promise.reject(new Error(`host: ${method} desconocido`));
  if (!send) return Promise.reject(new Error('host: sin app'));
  const id = ++next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`host: ${method} sin respuesta`)); }, timeoutMs);
    timer.unref?.();
    pending.set(id, { resolve, reject, timer });
    try { send({ type: 'host', id, method, params }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

// An answer of the app: resolves the call it belongs to (an unknown id is ignored).
export function hostReply(msg) {
  const p = pending.get(msg?.id); if (!p) return false;
  pending.delete(msg.id); clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.result ?? null); else p.reject(new Error(String(msg.error ?? 'host: error')));
  return true;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
// What the app accepts, the same rules in every app (Electron's main.mjs; Tauri's Rust repeats them): a web page over
// https, a page of this PC (a project's preview), or Warp's own link to open a tab in a folder. Folders only, never a
// file to run. A program to start: an absolute path or a bare name, its arguments as a list (never a shell line) and an
// existing folder to start in. Returns the request cleaned, or throws.
export function checkHostRequest(method, params, { isDir } = {}) {
  const p = params ?? {};
  if (method === 'host.openUrl') {
    let u; try { u = new URL(String(p.url ?? '')); } catch { throw new Error('enlace no válido'); }
    const local = /^https?:$/.test(u.protocol) && LOOPBACK.has(u.hostname);
    const warp = u.protocol === 'warp:' && u.host === 'action' && u.pathname === '/new_tab';
    if (u.protocol !== 'https:' && !local && !warp) throw new Error('solo enlaces https');
    return { url: u.toString() };
  }
  if (method === 'host.openPath') {
    const target = String(p.path ?? '');
    if (!path.isAbsolute(target) || (isDir && !isDir(target))) throw new Error('solo carpetas');
    return { path: target };
  }
  if (method === 'host.spawnDetached') {
    const cmd = String(p.cmd ?? ''); const args = p.args ?? []; const cwd = String(p.cwd ?? '');
    if (!cmd || cmd.length > 1000 || /[\r\n\0]/.test(cmd) || !(path.isAbsolute(cmd) || !/[\\/]/.test(cmd))) throw new Error('programa no válido');
    if (!Array.isArray(args) || args.length > 50 || args.some((a) => typeof a !== 'string' || a.length > 4000 || a.includes('\0'))) throw new Error('argumentos no válidos');
    if (!path.isAbsolute(cwd) || (isDir && !isDir(cwd))) throw new Error('carpeta no válida');
    return { cmd, args, cwd };
  }
  throw new Error(`host: ${method} desconocido`);
}
