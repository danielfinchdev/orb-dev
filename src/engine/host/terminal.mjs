// Opens a terminal in a folder (Ctrl+J or the button in Ajustes): Warp when it is installed, otherwise Windows Terminal,
// PowerShell or CMD (on Linux / macOS, the usual terminals). The user can force one in Ajustes → Interfaz.
// Programs are started directly, never through cmd.exe, so & ^ % in a folder name are never re-read.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { translate } from '../../shared/i18n.mjs';

export const TERMINALS = { auto: 'Automática', warp: 'Warp', wt: 'Windows Terminal', powershell: 'PowerShell', cmd: 'Símbolo del sistema (CMD)' };
// 3.7 (Linux): the usual terminals, in the order «Automática» tries them (x-terminal-emulator is the one the system chose
// on Debian / Ubuntu). Each one is told the folder its own way; those without a way (xterm) start in it (cwd).
// open: the arguments to open it in dir; run: to run a command there (bash -lc …, the window stays open afterwards).
export const LINUX_TERMINALS = {
  'x-terminal-emulator': { open: () => [], run: (dir, sh) => ['-e', ...sh] },
  'gnome-terminal': { open: (dir) => [`--working-directory=${dir}`], run: (dir, sh) => [`--working-directory=${dir}`, '--', ...sh] },
  konsole: { open: (dir) => ['--workdir', dir], run: (dir, sh) => ['--workdir', dir, '-e', ...sh] },
  'xfce4-terminal': { open: (dir) => [`--working-directory=${dir}`], run: (dir, sh) => [`--working-directory=${dir}`, '-x', ...sh] },
  kitty: { open: (dir) => ['--directory', dir], run: (dir, sh) => ['--directory', dir, ...sh] },
  alacritty: { open: (dir) => ['--working-directory', dir], run: (dir, sh) => ['--working-directory', dir, '-e', ...sh] },
  xterm: { open: () => [], run: (dir, sh) => ['-e', ...sh] }
};
// The terminals a user can force in Ajustes → Interfaz on each system (the window shows the same list).
export const terminalChoices = (platform = process.platform) => (platform === 'win32' ? Object.keys(TERMINALS) : ['auto', 'warp', ...(platform === 'linux' ? Object.keys(LINUX_TERMINALS) : [])]);
// The Linux terminal for a choice: the one chosen when it is installed, otherwise the first one found. Pure (tested).
export function linuxTerminal(choice, found) {
  if (LINUX_TERMINALS[choice] && found.installed?.includes(choice)) return choice;
  return found.linux ?? null;
}
// Programs started from an AppImage must not think they are the AppImage (its updater reads APPIMAGE).
export function externalEnv(env = process.env) {
  if (!env.APPIMAGE) return env;
  const rest = { ...env };
  for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD']) delete rest[k];
  return rest;
}

const exists = (file) => Boolean(file) && fs.existsSync(file);
function inPath(name, env) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  // Only absolute folders of the PATH: a relative one («.», empty) would find a program planted in the current folder.
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => path.isAbsolute(d))) {
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
    // Always an absolute path: a bare name would also be looked for in the folder the program starts in. Windows' own
    // PowerShell and cmd from System32 first (a folder of the user's PATH is writable by any program, and ComSpec is the
    // user's to change); the PATH only when that PowerShell is not there.
    const system = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32');
    const ps = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return { warp, wt, powershell: exists(ps) ? ps : inPath('powershell', env) ?? ps, cmd: path.join(system, 'cmd.exe') };
  }
  if (platform === 'darwin') return { warp: exists('/Applications/Warp.app') ? '/Applications/Warp.app' : null, terminal: 'Terminal' };
  const installed = Object.keys(LINUX_TERMINALS).filter((n) => inPath(n, env));
  return { warp: inPath('warp-terminal', env) ?? inPath('warp', env), linux: installed[0] ?? null, installed };
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
  if (LINUX_TERMINALS[choice] && found.installed && !found.installed.includes(choice)) throw missing(choice);
  const name = linuxTerminal(choice, found);
  if (!name) throw new Error(translate(language, 'sys.terminal.none'));
  return { name, cmd: name, args: LINUX_TERMINALS[name]?.open(dir) ?? [], cwd: dir };
}

// A program started on its own, detached: a console program gets its own window on Windows and outlives the app. The
// engine asks the app for a terminal, an editor or an action by kind (host.openTerminal…, src/engine/host/host.mjs) and the
// app picks and starts the program: Tauri's Rust (src-tauri/src/tools.rs).
export const spawnDetached = ({ cmd, args = [], cwd }) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, env: externalEnv() });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(true); });
});

// spawn: how the terminal starts (spawnDetached, or the app's); openExternal: Warp's link.
export async function openTerminal(dir, choice = 'auto', { openExternal, spawn: start = spawnDetached, language = 'es' } = {}) {
  const T = (key, vars) => translate(language, key, vars);
  let st; try { st = fs.statSync(dir); } catch { throw new Error(T('sys.main.folderMissing')); }
  if (!st.isDirectory()) throw new Error(T('sys.terminal.folderOnly'));
  const plan = terminalPlan(terminalChoices().includes(choice) ? choice : 'auto', dir, findTerminals(), process.platform, language);
  if (plan.url) {
    try { await openExternal(plan.url); return plan.name; } catch (error) { if (!plan.fallback) throw error; Object.assign(plan, plan.fallback); }
  }
  try { await start({ cmd: plan.cmd, args: plan.args, cwd: plan.cwd }); } catch (error) { throw new Error(T('sys.terminal.openFailed', { name: plan.name, error: error.message })); }
  return plan.name;
}
