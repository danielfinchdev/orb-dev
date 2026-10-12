// 3.2: each project's icon for the sidebar and the conversations: one the user chose, else the project's own (its favicon
// or app icon, found in its folder), else none (the window draws a badge with its initials in a colour of its own).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../core/context.mjs';
import { folderName } from '../core/home.mjs';

const MAX_BYTES = 512 * 1024;
const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
// Where web, desktop and mobile projects usually keep theirs, the most specific first.
const CANDIDATES = [
  'favicon.svg', 'favicon.png', 'favicon.ico',
  'public/favicon.svg', 'public/favicon.png', 'public/favicon.ico', 'public/icon.svg', 'public/icon.png', 'public/logo.svg', 'public/logo.png',
  'static/favicon.svg', 'static/favicon.png', 'static/favicon.ico',
  'src/favicon.svg', 'src/favicon.png', 'src/favicon.ico', 'src/app/icon.svg', 'src/app/icon.png', 'src/app/favicon.ico',
  'app/icon.svg', 'app/icon.png', 'app/favicon.ico', 'assets/icon.png', 'assets/images/icon.png', 'assets/logo.png',
  'icon.svg', 'icon.png', 'logo.svg', 'logo.png', 'build/icon.png', 'resources/icon.png',
  'src-tauri/icons/128x128.png', 'src-tauri/icons/icon.png',
  'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'
];

const ownDir = () => path.join(ctx.paths.internal, 'iconos');
const ownFiles = (name) => Object.keys(TYPES).map((ext) => path.join(ownDir(), `${folderName(name, 'proyecto')}${ext}`));
const cache = new Map(); // file -> { mtime, dataUrl }

function readIcon(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) return null;
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.dataUrl;
  const type = TYPES[path.extname(file).toLowerCase()]; if (!type) return null;
  const dataUrl = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  cache.set(file, { mtime: st.mtimeMs, dataUrl });
  return dataUrl;
}

// The icon of a project as a data URL (or null). The one chosen in Orb wins over the project's own.
export function projectIcon(project) {
  if (!project) return null;
  for (const f of ownFiles(project.name)) { const d = readIcon(f); if (d) return d; }
  if (!project.path) return null;
  for (const rel of CANDIDATES) { const d = readIcon(path.join(project.path, rel)); if (d) return d; }
  return null;
}

// An image the user picked becomes the project's icon (a copy inside Orb's folder: the project is not touched).
export function setProjectIcon(project, file) {
  const ext = path.extname(String(file ?? '')).toLowerCase();
  let st; try { st = fs.statSync(file); } catch { st = null; }
  if (!TYPES[ext] || !st?.isFile()) throw new Error(tr('msg.api.badImage'));
  if (st.size > MAX_BYTES) throw new Error(tr('msg.api.iconTooBig', { kb: Math.round(MAX_BYTES / 1024) }));
  clearProjectIcon(project);
  fs.mkdirSync(ownDir(), { recursive: true });
  fs.copyFileSync(file, path.join(ownDir(), `${folderName(project.name, 'proyecto')}${ext}`));
  return projectIcon(project);
}

export function clearProjectIcon(project) {
  for (const f of ownFiles(project.name)) { try { fs.rmSync(f, { force: true }); cache.delete(f); } catch { /* not there */ } }
  return projectIcon(project);
}
