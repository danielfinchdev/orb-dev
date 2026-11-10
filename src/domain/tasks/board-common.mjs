// Small helpers the board's files share.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { AGENT_IDS } from '../../platform/config-file.mjs';
import { isConfigName, categoryOf, CATEGORIES } from '../../platform/paths.mjs';
import { PRODUCT } from '../../shared/product.mjs';

// 3.8.2: the largest BITACORA.md a project folder may bring into its log (mergeRootLog).
export const ROOT_LOG_MAX = 4 * 1024 * 1024;
export const now = () => new Date().toISOString();
// A conversation's row as the rest of Orb reads it (titled as a boolean, its context meter parsed).
// 3.8.1: both change the row SQLite just made (a new object each time) instead of copying it: copying the ~35 columns
// of every task of the lists cost more than the query.
export const conversationRow = (r) => {
  let context = null; try { context = r.context ? JSON.parse(r.context) : null; } catch { /* none */ }
  r.titled = Boolean(r.titled); r.context = context;
  return r;
};
export const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(String(p)); } };
// Equal strings need no disk access (revalidateQueued compares every queued task's folder on each tick).
export const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase() || real(a).toLowerCase() === real(b).toLowerCase();

export const AGENTS = AGENT_IDS;
export const assistantName = () => ctx.config?.assistantName?.trim() || PRODUCT.assistant;
export const inside = (root, p) => { const rel = path.relative(root, p); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
// Projects live in the categories of the workspace (each subfolder of windows, linux, ios, android, web or multi is one). Agents (MCP) may only register folders there or in the
// extra roots of the settings; the user can also link any outside folder from the app (fromUser). Never a drive root, the
// workspace itself, Orb's own folders (core, and the ones of older versions), a category folder itself (inside the
// folder a project is always <category>\<project>) or a folder that contains the assistant's.
export function checkProjectPath(target, { fromUser = false } = {}) {
  let r; try { r = fs.realpathSync(target); } catch { throw new Error(tr('msg.board.pathMissing', { target })); }
  if (!fs.statSync(r).isDirectory()) throw new Error(tr('msg.board.pathNotFolder', { target }));
  if (path.parse(r).root.toLowerCase() === r.toLowerCase()) throw new Error(tr('msg.board.driveRoot'));
  const home = real(ctx.home);
  if (same(r, home)) throw new Error(tr('msg.board.isHome', { name: assistantName() }));
  if (inside(r, home)) throw new Error(tr('msg.board.containsHome', { name: assistantName() }));
  if (inside(home, r)) {
    const first = path.relative(home, r).split(path.sep)[0];
    if (isConfigName(first)) throw new Error(tr('msg.board.internalFolder', { name: assistantName(), first }));
    if (!categoryOf(home, r)) throw new Error(tr('msg.board.notInCategory', { name: assistantName(), list: CATEGORIES.join(', '), target }));
  } else if (!fromUser) {
    const roots = [home, ...(ctx.config.projectRoots ?? []).map(real)];
    if (!roots.some((root) => inside(root, r))) throw new Error(tr('sys.board.outside', { name: assistantName(), home, target, user: userName() }));
  }
  return r;
}

export const userName = () => ctx.config?.userName?.trim() || 'el usuario';
