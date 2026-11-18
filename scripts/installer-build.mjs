// Builds Orb's new installer face (src-tauri/installer): a small WebView2 program that shows the installer's screens and
// runs, in silent mode, the NSIS setup that `tauri build` makes, which travels inside it.
//   npm run installer:build -- --prueba                       a test binary with NO setup inside (it can install nothing)
//   npm run installer:build -- --setup <Orb_x.y.z_x64-setup.exe> --sig <Orb_x.y.z_x64-setup.exe.sig>
// A real installer always carries the updater key's signature of its setup (the build stops if it does not match).
// The result is src-tauri/installer/target/release/Orb-<version>-instalador-nuevo.exe (the test binary: ...-instalador-nuevo-PRUEBA.exe). Nothing is signed or published here.
// Cargo runs offline: every crate is already in the app's lock. Compiling Rust is a heavy job; take the PC's heavy turn first.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(ROOT, 'src-tauri', 'installer');

// The command line, checked: outside test mode the setup is required.
export function parseArgs(argv) {
  const value = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const test = argv.includes('--prueba');
  const setup = value('setup');
  const sig = value('sig');
  if (test && (setup || sig)) throw new Error('--prueba no lleva instalador dentro: quita --setup y --sig');
  if (!test && !setup) throw new Error('falta --setup <Orb_x.y.z_x64-setup.exe> (o --prueba para el binario sin instalador)');
  if (!test && !sig) throw new Error('falta --sig <Orb_x.y.z_x64-setup.exe.sig>: un instalador de verdad va siempre firmado');
  if (sig && !setup) throw new Error('--sig necesita --setup');
  return { test, setup, sig };
}

export function outputName(version, test = false) {
  return `Orb-${version}-instalador-nuevo${test ? '-PRUEBA' : ''}.exe`;
}

// The program must not need the Visual C++ runtime DLL (the C runtime is linked in: .cargo/config.toml), or a PC without it
// would never reach main() and the classic installer could not take over.
export function dependsOnVcRuntime(buffer) {
  return buffer.includes(Buffer.from('VCRUNTIME140', 'latin1')) || buffer.includes(Buffer.from('VCRUNTIME140', 'utf16le'));
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`✖ ${e.message}`); process.exit(2); }
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const env = {
    ...process.env,
    CARGO_HOME: process.env.CARGO_HOME || 'C:\\orb-project\\herramientas\\cargo',
    RUSTUP_HOME: process.env.RUSTUP_HOME || 'C:\\orb-project\\herramientas\\rustup',
  };
  delete env.ORB_SETUP;
  delete env.ORB_SETUP_SIG;
  delete env.ORB_VERSION; // the version is package.json's, never an inherited variable
  if (!opts.test) {
    const setup = path.resolve(opts.setup);
    if (!fs.existsSync(setup)) { console.error(`✖ no existe ${setup}`); process.exit(1); }
    if (!path.basename(setup).includes(version)) { console.error(`✖ ${path.basename(setup)} no es el instalador de la ${version}`); process.exit(1); }
    env.ORB_SETUP = setup;
    const sig = path.resolve(opts.sig);
    if (!fs.existsSync(sig)) { console.error(`✖ no existe ${sig}`); process.exit(1); }
    env.ORB_SETUP_SIG = sig;
  }
  console.log(opts.test ? 'binario de prueba (sin instalador dentro)' : `instalador dentro: ${env.ORB_SETUP}`);
  execFileSync('cargo', ['build', '--release', '--locked', '--offline', '--manifest-path', path.join(CRATE, 'Cargo.toml')], { cwd: CRATE, env, stdio: 'inherit' });
  const built = path.join(CRATE, 'target', 'release', 'orb-instalador.exe');
  if (dependsOnVcRuntime(fs.readFileSync(built))) { console.error('✖ el programa depende de VCRUNTIME140.dll: revisa .cargo/config.toml (crt-static)'); process.exit(1); }
  const out = path.join(CRATE, 'target', 'release', outputName(version, opts.test));
  fs.copyFileSync(built, out);
  console.log(`${out} (${fs.statSync(out).size} bytes)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
