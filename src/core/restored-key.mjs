// A restored backup's key (3.8.1, review Tauri D-fix A1). applyPendingRestore (backup.mjs) puts the backup's plain
// clave.bin in core\datos, sets aside every sealed key of core (clave.enc, clave2.enc) and leaves this marker with the
// fingerprint of that clave.bin. The next start of either app (src/engine/approval-secret.mjs) seals it, and it wins over
// the sealed copies outside the workspace, which still hold the secret from before the restore (kept aside, never lost).
// Without the marker a clave.bin never wins over a sealed key: it is the plain key of a new workspace, or one left behind.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RESTORE_MARKER = 'clave-restaurada.json';
const fingerprint = (key) => crypto.createHash('sha256').update(key.subarray(0, 32)).digest('hex');

// dir: core\datos, with the restored clave.bin in it. → whether the marker was written.
export function markRestoredKey(dir) {
  const key = fs.readFileSync(path.join(dir, 'clave.bin'));
  if (key.length < 32) return false;
  const file = path.join(dir, RESTORE_MARKER); const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ sha256: fingerprint(key), at: new Date().toISOString() }));
  fs.renameSync(tmp, file);
  return true;
}

// → the restored secret as hex, or null (no marker, or one that is not about this clave.bin: then it is removed).
// A read that fails for now (in use, no access: an antivirus, a sync tool) throws { code: 'busy' } and removes nothing
// (review D10 B5): only a marker that is not JSON, or whose fingerprint does not match the clave.bin there, goes.
const busy = (error) => Object.assign(new Error(`clave restaurada: ${error.code ?? error.message}`), { code: 'busy' });
export function restoredKey(dir) {
  const marker = path.join(dir, RESTORE_MARKER);
  let raw; try { raw = fs.readFileSync(marker, 'utf8'); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw busy(error); }
  let want; try { want = JSON.parse(raw)?.sha256; } catch { want = null; }
  if (typeof want !== 'string') { fs.rmSync(marker, { force: true }); return null; }
  let key = null; try { key = fs.readFileSync(path.join(dir, 'clave.bin')); } catch (error) { if (error.code !== 'ENOENT') throw busy(error); }
  if (key && key.length >= 32 && fingerprint(key) === want) return key.subarray(0, 32).toString('hex');
  fs.rmSync(marker, { force: true });
  return null;
}

// Once the restored key is sealed on disk: the plain key and its marker go.
export function forgetRestored(dir) {
  fs.rmSync(path.join(dir, 'clave.bin'), { force: true });
  fs.rmSync(path.join(dir, RESTORE_MARKER), { force: true });
}
