// 3.1: Orb.dev with the developer's control line on (ORB_DEV_CONTROL=1, see src/engine/dev-control.mjs), so it can be
// watched and driven from the terminal with scripts/orb-dev.mjs. Only for development: a build from the code (tauri dev);
// an installed Orb ignores it (src-tauri/src/lib.rs).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('npx', ['tauri', 'dev', ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ORB_DEV_CONTROL: '1' } });
child.on('exit', (code) => process.exit(code ?? 0));
