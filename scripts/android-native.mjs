// Runs the Gradle wrapper of the native Android app (android/) with the portable JDK and Android SDK of the build cache.
// Usage: node scripts/android-native.mjs assembleDebug testDebugUnitTest
// Release and signing tasks are refused: releases are signed by hand, outside this script.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const CACHE = process.env.ORB_BUILD_CACHE || (IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'orb-build-cache') : path.join(os.homedir(), '.cache', 'orb-build-cache'));
const fail = (msg) => { console.error(msg); process.exit(1); };

const args = process.argv.slice(2);
if (!args.length) fail('Usage: node scripts/android-native.mjs <gradle tasks>');
if (args.some((a) => /release|sign/i.test(a))) fail('Refused: release and signing tasks are not allowed here.');

const JAVA_HOME = process.env.ORB_JAVA_HOME || path.join(CACHE, 'jdk21');
const SDK = process.env.ORB_ANDROID_SDK || path.join(CACHE, 'sdk');
for (const [what, p] of [['JDK 21', path.join(JAVA_HOME, 'bin', IS_WIN ? 'java.exe' : 'java')], ['Android SDK', path.join(SDK, 'platforms')]]) {
  if (!fs.existsSync(p)) fail(`Missing ${what} at ${p}.`);
}
const env = {
  ...process.env, JAVA_HOME, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, GRADLE_USER_HOME: path.join(CACHE, 'gradle'),
  // One Gradle for this run, gone when it ends (no daemon left behind).
  GRADLE_OPTS: [process.env.GRADLE_OPTS, '-Dorg.gradle.daemon=false'].filter(Boolean).join(' '),
  PATH: [path.join(JAVA_HOME, 'bin'), process.env.PATH].join(path.delimiter)
};
const dir = path.join(ROOT, 'android');
const p = IS_WIN
  ? spawn('cmd.exe', ['/c', path.join(dir, 'gradlew.bat'), ...args], { cwd: dir, env, stdio: 'inherit', windowsHide: true })
  : spawn('./gradlew', args, { cwd: dir, env, stdio: 'inherit' });
p.on('exit', (code) => process.exit(code ?? 1));
