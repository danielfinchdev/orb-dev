// The approval secret on disk, sealed by the system, and its copy outside the workspace (the app's data folder). The
// sealing is the app's: Electron's safeStorage (main.mjs) or, under Tauri, Windows' DPAPI in Rust (host.seal /
// host.unseal, asked by the engine: engine.mjs). No Electron imports: the tests use it with a fake seal.
//   - core\datos\clave.enc opens: it is the secret; the copy is brought up to date. Sealed in an older format (stale: 3.8.1
//     reads Electron's v10 and writes ORB2), it is sealed again; the old file is kept as clave.<date>.<format>.enc, and
//     the copy's old file as <name>.<date>.<format>.enc.
//   - It is gone or cannot be read (core deleted or damaged): the copy outside, put back. A clave.enc that cannot be read
//     is kept aside (clave.<date>.ilegible.enc), never overwritten: another Windows user may still open it.
//   - Neither, but an older sealing kept aside opens (an app that cannot read the new format: Electron after 3.8.1 ran):
//     that one.
//   - Nothing: the plain clave.bin of a new workspace, or a new secret (another PC: old approvals are asked again).
// The copy outside is never replaced by a different secret: one that holds another secret (or cannot be read) is put
// aside first (<name>.<date>.enc), since old backups may only open with it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const aside = (file, label) => file.replace(/\.enc$/, `.${stamp()}${label ? `.${label}` : ''}.enc`);
// Written next to it and renamed: a crash never leaves half a key.
const writeWhole = (file, bytes) => { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); };
// An older sealing kept aside by a migration: clave.20261108T101500Z.v10.enc (not an unreadable one).
const OLDER = /^clave\.\d{8}T\d{6}Z\.(?!ilegible\.)[a-z0-9]+\.enc$/;

// dir: the data folder (clave.enc, clave.bin); copy: the file outside; seal(hex) → Buffer; unseal(Buffer) → string (both
// may return a promise); stale(Buffer) → false, or the name of the older format to seal again (e.g. 'v10').
// → the secret as hex.
export async function loadApprovalSecret({ dir, copy, seal, unseal, stale = () => false }) {
  const enc = path.join(dir, 'clave.enc'); const plain = path.join(dir, 'clave.bin');
  const open = async (file) => { try { const hex = await unseal(fs.readFileSync(file)); return /^[0-9a-f]{64}$/.test(hex) ? hex : null; } catch { return null; } };
  const keep = async (sealed, hex) => {
    try {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      if (fs.existsSync(copy)) {
        const before = fs.readFileSync(copy);
        if (before.equals(sealed)) return;
        if (await open(copy) !== hex) fs.renameSync(copy, aside(copy));
        else if (stale(before)) fs.renameSync(copy, aside(copy, stale(before)));
      }
      writeWhole(copy, sealed);
    } catch { /* the next start */ }
  };
  let hex = await open(enc);
  if (hex) {
    fs.rmSync(plain, { force: true });
    let sealed = fs.readFileSync(enc);
    const old = stale(sealed);
    if (old) {
      try {
        const fresh = await seal(hex);
        fs.writeFileSync(`${enc}.tmp`, fresh);
        fs.renameSync(enc, aside(enc, old));
        fs.renameSync(`${enc}.tmp`, enc);
        sealed = fresh;
      } catch { /* sealed again at the next start; the old one still opens */ }
    }
    await keep(sealed, hex);
    return hex;
  }
  hex = fs.existsSync(plain) ? null : await open(copy);
  if (!hex && !fs.existsSync(plain)) {
    let older = []; try { older = fs.readdirSync(dir).filter((n) => OLDER.test(n)).sort().reverse(); } catch { /* no folder */ }
    for (const name of older) { hex = await open(path.join(dir, name)); if (hex) break; }
  }
  if (!hex) {
    try { const b = fs.readFileSync(plain); hex = b.length >= 32 ? b.subarray(0, 32).toString('hex') : null; } catch { hex = null; }
    hex ??= crypto.randomBytes(32).toString('hex');
  }
  const sealed = await seal(hex);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(enc)) { try { fs.renameSync(enc, path.join(dir, `clave.${stamp()}.ilegible.enc`)); } catch { /* overwritten below */ } }
  writeWhole(enc, sealed);
  fs.rmSync(plain, { force: true });
  await keep(sealed, hex);
  return hex;
}

// Under Tauri: Rust seals with DPAPI as ORB2 and still reads Electron's v10 (with the Local State of the app's data
// folder, never changed). hostCall: src/engine/host.mjs.
export const ORB2 = Buffer.from('ORB2');
export const staleSealing = (buf) => (buf.subarray(0, 4).equals(ORB2) ? false : buf.subarray(0, 3).toString('latin1') === 'v10' ? 'v10' : false);
export function hostSealing(hostCall) {
  return {
    seal: async (hex) => Buffer.from(String((await hostCall('host.seal', { text: hex }))?.data ?? ''), 'base64'),
    unseal: async (buf) => String((await hostCall('host.unseal', { data: buf.toString('base64') }))?.text ?? ''),
    stale: staleSealing
  };
}
