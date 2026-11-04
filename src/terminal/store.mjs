// 3.5, Orb en la terminal: where the terminal client keeps its links and how it opens them.
//   ~/.orb-terminal/clave.bin       32 random bytes made here the first time (0600): the key that seals enlaces.json
//   ~/.orb-terminal/enlaces.json    the keys of each linked Orb (src/core/link.mjs, sealed, 0600)
//   ~/.orb-terminal/preferencias.json  the Orb used last (no secrets)
// ORB_TERMINAL_HOME changes the folder (tests, several identities on one machine).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLink } from '../core/link.mjs';

export const terminalHome = (env = process.env) => path.resolve(env.ORB_TERMINAL_HOME || path.join(os.homedir(), '.orb-terminal'));

// The key of this terminal: made once, readable by its owner only.
export function terminalSecret(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'clave.bin');
  try {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw Object.assign(new Error(`${file} no es válida (bórrala y vuelve a enlazar)`), { fatal: true });
    return key;
  } catch (error) {
    if (error.fatal || error.code !== 'ENOENT') throw error;
  }
  const key = crypto.randomBytes(32);
  try { fs.writeFileSync(file, key, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code === 'EEXIST') return terminalSecret(dir); throw error; }
  if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600); } catch { /* best effort */ } }
  return key;
}

const prefsFile = (dir) => path.join(dir, 'preferencias.json');
export function readPrefs(dir) { try { return JSON.parse(fs.readFileSync(prefsFile(dir), 'utf8')) ?? {}; } catch { return {}; } }
export function writePrefs(dir, patch) {
  const next = { ...readPrefs(dir), ...patch };
  try { fs.writeFileSync(prefsFile(dir), JSON.stringify(next, null, 2), { mode: 0o600 }); } catch { /* not important */ }
  return next;
}

// The link store of this terminal (createLink of src/core/link.mjs), with the identity a terminal shows the other Orb.
export function openLinks({ dir = terminalHome(), name = null, fetch: f } = {}) {
  const secret = terminalSecret(dir);
  const file = path.join(dir, 'enlaces.json');
  const link = createLink({ file, secret, identity: () => ({ kind: 'terminal', name: name ?? `Terminal (${os.hostname()})`.slice(0, 60) }), ...(f ? { fetch: f } : {}) });
  if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600); } catch { /* not there yet */ } }
  return { link, dir, file };
}

// Which linked Orb to use: the one named (by id or name, any case, also the start of the name), else the one used last,
// else the only one. Revoked links are skipped unless named. → { peer } | { error: 'none' | 'many' | 'unknown', list }
export function pickPeer(peers, wanted, last = null) {
  const live = peers.filter((p) => !p.revoked);
  if (wanted) {
    const w = String(wanted).toLowerCase();
    const hit = peers.find((p) => p.id === wanted) ?? peers.find((p) => String(p.name).toLowerCase() === w) ?? peers.find((p) => String(p.name).toLowerCase().startsWith(w));
    return hit ? { peer: hit } : { error: 'unknown', list: peers };
  }
  if (!peers.length) return { error: 'none', list: [] };
  if (live.length === 1) return { peer: live[0] };
  const lastOne = live.find((p) => p.id === last);
  if (lastOne) return { peer: lastOne };
  if (!live.length) return { peer: peers[0] }; // all closed: say so for the first one
  return { error: 'many', list: live };
}
