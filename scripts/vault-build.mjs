// Builds the tests' copy of the vault (src-tauri/vault, the orb-vault binary) before `npm test`: the engine's secrets
// live in Rust (src/domain/security/master.mjs starts it when no app runs the engine). cargo from PATH, or from CARGO_HOME
// (C:\orb-project\herramientas\cargo on the owner's PC). Quick when nothing changed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const homes = [process.env.CARGO_HOME, path.join(os.homedir(), '.cargo')].filter(Boolean).map((h) => path.join(h, 'bin', exe));
const onPath = spawnSync(exe, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0;
const cargo = onPath ? exe : homes.find((p) => fs.existsSync(p));
if (!cargo) { console.error('vault-build: no se encuentra cargo (instala Rust o fija CARGO_HOME)'); process.exit(1); }
const r = spawnSync(cargo, ['build', '--release', '--locked', '-p', 'orb-vault', '--bin', 'orb-vault', '--quiet'], { cwd: path.join(ROOT, 'src-tauri'), stdio: 'inherit', windowsHide: true });
process.exit(r.status ?? 1);
