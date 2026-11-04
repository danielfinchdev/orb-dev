// 3.7, Orb Server's agent engines: Claude (the official Agent SDK's Linux package, its `claude` program) and Codex (the
// official @openai/codex Linux package) are not in the download; they come from the npm registry the first time a bot or a
// sign-in needs them, checked against the registry's own sha512 (dist.integrity), into ~/orb-server/engines/<id>/. They
// update by themselves to the newest version of the same major (Claude: the same 0.x line as the bundled SDK). Chromium
// comes later (WS5) with its own pinned revision and sha256.
//   engines/<id>/<version>/…    the unpacked package (npm's «package/» dropped)
//   engines/<id>/current        → <version>
//   engines/<id>/run            what the agents' adapters run (src/agents/claude.mjs, codex.mjs › detect): on Linux it
//                               starts the program in its own `systemd-run --user --scope` (MemoryMax; oom_score_adj 500) and
//                               with no_new_privs (setpriv), so an agent can never raise its privileges nor take the
//                               engine's memory
//   engines/<id>/engine.json    { version, integrity, bin, at, checkedAt }
// Engines run only while a bot thinks: the bots close their agent after bots.idleMinutes; createIdle below closes any
// other engine process (Chromium) after its idle minutes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { extractTarGz } from './tar.mjs';

export const REGISTRY = 'https://registry.npmjs.org';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 24 * 3600_000;

// ---- versions (semver without prereleases)
export const parseVersion = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '')); return m ? m.slice(1).map(Number) : null; };
export const compareVersions = (a, b) => { const x = parseVersion(a); const y = parseVersion(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// The same major as base (for 0.x, the same minor: npm's caret), and not older than base.
export function sameLine(v, base) {
  const x = parseVersion(v); const b = parseVersion(base);
  if (!x || !b) return false;
  if (b[0] === 0 ? x[0] !== 0 || x[1] !== b[1] : x[0] !== b[0]) return false;
  return compareVersions(v, base) >= 0;
}
export const newestInLine = (versions, base) => versions.filter((v) => sameLine(v, base)).sort(compareVersions).pop() ?? null;

const linuxArch = (arch = process.arch) => (arch === 'arm64' ? 'arm64' : 'x64');
const sdkVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')).version; } catch { return '0.3.0'; } };

// What each engine is. pick(packument, arch) → { name, version, dist } of the package to download, or null.
export const ENGINES = {
  claude: {
    label: 'Claude', agent: 'claude', memoryMax: '1G',
    // «Major» for the SDK's 0.x line is its minor: the program must speak the bundled SDK's protocol.
    base: () => sdkVersion(),
    name: (arch) => `@anthropic-ai/claude-agent-sdk-linux-${linuxArch(arch)}`,
    pick(doc, arch, base) {
      const v = newestInLine(Object.keys(doc.versions ?? {}), base);
      return v ? { name: this.name(arch), version: v, dist: doc.versions[v].dist } : null;
    },
    bin: (files) => files.find((f) => f === 'claude') ?? null
  },
  codex: {
    label: 'Codex', agent: 'codex', memoryMax: '1G',
    // Its line is its major (any newer 0.x), not npm's caret.
    inLine: (v, base) => Boolean(parseVersion(v) && parseVersion(base)) && parseVersion(v)[0] === parseVersion(base)[0] && compareVersions(v, base) >= 0,
    // The oldest Codex Orb was tested with; any newer one of the same major.
    base: () => '0.166.0',
    name: () => '@openai/codex',
    // The Linux build is a version of the same package: <version>-linux-<arch>. The registry's «latest» when it is of the
    // line, else the newest of the line.
    pick(doc, arch, base) {
      const line = Object.keys(doc.versions ?? {}).filter((v) => ENGINES.codex.inLine(v, base) && doc.versions[`${v}-linux-${linuxArch(arch)}`]);
      const latest = doc['dist-tags']?.latest;
      const v = line.includes(latest) ? latest : line.sort(compareVersions).pop() ?? null;
      if (!v) return null;
      const platform = `${v}-linux-${linuxArch(arch)}`;
      return { name: this.name(arch), version: v, platform, dist: doc.versions[platform].dist };
    },
    bin: (files) => files.find((f) => /^vendor\/[^/]*linux[^/]*\/(codex\/)?codex$/.test(f)) ?? files.find((f) => /(^|\/)bin\/codex$/.test(f) && !f.endsWith('.js')) ?? null
  }
};

// The registry's integrity of a download: «sha512-<base64>» (sha1 alone is refused).
export async function checkIntegrity(file, integrity) {
  const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(String(integrity ?? '').split(/\s+/).find((x) => x.startsWith('sha512-')) ?? '');
  if (!m) throw new Error('el registro no da la suma sha512 del paquete: no se instala');
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const got = hash.digest('base64');
  if (got !== m[1]) throw new Error('la suma sha512 del paquete no coincide: no se instala');
  return true;
}

// The script the adapters run. POSIX sh; on Windows (tests) nothing is wrapped.
export function runScript({ bin, memoryMax = '1G', label = 'engine' }) {
  return `#!/bin/sh
# Orb Server: ${label}, in its own systemd scope (memory limit; the OOM killer takes it before Orb Server) and with
# no_new_privs (it can never raise its privileges, not even with the server's admin helper).
BIN='${String(bin).replace(/'/g, "'\\''")}'
# The kernel's OOM killer picks this process before Orb Server (raising it needs no privilege).
echo 500 > /proc/self/oom_score_adj 2>/dev/null || true
NNP=''
if command -v setpriv >/dev/null 2>&1; then NNP='setpriv --no-new-privs --'
elif [ -e /etc/sudoers.d/orb-server ]; then echo "orb-server: setpriv is missing (util-linux): the agent does not start without no_new_privs" >&2; exit 126
fi
if [ -S "\${XDG_RUNTIME_DIR:-/nonexistent}/bus" ] && command -v systemd-run >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  exec systemd-run --user --scope --quiet --collect -p MemoryMax=${memoryMax} -- $NNP "$BIN" "$@"
fi
# shellcheck disable=SC2086
exec $NNP "$BIN" "$@"
`;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, `${JSON.stringify(v, null, 2)}\n`); fs.renameSync(t, f); };
const walkRel = (dir) => { const out = []; const go = (d, r) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const rr = r ? `${r}/${e.name}` : e.name; if (e.isDirectory()) go(path.join(d, e.name), rr); else if (e.isFile()) out.push(rr); } }; go(dir, ''); return out; };
// current → <version>: a symlink (a junction on Windows, which needs no admin).
export function pointTo(link, target) {
  const tmp = `${link}.nuevo`;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* none */ }
  fs.symlinkSync(target, tmp, process.platform === 'win32' ? 'junction' : 'dir');
  try { fs.renameSync(tmp, link); } catch { fs.rmSync(link, { recursive: true, force: true }); fs.renameSync(tmp, link); }
}

// The engines of one Orb Server folder. fetchImpl: the registry (tests give a fake one); arch: linux arch to download.
// offline: nothing is downloaded (the tests' engine with fake agents).
export function createEngines({ dir, registry = process.env.ORB_NPM_REGISTRY || REGISTRY, fetchImpl = fetch, arch = process.arch, log = () => {}, wanted = () => [], defs = ENGINES, offline = false } = {}) {
  const busy = new Map(); // id → promise of the running install
  const info = (id) => readJson(path.join(dir, id, 'engine.json'));
  const runPath = (id) => path.join(dir, id, 'run');
  const installed = (id) => { const i = info(id); return Boolean(i && fs.existsSync(path.join(dir, id, 'current', ...String(i.bin).split('/')))); };

  async function packument(name) {
    const url = `${registry.replace(/\/$/, '')}/${name.replace('/', '%2f')}`;
    const r = await fetchImpl(url, { headers: { accept: 'application/vnd.npm.install-v1+json, application/json' }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`registro npm (${name}): ${r.status}`);
    return r.json();
  }
  async function download(url, file) {
    if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('el paquete no viene por https: no se instala');
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!r.ok || !r.body) throw new Error(`descarga: ${r.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file));
  }
  // Downloads, checks and unpacks one version; then current points to it. Older versions but the previous one go.
  async function install(id, pick) {
    const d = defs[id];
    const base = path.join(dir, id);
    const vdir = path.join(base, pick.version);
    const tgz = path.join(base, `.descarga-${pick.version}.tgz`);
    try {
      log(`motor ${id}: descargando ${pick.name}@${pick.platform ?? pick.version}`);
      await download(pick.dist?.tarball ?? '', tgz);
      await checkIntegrity(tgz, pick.dist?.integrity);
      fs.rmSync(vdir, { recursive: true, force: true });
      await extractTarGz(tgz, vdir, { strip: 1 });
    } finally { fs.rmSync(tgz, { force: true }); }
    const bin = d.bin(walkRel(vdir));
    if (!bin) { fs.rmSync(vdir, { recursive: true, force: true }); throw new Error(`el paquete de ${d.label} no trae su programa`); }
    if (process.platform !== 'win32') fs.chmodSync(path.join(vdir, ...bin.split('/')), 0o755);
    const before = info(id);
    pointTo(path.join(base, 'current'), vdir);
    fs.writeFileSync(runPath(id), runScript({ bin: path.join(base, 'current', ...bin.split('/')), memoryMax: d.memoryMax, label: d.label }), { mode: 0o755 });
    const now = new Date().toISOString();
    writeJson(path.join(base, 'engine.json'), { id, version: pick.version, package: pick.name, integrity: pick.dist.integrity, bin, at: now, checkedAt: now });
    for (const old of fs.readdirSync(base)) if (/^\d+\.\d+\.\d+$/.test(old) && old !== pick.version && old !== before?.version) fs.rmSync(path.join(base, old), { recursive: true, force: true });
    log(`motor ${id}: ${pick.version} listo`);
    return { id, version: pick.version, run: runPath(id), updated: Boolean(before && before.version !== pick.version) };
  }
  async function latest(id) {
    const d = defs[id]; if (!d) throw new Error(`motor desconocido: ${id}`);
    const doc = await packument(d.name(arch));
    const pick = d.pick(doc, arch, d.base());
    if (!pick?.dist) throw new Error(`no hay una versión de ${d.label} para linux-${linuxArch(arch)} en el registro`);
    if (d.inLine ? !d.inLine(pick.version, d.base()) : !sameLine(pick.version, d.base())) throw new Error(`la versión ${pick.version} de ${d.label} no es de la línea ${d.base()}`);
    return pick;
  }
  const once = (id, fn) => { if (busy.has(id)) return busy.get(id); const p = fn().finally(() => busy.delete(id)); busy.set(id, p); return p; };

  const engines = {
    dir, runPath, installed, offline,
    // Ready to run: downloaded now if it is not there (and, once a day, updated within its line in the background).
    ensure(id) {
      if (!defs[id]) return Promise.reject(new Error(`motor desconocido: ${id}`));
      if (installed(id)) {
        const i = info(id);
        if (Date.now() - Date.parse(i.checkedAt ?? 0) > DAY) engines.update(id).catch((error) => log(`motor ${id}: no se pudo comprobar si hay versión nueva (${error.message})`));
        return Promise.resolve({ id, version: i.version, run: runPath(id), updated: false });
      }
      if (offline) return Promise.reject(new Error('sin descargas (pruebas)'));
      return once(id, async () => install(id, await latest(id)));
    },
    // A newer version of the same line, if there is one (the one running keeps going until its process closes).
    update(id) {
      if (offline) return Promise.resolve({ id, updated: false });
      return once(id, async () => {
        const pick = await latest(id); const i = info(id);
        if (i && i.version === pick.version && installed(id)) { writeJson(path.join(dir, id, 'engine.json'), { ...i, checkedAt: new Date().toISOString() }); return { id, version: i.version, run: runPath(id), updated: false }; }
        return install(id, pick);
      });
    },
    list: () => Object.keys(defs).map((id) => { const i = info(id); return { id, label: defs[id].label, installed: installed(id), version: i?.version ?? null, checkedAt: i?.checkedAt ?? null, installing: busy.has(id) }; }),
    // The engines this server needs (the bots' brains, the agents signed in): src/server/engine-server.mjs says which.
    wanted: () => [...new Set(wanted())].filter((id) => defs[id]),
    closeAll: () => { idle.closeAll(); },
    idle: null
  };
  const idle = createIdle({ log });
  engines.idle = idle;
  return engines;
}

// Engine processes that close when unused: track(id, child, { idleMs, close }), touch(id) on every use; after idleMs
// without one, close(child) (default: SIGTERM, then SIGKILL after 5 s).
export function createIdle({ log = () => {}, tickMs = 15_000, now = () => Date.now() } = {}) {
  const items = new Map();
  let timer = null;
  const stop = (id, why) => {
    const it = items.get(id); if (!it) return;
    items.delete(id);
    log(`motor ${id}: se cierra (${why})`);
    try { it.close(it.child); } catch { /* gone */ }
    if (!items.size && timer) { clearInterval(timer); timer = null; }
  };
  const defaultClose = (child) => { try { child.kill('SIGTERM'); } catch { /* gone */ } const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5000); t.unref?.(); };
  const tick = () => { for (const [id, it] of items) if (now() - it.usedAt > it.idleMs) stop(id, 'sin uso'); };
  return {
    track(id, child, { idleMs = 3 * 60_000, close = defaultClose } = {}) {
      items.set(id, { child, idleMs, close, usedAt: now() });
      child?.once?.('exit', () => { if (items.get(id)?.child === child) items.delete(id); });
      if (!timer) { timer = setInterval(tick, tickMs); timer.unref?.(); }
    },
    touch(id) { const it = items.get(id); if (it) it.usedAt = now(); },
    tick,
    running: () => [...items.keys()],
    closeAll: () => { for (const id of [...items.keys()]) stop(id, 'cierre'); }
  };
}
