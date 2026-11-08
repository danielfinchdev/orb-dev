// The Android app's page (src-tauri/tauri.android.conf.json › beforeBuildCommand, so `tauri android build` runs it):
//   1. the notifications' picture (gen/android/app/src/main/res/drawable-nodpi/av_orb.png, git-ignored: a copy of the
//      app's icon, since a notification shows only the app's own resources),
//   2. the interface in the app's mode (vite build --mode android → src/renderer-android, the app's frontendDist).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

const nodpi = path.join(RES, 'drawable-nodpi');
fs.mkdirSync(nodpi, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src', 'ui', 'public', 'icon.png'), path.join(nodpi, 'av_orb.png'));

const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'android', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
process.exit(r.status ?? 1);
