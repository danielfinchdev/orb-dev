// 3.8.2: an installed Orb updating itself to the next version for real, as the owner does it: «Reiniciar e instalar»
// on the update card, the backup before updating, the real installer (passive) replacing the installed Orb, and the
// new version opening by itself. Nothing of the real PC is touched:
//   - two test installers of this code (cargo feature e2e), named «OrbPrueba» (another program, uninstall entry,
//     registry key and app id than Orb's), the current version and the next one (version + 1 in the last number);
//     their updater trusts only the TEST key (test/fixtures/actualizador-prueba.key) and their hooks point at a
//     registry key and folders that do not exist (no Orb 3.8.0 to remove);
//   - the current one installed silently, without shortcuts, into a temporary folder; its data, workspace and backups
//     in that folder too (ORB_USER_DATA, ORB_DEFAULT_BASE, ORB_BACKUP_ROOT), its window never shown; an e2e build
//     never starts without ORB_USER_DATA (lib.rs), also when the installer opens it again;
//   - a workspace with a realistic amount of logs (≈ 200 files, ≈ 3 MB: what the pre-update backup copies);
//   - at the end the test Orb is closed (only its own processes), uninstalled, and the real Orb is checked unchanged.
//   node test/tauri-instalar.e2e.mjs [--rebuild] [--lenta]
// --lenta: the backup before updating never ends in time (ORB_TEST_SLOW_BACKUP_MS, as on 2026-11-09 on a busy PC):
// «Reiniciar e instalar» waits for it at most 45 s and installs anyway.
// The installers are kept in src-tauri/target-e2e/instalar (built again with --rebuild or when missing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { makeManifests } from '../scripts/release-manifests.mjs';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'OrbPrueba';
const TARGET = path.join(ROOT, 'src-tauri', 'target-e2e');
const KEPT = path.join(TARGET, 'instalar');
const SLOW = process.argv.includes('--lenta');
const CURRENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NEXT = CURRENT.replace(/\d+$/, (n) => String(Number(n) + 1));
const TEST_PUBKEY = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'actualizador-prueba.key.pub'), 'utf8').trim();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000, every = 250) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };
const results = [];
const check = (name, fn) => { try { fn(); results.push(['✔', name]); } catch (error) { results.push(['✖', name, error.message.split('\n')[0]]); } };
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
const regGet = (key, value) => { try { return /REG_SZ\s+(.*)$/m.exec(execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1]?.trim() ?? null; } catch { return null; } };
// The processes of a program file (by its full path): only the test's own.
const running = (exe) => { try { return JSON.parse(ps(`@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' } | ForEach-Object { $_.Id }) | ConvertTo-Json -Compress`) || '[]'); } catch { return []; } };
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const keyExists = (key) => spawnSync('reg', ['query', key], { stdio: 'ignore' }).status === 0;

// ---- the two installers
const setupOf = (version) => path.join(KEPT, `${NAME}_${version}_x64-setup.exe`);
function build(version) {
  fs.mkdirSync(KEPT, { recursive: true });
  const hooks = path.join(KEPT, 'hooks-prueba.nsh');
  // Orb's real hooks, pointed where no Orb 3.8.0 is (the bridge from Electron never runs here).
  fs.writeFileSync(hooks, [
    '!define ORB_ELECTRON_UNINSTKEY "Software\\OrbE2E-instalar\\NoExiste"',
    '!define ORB_ELECTRON_DEFAULT_DIR "$TEMP\\orb-e2e-instalar-no-existe"',
    '!define ORB_DATA_DIR "$TEMP\\orb-e2e-instalar-ganchos"',
    `!include "${path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh')}"`, ''].join('\r\n'));
  const conf = path.join(KEPT, `conf-${version}.json`);
  fs.writeFileSync(conf, JSON.stringify({
    productName: NAME, mainBinaryName: NAME, identifier: 'dev.orb.prueba-instalar', version,
    bundle: { createUpdaterArtifacts: false, windows: { nsis: { installerHooks: hooks } } },
    plugins: { updater: { dangerousInsecureTransportProtocol: true, pubkey: TEST_PUBKEY } }
  }));
  const env = { ...process.env, CARGO_TARGET_DIR: TARGET };
  for (const k of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) delete env[k];
  const r = spawnSync('npx', ['tauri', 'build', '--features', 'e2e', '--bundles', 'nsis', '--config', `"${conf}"`, '--', '--locked'], { cwd: ROOT, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`build ${version}: ${r.status}`);
  fs.copyFileSync(path.join(TARGET, 'release', 'bundle', 'nsis', `${NAME}_${version}_x64-setup.exe`), setupOf(version));
}
for (const v of [CURRENT, NEXT]) if (process.argv.includes('--rebuild') || !fs.existsSync(setupOf(v))) build(v);

// ---- what the real PC has before (read only): it must be the same after
const REAL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Orb';
const realExe = path.join(process.env.LOCALAPPDATA, 'Orb', 'Orb.exe');
const realBefore = { location: regGet(REAL_KEY, 'InstallLocation'), version: regGet(REAL_KEY, 'DisplayVersion'), exe: fs.existsSync(realExe) ? fs.statSync(realExe).mtimeMs : null, pids: asList(running(realExe)).sort() };

const MARK = path.join(os.tmpdir(), 'orb-e2e-sin-datos.log');
const markBefore = (() => { try { return fs.readFileSync(MARK, 'utf8').split(/\r?\n/).length; } catch { return 0; } })();
const markLines = () => { try { return fs.readFileSync(MARK, 'utf8').split(/\r?\n/).slice(Math.max(0, markBefore - 1)); } catch { return []; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-instalar-'));
const INSTALL = path.join(tmp, 'Programs', NAME);
const EXE = path.join(INSTALL, `${NAME}.exe`);
const USER_DATA = path.join(tmp, 'datos-app');
const BASE = path.join(tmp, 'base');
const TEST_KEYS = [`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NAME}`, `HKCU\\Software\\orb\\${NAME}`];
for (const k of TEST_KEYS) assert.equal(keyExists(k), false, `ya existe ${k}: ¿otra prueba a medias?`);

let server = null; let cdp = null;
try {
  // ---- the current version installed (silent, no shortcuts, in the temporary folder)
  execFileSync(setupOf(CURRENT), ['/S', '/NS', `/D=${INSTALL}`], { stdio: 'ignore' });
  check(`la ${CURRENT} queda instalada en una carpeta temporal`, () => { assert.ok(fs.existsSync(EXE) && fs.existsSync(path.join(INSTALL, 'uninstall.exe'))); });

  // ---- the next version on a local feed, signed with the test key for its version
  const feed = path.join(tmp, 'feed'); fs.mkdirSync(feed);
  const next = path.join(feed, `${NAME}_${NEXT}_x64-setup.exe`); fs.copyFileSync(setupOf(NEXT), next);
  const signEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PATH: path.join(ROOT, 'test', 'fixtures', 'actualizador-prueba.key'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'prueba' };
  delete signEnv.TAURI_SIGNING_PRIVATE_KEY;
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'signer', 'sign', '--app-version', NEXT, next], { env: signEnv, stdio: 'ignore' });
  const served = [];
  server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname); served.push(name);
    const file = path.join(feed, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  makeManifests({ setup: next, out: feed, version: NEXT, base });

  // ---- the installed Orb, as the user opens it (its window hidden, everything in the temporary folder)
  const port = 9400 + Math.floor(Math.random() * 500);
  const env = { ...process.env, ...sandboxEnv(tmp), ORB_USER_DATA: USER_DATA, ORB_DEFAULT_BASE: BASE, ORB_UPDATE_URL: base, ORB_E2E_CDP_PORT: String(port), ORB_HIDDEN_WINDOW: '1', ...(SLOW ? { ORB_TEST_SLOW_BACKUP_MS: '600000' } : {}) };
  for (const k of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'ORB_NO_UPDATE', 'ORB_FAKE_UPDATE', 'ORB_E2E_INSTALL_ON_EXIT']) delete env[k];
  fs.mkdirSync(BASE, { recursive: true });
  const app = spawn(EXE, [], { env, stdio: 'ignore' });
  const appExit = new Promise((r) => app.once('exit', (code) => r(code)));
  const pageOf = async () => {
    cdp = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana (CDP)', 90000, 500);
    const page = await until(() => cdp.contexts().flatMap((c) => c.pages()).find((p) => /tauri\.localhost/.test(p.url())), 'la página principal', 60000);
    await page.waitForFunction(() => Boolean(window.orb?.update), null, { timeout: 30000 });
    return page;
  };
  const page = await pageOf();
  // First start: the workspace, the master password, «Preparando tu PC».
  await page.waitForSelector('[data-testid=setup-datos]', { timeout: 60000 });
  await page.fill('[data-testid=setup-assistant]', 'Orbe');
  await page.fill('[data-testid=setup-user]', 'Ana');
  await page.click('[data-testid=setup-create]', { force: true });
  await throughStart(page, { timeout: 120000 });
  const home = path.join(BASE, 'Orb');
  // A realistic workspace for the backup: ≈ 200 log files (≈ 3 MB) in nested folders, as a real core\bitacora.
  const logs = path.join(home, 'core', 'bitacora', 'archivo', 'scripts', 'copias');
  for (let i = 0; i < 200; i++) { const d = path.join(logs, `lote-${i % 8}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `registro-${i}.log`), crypto.randomBytes(8 * 1024 + (i % 20) * 1024).toString('base64')); }

  const st = (what) => page.evaluate((w) => window.orb.update[w](), what);
  const before = await st('get');
  await st('check');
  const found = await until(async () => { const s = await st('get'); return ['available', 'error', 'none'].includes(s.state) ? s : null; }, 'la comprobación', 60000);
  await st('download');
  const ready = await until(async () => { const s = await st('get'); return ['downloaded', 'available'].includes(s.state) && s.state !== 'downloading' ? s : null; }, 'la descarga', 120000);
  check(`la ${CURRENT} instalada encuentra la ${NEXT} y la descarga`, () => {
    assert.equal(before.current, CURRENT); assert.equal(before.portable, false, 'instalada (uninstall.exe al lado)');
    assert.equal(found.state, 'available', JSON.stringify(found)); assert.equal(found.version, NEXT);
    assert.equal(ready.state, 'downloaded', JSON.stringify(ready));
  });

  // «Reiniciar e instalar» on the card, as the user presses it; what the card shows is kept until the window goes.
  await page.evaluate(() => { window.__updates = []; window.orb.on('app:update', (s) => window.__updates.push({ ...s, at: Date.now() })); });
  const card = page.locator('[data-testid=update-card]');
  await card.waitFor({ state: 'attached', timeout: 10000 });
  const links = await page.locator('[data-testid=update-links] button').allInnerTexts();
  const clickedAt = Date.now();
  await page.locator('[data-testid=update-restart]').dispatchEvent('click');
  let seen = [];
  let cardTexts = [];
  for (const end = Date.now() + 120000; Date.now() < end && app.exitCode === null;) {
    try {
      seen = await page.evaluate(() => window.__updates);
      const text = await card.innerText({ timeout: 500 }).catch(() => null);
      if (text && cardTexts.at(-1) !== text) cardTexts.push(text);
    } catch { break; } // the window went with Orb
    await wait(150);
  }
  const code = await Promise.race([appExit, wait(30000).then(() => 'sigue abierta')]);
  const closedIn = Date.now() - clickedAt;
  try { await cdp.close(); } catch { /* gone */ }
  check('«Más tarde» y «Novedades» van separados, cada uno en su botón', () => { assert.deepEqual(links, ['Más tarde', 'Novedades']); });
  check('al pulsar, la tarjeta dice lo que pasa (copia de seguridad con su progreso, luego el instalador) y Orb se cierra', () => {
    const states = seen.map((s) => `${s.state}/${s.step ?? ''}`);
    assert.ok(states.includes('installing/backup') && states.includes('installing/installer'), states.join(' '));
    assert.ok(cardTexts.some((t) => /copia de seguridad/i.test(t)) || cardTexts.some((t) => /instalador/i.test(t)), cardTexts.join(' | '));
    assert.notEqual(code, 'sigue abierta');
    if (SLOW) assert.ok(closedIn > 40000 && closedIn < 90000, `tardó ${closedIn} ms`);
    else assert.ok(closedIn < 60000, `tardó ${closedIn} ms`);
  });

  // ---- the installer replaces it and opens the new version by itself. It opens it as the user (nsis_tauri_utils
  // RunAsUser: Windows' own environment, not the test's), so this test build, without ORB_USER_DATA, only leaves its
  // line in %TEMP%\orb-e2e-sin-datos.log and ends (lib.rs); the real Orb opens on its own data. Then the test opens
  // the new version on the same data, as the user's next start.
  const relaunched = await until(() => { const p = asList(running(EXE)); if (p.length) return 'con el entorno de la prueba'; return markLines().some((l) => l.trim().toLowerCase() === EXE.toLowerCase()) ? 'como el usuario' : null; }, 'la nueva versión abierta por el instalador', 180000, 1000).catch(() => null);
  const installedVersion = (() => { try { return ps(`(Get-Item '${EXE}').VersionInfo.ProductVersion`).trim(); } catch { return null; } })();
  if (!asList(running(EXE)).length) spawn(EXE, [], { env, stdio: 'ignore' });
  const p2 = await pageOf().catch(() => null);
  const after = p2 ? await p2.evaluate(() => window.orb.update.get()).catch(() => null) : null;
  const copies = (() => { try { return fs.readdirSync(path.join(tmp, 'copias'), { recursive: true }).map(String); } catch { return []; } })();
  const outLog = (() => { try { return fs.readFileSync(path.join(home, 'core', 'ejecuciones', 'motor-salida.log'), 'utf8'); } catch { return ''; } })();
  check(`el instalador pone la ${NEXT}, la abre solo, y la ${NEXT} arranca con los mismos datos`, () => {
    assert.equal(installedVersion, NEXT, `versión del exe: ${installedVersion}`);
    assert.ok(relaunched, 'el instalador no la abrió');
    assert.equal(after?.current, NEXT, JSON.stringify(after));
    assert.ok(fs.existsSync(path.join(home, 'core', 'datos', 'orb.db')), 'el espacio sigue ahí');
  });
  console.log(`   (abierta por el instalador: ${relaunched})`);
  if (SLOW) {
    check('una copia que no termina no frena la actualización: se espera 45 s, se dice en el registro y se instala', () => {
      assert.match(outLog, /sigue sin terminar tras 45 s: se instala sin ella/);
      assert.ok(!copies.some((f) => /-preupdate\.orbbak$/.test(f)), copies.join(' '));
    });
  } else {
    check('la copia de seguridad antes de actualizar está hecha y no quedan restos', () => {
      assert.ok(copies.some((f) => /-preupdate\.orbbak$/.test(f)), copies.join(' '));
      assert.ok(!copies.some((f) => /\.preparando-|\.tmp$/.test(f)), copies.join(' '));
      assert.match(outLog, /copia de seguridad hecha antes de la/);
    });
  }
  console.log(`   (clic → Orb cerrado: ${closedIn} ms; estados: ${seen.map((s) => `${s.state}${s.step ? `/${s.step}` : ''}${s.state === 'installing' ? ` ${s.percent}%` : ''}`).join(' → ')})`);
  console.log(`   (motor-salida.log: ${outLog.split('\n').filter((l) => l.startsWith('[orb] actualizar')).join(' · ')})`);
} catch (error) {
  results.push(['✖', 'la prueba', error.stack ?? error.message]);
} finally {
  try { await cdp?.close(); } catch { /* gone */ }
  server?.close();
  // Only the test's own processes: the program in the temporary folder (and what the job of its engine ends with it).
  for (const pid of asList(running(EXE))) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  await wait(2000);
  if (fs.existsSync(path.join(INSTALL, 'uninstall.exe'))) { try { execFileSync(path.join(INSTALL, 'uninstall.exe'), ['/S', `_?=${INSTALL}`], { stdio: 'ignore' }); } catch { /* checked below */ } }
  for (const k of TEST_KEYS) { try { execFileSync('reg', ['delete', k, '/f'], { stdio: 'ignore' }); } catch { /* not there */ } }
}
const realAfter = { location: regGet(REAL_KEY, 'InstallLocation'), version: regGet(REAL_KEY, 'DisplayVersion'), exe: fs.existsSync(realExe) ? fs.statSync(realExe).mtimeMs : null, pids: asList(running(realExe)).sort() };
check('el Orb real del PC sigue igual (registro, programa y procesos)', () => { assert.deepEqual(realAfter, realBefore); });
check('la prueba no deja nada en el registro', () => { for (const k of TEST_KEYS) assert.equal(keyExists(k), false, k); });
for (const [mark, name, why] of results) console.log(`${mark} ${name}${why ? `\n    ${why}` : ''}`);
const failed = results.some((r) => r[0] === '✖');
if (!failed) { await wait(1000); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
console.log(`\n${results.filter((r) => r[0] === '✔').length}/${results.length}${failed ? ` · datos en ${tmp}` : ''}`);
process.exitCode = failed ? 1 : 0;
