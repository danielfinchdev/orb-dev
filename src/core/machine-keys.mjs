// The keys made from this PC's secret (3.8.1, decision 20 d): one signs the approvals, the other wraps this PC's backups
// and its recovery wrap. With the app the secret stays in Rust (src-tauri/vault/src/machine.rs) and the engine is handed
// only these two keys (ctx.keys, from src/core/master.mjs › openMachine). Without the app (tests, a run from the code)
// the secret is the plain core\datos\clave.bin, or one the engine was given, and they are made here the same way.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ctx } from './context.mjs';
import { paths, readKey } from './home.mjs';

export const approvalKeyOf = (secret) => crypto.createHmac('sha256', secret).update('orb-approval-v2').digest();
export const backupKeyOf = (secret) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('orb-backup'), Buffer.from('machine-v1'), 32));
export const keysOf = (secret) => ({ approval: approvalKeyOf(secret), backup: backupKeyOf(secret) });

// → { approval, backup }, or null without a secret. create: make clave.bin when there is none (approvals, a backup asked
// for); otherwise only an existing one counts.
export function machineKeys({ create = true, home = ctx.home } = {}) {
  if (ctx.keys) return ctx.keys;
  let secret = null;
  if (create) secret = readKey(home);
  else { try { const k = fs.readFileSync(paths(home).key); secret = k.length >= 32 ? k : null; } catch { secret = null; } }
  return secret ? keysOf(secret) : null;
}
