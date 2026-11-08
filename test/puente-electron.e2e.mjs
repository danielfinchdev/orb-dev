// 3.8.1 (D9): the bridge from Orb 3.8.0 (Electron) to Orb on Tauri, with nobody at the PC and nothing of the real PC
// touched. A copy of the installed Orb 3.8.0 (its real Electron app and its real electron-updater) runs from a temporary
// folder, with its own data folder, on a Windows desktop of its own that is never shown, against a local feed:
//   - the feed serves a latest.yml made by scripts/release-manifests.mjs and a test installer built with Orb's REAL
//     installer hooks (src-tauri/nsis/hooks.nsh), pointed at a fake 3.8.0 install: the copy itself, with a stand-in for
//     its uninstaller (the real one would remove the real shortcuts and uninstall entry: fixed names), fake shortcuts
//     and an uninstall entry under a test registry key;
//   - 3.8.0 finds the new version, downloads it (its sha512 checked by electron-updater), and «Reiniciar e instalar» runs
//     it as it will run the real one (--updated /S --force-run);
//   - the hooks run 3.8.0's uninstaller silently in place and wait, leave the data alone, write the mark for the first
//     start, and open the new Orb.
//   node test/puente-electron.e2e.mjs [--electron <folder of an installed Orb 3.8.0>]
// What only the real installer on the real PC can show is in C:\Orb\personal\orb-3.8.1-comprobar-con-ventana.md (D9).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { fileFacts, latestYml } from '../scripts/release-manifests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = process.env.LOCALAPPDATA;
const argDir = process.argv.indexOf('--electron');
const INSTALLED = argDir > 0 ? process.argv[argDir + 1] : path.join(LOCAL, 'Programs', 'Orb');
const MAKENSIS = path.join(LOCAL, 'tauri', 'NSIS', 'makensis.exe');
const TAURI_PLUGINS = path.join(LOCAL, 'tauri', 'NSIS', 'Plugins', 'x86-unicode', 'additional');
for (const need of [path.join(INSTALLED, 'Orb.exe'), path.join(INSTALLED, 'resources', 'app-update.yml'), MAKENSIS, path.join(TAURI_PLUGINS, 'nsis_tauri_utils.dll')]) {
  if (!fs.existsSync(need)) { console.error(`falta ${need}`); process.exit(2); }
}

// The hooks wait for every Orb.exe of this user to end before 3.8.0's uninstaller runs (review D9 M5): with another
// Orb open (the user's, another test's) the bridge rightly stops, so this cannot run then.
if (/Orb\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Orb.exe', '/NH'], { encoding: 'utf8' }))) { console.error('hay un Orb.exe abierto: ciérralo (o espera a la otra prueba) y vuelve a lanzar esta'); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000, every = 250) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
const results = [];
const check = (name, fn) => { try { fn(); results.push(['✔', name]); } catch (error) { results.push(['✖', name, error.message.split('\n')[0]]); } };
const regGet = (key, value) => { try { return /REG_SZ\s+(.*)$/m.exec(execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1]?.trim() ?? null; } catch { return null; } };

const id = crypto.randomBytes(4).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-puente-'));
const ELECTRON_DIR = path.join(tmp, 'Programs', 'Orb'); // the fake 3.8.0 install
const DATA = path.join(tmp, 'Roaming', 'Orb.dev'); // its app data (ORB_USER_DATA), as %APPDATA%\Orb.dev
const NEW_DIR = path.join(tmp, 'Local', 'Orb'); // where the test installer puts the «new Orb»
const LINKS = { desktop: path.join(tmp, 'Escritorio', 'Orb.lnk'), start: path.join(tmp, 'Inicio', 'Orb.lnk') };
const TEST_KEY = `Software\\OrbE2E-${id}\\Uninstall\\c791290b-4a7b-5a24-9cba-134994a22734`;
const LOGS = { uninstaller: path.join(tmp, 'desinstalador-args.txt'), installer: path.join(tmp, 'instalador-args.txt'), opened: path.join(tmp, 'orb-nuevo-abierto.txt'), hook: path.join(tmp, 'gancho.txt') };
const REAL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\c791290b-4a7b-5a24-9cba-134994a22734';

// What the real PC has before (read only): it must be the same after.
const realBefore = { location: regGet(REAL_KEY, 'InstallLocation'), version: regGet(REAL_KEY, 'DisplayVersion'), exe: fs.statSync(path.join(INSTALLED, 'Orb.exe')).mtimeMs, desktop: fs.existsSync(path.join(os.homedir(), 'Desktop', 'Orb.lnk')) };

let electronPid = null; let browser = null; let server = null; let launcher = null;
const stopFile = path.join(tmp, 'parar-escritorio');
try {
  // ---- the fake 3.8.0 install: a copy of the real one, its uninstaller replaced by the stand-in
  fs.cpSync(INSTALLED, ELECTRON_DIR, { recursive: true });
  for (const l of Object.values(LINKS)) { fs.mkdirSync(path.dirname(l), { recursive: true }); fs.writeFileSync(l, 'acceso directo de prueba'); }
  execFileSync('reg', ['add', `HKCU\\${TEST_KEY}`, '/v', 'InstallLocation', '/d', ELECTRON_DIR, '/f'], { stdio: 'ignore' });
  execFileSync('reg', ['add', `HKCU\\${TEST_KEY}`, '/v', 'DisplayVersion', '/d', '3.8.0', '/f'], { stdio: 'ignore' });
  const nsis = (script, defines) => execFileSync(MAKENSIS, ['/V2', ...Object.entries(defines).map(([k, v]) => `/D${k}=${v}`), path.join(ROOT, 'test', 'fixtures', 'puente', script)], { encoding: 'utf8' });
  nsis('desinstalador-falso.nsi', { OUT: path.join(ELECTRON_DIR, 'Uninstall Orb.exe'), LOG: LOGS.uninstaller, DESKTOP_LINK: LINKS.desktop, START_LINK: LINKS.start, UNINSTKEY: TEST_KEY });
  // The data Orb keeps (its own data folder, as %APPDATA%\Orb.dev): it must all stay.
  fs.mkdirSync(path.join(DATA, 'claves'), { recursive: true });
  // (Local State is Chromium's: 3.8.0 itself rewrites it while it runs; it must still be there after.)
  const kept = { 'ubicacion.json': JSON.stringify({ home: path.join(tmp, 'Orb') }), 'interfaz.json': '{"zoom":1.1}', 'claves/prueba.enc': 'sellado' };
  fs.writeFileSync(path.join(DATA, 'Local State'), '{"os_crypt":{}}');
  for (const [f, body] of Object.entries(kept)) fs.writeFileSync(path.join(DATA, f), body);

  // ---- the new version: a test installer with the real hooks, and its latest.yml
  const feed = path.join(tmp, 'feed'); fs.mkdirSync(feed);
  const fakeOrb = path.join(tmp, 'orb-falso.exe');
  nsis('orb-falso.nsi', { OUT: fakeOrb, MARK: LOGS.opened });
  const setup = path.join(feed, 'Orb_3.8.1_x64-setup.exe');
  nsis('instalador.nsi', { OUT: setup, TAURI_PLUGINS, UNINSTKEY: TEST_KEY, DEFAULT_DIR: path.join(tmp, 'no-existe'), DATA_DIR: DATA, HOOKS: path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh'), TARGET: NEW_DIR, ARGS_LOG: LOGS.installer, FAKE_ORB: fakeOrb, HOOK_LOG: LOGS.hook });
  fs.writeFileSync(path.join(feed, 'latest.yml'), latestYml({ version: '3.8.1', file: fileFacts(setup), date: new Date().toISOString() }));
  const served = [];
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)); served.push(name);
    const file = path.join(feed, path.basename(name));
    if (!name || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feedUrl = `http://127.0.0.1:${server.address().port}/`;

  // ---- Orb 3.8.0 (the copy) on a desktop of its own that is never shown
  const port = 9600 + Math.floor(Math.random() * 300);
  const env = { ...process.env, ORB_USER_DATA: DATA, ORB_UPDATE_URL: feedUrl, ORB_NO_ADB: '1', LOCALAPPDATA: path.join(tmp, 'Local') }; // electron-updater's download folder in the test's %LOCALAPPDATA%
  for (const k of ['ORB_NO_UPDATE', 'ORB_FAKE_UPDATE', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  const desk = `orb-puente-${id}`;
  const exe = path.join(ELECTRON_DIR, 'Orb.exe');
  launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class D {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct SI { public int cb; public string r; public string desk; public string title; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
 [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hp, ht; public int pid, tid; }
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateDesktop(string n, IntPtr d, IntPtr m, int f, uint a, IntPtr s);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inh, uint fl, IntPtr env, string cwd, ref SI si, out PI pi);
 public static int Run(string desk, string app, string cmd) {
  if (CreateDesktop(desk, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero) == IntPtr.Zero) throw new Exception("CreateDesktop " + Marshal.GetLastWin32Error());
  var si = new SI(); si.cb = Marshal.SizeOf(typeof(SI)); si.desk = desk; PI pi;
  if (!CreateProcess(app, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi)) throw new Exception("CreateProcess " + Marshal.GetLastWin32Error());
  return pi.pid; } }
"@
[D]::Run('${desk}', '${exe.replace(/'/g, "''")}', '"${exe.replace(/'/g, "''")}" --remote-debugging-port=${port}')
while (-not (Test-Path '${stopFile.replace(/'/g, "''")}')) { Start-Sleep -Milliseconds 500 }`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let launcherOut = ''; launcher.stdout.on('data', (d) => { launcherOut += d; }); launcher.stderr.on('data', (d) => { launcherOut += d; });
  electronPid = Number(await until(() => /^\d+$/m.exec(launcherOut)?.[0], `Orb 3.8.0 arranca (${launcherOut})`, 30000));
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'Orb 3.8.0 (CDP)', 60000, 500);
  const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools')), 'la ventana de Orb 3.8.0', 60000, 500);
  await page.waitForFunction(() => Boolean(window.orb?.update), null, { timeout: 60000 });
  const update = (what) => page.evaluate((w) => window.orb.update[w](), what);
  const before = await update('get');
  await update('check');
  const found = await until(async () => { const s = await update('get'); return ['available', 'error'].includes(s.state) ? s : null; }, 'Orb 3.8.0 encuentra la 3.8.1', 60000, 500);
  await update('download');
  const downloaded = await until(async () => { const s = await update('get'); return ['downloaded', 'error'].includes(s.state) || s.error ? s : null; }, 'la descarga', 120000, 500);
  check('Orb 3.8.0 (copia, con su electron-updater) encuentra la 3.8.1 en el latest.yml y descarga el instalador (sha512 comprobado)', () => {
    assert.equal(before.portable, false, 'instalada (no portable)');
    assert.equal(found.state, 'available', JSON.stringify(found));
    assert.equal(found.version, '3.8.1');
    assert.equal(downloaded.state, 'downloaded', JSON.stringify(downloaded));
    assert.ok(served.includes('latest.yml') && served.includes('Orb_3.8.1_x64-setup.exe'), served.join(' '));
  });
  const t0 = Date.now();
  await page.evaluate(() => window.orb.update.install()).catch(() => { /* the app quits */ });
  try { await browser.close(); } catch { /* gone */ } browser = null;
  await until(() => fs.existsSync(LOGS.hook), 'el instalador termina', 120000, 500).catch(() => null);
  const quit = await until(() => { try { process.kill(electronPid, 0); return false; } catch { return true; } }, 'Orb 3.8.0 se cierra', 30000).catch(() => false);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

  check('«Reiniciar e instalar» cierra Orb 3.8.0 y lanza el instalador como lo hará con el real (--updated /S --force-run)', () => {
    assert.ok(quit, 'Orb 3.8.0 sigue abierta');
    const args = read(LOGS.installer);
    assert.ok(args, 'el instalador no se ejecutó');
    assert.match(args, /--updated/); assert.match(args, /(^|\s)\/S(\s|$)/); assert.match(args, /--force-run/);
  });
  check('el gancho ejecuta el desinstalador de 3.8.0 en silencio, en su sitio y esperándolo (/S /currentuser _?=carpeta)', () => {
    const args = read(LOGS.uninstaller);
    assert.ok(args, 'el desinstalador no se ejecutó');
    assert.match(args, /\/S/); assert.match(args, /\/currentuser/);
    assert.ok(args.includes(`_?=${ELECTRON_DIR}`), args);
    assert.doesNotMatch(args, /--delete-app-data|--updated|--keep-shortcuts/);
  });
  check('Orb 3.8.0 desaparece: carpeta, accesos directos y entrada de desinstalación', () => {
    assert.ok(!fs.existsSync(ELECTRON_DIR), `queda ${ELECTRON_DIR}: ${fs.existsSync(ELECTRON_DIR) ? fs.readdirSync(ELECTRON_DIR).slice(0, 5) : ''}`);
    for (const l of Object.values(LINKS)) assert.ok(!fs.existsSync(l), l);
    assert.equal(regGet(`HKCU\\${TEST_KEY}`, 'InstallLocation'), null);
  });
  check('los datos se quedan intactos (%APPDATA%\\Orb.dev: ubicación, interfaz, claves, Local State)', () => {
    for (const [f, body] of Object.entries(kept)) assert.equal(read(path.join(DATA, f)), body, f);
    JSON.parse(read(path.join(DATA, 'Local State')));
  });
  check('la marca para el primer arranque de Tauri dice de qué versión viene y que el desinstalador terminó bien', () => {
    const mark = JSON.parse(read(path.join(DATA, 'migrado-desde-electron.json')) ?? 'null');
    assert.deepEqual(mark, { from: 'electron', version: '3.8.0', uninstaller: '0' });
  });
  check(`instalada en ${seconds} s desde «Reiniciar e instalar», y el gancho pide abrir la Orb nueva (RunAsUser)`, () => {
    assert.ok(fs.existsSync(path.join(NEW_DIR, 'Orb.exe')), 'no instalada');
    // On this test's hidden desktop Windows refuses RunAsUser (1): it opens Orb through Explorer's token, which may not
    // use that desktop. Opened from the normal desktop it works: next check.
    assert.match(read(LOGS.hook) ?? '', /^runasuser=[01]\r?$/m, read(LOGS.hook));
  });
  // The same installer started as electron-updater starts it, from the normal desktop (silent: no window), now that
  // 3.8.0 is gone: it installs over the new Orb and opens it.
  fs.rmSync(LOGS.hook, { force: true });
  execFileSync(path.join(tmp, 'feed', 'Orb_3.8.1_x64-setup.exe'), ['--updated', '/S', '--force-run'], { stdio: 'ignore', timeout: 60000 });
  await until(() => fs.existsSync(LOGS.opened), 'la Orb nueva se abre', 30000, 250).catch(() => null);
  check('desde el escritorio normal, el gancho abre la Orb nueva tras instalar (--updated)', () => {
    assert.match(read(LOGS.hook) ?? '', /^runasuser=0\r?$/m, read(LOGS.hook));
    assert.ok(fs.existsSync(LOGS.opened), 'no se abrió');
  });
  check('nada del PC real ha cambiado (la Orb 3.8.0 instalada, su entrada y su acceso directo)', () => {
    assert.equal(regGet(REAL_KEY, 'InstallLocation'), realBefore.location);
    assert.equal(regGet(REAL_KEY, 'DisplayVersion'), realBefore.version);
    assert.equal(fs.statSync(path.join(INSTALLED, 'Orb.exe')).mtimeMs, realBefore.exe);
    assert.equal(fs.existsSync(path.join(os.homedir(), 'Desktop', 'Orb.lnk')), realBefore.desktop);
  });
} catch (error) {
  results.push(['✖', 'la prueba', error.stack ?? error.message]);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  // Only what this test started: processes running from its temporary folder.
  try { ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${tmp.replace(/'/g, "''")}\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`); } catch { /* none */ }
  fs.writeFileSync(stopFile, '');
  await wait(1000);
  try { launcher?.kill(); } catch { /* gone */ }
  server?.close();
  try { execFileSync('reg', ['delete', `HKCU\\Software\\OrbE2E-${id}`, '/f'], { stdio: 'ignore' }); } catch { /* gone */ }
  // The 400 MB copy goes; the logs stay for a look.
  for (const big of [ELECTRON_DIR, path.join(tmp, 'feed'), path.join(tmp, 'Local')]) { try { fs.rmSync(big, { recursive: true, force: true }); } catch { /* busy */ } }
}
for (const [mark, name, why] of results) console.log(`${mark} ${name}${why ? `\n    ${why}` : ''}`);
console.log(`\n${results.filter((r) => r[0] === '✔').length}/${results.length} · datos en ${tmp}`);
process.exitCode = results.some((r) => r[0] === '✖') ? 1 : 0;
