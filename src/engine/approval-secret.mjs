// The approval secret on disk, sealed by the system, and its copy outside the workspace (the app's data folder). No
// Electron imports: the tests use it with a fake seal. Two apps keep it, each in its own files, so that either can run
// on the same workspace after the other without ever making a new secret:
//
//   Electron (Orb up to 3.8.0, and main.mjs): safeStorage's v10 in core\datos\clave.enc and claves\<key>.enc
//     (loadApprovalSecret, the same rules as 3.8.0):
//     - clave.enc opens: it is the secret; the copy is brought up to date.
//     - It is gone or cannot be read (core deleted or damaged): the copy outside, put back. A clave.enc that cannot be
//       read is kept aside (clave.<date>.ilegible.enc), never overwritten: another Windows user may still open it.
//     - Neither: the plain clave.bin of a new workspace (only when no sealed key exists at all), or a new secret.
//     The copy outside is never replaced by a different secret: one that holds another secret (or cannot be read) is
//     put aside first (<name>.<date>.enc), since old backups may only open with it.
//
//   Tauri (3.8.1): Windows' DPAPI in Rust (host.seal / host.unseal), ORB2 in core\datos\clave2.enc and
//     claves\<key>.v2.enc (loadHostSecret). It reads its own ORB2 first and Electron's v10 after, and NEVER writes,
//     moves or renames Electron's files: Orb 3.8.0 (still installed, reinstalled, portable) opens its clave.enc as it
//     always did, and would make a new secret if it found anything else there. And it never makes a new secret on its
//     own: a key it cannot read now (a file or Local State busy, the app not answering) stops the start (SecretError
//     'busy': try again); sealed keys that none opens are the user's call (SecretError 'unreadable': try again, or
//     start with a new key, allowNew).
//
// Every write: a temporary file of its own, flushed to disk, then renamed over the old one (the file always exists and
// is whole); what is replaced is copied aside first. A lock file (clave.lock) keeps two apps from doing it at once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
const keepAside = (file, label) => fs.copyFileSync(file, aside(file, label), fs.constants.COPYFILE_EXCL);

// One app at a time around the key files (Electron and Tauri opened at once, two starts in a row). A lock older than
// STALE_MS is from an app that died holding it. → whether it was taken.
const STALE_MS = 30_000;
async function withLock(dir, wait, fn) {
  const lock = path.join(dir, 'clave.lock');
  let fd = null;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* fails below */ }
  const end = Date.now() + wait;
  while (fd == null) {
    try { fd = fs.openSync(lock, 'wx'); fs.writeSync(fd, String(process.pid)); break; } catch (error) {
      if (error.code !== 'EEXIST') break;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > STALE_MS) { fs.rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (Date.now() > end) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try { return await fn(fd != null); } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch { /* closed */ } fs.rmSync(lock, { force: true }); }
  }
}

// ---- Electron (3.8.0's rules; its files only) -------------------------------------------------------------------------

// dir: the data folder (clave.enc, clave.bin); copy: the file outside; seal(hex) → Buffer; unseal(Buffer) → string (both
// may return a promise). → the secret as hex.
export async function loadApprovalSecret({ dir, copy, seal, unseal }) {
  const enc = path.join(dir, 'clave.enc'); const plain = path.join(dir, 'clave.bin');
  const open = async (file) => { try { const hex = await unseal(fs.readFileSync(file)); return HEX.test(hex) ? hex : null; } catch { return null; } };
  const keep = async (sealed, hex) => {
    try {
      if (fs.existsSync(copy)) {
        if (fs.readFileSync(copy).equals(sealed)) return;
        if (await open(copy) !== hex) keepAside(copy);
      }
      writeWhole(copy, sealed);
    } catch { /* the next start */ }
  };
  return withLock(dir, 5000, async () => {
    let hex = await open(enc);
    if (hex) { fs.rmSync(plain, { force: true }); await keep(fs.readFileSync(enc), hex); return hex; }
    hex = await open(copy);
    if (!hex) {
      // The plain key of a new workspace only when no sealed one exists: one that could not be read never loses to it.
      const sealedExists = [enc, copy].some((f) => fs.existsSync(f));
      try { const b = fs.readFileSync(plain); hex = !sealedExists && b.length >= 32 ? b.subarray(0, 32).toString('hex') : null; } catch { hex = null; }
      hex ??= crypto.randomBytes(32).toString('hex');
    }
    const sealed = await seal(hex);
    if (fs.existsSync(enc)) { try { keepAside(enc, 'ilegible'); } catch { /* replaced below */ } }
    writeWhole(enc, sealed);
    fs.rmSync(plain, { force: true });
    await keep(sealed, hex);
    return hex;
  });
}

// ---- Tauri (ORB2 in its own files; Electron's read, never touched) ---------------------------------------------------

export class SecretError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}
export const secret2Files = (dir, copy) => ({ enc2: path.join(dir, 'clave2.enc'), copy2: copy.replace(/\.enc$/, '.v2.enc') });
// What host.unseal's typed errors mean (src-tauri/src/secrets.rs › UnsealError): 'io' and an app that does not answer
// are for now; the rest is how the key is.
const TRANSIENT = new Set(['io', 'timeout', 'noApp']);

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

// A write cut before its rename (the first one of that file): the newest temporary that opens takes its place.
async function adoptTmp(file, unseal) {
  if (fs.existsSync(file)) return;
  let tmps = []; try { tmps = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.`) && n.endsWith('.tmp')); } catch { return; }
  const full = tmps.map((n) => path.join(path.dirname(file), n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const tmp of full) {
    if ((await tryOpen(tmp, unseal)).hex) { try { fs.renameSync(tmp, file); return; } catch { return; } }
  }
}

// dir, copy: as above (Electron's names: claves\<key>.enc; ORB2 goes beside it as <key>.v2.enc); seal/unseal: the app's
// (host.seal / host.unseal; unseal's errors carry a code); allowNew: the user chose to start with a new key.
// → the secret as hex, or throws SecretError.
export async function loadHostSecret({ dir, copy, seal, unseal, allowNew = false }) {
  const enc = path.join(dir, 'clave.enc'); const plain = path.join(dir, 'clave.bin');
  const { enc2, copy2 } = secret2Files(dir, copy);
  return withLock(dir, 10_000, async (locked) => {
    if (!locked) throw new SecretError('busy', 'clave.lock');
    await adoptTmp(enc2, unseal); await adoptTmp(copy2, unseal);
    const seen = new Map();
    let hex = null; let found = false;
    for (const file of [enc2, copy2, enc, copy]) {
      const r = await tryOpen(file, unseal); seen.set(file, r);
      if (r.busy) throw new SecretError('busy', `${path.basename(file)}: ${r.why}`);
      if (r.hex) { hex = r.hex; found = true; break; }
    }
    const sealedExists = [...seen.values()].some((r) => !r.absent);
    if (!hex) {
      if (sealedExists && !allowNew) throw new SecretError('unreadable', [...seen].map(([f, r]) => `${path.basename(f)}: ${r.why ?? 'no está'}`).join(', '));
      try { const b = fs.readFileSync(plain); hex = !sealedExists && b.length >= 32 ? b.subarray(0, 32).toString('hex') : null; } catch { hex = null; }
      hex ??= crypto.randomBytes(32).toString('hex');
    }
    // ORB2 in its own files, checked before anything is replaced: it must open again to the same secret.
    const state = async (file) => { if (!seen.has(file)) seen.set(file, await tryOpen(file, unseal)); return seen.get(file); };
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
          if (!r.absent) keepAside(file, r.hex ? '' : 'ilegible'); // another secret, or one that does not open: kept
          writeWhole(file, fresh);
          if (file === enc2) kept = true;
        } catch { /* the next start */ }
      }
    }
    // A secret that exists nowhere else (new, or from clave.bin) must be on disk before it is used.
    if (!found && !kept) throw new SecretError('busy', 'no se pudo guardar la clave');
    if (kept) fs.rmSync(plain, { force: true });
    return hex;
  });
}

// Under Tauri: Rust seals with DPAPI as ORB2 and still reads Electron's v10 (with the Local State of the app's data
// folder, never changed). hostCall: src/engine/host.mjs (its errors carry Rust's code).
export const ORB2 = Buffer.from('ORB2');
export function hostSealing(hostCall) {
  return {
    seal: async (hex) => Buffer.from(String((await hostCall('host.seal', { text: hex }))?.data ?? ''), 'base64'),
    unseal: async (buf) => String((await hostCall('host.unseal', { data: buf.toString('base64') }))?.text ?? '')
  };
}
