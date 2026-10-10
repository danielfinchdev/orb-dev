// Opens a terminal in a folder (Ctrl+J or the button in Ajustes): Warp when it is installed, otherwise Windows Terminal,
// PowerShell or CMD (on Linux / macOS, the usual terminals). The user can force one in Ajustes → Interfaz.
// Programs are started directly, never through cmd.exe, so & ^ % in a folder name are never re-read.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { translate } from '../core/i18n.mjs';

export const TERMINALS = { auto: 'Automática', warp: 'Warp', wt: 'Windows Terminal', powershell: 'PowerShell', cmd: 'Símbolo del sistema (CMD)' };

const exists = (file) => Boolean(file) && fs.existsSync(file);
function inPath(name, env) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) { const file = path.join(dir, name + ext); if (exists(file)) return file; }
  }
  return null;
}

// Where each terminal lives on this machine (null when it is not installed).
export function findTerminals(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? ''; const programs = env.ProgramFiles ?? 'C:\\Program Files';
    const warp = [path.join(local, 'Programs', 'Warp', 'warp.exe'), path.join(programs, 'Warp', 'warp.exe')].find(exists) ?? inPath('warp', env);
    const wt = [path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe')].find(exists) ?? inPath('wt', env);
    return { warp, wt, powershell: inPath('powershell', env) ?? 'powershell.exe', cmd: env.ComSpec || 'cmd.exe' };
  }
  if (platform === 'darwin') return { warp: exists('/Applications/Warp.app') ? '/Applications/Warp.app' : null, terminal: 'Terminal' };
  return {
    warp: inPath('warp-terminal', env) ?? inPath('warp', env),
    linux: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'xterm'].map((n) => inPath(n, env) && n).find(Boolean) ?? null
  };
}

// The program to start for the chosen terminal: { url } (Warp's own link) or { cmd, args, cwd }. Pure, so it is tested.
export function terminalPlan(choice, dir, found, platform = process.platform, language = 'es') {
  const missing = (name) => new Error(translate(language, 'sys.terminal.notInstalled', { name }));
  const warpUrl = { url: `warp://action/new_tab?path=${encodeURIComponent(dir)}`, fallback: found.warp && platform !== 'darwin' ? { cmd: found.warp, args: [], cwd: dir } : null };
  if (platform === 'win32') {
    const pick = choice === 'auto' ? (found.warp ? 'warp' : found.wt ? 'wt' : 'powershell') : choice;
    if (pick === 'warp') { if (!found.warp) throw missing('Warp'); return { name: 'Warp', ...warpUrl }; }
    // wt reads «;» as a separator between its own commands: escaped, a folder such as «a;b» still works.
    if (pick === 'wt') { if (!found.wt) throw missing('Windows Terminal'); return { name: 'Windows Terminal', cmd: found.wt, args: ['-d', dir.replace(/;/g, '\\;')], cwd: dir }; }
    if (pick === 'cmd') return { name: 'CMD', cmd: found.cmd, args: [], cwd: dir };
    return { name: 'PowerShell', cmd: found.powershell, args: ['-NoExit', '-NoLogo'], cwd: dir };
  }
  if (platform === 'darwin') {
    if ((choice === 'warp' || choice === 'auto') && found.warp) return { name: 'Warp', ...warpUrl };
    if (choice === 'warp') throw missing('Warp');
    return { name: 'Terminal', cmd: 'open', args: ['-a', found.terminal, dir], cwd: dir };
  }
  if ((choice === 'warp' || choice === 'auto') && found.warp) return { name: 'Warp', cmd: found.warp, args: [], cwd: dir };
  if (choice === 'warp') throw missing('Warp');
  if (!found.linux) throw new Error(translate(language, 'sys.terminal.none'));
  return { name: found.linux, cmd: found.linux, args: [], cwd: dir };
}

// Starts it detached: a console program gets its own window on Windows and outlives the app.
export async function openTerminal(dir, choice = 'auto', { openExternal, language = 'es' } = {}) {
  const T = (key, vars) => translate(language, key, vars);
  let st; try { st = fs.statSync(dir); } catch { throw new Error(T('sys.main.folderMissing')); }
  if (!st.isDirectory()) throw new Error(T('sys.terminal.folderOnly'));
  const plan = terminalPlan(TERMINALS[choice] ? choice : 'auto', dir, findTerminals(), process.platform, language);
  if (plan.url) {
    try { await openExternal(plan.url); return plan.name; } catch (error) { if (!plan.fallback) throw error; Object.assign(plan, plan.fallback); }
  }
  await new Promise((resolve, reject) => {
    const child = spawn(plan.cmd, plan.args, { cwd: plan.cwd, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', (error) => reject(new Error(T('sys.terminal.openFailed', { name: plan.name, error: error.message }))));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return plan.name;
}
