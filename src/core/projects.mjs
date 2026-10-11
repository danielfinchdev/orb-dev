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

// 2.7: a project for one platform or for several. Several = a multiplatform group: one project per platform in its own
// category, named <name>-<platform> (tienda-android, tienda-ios…), linked by their group, plus a shared folder
// <home>/comun/<name> for what they have in common (API, design, texts, images) that every one of them reads.
export function createProjects(board, { name, notes = '', categories }, actor) {
  const cats = [...new Set((Array.isArray(categories) && categories.length ? categories : [undefined]).map(checkCategory))];
  if (cats.length === 1) return [createProject(board, { name, notes, category: cats[0] }, actor)];
  const base = String(name ?? '').trim();
  if (!base) throw new Error(tr('msg.projects.needName'));
  const names = cats.map((c) => `${base}-${c}`);
  for (const n of names) if (board.project(n)) throw new Error(tr('msg.projects.exists', { name: n }));
  const made = names.map((n, i) => createProject(board, { name: n, notes, category: cats[i] }, actor));
  const common = commonFolder(base);
  fs.mkdirSync(common, { recursive: true });
  const readme = path.join(common, 'LEEME.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, tr('msg.projects.commonReadme', { name: base, list: names.join(', ') }));
  for (const p of made) board.run('UPDATE projects SET grupo = ? WHERE name = ?', base, p.name);
  board.changed('projects');
  return made.map((p) => board.project(p.name));
}
export const commonFolder = (group) => path.join(ctx.home, 'comun', folderName(group, 'proyecto'));
// The group of a project: its sister projects (with their folders) and the shared folder; null if it is on its own.
export function groupOf(board, project) {
  const p = typeof project === 'string' ? board.project(project) : project;
  if (!p?.grupo) return null;
  const members = board.all('SELECT name, path FROM projects WHERE grupo = ? ORDER BY name', p.grupo);
  return { name: p.grupo, members, common: commonFolder(p.grupo) };
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
