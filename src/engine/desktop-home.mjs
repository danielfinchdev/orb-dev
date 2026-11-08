// Where this PC's workspace is, for the desktop app: the location saved in the app's data folder (%APPDATA%\Orb.dev\
// ubicacion.json), an Orb folder already on the PC for a fresh install, the first-run setup and the copies kept outside
// the workspace (claves\). The engine answers the app's 'locate' / 'setup' / 'switchHome' messages with it
// (src/engine/engine.mjs), so the rules live once.
import fs from 'node:fs';
import path from 'node:path';
import { createHome, isHome, writeJson, paths, homeKey, oldHomeKey, LEGACY } from '../core/home.mjs';
import { PRODUCT } from '../core/product.mjs';

const location = (userData) => path.join(userData, 'ubicacion.json');

// 3.8: a saved workspace whose core is gone is still this PC's workspace: the engine puts core back from the newest backup
// or the window says why it cannot (only a workspace folder that is gone altogether brings the welcome back). Global B13:
// a folder without core counts only when this app keeps copies for it (claves<its key>…); an old location pointing
// to some other folder brings the welcome, not «Falta core».
const keptHere = (userData, h) => {
  let names = []; try { names = fs.readdirSync(path.join(userData, 'claves')); } catch { return false; }
  const keys = [homeKey(h), oldHomeKey(h)];
  return names.some((n) => keys.some((k) => n === k || n.startsWith(`${k}.`) || n.startsWith(`${k}-`)));
};
export function readLocation(userData) {
  try { const h = JSON.parse(fs.readFileSync(location(userData), 'utf8')).home; return typeof h === 'string' && h && (isHome(h) || (fs.existsSync(h) && keptHere(userData, h))) ? h : null; } catch { return null; }
}
export function saveLocation(userData, home) { fs.mkdirSync(userData, { recursive: true }); writeJson(location(userData), { home }); }

// A fresh install (no saved location) on a PC that already has an Orb folder uses it as it is: <drive>:\Orb, Documents\Orb
// or <user>\Orb, the most recently used one if there are several. Nothing is created or overwritten. Only for an installed
// app with its normal data folder: tests and runs from the code (separate data folder or not packaged) never pick up a
// real folder.
export function findExistingHome({ packaged, separateData, documents, profile, platform = process.platform }) {
  if (!packaged || separateData) return null;
  // Drive letters only exist on Windows; on Linux / macOS, Documents/Orb and ~/Orb.
  const drives = platform !== 'win32' ? [] : 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const candidates = new Set([...drives.map((d) => path.join(d, PRODUCT.folder)), ...[documents, profile].filter(Boolean).map((d) => path.join(d, PRODUCT.folder))]);
  const used = (h) => { for (const f of [paths(h).config, path.join(h, LEGACY.config)]) { try { return fs.statSync(f).mtimeMs; } catch { /* the other one */ } } return 0; };
  return [...candidates].filter((h) => isHome(h)).sort((a, b) => used(b) - used(a))[0] ?? null;
}

// The saved workspace, or an existing one remembered now. null: the window shows the welcome (first-run setup).
export function locateHome({ userData, packaged = false, separateData = false, documents = null, profile = null }) {
  let home = readLocation(userData);
  if (!home) { home = findExistingHome({ packaged, separateData, documents, profile }); if (home) saveLocation(userData, home); }
  return home;
}

// First run: creates <base>/<name> (or reuses an existing assistant folder) and remembers it.
export function setupHome({ userData, base, assistantName, userName, language }) {
  const { home } = createHome(String(base ?? ''), { assistantName: String(assistantName ?? PRODUCT.assistant), userName: String(userName ?? ''), language: language === 'en' ? 'en' : 'es' });
  saveLocation(userData, home);
  return home;
}

// Moves to another assistant folder: only one that is an Orb workspace. The app restarts with it.
export function switchHome({ userData, target }) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || !isHome(target)) return false;
  saveLocation(userData, target);
  return true;
}

// The copies kept outside the workspace, one per workspace: the sealed approval secret (claves\<key>.enc; the backups are
// sealed with it, so a core deleted by mistake can still be restored) and the master password's files (claves\<key>-
// secretos). The first 3.8 builds named them after the workspace's whole path (home.mjs › oldHomeKey): taken over once.
export const secretCopy = (userData, home) => path.join(userData, 'claves', `${homeKey(home)}.enc`);
export const secretsCopy = (userData, home) => path.join(userData, 'claves', `${homeKey(home)}-secretos`);
export function adoptOldKeyNames(userData, home) {
  const dir = path.join(userData, 'claves');
  for (const [from, to] of [[`${oldHomeKey(home)}.enc`, path.basename(secretCopy(userData, home))], [`${oldHomeKey(home)}-secretos`, path.basename(secretsCopy(userData, home))]]) {
    try { if (fs.existsSync(path.join(dir, from)) && !fs.existsSync(path.join(dir, to))) fs.renameSync(path.join(dir, from), path.join(dir, to)); } catch { /* the next start */ }
  }
}

// The data folder that holds the approval secret: core\datos, or .orb\datos of a 3.7 workspace not moved into core yet.
export function secretDir(home) {
  const legacy = path.join(home, LEGACY.internal, 'datos');
  return fs.existsSync(legacy) && !fs.existsSync(paths(home).core) ? legacy : paths(home).data;
}

// 3.8: core itself (all of it at once) and its secrets open in the File Explorer only with a fresh unlock of the master
// password; its tool folders (MCP servers, adb, logs) open as before. Compared by the real path (a junction, a short 8.3
// name or the \\?\ prefix lead to the same folder).
const realLower = (p) => { let r = path.resolve(p); try { r = fs.realpathSync.native(r); } catch { /* not there: as written */ } return r.replace(/^\\\\\?\\/, '').toLowerCase(); };
export function guardedCore(home, target) {
  if (!home || typeof target !== 'string') return false;
  const t = realLower(target);
  const core = realLower(paths(home).core); const secrets = realLower(paths(home).secrets);
  return t === core || t === secrets || t.startsWith(secrets + path.sep);
}
