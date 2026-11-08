// Orb 3.8.0's src/main/approval-secret.mjs, verbatim from git (branch orb-3.8, the published Electron): what an installed
// 3.8.0 does with the key files. Only for test/clave-compatible.test.mjs: never imported by Orb.
// The approval secret on disk, sealed by the system (main.mjs passes Electron's safeStorage as seal/open), and its copy
// outside the workspace (the app's data folder). No Electron imports: the tests use it with a fake seal.
//   - core\datos\clave.enc opens: it is the secret; the copy is brought up to date.
//   - It is gone or cannot be read (core deleted or damaged): the copy outside, put back. A clave.enc that cannot be read
//     is kept aside (clave.<date>.ilegible.enc), never overwritten: another Windows user may still open it.
//   - Neither: the plain clave.bin of a new workspace, or a new secret (another PC: old approvals are asked again).
// The copy outside is never replaced by a different secret: one that holds another secret (or cannot be read) is put
// aside first (<name>.<date>.enc), since old backups may only open with it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// dir: the data folder (clave.enc, clave.bin); copy: the file outside; seal(hex) → Buffer; unseal(Buffer) → string.
// → the secret as hex.
export function loadApprovalSecret({ dir, copy, seal, unseal }) {
  const enc = path.join(dir, 'clave.enc'); const plain = path.join(dir, 'clave.bin');
  const open = (file) => { try { const hex = unseal(fs.readFileSync(file)); return /^[0-9a-f]{64}$/.test(hex) ? hex : null; } catch { return null; } };
  const keep = (sealed, hex) => {
    try {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      if (fs.existsSync(copy)) {
        if (fs.readFileSync(copy).equals(sealed)) return;
        if (open(copy) !== hex) fs.renameSync(copy, copy.replace(/\.enc$/, `.${stamp()}.enc`));
      }
      fs.writeFileSync(copy, sealed);
    } catch { /* the next start */ }
  };
  let hex = open(enc);
  if (hex) { fs.rmSync(plain, { force: true }); keep(fs.readFileSync(enc), hex); return hex; }
  hex = fs.existsSync(plain) ? null : open(copy);
  if (!hex) {
    try { const b = fs.readFileSync(plain); hex = b.length >= 32 ? b.subarray(0, 32).toString('hex') : null; } catch { hex = null; }
    hex ??= crypto.randomBytes(32).toString('hex');
  }
  const sealed = seal(hex);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(enc)) { try { fs.renameSync(enc, path.join(dir, `clave.${stamp()}.ilegible.enc`)); } catch { /* overwritten below */ } }
  fs.writeFileSync(enc, sealed);
  fs.rmSync(plain, { force: true });
  keep(sealed, hex);
  return hex;
}
