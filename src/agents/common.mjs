// Shared pieces of the agent adapters: where the CLIs live, a clean environment, stopping process trees and the MCP config
// that connects every agent to the assistant's board.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const IS_WIN = process.platform === 'win32';

// First existing file of a list (null if none).
export const firstFile = (list) => list.find((f) => { try { return f && fs.statSync(f).isFile(); } catch { return false; } }) ?? null;

// Executables named `name` in PATH. On Windows only real .exe files are returned: .cmd/.bat shims would need a shell,
// and a shell would re-interpret the prompt and paths (Node refuses them without shell:true since CVE-2024-27980).
export function inPath(name, env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = IS_WIN ? [`${name}.exe`] : [name];
  const found = [];
  for (const dir of dirs) for (const n of names) { const f = path.join(dir, n); if (firstFile([f])) found.push(f); }
  return found;
}
// Folders in PATH that hold an npm shim (name.cmd): the real binary lives under <dir>/node_modules/<package>.
export const shimDirs = (name, env = process.env) => String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  .filter((dir) => firstFile([path.join(dir, `${name}.cmd`), path.join(dir, name)]));

export const userHome = () => process.env.USERPROFILE || os.homedir();

// Every AppData that can hold the agents: this user's, and copies moved to another drive to free space on C: (an
// <drive>:\AppData, <drive>:\<folder>\AppData or <drive>:\<folder>\<folder>\AppData with Roaming or Local inside, such as
// D:\ComputerApps\AppData), where PATH may still point to the old place. Found once a minute at most.
const SKIP_DIRS = /^(\$.*|\..*|windows|program files.*|programdata|users|system volume information|recovery|perflogs|node_modules|msocache|intel|amd|nvidia|wpsystem|windowsapps|xboxgames)$/i;
let appDataCache = null;
export function appDataDirs() {
  if (appDataCache && Date.now() - appDataCache.at < 60_000) return appDataCache.list;
  const home = userHome();
  const list = [{ roaming: process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), local: process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local') }];
  if (IS_WIN) {
    const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
    const subdirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.test(e.name)).map((e) => path.join(p, e.name)); } catch { return []; } };
    const roots = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter(isDir);
    const levels = roots.flatMap((root) => { const first = subdirs(root); return [root, ...first, ...first.flatMap(subdirs)]; });
    for (const dir of levels) {
      const appData = path.join(dir, 'AppData');
      if (!isDir(path.join(appData, 'Roaming')) && !isDir(path.join(appData, 'Local'))) continue;
      const entry = { roaming: path.join(appData, 'Roaming'), local: path.join(appData, 'Local') };
      if (!list.some((d) => d.roaming.toLowerCase() === entry.roaming.toLowerCase())) list.push(entry);
    }
  }
  appDataCache = { at: Date.now(), list };
  return list;
}
// npm's global folders (where `npm install -g` leaves the CLIs) in every AppData, plus those found through PATH.
export const npmPrefixes = (bin) => [...new Set([...appDataDirs().map((d) => path.join(d.roaming, 'npm')), ...shimDirs(bin)])];

// Environment of every agent process: only what Windows, git and the CLIs need. Secrets of the app's environment are not passed on.
const ENV_ALLOWED = /^(path|pathext|systemroot|systemdrive|windir|comspec|userprofile|homedrive|homepath|home|appdata|localappdata|programdata|temp|tmp|tmpdir|programfiles.*|programw6432|commonprogramfiles.*|commonprogramw6432|allusersprofile|public|username|userdomain|computername|os|processor_architecture|number_of_processors|psmodulepath|lang|language|lc_.*|tz|term|shell|user|logname|xdg_.*|http_proxy|https_proxy|no_proxy|node_extra_ca_certs|ssl_cert_file|claude_code_git_bash_path)$/i; // CODEX_HOME / CLAUDE_CONFIG_DIR are set per account, never inherited
export function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (ENV_ALLOWED.test(key)) env[key] = value;
  return { ...env, ...extra };
}

// Stops a process and its children. Never throws (a failed kill must not take the engine down).
export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (IS_WIN) { const k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); k.on('error', () => {}); }
    else child.kill('SIGTERM');
  } catch { /* already gone */ }
}

// How an agent process starts the assistant's MCP server: the same runtime as the engine (the app's own executable in
// "run as node" mode when packaged), the server script and the assistant folder. Nothing secret goes in here.
export function orbMcpServer(env = {}) {
  const script = process.env.ORB_MCP_SCRIPT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');
  return { command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', ...env } };
}

// Bounded text for the UI (tool inputs and outputs can be huge).
export const clip = (value, max = 4000) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} caracteres más)` : s;
};

// Tool inputs shown as one line: the most telling field first.
export function describeInput(input) {
  if (!input || typeof input !== 'object') return clip(input, 300);
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) if (input[key]) return clip(String(input[key]), 300);
  return clip(input, 300);
}
