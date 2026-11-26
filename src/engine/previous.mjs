// Reinstalling Orb on a PC that still has the data of a workspace (item 21): Orb no longer adopts it in silence. At the
// start it asks «¿Los recupero o empiezo de cero?»; «Empezar de cero» deletes nothing: what was there goes aside, inside
// core, to core\anterior-AAAA-MM-DD (with the copy of the vault outside the workspace, or restoreMissing would bring the old
// vault back), and Ajustes › Datos can delete it later. The PC's key stays: it opens that vault.
import fs from 'node:fs';
import path from 'node:path';
import { paths, homeKey, oldHomeKey, writeJson } from '../platform/paths.mjs';
import { git } from '../platform/git.mjs';
import { readLocation, saveLocation, findExistingHome } from './desktop-home.mjs';
import { MARK_FILE, RESET_MARK, KEY_NAME, KEPT_PROJECTS, projectsMadeByOrb, uninstallEnv, writeHealthyCore } from '../domain/data/uninstall.mjs';
import { lstatOrNull, plainChain, sizeOf, removeTree, isUnder } from '../domain/data/safe-delete.mjs';
import { orbIdOf } from '../domain/data/backup.mjs';

export const ASIDE = /^anterior-\d{4}-\d{2}-\d{2}(-\d+)?$/;
const markFile = (userData) => path.join(userData, MARK_FILE);
const readMark = (userData) => { try { const m = JSON.parse(fs.readFileSync(markFile(userData), 'utf8')); return m && typeof m === 'object' ? m : {}; } catch { return null; } };
export const clearMark = (userData) => { try { fs.rmSync(markFile(userData), { force: true }); } catch { /* the next start asks again */ } };

// The folder of a workspace that was there before this install, or null (a normal start). source: 'mark' (the uninstaller
// wrote desinstalado.json) or 'folder' (no saved location, but an Orb folder is on the PC). A core that says «restablecido»
// (a reset, or «Empezar de cero» a moment ago) is a start the user already decided about.
export function previousData(opts) {
  const { userData } = opts;
  const saved = readLocation(userData);
  const mark = readMark(userData);
  let home = null; let source = null;
  if (saved && mark) { home = saved; source = 'mark'; }
  else if (!saved) {
    const found = findExistingHome(opts);
    if (found) { home = found; source = 'folder'; }
  }
  if (!home) return null;
  if (fs.existsSync(path.join(paths(home).core, RESET_MARK))) return null;
  let since = 0; try { since = fs.statSync(paths(home).config).mtimeMs; } catch { /* unknown */ }
  const size = sizeOf(paths(home).core);
  return { home, source, since, bytes: size.bytes };
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// A folder or file moved; across volumes (the workspace on another drive than the app's data) copied, then removed.
function move(from, to) {
  try { fs.renameSync(from, to); return; } catch (error) { if (error?.code !== 'EXDEV') throw error; }
  fs.cpSync(from, to, { recursive: true, dereference: false, errorOnExist: true });
  removeTree(from);
}

// Puts what is in core aside and writes a healthy new core, then remembers the workspace. Nothing is deleted. → { home, aside }
export async function startFresh({ userData, home, language = 'es' }) {
  const env = uninstallEnv({ home, userData, config: { language } });
  const p = env.p;
  if (!plainChain(env.realHome, path.join(env.realHome, 'core')) && lstatOrNull(p.core)) throw new Error('core is a link');
  fs.mkdirSync(p.core, { recursive: true });
  // the projects Orb made keep their mark through the fresh start: their rows go to the new core (importKeptProjects)
  const madeByOrb = projectsMadeByOrb(p.db);
  let aside = path.join(p.core, `anterior-${today()}`);
  for (let i = 2; fs.existsSync(aside); i++) aside = path.join(p.core, `anterior-${today()}-${i}`);
  fs.mkdirSync(aside);
  const before = (() => { try { return JSON.parse(fs.readFileSync(p.config, 'utf8')).language; } catch { return null; } })();
  for (const name of fs.readdirSync(p.core)) {
    if (path.join(p.core, name) === aside || ASIDE.test(name) || name === RESET_MARK) continue; // earlier asides stay where they are
    if (name === 'datos') {
      // the PC's key stays where it is: it opens the vault that goes aside (and every backup)
      fs.mkdirSync(path.join(aside, 'datos'));
      for (const d of fs.readdirSync(path.join(p.core, 'datos'))) { if (!KEY_NAME.test(d)) move(path.join(p.core, 'datos', d), path.join(aside, 'datos', d)); }
      continue;
    }
    move(path.join(p.core, name), path.join(aside, name));
  }
  // the vault's copy outside the workspace, under every name it had
  const replicas = path.join(aside, 'replica-boveda');
  for (const k of new Set([homeKey(home), oldHomeKey(home)])) {
    const r = path.join(userData, 'claves', `${k}-secretos`);
    if (!lstatOrNull(r)) continue;
    fs.mkdirSync(replicas, { recursive: true });
    move(r, path.join(replicas, `${k}-secretos`));
  }
  // the isolated copies that moved still belong to their projects' repositories
  for (const sub of ['chats', 'aisladas']) {
    const root = path.join(aside, 'copias', sub);
    for (const name of (() => { try { return fs.readdirSync(root); } catch { return []; } })()) {
      const dir = path.join(root, name);
      let pointer = ''; try { pointer = fs.readFileSync(path.join(dir, '.git'), 'utf8'); } catch { continue; }
      const m = /^gitdir:\s*(.+)$/m.exec(pointer);
      if (!m) continue;
      const repo = path.resolve(m[1].trim(), '..', '..', '..'); // <repo>\.git\worktrees\<name> → <repo>
      if (lstatOrNull(path.join(repo, '.git'))) git(repo, 'worktree', 'repair', dir);
    }
  }
  // a new healthy core (with its own identity, so no old backup is taken for this workspace's)
  await writeHealthyCore({ ...env, config: { language: before ?? language ?? 'es' } }, { keepSettings: false, resetMark: true });
  if (madeByOrb.length) writeJson(path.join(p.core, KEPT_PROJECTS), { v: 1, projects: madeByOrb });
  orbIdOf(home);
  saveLocation(userData, home);
  clearMark(userData);
  return { home, aside };
}

// «Recuperar»: as it always was. The saved location stays (or is saved now), the mark goes.
export function recover({ userData, home }) {
  if (!readLocation(userData)) saveLocation(userData, home);
  clearMark(userData);
  return { home };
}

// The answer to the question: re-derived here from the disk (the window only says which button), never from a path it sends.
export async function answerPrevious(opts, choice) {
  const found = previousData(opts);
  if (!found) throw Object.assign(new Error('no previous data'), { userFacing: true });
  if (choice === 'recover') return recover({ userData: opts.userData, home: found.home });
  if (choice === 'fresh') return startFresh({ userData: opts.userData, home: found.home, language: opts.language });
  throw Object.assign(new Error('bad choice'), { userFacing: true });
}

// ---- «Datos de antes» (Ajustes › Datos)
export function asideList(home) {
  const core = paths(home).core;
  let names; try { names = fs.readdirSync(core); } catch { return []; }
  return names.filter((n) => ASIDE.test(n)).map((n) => {
    const dir = path.join(core, n);
    const st = lstatOrNull(dir);
    if (!st?.isDirectory() || st.isSymbolicLink()) return null;
    return { name: n, date: n.slice('anterior-'.length, 'anterior-'.length + 10), bytes: sizeOf(dir).bytes };
  }).filter(Boolean);
}
// Deletes one of them (nothing else is touched), then lets the projects' repositories drop the copies that went (only the
// worktrees that were inside it: the user's own are never pruned).
export function deleteAside(home, name, { projects = [] } = {}) {
  if (!ASIDE.test(String(name))) throw Object.assign(new Error('bad name'), { userFacing: true });
  const realHome = (() => { try { return fs.realpathSync.native(home); } catch { return path.resolve(home); } })();
  const dir = path.join(paths(home).core, name);
  if (!plainChain(realHome, path.join(realHome, 'core', name))) throw Object.assign(new Error('not allowed'), { userFacing: true });
  const bytes = sizeOf(dir).bytes;
  const ours = projects.filter((repo) => lstatOrNull(path.join(repo, '.git'))?.isDirectory() && git(repo, 'worktree', 'list', '--porcelain').stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && isUnder(dir, l.slice(9).trim())));
  removeTree(dir);
  for (const repo of ours) git(repo, 'worktree', 'prune');
  return { deleted: name, bytes };
}
