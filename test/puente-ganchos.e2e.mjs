// 3.8.1 (review D9 M3/M4/M5): when the bridge from Orb 3.8.0 must NOT go on, with nothing of the real PC touched. Test
// installers built with Orb's real hooks (src-tauri/nsis/hooks.nsh) run silently (no window) against fake 3.8.0 installs
// in a temporary folder and a test registry key; the stand-in uninstaller writes down whether it was run.
//   - its uninstaller fails (exit code ≠ 0): nothing installed, the uninstaller and 3.8.0 stay, no mark;
//   - 3.8.0 in a folder that is not surely its own (the workspace, a folder holding it or the data folder, or one that
//     does not end in \Orb or lacks Orb.exe and resources\app.asar): its uninstaller (RMDir /r) never runs;
//   - an Orb.exe of this user still running (it could be Orb on Tauri: 3.8.0's fallback is `taskkill /IM Orb.exe`): the
//     uninstaller never runs;
//   - and the good case still works: removed, mark written, installed.
//   node test/puente-ganchos.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
// data folder and the workspace given; → run the test installer silently and say what happened.
function scenario(name, { dir, exit = null, workspace = path.join(tmp, name, 'Orb'), data = path.join(tmp, name, 'Orb.dev'), app = true }) {
  const key = `Software\\OrbE2E-${id}-${name}\\Uninstall\\c791290b-4a7b-5a24-9cba-134994a22734`; keys.push(key);
  const log = path.join(tmp, `${name}-desinstalador.txt`);
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  if (app) { fs.copyFileSync(fakeOrb, path.join(dir, 'Orb.exe')); fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'asar'); }
  nsis('desinstalador-falso.nsi', { OUT: path.join(dir, 'Uninstall Orb.exe'), LOG: log, DESKTOP_LINK: path.join(tmp, `${name}-a.lnk`), START_LINK: path.join(tmp, `${name}-b.lnk`), UNINSTKEY: key, ...(exit != null ? { EXIT: exit } : {}) });
  execFileSync('reg', ['add', `HKCU\\${key}`, '/v', 'InstallLocation', '/d', dir, '/f'], { stdio: 'ignore' });
  execFileSync('reg', ['add', `HKCU\\${key}`, '/v', 'DisplayVersion', '/d', '3.8.0', '/f'], { stdio: 'ignore' });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'ubicacion.json'), JSON.stringify({ home: workspace }));
  const target = path.join(tmp, name, 'nuevo');
  const setup = path.join(tmp, `${name}-instalador.exe`);
  nsis('instalador.nsi', { OUT: setup, TAURI_PLUGINS, UNINSTKEY: key, DEFAULT_DIR: path.join(tmp, 'no-existe'), DATA_DIR: data, HOOKS: path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh'), TARGET: target, ARGS_LOG: path.join(tmp, `${name}-args.txt`), FAKE_ORB: fakeOrb, HOOK_LOG: path.join(tmp, `${name}-gancho.txt`) });
  const r = spawnSync(setup, ['/S'], { timeout: 60000 });
  return { code: r.status, uninstallerRan: fs.existsSync(log), installed: fs.existsSync(path.join(target, 'Orb.exe')), mark: fs.existsSync(path.join(data, 'migrado-desde-electron.json')), uninstaller: fs.existsSync(path.join(dir, 'Uninstall Orb.exe')), app: fs.existsSync(path.join(dir, 'Orb.exe')) };
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
    ['contiene', (d) => ({ dir: path.join(d, 'Orb'), workspace: path.join(d, 'Orb', 'trabajo') }), 'una carpeta que contiene el espacio'],
    ['dentro', (d) => ({ dir: path.join(d, 'W', 'Orb'), workspace: path.join(d, 'W') }), 'dentro del espacio de trabajo'],
    ['datos', (d) => ({ dir: path.join(d, 'Orb'), data: path.join(d, 'Orb', 'Orb.dev') }), 'contiene la carpeta de datos de Orb'],
    ['nombre', (d) => ({ dir: path.join(d, 'Programas') }), 'no termina en \\Orb'],
    ['vacia', (d) => ({ dir: path.join(d, 'Orb'), app: false }), 'sin Orb.exe ni resources\\app.asar']
  ]) {
    const r = scenario(name, opts(path.join(tmp, name)));
    check(`M4: ${why} → su desinstalador no se ejecuta y no se instala nada`, () => { assert.notEqual(r.code, 0); assert.ok(!r.uninstallerRan && !r.installed && !r.mark && r.uninstaller, JSON.stringify(r)); });
  }
  {
    // An Orb.exe of this user running (here a stand-in that waits 40 s): the hook waits 15 s for it, then stops.
    const busyDir = path.join(tmp, 'abierto-orb'); fs.mkdirSync(busyDir);
    const sleeper = path.join(busyDir, 'Orb.exe');
    nsis('orb-falso.nsi', { OUT: sleeper, MARK: path.join(tmp, 'dormido.txt'), SLEEP: 40000 });
    busy = spawn(sleeper, [], { stdio: 'ignore' });
    const r = scenario('abierto', { dir: path.join(tmp, 'abierto', 'Programs', 'Orb') });
    check('M5: con un Orb.exe abierto el desinstalador de la 3.8.0 no se ejecuta (su taskkill /IM Orb.exe no cerrará el Orb nuevo)', () => { assert.notEqual(r.code, 0); assert.ok(!r.uninstallerRan && !r.installed, JSON.stringify(r)); assert.equal(busy.exitCode, null, 'el Orb abierto sigue vivo'); });
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
