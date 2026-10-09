// Projects live inside the categories of the assistant's folder (D:\Orb\<windows|ios|android|web>\<proyecto>). The app
// creates them with git from the start (so every task can be undone and isolated copies are possible), and any folder the
// user creates by hand inside a category shows up too. Orb's own folders (bitacora, mcp-servers, .orb) are never projects.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from './context.mjs';
import { folderName, isReservedName, isReservedInCategory, isCategory, categoryOf, CATEGORIES, DEFAULT_CATEGORY } from './home.mjs';
import { git, ORB_GIT } from './workspace.mjs';

export const checkCategory = (category) => {
  const c = String(category ?? '').trim().toLowerCase() || DEFAULT_CATEGORY;
  if (!isCategory(c)) throw new Error(tr('msg.projects.badCategory', { category, list: CATEGORIES.join(', ') }));
  return c;
};

export function createProject(board, { name, notes = '', category }, actor) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error(tr('msg.projects.needName'));
  if (board.project(clean)) throw new Error(tr('msg.projects.exists', { name: clean }));
  const cat = checkCategory(category);
  const dir = folderName(clean, 'proyecto');
  if (isReservedName(dir)) throw new Error(tr('msg.projects.reserved', { dir, name: ctx.config.assistantName }));
  const folder = path.join(ctx.paths.categories[cat], dir);
  if (fs.existsSync(folder) && fs.readdirSync(folder).length) throw new Error(tr('msg.projects.folderNotEmpty', { folder }));
  fs.mkdirSync(folder, { recursive: true });
  // "-b" needs git 2.28+; older versions get the default branch renamed instead. Without git the project still works
  // (undo then uses a copy of the folder), it just has no branches or GitHub.
  let init = git(folder, 'init', '-q', '-b', 'main');
  if (init.status !== 0 && init.status !== -1) { init = git(folder, 'init', '-q'); if (init.status === 0) git(folder, 'symbolic-ref', 'HEAD', 'refs/heads/main'); }
  if (init.status === 0) {
    fs.writeFileSync(path.join(folder, '.gitignore'), 'node_modules/\n.env\n.env.*\n!.env.example\n.orb-adjuntos/\n');
    git(folder, 'add', '.gitignore');
    git(folder, ...ORB_GIT, 'commit', '-q', '-m', 'Proyecto creado');
  }
  return board.addProject({ name: clean, path: folder, notes }, actor);
}

// Keeps the project list in step with the categories: new subfolders become projects, and projects whose folder inside the
// assistant's folder was deleted, or that are not a project folder of a category (2.3.0 took the categories and Orb's own
// folders for projects), are dropped unless they still have open tasks. Linked outside folders are left alone.
export function syncProjects(board) {
  const home = ctx.paths.home;
  const norm = (p) => { try { return fs.realpathSync(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
  const registered = board.projects();
  const byPath = new Map(registered.map((p) => [norm(p.path), p]));
  let changed = false;
  for (const cat of CATEGORIES) {
    let entries; try { entries = fs.readdirSync(ctx.paths.categories[cat], { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || isReservedInCategory(cat, e.name)) continue;
      const folder = path.join(ctx.paths.categories[cat], e.name);
      if (byPath.has(norm(folder))) continue;
      let name = e.name; let i = 2;
      while (board.project(name)) name = `${e.name} (${i++})`;
      try { board.addProject({ name, path: folder }, 'orb', { fromUser: true }); changed = true; } catch { /* unreadable folder: skipped */ }
    }
  }
  for (const p of registered) {
    const rel = path.relative(home, p.path);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (fs.existsSync(p.path) && categoryOf(home, p.path)) continue;
    try { board.removeProject(p.name, 'orb'); changed = true; } catch { /* open tasks: kept */ }
  }
  return changed;
}
