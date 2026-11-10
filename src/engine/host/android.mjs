// Android's tools (adb, fastboot) and the phone the agents test apps on (3.8.2, owner's decision D2).
//
// Platform-tools: Google's licence does not let Orb carry them in its installer, so they are downloaded from Google the
// first time they are needed (Ajustes › Android, or an agent's orb_android_* tool) into core\herramientas\adb. The
// archive is a pinned version: its size, Google's own SHA-1 (repository2-3.xml) and, on Windows, a SHA-256 taken from it
// are checked before anything is unpacked; a file that does not match is thrown away.
// 3.8.2: adb is no longer in the agents' PATH and is no longer downloaded at every start: agents reach the phone only
// through Orb's tools (orb_android_*, src/mcp/server.mjs → the engine, here), which check on every call that the chat
// holds «Usar mi móvil Android» (or «Acceso total al PC»). adb by hand (a command) is refused by the guard unless the
// chat has «Acceso total» and the phone (src/domain/security/guard.mjs › runsAdb).
//
// Pairing (Ajustes › Android › Emparejar móvil): Android's «Depuración inalámbrica» pairs with a QR
// (WIFI:T:ADB;S:<name>;P:<password>;;): the phone, once it read it, announces a pairing service with that name on the
// network (mDNS, `adb mdns services`); Orb pairs with it (`adb pair`) and connects (`adb connect`). Or by hand, with the
// address and the six-digit code the phone shows.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, execFile } from 'node:child_process';
import { ctx, tr } from '../../platform/context.mjs';
import { sdkRoots } from '../../platform/dev-tools.mjs';
import { isOrbData } from '../../domain/security/guard.mjs';

// Platform-tools r37.0.2 (Google's repository2-3.xml, checked 2026-11-08). A newer version needs a new pin here.
export const PLATFORM_TOOLS = Object.freeze({
  win32: { url: 'https://dl.google.com/android/repository/platform-tools_r37.0.2-win.zip', size: 8239125, sha1: 'd7ee482b3874f1e0d6d5dca135f6bd58f5716db0', sha256: '6d93a5e63bc1654b70b7b94bec5c6ab46db113df0265beb314055dd253772b58' },
  darwin: { url: 'https://dl.google.com/android/repository/platform-tools_r37.0.2-darwin.zip', size: 16516152, sha1: '6f86aa58ba42dd4bfe27477f3f11c09edc3ebe3f' },
  linux: { url: 'https://dl.google.com/android/repository/platform-tools_r37.0.2-linux.zip', size: 9541228, sha1: '736a08af10515674e40d8b754fe87390d698da2b' }
});
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
let state = { state: 'idle', error: null };
let running = null;

export const adbPath = () => path.join(ctx.paths.adb, exe('adb'));
// 3.7: adb never runs in tests or when switched off (ORB_NO_ADB=1): every new copy of adb.exe that starts its server makes
// Windows ask for permission, and the tests make a fresh folder each time. (The tests drive a fake adb instead:
// createAndroid({ exe }).)
export const adbDisabled = () => process.env.ORB_NO_ADB === '1' || Boolean(process.env.ORB_FAKE_AGENTS);
export const adbStatus = () => ({ ...state, dir: ctx.paths.adb, ready: fs.existsSync(adbPath()) });

// 3.8.2 (review A2): what Orb downloaded, file by file (SHA-256), kept where agents cannot write (core\datos). Before
// every run of adb the folder must be exactly that: same files, same contents, nothing added (a DLL next to adb.exe
// would be loaded by it).
export const adbPrints = () => path.join(ctx.paths.data, 'adb-huellas.json');
export function fingerprints(dir) {
  const out = {};
  const walk = (d, pre) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const rel = pre ? `${pre}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), rel); else out[rel.toLowerCase()] = crypto.createHash('sha256').update(fs.readFileSync(path.join(d, e.name))).digest('hex'); } };
  walk(dir, '');
  return out;
}
export function verifyAdb(dir = ctx.paths.adb, prints = adbPrints()) {
  let want; try { want = JSON.parse(fs.readFileSync(prints, 'utf8')).files; } catch { return false; }
  if (!want || typeof want !== 'object') return false;
  let have; try { have = fingerprints(dir); } catch { return false; }
  const a = Object.keys(want); const b = Object.keys(have);
  return a.length === b.length && a.every((k) => have[k] === want[k]);
}
function wipeAdb() {
  try { for (const name of fs.readdirSync(ctx.paths.adb)) fs.rmSync(path.join(ctx.paths.adb, name), { recursive: true, force: true }); } catch { /* not there */ }
  try { fs.rmSync(adbPrints(), { force: true }); } catch { /* not there */ }
}

// The downloaded archive against its pin. → null when it matches, or why not.
export function checkArchive(buf, pin) {
  if (!pin) return tr('sys.android.noDownload', { platform: process.platform });
  if (!Buffer.isBuffer(buf) || buf.length !== pin.size) return tr('sys.android.badSize');
  if (crypto.createHash('sha1').update(buf).digest('hex') !== pin.sha1) return tr('sys.android.badHash');
  if (pin.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== pin.sha256) return tr('sys.android.badHash');
  if (buf.readUInt32LE(0) !== 0x04034b50) return tr('sys.android.badHash'); // a zip starts with PK\3\4
  return null;
}

// Downloads and unpacks platform-tools when adb is not there yet. Never throws: the result is in adbStatus().
// Tests (fake agents) and ORB_NO_ADB=1 never download, unless they bring their own fetch and pin.
export function ensureAdb({ log = () => {}, fetchImpl = null, pin = PLATFORM_TOOLS[process.platform] } = {}) {
  if (adbDisabled() && !fetchImpl) { state = { state: 'off', error: null }; return Promise.resolve({ ...adbStatus(), ready: false }); }
  if (fs.existsSync(adbPath())) {
    if (verifyAdb()) { state = { state: 'ready', error: null }; return Promise.resolve(adbStatus()); }
    // 3.8.2 (review A2): not what Orb downloaded (changed, a file added, or from before the fingerprints): again.
    log('android: adb no coincide con lo descargado; se descarga de nuevo');
    wipeAdb();
  }
  if (!pin) { state = { state: 'error', error: tr('sys.android.noDownload', { platform: process.platform }) }; return Promise.resolve(adbStatus()); }
  running ??= download(pin, log, fetchImpl ?? globalThis.fetch).finally(() => { running = null; });
  return running;
}

async function download(pin, log, fetchImpl) {
  state = { state: 'downloading', error: null };
  const work = path.join(ctx.paths.internal, 'descargas', `adb-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const res = await fetchImpl(pin.url, { signal: AbortSignal.timeout(300_000), redirect: 'error' });
    if (!res.ok) throw new Error(tr('sys.android.downloadHttp', { status: res.status }));
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared && declared !== pin.size) throw new Error(tr('sys.android.badSize'));
    const buf = Buffer.from(await res.arrayBuffer());
    const bad = checkArchive(buf, pin);
    if (bad) throw new Error(bad);
    const zip = path.join(work, 'platform-tools.zip');
    fs.writeFileSync(zip, buf);
    const out = path.join(work, 'x'); fs.mkdirSync(out);
    // Windows 10+ and macOS bring a tar that reads zip files (on Windows, System32's: Git's GNU tar reads "D:" as a host);
    // Linux usually has unzip; PowerShell as the last resort on Windows. (The archive is Google's, checked above.)
    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'); // full paths: nothing in PATH can stand in
    const tar = process.platform === 'win32' ? path.join(system32, 'tar.exe') : 'tar';
    let r = await runQuiet(tar, ['-xf', zip, '-C', out], { timeout: 120_000 });
    if (r.status !== 0 && process.platform === 'win32') r = await runQuiet(path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:ORB_ZIP -DestinationPath $env:ORB_OUT -Force'], { timeout: 180_000, env: { ...process.env, ORB_ZIP: zip, ORB_OUT: out } });
    else if (r.status !== 0) r = await runQuiet('unzip', ['-q', '-o', zip, '-d', out], { timeout: 120_000 });
    const from = path.join(out, 'platform-tools');
    if (!fs.existsSync(path.join(from, exe('adb')))) throw new Error(tr('sys.android.noAdb'));
    fs.mkdirSync(ctx.paths.adb, { recursive: true });
    for (const name of fs.readdirSync(from)) fs.cpSync(path.join(from, name), path.join(ctx.paths.adb, name), { recursive: true, force: true });
    // The fingerprint of every file, kept in core\datos (closed to agents): checked before each use (verifyAdb).
    fs.mkdirSync(ctx.paths.data, { recursive: true });
    fs.writeFileSync(adbPrints(), JSON.stringify({ version: pin.url, files: fingerprints(ctx.paths.adb) }));
    if (process.platform !== 'win32') for (const name of ['adb', 'fastboot']) { try { fs.chmodSync(path.join(ctx.paths.adb, name), 0o755); } catch { /* not there */ } }
    state = { state: 'ready', error: null };
    log(`android: platform-tools descargadas y comprobadas en ${ctx.paths.adb}`);
  } catch (error) {
    state = { state: 'error', error: error.message };
    log(`android: no se pudo descargar adb: ${error.message}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  return adbStatus();
}

// One run of adb, never through a shell: its arguments go as they are. A script (.mjs, the tests' fake adb) runs with
// this Node. → { code, out: Buffer, err: string }
// 3.8.2 (review M2): Orb's adb keeps its pairing keys and known phones in core\datos\android (ANDROID_USER_HOME), closed to
// agents, instead of the user's .android (also closed: src/engine/workspace-layout.mjs › adbHomes).
export const adbHome = () => path.join(ctx.paths.data, 'android');
// A program run to the end without blocking the engine (the unpacking of a download took 2-3 minutes of frozen loop).
const runQuiet = (file, args, { timeout = 120_000, env = process.env } = {}) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env }, (error) => resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0 }));
});
export function runAdb(file, args, { timeout = 30_000, maxBuffer = 24 * 1024 * 1024 } = {}) {
  const script = /\.(mjs|js)$/i.test(file);
  let env = process.env;
  if (!script) { try { fs.mkdirSync(adbHome(), { recursive: true }); env = { ...process.env, ANDROID_USER_HOME: adbHome() }; } catch { /* its default */ } }
  return new Promise((resolve) => {
    execFile(script ? process.execPath : file, script ? [file, ...args] : args, { windowsHide: true, timeout, maxBuffer, encoding: 'buffer', env }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: stdout ?? Buffer.alloc(0), err: String(stderr ?? '') || (error && typeof error.code !== 'number' ? String(error.message) : '') });
    });
  });
}

// --- Android emulators (3.8.2, T3 3.17) -------------------------------------------------------------------------------
// Only the Android SDK's emulator already installed on this PC (Android Studio's): Orb never downloads the emulator nor
// its system images. An emulator that runs is one more device for adb (emulator-5554…), so the agents use it with the
// same orb_android_* tools and the same grant as the phone.
export function sdkEmulator(env = process.env, platform = process.platform) {
  for (const root of sdkRoots(env, platform)) {
    const file = path.join(root, 'emulator', platform === 'win32' ? 'emulator.exe' : 'emulator');
    try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
  }
  return null;
}
export const AVD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// `emulator -list-avds`: one name per line (its INFO/WARNING lines have spaces and are left out).
export const parseAvds = (text) => [...new Set(String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => AVD.test(l)))].slice(0, 50);
// The emulator runs without the engine's own variables (its pipes and tickets) and with the user's own .android.
export const emulatorEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^ORB_/i.test(k) && k.toUpperCase() !== 'ANDROID_USER_HOME'));
const asScript = (file, args) => (/\.(mjs|js)$/i.test(file) ? [process.execPath, [file, ...args]] : [file, args]); // the tests' fake emulator
const listAvds = (file) => new Promise((resolve) => {
  const [cmd, args] = asScript(file, ['-list-avds']);
  execFile(cmd, args, { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, env: emulatorEnv() }, (_error, stdout) => resolve(String(stdout ?? '')));
});
// Started on its own (its window outlives the engine), never through a shell.
const startEmulator = (file, avd) => new Promise((resolve, reject) => {
  const [cmd, args] = asScript(file, ['-avd', avd]);
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: emulatorEnv() });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(true); });
});

// --- What adb says, read ----------------------------------------------------------------------------------------------

// The pairing QR Android's «Emparejar con código QR» reads. Special characters of the format escaped (\ ; , : ").
const qrEscape = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
export const pairingQr = (name, password) => `WIFI:T:ADB;S:${qrEscape(name)};P:${qrEscape(password)};;`;
const ALNUM = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomWord = (n) => Array.from(crypto.randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join('');
export const newPairing = () => ({ name: `orb-${randomWord(8)}`, password: randomWord(12) });

// `adb mdns services`: [{ name, type, address }]
export function parseMdns(text) {
  return String(text ?? '').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && /^_adb/.test(p[1]) && /:\d+$/.test(p[2]))
    .map(([name, type, address]) => ({ name, type: type.replace(/\.$/, ''), address }));
}
// `adb devices -l`: [{ serial, state, model, product, device }]
export function parseDevices(text) {
  return String(text ?? '').split(/\r?\n/).filter((l) => l.trim() && !/^List of devices|^\*/.test(l)).map((l) => {
    const [serial, st, ...rest] = l.trim().split(/\s+/);
    const kv = Object.fromEntries(rest.map((x) => x.split(':')).filter((x) => x.length === 2));
    return { serial, state: st, model: kv.model?.replace(/_/g, ' ') ?? null, product: kv.product ?? null, device: kv.device ?? null };
  }).filter((d) => d.serial && d.state);
}
// `adb pair`: the phone's id (guid, '' when adb did not say it) when it worked, null when not.
export const pairedGuid = (text) => (/Successfully paired/i.test(text) ? (/\[guid=([^\]\s]+)\]/.exec(text)?.[1] ?? '') : null);
// 3.8.2 (review B2): the package an apk declares: its AndroidManifest.xml (Android's binary XML) read from the zip, the
// «package» attribute of <manifest>. → the package, or null when the file is not an apk Orb can read.
export function apkPackage(file) {
  let buf; try { buf = fs.readFileSync(file); } catch { return null; }
  try {
    const xml = zipEntry(buf, 'AndroidManifest.xml');
    return xml ? manifestPackage(xml) : null;
  } catch { return null; }
}
function zipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10); let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(at + 10); const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28); const extra = buf.readUInt16LE(at + 30); const comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    if (buf.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      if (buf.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 8 * 1024 * 1024 });
      return null;
    }
    at += 46 + nameLen + extra + comment;
  }
  return null;
}
function manifestPackage(x) {
  if (x.readUInt16LE(0) !== 0x0003) return null;
  let strings = [];
  for (let at = x.readUInt16LE(2); at + 8 <= x.length;) {
    const type = x.readUInt16LE(at); const head = x.readUInt16LE(at + 2); const size = x.readUInt32LE(at + 4);
    if (size < 8) return null;
    if (type === 0x0001) { // string pool
      const count = x.readUInt32LE(at + 8); const utf8 = (x.readUInt32LE(at + 16) & 0x100) !== 0; const base = at + x.readUInt32LE(at + 20);
      strings = Array.from({ length: Math.min(count, 100_000) }, (_, i) => {
        let p = base + x.readUInt32LE(at + head + i * 4);
        if (utf8) { p += (x[p] & 0x80) ? 2 : 1; let len = x[p]; if (len & 0x80) { len = ((len & 0x7f) << 8) | x[p + 1]; p += 2; } else p += 1; return x.toString('utf8', p, p + len); }
        let len = x.readUInt16LE(p); if (len & 0x8000) { len = ((len & 0x7fff) << 16) | x.readUInt16LE(p + 2); p += 4; } else p += 2;
        return x.toString('utf16le', p, p + len * 2);
      });
    } else if (type === 0x0102) { // start of an element
      if (strings[x.readUInt32LE(at + 20)] === 'manifest') {
        const first = at + head + x.readUInt16LE(at + 24); const step = x.readUInt16LE(at + 26); const n = x.readUInt16LE(at + 28);
        for (let i = 0; i < n; i++) {
          const a = first + i * step;
          if (strings[x.readUInt32LE(a + 4)] === 'package') { const v = strings[x.readUInt32LE(a + 8)]; return PACKAGE.test(v ?? '') ? v : null; }
        }
        return null;
      }
    }
    at += size;
  }
  return null;
}

// `input text` through the phone's shell: one single-quoted word, spaces as %s (how input reads them). Plain ASCII only.
export function inputText(text) {
  const t = String(text ?? '');
  if (!t || t.length > 500 || /[^\u0020-\u007e]/.test(t)) return null;
  return `'${t.replace(/ /g, '%s').replace(/'/g, "'\\''")}'`;
}
export const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ACTIVITY = /^\.?[A-Za-z][A-Za-z0-9_$]*(\.[A-Za-z][A-Za-z0-9_$]*)*$/;
const SERIAL = /^[A-Za-z0-9._:\-[\]%]{1,120}$/;
const ADDRESS = /^[A-Za-z0-9._[\]%-]{1,80}(:[A-Za-z0-9._[\]%-]{1,80})*:\d{2,5}$/;
const KEYS = ['HOME', 'BACK', 'ENTER', 'DEL', 'FORWARD_DEL', 'TAB', 'ESCAPE', 'APP_SWITCH', 'MENU', 'SEARCH', 'SPACE', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'VOLUME_UP', 'VOLUME_DOWN', 'VOLUME_MUTE', 'POWER', 'WAKEUP', 'SLEEP', 'MOVE_HOME', 'MOVE_END', 'PAGE_UP', 'PAGE_DOWN', 'NOTIFICATION'];
const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'];
const clipEnd = (s, n) => (s.length > n ? `…${s.slice(-n)}` : s);
const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

// --- Who may use the phone ------------------------------------------------------------------------------------------

// A chat with «Usar mi móvil Android», or one without a project with «Acceso total al PC» (which includes it).
export const androidAllowed = (s) => Boolean(s && s.kind === 'chat' && (Number(s.android) === 1 || (!s.project && s.permission === 'total')));
// adb shell by hand: also «Acceso total» (the permission of a chat with a project, or the PC's).
export const shellAllowed = (s) => androidAllowed(s) && s.permission === 'total';

const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });

// The engine's phone. board: settings (the devices Orb paired, what each chat installed); exe(): adb's path (the tests: a
// fake adb script); ensure(): the download.
export function createAndroid({ board, log = () => {}, exe = adbPath, emulator = () => sdkEmulator(),ensure = () => ensureAdb({ log }), verify = () => verifyAdb(), now = () => Date.now(), pollMs = 1500, pairMs = 120_000 } = {}) {
  let pairing = null; // { name, password, qr, state, error, until, device, timer }
  const off = () => exe === adbPath && adbDisabled(); // tests and ORB_NO_ADB: Orb's own adb never runs
  // 3.8.2 (review A2): every adb binary runs only as Orb downloaded it (verify); only the tests' fake adb script does not.
  // 3.8.3 (repaso): hashing the whole folder (15 MB) on every adb call, twice per tool, froze the engine; the check is
  // kept for a minute (agents cannot write in core\herramientas) and asked again after a new download.
  let trust = { at: 0, ok: false };
  const trusted = () => { if (/\.(mjs|js)$/i.test(exe())) return true; if (Date.now() - trust.at < 60_000) return trust.ok; trust = { at: Date.now(), ok: verify() }; return trust.ok; };
  const usable = () => !off() && fs.existsSync(exe()) && trusted();
  const ready = async () => {
    if (off()) throw userError('msg.android.noAdb', { error: 'ORB_NO_ADB' });
    // 3.8.2 (review A2): Orb's own adb runs only as it was downloaded (verify, every time); otherwise ensure() fetches it again.
    const good = () => fs.existsSync(exe()) && trusted();
    if (good()) return exe();
    const st = await ensure(); trust.at = 0;
    if (good()) return exe();
    throw userError('msg.android.noAdb', { error: st?.error ?? '' });
  };
  const adb = async (args, opts) => runAdb(await ready(), args, opts);
  const text = (r) => r.out.toString('utf8');
  const known = () => { const v = board?.settingJson('android_devices'); return Array.isArray(v) ? v : []; };
  const remember = (list) => board?.settingJson('android_devices', list.slice(0, 20));

  async function connected() { const r = await adb(['devices', '-l'], { timeout: 15_000 }); return parseDevices(text(r)); }

  // After pairing: the connection service of the very phone that paired (3.8.2 review B4: its exact name, the guid adb
  // gave, at the address it paired from; without a guid, that address only), then adb connect. (adb's TLS connection
  // also checks the phone's certificate against the one it learnt when pairing: AOSP's design, not tested here.)
  async function connectAfterPair(host, guid) {
    for (let i = 0; i < 8; i++) {
      const list = parseMdns(text(await adb(['mdns', 'services'], { timeout: 10_000 })));
      const svc = list.find((x) => /_adb-tls-connect/.test(x.type) && x.address.startsWith(`${host}:`) && (!guid || x.name === guid));
      if (svc) { const r = await adb(['connect', svc.address], { timeout: 15_000 }); if (/connected to/i.test(text(r))) return svc.address; }
      await new Promise((ok) => setTimeout(ok, pollMs));
    }
    return null;
  }
  async function finishPair(address, code, connectTo) {
    const r = await adb(['pair', address, code], { timeout: 30_000 });
    const out = `${text(r)}\n${r.err}`;
    const guid = pairedGuid(out);
    if (guid === null) throw userError('msg.android.pairFailed', { error: out.trim().split(/\r?\n/).pop()?.slice(0, 160) ?? '' });
    const host = address.replace(/:\d+$/, '');
    let serial = null;
    if (connectTo) { const c = await adb(['connect', connectTo], { timeout: 15_000 }); if (/connected to/i.test(text(c))) serial = connectTo; }
    serial ??= await connectAfterPair(host, guid);
    const dev = serial ? (await connected()).find((d) => d.serial === serial) : null;
    const entry = { guid: guid || null, host, serial, model: dev?.model ?? null, pairedAt: new Date(now()).toISOString() };
    remember([entry, ...known().filter((d) => !(guid && d.guid === guid) && d.host !== host)]);
    log(`android: móvil emparejado (${entry.model ?? host})`);
    return entry;
  }

  async function poll() {
    const p = pairing;
    if (!p || p.state !== 'waiting') return;
    if (now() > p.until) { p.state = 'expired'; return; }
    try {
      const svc = parseMdns(text(await adb(['mdns', 'services'], { timeout: 10_000 }))).find((x) => /_adb-tls-pairing/.test(x.type) && x.name === p.name);
      if (svc && pairing === p) {
        p.state = 'pairing';
        try { p.device = await finishPair(svc.address, p.password); p.state = 'done'; } catch (error) { p.state = 'error'; p.error = error.message; }
        return;
      }
    } catch (error) { p.state = 'error'; p.error = error.message; return; }
    if (pairing === p) { p.timer = setTimeout(poll, pollMs); p.timer.unref?.(); }
  }
  const view = (p) => (p ? { qr: p.qr, state: p.state, error: p.error ?? null, until: new Date(p.until).toISOString(), device: p.device ?? null } : { state: 'idle' });

  async function pick(serial) {
    const list = (await connected()).filter((d) => d.state === 'device');
    if (serial !== undefined && serial !== null && serial !== '') {
      if (!SERIAL.test(String(serial))) throw userError('msg.android.badSerial');
      const d = list.find((x) => x.serial === serial);
      if (!d) throw userError('msg.android.noSuchDevice', { serial });
      return d.serial;
    }
    if (!list.length) throw userError('msg.android.noDevice');
    if (list.length > 1) throw userError('msg.android.whichDevice', { list: list.map((d) => d.serial).join(', ') });
    return list[0].serial;
  }
  const installedKey = (s) => `android_installed:${s.id}`;
  const installedBy = (s) => { const v = board?.settingJson(installedKey(s)); return Array.isArray(v) ? v : []; };

  // The agents' tools. s: the conversation's row (the engine's, never the agent's word). → { text, image? }
  const TOOLS = {
    async devices() {
      const list = await connected();
      return { text: list.length ? list.map((d) => `${d.serial} · ${d.state}${d.model ? ` · ${d.model}` : ''}`).join('\n') : tr('msg.android.noDevice') };
    },
    async install(s, a) {
      const given = String(a.apk ?? '');
      if (!given || given.length > 1000) throw userError('msg.android.badApk');
      const full = path.resolve(s.cwd, given);
      let real; try { real = fs.realpathSync.native(full); } catch { throw userError('msg.android.noApk', { path: given }); }
      if (!/\.apk$/i.test(real) || !fs.statSync(real).isFile()) throw userError('msg.android.badApk');
      // Only an apk of the workspace (a project, a task's isolated copy, its outputs), never of what Orb keeps from agents.
      const roots = [s.cwd, ctx.paths.projects].map((d) => { try { return fs.realpathSync.native(d).toLowerCase(); } catch { return path.resolve(d).toLowerCase(); } });
      const low = real.toLowerCase();
      if (!roots.some((r) => low.startsWith(`${r}${path.sep}`)) || isOrbData(real, ctx.paths.internal, null, { read: false })) throw userError('msg.android.apkOutside');
      // 3.8.2 (review B2): the package is the one the apk itself declares (its AndroidManifest.xml): only that one counts
      // as this chat's (uninstall), never another app that changed on the phone meanwhile.
      const pkg = apkPackage(real);
      if (!pkg) throw userError('msg.android.badApk');
      const serial = await pick(a.serial);
      const r = await adb(['-s', serial, 'install', '-r', real], { timeout: 300_000 });
      const out = `${text(r)}\n${r.err}`.trim();
      if (!/\bSuccess\b/.test(out)) throw userError('msg.android.installFailed', { error: clipEnd(out, 400) });
      board?.settingJson(installedKey(s), [...new Set([...installedBy(s), pkg])].slice(-50));
      return { text: tr('msg.android.installed', { pkg, serial }) };
    },
    async launch(s, a) {
      const pkg = String(a.package ?? '');
      if (!PACKAGE.test(pkg)) throw userError('msg.android.badPackage');
      const serial = await pick(a.serial);
      let r;
      if (a.activity) {
        if (!ACTIVITY.test(String(a.activity))) throw userError('msg.android.badActivity');
        r = await adb(['-s', serial, 'shell', 'am', 'start', '-n', `${pkg}/${a.activity}`], { timeout: 30_000 });
      } else r = await adb(['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 30_000 });
      const out = `${text(r)}\n${r.err}`.trim();
      if (r.code !== 0 || /Error|No activities found|aborted/i.test(out)) throw userError('msg.android.launchFailed', { error: clipEnd(out, 300) });
      return { text: tr('msg.android.launched', { pkg }) };
    },
    async screenshot(s, a) {
      const serial = await pick(a.serial);
      const r = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 30_000 });
      const png = r.out;
      if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw userError('msg.android.screenshotFailed');
      if (png.length > 12 * 1024 * 1024) throw userError('msg.android.screenshotBig');
      return { text: tr('msg.android.screenshot', { w: png.readUInt32BE(16), h: png.readUInt32BE(20) }), image: png.toString('base64'), mime: 'image/png' };
    },
    async tap(s, a) {
      const x = int(a.x, 0, 20000); const y = int(a.y, 0, 20000);
      if (x === null || y === null) throw userError('msg.android.badPoint');
      const serial = await pick(a.serial);
      await adb(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]);
      return { text: tr('msg.android.done') };
    },
    async swipe(s, a) {
      const v = [a.x1, a.y1, a.x2, a.y2].map((n) => int(n, 0, 20000)); const ms = a.ms === undefined ? 300 : int(a.ms, 0, 10_000);
      if (v.includes(null) || ms === null) throw userError('msg.android.badPoint');
      const serial = await pick(a.serial);
      await adb(['-s', serial, 'shell', 'input', 'swipe', ...v.map(String), String(ms)]);
      return { text: tr('msg.android.done') };
    },
    async text(s, a) {
      const word = inputText(a.text);
      if (!word) throw userError('msg.android.badText');
      const serial = await pick(a.serial);
      await adb(['-s', serial, 'shell', 'input', 'text', word]);
      return { text: tr('msg.android.done') };
    },
    async key(s, a) {
      const k = String(a.key ?? '').toUpperCase().replace(/^KEYCODE_/, '');
      if (!KEYS.includes(k)) throw userError('msg.android.badKey', { list: KEYS.join(', ') });
      const serial = await pick(a.serial);
      await adb(['-s', serial, 'shell', 'input', 'keyevent', `KEYCODE_${k}`]);
      return { text: tr('msg.android.done') };
    },
    async logcat(s, a) {
      const lines = a.lines === undefined ? 200 : int(a.lines, 1, 500);
      const level = String(a.level ?? 'I').toUpperCase();
      if (lines === null || !LEVELS.includes(level)) throw userError('msg.android.badLogcat');
      const serial = await pick(a.serial);
      const args = ['-s', serial, 'logcat', '-d', '-t', String(lines)];
      if (a.package) {
        if (!PACKAGE.test(String(a.package))) throw userError('msg.android.badPackage');
        const pid = text(await adb(['-s', serial, 'shell', 'pidof', '-s', String(a.package)], { timeout: 15_000 })).trim();
        if (!/^\d+$/.test(pid)) return { text: tr('msg.android.notRunning', { pkg: a.package }) };
        args.push(`--pid=${pid}`);
      }
      args.push(`*:${level}`);
      const r = await adb(args, { timeout: 30_000 });
      let out = text(r);
      if (a.grep) { const g = String(a.grep).toLowerCase().slice(0, 200); out = out.split(/\r?\n/).filter((l) => l.toLowerCase().includes(g)).join('\n'); }
      return { text: clipEnd(out.trim() || tr('msg.android.emptyLog'), 60_000) };
    },
    async uninstall(s, a) {
      const pkg = String(a.package ?? '');
      if (!PACKAGE.test(pkg)) throw userError('msg.android.badPackage');
      if (!installedBy(s).includes(pkg)) throw userError('msg.android.notYours', { pkg });
      const serial = await pick(a.serial);
      const r = await adb(['-s', serial, 'uninstall', pkg], { timeout: 60_000 });
      if (!/\bSuccess\b/.test(text(r))) throw userError('msg.android.uninstallFailed', { error: clipEnd(`${text(r)} ${r.err}`.trim(), 300) });
      board?.settingJson(installedKey(s), installedBy(s).filter((p) => p !== pkg));
      return { text: tr('msg.android.uninstalled', { pkg }) };
    },
    // 3.8.2 (T3 3.17): the emulators of this PC's Android SDK.
    async emulators() {
      const { sdk, avds } = await api.emulators();
      if (!sdk) return { text: tr('msg.android.noEmulator') };
      return { text: avds.length ? tr('msg.android.avds', { list: avds.join(', ') }) : tr('msg.android.noAvds') };
    },
    async emulator(s, a) { return { text: await api.emulatorStart({ avd: a.avd }) }; },
    async shell(s, a) {
      if (!shellAllowed(s)) throw userError('msg.android.shellNeedsTotal');
      const cmd = String(a.command ?? '');
      if (!cmd.trim() || cmd.length > 2000) throw userError('msg.android.badCommand');
      const serial = await pick(a.serial);
      const r = await adb(['-s', serial, 'shell', cmd], { timeout: 120_000 });
      return { text: clipEnd(`${text(r)}${r.err ? `\n${r.err}` : ''}`.trim() || `(${r.code})`, 60_000) };
    }
  };

  const api = {
    // Ajustes › Android
    async pairStart() {
      api.pairCancel();
      await ready();
      const { name, password } = newPairing();
      pairing = { name, password, qr: pairingQr(name, password), state: 'waiting', until: now() + pairMs, timer: null };
      log('android: emparejamiento por QR iniciado');
      pairing.timer = setTimeout(poll, 0); pairing.timer.unref?.();
      return view(pairing);
    },
    pairState: () => view(pairing),
    pairCancel() { if (pairing) { clearTimeout(pairing.timer); pairing = null; } return true; },
    async pairCode({ address, code, connect }) {
      if (!ADDRESS.test(String(address ?? ''))) throw userError('msg.android.badAddress');
      if (!/^\d{6}$/.test(String(code ?? ''))) throw userError('msg.android.badCode');
      if (connect && !ADDRESS.test(String(connect))) throw userError('msg.android.badAddress');
      api.pairCancel();
      return finishPair(String(address), String(code), connect ? String(connect) : null);
    },
    // Paired (Orb's record) and connected (adb's list), together.
    async devices() {
      let live = [];
      if (usable()) { try { live = await connected(); } catch { live = []; } }
      const rows = known().map((d) => {
        const on = live.find((x) => x.serial === d.serial || (d.guid && x.serial.startsWith(d.guid)) || x.serial.startsWith(`${d.host}:`));
        return { ...d, serial: on?.serial ?? d.serial, connected: on?.state === 'device', model: on?.model ?? d.model };
      });
      for (const x of live) if (!rows.some((r) => r.serial === x.serial)) rows.push({ guid: null, host: x.serial.replace(/:\d+$/, ''), serial: x.serial, model: x.model, connected: x.state === 'device', pairedAt: null });
      return rows;
    },
    async disconnect({ serial }) {
      if (!SERIAL.test(String(serial ?? ''))) throw userError('msg.android.badSerial');
      await adb(['disconnect', String(serial)], { timeout: 15_000 });
      log(`android: desconectado ${serial}`);
      return true;
    },
    // Forgotten here (and disconnected); the phone keeps its own list (Depuración inalámbrica › Dispositivos vinculados).
    async forget({ serial, host }) {
      const list = known();
      const gone = list.filter((d) => (serial && d.serial === serial) || (host && d.host === host));
      for (const d of gone) if (d.serial && usable()) { try { await runAdb(exe(), ['disconnect', d.serial], { timeout: 15_000 }); } catch { /* not connected */ } }
      remember(list.filter((d) => !gone.includes(d)));
      log(`android: olvidado ${serial ?? host}`);
      return true;
    },
    // 3.8.2 (T3 3.17): the AVDs of this PC's SDK (Ajustes › Android and orb_android_emulators). → { sdk, avds }
    async emulators() {
      const file = emulator();
      if (!file) return { sdk: false, avds: [] };
      return { sdk: true, avds: parseAvds(await listAvds(file)) };
    },
    // Starts one of them (an existing AVD, by its exact name). → what to tell the agent or the window
    async emulatorStart({ avd }) {
      const name = String(avd ?? '');
      if (!AVD.test(name)) throw userError('msg.android.badAvd');
      const { sdk, avds } = await api.emulators();
      if (!sdk) throw userError('msg.android.noEmulator');
      if (!avds.includes(name)) throw userError('msg.android.noSuchAvd', { name });
      try { await startEmulator(emulator(), name); } catch (error) { throw userError('msg.android.emulatorFailed', { error: error.message }); }
      log(`android: emulador ${name} arrancado`);
      return tr('msg.android.emulatorStarted', { name });
    },
    // An agent's tool: the chat must hold the phone right now (it can be taken back at any moment).
    async tool(s, name, args = {}) {
      if (!androidAllowed(s)) throw userError('msg.android.notAllowed');
      const fn = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
      if (!fn) throw userError('msg.android.unknownTool', { name });
      log(`android: ${name} · chat ${s.id}`);
      return fn(s, args && typeof args === 'object' ? args : {});
    },
    // Orb locked: the pairing in progress goes and adb's server stops (a phone it connected is no longer reachable from
    // this PC until someone uses it again from Orb).
    async stopServer() {
      api.pairCancel();
      if (!usable()) return false; // never an adb that is not Orb's download
      try { await runAdb(exe(), ['kill-server'], { timeout: 10_000 }); } catch { /* not running */ }
      return true;
    }
  };
  return api;
}
