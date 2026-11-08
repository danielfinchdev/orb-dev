// The approval secret on disk, sealed by Windows, and its copy outside the workspace (the app's data folder): Windows'
// DPAPI in Rust (host.seal / host.unseal), ORB2 in core\datos\clave2.enc and claves\<key>.v2.enc (loadHostSecret). The
// tests use it with a fake seal.
//
// Orb 3.8.0 (Electron: still installed, reinstalled or portable) keeps its own files: safeStorage's v10 in
// core\datos\clave.enc and claves\<key>.enc, and makes a NEW secret when its clave.enc is not there or does not open
// (test/fixtures/approval-secret-3.8.0.mjs, its real code). So Orb reads its own ORB2 first and 3.8.0's v10 after, never
// writes, moves or renames 3.8.0's files, and makes 3.8.0's clave.enc only where there is none (see loadHostSecret): both
// open the same secret on the same workspace. And it never makes a new secret on its own: a key it cannot read now (a
// file or Local State busy, the app not answering) stops the start (SecretError 'busy': try again); sealed keys that none
// opens are the user's call (SecretError 'unreadable': try again, or start with a new key, allowNew).
//
// Every write: a temporary file of its own, flushed to disk, then renamed over the old one (the file always exists and
// is whole); what is replaced is copied aside first. A lock (clave.lock) keeps two starts from doing it at once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { restoredKey, forgetRestored } from '../core/restored-key.mjs';

const HEX = /^[0-9a-f]{64}$/;
// Milliseconds and a random tail: two files set aside in the same second never overwrite each other.
const stamp = () => `${new Date().toISOString().replace(/[-:.]/g, '').replace(/Z$/, '')}Z${crypto.randomBytes(2).toString('hex')}`;
const aside = (file, label) => file.replace(/\.enc$/, `.${stamp()}${label ? `.${label}` : ''}.enc`);
const TMP = (file) => `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;

// Written to a temporary file of its own, flushed (a power cut never leaves an empty key) and renamed over the file
// (MoveFileEx with replace: the file is never missing).
function writeWhole(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = TMP(file);
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (error) { fs.rmSync(tmp, { force: true }); throw error; }
}
// A copy kept aside before the file is replaced (never moved: the old one stays in place until the new one is there).
const keepAside = (file, label) => { const to = aside(file, label); fs.copyFileSync(file, to, fs.constants.COPYFILE_EXCL); return to; };

// One app at a time around the key files (Electron and Tauri opened at once, two starts in a row). On Windows the lock
// is a handle open with no sharing (libuv's UV_FS_O_EXLOCK): nobody else can open, rename or delete the file while it is
// held, and Windows lets it go when the app ends, however it ends: no age to guess, and a slow host.unseal never loses
// it. Elsewhere, a file made with 'wx' and taken over when older than STALE_MS. → whether it was taken.
export const EXLOCK = 0x10000000;
const STALE_MS = 30_000;
// → an open fd, null (held by another one: try again), or undefined (cannot be made here: go on without it).
export function exclusiveOpen(file) {
  if (process.platform === 'win32') {
    try { return fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_RDWR | EXLOCK); } catch (error) { return error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES' ? null : undefined; }
  }
  try { return fs.openSync(file, 'wx'); } catch (error) {
    if (error.code !== 'EEXIST') return undefined;
    // Taken over atomically: only one of two apps that both see an old lock renames it away; the other tries again.
    try {
      if (Date.now() - fs.statSync(file).mtimeMs <= STALE_MS) return null;
      const gone = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.old`;
      fs.renameSync(file, gone);
      fs.rmSync(gone, { force: true });
    } catch { /* another one took it first */ }
    return null;
  }
}
async function withLock(dir, wait, fn) {
  const lock = path.join(dir, 'clave.lock');
  let fd = null;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* fails below */ }
  const end = Date.now() + wait;
  for (;;) {
    const got = exclusiveOpen(lock);
    if (got === undefined) break;
    if (got !== null) { fd = got; try { fs.ftruncateSync(fd); fs.writeSync(fd, String(process.pid)); } catch { /* only informative */ } break; }
    if (Date.now() > end) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // Elsewhere ('wx'), kept fresh while held: a long host.unseal is not mistaken for a dead app.
  const beat = fd != null && process.platform !== 'win32' ? setInterval(() => { try { const now = new Date(); fs.futimesSync(fd, now, now); } catch { /* closed */ } }, 5000) : null;
  try { return await fn(fd != null); } finally {
    if (beat) clearInterval(beat);
    // Removed while still open (no one else can have it); on Windows a file open with no sharing cannot be deleted, so
    // it goes right after the close (if another app took it in between, its handle keeps it: nothing lost).
    if (fd != null) {
      if (process.platform !== 'win32') fs.rmSync(lock, { force: true });
      try { fs.closeSync(fd); } catch { /* closed */ }
      if (process.platform === 'win32') { try { fs.rmSync(lock, { force: true }); } catch { /* taken by another app */ } }
    }
  }
}

export class SecretError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}
export const secret2Files = (dir, copy) => ({ enc2: path.join(dir, 'clave2.enc'), copy2: copy.replace(/\.enc$/, '.v2.enc') });
// What host.unseal's typed errors mean (src-tauri/src/secrets.rs › UnsealError): 'io' and an app that does not answer
// are for now; the rest is how the key is.
const TRANSIENT = new Set(['io', 'timeout', 'noApp']);

// After «Empezar con una clave nueva» (allowNew): the sealed keys that did not open then, kept where they are or aside
// (clave-anterior.json in core\datos). At every later start, if Windows opens one of them again, the user is offered to go
// back to it (warn 'previousOpens'; src/engine/api-data.mjs › backup.previousKey asks for it with clave-volver.json, and
// the next start does it: the new key is kept aside in turn).
export const PREVIOUS_FILE = 'clave-anterior.json';
export const BACK_FILE = 'clave-volver.json';

// → { hex } | { absent } | { busy, why } | { bad, why }
async function tryOpen(file, unseal) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (error) { return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? { absent: true } : { busy: true, why: error.code ?? 'io' }; }
  try {
    const hex = await unseal(bytes);
    return HEX.test(hex) ? { hex } : { bad: true, why: 'text' };
  } catch (error) {
    return TRANSIENT.has(error?.code) ? { busy: true, why: error.code } : { bad: true, why: error?.code ?? 'error' };
  }
}

// A write cut before its rename (the first one of that file): a temporary that opens takes its place, but only when it
// holds the secret the other sealed keys open to (or none of them opens): a temporary of another secret (a new key whose
// rename never happened) never replaces the one the rest of the files agree on.
async function adoptTmp(file, unseal, others) {
  if (fs.existsSync(file)) return;
  let tmps = []; try { tmps = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.`) && n.endsWith('.tmp')); } catch { return; }
  const at = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const full = tmps.map((n) => path.join(path.dirname(file), n)).map((f) => ({ f, t: at(f) })).sort((a, b) => b.t - a.t).map((x) => x.f);
  let agreed;
  for (const tmp of full) {
    const { hex } = await tryOpen(tmp, unseal);
    if (!hex) continue;
    agreed ??= await others();
    if (agreed.length && !agreed.includes(hex)) continue;
    try { fs.renameSync(tmp, file); } catch { /* the next start */ }
    return;
  }
}

// Whether a restore (src/core/backup.mjs › applyPendingRestore, of any version) set `hex` aside after `file` was last
// written: the newest corentes-de-restaurar-* folder holding a sealed key holds that one, and it is newer than `file`.
async function restoredAfter(dir, file, hex, unseal) {
  const core = path.dirname(dir);
  let since; try { since = fs.statSync(file).mtimeMs; } catch { return false; }
  let folders = []; try { folders = fs.readdirSync(core).filter((n) => n.startsWith('antes-de-restaurar-')).map((n) => path.join(core, n)); } catch { return false; }
  const dated = folders.map((f) => { try { return { f, at: fs.statSync(f).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.at - a.at);
  for (const { f, at } of dated) {
    const keys = ['clave2.enc', 'clave.enc'].map((n) => path.join(f, 'core', 'datos', n)).filter((k) => fs.existsSync(k));
    if (!keys.length) continue;
    if (at <= since) return false;
    for (const k of keys) if ((await tryOpen(k, unseal)).hex === hex) return true;
    return false;
  }
  return false;
}

// The way back after «Empezar con una clave nueva» (PREVIOUS_FILE). → the secret to use now.
// And the way back from it (review D10 M6): going back keeps the new key aside and writes PREVIOUS_FILE again pointing at
// it ({ back: true }), so Ajustes › Datos can offer «Volver a la clave nueva» (warn 'newAvailable': no notice at every
// start, only the button; and 'previousQuiet' for the way back again). Each way is the same step: the key asked for in this app's files, the other one aside.
async function previousKey({ dir, enc2, copy2, hex, seal, unseal, warn }) {
  const record = path.join(dir, PREVIOUS_FILE); const back = path.join(dir, BACK_FILE);
  let saved; try { saved = JSON.parse(fs.readFileSync(record, 'utf8')); } catch { fs.rmSync(back, { force: true }); return hex; }
  const files = saved?.files; const toNew = saved?.back === true;
  if (!Array.isArray(files) || !files.some((f) => typeof f === 'string' && fs.existsSync(f))) { fs.rmSync(record, { force: true }); fs.rmSync(back, { force: true }); return hex; }
  let old = null;
  for (const f of files) { const r = typeof f === 'string' ? await tryOpen(f, unseal) : {}; if (r.hex && r.hex !== hex) { old = r.hex; break; } }
  if (!old) { fs.rmSync(back, { force: true }); return hex; }
  // A way back the user made by going one way is offered quietly (the button only); the first one is also said.
  if (!fs.existsSync(back)) { warn(toNew ? 'newAvailable' : saved.quiet ? 'previousQuiet' : 'previousOpens', toNew ? 'clave nueva' : 'clave anterior'); return hex; }
  // Asked for: that key in this app's files, the one in use now kept aside (and offered back).
  let fresh = null;
  try { fresh = await seal(old); if ((await unseal(fresh)) !== old) fresh = null; } catch { fresh = null; }
  if (!fresh) { warn('previousFailed', 'no se pudo sellar'); return hex; }
  const kept = [];
  for (const file of [enc2, copy2]) {
    try { if (fs.existsSync(file)) kept.push(keepAside(file, toNew ? 'anterior' : 'nueva')); writeWhole(file, fresh); } catch (error) { if (file === enc2) { warn('previousFailed', error.message); return hex; } }
  }
  fs.rmSync(back, { force: true });
  try { writeWhole(record, Buffer.from(JSON.stringify({ files: kept, at: new Date().toISOString(), back: !toNew, quiet: true }))); } catch { fs.rmSync(record, { force: true }); }
  warn(toNew ? 'previousNew' : 'previousBack', toNew ? 'clave nueva' : 'clave anterior');
  return old;
}

// Create a file only if it is not there (a hard link of a whole temporary: never replaces what another app wrote in
// between). A file system without hard links (exFAT, FAT, some network drives: review D10 B8) gets an exclusive copy
// instead, which also never replaces an existing file. → whether it was made.
function createOnly(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = TMP(file);
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(tmp, file); return true; } catch (error) {
    if (error.code === 'EEXIST') return false;
    try { fs.copyFileSync(tmp, file, fs.constants.COPYFILE_EXCL); console.error(`clave: sin enlaces duros en ${path.dirname(file)} (${error.code}); copia exclusiva`); return true; } catch { return false; }
  } finally { fs.rmSync(tmp, { force: true }); }
}

// dir, copy: as above (Electron's names: claves\<key>.enc; ORB2 goes beside it as <key>.v2.enc); seal/unseal: the app's
// (host.seal / host.unseal; unseal's errors carry a code); sealV10 (optional): Electron's v10 with the os_crypt key of
// the app's Local State (host.seal format 'v10'; throws code 'missing' when Orb on Electron never ran on this PC);
// allowNew: the user chose to start with a new key; warn(code, detail): what the user should know (logged and told).
// → the secret as hex, or throws SecretError.
//
// Orb 3.8.0 only reads its v10 clave.enc (and makes a new secret when it is not there). So that it keeps opening the
// same secret after 3.8.1, a clave.enc that is not there at all is made, as 3.8.0 would seal it, when Orb on Electron
// has run on this PC (its Local State exists); one that exists is never replaced. If it opens to another secret (3.8.0
// made its own before), the user is told: the two apps would not share approvals, links or backups.
// missingIsBusy: Electron's Local State not there counts as «for now» (a roaming profile or OneDrive not synced yet), as
// the engine does for the first starts.
export async function loadHostSecret({ dir, copy, seal, unseal, sealV10 = null, allowNew = false, warn = () => {}, missingIsBusy = false }) {
  const enc = path.join(dir, 'clave.enc'); const plain = path.join(dir, 'clave.bin');
  const { enc2, copy2 } = secret2Files(dir, copy);
  return withLock(dir, 10_000, async (locked) => {
    if (!locked) throw new SecretError('busy', 'clave.lock');
    const seen = new Map();
    const state = async (file) => { if (!seen.has(file)) seen.set(file, await tryOpen(file, unseal)); return seen.get(file); };
    let hex = null; let found = false;
    // A restored backup's key wins over everything from before the restore (kept aside below, never overwritten).
    let restored; try { restored = restoredKey(dir); } catch (error) { throw new SecretError('busy', error.message); }
    const unsealed = missingIsBusy ? async (b) => { try { return await unseal(b); } catch (error) { throw error?.code === 'missing' ? Object.assign(new Error(error.message), { code: 'io' }) : error; } } : unseal;
    let lost = []; // allowNew: the sealed files that did not open, for the way back
    if (restored) {
      hex = restored;
      // The way back to a key from before the restore is gone with it (review D10 M4/M5; backup.mjs sets them aside too).
      for (const f of [PREVIOUS_FILE, BACK_FILE]) fs.rmSync(path.join(dir, f), { force: true });
    }
    else {
      const others = async () => { const out = []; for (const f of [copy2, enc, copy]) { const r = await tryOpen(f, unseal); if (r.hex) out.push(r.hex); } return out; };
      await adoptTmp(enc2, unseal, others); await adoptTmp(copy2, unseal, async () => { const r = await tryOpen(enc2, unseal); return r.hex ? [r.hex] : others(); });
      let from = null;
      for (const file of [enc2, copy2, enc, copy]) {
        const r = await tryOpen(file, unsealed); seen.set(file, r);
        if (r.busy) throw new SecretError('busy', `${path.basename(file)}: ${r.why}`);
        if (r.hex) { hex = r.hex; found = true; from = file; break; }
      }
      // A backup restored by Orb 3.8.0 after this app last ran: 3.8.0 only knows its own files, so it sealed the
      // restored key in clave.enc and left the ORB2 ones as they were. Its restore set the key from before aside in
      // corentes-de-restaurar-<date>: that key is the ORB2 one and the folder is newer than the ORB2 file → clave.enc wins.
      if (from === enc2 || from === copy2) {
        const v10 = await state(enc);
        if (v10.hex && v10.hex !== hex && await restoredAfter(dir, from, hex, unseal)) hex = v10.hex;
      }
      const sealedExists = [...seen.values()].some((r) => !r.absent);
      if (!hex) {
        if (sealedExists && !allowNew) throw new SecretError('unreadable', [...seen].map(([f, r]) => `${path.basename(f)}: ${r.why ?? 'no está'}`).join(', '));
        if (sealedExists) lost = [...seen].filter(([, r]) => !r.absent).map(([f]) => f);
        try { const b = fs.readFileSync(plain); hex = !sealedExists && b.length >= 32 ? b.subarray(0, 32).toString('hex') : null; } catch { hex = null; }
        hex ??= crypto.randomBytes(32).toString('hex');
      }
    }
    // ORB2 in its own files, checked before anything is replaced: it must open again to the same secret.
    const stale = async (file) => { const r = await state(file); return r.hex !== hex && !r.busy; }; // busy: the next start
    const todo = [];
    for (const file of [enc2, copy2]) if (await stale(file)) todo.push(file);
    let kept = (await state(enc2)).hex === hex;
    if (todo.length) {
      let fresh = null; let checked = false;
      try { fresh = await seal(hex); checked = (await unseal(fresh)) === hex; } catch { checked = false; }
      for (const file of checked ? todo : []) {
        try {
          const r = seen.get(file);
          if (!r.absent) { const to = keepAside(file, r.hex ? '' : 'ilegible'); lost = lost.map((f) => (f === file ? to : f)); } // another secret, or one that does not open: kept
          writeWhole(file, fresh);
          if (file === enc2) kept = true;
        } catch { /* the next start */ }
      }
    }
    // A secret that exists nowhere else (new, restored, or from clave.bin) must be on disk before it is used.
    if (!found && !kept) throw new SecretError('busy', 'no se pudo guardar la clave');
    if (kept) forgetRestored(dir);
    if (lost.length && kept) { try { writeWhole(path.join(dir, PREVIOUS_FILE), Buffer.from(JSON.stringify({ files: lost, at: new Date().toISOString() }))); } catch { /* no way back offered */ } }
    else if (found && !allowNew) hex = await previousKey({ dir, enc2, copy2, hex, seal, unseal, warn });
    // Orb 3.8.0's clave.enc (review D-fix M1).
    const v10 = await state(enc);
    if (v10.absent && sealV10) {
      try {
        const sealed = await sealV10(hex);
        if ((await unseal(sealed)) === hex && createOnly(enc, sealed)) seen.set(enc, { hex });
      } catch (error) {
        if (error?.code !== 'missing') warn('v10Failed', error?.message ?? String(error));
      }
    } else if (v10.hex && v10.hex !== hex) warn('twoKeys', 'clave.enc');
    return hex;
  });
}

// Rust seals with DPAPI as ORB2 and still reads Electron's v10 (with the Local State of the app's data
// folder, never changed). hostCall: src/engine/host.mjs (its errors carry Rust's code).
export const ORB2 = Buffer.from('ORB2');
export function hostSealing(hostCall) {
  return {
    seal: async (hex) => Buffer.from(String((await hostCall('host.seal', { text: hex }))?.data ?? ''), 'base64'),
    sealV10: async (hex) => Buffer.from(String((await hostCall('host.seal', { text: hex, format: 'v10' }))?.data ?? ''), 'base64'),
    unseal: async (buf) => String((await hostCall('host.unseal', { data: buf.toString('base64') }))?.text ?? '')
  };
}

// Whether a notice about `file` was already given for the file as it is now (review D10 B9: «two keys» once, not at every
// start): its fingerprint is kept in the board's setting `key`; a file that changes is said again. → true to stay quiet.
export function saidFor(board, key, file) {
  let fp; try { fp = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 32); } catch { return false; }
  if (board.setting(key) === fp) return true;
  board.setting(key, fp);
  return false;
}
