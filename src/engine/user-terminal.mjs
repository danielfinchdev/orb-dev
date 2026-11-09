// 3.8.2 (T3 3.2): the user's own terminal inside Orb, docked under a chat, in that chat's folder. It is the user's, not an
// agent's: it never goes through the guard, so it is this PC's window only (permissions.mjs: terminal.* 'pc'; its
// 'terminal:data' events are never sent to a phone) and it never starts in core or a protected folder.
// Ctrl+J (terminal.mjs: Warp, Windows Terminal, PowerShell in a window of their own) stays as it was; this one adds a
// shell without a window of its own: Windows PowerShell (System32's) or the user's shell, with pipes instead of a
// console (no new native module): what is typed is sent a line at a time and the output comes back as text.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ctx, tr } from '../core/context.mjs';
import { isOrbData, protectedHit } from '../core/guard.mjs';
import { killTree } from '../agents/common.mjs';

export const MAX_TERMINALS = 4;
export const MAX_LINE = 4000;
const KEEP = 200 * 1024; // the output kept for a window that comes back

// The folder a terminal may start in. → its real path, or throws (a message for the user).
export function terminalDir(dir, { core = ctx.paths?.core, internal = ctx.paths?.internal, protectedList } = {}) {
  const userError = (key) => Object.assign(new Error(tr(key)), { userFacing: true });
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw userError('msg.terminal.badFolder');
  let real; try { real = fs.realpathSync.native(dir); } catch { throw userError('msg.terminal.badFolder'); }
  if (!fs.statSync(real).isDirectory()) throw userError('msg.terminal.badFolder');
  const low = real.toLowerCase(); const inside = (root) => { if (!root) return false; let r; try { r = fs.realpathSync.native(root).toLowerCase(); } catch { r = path.resolve(root).toLowerCase(); } return low === r || low.startsWith(r + path.sep); };
  if (inside(core) || isOrbData(real, internal, null) || protectedHit(real, protectedList) !== null) throw userError('msg.terminal.protectedFolder');
  return real;
}

// The shell: Windows' own PowerShell (never one planted in the PATH or the folder) reading its commands from stdin, or
// the user's shell elsewhere. The engine's own variables (its pipes, tickets, the vault's channel) never reach it.
export function shellPlan(platform = process.platform, env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^ORB_/i.test(k)));
  if (platform === 'win32') {
    const ps = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // PowerShell reads its stdin in the console's old code page whatever it is told later: a line with other characters
    // (ñ, é, emoji) goes as UTF-8 in base64 and runs in the same scope (its variables and folder stay).
    const line = (text) => (/^[\x20-\x7e\t]*$/.test(text) ? text : `Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}')))`);
    return { cmd: ps, args: ['-NoLogo', '-NoExit', '-Command', '-'], env: clean, init: '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding', line };
  }
  return { cmd: env.SHELL && path.isAbsolute(env.SHELL) ? env.SHELL : '/bin/sh', args: [], env: clean, init: '', line: (text) => text };
}

// emit(event, payload): to this PC's window only (engine.mjs › toWindow). plan(): the shell (the tests pass node).
// 3.8.2 (security review, decision b): while Orb's lock screen is up (setLocked), what runs keeps running (a dev server
// is not killed) but nothing can be typed, opened or closed, and its output is neither sent nor listed: it is kept and
// shows again after the password.
export function createTerminals({ emit = () => {}, log = () => {}, plan = () => shellPlan() } = {}) {
  let seq = 0; let locked = false;
  const open = new Map(); // id -> { id, cwd, child, out }
  const view = (t) => ({ id: t.id, cwd: t.cwd, running: t.child.exitCode === null && !t.child.killed, out: locked ? '' : t.out });
  const userError = (key) => Object.assign(new Error(tr(key)), { userFacing: true });
  const unlocked = () => { if (locked) throw userError('msg.terminal.locked'); };
  const must = (id) => { unlocked(); const t = open.get(Number(id)); if (!t) throw userError('msg.terminal.gone'); return t; };
  return {
    setLocked(value) { locked = Boolean(value); },
    get locked() { return locked; },
    open({ dir }) {
      unlocked();
      const cwd = terminalDir(dir);
      if (open.size >= MAX_TERMINALS) throw userError('msg.terminal.tooMany');
      const p = plan();
      const child = spawn(p.cmd, p.args, { cwd, env: p.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const t = { id: ++seq, cwd, child, out: '', encode: p.line ?? ((x) => x) };
      const data = (chunk) => { const text = String(chunk); t.out = (t.out + text).slice(-KEEP); if (!locked) emit('terminal:data', { id: t.id, data: text }); };
      child.stdout.setEncoding('utf8').on('data', data);
      child.stderr.setEncoding('utf8').on('data', data);
      child.stdin.on('error', () => {});
      child.on('error', (error) => data(`${error.message}\n`));
      child.on('close', (code) => { emit('terminal:exit', { id: t.id, code }); });
      if (p.init) child.stdin.write(`${p.init}\n`);
      open.set(t.id, t);
      log(`terminal: abierto en ${cwd}`);
      return view(t);
    },
    // One line, as typed (never run by Orb on its own: the user pressed Enter).
    write({ id, text }) {
      const t = must(id);
      const line = String(text ?? '');
      if (line.length > MAX_LINE || /[\r\n]/.test(line)) throw userError('msg.terminal.badLine');
      if (t.child.exitCode !== null) throw userError('msg.terminal.ended');
      t.child.stdin.write(`${t.encode(line)}\n`);
      return true;
    },
    // Stops what runs in it (the shell and everything it started) and closes it.
    close({ id }) { const t = must(id); open.delete(t.id); killTree(t.child); log(`terminal: cerrado ${t.cwd}`); return true; },
    list: () => [...open.values()].map(view),
    closeAll() { for (const t of open.values()) killTree(t.child); open.clear(); }
  };
}
