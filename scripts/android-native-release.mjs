// Builds the release APK of the native Android app (android/) and signs it with Orb's release key, so it installs on
// top of every earlier Orb for Android. Run on the owner's PC only: the key never leaves the build cache.
//   node scripts/android-native-release.mjs            dist/Orb-<version>-android.apk, built, signed and checked
//   node scripts/android-native-release.mjs --upload   the same, then attached to the GitHub release v<version>
// Needs the build cache (ORB_BUILD_CACHE, by default %LOCALAPPDATA%\orb-build-cache): jdk21\, sdk\ (with build-tools)
// and keys\orb-release.jks with its password in keys\orb-release.pass. The password is handed to apksigner as a file
// and never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const fail = (msg) => { console.error(`\nNo se ha podido: ${msg}`); process.exit(1); };
// The certificate every Orb for Android has been signed with (see scripts/android-build.mjs).
const RELEASE_CERT_SHA256 = 'ccd0fffa7be7eaf551b76fd8803bb19d63af31bbf1274c1e9b7d7537c0ae6f00';

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const [maj, min, pat] = version.split('.').map(Number);
const VERSION_CODE = maj * 1_000_000 + min * 1000 + pat;
const CACHE = process.env.ORB_BUILD_CACHE || path.join(process.env.LOCALAPPDATA || os.homedir(), 'orb-build-cache');
const JAVA_HOME = process.env.ORB_JAVA_HOME || path.join(CACHE, 'jdk21');
const SDK = process.env.ORB_ANDROID_SDK || path.join(CACHE, 'sdk');
const newest = (dir) => { try { return fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) ?? ''; } catch { return ''; } };
const BUILD_TOOLS = path.join(SDK, 'build-tools', newest(path.join(SDK, 'build-tools')));
const STORE = path.join(CACHE, 'keys', 'orb-release.jks');
const PASS = path.join(CACHE, 'keys', 'orb-release.pass');

for (const [what, p] of [['el JDK 21', path.join(JAVA_HOME, 'bin', IS_WIN ? 'java.exe' : 'java')], ['el SDK de Android', path.join(SDK, 'platforms')], ['las build-tools de Android', path.join(BUILD_TOOLS, IS_WIN ? 'zipalign.exe' : 'zipalign')], ['la clave de firma', STORE], ['la contraseña de la clave', PASS]]) {
  if (!fs.existsSync(p)) fail(`falta ${what} en ${p}`);
}
const gradleVersion = /versionName\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle.kts'), 'utf8'))?.[1];
if (gradleVersion !== version) fail(`la app de Android dice ${gradleVersion} y package.json dice ${version}`);

const env = {
  ...process.env, JAVA_HOME, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, GRADLE_USER_HOME: path.join(CACHE, 'gradle'),
  GRADLE_OPTS: [process.env.GRADLE_OPTS, '-Dorg.gradle.daemon=false'].filter(Boolean).join(' '),
  PATH: [path.join(JAVA_HOME, 'bin'), process.env.PATH].join(path.delimiter)
};
// .bat tools only run through cmd on Windows.
const tool = (name, args) => {
  const file = path.join(BUILD_TOOLS, IS_WIN ? (name === 'apksigner' ? 'apksigner.bat' : `${name}.exe`) : name);
  const r = IS_WIN && file.endsWith('.bat')
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}"`], { env, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(file, args, { env, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) fail(`${name}: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
};
const gradle = (args) => new Promise((resolve) => {
  const dir = path.join(ROOT, 'android');
  const p = IS_WIN
    ? spawn('cmd.exe', ['/c', path.join(dir, 'gradlew.bat'), ...args], { cwd: dir, env, stdio: 'inherit', windowsHide: true })
    : spawn(path.join(dir, 'gradlew'), args, { cwd: dir, env, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? resolve() : fail(`Gradle terminó con el código ${code}`)));
});

async function main() {
  console.log(`Orb ${version} para Android: compilando…`);
  await gradle(['assembleRelease', '--console=plain', '-q']);
  const unsigned = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
  if (!fs.existsSync(unsigned)) fail(`Gradle no dejó ${unsigned}`);
  const dist = path.join(ROOT, 'dist'); fs.mkdirSync(dist, { recursive: true });
  const aligned = path.join(dist, `Orb-${version}-android-aligned.apk`);
  const apk = path.join(dist, `Orb-${version}-android.apk`);
  fs.rmSync(apk, { force: true });
  console.log('Firmando…');
  tool('zipalign', ['-p', '-f', '4', unsigned, aligned]);
  tool('apksigner', ['sign', '--ks', STORE, '--ks-key-alias', 'orb', '--ks-pass', `file:${PASS}`, '--out', apk, aligned]);
  fs.rmSync(aligned, { force: true }); fs.rmSync(`${apk}.idsig`, { force: true });
  // What the APK says it is, and who signed it: another certificate would not install on top of the app the phone has.
  const badging = tool('aapt2', ['dump', 'badging', apk]);
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
  if (!pkg || pkg[1] !== 'dev.orb.app' || Number(pkg[2]) !== VERSION_CODE || pkg[3] !== version) fail(`el APK no es dev.orb.app ${version} (${VERSION_CODE}): ${pkg?.slice(1).join(' ')}`);
  const sha = /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(tool('apksigner', ['verify', '--print-certs', apk]))?.[1];
  if (sha !== RELEASE_CERT_SHA256) { fs.rmSync(apk, { force: true }); fail(`el APK quedó firmado con otro certificado (${sha})`); }
  console.log(`Firmado: ${apk} (${(fs.statSync(apk).size / 1048576).toFixed(1)} MB, certificado de siempre)`);

  if (!process.argv.includes('--upload')) return;
  const tag = `v${version}`;
  const has = spawnSync('gh', ['release', 'view', tag, '--json', 'tagName'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (has.status !== 0) { console.log(`\nLa Release ${tag} aún no existe: haz doble clic en «FIRMAR WINDOWS» y después otra vez en «FIRMAR ANDROID».`); return; }
  const up = spawnSync('gh', ['release', 'upload', tag, apk, '--clobber'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (up.status !== 0) fail('gh no pudo subir el APK a la Release');
  console.log(`\nSubido a la Release ${tag}:\nhttps://github.com/danielfinchdev/orb-dev/releases/download/${tag}/Orb-${version}-android.apk`);
}
main().catch((e) => fail(e.stack ?? e.message));
