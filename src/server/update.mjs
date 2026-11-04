// 3.7, Orb Server updates itself within its minor version (3.7.x): the release's manifest.json, signed with the owner's
// ed25519 key (its public half is in release-key.mjs), names each package and its sha256. Nothing is installed whose
// signature or sum does not match. Before the switch, a «preupdate» backup of the data; then app/current points to the
// new version and the service starts again (systemd: Restart=always). The new version must stay healthy for 60 s: if it
// does not, current goes back to the previous version (and the launcher does the same after three failed starts).
//   app/<version>/            each version, unpacked
//   app/current               → the one running
//   app/update-pending.json   { from, to, at } while a new version proves itself (and app/update-from, for the launcher)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { RELEASE_PUBLIC_KEY } from './release-key.mjs';
import { extractTarGz } from './tar.mjs';
import { pointTo } from './engines.mjs';
import { AUTHOR } from '../core/product.mjs';

export const RELEASES = `https://github.com/${AUTHOR.repo}/releases`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 24 * 3600_000;
export const HEALTH_MS = 60_000;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

// ---- signatures (ed25519; the signature is base64 in <file>.sig)
export function verifySignature(data, signature, publicKey = RELEASE_PUBLIC_KEY) {
  if (!publicKey) return false;
  try { return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(publicKey), Buffer.from(String(signature).trim(), 'base64')); } catch { return false; }
}
export const signData = (data, privateKey) => crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(privateKey)).toString('base64');

// manifest.json, checked: its signature first, then its shape. Throws for anything off.
export function readManifest(data, signature, { publicKey = RELEASE_PUBLIC_KEY } = {}) {
  if (!publicKey) throw new Error('esta versión no tiene la clave pública de las versiones: no se actualiza sola');
  if (!verifySignature(data, signature, publicKey)) throw new Error('la firma del manifiesto no es válida: no se actualiza');
  let m; try { m = JSON.parse(Buffer.from(data).toString('utf8')); } catch { throw new Error('manifiesto ilegible'); }
  if (m?.product !== 'orb-server' || !VERSION.test(String(m.version)) || typeof m.assets !== 'object' || !m.assets) throw new Error('manifiesto no válido');
  for (const [name, a] of Object.entries(m.assets)) if (!/^[\w.-]+$/.test(name) || !/^[0-9a-f]{64}$/.test(String(a?.sha256))) throw new Error(`manifiesto no válido (${name})`);
  return m;
}
// The package of this machine in a manifest newer than `current` and of the same minor; null: nothing to do.
export function updateFor(manifest, current, arch = process.arch) {
  const a = VERSION.exec(String(current)); const b = VERSION.exec(String(manifest?.version));
  if (!a || !b || a[1] !== b[1] || a[2] !== b[2] || Number(b[3]) <= Number(a[3])) return null;
  const name = `orb-server-${manifest.version}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`;
  const asset = manifest.assets[name];
  return asset ? { version: manifest.version, name, sha256: asset.sha256, size: asset.size ?? null } : null;
}
export async function sha256File(file) { const h = crypto.createHash('sha256'); for await (const c of fs.createReadStream(file)) h.update(c); return h.digest('hex'); }

// The app/ folder of an installed Orb Server (the package runs from app/<version>), or null (a development copy).
export const appDirOf = (root = ROOT) => (path.basename(path.dirname(root)) === 'app' && VERSION.test(path.basename(root)) ? path.dirname(root) : null);
const pendingFile = (appDir) => path.join(appDir, 'update-pending.json');
export const readPending = (appDir) => { try { return JSON.parse(fs.readFileSync(pendingFile(appDir), 'utf8')); } catch { return null; } };
const clearPending = (appDir) => { for (const f of ['update-pending.json', 'update-from', 'update-tries']) fs.rmSync(path.join(appDir, f), { force: true }); };
// Back to the version that ran before the update. → the version, or null if there was nothing to undo.
export function rollback(appDir, log = () => {}) {
  const p = readPending(appDir);
  if (!p?.from || !VERSION.test(p.from) || !fs.existsSync(path.join(appDir, p.from))) { if (p) clearPending(appDir); return null; }
  pointTo(path.join(appDir, 'current'), path.join(appDir, p.from));
  clearPending(appDir);
  log(`actualización deshecha: vuelve la versión ${p.from}`);
  return p.from;
}
export function markHealthy(appDir, log = () => {}) { const p = readPending(appDir); if (!p) return false; clearPending(appDir); log(`la versión ${p.to} funciona bien: se queda`); return true; }

// The updater of one running Orb Server. restart(): how the service starts again (default: exit, systemd restarts it).
export function createUpdater({ home, version, log = () => {}, fetchImpl = fetch, base = process.env.ORB_RELEASES || RELEASES, publicKey = RELEASE_PUBLIC_KEY, appDir = appDirOf(), arch = process.arch,
  backup = null, restart = () => setTimeout(() => process.exit(0), 1000), auto = !process.env.ORB_FAKE_AGENTS, healthMs = HEALTH_MS } = {}) {
  const state = { version, available: null, checkedAt: null, error: null, applying: false, pending: appDir ? readPending(appDir) : null };
  const get = async (url) => { const r = await fetchImpl(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' }); if (!r.ok) throw new Error(`${path.basename(url)}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
  const latest = `${base.replace(/\/$/, '')}/latest/download`;

  async function check() {
    state.checkedAt = new Date().toISOString();
    try {
      const [data, sig] = await Promise.all([get(`${latest}/manifest.json`), get(`${latest}/manifest.json.sig`)]);
      const m = readManifest(data, sig.toString('utf8'), { publicKey });
      state.available = updateFor(m, version, arch); state.error = null;
      return { version, available: state.available };
    } catch (error) { state.error = error.message; throw error; }
  }
  async function apply() {
    if (!appDir) throw new Error('esta copia no está instalada como Orb Server (no hay carpeta app/)');
    if (state.applying) throw new Error('ya se está actualizando');
    state.applying = true;
    try {
      const up = state.available ?? (await check()).available;
      if (!up) return { updated: false, version };
      const tgz = path.join(appDir, `.descarga-${up.version}.tar.gz`);
      const dest = path.join(appDir, up.version);
      try {
        const r = await fetchImpl(`${base.replace(/\/$/, '')}/download/v${up.version}/${up.name}`, { signal: AbortSignal.timeout(30 * 60_000), redirect: 'follow' });
        if (!r.ok || !r.body) throw new Error(`${up.name}: ${r.status}`);
        await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tgz));
        if (await sha256File(tgz) !== up.sha256) throw new Error('la suma sha256 del paquete no coincide: no se actualiza');
        fs.rmSync(dest, { recursive: true, force: true });
        await extractTarGz(tgz, dest, { strip: 1 });
      } finally { fs.rmSync(tgz, { force: true }); }
      if (!fs.existsSync(path.join(dest, 'node', 'bin', 'node')) || !fs.existsSync(path.join(dest, 'src', 'server', 'orb-server.mjs'))) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error('el paquete nuevo está incompleto'); }
      // The data as they are now, before the new version touches them (src/server/host.mjs › backupOnUpgrade does it too).
      if (backup) await backup();
      else { const { backupOnUpgrade } = await import('./host.mjs'); await backupOnUpgrade(home, up.version, log, { force: true }); }
      fs.writeFileSync(pendingFile(appDir), `${JSON.stringify({ from: version, to: up.version, at: new Date().toISOString() })}\n`);
      fs.writeFileSync(path.join(appDir, 'update-from'), `${version}\n`);
      pointTo(path.join(appDir, 'current'), dest);
      log(`actualizado a ${up.version}: se reinicia`);
      restart();
      return { updated: true, version: up.version };
    } finally { state.applying = false; }
  }
  return {
    status: () => ({ ...state, auto, appDir, signed: Boolean(publicKey) }),
    check, apply,
    // Once a day, by itself (only an installed server with the release key).
    tick() {
      if (!auto || !appDir || !publicKey || state.applying) return;
      if (state.checkedAt && Date.now() - Date.parse(state.checkedAt) < DAY) return;
      state.checkedAt = new Date().toISOString();
      apply().catch((error) => log(`actualización: ${error.message}`));
    },
    // After a start: a version on probation stays only if healthy() says so for healthMs; otherwise back to the previous.
    afterStart({ healthy }) {
      if (!appDir) return null;
      const p = readPending(appDir);
      if (!p || p.to !== version) return null;
      return new Promise((resolve) => {
        const t = setTimeout(async () => {
          let ok = false; try { ok = await healthy(); } catch { ok = false; }
          if (ok) { markHealthy(appDir, log); resolve('kept'); return; }
          const back = rollback(appDir, log); resolve(back ? 'rolledBack' : 'none'); if (back) restart();
        }, healthMs);
        t.unref?.();
      });
    }
  };
}
