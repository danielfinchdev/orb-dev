// Android's tools (adb, fastboot) and the phone the agents test apps on (3.8.2, owner's decision D2).
//
// Platform-tools: Google's licence does not let Orb carry them in its installer, so they are downloaded from Google the
// first time they are needed (Ajustes › Android, or an agent's orb_android_* tool) into core\herramientas\adb. The
// archive is a pinned version: its size, Google's own SHA-1 (repository2-3.xml) and, on Windows, a SHA-256 taken from it
// are checked before anything is unpacked; a file that does not match is thrown away.
// 3.8.2: adb is no longer in the agents' PATH and is no longer downloaded at every start: agents reach the phone only
// through Orb's tools (orb_android_*, src/mcp/server.mjs → the engine, here), which check on every call that the chat
// holds «Usar mi móvil Android» (or «Acceso total al PC»). adb by hand (a command) is refused by the guard unless the
// chat has «Acceso total» and the phone (src/core/guard.mjs › runsAdb).
//
// Pairing (Ajustes › Android › Emparejar móvil): Android's «Depuración inalámbrica» pairs with a QR
// (WIFI:T:ADB;S:<name>;P:<password>;;): the phone, once it read it, announces a pairing service with that name on the
// network (mDNS, `adb mdns services`); Orb pairs with it (`adb pair`) and connects (`adb connect`). Or by hand, with the
// address and the six-digit code the phone shows.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFile } from 'node:child_process';
import { ctx, tr } from '../core/context.mjs';
import { isOrbData } from '../core/guard.mjs';

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
  if (fs.existsSync(adbPath())) { state = { state: 'ready', error: null }; return Promise.resolve(adbStatus()); }
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
    let r = spawnSync(tar, ['-xf', zip, '-C', out], { windowsHide: true, timeout: 120_000 });
    if (r.status !== 0 && process.platform === 'win32') r = spawnSync(path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:ORB_ZIP -DestinationPath $env:ORB_OUT -Force'], { windowsHide: true, timeout: 180_000, env: { ...process.env, ORB_ZIP: zip, ORB_OUT: out } });
    else if (r.status !== 0) r = spawnSync('unzip', ['-q', '-o', zip, '-d', out], { timeout: 120_000 });
    const from = path.join(out, 'platform-tools');
    if (!fs.existsSync(path.join(from, exe('adb')))) throw new Error(tr('sys.android.noAdb'));
    fs.mkdirSync(ctx.paths.adb, { recursive: true });
    for (const name of fs.readdirSync(from)) fs.cpSync(path.join(from, name), path.join(ctx.paths.adb, name), { recursive: true, force: true });
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
export function runAdb(file, args, { timeout = 30_000, maxBuffer = 24 * 1024 * 1024 } = {}) {
  const script = /\.(mjs|js)$/i.test(file);
  return new Promise((resolve) => {
    execFile(script ? process.execPath : file, script ? [file, ...args] : args, { windowsHide: true, timeout, maxBuffer, encoding: 'buffer' }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: stdout ?? Buffer.alloc(0), err: String(stderr ?? '') || (error && typeof error.code !== 'number' ? String(error.message) : '') });
    });
  });
}

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
// `pm list packages -3 -f`: Map package → its apk path (a new install gets a new folder, even for the same package).
export function parsePackages(text) {
  const m = new Map();
  for (const l of String(text ?? '').split(/\r?\n/)) { const x = /^package:(.+)=([\w.]+)\s*$/.exec(l.trim()); if (x) m.set(x[2], x[1]); }
  return m;
}
// The packages that are new or were installed again between two lists.
export const installedBetween = (before, after) => [...after].filter(([p, at]) => before.get(p) !== at).map(([p]) => p);

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
export const ANDROID_KEYS = Object.freeze(KEYS);
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
export function createAndroid({ board, log = () => {}, exe = adbPath, ensure = () => ensureAdb({ log }), now = () => Date.now(), pollMs = 1500, pairMs = 120_000 } = {}) {
  let pairing = null; // { name, password, qr, state, error, until, device, timer }
  const off = () => exe === adbPath && adbDisabled(); // tests and ORB_NO_ADB: Orb's own adb never runs
  const ready = async () => {
    if (off()) throw userError('msg.android.noAdb', { error: 'ORB_NO_ADB' });
    if (fs.existsSync(exe())) return exe();
    const st = await ensure();
    if (fs.existsSync(exe())) return exe();
    throw userError('msg.android.noAdb', { error: st?.error ?? '' });
  };
  const adb = async (args, opts) => runAdb(await ready(), args, opts);
  const text = (r) => r.out.toString('utf8');
  const known = () => { const v = board?.settingJson('android_devices'); return Array.isArray(v) ? v : []; };
  const remember = (list) => board?.settingJson('android_devices', list.slice(0, 20));

  async function connected() { const r = await adb(['devices', '-l'], { timeout: 15_000 }); return parseDevices(text(r)); }

  // After pairing: the phone's connection service (same guid, or the same address), then adb connect.
  async function connectAfterPair(host, guid) {
    for (let i = 0; i < 8; i++) {
      const list = parseMdns(text(await adb(['mdns', 'services'], { timeout: 10_000 })));
      const svc = list.find((x) => /_adb-tls-connect/.test(x.type) && ((guid && x.name.startsWith(guid)) || x.address.startsWith(`${host}:`)));
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
      const serial = await pick(a.serial);
      const before = parsePackages(text(await adb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3', '-f'], { timeout: 30_000 })));
      const r = await adb(['-s', serial, 'install', '-r', real], { timeout: 300_000 });
      const out = `${text(r)}\n${r.err}`.trim();
      if (!/\bSuccess\b/.test(out)) throw userError('msg.android.installFailed', { error: clipEnd(out, 400) });
      const after = parsePackages(text(await adb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3', '-f'], { timeout: 30_000 })));
      const pkgs = installedBetween(before, after);
      if (pkgs.length) board?.settingJson(installedKey(s), [...new Set([...installedBy(s), ...pkgs])].slice(-50));
      return { text: tr('msg.android.installed', { pkg: pkgs.join(', ') || '?', serial }) };
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
      if (!off() && fs.existsSync(exe())) { try { live = await connected(); } catch { live = []; } }
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
      for (const d of gone) if (d.serial && !off() && fs.existsSync(exe())) { try { await runAdb(exe(), ['disconnect', d.serial], { timeout: 15_000 }); } catch { /* not connected */ } }
      remember(list.filter((d) => !gone.includes(d)));
      log(`android: olvidado ${serial ?? host}`);
      return true;
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
      if (off() || !fs.existsSync(exe())) return false;
      try { await runAdb(exe(), ['kill-server'], { timeout: 10_000 }); } catch { /* not running */ }
      return true;
    }
  };
  return api;
}
