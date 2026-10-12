// 3.2, God mode: open the project in Cursor or VS Code (when installed; the File Explorer is always there), and run one
// of the project's actions in a terminal window of its own (the user sees its output and can stop it).
// Programs are started directly, never through cmd.exe, so & ^ % in a folder name are never re-read.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findTerminals } from './terminal.mjs';
import { translate } from '../core/i18n.mjs';

const exists = (file) => Boolean(file) && fs.existsSync(file);
function inPath(names, env) {
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) { const file = path.join(dir, name); if (exists(file)) return file; }
  }
  return null;
}

// Where each editor lives on this machine (null when it is not installed).
export function findEditors(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? ''; const programs = env.ProgramFiles ?? 'C:\\Program Files'; const programs86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return {
      cursor: [path.join(local, 'Programs', 'cursor', 'Cursor.exe'), path.join(programs, 'Cursor', 'Cursor.exe')].find(exists) ?? null,
      vscode: [path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(programs, 'Microsoft VS Code', 'Code.exe'), path.join(programs86, 'Microsoft VS Code', 'Code.exe')].find(exists) ?? null
    };
  }
  if (platform === 'darwin') return { cursor: exists('/Applications/Cursor.app') ? '/Applications/Cursor.app' : null, vscode: exists('/Applications/Visual Studio Code.app') ? '/Applications/Visual Studio Code.app' : null };
  return { cursor: inPath(['cursor'], env), vscode: inPath(['code'], env) };
}

const start = (cmd, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(); });
});
const folderOf = (dir, language) => {
  let st; try { st = fs.statSync(dir); } catch { throw new Error(translate(language, 'sys.main.folderMissing')); }
  if (!st.isDirectory()) throw new Error(translate(language, 'sys.terminal.folderOnly'));
  return dir;
};

export async function openInEditor(which, dir, { language = 'es' } = {}) {
  folderOf(dir, language);
  const exe = findEditors()[which];
  if (!exe) throw new Error(translate(language, 'sys.terminal.notInstalled', { name: which === 'vscode' ? 'VS Code' : 'Cursor' }));
  if (process.platform === 'darwin') return start('open', ['-a', exe, dir], dir);
  return start(exe, [dir], dir);
}

// The program to start for an action's command, in a terminal window that stays open with its output. Pure, so it is
// tested. Windows: Windows Terminal (its «;» escaped) or PowerShell; CMD when chosen in Ajustes.
export function actionPlan(command, dir, found, choice = 'auto', platform = process.platform, language = 'es') {
  if (platform === 'win32') {
    if (choice === 'cmd') return { cmd: found.cmd, args: ['/k', command], cwd: dir };
    if (found.wt && choice !== 'powershell') return { cmd: found.wt, args: ['-d', dir.replace(/;/g, '\\;'), found.powershell, '-NoExit', '-NoLogo', '-Command', command.replace(/;/g, '\\;')], cwd: dir };
    return { cmd: found.powershell, args: ['-NoExit', '-NoLogo', '-Command', command], cwd: dir };
  }
  if (platform === 'linux' && found.linux) return { cmd: found.linux, args: ['-e', 'bash', '-lc', `${command}; exec bash`], cwd: dir };
  throw new Error(translate(language, 'sys.terminal.none'));
}

export async function runAction(command, dir, { choice = 'auto', language = 'es' } = {}) {
  folderOf(dir, language);
  const plan = actionPlan(String(command), dir, findTerminals(), choice, process.platform, language);
  await start(plan.cmd, plan.args, plan.cwd);
  return true;
}
