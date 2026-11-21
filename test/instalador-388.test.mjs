// The new installer face (src-tauri/installer) is only a face: the NSIS setup stays the one `tauri build` makes. These
// checks read files as text; the Rust side has its own tests (cargo test --offline --features fake-setup in that folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, outputName, dependsOnVcRuntime } from '../scripts/installer-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const UI = path.join(ROOT, 'src-tauri', 'installer', 'ui');

test('Tauri still builds only the NSIS setup, with its hooks, and the updater is untouched', () => {
  const conf = JSON.parse(read('src-tauri', 'tauri.conf.json'));
  assert.deepEqual(conf.bundle.targets, ['nsis']);
  assert.equal(conf.bundle.windows.nsis.installerHooks, 'nsis/hooks.nsh');
  assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(conf.plugins.updater.windows.installMode, 'passive');
  assert.match(conf.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
});

test('the face is a crate of its own, outside the app workspace', () => {
  const toml = read('src-tauri', 'installer', 'Cargo.toml');
  assert.match(toml, /^\[workspace\]$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'src-tauri', 'installer', 'Cargo.lock')));
  assert.doesNotMatch(read('src-tauri', 'Cargo.toml'), /members\s*=\s*\[[^\]]*installer/);
  assert.match(read('.gitignore'), /^src-tauri\/installer\/target\/$/m);
});

test('outside test mode the build script requires the setup', () => {
  assert.throws(() => parseArgs([]), /--setup/);
  assert.throws(() => parseArgs(['--sig', 'x.sig']), /--setup/);
  assert.throws(() => parseArgs(['--setup', 'a.exe']), /--sig/, 'a real installer is always signed');
  assert.throws(() => parseArgs(['--prueba', '--setup', 'x.exe']), /--prueba/);
  assert.deepEqual(parseArgs(['--prueba']), { test: true, setup: undefined, sig: undefined });
  assert.deepEqual(parseArgs(['--setup', 'a.exe', '--sig', 'a.sig']), { test: false, setup: 'a.exe', sig: 'a.sig' });
  const script = read('scripts', 'installer-build.mjs');
  assert.match(script, /'--locked', '--offline'/);
  assert.match(script, /delete env\.ORB_VERSION/);
  assert.match(read('src-tauri', 'installer', 'build.rs'), /panic!\("ORB_SETUP needs ORB_SETUP_SIG/);
  assert.equal(outputName('3.8.8'), 'Orb-3.8.8-instalador-nuevo.exe');
  assert.equal(outputName('3.8.8', true), 'Orb-3.8.8-instalador-nuevo-PRUEBA.exe', 'the test binary has another name');
  assert.match(read('package.json'), /"installer:build": "node scripts\/installer-build\.mjs"/);
});

test('the interface loads nothing remote and keeps a strict policy', () => {
  const files = fs.readdirSync(UI, { recursive: true }).filter((f) => /\.(html|css|js)$/.test(String(f)));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const text = fs.readFileSync(path.join(UI, String(f)), 'utf8');
    assert.doesNotMatch(text, /https?:\/\//i, `${f} names a remote address`);
    assert.doesNotMatch(text, /\/\/cdn|unpkg|googleapis|jsdelivr|@import/i, `${f} loads from a CDN`);
    assert.doesNotMatch(text, /url\((?!["']?(fonts\/|data:))/i, `${f} has a url() that is not a local font`);
  }
  const html = read('src-tauri', 'installer', 'ui', 'index.html');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, 'no inline script');
  assert.doesNotMatch(html, /\sstyle=|<style/, 'no inline style');
  assert.doesNotMatch(fs.readFileSync(path.join(UI, 'app.js'), 'utf8'), /\beval\(|new Function|\bfetch\(|XMLHttpRequest|WebSocket/);
});

test('every text exists in Spanish and English with the same keys', () => {
  const sandbox = { window: {} };
  new Function('window', read('src-tauri', 'installer', 'ui', 'i18n.js'))(sandbox.window);
  const { es, en } = sandbox.window.ORB_TEXTS;
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(es), keys(en));
  for (const reason of ['abierto', 'otro', 'elevado', 'carpeta', 'desinstalador']) assert.ok(es.err[reason] && en.err[reason], reason);
});

test('the refusal reasons of hooks.nsh are the ones the face knows', () => {
  const hooks = read('src-tauri', 'nsis', 'hooks.nsh');
  const used = [...hooks.matchAll(/!insertmacro OrbRefuse ".*" "(\w+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 5);
  const rust = read('src-tauri', 'installer', 'src', 'nsis.rs');
  for (const reason of new Set(used)) assert.match(rust, new RegExp(`"${reason}" =>`), `nsis.rs does not know «${reason}»`);
  assert.match(hooks, /SetErrorLevel 2/);
});

test('the face never asks for elevation, never passes /R and only starts a setup through the checked path', () => {
  const rust = read('src-tauri', 'installer', 'src', 'nsis.rs');
  assert.doesNotMatch(rust.replace(/#\[cfg\(test\)\][\s\S]*$/, '').replace(/\/\/.*$/gm, ''),/"\/R"|\/UPDATE|runas/i);
  assert.match(read('src-tauri', 'installer', 'manifest.xml'), /level="asInvoker"/);
  const setup = read('src-tauri', 'installer', 'src', 'setup.rs');
  assert.match(setup, /pub fn run\(&self, _token: &RealToken/);
  assert.match(setup, /share_mode\(SHARE_READ\)/);
  // the only place a process is started is Staged::run (the window opens the installed Orb, which is another program)
  const lib = ['setup.rs', 'run.rs', 'window.rs', 'procs.rs', 'nsis.rs'].map((f) => read('src-tauri', 'installer', 'src', f).replace(/#\[cfg\(test\)\][\s\S]*$/, ''));
  assert.equal(lib.join('\n').match(/Command::new/g).length, 2, 'Command::new only in Staged::run and launch_installed');
});

test('the face refuses odd folders, escapes once, keeps the page alive and closes the DLL and browser loopholes', () => {
  const js = read('src-tauri', 'installer', 'ui', 'app.js');
  // a refused folder brings the page back to «Where to install»; the installing screen only comes up on 'started'
  assert.match(js, /m\.kind === 'dir'[^\n]*state\.screen = 'donde'/);
  assert.match(js, /case 'started':/);
  assert.match(js, /case 'restore':/);
  assert.doesNotMatch(js, /\(k in vars \? esc\(/, 'fill() must not escape: the result is escaped once when drawn');
  assert.match(js, /'r', 'p', 'f', 's'/);
  assert.match(js, /contextmenu/);
  const win = read('src-tauri', 'installer', 'src', 'window.rs');
  assert.match(win, /"kind": "dir"/);
  assert.match(win, /with_browser_accelerator_keys\(false\)/);
  assert.match(win, /guard::is_own_url/);
  assert.doesNotMatch(win, /starts_with\(ORIGIN\)/);
  assert.match(win, /scrub_webview2_env/);
  assert.match(win, /classic_and_exit/);
  assert.match(read('src-tauri', 'installer', 'build.rs'), /DEPENDENTLOADFLAG:0x800/);
  assert.match(read('src-tauri', 'installer', 'src', 'main.rs'), /SetDefaultDllDirectories\(LOAD_LIBRARY_SEARCH_SYSTEM32\)/);
  assert.match(read('src-tauri', 'installer', 'src', 'setup.rs'), /D:PAI\(A;OICI;FA;;;OW\)/);
  const nsis = read('src-tauri', 'installer', 'src', 'nsis.rs');
  assert.match(nsis, /Uninstall Orb\.exe/);
  assert.match(nsis, /p\.join\("uninstall\.exe"\)/);
  const i18n = read('src-tauri', 'installer', 'ui', 'i18n.js');
  assert.match(i18n, /dirElectron: 'Esa es la carpeta de Orb 3\.8\.0/);
  assert.match(i18n, /MODO DE PRUEBA/);
});

test('the C runtime is linked in and the built program does not need VCRUNTIME140', () => {
  assert.match(read('src-tauri', 'installer', '.cargo', 'config.toml'), /target-feature=\+crt-static/);
  assert.equal(dependsOnVcRuntime(Buffer.from('xx VCRUNTIME140.dll xx')), true);
  assert.equal(dependsOnVcRuntime(Buffer.from('nothing here')), false);
  // when a program has been built here, it must be clean (the build script refuses it too)
  const exe = path.join(ROOT, 'src-tauri', 'installer', 'target', 'release', 'orb-instalador.exe');
  if (fs.existsSync(exe)) assert.equal(dependsOnVcRuntime(fs.readFileSync(exe)), false);
});

test('a runtime that never lets the page start falls back to the classic installer, and a stuck setup can be left alone', () => {
  const win = read('src-tauri', 'installer', 'src', 'window.rs');
  assert.match(win, /READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs\(15\)/);
  assert.match(win, /STUCK_AFTER: std::time::Duration = std::time::Duration::from_secs\(600\)/);
  assert.match(win, /Mode::Real\(token\) => run::classic_and_exit\(token\)/);
  assert.match(read('src-tauri', 'installer', 'src', 'guard.rs'), /WEBVIEW2_PREFIX: &str = "WEBVIEW2_"/);
  const js = read('src-tauri', 'installer', 'ui', 'app.js');
  assert.match(js, /case 'stuck':/);
  assert.match(js, /t\.closeThis/);
});

test('English texts use English quotes and Spanish ones keep the guillemets', () => {
  const sandbox = { window: {} };
  new Function('window', read('src-tauri', 'installer', 'ui', 'i18n.js'))(sandbox.window);
  const { es, en } = sandbox.window.ORB_TEXTS;
  const strings = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : typeof v === 'object' ? strings(v) : []));
  for (const s of strings(en)) assert.doesNotMatch(s, /[«»]/, `English text with guillemets: ${s}`);
  assert.ok(strings(es).some((s) => /«.+»/.test(s)));
});
