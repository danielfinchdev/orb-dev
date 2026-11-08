// 3.8.1 (reviews D9 M3/M4/M5, D10 A1/M1): when the bridge from Orb 3.8.0 must NOT go on, with nothing of the real PC
// touched. Test installers built with Orb's real hooks (src-tauri/nsis/hooks.nsh) run silently (no window) against fake
// 3.8.0 installs in a temporary folder and a test registry key; the stand-in uninstaller writes down whether it was run.
// ubicacion.json is written by the engine's own writeJson (indented, UTF-8), as Orb 3.8.0 and 3.8.1 write it.
//   - its uninstaller fails (exit code ≠ 0): nothing installed, the uninstaller and 3.8.0 stay, no mark;
//   - 3.8.0 in a folder that is not surely its own (the workspace, a folder holding it or the data folder, also with ñ
//     and accents in the path; one holding Orb's data or anything electron-builder does not put there; one that does
//     not end in \Orb or lacks Orb.exe and resources\app.asar): its uninstaller (RMDir /r) never runs;
//   - an Orb.exe of this user from another folder running (it could be Orb on Tauri: 3.8.0's fallback is
//     `taskkill /IM Orb.exe`): the uninstaller never runs; one from 3.8.0's own folder still closing is waited for;
//   - started by 3.8.0's updater (--updated /S) and refused: Orb 3.8.0 opens again and puente-fallido.json says why;
//   - and the good case still works: removed, mark written, installed.
//   node test/puente-ganchos.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../src/core/home.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = process.env.LOCALAPPDATA;
const MAKENSIS = path.join(LOCAL, 'tauri', 'NSIS', 'makensis.exe');
const TAURI_PLUGINS = path.join(LOCAL, 'tauri', 'NSIS', 'Plugins', 'x86-unicode', 'additional');
for (const need of [MAKENSIS, path.join(TAURI_PLUGINS, 'nsis_tauri_utils.dll')]) if (!fs.existsSync(need)) { console.error(`falta ${need}`); process.exit(2); }

// The hooks wait for every Orb.exe of this user to end (M5): with one open (the user's, another test's) this cannot run.
if (/Orb\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Orb.exe', '/NH'], { encoding: 'utf8' }))) { console.error('hay un Orb.exe abierto: ciérralo (o espera a la otra prueba) y vuelve a lanzar esta'); process.exit(2); }
const results = [];
const check = (name, fn) => { try { fn(); results.push(['✔', name]); } catch (error) { results.push(['✖', name, error.message.split('\n')[0]]); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ganchos-'));
const id = crypto.randomBytes(4).toString('hex');
const keys = [];
const nsis = (script, defines) => execFileSync(MAKENSIS, ['/V1', ...Object.entries(defines).map(([k, v]) => `/D${k}=${v}`), path.join(ROOT, 'test', 'fixtures', 'puente', script)], { encoding: 'utf8' });
const fakeOrb = path.join(tmp, 'orb-falso.exe');
nsis('orb-falso.nsi', { OUT: fakeOrb, MARK: path.join(tmp, 'abierto.txt') });

// A fake 3.8.0 install in `dir` (Orb.exe, resources\app.asar, the stand-in uninstaller) with its own registry key, the
// data folder and the workspace given; → run the test installer silently and say what happened. `extra` adds files or
// folders (ending in \) to the install, `running` keeps its Orb.exe open that many ms while the installer runs,
// `updated` starts the installer as Orb 3.8.0's updater does (its Orb.exe then writes down that it was opened again).
function scenario(name, { dir, exit = null, workspace = path.join(tmp, name, 'Orb'), data = path.join(tmp, name, 'Orb.dev'), app = true, extra = [], running = 0, updated = false }) {
  const key = `Software\\OrbE2E-${id}-${name}\\Uninstall\\c791290b-4a7b-5a24-9cba-134994a22734`; keys.push(key);
  const log = path.join(tmp, `${name}-desinstalador.txt`);
  const reopened = path.join(tmp, `${name}-reabierta.txt`);
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  if (app) {
    if (running || updated) nsis('orb-falso.nsi', { OUT: path.join(dir, 'Orb.exe'), MARK: reopened, ...(running ? { SLEEP: running } : {}) });
    else fs.copyFileSync(fakeOrb, path.join(dir, 'Orb.exe'));
    fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'asar');
  }
  for (const e of extra) { const p = path.join(dir, e); if (e.endsWith('\\')) fs.mkdirSync(p, { recursive: true }); else fs.writeFileSync(p, 'x'); }
  nsis('desinstalador-falso.nsi', { OUT: path.join(dir, 'Uninstall Orb.exe'), LOG: log, DESKTOP_LINK: path.join(tmp, `${name}-a.lnk`), START_LINK: path.join(tmp, `${name}-b.lnk`), UNINSTKEY: key, ...(exit != null ? { EXIT: exit } : {}) });
  execFileSync('reg', ['add', `HKCU\\${key}`, '/v', 'InstallLocation', '/d', dir, '/f'], { stdio: 'ignore' });
  execFileSync('reg', ['add', `HKCU\\${key}`, '/v', 'DisplayVersion', '/d', '3.8.0', '/f'], { stdio: 'ignore' });
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(data, 'ubicacion.json'), { home: workspace });
  const target = path.join(tmp, name, 'nuevo');
  const setup = path.join(tmp, `${name}-instalador.exe`);
  const hookLog = path.join(tmp, `${name}-gancho.txt`);
  nsis('instalador.nsi', { OUT: setup, TAURI_PLUGINS, UNINSTKEY: key, DEFAULT_DIR: path.join(tmp, 'no-existe'), DATA_DIR: data, HOOKS: path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh'), TARGET: target, ARGS_LOG: path.join(tmp, `${name}-args.txt`), FAKE_ORB: fakeOrb, HOOK_LOG: hookLog });
  let open = null;
  if (running) { open = spawn(path.join(dir, 'Orb.exe'), [], { stdio: 'ignore' }); }
  const started = Date.now();
  const r = spawnSync(setup, updated ? ['--updated', '/S', '--force-run'] : ['/S'], { timeout: 90000 });
  const ms = Date.now() - started;
  if (open && open.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(open.pid), '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  // RunAsUser starts it through the shell: give it a moment.
  if (updated) { const end = Date.now() + 5000; while (Date.now() < end && !fs.existsSync(reopened)) spawnSync('cmd', ['/c', 'ping -n 2 127.0.0.1 >nul']); }
  const failMark = path.join(data, 'puente-fallido.json');
  return {
    code: r.status, ...(r.error ? { error: r.error.message } : {}), ms, uninstallerRan: fs.existsSync(log), installed: fs.existsSync(path.join(target, 'Orb.exe')), target: fs.existsSync(target),
    mark: fs.existsSync(path.join(data, 'migrado-desde-electron.json')), uninstaller: fs.existsSync(path.join(dir, 'Uninstall Orb.exe')), app: fs.existsSync(path.join(dir, 'Orb.exe')),
    failed: fs.existsSync(failMark) ? JSON.parse(fs.readFileSync(failMark, 'utf8')) : null, reopened: fs.existsSync(reopened), hook: fs.existsSync(hookLog) ? fs.readFileSync(hookLog, 'utf8') : ''
  };
}

let busy = null;
try {
  {
    const r = scenario('bien', { dir: path.join(tmp, 'bien', 'Programs', 'Orb') });
    check('el caso bueno: desinstalada, marca escrita e instalada', () => { assert.equal(r.code, 0); assert.ok(r.uninstallerRan && r.mark && r.installed && !r.app, JSON.stringify(r)); });
  }
  {
    const r = scenario('falla', { dir: path.join(tmp, 'falla', 'Programs', 'Orb'), exit: 2 });
    check('M3: el desinstalador falla → no se instala nada, la 3.8.0 y su desinstalador siguen, sin marca', () => { assert.notEqual(r.code, 0); assert.ok(r.uninstallerRan, 'se intentó'); assert.ok(!r.installed && !r.mark && r.uninstaller && r.app, JSON.stringify(r)); });
  }
  for (const [name, opts, why] of [
    ['espacio', (d) => ({ dir: path.join(d, 'Orb'), workspace: path.join(d, 'Orb') }), 'instalada en el espacio de trabajo'],
    ['espacio-ñ', (d) => ({ dir: path.join(d, 'Ñandú café', 'Orb'), workspace: path.join(d, 'Ñandú café', 'Orb') }), 'instalada en el espacio de trabajo, con ñ y tildes en la ruta'],
    ['contiene', (d) => ({ dir: path.join(d, 'Orb'), workspace: path.join(d, 'Orb', 'trabajo') }), 'una carpeta que contiene el espacio'],
    ['contiene-ñ', (d) => ({ dir: path.join(d, 'Año 𝄞', 'Orb'), workspace: path.join(d, 'Año 𝄞', 'Orb', 'código') }), 'una carpeta que contiene el espacio, con ñ y un carácter fuera del BMP'],
    ['dentro', (d) => ({ dir: path.join(d, 'W', 'Orb'), workspace: path.join(d, 'W') }), 'dentro del espacio de trabajo'],
    ['datos', (d) => ({ dir: path.join(d, 'Orb'), data: path.join(d, 'Orb', 'Orb.dev') }), 'contiene la carpeta de datos de Orb'],
    ['core', (d) => ({ dir: path.join(d, 'Orb'), extra: ['core\\'] }), 'con core\\ (un espacio de Orb aunque ubicacion.json diga otro)'],
    ['orbjson', (d) => ({ dir: path.join(d, 'Orb'), extra: ['orb.json'] }), 'con orb.json'],
    ['ubicacion', (d) => ({ dir: path.join(d, 'Orb'), extra: ['ubicacion.json'] }), 'con ubicacion.json (datos de Orb)'],
    ['ajeno', (d) => ({ dir: path.join(d, 'Orb'), extra: ['notas.txt'] }), 'con un archivo que electron-builder no pone'],
    ['nombre', (d) => ({ dir: path.join(d, 'Programas') }), 'no termina en \\Orb'],
    ['vacia', (d) => ({ dir: path.join(d, 'Orb'), app: false }), 'sin Orb.exe ni resources\\app.asar']
  ]) {
    const r = scenario(name, opts(path.join(tmp, name)));
    check(`M4: ${why} → su desinstalador no se ejecuta y no se instala nada`, () => { assert.notEqual(r.code, 0); assert.ok(!r.uninstallerRan && !r.installed && !r.mark && r.uninstaller, JSON.stringify(r)); assert.equal(r.failed?.reason, 'carpeta', JSON.stringify(r)); assert.ok(!r.target, 'la carpeta vacía de la instalación nueva no se queda'); });
  }
  {
    // What electron-builder puts in Orb 3.8.0's folder is its own: the good case with those files, outside the default.
    const r = scenario('ficheros', { dir: path.join(tmp, 'ficheros', 'Programas', 'Orb'), workspace: path.join(tmp, 'ficheros', 'Mis cosas', 'Orb'), extra: ['locales\\', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'chrome_100_percent.pak', 'd3dcompiler_47.dll', 'icudtl.dat', 'snapshot_blob.bin', 'vk_swiftshader_icd.json'] });
    check('A1: con los archivos de Electron y el espacio en otra carpeta con espacios → sí se desinstala e instala', () => { assert.equal(r.code, 0, JSON.stringify(r)); assert.ok(r.uninstallerRan && r.mark && r.installed && !r.failed, JSON.stringify(r)); });
  }
  {
    // An Orb.exe of this user from another folder (here a stand-in that waits 40 s): refused at once, it stays alive.
    const busyDir = path.join(tmp, 'abierto-orb'); fs.mkdirSync(busyDir);
    const sleeper = path.join(busyDir, 'Orb.exe');
    nsis('orb-falso.nsi', { OUT: sleeper, MARK: path.join(tmp, 'dormido.txt'), SLEEP: 40000 });
    busy = spawn(sleeper, [], { stdio: 'ignore' });
    const r = scenario('abierto', { dir: path.join(tmp, 'abierto', 'Programs', 'Orb') });
    check('M5: con otro Orb.exe abierto el desinstalador de la 3.8.0 no se ejecuta (su taskkill /IM Orb.exe no cerrará el Orb nuevo)', () => { assert.notEqual(r.code, 0); assert.ok(!r.uninstallerRan && !r.installed, JSON.stringify(r)); assert.equal(r.failed?.reason, 'otro', JSON.stringify(r)); assert.equal(busy.exitCode, null, 'el Orb abierto sigue vivo'); });
    try { execFileSync('taskkill', ['/PID', String(busy.pid), '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    busy = null;
  }
  {
    // Orb 3.8.0 itself still closing (its Orb.exe ends after 4 s): waited for, then on.
    const r = scenario('cerrando', { dir: path.join(tmp, 'cerrando', 'Programs', 'Orb'), running: 4000 });
    check('M1: solo se espera a los Orb.exe de la carpeta de la 3.8.0: si se está cerrando, se espera y se instala', () => { assert.equal(r.code, 0, JSON.stringify(r)); assert.ok(r.uninstallerRan && r.installed && r.ms >= 3000, JSON.stringify(r)); });
  }
  {
    // Started by 3.8.0's updater (--updated /S --force-run) in a folder that is not safe: 3.8.0 opens again, with a mark.
    const r = scenario('reabrir', { dir: path.join(tmp, 'reabrir', 'Orb'), workspace: path.join(tmp, 'reabrir', 'Orb'), updated: true });
    check('M1: negado tras «Reiniciar e instalar» → la 3.8.0 se vuelve a abrir y puente-fallido.json dice por qué', () => { assert.notEqual(r.code, 0); assert.ok(!r.uninstallerRan && !r.installed && r.app, JSON.stringify(r)); assert.deepEqual(r.failed, { from: 'electron', version: '3.8.0', reason: 'carpeta', updated: 1 }); assert.ok(r.reopened && /reabierta=0/.test(r.hook), JSON.stringify(r)); });
  }
} catch (error) {
  results.push(['✖', 'la prueba', error.stack ?? error.message]);
} finally {
  if (busy?.pid && busy.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(busy.pid), '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  for (const k of keys) { try { execFileSync('reg', ['delete', `HKCU\\${k.split('\\Uninstall')[0]}`, '/f'], { stdio: 'ignore' }); } catch { /* gone */ } }
}
for (const [mark, name, why] of results) console.log(`${mark} ${name}${why ? `\n    ${why}` : ''}`);
const failed = results.some((r) => r[0] === '✖');
if (!failed) { await new Promise((r) => setTimeout(r, 500)); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
console.log(`\n${results.filter((r) => r[0] === '✔').length}/${results.length}${failed ? ` · datos en ${tmp}` : ''}`);
process.exitCode = failed ? 1 : 0;
