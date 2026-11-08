// The Tauri builds that must never be mixed up (review D4 B4):
//   node scripts/tauri-check-release.mjs              after `tauri build`: the release Orb.exe must not be a test build
//                                                     (no DevTools port, hidden window, local update feed or timing marks: their names are not in it);
//   node scripts/tauri-check-release.mjs --build-e2e  the test build (cargo feature e2e), in a target folder of its own
//                                                     (src-tauri/target-e2e), so target/release never holds one; its
//                                                     updater also accepts a local http feed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKS = ['ORB_E2E_CDP_PORT', 'ORB_HIDDEN_WINDOW', 'ORB_UPDATE_URL', 'ORB_TRACE'];

if (process.argv.includes('--build-e2e')) {
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(ROOT, 'src-tauri', 'target-e2e') };
  // Its updater may also read a local feed over plain http (ORB_UPDATE_URL, http://127.0.0.1 only: updater.rs); the
  // release build never can.
  const conf = path.join(env.CARGO_TARGET_DIR, 'e2e.conf.json');
  fs.mkdirSync(env.CARGO_TARGET_DIR, { recursive: true });
  fs.writeFileSync(conf, JSON.stringify({ plugins: { updater: { dangerousInsecureTransportProtocol: true } } }));
  const r = spawnSync('npx', ['tauri', 'build', '--features', 'e2e', '--no-bundle', '--config', `"${conf}"`], { cwd: ROOT, env, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}

const exe = path.join(ROOT, 'src-tauri', 'target', 'release', 'Orb.exe');
if (!fs.existsSync(exe)) { console.error(`no existe ${exe}`); process.exit(2); }
const bytes = fs.readFileSync(exe);
const found = MARKS.filter((m) => bytes.includes(Buffer.from(m)));
if (found.length) { console.error(`${exe} es una build de pruebas (${found.join(', ')}): no se publica`); process.exit(1); }
console.log(`${path.relative(ROOT, exe)}: build normal (sin ${MARKS.join(' ni ')})`);
