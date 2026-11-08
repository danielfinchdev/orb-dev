// The Tauri builds that must never be mixed up (review D4 B4):
//   node scripts/tauri-check-release.mjs              after `tauri build`: the release Orb.exe must not be a test build
//                                                     (no DevTools port, hidden window, local update feed or timing marks: their names are not in it;
//                                                     nor the test updater key) and trusts the updater key of tauri.conf.json;
//   node scripts/tauri-check-release.mjs --build-e2e  the test build (cargo feature e2e), in a target folder of its own
//                                                     (src-tauri/target-e2e), so target/release never holds one; its
//                                                     updater also accepts a local http feed and trusts only the test key.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKS = ['ORB_E2E_CDP_PORT', 'ORB_HIDDEN_WINDOW', 'ORB_UPDATE_URL', 'ORB_TRACE'];
const TEST_PUBKEY = () => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'actualizador-prueba.key.pub'), 'utf8').trim();

if (process.argv.includes('--build-e2e')) {
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(ROOT, 'src-tauri', 'target-e2e') };
  // Its updater may also read a local feed over plain http (ORB_UPDATE_URL, http://127.0.0.1 only: updater.rs); the
  // release build never can.
  const conf = path.join(env.CARGO_TARGET_DIR, 'e2e.conf.json');
  fs.mkdirSync(env.CARGO_TARGET_DIR, { recursive: true });
  // And it trusts only the TEST key (test/fixtures/actualizador-prueba.key), never Orb's: what the tests sign is never
  // valid for a real Orb (review D9 M2).
  fs.writeFileSync(conf, JSON.stringify({ plugins: { updater: { dangerousInsecureTransportProtocol: true, pubkey: TEST_PUBKEY() } } }));
  const r = spawnSync('npx', ['tauri', 'build', '--features', 'e2e', '--no-bundle', '--config', `"${conf}"`], { cwd: ROOT, env, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}

// What makes an Orb.exe unfit to publish: the test build's names, the test updater key, or not trusting the updater key
// in src-tauri/tauri.conf.json (an old build from before a key rotation). Also used on the installer CI built
// (scripts/release-firmar.mjs, review D10 M2).
export function releaseProblems(bytes, pubkey = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater.pubkey) {
  const found = MARKS.filter((m) => bytes.includes(Buffer.from(m)));
  if (bytes.includes(Buffer.from(TEST_PUBKEY()))) found.push('la clave pública de PRUEBA');
  if (!bytes.includes(Buffer.from(pubkey))) found.push('sin la clave pública del actualizador de tauri.conf.json');
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const exe = path.join(ROOT, 'src-tauri', 'target', 'release', 'Orb.exe');
  if (!fs.existsSync(exe)) { console.error(`no existe ${exe}`); process.exit(2); }
  const found = releaseProblems(fs.readFileSync(exe));
  if (found.length) { console.error(`${exe} no se publica (${found.join(', ')})`); process.exit(1); }
  console.log(`${path.relative(ROOT, exe)}: build normal (sin ${MARKS.join(' ni ')}) con la clave del actualizador de tauri.conf.json`);
}
