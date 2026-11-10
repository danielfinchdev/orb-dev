// 3.8: the workspace's folders seen from the window (src/domain/workspace/core-folder.mjs does the work):
//   - layoutPlan / layoutApply: the folders Orb 3.7 kept at the top (bitacora, android\adb-tools, mcp-servers\*) and,
//     3.8.1, the projects 3.8.0 made of MCP servers; what the user chose for each; nothing moves before layoutApply.
//   - guardOutside: what Orb keeps about the workspace outside it (the backups' folders, the copies of its sealed
//     secrets) is named to the guard (src/domain/security/guard.mjs), so agents leave it alone like core.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ctx } from '../platform/context.mjs';
import { planWorkspace, applyLayout } from '../domain/workspace/core-folder.mjs';
import { inside } from '../platform/fsx.mjs';
import { paths } from '../platform/paths.mjs';
import { loadConfig } from '../platform/config-file.mjs';
import { ensureLayout } from '../domain/workspace/home.mjs';
import { setGuardedRoots, setAppRoots } from '../domain/security/guard.mjs';
import { rebindMoved } from '../domain/security/connector-secrets.mjs';
import { rebindMovedOrWait } from './api/extensions.mjs';
import { backupRoot, backupDir } from '../domain/data/backup.mjs';

export function layoutPlan() {
  const { items, pending } = planWorkspace(ctx.home);
  return { home: ctx.home, pending, items: items.map(({ id, kind, name, project, choice, choices, kept }) => ({ id, kind, name, project, choice, choices, kept })) };
}

// choices: { [id]: choice }. Throws a user-facing error (code 'busy', nothing moved) when a folder is in use. → the plan
// as it is now, with logsMoved ({ dir, files }) when the logs went into core and serversMoved ([{ from, to }]) for the MCP
// servers that moved: the window says once where they are now.
export async function layoutApply(choices, { emit = () => {}, log = () => {}, board = null } = {}) {
  const clean = {};
  if (choices && typeof choices === 'object' && !Array.isArray(choices)) {
    for (const [k, v] of Object.entries(choices).slice(0, 200)) if (typeof v === 'string' && k.length <= 300 && v.length <= 40) clean[k] = v;
  }
  const before = ctx.config?.mcpServers ?? [];
  const r = applyLayout(ctx.home, clean, { language: ctx.config?.language ?? 'es' });
  // Where the logs and the Android tools are now, and the paths orb.json had into what moved (3.8.1: a server Orb moved
  // into core\mcp keeps its keys, tied now to its new path).
  ctx.paths = paths(ctx.home); ctx.config = loadConfig(ctx.home);
  // With the vault locked, the keys wait for it to open (a notice says so), never lost silently.
  if (board) rebindMovedOrWait(board, before, ctx.config.mcpServers ?? []); else rebindMoved(ctx.master, before, ctx.config.mcpServers ?? []);
  ensureLayout(ctx.home, ctx.config);
  if (r) { log(`carpetas: movidas ${r.moved.join(', ')}`); emit('config:changed', ctx.config); }
  return { ...layoutPlan(), logsMoved: r?.logs ?? null, serversMoved: r?.servers ?? [] };
}

// 3.8.1: the owner's private folder (notes, plans): kept from the agents like core.
export const PRIVATE_DIR = 'personal';
export const privateDir = (home) => path.join(home, PRIVATE_DIR);
// Where adb keeps the keys it pairs phones with and the phones it knows: the user's .android folder and an
// ANDROID_USER_HOME, whole (3.8.2 review M2). Orb's own adb uses one inside core\datos (src/engine/host/android.mjs).
export const adbHomes = () => [...new Set([path.join(os.homedir(), '.android'), process.env.ANDROID_USER_HOME].filter((d) => d && path.isAbsolute(d)))];
let keys = null; // the folder of the app's copies of the sealed secrets, when the app gives it
export function guardOutside({ mirror } = {}) {
  if (typeof mirror === 'string' && path.isAbsolute(mirror)) keys = path.dirname(mirror);
  // 3.8: and the app's «Local State» next to that folder (it holds the key Windows seals Orb's secret with), when the
  // copy is where the app keeps it (<app data>\claves\…).
  const state = keys && path.basename(keys) === 'claves' ? path.join(path.dirname(keys), 'Local State') : null;
  // Never one that holds the workspace itself (that would shut the agents out of their projects).
  // 3.8.1 (owner's decision 19 g): and the owner's private folder at the top of the workspace (<workspace>\personal),
  // which no agent may read or touch (it is not a project).
  // 3.8.2: and adb's folders (its private key: with it any program could reach a paired phone by itself).
  setGuardedRoots([...[backupRoot(), backupDir(ctx.home, ctx.config), keys, state].filter((d) => d && !inside(d, ctx.home)), privateDir(ctx.home), ...adbHomes()]);
  // 3.8.1: and the folder Orb is installed in (writable by the user under a per-user install): agents may read it only.
  // 3.8.2 (review A2): so is Orb's adb when it lives outside core (an android\adb-tools kept at the top of the workspace).
  const app = appInstallDir();
  setAppRoots([...(app && !inside(app, ctx.home) ? [app] : []), ctx.paths.adb]);
}

// The folder of an installed Orb (Orb.exe with node\node.exe and app\ beside it: ORB_NODE, set by the app). Not a build of
// the code (a cargo target folder or the repository: agents may work on Orb itself).
export function appInstallDir(env = process.env) {
  const node = env.ORB_NODE;
  if (typeof node === 'string' && path.isAbsolute(node) && path.basename(path.dirname(node)).toLowerCase() === 'node') {
    const dir = path.dirname(path.dirname(node));
    if (fs.existsSync(path.join(dir, 'app')) && !/[\\/]target[\\/]/i.test(dir)) return dir;
  }
  return null;
}
