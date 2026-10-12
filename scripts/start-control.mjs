// 3.1: Orb.dev with the developer's control line on (ORB_DEV_CONTROL=1, see src/engine/dev-control.mjs), so it can be
// watched and driven from the terminal with scripts/orb-dev.mjs. Only for development: an installed Orb ignores it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = (await import('electron')).default;
const child = spawn(electron, [ROOT, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ORB_DEV_CONTROL: '1' } });
child.on('exit', (code) => process.exit(code ?? 0));
