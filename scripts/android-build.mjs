// 3.5: builds the Android app «Orb» (android-app/, Capacitor) into dist/Orb-<version>-android.apk:
//   0. the notifications' picture (res/drawable-nodpi/av_orb.png),
//   1. the interface in the app's mode (vite build --mode android → android-app/www),
//   2. cap sync (copies it into the Android project with the plugins),
//   3. Gradle (assembleRelease, signed with this PC's own key; --debug: assembleDebug).
// Everything with the portable JDK and Android SDK of %LOCALAPPDATA%\orb-build-cache (docs/ANDROID.md says how to get
// them), set for these processes only: nothing installed and no window opened.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'android-app');
const IS_WIN = process.platform === 'win32';
const CACHE = process.env.ORB_BUILD_CACHE || (IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'orb-build-cache') : path.join(os.homedir(), '.cache', 'orb-build-cache'));
const debug = process.argv.includes('--debug');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const [maj, min, pat] = version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);

const JAVA_HOME = process.env.ORB_JAVA_HOME || path.join(CACHE, 'jdk21');
const SDK = process.env.ORB_ANDROID_SDK || path.join(CACHE, 'sdk');
const exe = (p) => (IS_WIN ? `${p}.exe` : p);
for (const [what, file] of [['JDK 21', path.join(JAVA_HOME, 'bin', exe('java'))], ['Android SDK', path.join(SDK, 'platforms')]]) {
  if (!fs.existsSync(file)) { console.error(`Falta el ${what} en ${file}. Mira docs/ANDROID.md («Building the app»).`); process.exit(1); }
}
const env = {
  ...process.env, JAVA_HOME, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, GRADLE_USER_HOME: path.join(CACHE, 'gradle'),
  PATH: [path.join(JAVA_HOME, 'bin'), process.env.PATH].join(path.delimiter), ORB_VERSION: version, ORB_VERSION_CODE: String(maj * 10000 + min * 100 + pat)
};

const run = (cmd, args, cwd, extra = {}) => new Promise((resolve, reject) => {
  console.log(`> ${[cmd, ...args].join(' ')}`);
  // .bat files only run through cmd on Windows; windowsHide: no console window ever.
  const p = IS_WIN && /\.(bat|cmd)$/i.test(cmd) ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[cmd, ...args].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}"`], { cwd, env: { ...env, ...extra }, stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
    : spawn(cmd, args, { cwd, env: { ...env, ...extra }, stdio: 'inherit', windowsHide: true });
  p.on('error', reject);
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminó con el código ${code}`))));
});

// The key the release is signed with: made once on this PC and kept in the cache, never in the repository. The same key
// must sign every later version, or Android will not update the installed app (it has to be uninstalled first).
async function signingKey() {
  const dir = path.join(CACHE, 'keys');
  const store = path.join(dir, 'orb-release.jks'); const passFile = path.join(dir, 'orb-release.pass');
  if (!fs.existsSync(store)) {
    fs.mkdirSync(dir, { recursive: true });
    const pass = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(passFile, pass, { mode: 0o600 });
    await run(path.join(JAVA_HOME, 'bin', exe('keytool')), ['-genkeypair', '-keystore', store, '-alias', 'orb', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
      '-storepass:env', 'ORB_KEYSTORE_PASS', '-keypass:env', 'ORB_KEYSTORE_PASS', '-dname', 'CN=Orb, O=Orb', '-noprompt'], CACHE, { ORB_KEYSTORE_PASS: pass });
  }
  return { ORB_KEYSTORE: store, ORB_KEYSTORE_PASS: fs.readFileSync(passFile, 'utf8').trim(), ORB_KEY_ALIAS: 'orb' };
}

// 3.6 (messaging, M4): the picture of the notifications (the app shows only its own resources): Orb's (av_orb.png), copied
// on every build, not kept in git. 3.8: the bots' avatars (av_<shape>_<color>.png) left by older builds are removed.
async function notificationIcons() {
  const dir = path.join(APP, 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^av_.+\.png$/.test(f) && f !== 'av_orb.png') fs.rmSync(path.join(dir, f));
  fs.copyFileSync(path.join(ROOT, 'src', 'ui', 'public', 'icon.png'), path.join(dir, 'av_orb.png'));
}

try {
  await notificationIcons();
  await run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'android', '--logLevel', 'warn'], ROOT);
  await run(process.execPath, [path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], APP);
  const keys = debug ? {} : await signingKey();
  const gradle = path.join(APP, 'android', IS_WIN ? 'gradlew.bat' : 'gradlew');
  await run(gradle, ['--no-daemon', '--console=plain', '-q', debug ? 'assembleDebug' : 'assembleRelease'], path.join(APP, 'android'), keys);
  const kind = debug ? 'debug' : 'release';
  const out = path.join(APP, 'android', 'app', 'build', 'outputs', 'apk', kind, `app-${kind}.apk`);
  if (!fs.existsSync(out)) throw new Error(`no está el APK en ${out}`);
  const dest = path.join(ROOT, 'dist', `Orb-${version}-android${debug ? '-debug' : ''}.apk`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(out, dest);
  console.log(`APK listo: ${dest} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
} catch (error) {
  console.error(`No se pudo compilar la app: ${error.message}`);
  process.exit(1);
}
