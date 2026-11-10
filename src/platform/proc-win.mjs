// 3.8: how the connector launcher (launch.mjs) starts a connector on Windows with its arguments intact. A connector is
// usually an npm shim (npx.cmd, a global package's foo.cmd) or an .exe (uvx). A .cmd only runs through cmd.exe, which
// rewrites its arguments (%VAR% expands even inside quotes, a trailing \ eats the closing quote, & | ( ) split the line),
// so a shim is not run at all: its real script runs with its node, as the shim itself would. Only an unknown batch file
// goes through cmd.exe, with every argument escaped for both cmd's parses and the program's own (as cross-spawn does).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// A program by its name in the PATH (with PATHEXT), or an absolute path to it. Never the current folder (the agent's
// project): CreateProcess looks there first for a bare name, so a missing program is an error, not a bare name.
export function resolveWin(command, env = process.env) {
  const c = String(command ?? '');
  if (path.win32.isAbsolute(c)) {
    if (isFile(c)) return c;
    if (!path.extname(c)) for (const ext of pathExts(env)) if (isFile(c + ext)) return c + ext;
    return null;
  }
  if (!c || /[\\/]/.test(c)) return null; // a relative path would be the project's
  const exts = path.extname(c) ? [''] : pathExts(env);
  for (const dir of String(env.PATH ?? env.Path ?? '').split(';').map((d) => d.trim().replace(/^"|"$/g, ''))) {
    if (!path.win32.isAbsolute(dir)) continue; // "." or an empty entry: the current folder
    for (const ext of exts) { const file = path.join(dir, c + ext); if (isFile(file)) return file; }
  }
  return null;
}
const pathExts = (env) => String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);

// The script an npm shim runs: npx.cmd / npm.cmd of a Node.js install (npx-cli.js, or the newer npm of the global prefix,
// as the shim checks), or a cmd-shim of a global package ("%dp0%\node_modules\…\cli.js" %*). null: not a shim.
export function shimScript(file, env = process.env) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const dir = path.dirname(file);
  const npm = text.match(/SET\s+"(?:NPX|NPM)_CLI_JS=%~dp0\\([^"%]+)"/i);
  if (npm && /"%NODE_EXE%"\s+"%(?:NPX|NPM)_CLI_JS%"\s+%\*/i.test(text)) {
    const own = path.join(dir, npm[1]);
    const prefixJs = text.match(/SET\s+"NPM_PREFIX_JS=%~dp0\\([^"%]+)"/i);
    if (prefixJs) {
      try {
        const prefix = execFileSync(nodeFor(dir, env) ?? 'node', [path.join(dir, prefixJs[1])], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
        const newer = path.join(prefix, 'node_modules', 'npm', 'bin', path.basename(own));
        if (prefix && isFile(newer)) return newer;
      } catch { /* the shim's own npm */ }
    }
    return isFile(own) ? own : null;
  }
  const shim = text.match(/"%~?dp0%?\\([^"%]+\.[cm]?js)"\s+%\*/i);
  if (shim) { const script = path.resolve(dir, shim[1]); return isFile(script) ? script : null; }
  return null;
}
// The node a shim runs with: the one next to it, or the one in the PATH.
const nodeFor = (dir, env) => (isFile(path.join(dir, 'node.exe')) ? path.join(dir, 'node.exe') : resolveWin('node', env));

// cmd.exe's special characters, escaped with ^ (also the quotes, so cmd never toggles its quoted state).
const META = /([()\][%!^"`<>&|;, *?])/g;
// One argument for the program's own parsing (MSVCRT: backslashes before a quote or the end are doubled, a quote is \"),
// then for cmd.exe twice: once for the /c line, once more for the batch file's own line where %* is put back.
export function cmdArg(arg) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${a}"`.replace(META, '^$1').replace(META, '^$1');
}
export const cmdLine = (file, args) => `"${[String(file).replace(META, '^$1'), ...args.map(cmdArg)].join(' ')}"`;

// → { command, args, verbatim } for spawn(), or throws «no se encuentra <orden>».
export function winPlan(command, args = [], env = process.env) {
  const file = resolveWin(command, env);
  if (!file) throw new Error(`No se encuentra «${command}» en el PATH`);
  if (!/\.(cmd|bat)$/i.test(file)) return { command: file, args, verbatim: false };
  const script = shimScript(file, env);
  const node = script && nodeFor(path.dirname(file), env);
  if (node) return { command: node, args: [script, ...args], verbatim: false };
  return { command: env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', cmdLine(file, args)], verbatim: true };
}
