// 3.8.1: builds the Android app «Orb» (Tauri 2, src-tauri/gen/android) into dist/Orb-<version>-android.apk:
//   1. `tauri android build --apk --target aarch64` (its beforeBuildCommand, scripts/android-web.mjs, builds the page in
//      the app's mode), signed with Orb's release key (--debug: a debug build, signed with the SDK's debug key);
//   2. checks the APK: package dev.orb.app, versionCode = major·1 000 000 + minor·1000 + patch (Tauri's; 3.8.0 was 30800),
//      and, for a release, that its certificate is the one every Orb for Android has had (or Android refuses to update).
// Everything with the portable JDK 21, Android SDK and NDK of the build cache (ORB_BUILD_CACHE, by default
// %LOCALAPPDATA%\orb-build-cache; docs/ANDROID.md says how to get them) and the Rust toolchain of the PATH (or
// RUSTUP_HOME / CARGO_HOME), set for these processes only: nothing installed and no window opened.
// The release key is never made here: without orb-build-cache\keys\orb-release.jks (and .pass) the build stops.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const CACHE = process.env.ORB_BUILD_CACHE || (IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'orb-build-cache') : path.join(os.homedir(), '.cache', 'orb-build-cache'));
const debug = process.argv.includes('--debug');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const [maj, min, pat] = version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
const VERSION_CODE = maj * 1_000_000 + min * 1000 + pat;
// The SHA-256 of the certificate of orb-build-cache\keys\orb-release.jks, which signed Orb 3.5 to 3.8.0 for Android.
const RELEASE_CERT_SHA256 = 'ccd0fffa7be7eaf551b76fd8803bb19d63af31bbf1274c1e9b7d7537c0ae6f00';

const JAVA_HOME = process.env.ORB_JAVA_HOME || path.join(CACHE, 'jdk21');
const SDK = process.env.ORB_ANDROID_SDK || path.join(CACHE, 'sdk');
const exe = (p) => (IS_WIN ? `${p}.exe` : p);
const newest = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^\d/.test(x)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop() : null);
const NDK = process.env.NDK_HOME || (newest(path.join(SDK, 'ndk')) ? path.join(SDK, 'ndk', newest(path.join(SDK, 'ndk'))) : '');
const BUILD_TOOLS = newest(path.join(SDK, 'build-tools')) ? path.join(SDK, 'build-tools', newest(path.join(SDK, 'build-tools'))) : '';
const fail = (msg) => { console.error(msg); process.exit(1); };
for (const [what, file] of [['JDK 21', path.join(JAVA_HOME, 'bin', exe('java'))], ['Android SDK', path.join(SDK, 'platforms')], ['Android NDK', NDK], ['Android build-tools', BUILD_TOOLS]]) {
  if (!file || !fs.existsSync(file)) fail(`Falta el ${what} en ${file || path.join(SDK, '…')}. Mira docs/ANDROID.md («Building the app»).`);
}
const env = {
  ...process.env, JAVA_HOME, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, NDK_HOME: NDK, GRADLE_USER_HOME: path.join(CACHE, 'gradle'),
  // One Gradle for this build, gone when it ends (no daemon left behind).
  GRADLE_OPTS: [process.env.GRADLE_OPTS, '-Dorg.gradle.daemon=false'].filter(Boolean).join(' '),
  PATH: [path.join(JAVA_HOME, 'bin'), process.env.PATH].join(path.delimiter)
};

const run = (cmd, args, extra = {}) => new Promise((resolve, reject) => {
  console.log(`> ${[path.basename(cmd), ...args].join(' ')}`);
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...env, ...extra }, stdio: 'inherit', windowsHide: true });
  p.on('error', reject);
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminó con el código ${code}`))));
});
// apksigner and aapt2 of the SDK (.bat files only run through cmd on Windows; windowsHide: no console window ever).
const tool = (name, args) => {
  const file = path.join(BUILD_TOOLS, IS_WIN ? (name === 'apksigner' ? 'apksigner.bat' : `${name}.exe`) : name);
  const r = IS_WIN && file.endsWith('.bat')
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}"`], { env, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(file, args, { env, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr || r.stdout}`);
  return r.stdout;
};

// The key every Orb for Android is signed with: made once (Orb 3.5) and kept in the build cache, never in the repository.
function signingKey() {
  const store = path.join(CACHE, 'keys', 'orb-release.jks'); const passFile = path.join(CACHE, 'keys', 'orb-release.pass');
  if (!fs.existsSync(store) || !fs.existsSync(passFile)) {
    fail(`Falta la clave de firma (${store} y orb-release.pass). Sin ella Android no instala la app encima de la que hay: no se crea otra.`);
  }
  return { ORB_KEYSTORE: store, ORB_KEYSTORE_PASS: fs.readFileSync(passFile, 'utf8').trim(), ORB_KEY_ALIAS: 'orb' };
}

/** What the APK says it is, and who signed it. */
function checkApk(apk, { release }) {
  const badging = tool('aapt2', ['dump', 'badging', apk]);
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
  if (!pkg) throw new Error('aapt2 no dice qué paquete es');
  const [, name, code, versionName] = pkg;
  if (name !== 'dev.orb.app') throw new Error(`el paquete es ${name}, no dev.orb.app`);
  if (Number(code) !== VERSION_CODE || versionName !== version) throw new Error(`versión ${versionName} (${code}); se esperaba ${version} (${VERSION_CODE})`);
  if (Number(code) <= 30800) throw new Error(`versionCode ${code} no es mayor que el de Orb 3.8.0 (30800)`);
  const certs = tool('apksigner', ['verify', '--print-certs', apk]);
  const sha = /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(certs)?.[1];
  if (release && sha !== RELEASE_CERT_SHA256) throw new Error(`el APK está firmado con otro certificado (${sha}): Android no lo instalará encima de Orb 3.8.0`);
  return { name, code: Number(code), versionName, sha };
}

async function main() {
  // An APK of this app called 3.8.0 would be taken for Orb 3.8.0's (Capacitor), which links with a 3.8.0 PC; this one
  // needs Orb 3.8.1 on the PC (review Android B4).
  if (VERSION_CODE <= 3_008_000) fail(`La versión ${version} no es mayor que 3.8.0: sube la de package.json antes de compilar la app.`);
  const keys = debug ? {} : signingKey();
  await run(process.execPath, [path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'android', 'build', '--apk', '--target', 'aarch64', ...(debug ? ['--debug'] : [])], keys);
  const kind = debug ? 'debug' : 'release';
  const out = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', kind, `app-universal-${kind}.apk`);
  if (!fs.existsSync(out)) throw new Error(`no está el APK en ${out}`);
  const info = checkApk(out, { release: !debug });
  // Review Android B4/B5: the debug APK (debuggable, the SDK's key, ~300 MB) lives apart, never beside the one to publish.
  const dest = debug ? path.join(ROOT, 'dist', 'debug', `Orb-${version}-android-debug.apk`) : path.join(ROOT, 'dist', `Orb-${version}-android.apk`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(out, dest);
  console.log(`APK listo: ${dest} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB) · ${info.name} ${info.versionName} (${info.code}) · certificado ${info.sha}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(`No se pudo compilar la app: ${error.message}`));
}
