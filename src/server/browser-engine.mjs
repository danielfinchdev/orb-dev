// 3.7 (WS5): the Chromium of Orb Server's browser. It is not in the package (the package stays small): it is downloaded
// the first time a bot needs the browser, from Playwright's CDN, for exactly the build the pinned playwright-core drives
// (package.json: playwright-core 1.63.0 → Chrome for Testing 153.0.8010.12, revision 1243), and its SHA-256 is checked
// against the one written here (this file ships inside the signed Orb Server release, so the hash is as trusted as the
// code). Nothing that does not match is ever unpacked.
//
// Orb Server's engines module (src/server/engines.mjs, WS1) owns downloads of agent engines; when it offers
// ensureEngine('chromium') it is used instead of this adapter. Until then this file is the whole Chromium story, kept
// apart so the two merge without touching each other.
//
// Order: config browser.executablePath (a Chrome/Chromium the owner installed) → ORB_CHROMIUM → engines module →
// <engines>/chromium-<revision>/ (downloaded before) → download now.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CHROMIUM = Object.freeze({
  playwright: '1.63.0', revision: '1243', version: '153.0.8010.12',
  builds: Object.freeze({
    'linux-x64': { url: 'https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-linux64.zip', sha256: '8aac35011c18f6e2d10696154af89a5728ac2ddd6dc6fad24ffdf243c3fcfd5a', size: 195836009, exe: ['chrome-linux64', 'chrome'] },
    'linux-arm64': { url: 'https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux-arm64/chrome-linux-arm64.zip', sha256: '7d8a4b4ff289efe44a06501a519df142c4c18fff7aaf1c1401a3fbb12b3bd069', size: 195926016, exe: ['chrome-linux-arm64', 'chrome'] }
  })
});

export const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;
export const enginesDir = (base = null) => base || process.env.ORB_ENGINES_DIR || path.join(os.homedir(), 'orb-server', 'engines');

export async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

// A zip unpacked with what the machine has (unzip, bsdtar, or Python's zipfile): no unpacker in Orb Server's package.
function unzip(file, dest) {
  const tries = [['unzip', ['-q', '-o', file, '-d', dest]], ['bsdtar', ['-xf', file, '-C', dest]], ['python3', ['-I', '-m', 'zipfile', '-e', file, dest]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout: 10 * 60_000 });
    if (!r.error && r.status === 0) return;
  }
  throw Object.assign(new Error('no puedo descomprimir Chromium: instala «unzip» (sudo apt install unzip)'), { code: 'NO_UNZIP' });
}

// Downloads one build to a temporary file next to its folder, checks size and SHA-256, and only then unpacks it.
// fetchImpl: for the tests.
export async function downloadChromium({ dir = enginesDir(), key = platformKey(), fetchImpl = globalThis.fetch, log = () => {}, build = CHROMIUM.builds[key] } = {}) {
  if (!build) throw Object.assign(new Error(`no hay Chromium de Orb para ${key}`), { code: 'NO_BUILD' });
  if (!/^[0-9a-f]{64}$/.test(String(build.sha256 ?? ''))) throw Object.assign(new Error('falta la huella verificada de Chromium'), { code: 'NO_HASH' });
  const folder = path.join(dir, `chromium-${CHROMIUM.revision}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const part = path.join(dir, `.chromium-${CHROMIUM.revision}-${process.pid}.zip`);
  try {
    log(`navegador: descargando Chromium ${CHROMIUM.version}…`);
    const res = await fetchImpl(build.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`descarga de Chromium: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part, { mode: 0o600 }));
    const size = fs.statSync(part).size;
    if (build.size && size !== build.size) throw Object.assign(new Error('Chromium descargado no coincide (tamaño): no se usa'), { code: 'BAD_HASH' });
    const got = await sha256File(part);
    if (got !== build.sha256) throw Object.assign(new Error('Chromium descargado no coincide (huella SHA-256): no se usa'), { code: 'BAD_HASH' });
    const tmp = `${folder}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    unzip(part, tmp);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.renameSync(tmp, folder);
    fs.writeFileSync(path.join(folder, '.orb-ok'), JSON.stringify({ sha256: got, version: CHROMIUM.version, at: new Date().toISOString() }));
    const exe = path.join(folder, ...build.exe);
    try { fs.chmodSync(exe, 0o755); } catch { /* unpacked with its mode */ }
    log(`navegador: Chromium ${CHROMIUM.version} listo`);
    return exe;
  } finally { fs.rmSync(part, { force: true }); }
}

// The Chromium to launch (a path), downloading it the first time.
let downloading = null;
export async function ensureChromium({ config = {}, dir = enginesDir(), key = platformKey(), log = () => {}, fetchImpl, engines = null } = {}) {
  const own = String(config?.executablePath ?? process.env.ORB_CHROMIUM ?? '').trim();
  if (own) { if (!fs.existsSync(own)) throw new Error(`no encuentro el navegador en ${own}`); return own; }
  // WS1's engines module, when it has Chromium.
  const mod = engines ?? await import('./engines.mjs').catch(() => null);
  if (typeof mod?.ensureEngine === 'function') {
    try { const r = await mod.ensureEngine('chromium', { log }); const exe = typeof r === 'string' ? r : r?.executablePath ?? r?.path; if (exe) return exe; } catch (error) { log(`navegador: el módulo de motores no dio Chromium (${error?.message ?? error}); uso la descarga propia`); }
  }
  const build = CHROMIUM.builds[key];
  if (!build) throw Object.assign(new Error(`no hay Chromium de Orb para ${key}: pon la ruta de un Chrome en orb.json (browser.executablePath)`), { code: 'NO_BUILD' });
  const folder = path.join(dir, `chromium-${CHROMIUM.revision}`);
  const exe = path.join(folder, ...build.exe);
  if (fs.existsSync(exe) && fs.existsSync(path.join(folder, '.orb-ok'))) return exe;
  downloading ??= downloadChromium({ dir, key, log, fetchImpl, build }).finally(() => { downloading = null; });
  return downloading;
}
