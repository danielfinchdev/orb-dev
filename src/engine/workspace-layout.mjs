// 3.8: the workspace's folders seen from the window (src/core/core-folder.mjs does the work):
//   - layoutPlan / layoutApply: the folders Orb 3.7 kept at the top (bitacora, android\adb-tools, mcp-servers\*) and
//     what the user chose for each; nothing moves before layoutApply.
//   - guardOutside: what Orb keeps about the workspace outside it (the backups' folders, the copies of its sealed
//     secrets) is named to the guard (src/core/guard.mjs), so agents leave it alone like core.
import path from 'node:path';
import { ctx } from '../core/context.mjs';
import { planWorkspace, applyLayout, inside } from '../core/core-folder.mjs';
import { paths, loadConfig, ensureLayout } from '../core/home.mjs';
import { setGuardedRoots } from '../core/guard.mjs';
import { backupRoot, backupDir } from '../core/backup.mjs';

export function layoutPlan() {
  const { items, pending } = planWorkspace(ctx.home);
  return { home: ctx.home, pending, items: items.map(({ id, kind, name, project, choice, choices, kept }) => ({ id, kind, name, project, choice, choices, kept })) };
}

// choices: { [id]: choice }. Throws a user-facing error (code 'busy', nothing moved) when a folder is in use. → the plan
// as it is now, with logsMoved ({ dir, files }) when the logs went into core: the window says once where they are now.
export async function layoutApply(choices, { emit = () => {}, log = () => {} } = {}) {
  const clean = {};
  if (choices && typeof choices === 'object' && !Array.isArray(choices)) {
    for (const [k, v] of Object.entries(choices).slice(0, 200)) if (typeof v === 'string' && k.length <= 300 && v.length <= 40) clean[k] = v;
  }
  const r = applyLayout(ctx.home, clean, { language: ctx.config?.language ?? 'es' });
  // Where the logs and the Android tools are now, and the paths orb.json had into what moved.
  ctx.paths = paths(ctx.home); ctx.config = loadConfig(ctx.home);
  ensureLayout(ctx.home, ctx.config);
  const { addAdbToPath } = await import('./android.mjs');
  addAdbToPath();
  if (r) { log(`carpetas: movidas ${r.moved.join(', ')}`); emit('config:changed', ctx.config); }
  return { ...layoutPlan(), logsMoved: r?.logs ?? null };
}

let keys = null; // the folder of the app's copies of the sealed secrets (main.mjs), when the app gives it
export function guardOutside({ mirror } = {}) {
  if (typeof mirror === 'string' && path.isAbsolute(mirror)) keys = path.dirname(mirror);
  // 3.8: and the app's «Local State» next to that folder (it holds the key Windows seals Orb's secret with), when the
  // copy is where the app keeps it (<app data>\claves\…).
  const state = keys && path.basename(keys) === 'claves' ? path.join(path.dirname(keys), 'Local State') : null;
  // Never one that holds the workspace itself (that would shut the agents out of their projects).
  setGuardedRoots([backupRoot(), backupDir(ctx.home, ctx.config), keys, state].filter((d) => d && !inside(d, ctx.home)));
}
