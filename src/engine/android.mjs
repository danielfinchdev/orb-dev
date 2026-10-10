// Android's tools (adb, fastboot): Orb keeps them in <home>\android\adb-tools and downloads Google's platform-tools there
// when they are missing, so agents working on Android projects find adb without the user installing anything.
// The folder goes first in the PATH of the engine (and so of every agent it starts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ctx, tr } from '../core/context.mjs';

const URLS = {
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip'
};
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
let state = { state: 'idle', error: null };
let running = null;

export const adbPath = () => path.join(ctx.paths.adb, exe('adb'));
export const adbStatus = () => ({ ...state, dir: ctx.paths.adb, ready: fs.existsSync(adbPath()) });

// adb's folder first in this process's PATH (Windows names the variable "Path").
export function addAdbToPath() {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const parts = String(process.env[key] ?? '').split(path.delimiter).filter(Boolean);
  if (!parts.some((p) => path.resolve(p).toLowerCase() === path.resolve(ctx.paths.adb).toLowerCase())) process.env[key] = [ctx.paths.adb, ...parts].join(path.delimiter);
}

// Downloads and unpacks platform-tools when adb is not there yet. Never throws: the result is in adbStatus().
// Tests (fake agents) and ORB_NO_ADB=1 never download.
export function ensureAdb({ log = () => {}, force = false } = {}) {
  if (fs.existsSync(adbPath())) { state = { state: 'ready', error: null }; return Promise.resolve(adbStatus()); }
  if (!force && (process.env.ORB_NO_ADB === '1' || process.env.ORB_FAKE_AGENTS)) { state = { state: 'off', error: null }; return Promise.resolve(adbStatus()); }
  const url = URLS[process.platform];
  if (!url) { state = { state: 'error', error: tr('sys.android.noDownload', { platform: process.platform }) }; return Promise.resolve(adbStatus()); }
  running ??= download(url, log).finally(() => { running = null; });
  return running;
}

async function download(url, log) {
  state = { state: 'downloading', error: null };
  const work = path.join(ctx.paths.internal, 'descargas', `adb-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(tr('sys.android.downloadHttp', { status: res.status }));
    const zip = path.join(work, 'platform-tools.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const out = path.join(work, 'x'); fs.mkdirSync(out);
    // Windows 10+ and macOS bring a tar that reads zip files (on Windows, System32's: Git's GNU tar reads "D:" as a host);
    // Linux usually has unzip; PowerShell as the last resort on Windows.
    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'); // full paths: nothing in PATH can stand in
    const tar = process.platform === 'win32' ? path.join(system32, 'tar.exe') : 'tar';
    let r = spawnSync(tar, ['-xf', zip, '-C', out], { windowsHide: true, timeout: 120_000 });
    if (r.status !== 0 && process.platform === 'win32') r = spawnSync(path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:ORB_ZIP -DestinationPath $env:ORB_OUT -Force'], { windowsHide: true, timeout: 180_000, env: { ...process.env, ORB_ZIP: zip, ORB_OUT: out } });
    else if (r.status !== 0) r = spawnSync('unzip', ['-q', '-o', zip, '-d', out], { timeout: 120_000 });
    const from = path.join(out, 'platform-tools');
    if (!fs.existsSync(path.join(from, exe('adb')))) throw new Error(tr('sys.android.noAdb'));
    fs.mkdirSync(ctx.paths.adb, { recursive: true });
    for (const name of fs.readdirSync(from)) fs.cpSync(path.join(from, name), path.join(ctx.paths.adb, name), { recursive: true, force: true });
    if (process.platform !== 'win32') for (const name of ['adb', 'fastboot']) { try { fs.chmodSync(path.join(ctx.paths.adb, name), 0o755); } catch { /* not there */ } }
    state = { state: 'ready', error: null };
    log(`android: adb descargado en ${ctx.paths.adb}`);
  } catch (error) {
    state = { state: 'error', error: error.message };
    log(`android: no se pudo descargar adb: ${error.message}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  return adbStatus();
}
