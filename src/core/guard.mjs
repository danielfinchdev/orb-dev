// The guard of the live sessions (2.3): for every action an agent wants to take, allow it, ask the user or deny it.
// Before 2.3 the risky commands were simply forbidden (a deny list on the command line), which stopped useful work too.
// Now the balance is: normal work flows without questions, risky actions wait for a click (Permitir / Denegar) and only
// what can never be right (touching the assistant's own data) is denied.
//
// Permission modes of a conversation or task:
//   leer       look only: reading and searching; anything that changes something is denied
//   editar     (default) edit files and run commands in its folder; risky commands ask first
//   preguntar  edit files; every command asks first (for when you want to watch closely)
//   total      no questions (asked once when chosen; never from the phone). 3.8.2: in a chat without a project it is
//              «Acceso total al PC» (the master password, dropped when Orb locks: src/engine/grants.mjs). Whatever the
//              chat, «total» still goes through this guard: its boundary is the protected set (core but its open folders,
//              the folders kept outside it, the folder Orb is installed in, «Elementos protegidos» and raising privileges),
//              which is denied as in every other mode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { translate } from './i18n.mjs';
import { ctx } from './context.mjs';
import { DEFAULT_PROTECTED } from './home.mjs';

//   probar     (3.1, read-only tasks: reviews, verification) read and run commands (tests, the build, a dev server to
//              open in the browser), but change no file; risky commands ask first
export const PERMISSIONS = ['leer', 'probar', 'editar', 'preguntar', 'total'];
// What a tool does, whatever the agent calls it (Claude tool names, Codex items, ACP kinds).
const READ = /^(read|glob|grep|ls|search|find|view|notebookread|webfetch|websearch|fetch|think|todowrite|todoread|task|agent|exitplanmode|skill|toolsearch|listmcpresources|readmcpresource|bashoutput|monitor)$/i;
const EDIT = /^(edit|write|multiedit|notebookedit|filechange|applypatch|edit_file|write_file|replace|move|delete|create)$/i;
const EXEC = /^(bash|shell|execute|commandexecution|command|run_shell_command|powershell|killshell|killbash|terminal)$/i;

export function toolClass(tool, kind) {
  const k = String(kind ?? '').toLowerCase();
  if (k === 'read' || k === 'search' || k === 'think' || k === 'fetch') return 'read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'edit';
  if (k === 'execute') return 'exec';
  const name = String(tool ?? '').replace(/^mcp__[^_]+__/, '');
  if (/^mcp__orb__|^orb[:_]/.test(String(tool))) return 'orb';
  if (/^mcp__/.test(String(tool))) return 'mcp';
  if (READ.test(name)) return 'read';
  if (EDIT.test(name)) return 'edit';
  if (EXEC.test(name)) return 'exec';
  return 'other';
}

// Commands that may be fine but need a human look: publishing, downloading and running things from the internet, wiping
// files, touching the system. Matched on the whole command line (PowerShell and bash spellings).
// GIT: "git" plus its global options (-C dir, -c key=value, --no-pager…) before the subcommand.
const GIT = String.raw`\bgit(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+`;
const RISKY = [
  [new RegExp(`${GIT}(push|remote\\s+(add|set-url|remove))\\b`, 'i'), 'msg.guard.push'],
  [/\bgh\s+(repo|pr|release|api|gist|secret)\b/i, 'msg.guard.github'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i, 'msg.guard.publish'],
  [/\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*\|\s*(iex|invoke-expression|sh|bash|pwsh|powershell)\b/i, 'msg.guard.pipeToShell'],
  [/\b(iex|invoke-expression)\b[^|;&]*\b(irm|iwr|invoke-webrequest|invoke-restmethod)\b|[$<]\(\s*(curl|wget)\b/i, 'msg.guard.pipeToShell'],
  // -EncodedCommand and its short forms hide the command: PowerShell's own option followed by its base64 text. 3.1: not any
  // " -e" later in the line (powershell -Command "node -e '…'" was taken for it in a real run).
  // (-Command / -File end PowerShell's own options: what follows is the script, whatever it says.)
  // Options may start with - / or a dash (– —), and their values may be quoted with spaces.
  [/\b(powershell|pwsh)(\.exe)?["']?(\s+[-/–—](?!e\b|ec\b|en\w*\b|c\b|command\b|f\b|file\b)\w+(\s+(?![-/–—])("[^"]*"|'[^']*'|\S+))?)*\s+[-/–—]e(c|n\w*)?\s+["']?[A-Za-z0-9+/]{4,}={0,2}/i, 'msg.guard.pipeToShell'],
  // …and hidden in the arguments of a new PowerShell process (Start-Process powershell -ArgumentList "-enc …").
  [/\b(powershell|pwsh)(\.exe)?\b[^|;&]*-argumentlist\s+["'][^"']*[-/–—]e(c|n\w*)?\s+[A-Za-z0-9+/]{4,}/i, 'msg.guard.pipeToShell'],
  [/\b(curl|wget)\b[^|;&]*\s(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-F\s|--upload-file|-T\s)/i, 'msg.guard.sendData'],
  [/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;&]*-method\s+(post|put|delete|patch)/i, 'msg.guard.sendData'],
  [/\brm\s+(?:-{1,2}\S+\s+)*(-[a-z]*r|--recursive)|\b(remove-item|ri|rd|rmdir|del|erase)\b[^|;&]*\s-r(e(c(u(r(se?)?)?)?)?)?\b|\brd\s+\/s\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]/i, 'msg.guard.deleteFolders'],
  [/\b(schtasks|reg\s+(add|delete)|set-executionpolicy|shutdown|restart-computer|stop-computer|format\s+[a-z]:|diskpart|bcdedit|netsh|sc\s+(create|delete|config)|setx|sudo|runas|net\s+(user|localgroup)|new-service|set-service)\b/i, 'msg.guard.system'],
  [/\b(taskkill|stop-process|kill\s+(-9|-kill|-s\s+kill|-sigkill)|pkill|killall)\b/i, 'msg.guard.killProcesses'],
  [/\b(ssh|scp|sftp|rsync)\s/i, 'msg.guard.ssh'],
  [new RegExp(`${GIT}(reset\\s+--(hard|merge)\\b|clean\\s+(?:-\\S+\\s+)*(-[a-z]*f|--force)|checkout\\s+(--\\s|\\.(?=\\s|$))|restore\\b(?![^|;&]*--staged)|stash\\s+(drop|clear)\\b|branch\\s+-D\\b|rebase\\b|filter-branch\\b)`, 'i'), 'msg.guard.gitRewrite'],
  [/\b(docker|podman)\s+(rm|rmi|system\s+prune|volume\s+rm)\b/i, 'msg.guard.docker']
];

// 3.1: data sent only to this PC (an agent testing its own local API: curl -X POST localhost:3000…) never leaves it.
// An allow-list, not a block-list: the WHOLE command must be requests to this PC and nothing else. Every line or step is
// either echo / cd / a pause / a variable set to a local address, or curl / wget / Invoke-WebRequest / Invoke-RestMethod
// whose every address is local (localhost, 127.0.0.1, [::1], with or without http://, or a variable holding one), with no
// proxy or address-rewriting option. A pipe, a sub-command or anything else: not local, it asks as before.
const IS_LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/i;
const NET_TOOL = /^(curl|curl\.exe|wget|wget\.exe|iwr|irm|invoke-webrequest|invoke-restmethod)$/i;
// curl's one-letter options are case-sensitive (-x is a proxy, -X the method; -o takes a file, -O does not).
const REROUTE = (a) => /^-x$/.test(a) || /^(--(resolve|connect-to|proxy\S*|preproxy|socks\S*|doh-url|haproxy\S*)|-proxy\S*)(=|$)/i.test(a);
const URL_OPT = /^(-uri|--url)$/i;
const VALUE_OPT = (a) => /^-[HdFXwoTuAbemrzD]$/.test(a)
  || /^(--(header|data\S*|form\S*|request|write-out|output|upload-file|user|user-agent|referer|cookie\S*|max-time|connect-timeout|retry\S*)|-(method|body|contenttype|headers|outfile|infile|timeoutsec|erroraction|maximumredirection))$/i.test(a);
const words = (s) => (s.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2'));
const onlyLocal = (c) => {
  if (/[|`]|\$\(|<\(/.test(c.replace(/&&|\|\|/g, ';').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => q.replace(/\|/g, '')))) return false;
  const vars = new Map();
  const resolve = (w) => w.replace(/^\$\{?(\w+)\}?/, (m, name) => (vars.has(name.toLowerCase()) ? vars.get(name.toLowerCase()) : '\u0000'));
  const local = (w) => IS_LOCAL.test(resolve(w));
  let requests = 0;
  for (const step of c.split(/\r?\n|;|&&|\|\|/).map((s) => s.trim()).filter(Boolean)) {
    const set = step.match(/^\$?(\w+)\s*=\s*(.*)$/);
    if (set) { const v = words(set[2])[0] ?? ''; if (!local(v)) return false; vars.set(set[1].toLowerCase(), resolve(v)); continue; }
    const w = words(step); const cmd = (w[0] ?? '').toLowerCase();
    if (['echo', 'write-host', 'write-output', 'cd', 'set-location', 'sleep', 'start-sleep'].includes(cmd)) continue;
    if (!NET_TOOL.test(cmd)) return false;
    for (let i = 1; i < w.length; i++) {
      const a = w[i];
      if (REROUTE(a)) return false;
      if (URL_OPT.test(a)) { if (!local(w[++i] ?? '')) return false; requests++; continue; }
      if (VALUE_OPT(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      if (!local(a)) return false;
      requests++;
    }
  }
  return requests > 0;
};
export function riskOf(command, lang = 'es') {
  const c = String(command ?? '');
  for (const [re, why] of RISKY) {
    if (!re.test(c)) continue;
    if (why === 'msg.guard.sendData' && onlyLocal(c)) continue;
    return translate(lang, why);
  }
  return null;
}

// 3.8: Orb's data folder (core, src/core/home.mjs › paths().internal) is never an agent's business: what a tool
// names or a command mentions is resolved (against the agent's folder) and refused when it falls inside it. The isolated
// copies (core\copias\aisladas) are where isolated tasks work, and core\herramientas holds the tools agents run (adb by
// its full path), so those stay open. The same goes for what Orb keeps about the workspace outside it (setGuardedRoots:
// the backups' folders and the copies of its sealed secrets), with nothing open there. Matched by RESOLVED path, not by
// name: a project may well have its own orb.db or talk about ORB_HOME. The `cd`s of a compound command are followed
// (3.8.1, workDirs), but it is still not a boundary: a script or a program of the same Windows user can always reach the
// folder some other way (its own chdir, a path built at run time); the agents' identity no longer depends on its
// database (agent-auth.mjs), so what is left is the integrity of Orb's data against an agent bent on it (accepted).
// The logs moved into core (core\bitacora) are open to a READING tool (the user's rules for agents may point there);
// they are written only through Orb's own tools. 3.8.1: the skills (core\skills) too: agents read them (their SKILL.md
// and files); a command that runs one of their scripts asks first, and nobody writes there. What an agent makes for the
// user to turn on goes in core\preparacion, open like the isolated copies (src/core/extensions.mjs).
const OPEN_INTERNAL = [['copias', 'aisladas'], ['herramientas'], ['preparacion']];
const READ_INTERNAL = [['bitacora'], ['skills']];
const norm = (p) => path.resolve(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
// 3.8.1: where a path really is: links and junctions followed, also for a file not made yet (its nearest existing parent
// is resolved), so a junction made earlier (in a project or in core\preparacion) cannot send a write into core.
const realOf = (p) => {
  let at = path.resolve(p); const rest = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there: its parent */ }
    // A link whose target is not there (yet): where it points.
    try { if (fs.lstatSync(at).isSymbolicLink()) { at = path.resolve(path.dirname(at), fs.readlinkSync(at)); continue; } } catch { /* not a link */ }
    const up = path.dirname(at); if (up === at) break;
    rest.push(path.basename(at)); at = up;
  }
  return path.resolve(p);
};
// A folder as given and where it really is (links followed, and the long name of an 8.3 one such as C:\Users\RUNNER~1, which
// a TEMP or a user name longer than eight letters gives): what a path is compared with, since realOf gives the long one.
const rootsOf = (dir) => [...new Set([norm(dir), norm(realOf(dir))])];
const under = (rest) => (o) => o.every((part, i) => rest[i] === part);
// read: true (every folder a reading tool may see), false, or the names of the ones that count (['skills']).
const readable = (read) => (read === true ? READ_INTERNAL : Array.isArray(read) ? READ_INTERNAL.filter((o) => read.includes(o[0])) : []);
// 3.8.2 (review A2): Orb's own adb (core\herramientas\adb) runs in the engine: a reading tool may look, nobody may write
// there or run it (an agent's adb.exe or DLL left there would run with the engine's rights). The same for Orb's own
// ffmpeg (core\herramientas\ffmpeg: it makes the frames of an attached video, src/engine/attachments.mjs).
// 3.8.2: the same for the music Orb downloads (core\herramientas\musica, src/engine/music.mjs): what the window plays is
// what Orb checked.
const READ_ONLY_INTERNAL = [['herramientas', 'adb'], ['herramientas', 'ffmpeg'], ['herramientas', 'musica']];
const openInCore = (rest, read = false) => (READ_ONLY_INTERNAL.some(under(rest)) ? read === true : OPEN_INTERNAL.some(under(rest)) || readable(read).some(under(rest)));
const OPEN_TEXT = /^\\+(copias\\+aisladas|herramientas(?!\\+(adb|ffmpeg|musica)(\\|$|["'\s]))|preparacion)(\\|$|["'\s])/;
const ADB_TEXT = /^\\+herramientas\\+(adb|ffmpeg|musica)(\\|$|["'\s])/;
// 3.8.2 (review A1): a UNC path to this PC (\\localhost\C$\…, \\<its name>\C$\…, \\127.0.0.1\…, \\?\UNC\…, //localhost/…),
// a \\?\C:\… or \\.\C:\… one, as the local path it names. → that path; null when it is not this PC's (another
// computer's share, or not a UNC path); false when it is this PC's but cannot be told where (a share that is not a
// drive's C$, \\?\Volume{…}, \\.\GLOBALROOT…): treated as closed.
const localHosts = () => new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', os.hostname().toLowerCase(),
  ...Object.values(os.networkInterfaces()).flat().map((i) => String(i?.address ?? '').toLowerCase()).filter(Boolean)]);
export function localPath(p) {
  const s = String(p ?? '').replace(/\//g, '\\');
  if (!s.startsWith('\\\\')) return null;
  let m = /^\\\\[?.]\\([a-z]:)(\\.*)?$/i.exec(s);
  if (m) return `${m[1]}${m[2] ?? '\\'}`;
  m = /^\\\\(?:[?.]\\UNC\\)?([^\\]+)\\([^\\]+)(\\.*)?$/i.exec(s);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if ((host === '.' || host === '?') && /^pipe$/i.test(m[2])) return null; // a named pipe
  const local = host === '.' || host === '?' || /^127\./.test(host) || /\.ipv6-literal\.net$/.test(host) || localHosts().has(host) || host.split('.')[0] === os.hostname().toLowerCase();
  if (!local) return null;
  const drive = /^([a-z])\$$/i.exec(m[2]);
  return drive ? `${drive[1]}:${m[3] ?? '\\'}` : false;
}
// 3.8.2 (review A1): an existing path is also compared by what it is (volume and file id), so no other name of a closed
// folder (a share, a mount point, a drive letter made by subst) reaches it.
const ids = new Map();
const idOf = (p) => { try { const s = fs.statSync(p, { bigint: true }); return s.ino ? `${s.dev}:${s.ino}` : null; } catch { return null; } };
const rootId = (r) => { if (!ids.has(r)) { const id = idOf(r); if (!id) return null; ids.set(r, id); } return ids.get(r); };
function closedById(full, internalDir, read) {
  const core = rootId(path.resolve(internalDir));
  const others = [...guardedAsGiven, ...(read === true ? [] : appAsGiven)].map(rootId).filter(Boolean);
  if (!core && !others.length) return false;
  let at = full; const rest = [];
  for (let i = 0; i < 64; i++) {
    const id = idOf(at);
    if (id && id === core) return !openInCore(rest.slice().reverse(), read);
    if (id && others.includes(id)) return true;
    const up = path.dirname(at); if (up === at) break;
    rest.push(path.basename(at).toLowerCase()); at = up;
  }
  return false;
}
const READ_TEXT = { bitacora: /^\\+bitacora(\\|$|["'\s])/, skills: /^\\+skills(\\|$|["'\s])/ };
const readText = (read, after) => readable(read).some((o) => READ_TEXT[o[0]].test(after));
let guardedRoots = []; let guardedAsGiven = [];
// The engine names them once it knows them (src/engine/engine.mjs › open). guardedRootsNow: as given (Cursor's rules).
export function setGuardedRoots(list) {
  guardedAsGiven = [...new Set((list ?? []).filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => path.resolve(d)))];
  guardedRoots = [...new Set(guardedAsGiven.flatMap(rootsOf))];
}
export const guardedRootsNow = () => [...guardedAsGiven];
// 3.8.1: the folder Orb is installed in (its node.exe and the engine's code, which every agent's MCP server runs, and Orb.exe
// itself): under a per-user install the user, so any agent, could write there and have its code run with all of Orb's
// secrets. A reading tool may look; nothing may write, move or delete there, nor run a command that names it.
let appRoots = []; let appAsGiven = [];
export function setAppRoots(list) {
  appAsGiven = [...new Set((list ?? []).filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => path.resolve(d)))];
  appRoots = [...new Set(appAsGiven.flatMap(rootsOf))];
}
export const appRootsNow = () => [...appAsGiven];
export function isOrbData(target, internalDir, cwd, { read = false } = {}) {
  if (!internalDir || !target) return false;
  let p = winPath(String(target).trim()).replace(/^~(?=[\\/]|$)/, os.homedir());
  const local = localPath(p);
  if (local === false) return true;
  if (local) p = local;
  if (!path.isAbsolute(p) && !path.win32.isAbsolute(p)) { if (!cwd) return false; p = path.resolve(cwd, p); }
  const full = norm(realOf(p));
  const within = (root) => full === root || full.startsWith(`${root}\\`);
  const root = rootsOf(internalDir).find(within);
  if (root) return !openInCore(full.slice(root.length + 1).split('\\'), read);
  if (read !== true && appRoots.some(within)) return true;
  if (guardedRoots.some(within)) return true;
  return closedById(realOf(p), internalDir, read);
}
// The words of a command that may be paths (a=b and --opt=b give b), without quotes.
// 3.8: the folders a command may name through the environment (%APPDATA%, $env:APPDATA, $APPDATA, ${env:APPDATA}, ~ and the
// like): written out, so the checks below see the real path (the copies of Orb's secrets live under %APPDATA%).
// 3.8.2 (review M2): HOMEDRIVE and HOMEPATH too (%HOMEDRIVE%%HOMEPATH% is the user's folder), and ANDROID_USER_HOME.
const ENV_DIRS = ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'ANDROID_USER_HOME', 'PROGRAMDATA', 'TEMP', 'TMP'];
export function expandEnv(command) {
  let t = String(command ?? '');
  for (const name of ENV_DIRS) {
    const value = process.env[name] ?? (name === 'HOME' || name === 'USERPROFILE' ? os.homedir() : null);
    if (!value) continue;
    t = t.replace(new RegExp(`%${name}%|\\$\\{env:${name}\\}|\\$env:${name}\\b|\\$\\{${name}\\}|\\$${name}\\b`, 'gi'), () => value);
  }
  return t.replace(/(^|[\s"'=(])~(?=[\\/])/g, (_m, pre) => `${pre}${os.homedir()}`);
}
const pathWords = (command) => String(command ?? '').split(/[\s|&;<>()`]+/).map((w) => w.replace(/^["']+|["',]+$/g, '').replace(/^[^=]*=(?=.*[\\/~.])/, '')).filter((w) => /[\\/]|^~|^\.\.?$/.test(w));
// 3.8.1 (H1c-fix2): the folder each part of a command runs in. `cd`, `chdir`, `pushd`, `popd`, `Set-Location`, `sl`,
// `Push-Location` and `Pop-Location` (bash, cmd and PowerShell; also `cd..`, `cd\x` and `cd /d`) are followed from the
// agent's folder through ; && || & | new lines and brackets, and inside `cmd /c`, `bash -c` or `powershell -Command`.
// Quotes do not stop the split (a stray split only makes the check stricter). → [{ dir, words, moved }] (dir: null when
// it cannot be told; moved: a `cd` changed it).
const CD_CMD = /^(cd|chdir|pushd|set-location|sl|push-location)$/i;
const POP_CMD = /^(popd|pop-location)$/i;
const SHELL_CMD = /^(cmd|bash|sh|zsh|dash|powershell|pwsh|wsl)$/i;
const RUN_FLAG = /^(\/c|\/k|-c|-command|-commandwithargs)$/i;
// A Git Bash, Cygwin or WSL path of a Windows drive (/c/Users…, /cygdrive/c/…, /mnt/c/…) as Windows writes it.
export const winPath = (p) => (process.platform === 'win32' ? String(p).replace(/^\/(?:cygdrive\/|mnt\/)?([a-z])(?=\/|$)/i, (_m, d) => `${d.toUpperCase()}:`) : String(p));
const bare = (w) => String(w ?? '').replace(/^["'`]+|["'`,;]+$/g, '').replace(/^\d*[<>]+&?/, '').replace(/^[^=\\/]*=(?=.)/, '');
export function workDirs(command, cwd) {
  const out = [];
  let dir = cwd ? path.resolve(cwd) : null; let prev = dir; const stack = [];
  const resolveDir = (target) => {
    const t = winPath(bare(target));
    if (!t) return dir;
    if (t === '-') return prev;
    if (t === '~') return os.homedir();
    if (path.isAbsolute(t) || path.win32.isAbsolute(t)) return path.resolve(t);
    return dir ? path.resolve(dir, t) : null;
  };
  for (const part of String(command ?? '').split(/\r?\n|[;&|(){}]/)) {
    let w = words(part).map(bare).filter(Boolean);
    // A shell inside the command: what it runs is read as part of this one.
    for (let i = 0; i < 4 && w.length && SHELL_CMD.test(w[0].replace(/^.*[\\/]/, '').replace(/\.exe$/i, '')); i++) {
      const at = w.findIndex((x, j) => j > 0 && RUN_FLAG.test(x));
      w = at > 0 ? w.slice(at + 1) : w.slice(1).filter((x) => !x.startsWith('-'));
    }
    if (!w.length) continue;
    out.push({ dir, words: w, moved: dir !== (cwd ? path.resolve(cwd) : null) });
    const first = w[0].replace(/^@/, '');
    const glued = /^(cd|chdir)([\\/.].*)$/i.exec(first); // cmd: cd.. and cd\folder
    const cmd = glued ? glued[1] : first;
    if (CD_CMD.test(cmd)) {
      const args = glued ? [glued[2]] : w.slice(1);
      let target = null;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (/^-(path|literalpath)$/i.test(a)) { target = args[i + 1] ?? null; break; }
        if (/^(\/d|-[a-z]+|--)$/i.test(a)) continue;
        target = a; break;
      }
      if (target === null) continue; // cd alone: cmd prints the folder, PowerShell may go home (never into core)
      const next = resolveDir(target);
      if (/^(pushd|push-location)$/i.test(cmd)) stack.push(dir);
      prev = dir; dir = next;
      out.push({ dir, words: [], moved: true });
    } else if (POP_CMD.test(cmd)) { prev = dir; dir = stack.length ? stack.pop() : dir; out.push({ dir, words: [], moved: true }); }
  }
  return out;
}
// 3.8.1 (review final M3, hardening only: not a boundary): the same command with its quotes and escapes taken out
// (`pers''onal`, "pers"onal, PowerShell's `, cmd's ^, bash's \x between letters) is checked too: any of them that names
// a closed folder refuses it.
const unquoted = (c) => String(c ?? '').replace(/['"`^]/g, '');
const unescaped = (c) => unquoted(c).replace(/(?<=[A-Za-z0-9_.-])\\(?=[A-Za-z0-9_.-])/g, '');
// A word with a wildcard (`pers*`, `C:/Orb/*/x`, `p?rsonal`) that could expand into a closed folder (core, the owner's
// personal folder, the copies outside): its segments, resolved from the folder it runs in, matched against each root's.
const GLOB = /[*?[]/;
const globRe = (seg) => new RegExp(`^${seg.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^')}$`, 'i');
function globReaches(word, dir, roots) {
  const w = winPath(String(word ?? '')).replace(/^~(?=[\\/]|$)/, os.homedir());
  if (!GLOB.test(w)) return false;
  const abs = path.isAbsolute(w) || path.win32.isAbsolute(w) ? w : dir ? `${dir}\\${w}` : null;
  if (!abs) return false;
  const segs = []; // resolved by hand, segment by segment ('..' and '.' as a shell takes them)
  for (const s of abs.split(/[\\/]+/)) { if (!s || s === '.') continue; if (s === '..') segs.pop(); else segs.push(s); }
  return roots.some((r) => {
    const rs = r.split('\\').filter(Boolean);
    const n = Math.min(segs.length, rs.length);
    // No wildcard on the way to the root: the literal checks see it.
    if (!segs.slice(0, n).some((s) => GLOB.test(s))) return false;
    for (let i = 0; i < n; i++) { if (GLOB.test(segs[i]) ? !globRe(segs[i]).test(rs[i]) : segs[i].toLowerCase() !== rs[i]) return false; }
    return true;
  });
}
function touchesInternal(args) {
  const variants = [...new Set([args.command, unquoted(args.command), unescaped(args.command)].map((c) => String(c ?? '')))];
  return variants.some((command) => touchesOnce({ ...args, command }));
}
function touchesOnce({ command: given, paths, patterns, internalDir, cwd, read = false }) {
  if (!internalDir) return false;
  const command = expandEnv(given);
  if ([...paths, ...patterns].some((p) => isOrbData(p, internalDir, cwd, { read }))) return true;
  // The folder written out anywhere in the command (in a script's string too), with either separator or case.
  const t = String(command ?? '').replace(/\//g, '\\').toLowerCase();
  const coreRoots = rootsOf(internalDir);
  for (const r of [...coreRoots, ...guardedRoots, ...(read === true ? [] : appRoots)]) {
    for (let i = t.indexOf(r); i >= 0; i = t.indexOf(r, i + 1)) {
      const after = t.slice(i + r.length);
      if (/^[^\\]/.test(after) && !/^["'\s;|&)]/.test(after)) continue; // .orbx is another folder
      if (!coreRoots.includes(r) || !(OPEN_TEXT.test(after) || readText(read, after) || (read === true && ADB_TEXT.test(after)))) return true;
    }
  }
  if (pathWords(command).some((w) => isOrbData(w, internalDir, cwd, { read }))) return true;
  // 3.8.1 (H1c-fix2): each part of the command in the folder it really runs in (after its `cd`s): a part that runs in
  // core (but its open folders) is refused whatever it names, and each word, also one without a slash (a junction's
  // name), is resolved there. (An agent whose own folder is inside core, a run's: its plain words are not looked at.)
  const start = cwd ? norm(realOf(cwd)) : null;
  const startInCore = Boolean(start) && coreRoots.some((root) => start === root || start.startsWith(`${root}\\`));
  const roots = [...coreRoots, ...guardedRoots, ...(read === true ? [] : appRoots)];
  for (const part of workDirs(command, cwd)) {
    if (part.moved && part.dir && isOrbData(part.dir, internalDir, null, { read })) return true;
    for (const w of part.words) {
      if (globReaches(w, part.dir, roots)) return true;
      if (/^-/.test(w) && !/[\\/]/.test(w)) continue;
      if (!part.moved && startInCore && !/[\\/~]|^\.\.?$/.test(w)) continue;
      if (isOrbData(w, internalDir, part.dir, { read })) return true;
    }
  }
  return false;
}

// 3.8: the project's agent settings: a task could leave there rules or programs that later agents in the same folder
// (other conversations) would take as the user's (Claude's permissions.allow skips Orb's guard; env, apiKeyHelper and the
// like run programs). Changing them asks first, whatever the permission but «total». See also claude.mjs (what Orb
// loads of them) and cursor.mjs (its hooks are off while Orb runs it).
const AGENT_CONFIG = /(^|[\\/])\.claude[\\/]+settings[^\\/]*\.json$|(^|[\\/])\.cursor[\\/]+(hooks|cli|mcp)\.json$/i;
const AGENT_CONFIG_IN = /\.claude[\\/]+settings|\.cursor[\\/]+(hooks|cli|mcp)\.json/i;
export const isAgentConfig = (p) => AGENT_CONFIG.test(String(p ?? '').trim());

// 3.2.1: whether a shell command writes a file of the project (for the read-only guard). A redirection (`>`, `>>`, not
// `2>`/`>&`), or a cmdlet that writes a file (Out-File, Set-Content, Add-Content, New-Item -ItemType File, tee), to a
// target that is not the null device and not inside a build folder (dist, build, out, coverage, .vite, .next, node_modules).
const BUILD_DIR = /(^|[\\/])(dist|build|out|coverage|\.vite|\.next|\.turbo|\.cache|node_modules|tmp|temp)([\\/]|$)/i;
const NULLISH = /^(\$null|\/dev\/null|nul|con|\/dev\/stdout|\/dev\/stderr|&\d)$/i;
const unq = (w) => String(w ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
export function writesProjectFile(command) {
  const c = String(command ?? '');
  const to = [];
  // A redirection `>`/`>>` into a file (not `2>` or `>&`, which redirect a stream, not a file the task means to keep).
  for (const m of c.matchAll(/(?<![0-9&])>>?\s*("[^"]+"|'[^']+'|[^\s|&;<>]+)/g)) to.push(m[1]);
  // A cmdlet that writes a file: its -Path, or the first positional argument that looks like a file name.
  if (/\b(?:Out-File|Set-Content|Add-Content|tee|tee-object)\b/i.test(c) || /\bNew-Item\b[^|;&\n]*-ItemType\s+File\b/i.test(c)) {
    const named = c.match(/-(?:File)?Path\s+("[^"]+"|'[^']+'|[^\s|&;<>]+)/i);
    if (named) to.push(named[1]);
    else { const cand = (c.match(/"[^"]+"|'[^']+'|[^\s|&;<>]+/g) ?? []).map(unq).reverse().find((t) => !t.startsWith('-') && /[.\\/]/.test(t) && !/^(Out-File|Set-Content|Add-Content|tee|tee-object|New-Item)$/i.test(t)); if (cand) to.push(cand); }
  }
  return to.map(unq).some((t) => t && !NULLISH.test(t) && !BUILD_DIR.test(t));
}

// 3.5: «Cosas que nadie toca» (config.protected, Ajustes › Avanzado): names, paths or containers that are nobody's
// business, whatever the permission. A path, a command or a container that names one is denied. By default the usual
// password managers and secret stores (DEFAULT_PROTECTED); the user adds or removes entries. Matched without case, with
// \ read as / and a name is a whole word (keepass does not match keepassxc, but both are on the list).
export const protectedList = () => {
  const list = ctx.config?.protected;
  return (Array.isArray(list) ? list : DEFAULT_PROTECTED).map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2);
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entryRe = (e) => new RegExp(`${/^[a-z0-9]/i.test(e) ? '(?<![a-z0-9])' : ''}${esc(e.replace(/\\/g, '/'))}${/[a-z0-9]$/i.test(e) ? '(?![a-z0-9])' : ''}`, 'i');
// The first protected entry that the text names, or null.
export function protectedHit(text, list = protectedList()) {
  const t = String(text ?? '').replace(/\\/g, '/');
  if (!t) return null;
  return list.find((e) => entryRe(e).test(t)) ?? null;
}
export const touchesProtected = (text, list) => protectedHit(text, list) !== null;
// decide({ permission, tool, kind, command, paths, patterns, internalDir, cwd, lang }) → (cwd: the agent's folder, to
// resolve relative paths; lang: language of the reasons, default 'es') { decision: 'allow' | 'ask' | 'deny', reason }
// Orb's data folder: denied, whatever the permission (3.8.2: «total» too; it asked before).
// 3.7: no agent ever raises its privileges, whatever its permission (also «total»): sudo, doas, pkexec, su or
// run0.
// 3.8.2 (review M1): and Windows' ways: runas, gsudo, Start-Process (start, saps) -Verb RunAs, a ShellExecute with
// "runas", psexec -s (SYSTEM) and nircmd elevate.
const ESCALATE = /\b(sudo|doas|pkexec|run0|runas|gsudo)(\.exe)?\b|(^|[;&|(`]|\$\()\s*su(\s|$)|\/etc\/sudoers|\b(start-process|saps|start)\b[^|;&\n]*-verb\s*:?\s*["']?runas|["']runas["']|\bpsexec(64)?(\.exe)?\b[^|;&\n]*\s[-/][a-z]*s\b|\bnircmd(c)?(\.exe)?\s+elevate/i;
export const escalates = (command) => ESCALATE.test(String(command ?? '')) || ESCALATE.test(unquoted(command));
// 3.8.2 (review A1): a new name for a drive or a folder (subst, net use, New-PSDrive, a mapped share): another way to
// reach a closed folder. Denied in every mode.
const DRIVE_ALIAS = /\bsubst(\.exe)?\b|\bnet(\.exe)?\s+use\b|\b(new-psdrive|ndr)\b|\bmapnetworkdrive\b|wnetaddconnection/i;
export const aliasesDrive = (command) => DRIVE_ALIAS.test(String(command ?? '')) || DRIVE_ALIAS.test(unquoted(command));
// 3.8.2 (review M2): copying, moving or packing a folder that holds a closed one (the workspace holds core, the user's
// folder holds .android) takes the closed one with it. The program of each part of the command (cp, Copy-Item, robocopy,
// xcopy, tar, Compress-Archive, 7z, zip, rsync…) and every folder it names (resolved where that part runs) are looked at.
const COPIERS = /^(cp|copy|cpi|copy-item|xcopy|robocopy|mv|move|mi|move-item|tar|bsdtar|compress-archive|7z|7za|7zr|zip|rar|winrar|rsync|scp|ditto)$/i;
const COPY_TO = /^(cp|copy|cpi|copy-item|xcopy|mv|move|mi|move-item|rsync|scp|ditto)$/;
function copiesClosedParent(command, internalDir, cwd) {
  const closed = [...(internalDir ? rootsOf(internalDir) : []), ...guardedRoots];
  if (!closed.length) return false;
  const c = expandEnv(command);
  if (/createfromdirectory/i.test(c) && pathWords(c).some((w) => holds(w, cwd, closed))) return true;
  return workDirs(c, cwd).some((part) => {
    const exe = String(part.words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
    if (!COPIERS.test(exe)) return false;
    // What is copied (the sources), not where to: an option (-r, /E, /MIR…) is not a folder, the value of -Destination
    // and, for a copy or a move, its last folder are where it goes; robocopy's source is its first folder.
    const args = []; const ws = part.words.slice(1);
    for (let i = 0; i < ws.length; i++) {
      if (/^-(destination|d|t|target-directory)$/i.test(ws[i])) { i++; continue; }
      if (/^-/.test(ws[i]) || /^\/[a-z0-9:]{1,8}$/i.test(ws[i])) continue;
      args.push(ws[i]);
    }
    const lower = exe.toLowerCase();
    const sources = lower === 'robocopy' ? args.slice(0, 1) : COPY_TO.test(lower) && args.length > 1 ? args.slice(0, -1) : args;
    return sources.some((w) => holds(w, part.dir, closed));
  });
}
function holds(word, dir, closed) {
  let p = winPath(String(word)).replace(/^~(?=[\\/]|$)/, os.homedir());
  const local = localPath(p); if (local === false) return true; if (local) p = local;
  if (!path.isAbsolute(p) && !path.win32.isAbsolute(p)) { if (!dir) return false; p = path.resolve(dir, p); }
  const full = norm(realOf(p));
  return closed.some((r) => r === full || r.startsWith(`${full}\\`) || (/^[a-z]:$/.test(full) && r.startsWith(`${full}\\`)));
}
// 3.8.1: a command that makes a link (a junction, a symbolic or a hard link), in any shell or language: one that names core
// (or runs inside it) is denied, so nothing in core\preparacion (or anywhere) can point into core and turn an allowed write
// there into a write in core\skills, core\datos…
const MAKES_LINK = /\bmklink\b|\b(new-item|ni)\b[^|;&\n]*\b(junction|symboliclink|hardlink)\b|\bfsutil(\.exe)?\s+(hardlink|reparsepoint)\b|(^|[\s;&|(`"'])ln(\.exe)?\s|\bjunction(64)?(\.exe)?\s|create(symbolic|hard)link|createjunction|\b(sym)?linksync\b|\b(fs|fsp|promises)\.(sym)?link\b|\bos\.(sym)?link\b|\.(symlink|hardlink)_to\b|\bmountvol\b/i;
export const makesLink = (command) => MAKES_LINK.test(String(command ?? ''));
function linkIntoCore(command, internalDir, cwd) {
  if (!internalDir || !makesLink(command)) return false;
  const [root, realRoot = root] = rootsOf(internalDir);
  const inCore = (p) => { const f = norm(realOf(p)); return [root, realRoot].some((r) => f === r || f.startsWith(`${r}\\`)); };
  const t = expandEnv(command).replace(/\//g, '\\').toLowerCase();
  const named = (r) => { for (let i = t.indexOf(r); i >= 0; i = t.indexOf(r, i + 1)) if (/^($|[\\"'\s;|&)])/.test(t.slice(i + r.length))) return true; return false; };
  if (named(root) || named(realRoot)) return true;
  if (cwd && inCore(cwd)) return true;
  if (pathWords(expandEnv(command)).some((w) => { const p = path.isAbsolute(w) || path.win32.isAbsolute(w) ? w : cwd ? path.resolve(cwd, w) : null; return p ? inCore(p) : false; })) return true;
  // 3.8.1 (H1c-fix2): also after a `cd` (into core\preparacion, say): the folder it runs in, and what it names from there.
  return workDirs(expandEnv(command), cwd).some((part) => (part.dir && inCore(part.dir))
    || part.words.some((w) => { const p = winPath(w); const full = path.isAbsolute(p) || path.win32.isAbsolute(p) ? p : part.dir ? path.resolve(part.dir, p) : null; return full ? inCore(full) : false; }));
}
// 3.8.1: running a script of a skill of core: one interpreter and one script file in core\skills, as a single plain command
// (no -c / -e, no chaining, no redirection). It asks; any other command that touches core\skills is denied.
const RUNNERS = { python: [], python3: [], py: [], node: [], bash: [], sh: [], pwsh: ['-noprofile', '-nologo', '-noninteractive', '-executionpolicy'], powershell: ['-noprofile', '-nologo', '-noninteractive', '-executionpolicy'] };
function runsSkillScript(command, internalDir, cwd) {
  const c = unwrapShell(command).trim(); // Codex runs every command as powershell -Command '…'
  if (!c || /[;&|<>`\r\n]|\$\(/.test(c)) return false;
  const w = words(c);
  const exe = String(w[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  if (!Object.hasOwn(RUNNERS, exe)) return false;
  let i = 1;
  if (exe === 'pwsh' || exe === 'powershell') {
    for (; i < w.length && w[i].toLowerCase() !== '-file'; i++) {
      const a = w[i].toLowerCase();
      if (!RUNNERS[exe].includes(a)) return false;
      if (a === '-executionpolicy') i++;
    }
    if (w[i]?.toLowerCase() !== '-file') return false;
    i++;
  }
  const script = w[i];
  if (!script || !/\.(py|js|mjs|cjs|sh|ps1)$/i.test(script)) return false;
  const full = path.isAbsolute(script) || path.win32.isAbsolute(script) ? script : cwd ? path.resolve(cwd, script) : null;
  if (!full) return false;
  const f = norm(realOf(full));
  return rootsOf(path.join(internalDir, 'skills')).some((skills) => f.startsWith(`${skills}\\`) && !f.slice(skills.length + 1).startsWith('.'));
}
// 3.8.2: a command that runs Android's adb (by name, by path, or Orb's copy in core\herramientas\adb), in any shell.
// Hardening only, not a boundary (a script can build the name at run time): the adb server itself is stopped when Orb
// locks (src/engine/android.mjs › stopServer).
const RUNS_ADB = /(^|[\s;&|(`"'\\/=])adb(\.exe)?(?=$|[\s;&|)`"'])/i;
export const runsAdb = (command) => RUNS_ADB.test(String(command ?? '')) || RUNS_ADB.test(unquoted(command));
export function decide({ permission = 'editar', tool, kind, command = '', paths = [], patterns = [], internalDir, cwd, lang = 'es', android = false }) {
  const T = (k) => translate(lang, `msg.guard.${k}`);
  const cls = toolClass(tool, kind);
  const text = [command, ...paths, ...patterns].join(' ');
  if (linkIntoCore(command, internalDir, cwd)) return { decision: 'deny', reason: T('internalLink') };
  if (touchesInternal({ command, paths, patterns, internalDir, cwd, read: cls === 'read' })) {
    // 3.8.1: only the general log in core (what a reading tool may see): the reason says how to write to it.
    const logsOnly = cls !== 'read' && !touchesInternal({ command, paths, patterns, internalDir, cwd, read: ['bitacora'] });
    // 3.8.1: only the skills of core: a command (one of their scripts) asks first; changing them, never (an agent makes a
    // new version with orb_create_skill, which the user approves).
    const skillsOnly = cls !== 'read' && !logsOnly && !touchesInternal({ command, paths, patterns, internalDir, cwd, read: ['skills'] });
    if (skillsOnly && cls === 'exec' && permission !== 'leer' && !escalates(command) && !protectedHit(text) && runsSkillScript(command, internalDir, cwd)) return { decision: 'ask', reason: T('internalSkillsRun') };
    return { decision: 'deny', reason: T(logsOnly ? 'internalLogs' : skillsOnly ? 'internalSkills' : 'internal') };
  }
  if (escalates(command)) return { decision: 'deny', reason: T('sudo') };
  if (cls !== 'read' && aliasesDrive(command)) return { decision: 'deny', reason: T('driveAlias') };
  if (cls !== 'read' && copiesClosedParent(command, internalDir, cwd)) return { decision: 'deny', reason: T('copyParent') };
  const hit = protectedHit(text);
  if (hit) return { decision: 'deny', reason: translate(lang, 'msg.guard.protected', { name: hit }) };
  // 3.8.2: Android's adb by hand only with «Acceso total» and «Usar mi móvil Android» (android): otherwise the agent has
  // Orb's own tools (orb_android_*), which check the grant on every call.
  if (cls !== 'read' && cls !== 'orb' && runsAdb(command) && !(permission === 'total' && android)) return { decision: 'deny', reason: T('adb') };
  if (permission === 'total') return { decision: 'allow', reason: T('full') };
  if (cls === 'read' || cls === 'orb') return { decision: 'allow', reason: T('readOnlyTool') };
  if (permission === 'leer') return { decision: 'deny', reason: T('readOnlyChat') };
  if (permission === 'probar' && cls === 'edit') return { decision: 'deny', reason: T('testOnly') };
  if (cls === 'edit' && paths.some(isAgentConfig)) return { decision: 'ask', reason: T('agentConfig') };
  if (cls === 'edit') return { decision: 'allow', reason: T('edits') };
  if (cls === 'exec') {
    const risk = riskOf(command, lang);
    if (risk) return { decision: 'ask', reason: risk };
    if (AGENT_CONFIG_IN.test(command)) return { decision: 'ask', reason: T('agentConfig') };
    // 3.2.1: a read-only task must not write files. Running the tests or the build is fine, but a command that redirects
    // into a project file (echo >> BITACORA.md, Set-Content, Out-File…) outside a build folder asks first: with nobody to
    // answer, a task's permission times out and is denied, so the write never happens.
    if (permission === 'probar' && writesProjectFile(command)) return { decision: 'ask', reason: T('testWrite') };
    if (permission === 'preguntar') return { decision: 'ask', reason: T('runs') };
    return { decision: 'allow', reason: T('normalCommand') };
  }
  if (cls === 'mcp') return { decision: 'allow', reason: T('connector') };
  return { decision: permission === 'preguntar' ? 'ask' : 'allow', reason: T('otherTool') };
}

// The command inside a "powershell -Command '…'" wrapper (how Codex runs every command on Windows), or the command itself.
export function unwrapShell(command) {
  const c = String(command ?? '').trim();
  const m = c.match(/^(?:"[^"]*[\\/]|[^\s"]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:[-/]\w+\s+)*?(?:-command|-c)\s+(['"])([\s\S]*)\1\s*$/i);
  if (!m) return c;
  return m[1] === "'" ? m[2].replace(/''/g, "'") : m[2];
}
// The statements of a command line (split at ; && || and new lines, outside quotes, braces and brackets).
export function statements(command) {
  const s = String(command ?? ''); const out = []; let cur = ''; let quote = null; let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '{' || ch === '(') depth++;
    if ((ch === '}' || ch === ')') && depth > 0) depth--;
    if (!depth && (ch === ';' || ch === '\n' || ch === '\r' || ((ch === '&' || ch === '|') && s[i + 1] === ch))) { if (cur.trim()) out.push(cur.trim()); cur = ''; if (ch !== ';' && ch !== '\n' && ch !== '\r') i++; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 3.1: a command whose only risky part is stopping processes BY THEIR NUMBER (taskkill /PID n, Stop-Process -Id n,
// kill n): the numbers, so the engine can check they are the task's own (its test server). null when it stops anything
// by name or image, pipes into Stop-Process, or has another risk besides.
// 3.2.1: a number kept in a simple variable (`$p = 11188; Stop-Process -Id $p`, seen with Codex) is resolved first.
export function pidKills(command) {
  let c = String(command ?? '');
  const vars = new Map();
  for (const m of c.matchAll(/\$(\w+)\s*=\s*(\d{1,9})\b/g)) vars.set(m[1].toLowerCase(), m[2]);
  if (vars.size) c = c.replace(/\$\{?(\w+)\}?/g, (whole, name) => vars.get(name.toLowerCase()) ?? whole).replace(/\$(\w+)\s*=\s*\d{1,9}\s*;?/g, ' ');
  if (/\/IM\b|\s-name\b|\bpkill\b|\bkillall\b|\|\s*(stop-process|kill)\b|\$\(|`/i.test(c)) return null;
  const pids = [];
  const rest = c.replace(/\btaskkill(?:\s+(?:\/\/|\/)(?:F|T))*\s+(?:\/\/|\/)PID\s+(\d+)(?:\s+(?:\/\/|\/)(?:F|T))*/gi, (m, pid) => { pids.push(Number(pid)); return ' '; })
    .replace(/\bstop-process\s+(?:-(?:force|confirm:\$false)\s+)*-id\s+(\d+)(?:\s+-(?:force|confirm:\$false|erroraction\s+\w+))*/gi, (m, pid) => { pids.push(Number(pid)); return ' '; })
    .replace(/\bkill\s+(?:-9\s+)?(\d+)\b/gi, (m, pid) => { pids.push(Number(pid)); return ' '; });
  if (!pids.length || /\b(taskkill|stop-process|kill)\b/i.test(rest)) return null;
  return riskOf(rest) ? null : pids;
}

// 3.1: what a command does, in words anyone understands, for the permission notice in the chat (the command itself is
// one click away, never in the sentence). The agent's own description wins (Claude's Bash tool gives one).
const PLAIN = [
  [/^(taskkill|stop-process|kill|pkill|killall)\b/i, 'msg.guard.plain.stop'],
  [/^(rm|remove-item|ri|rd|rmdir|del|erase)\b/i, 'msg.guard.plain.delete'],
  [/^git\s+(?:-\S+\s+)*push\b/i, 'msg.guard.plain.push'],
  [/^git\b/i, 'msg.guard.plain.git'],
  [/^gh\b/i, 'msg.guard.plain.github'],
  [/^(npm|pnpm|yarn)\s+(i|install|add|ci)\b/i, 'msg.guard.plain.install'],
  [/^(npm|pnpm|yarn)\s+publish\b/i, 'msg.guard.plain.publish'],
  [/^(npm|pnpm|yarn|npx)\b/i, 'msg.guard.plain.npm'],
  [/^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b/i, 'msg.guard.plain.web'],
  [/^(node|python|py|deno|bun)\b/i, 'msg.guard.plain.script'],
  [/^(ssh|scp|sftp|rsync)\b/i, 'msg.guard.plain.remote'],
  [/^(schtasks|reg|setx|netsh|sc|shutdown|restart-computer|stop-computer|set-executionpolicy)\b/i, 'msg.guard.plain.system'],
  [/^(docker|podman)\b/i, 'msg.guard.plain.docker']
];
export function plainAction(command, { description = '', lang = 'es' } = {}) {
  if (String(description ?? '').trim()) return String(description).trim().replace(/\.$/, '').slice(0, 160);
  // The command inside a "powershell -Command '…'" or "cmd /c …" wrapper is the one that counts.
  // (Also a quoted path with spaces: "C:\Program Files\PowerShell\7\pwsh.exe" -Command "…".)
  let c = String(command ?? '').trim().replace(/^(?:"[^"]*[\\/]|[^\s"]*[\\/])?(?:powershell|pwsh|cmd)(?:\.exe)?"?\s+(?:[-/]\w+\s+)*?(?:-command|-c|\/c)\s+["']?/i, '');
  // 3.2.1: a compound command (`$p = 11188; Stop-Process -Id $p`, `cd x && npm run dev`) is read clause by clause: the
  // first clause that names a known action wins, so the sentence is not built from a stray `11188;` or a `cd`.
  const clauses = statements(c).map((s) => s.replace(/^\s*(?:cd\s+[^;&|]+(?:&&|;)\s*)+/i, '').replace(/^\$\w+\s*=\s*\d+\s*$/,'').replace(/^\$\w+\s*=\s*/, '').trim()).filter(Boolean);
  for (const [re, key] of PLAIN) {
    const s = clauses.find((cl) => re.test(cl));
    if (!s) continue;
    // 3.2.1: a deletion names what it deletes («borrar /tmp/tierra-build-check»), so the user can tell a temporary folder
    // of the agent's from their work.
    if (key === 'msg.guard.plain.delete') { const target = deleteTarget(s); if (target) return translate(lang, 'msg.guard.plain.deleteWhat', { target }); }
    return translate(lang, key, { program: progOf(s) });
  }
  const first = clauses.find((cl) => !/^\$\w+\s*=/.test(cl)) ?? c.replace(/^\$\w+\s*=\s*/, '');
  return translate(lang, 'msg.guard.plain.other', { program: progOf(first) });
}
const progOf = (s) => (String(s ?? '').trim().split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').replace(/[;,]+$/, '').slice(0, 30);

// The first thing a delete command names (rm -rf X, Remove-Item -Recurse -Path "X", rd /s /q X), shortened from the left
// when it is long; null when it names nothing readable (a variable, a pattern of several files).
export function deleteTarget(command) {
  const words = [...String(command ?? '').split(/[;&|]/)[0].matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]).slice(1);
  const target = words.find((w) => !/^-|^\/[a-z]{1,2}$/i.test(w));
  if (!target || /^\$|[*?]/.test(target)) return null;
  const clean = target.replace(/^["']+|["']+$/g, '').replace(/[\\/]+$/, '');
  if (!clean) return null;
  return clean.length > 60 ? `…${clean.slice(-57)}` : clean;
}

// 3.2.1: whether an agent's own words are in English (Claude describes its commands in English even when the user
// writes in Spanish): then they are not quoted in a Spanish notice.
const EN_WORDS = /\b(the|and|for|with|from|into|start|run|check|install|build|create|remove|delete|kill|stop|test|verify|list|open|read|write|update|server|dev|file|files|folder|directory|temp|temporary|clean|cleanup|port|process|launch)\b/i;
const ES_WORDS = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|para|que|con|un|una|y|en|por|archivo|archivos|carpeta|servidor)\b/i;
export const looksEnglish = (text) => EN_WORDS.test(String(text ?? '')) && !ES_WORDS.test(String(text ?? ''));

// One line for the approval card: what the agent wants to do, in plain words.
export function describeAction({ tool, command, paths = [], title, lang = 'es' }) {
  if (command) return String(command).slice(0, 400);
  if (paths.length) return `${tool ?? translate(lang, 'msg.guard.tool')}: ${paths.slice(0, 3).join(', ')}`;
  return String(title ?? tool ?? translate(lang, 'msg.guard.action')).slice(0, 400);
}
