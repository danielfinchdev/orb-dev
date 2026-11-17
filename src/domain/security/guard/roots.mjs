// Orb's data folder and the other closed folders: path normalisation, the guarded, app and personal roots
// (with their setters) and the test that tells whether a target falls inside Orb's data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { winPath } from './shell-text.mjs';

// Orb's data folder (core, src/platform/paths.mjs › paths().internal) is never an agent's business: what a tool
// names or a command mentions is resolved (against the agent's folder) and refused when it falls inside it. The isolated
// copies (core\copias\aisladas) are where isolated tasks work, core\copias\chats where the chats in a worktree do, and core\herramientas holds the tools agents run (adb by
// its full path), so those stay open. The same goes for what Orb keeps about the workspace outside it (setGuardedRoots:
// the backups' folders and the copies of its sealed secrets), with nothing open there. Matched by RESOLVED path, not by
// name: a project may well have its own orb.db or talk about ORB_HOME. The `cd`s of a compound command are followed
// (workDirs), but it is still not a boundary: a script or a program of the same Windows user can always reach the
// folder some other way (its own chdir, a path built at run time); the agents' identity does not depend on its
// database (agent-auth.mjs), so what is left is the integrity of Orb's data against an agent bent on it (accepted).
// The logs moved into core (core\bitacora) are open to a READING tool (the user's rules for agents may point there);
// they are written only through Orb's own tools. The skills (core\skills) too: agents read them (their SKILL.md
// and files); a command that runs one of their scripts asks first, and nobody writes there. What an agent makes for the
// user to turn on goes in core\preparacion, open like the isolated copies (src/domain/extensions/extensions.mjs).
const OPEN_INTERNAL = [['copias', 'aisladas'], ['copias', 'chats'], ['herramientas'], ['preparacion']];
const READ_INTERNAL = [['bitacora'], ['skills']];
// Windows drops the trailing dots and spaces of each name and reads `name:stream` as a stream of
// that file or folder (`core.\datos`, `core \datos`, `core::$INDEX_ALLOCATION\datos` are core\datos; `.env::$DATA` is .env):
// a path is compared without them. A drive (`C:`) stays as it is.
const winClean = (p) => (process.platform !== 'win32' ? p : String(p).split('\\').map((s, i) => (i === 0 || /^\.\.?$/.test(s) || /^[a-z]:$/i.test(s) ? s : (s.replace(/:.*$/, '').replace(/[. ]+$/, '') || s))).join('\\'));
export const norm = (p) => winClean(path.resolve(p).replace(/\//g, '\\')).replace(/\\+$/, '').toLowerCase();
// where a path really is: links and junctions followed, also for a file not made yet (its nearest existing parent
// is resolved), so a junction made earlier (in a project or in core\preparacion) cannot send a write into core.
export const realOf = (p) => {
  let at = winClean(path.resolve(p)); const rest = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there: its parent */ }
    // A link whose target is not there (yet): where it points.
    try { if (fs.lstatSync(at).isSymbolicLink()) { at = path.resolve(path.dirname(at), fs.readlinkSync(at)); continue; } } catch { /* not a link */ }
    const up = path.dirname(at); if (up === at) break;
    rest.push(path.basename(at)); at = up;
  }
  return winClean(path.resolve(p));
};
// A folder as given and where it really is (links followed, and the long name of an 8.3 one such as C:\Users\RUNNER~1, which
// a TEMP or a user name longer than eight letters gives): what a path is compared with, since realOf gives the long one.
export const rootsOf = (dir) => [...new Set([norm(dir), norm(realOf(dir))])];
const under = (rest) => (o) => o.every((part, i) => rest[i] === part);
// read: true (every folder a reading tool may see), false, or the names of the ones that count (['skills']).
const readable = (read) => (read === true ? READ_INTERNAL : Array.isArray(read) ? READ_INTERNAL.filter((o) => read.includes(o[0])) : []);
// Orb's own adb (core\herramientas\adb) runs in the engine: a reading tool may look, nobody may write
// there or run it (an agent's adb.exe or DLL left there would run with the engine's rights). The same for Orb's own
// ffmpeg (core\herramientas\ffmpeg: it makes the frames of an attached video, src/engine/host/attachments.mjs).
// the same for the music Orb downloads (core\herramientas\musica, src/engine/host/music.mjs): what the window plays is
// what Orb checked.
const READ_ONLY_INTERNAL = [['herramientas', 'adb'], ['herramientas', 'ffmpeg'], ['herramientas', 'musica']];
const openInCore = (rest, read = false) => (READ_ONLY_INTERNAL.some(under(rest)) ? read === true : OPEN_INTERNAL.some(under(rest)) || readable(read).some(under(rest)));
export const OPEN_TEXT = /^\\+(copias\\+(aisladas|chats)|herramientas(?!\\+(adb|ffmpeg|musica)(\\|$|["'\s]))|preparacion)(\\|$|["'\s])/;
export const ADB_TEXT = /^\\+herramientas\\+(adb|ffmpeg|musica)(\\|$|["'\s])/;
// a UNC path to this PC (\\localhost\C$\…, \\<its name>\C$\…, \\127.0.0.1\…, \\?\UNC\…, //localhost/…),
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
// an existing path is also compared by what it is (volume and file id), so no other name of a closed
// folder (a share, a mount point, a drive letter made by subst) reaches it.
const ids = new Map();
const idOf = (p) => { try { const s = fs.statSync(p, { bigint: true }); return s.ino ? `${s.dev}:${s.ino}` : null; } catch { return null; } };
const rootId = (r) => { if (!ids.has(r)) { const id = idOf(r); if (!id) return null; ids.set(r, id); } return ids.get(r); };
function closedById(full, internalDir, read) {
  const core = rootId(path.resolve(internalDir));
  const others = [...guardedAsGiven, ...personalAsGiven, ...(read === true ? [] : appAsGiven)].map(rootId).filter(Boolean);
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
export const readText = (read, after) => readable(read).some((o) => READ_TEXT[o[0]].test(after));
export let guardedRoots = []; let guardedAsGiven = [];
// The engine names them once it knows them (src/engine/engine.mjs › open). guardedRootsNow: as given (Cursor's rules).
export function setGuardedRoots(list) {
  guardedAsGiven = [...new Set((list ?? []).filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => path.resolve(d)))];
  guardedRoots = [...new Set(guardedAsGiven.flatMap(rootsOf))];
}
export const guardedRootsNow = () => [...guardedAsGiven];
// the folder Orb is installed in (its node.exe and the engine's code, which every agent's MCP server runs, and Orb.exe
// itself): under a per-user install the user, so any agent, could write there and have its code run with all of Orb's
// secrets. A reading tool may look; nothing may write, move or delete there, nor run a command that names it.
export let appRoots = []; let appAsGiven = [];
export function setAppRoots(list) {
  appAsGiven = [...new Set((list ?? []).filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => path.resolve(d)))];
  appRoots = [...new Set(appAsGiven.flatMap(rootsOf))];
}
export const appRootsNow = () => [...appAsGiven];
// «siempre bloqueado»: the owner's personal credentials, closed like core in every mode
// (also «total»), for reading too: SSH and GPG keys, the browsers' profiles (saved passwords, cookies), the agents' own
// logins (Claude Code, Codex, Cursor, GitHub CLI), git's stored credentials, Windows' credential store and the app data of
// Orb itself (its sealed secrets' copies). The agents' CLIs read their own login themselves, never through a tool.
export function defaultPersonalRoots(env = process.env, home = os.homedir()) {
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(home, '.ssh'), path.join(home, '.gnupg'), path.join(home, '.git-credentials'),
    path.join(home, '.claude', '.credentials.json'), path.join(home, '.codex', 'auth.json'), path.join(home, '.cursor', 'cli-config.json'),
    path.join(home, '.config', 'gh', 'hosts.yml'), path.join(roaming, 'GitHub CLI', 'hosts.yml'), path.join(roaming, 'Cursor', 'User', 'globalStorage'),
    path.join(local, 'Google', 'Chrome', 'User Data'), path.join(local, 'Microsoft', 'Edge', 'User Data'), path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    path.join(local, 'Vivaldi', 'User Data'), path.join(roaming, 'Opera Software'), path.join(roaming, 'Mozilla', 'Firefox'),
    path.join(roaming, 'Microsoft', 'Credentials'), path.join(local, 'Microsoft', 'Credentials'), path.join(roaming, 'Microsoft', 'Protect'), path.join(local, 'Microsoft', 'Vault'),
    path.join(roaming, 'dev.orb.app'), path.join(local, 'dev.orb.app'), path.join(roaming, 'Orb.dev'), path.join(local, 'Orb.dev')
  ];
}
export let personalRoots = []; let personalAsGiven = [];
export function setPersonalRoots(list) {
  personalAsGiven = [...new Set((list ?? []).filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => path.resolve(d)))];
  personalRoots = [...new Set(personalAsGiven.flatMap(rootsOf))];
}
export const personalRootsNow = () => [...personalAsGiven];
setPersonalRoots(defaultPersonalRoots());
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
  if (guardedRoots.some(within) || personalRoots.some(within)) return true;
  return closedById(realOf(p), internalDir, read);
}
