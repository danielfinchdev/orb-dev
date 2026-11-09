// Where everything of a workspace lives: the folder names, the paths of core and its subfolders, and the workspace's
// own names (its key outside it, a project folder's category). The single source of Orb's paths on the Node side.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PRODUCT, folderName } from '../shared/product.mjs';
import { CORE_DIR, CATEGORIES } from '../shared/layout.mjs';

export const CONFIG_FILE = 'orb.json';

// Layout of the workspace (3.8): always <chosen folder>\Orb, the same for every user (C:\Orb by default):
//   core\                       Orb's own folder, hidden: everything Orb needs to work
//     orb.json                  settings
//     datos\                    database, secret, identity; ejecuciones\ task runs; copias\ isolated copies and undo points
//     bitacora\                 the general log and one per project (bitacora\proyectos)
//     mcp\                      every MCP server (each subfolder is one; Ajustes › Skills y MCP)
//     skills\                   every skill (each subfolder, with its SKILL.md); .activas: what the agents load
//     preparacion\              what an agent makes (a skill or a server) until the user turns it on
//     herramientas\adb\         what Orb downloads to build and test (Android's adb and fastboot)
//     secretos\                 the secrets sealed with the master password
//   windows\ linux\ ios\ android\ web\ multi\   categories: every subfolder of one of them is a project
// Orb 3.7 kept .orb, orb.json, bitacora, mcp-servers and android\adb-tools at the top (LEGACY). .orb and orb.json are
// Orb's own data and move into core when the engine starts; the others move only when the user says so in the window
// (src/core/core-folder.mjs › planWorkspace). A bitacora or adb-tools left at the top is used where it is (paths).
export { CORE_DIR, CATEGORIES, PLATFORMS, MULTI, SHARED_DIR, DEFAULT_CATEGORY, DEFAULT_PROTECTED } from '../shared/layout.mjs';
export const INTERNAL_DIR = CORE_DIR;
export const LOGS_DIR = 'bitacora';
export const MCP_DIR = 'mcp';
export const SKILLS_DIR = 'skills'; // 3.8.1: every skill (src/core/extensions.mjs)
export const STAGING_DIR = 'preparacion'; // 3.8.1: what an agent makes before the user turns it on (the only part of core agents write)
export const OLD_LOGS_DIR = 'bitacoras'; // 2.3.0 and older
// 3.5–3.7: the bots' memories. 3.8: no bots; an old bots\ folder is never taken for a project (the 3.8 migration archives it).
export const BOTS_DIR = 'bots';
// Where Orb 3.7 kept what now lives in core (relative to the workspace).
export const LEGACY = Object.freeze({ internal: '.orb', config: CONFIG_FILE, logs: 'bitacora', mcp: 'mcp-servers', adb: ['android', 'adb-tools'] });
const OLD_ADB_DIR = LEGACY.adb[1];
const lower = (name) => String(name ?? '').toLowerCase();
const isDirSync = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// Top-level folders that belong to Orb itself (or did in older versions), never to the user's projects.
export const isConfigName = (name) => /^\./.test(String(name)) || [CORE_DIR, LEGACY.logs, LEGACY.mcp, OLD_LOGS_DIR, BOTS_DIR, 'node_modules', '$recycle.bin', 'system volume information'].includes(lower(name));
export const isCategory = (name) => CATEGORIES.includes(lower(name));
// Folders inside a category that are never projects (hidden ones, 3.7's Android tools until they move into core).
export const isReservedInCategory = (category, name) => /^\./.test(String(name)) || ['node_modules', '$recycle.bin'].includes(lower(name)) || (lower(category) === 'android' && lower(name) === OLD_ADB_DIR);
// Names a project can never take (they would read as one of Orb's own folders).
export const isReservedName = (name) => isConfigName(name) || lower(name) === OLD_ADB_DIR;

// What the user decided in «Ordenar carpetas» about the logs at the top (core\carpetas.json, core-folder.mjs).
const logsDecision = (core) => { try { return JSON.parse(fs.readFileSync(path.join(core, 'carpetas.json'), 'utf8'))?.decided?.bitacora ?? null; } catch { return null; } };
export function paths(home) {
  const core = path.join(home, CORE_DIR);
  const data = path.join(core, 'datos');
  // A log folder or Android tools left at the top (kept by the user, or not decided about yet) are used there.
  // 3.8.1: the logs at the top are the general log only when the user kept them there, or before deciding while core has
  // no general log of its own (a 3.7 workspace). Once they moved into core (or a workspace that always had them there),
  // a bitacora that shows up at the top again (a tool outside Orb writing to the old path) never takes core's place
  // («Ordenar carpetas» offers to merge it into core).
  const keptLogs = path.join(home, LEGACY.logs);
  const keptAdb = path.join(home, ...LEGACY.adb);
  const coreLogs = path.join(core, LOGS_DIR);
  const decided = isDirSync(keptLogs) ? logsDecision(core) : 'move';
  const logs = decided === 'keep' || (decided === null && !fs.existsSync(path.join(coreLogs, 'GENERAL.md'))) ? keptLogs : coreLogs;
  const copies = path.join(core, 'copias');
  const tools = path.join(core, 'herramientas');
  return {
    home, core, internal: core, config: path.join(core, CONFIG_FILE), data, db: path.join(data, 'orb.db'), key: path.join(data, 'clave.bin'),
    logs, generalLog: path.join(logs, 'GENERAL.md'), projectLogs: path.join(logs, 'proyectos'),
    mcp: path.join(core, MCP_DIR), skills: path.join(core, SKILLS_DIR), staging: path.join(core, STAGING_DIR), tools, adb: isDirSync(keptAdb) ? keptAdb : path.join(tools, 'adb'), secrets: path.join(core, 'secretos'),
    projects: home, categories: Object.fromEntries(CATEGORIES.map((c) => [c, path.join(home, c)])),
    runs: path.join(core, 'ejecuciones'),
    copies, worktrees: path.join(copies, 'aisladas'), checkpoints: path.join(copies, 'fotos')
  };
}

// A workspace's name for what Orb keeps about it outside it (its backups, a copy of its sealed secret): the folder's name
// and a short hash of its whole path in any case (C:\Orb → orb-<8 hex>). Two workspaces never share it, and a long path
// does not make a long name.
export const homeKey = (home) => {
  const full = path.resolve(home);
  const name = path.basename(full).toLowerCase().replace(/[^\w.-]+/g, '_').slice(0, 40) || 'orb';
  return `${name}-${crypto.createHash('sha256').update(full.toLowerCase()).digest('hex').slice(0, 8)}`;
};
// The name the first 3.8 builds used (C:\Orb → C-Orb): what was kept under it is taken over once (backup.mjs, desktop-home.mjs).
export const oldHomeKey = (home) => path.resolve(home).replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '') || 'orb';

// Category of a project folder inside Orb's folder: <home>\<category>\<project>[\…]. null for anything else (outside,
// a category folder itself, Orb's configuration folders, 3.7's Android tools). A multiplatform project is the folder
// under multi (multi\<project>\android is part of <project>).
export function categoryOf(home, folder) {
  const rel = path.relative(home, folder);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(/[\\/]/);
  return parts.length >= 2 && isCategory(parts[0]) && !isReservedInCategory(parts[0], parts[1]) ? lower(parts[0]) : null;
}
// A folder as the project list compares them (real path, any case).
export const folderKey = (folder) => { try { return fs.realpathSync(folder).toLowerCase(); } catch { return path.resolve(folder).toLowerCase(); } };
export { folderName };

// A workspace: core\orb.json, or orb.json at the top (Orb 3.7, moved into core when the engine starts).
export function isHome(dir) {
  const file = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  return file(path.join(dir, CORE_DIR, CONFIG_FILE)) || file(path.join(dir, LEGACY.config));
}

// The folder a chosen base turns into: <base>\Orb whatever the assistant is called (or the base itself when it already is
// an Orb folder or is called Orb), so the layout is the same for everybody.
export function homeFor(base) {
  if (isHome(base) || lower(path.basename(base)) === lower(PRODUCT.folder)) return base;
  return path.join(base, PRODUCT.folder);
}

// Atomic write: a crash in the middle never leaves a half-written file, and a failed one never leaves its temporary file.
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw error; }
}
