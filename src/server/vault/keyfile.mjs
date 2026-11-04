// 3.7 (Orb Server): the vault's own key file, kept AWAY from the data folder. The seal of the vault's sign-ins and sync
// cache (data/vault/) is derived from BOTH the server key (data/datos/clave.bin) and this file:
//   ~/.config/orb-server/vault-<home>.key   (folder 0700, file 0600; $XDG_CONFIG_HOME is honoured; ORB_VAULT_KEY_DIR for tests)
// so a copy of ~/orb-server (a backup tarball, a disk image of the data folder, a bot that reached data/) is not enough
// to open the vault: the key file lives outside it and is never in Orb's backups. Lose it (a new server restored from a
// backup) and the vault's sign-in has to be entered again (nothing else is lost: the vault itself is Bitwarden's).
// Residual risk, documented: the file is still the same Unix user's, so a process running as that user with free file
// access (an agent that escaped Orb's guard) can read both; only a separate system user for the vault worker fixes that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function vaultKeyDir(env = process.env) {
  if (env.ORB_VAULT_KEY_DIR) return path.resolve(env.ORB_VAULT_KEY_DIR);
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(os.homedir(), '.config');
  return path.join(base, 'orb-server');
}
// One file per Orb folder (a second Orb Server of the same user, or a test, never shares it).
export const vaultKeyFile = (home, env = process.env) => path.join(vaultKeyDir(env), `vault-${crypto.createHash('sha256').update(path.resolve(String(home))).digest('hex').slice(0, 12)}.key`);

// The 32 random bytes of the file, made the first time (atomically, 0600 in a 0700 folder). A file that is not 32 bytes
// is never replaced silently (that would lose the vault's sign-in): it throws.
export function loadVaultFileKey(file) {
  try {
    const k = fs.readFileSync(file);
    if (k.length !== 32) throw Object.assign(new Error(`clave de la bóveda dañada: ${file}`), { code: 'BAD_VAULT_KEY' });
    return k;
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* Windows */ }
  const k = crypto.randomBytes(32);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, k, { mode: 0o600 });
  try { fs.linkSync(tmp, file); } catch (error) { if (error?.code !== 'EEXIST') { fs.rmSync(tmp, { force: true }); throw error; } }
  fs.rmSync(tmp, { force: true });
  return loadVaultFileKey(file);
}
