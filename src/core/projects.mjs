// Projects live directly in the assistant's folder (D:\Orb\<proyecto>). The app creates them with git from the start
// (so every task can be undone and isolated copies are possible), and any folder the user creates there by hand shows up too.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from './context.mjs';
import { folderName, isReservedName } from './home.mjs';
import { git, ORB_GIT } from './workspace.mjs';

export function createProject(board, { name, notes = '' }, actor) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error(tr('msg.projects.needName'));
  if (board.project(clean)) throw new Error(tr('msg.projects.exists', { name: clean }));
  const dir = folderName(clean, 'proyecto');
  if (isReservedName(dir)) throw new Error(tr('msg.projects.reserved', { dir, name: ctx.config.assistantName }));
  const folder = path.join(ctx.paths.projects, dir);
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

// Keeps the project list in step with the assistant's folder: new subfolders become projects, and projects whose folder
// inside it was deleted are dropped (unless they still have open tasks). Linked outside folders are left alone.
export function syncProjects(board) {
  const home = ctx.paths.projects;
  let entries; try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { return false; }
  const norm = (p) => { try { return fs.realpathSync(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
  const registered = board.projects();
  const byPath = new Map(registered.map((p) => [norm(p.path), p]));
  let changed = false;
  for (const e of entries) {
    if (!e.isDirectory() || isReservedName(e.name)) continue;
    const folder = path.join(home, e.name);
    if (byPath.has(norm(folder))) continue;
    let name = e.name; let i = 2;
    while (board.project(name)) name = `${e.name} (${i++})`;
    try { board.addProject({ name, path: folder }, 'orb', { fromUser: true }); changed = true; } catch { /* unreadable folder: skipped */ }
  }
  for (const p of registered) {
    const rel = path.relative(home, p.path);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || fs.existsSync(p.path)) continue;
    try { board.removeProject(p.name, 'orb'); changed = true; } catch { /* open tasks: kept */ }
  }
  return changed;
}
