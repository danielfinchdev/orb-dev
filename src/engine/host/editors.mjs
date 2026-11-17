// open the project in Cursor or VS Code (when installed; the File Explorer is always there), and run one
// of the project's actions in a terminal window of its own (the user sees its output and can stop it).
// Programs are started directly, never through cmd.exe, so & ^ % in a folder name are never re-read.
import fs from 'node:fs';
import path from 'node:path';
import { findTerminals, linuxTerminal, spawnDetached, LINUX_TERMINALS } from './terminal.mjs';
import { translate } from '../../shared/i18n.mjs';

const exists = (file) => Boolean(file) && fs.existsSync(file);
function inPath(names, env) {
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => path.isAbsolute(d))) {
    for (const name of names) { const file = path.join(dir, name); if (exists(file)) return file; }
  }
  return null;
}

// The editors Orb can open a project in (the File Explorer is always there): id → the name shown to the user.
const EDITORS = Object.freeze({ cursor: 'Cursor', vscode: 'VS Code', windsurf: 'Windsurf', zed: 'Zed', jetbrains: 'JetBrains' });
export const EDITOR_IDS = Object.freeze(Object.keys(EDITORS));

// JetBrains ships one program per IDE: the first installed one in this order opens the folder.
const JETBRAINS_BIN = ['idea', 'webstorm', 'pycharm', 'phpstorm', 'goland', 'rustrover', 'clion', 'rider', 'rubymine', 'datagrip'];
const JETBRAINS_APPS = ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app', 'WebStorm.app', 'PyCharm.app', 'PyCharm CE.app', 'PhpStorm.app', 'GoLand.app', 'RustRover.app', 'CLion.app', 'Rider.app'];
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
// Windows: <root>\<IDE version>\bin\<ide>64.exe (the newest folder first).
function jetbrainsWindows(roots) {
  for (const root of roots) {
    for (const dir of subdirs(root).sort().reverse()) {
      for (const name of JETBRAINS_BIN) { const file = path.join(root, dir, 'bin', name + '64.exe'); if (exists(file)) return file; }
    }
  }
  return null;
}

// Where each editor lives on this machine (null when it is not installed).
export function findEditors(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? ''; const programs = env.ProgramFiles ?? 'C:\\Program Files'; const programs86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return {
      cursor: [path.join(local, 'Programs', 'cursor', 'Cursor.exe'), path.join(programs, 'Cursor', 'Cursor.exe')].find(exists) ?? null,
      vscode: [path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(programs, 'Microsoft VS Code', 'Code.exe'), path.join(programs86, 'Microsoft VS Code', 'Code.exe')].find(exists) ?? null,
      windsurf: [path.join(local, 'Programs', 'Windsurf', 'Windsurf.exe'), path.join(programs, 'Windsurf', 'Windsurf.exe')].find(exists) ?? null,
      zed: [path.join(local, 'Programs', 'Zed', 'Zed.exe'), path.join(local, 'Zed', 'Zed.exe'), path.join(programs, 'Zed', 'Zed.exe')].find(exists) ?? null,
      jetbrains: jetbrainsWindows([path.join(programs, 'JetBrains'), path.join(local, 'Programs')])
    };
  }
  if (platform === 'darwin') {
    const app = (name) => { const file = '/Applications/' + name + '.app'; return exists(file) ? file : null; };
    return { cursor: app('Cursor'), vscode: app('Visual Studio Code'), windsurf: app('Windsurf'), zed: app('Zed'), jetbrains: JETBRAINS_APPS.map((n) => '/Applications/' + n).find(exists) ?? null };
  }
  // Linux: the PATH, and the usual places that an app started from the desktop menu may not have in it (snap, ~/.local).
  const extra = { ...env, PATH: [env.PATH ?? '', '/usr/bin', '/usr/local/bin', '/snap/bin', '/var/lib/flatpak/exports/bin', env.HOME ? path.join(env.HOME, '.local', 'bin') : ''].filter(Boolean).join(path.delimiter) };
  return { cursor: inPath(['cursor'], extra), vscode: inPath(['code', 'com.visualstudio.code'], extra), windsurf: inPath(['windsurf'], extra), zed: inPath(['zed', 'zeditor'], extra), jetbrains: inPath(JETBRAINS_BIN, extra) };
}

const folderOf = (dir, language) => {
  let st; try { st = fs.statSync(dir); } catch { throw new Error(translate(language, 'sys.main.folderMissing')); }
  if (!st.isDirectory()) throw new Error(translate(language, 'sys.terminal.folderOnly'));
  return dir;
};

// spawn: how a detached program starts (terminal.mjs › spawnDetached).
async function openInEditor(which, dir, { language = 'es', spawn = spawnDetached } = {}) {
  folderOf(dir, language);
  if (!EDITOR_IDS.includes(which)) throw new Error(translate(language, 'sys.main.badPath'));
  const exe = findEditors()[which];
  if (!exe) throw new Error(translate(language, 'sys.terminal.notInstalled', { name: EDITORS[which] ?? which }));
  if (process.platform === 'darwin') return spawn({ cmd: 'open', args: ['-a', exe, dir], cwd: dir });
  return spawn({ cmd: exe, args: [dir], cwd: dir });
}

// The program to start for an action's command, in a terminal window that stays open with its output. Pure, so it is
// tested. Windows: Windows Terminal (its «;» escaped) or PowerShell; CMD when chosen in Ajustes.
export function actionPlan(command, dir, found, choice = 'auto', platform = process.platform, language = 'es') {
  if (platform === 'win32') {
    if (choice === 'cmd') return { cmd: found.cmd, args: ['/k', command], cwd: dir };
    if (found.wt && choice !== 'powershell') return { cmd: found.wt, args: ['-d', dir.replace(/;/g, '\\;'), found.powershell, '-NoExit', '-NoLogo', '-Command', command.replace(/;/g, '\\;')], cwd: dir };
    return { cmd: found.powershell, args: ['-NoExit', '-NoLogo', '-Command', command], cwd: dir };
  }
  // Linux: the chosen terminal (Ajustes → Interfaz) or the first one found, told the folder its own way (terminal.mjs).
  const linux = platform === 'linux' ? linuxTerminal(choice, found) : null;
  if (linux) return { cmd: linux, args: (LINUX_TERMINALS[linux]?.run ?? LINUX_TERMINALS.xterm.run)(dir, ['bash', '-lc', `${command}; exec bash`]), cwd: dir };
  throw new Error(translate(language, 'sys.terminal.none'));
}

export async function runAction(command, dir, { choice = 'auto', language = 'es', spawn = spawnDetached } = {}) {
  folderOf(dir, language);
  const plan = actionPlan(String(command), dir, findTerminals(), choice, process.platform, language);
  await spawn({ cmd: plan.cmd, args: plan.args, cwd: plan.cwd });
  return true;
}
