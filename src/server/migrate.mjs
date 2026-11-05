// 3.7: an Orb Server installed before 3.7 (its data in ~/orb, its program in ~/orb-nucleo/<version> + current, unit
// orb-nucleo.service) moves in place to Orb Server's folder, ~/orb-server: the same data (database, clave.bin,
// enlaces.json: the phones and Orbs stay linked), in the server's layout (src/core/home.mjs › paths). A «preupdate» backup
// is made first. For one minor version the old names keep working: ~/orb is a link to ~/orb-server and ~/orb-nucleo one
// to ~/orb-server/app (so the old `orb-nucleo` command and paths still reach the program). The systemd side (the old unit
// off, orb-server.service on) is the installer's (scripts/install.sh.tmpl).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isHome, readKey, loadConfig, forgetLayout, isServerLayout, SERVER_DIRS, CATEGORIES, INTERNAL_DIR, LOGS_DIR, MCP_DIR } from '../core/home.mjs';

export function legacyPaths(env = process.env, home = os.homedir()) {
  return { home: path.resolve(env.ORB_HOME || path.join(home, 'orb-server')), oldHome: path.join(home, 'orb'), oldApp: path.join(home, 'orb-nucleo') };
}
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isEmptyDir = (p) => { try { return fs.readdirSync(p).length === 0; } catch { return false; } };
// A link to a folder (a junction on Windows: no admin needed).
export const linkDir = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
// Moves from → to; when both are folders, what is inside from goes into to (a file already in to is kept, the old one
// goes beside it as <name>.anterior).
function moveInto(from, to) {
  if (!exists(from)) return;
  if (!exists(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); return; }
  if (fs.statSync(from).isDirectory() && fs.statSync(to).isDirectory()) {
    for (const name of fs.readdirSync(from)) moveInto(path.join(from, name), path.join(to, name));
    fs.rmdirSync(from);
    return;
  }
  fs.renameSync(from, `${to}.anterior`);
}

// 3.7: a migration in progress leaves this mark in ~/orb-server (and in ~/orb while it is there): if the server stops in
// the middle (power cut, kill), the next start finishes the same migration instead of refusing a half-moved folder or
// running on it in the old layout.
export const MIGRATING = '.migrando-a-orb-server';
const marked = (dir) => exists(path.join(dir, MIGRATING));
const mark = (dir) => { try { fs.writeFileSync(path.join(dir, MIGRATING), `${new Date().toISOString()}
`); } catch { /* the folder may not exist yet */ } };

// Is there something to migrate? → 'none' | 'migrate' | 'done' | 'conflict'
export function migrationState({ home, oldHome }) {
  if (marked(home) || (exists(oldHome) && !isLink(oldHome) && marked(oldHome))) return 'migrate';
  if (isHome(oldHome) && !isLink(oldHome) && path.resolve(oldHome) !== path.resolve(home)) return isHome(home) ? 'conflict' : 'migrate';
  return isHome(home) && isServerLayout(home) ? 'done' : 'none';
}

// The migration itself (with the service stopped). backup(oldHome): the «preupdate» copy (src/server/host.mjs).
// → { state, steps: [what was done, in plain words] }
export async function migrateLegacy({ home, oldHome, oldApp, backup = null, links = true, log = () => {} }) {
  const steps = [];
  const step = (s) => { steps.push(s); log(`migración: ${s}`); };
  const state = migrationState({ home, oldHome });
  if (state === 'conflict') throw new Error(`hay datos en ${oldHome} y en ${home}: no se mezclan solos`);
  if (state !== 'migrate') return { state, steps };
  const resuming = marked(home) || (exists(oldHome) && !isLink(oldHome) && marked(oldHome));
  if (resuming) step('sigo con la migración que quedó a medias');
  // 1. a backup of the data as they are, before anything moves (not again when resuming: part of it has moved already)
  if (backup && !resuming) { const file = await backup(oldHome); if (file) step(`copia antes de migrar: ${path.basename(file)}`); }
  // 2. the folder: ~/orb → ~/orb-server (the installer may have unpacked the program in ~/orb-server/app already)
  if (exists(oldHome) && !isLink(oldHome)) {
    if (exists(home)) {
      const extra = fs.readdirSync(home).filter((n) => !Object.values(SERVER_DIRS).includes(n) && n !== MIGRATING);
      if (extra.length && !resuming) throw new Error(`${home} ya tiene otras cosas (${extra.slice(0, 3).join(', ')}): no se migra`);
    }
    mark(oldHome); if (exists(home)) mark(home);
    if (exists(home)) {
      for (const name of fs.readdirSync(oldHome)) if (name !== MIGRATING) moveInto(path.join(oldHome, name), path.join(home, name));
      fs.rmSync(path.join(oldHome, MIGRATING), { force: true });
      fs.rmdirSync(oldHome);
    } else { fs.mkdirSync(path.dirname(home), { recursive: true }); fs.renameSync(oldHome, home); }
    step(`${oldHome} → ${home}`);
  }
  // 3. the server's layout: .orb → data/, its runs → logs/, the bitácora → logs/bitacora, the MCP servers → data/
  const data = path.join(home, SERVER_DIRS.data); const logs = path.join(home, SERVER_DIRS.logs);
  moveInto(path.join(home, INTERNAL_DIR), data);
  moveInto(path.join(data, 'ejecuciones'), logs);
  moveInto(path.join(home, LOGS_DIR), path.join(logs, LOGS_DIR));
  moveInto(path.join(home, MCP_DIR), path.join(data, MCP_DIR));
  // The project categories a server never used (empty) go; anything with content stays where it is.
  for (const c of CATEGORIES) { const d = path.join(home, c); if (isEmptyDir(d)) fs.rmdirSync(d); }
  for (const d of Object.values(SERVER_DIRS)) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(path.join(data, 'datos'), { recursive: true });
  forgetLayout(home); forgetLayout(oldHome);
  step('carpetas ordenadas como las de Orb Server (data, logs, bots, browser, engines, app)');
  // 4. the old program's folder: its versions and copies into app/ and data/copias; then ~/orb-nucleo → app
  if (oldApp && exists(oldApp) && !isLink(oldApp)) {
    const app = path.join(home, SERVER_DIRS.app);
    for (const name of fs.readdirSync(oldApp)) {
      const from = path.join(oldApp, name);
      if (name === 'copias') moveInto(from, path.join(data, 'copias', 'anteriores'));
      else if (/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(name) && !exists(path.join(app, name))) fs.renameSync(from, path.join(app, name));
      else if (name === 'current' && isLink(from)) fs.rmSync(from, { force: true });
      else moveInto(from, path.join(app, 'anterior', name));
    }
    fs.rmSync(oldApp, { recursive: true, force: true });
    step(`${oldApp} → ${app}`);
    if (links) { linkDir(app, oldApp); step(`${oldApp} queda como enlace a ${app} (hasta la próxima versión)`); }
  }
  // 5. ~/orb keeps working for a minor version
  if (links && !exists(oldHome)) { linkDir(home, oldHome); step(`${oldHome} queda como enlace a ${home} (hasta la próxima versión)`); }
  // What the engine reads at start must be there: the settings and the secret.
  loadConfig(home); readKey(home);
  fs.rmSync(path.join(home, MIGRATING), { force: true });
  forgetLayout(home);
  return { state: 'migrated', steps };
}
