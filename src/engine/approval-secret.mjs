// This PC's secret (the approval secret) lives in Rust since 3.8.1 (decision 20 d): Orb.exe's vault opens and seals it
// (src-tauri/vault/src/machine.rs: ORB2 in core\datos\clave2.enc and its copy outside the workspace) and the engine only
// gets the keys made from it (src/core/machine-keys.mjs). What stays here: the names of those files, the file Ajustes ›
// Datos writes to go back to an earlier key, and the no-sharing open the engine also uses to hold its workspace.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// One app at a time around a file. On Windows a handle open with no sharing (libuv's UV_FS_O_EXLOCK): nobody else can
// open, rename or delete the file while it is held, and Windows lets it go when the app ends, however it ends.
// Elsewhere, a file made with 'wx' and taken over when older than STALE_MS.
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
// The sealed copies (machine.rs): core\datos\clave2.enc, and claves\<key>.v2.enc beside the copy's old name.
export const secret2Files = (dir, copy) => ({ enc2: path.join(dir, 'clave2.enc'), copy2: copy.replace(/\.enc$/, '.v2.enc') });
// «Volver a la clave anterior / nueva» (Ajustes › Datos): the next start does it (machine.rs › previous_key).
export const BACK_FILE = 'clave-volver.json';
