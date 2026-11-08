// Calls from the engine to the app that runs it, the other way round of the window's calls: what only the app can do.
// Open a link or a folder with the system; open a terminal, an editor or a project's action, programs that must outlive
// Orb (under Tauri the engine runs inside a Job Object that ends with Orb, and only the app can start something outside
// it); and seal or open the approval secret with Windows (host.seal / host.unseal). Later steps add the agents' browser
// windows (host.browser.*).
// The app picks the program itself (its own list of terminals and editors, absolute paths only): the engine only says
// which kind, the folder and, for an action, its command. Never a program name, never a shell line.
// The same transport as the rest of the engine's messages (engine.mjs):
//   engine → app  { type: 'host', id, method, params }
//   app → engine  { type: 'hostReply', id, ok, result | error }
// The app checks every request again (checkHostRequest): the engine is trusted, but a link or a path in it may come from
// a project's settings or an agent's text.
import path from 'node:path';

export const HOST_METHODS = Object.freeze(['host.openUrl', 'host.openPath', 'host.openTerminal', 'host.openEditor', 'host.runAction', 'host.seal', 'host.unseal']);
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
export const TERMINAL_CHOICES = Object.freeze(['auto', 'warp', 'wt', 'powershell', 'cmd']);
// A folder of this PC: absolute, and not a network or device path (\\server\share, \\?\..., \\.\...): only looking at
// one of those already sends this user's Windows credentials to that server.
export const localPath = (p) => typeof p === 'string' && p.length > 0 && p.length < 2000 && !p.includes('\0') && path.isAbsolute(p) && !/^[\\/]{2}/.test(p) && (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(p));
// What the app accepts, the same rules in every app (Electron's main.mjs; Tauri's Rust repeats them in protocol.rs): a
// web page over https, a page of this PC (a project's preview), or Warp's own link to open a tab in a folder. Folders
// only, never a file to run. A terminal, an editor or an action by kind, in an existing folder of this PC; the app picks
// the program. The secret: 64 hex characters to seal, a sealed blob (base64, at most 16 KB) to open. Returns the request
// cleaned, or throws.
export function checkHostRequest(method, params, { isDir } = {}) {
  const p = params ?? {};
  const folder = (dir, error = 'solo carpetas') => { const d = String(dir ?? ''); if (!localPath(d) || (isDir && !isDir(d))) throw new Error(error); return d; };
  if (method === 'host.openUrl') {
    let u; try { u = new URL(String(p.url ?? '')); } catch { throw new Error('enlace no válido'); }
    const local = /^https?:$/.test(u.protocol) && LOOPBACK.has(u.hostname);
    const warp = u.protocol === 'warp:' && u.host === 'action' && u.pathname === '/new_tab';
    if (u.protocol !== 'https:' && !local && !warp) throw new Error('solo enlaces https');
    return { url: u.toString() };
  }
  if (method === 'host.openPath') return { path: folder(p.path) };
  if (method === 'host.openTerminal') return { dir: folder(p.dir, 'carpeta no válida'), choice: TERMINAL_CHOICES.includes(p.choice) ? p.choice : 'auto' };
  if (method === 'host.openEditor') {
    if (!['cursor', 'vscode'].includes(p.which)) throw new Error('editor no válido');
    return { which: p.which, dir: folder(p.dir, 'carpeta no válida') };
  }
  if (method === 'host.runAction') {
    const command = String(p.command ?? '');
    if (!command.trim() || command.length > 2000 || command.includes('\0')) throw new Error('acción no válida');
    return { command, dir: folder(p.dir, 'carpeta no válida'), choice: TERMINAL_CHOICES.includes(p.choice) ? p.choice : 'auto' };
  }
  if (method === 'host.seal') {
    const text = String(p.text ?? '');
    if (!/^[0-9a-f]{64}$/.test(text)) throw new Error('secreto no válido');
    return { text };
  }
  if (method === 'host.unseal') {
    const data = String(p.data ?? '');
    if (!data || data.length > 22_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('datos no válidos');
    return { data };
  }
  throw new Error(`host: ${method} desconocido`);
}
