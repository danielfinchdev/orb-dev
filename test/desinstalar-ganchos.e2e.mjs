// 3.8.12 (point 19): the installer hooks of «Desinstalar», run for real in a temporary folder and nothing else. A test installer
// built with Orb's real hooks (src-tauri/nsis/hooks.nsh; test/fixtures/puente/ganchos-desinstalar.nsi) installs a fake Orb into a
// temporary folder and its uninstaller is run silently, with the app's data folder and the web view's profile being temporary
// folders too. Never a real Orb, a real data folder or the real installer.
//   - uninstalled from Windows (no /ORBPURGE): a mark with no code, and no data deleted;
//   - with the code of a fresh mark: the app's data and the web view's profile go; the keys' folder stays when the mark says
//     something encrypted was kept; the web view's profile stays when the minigames were kept;
//   - an expired code, a wrong code, a malformed one, or no mark: nothing is deleted;
//   - an update (/UPDATE): nothing is deleted and no mark is written;
//   - a junction inside the data folder is removed as a link, never entered;
//   - reinstalling keeps a mark that was already there.
//   node test/desinstalar-ganchos.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = process.env.LOCALAPPDATA;
const MAKENSIS = path.join(LOCAL, 'tauri', 'NSIS', 'makensis.exe');
const PLUGINS = path.join(LOCAL, 'tauri', 'NSIS', 'Plugins', 'x86-unicode', 'additional');
if (!fs.existsSync(MAKENSIS)) { console.log('sin makensis: no se prueba'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ganchos-desinst-'));
const CODE = 'abcdef0123456789abcdef0123456789';
const results = [];
const check = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (error) { results.push(['FALLA', name, error.message.split('\n')[0]]); } };

// A fresh install of the fixture; → its folders. mark: text of desinstalado.json to leave before installing (or null).
function install(name, { mark = null } = {}) {
  const base = path.join(tmp, name);
  const dirs = { target: path.join(base, 'programa'), data: path.join(base, 'Orb.dev'), local: path.join(base, 'dev.orb.app'), out: path.join(base, 'instalador.exe') };
  for (const d of [dirs.data, dirs.local]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirs.data, 'ubicacion.json'), '{"home":"X:\\\\prueba"}');
  fs.mkdirSync(path.join(dirs.data, 'claves'), { recursive: true }); fs.writeFileSync(path.join(dirs.data, 'claves', 'k.v2.enc'), 'k');
  fs.mkdirSync(path.join(dirs.local, 'EBWebView'), { recursive: true }); fs.writeFileSync(path.join(dirs.local, 'EBWebView', 'x'), 'x');
  if (mark) fs.writeFileSync(path.join(dirs.data, 'desinstalado.json'), mark);
  execFileSync(MAKENSIS, ['/V1', `/DOUT=${dirs.out}`, `/DHOOKS=${path.join(ROOT, 'src-tauri', 'nsis', 'hooks.nsh')}`, `/DTAURI_PLUGINS=${PLUGINS}`, `/DUNINSTKEY=Software\\OrbPruebaGanchos\\${name}`, `/DDEFAULT_DIR=${path.join(base, 'no-hay')}`, `/DDATA_DIR=${dirs.data}`, `/DLOCAL_DIR=${dirs.local}`, `/DTARGET=${dirs.target}`, path.join(ROOT, 'test', 'fixtures', 'puente', 'ganchos-desinstalar.nsi')], { encoding: 'utf8' });
  const r = spawnSync(dirs.out, ['/S'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'installer');
  return dirs;
}
const uninstall = (dirs, args) => { const r = spawnSync(path.join(dirs.target, 'uninstall.exe'), [...args, `_?=${dirs.target}`], { encoding: 'utf8' }); assert.equal(r.status, 0, 'uninstaller'); };
const markText = (o = {}) => JSON.stringify({ v: 1, at: new Date().toISOString(), mode: 'uninstall', encrypted: false, games: false, code: CODE, expires: Date.now() + 3_600_000, ...o });
const exists = (...p) => fs.existsSync(path.join(...p));

try {
  check('from Windows: a mark with no code, nothing deleted', () => {
    const d = install('windows'); uninstall(d, ['/S']);
    const m = JSON.parse(fs.readFileSync(path.join(d.data, 'desinstalado.json'), 'utf8'));
    assert.equal(m.code, ''); assert.equal(m.expires, 0);
    assert.ok(exists(d.data, 'ubicacion.json') && exists(d.data, 'claves', 'k.v2.enc') && exists(d.local, 'EBWebView', 'x'));
  });
  check('an existing mark is never overwritten by a Windows uninstall', () => {
    const d = install('previa', { mark: markText({ encrypted: true }) }); uninstall(d, ['/S']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d.data, 'desinstalado.json'), 'utf8')).code, CODE);
  });
  check('reinstalling keeps a mark that was already there', () => {
    const d = install('reinstalar', { mark: markText() });
    assert.ok(exists(d.data, 'desinstalado.json'));
  });
  check('with the code: the app data and the web view profile go', () => {
    const d = install('purga', { mark: markText() }); uninstall(d, ['/S', `/ORBPURGE=${CODE}`]);
    assert.ok(!exists(d.data) && !exists(d.local));
  });
  check('something encrypted kept: the keys folder stays, the rest of the data goes', () => {
    const d = install('claves', { mark: markText({ encrypted: true }) }); uninstall(d, ['/S', `/ORBPURGE=${CODE}`]);
    assert.ok(exists(d.data, 'claves', 'k.v2.enc')); assert.ok(!exists(d.data, 'ubicacion.json') && !exists(d.data, 'desinstalado.json')); assert.ok(!exists(d.local));
  });
  check('minigames kept: the web view profile stays', () => {
    const d = install('juegos', { mark: markText({ games: true }) }); uninstall(d, ['/S', `/ORBPURGE=${CODE}`]);
    assert.ok(exists(d.local, 'EBWebView', 'x')); assert.ok(!exists(d.data));
  });
  for (const [name, args, mark] of [
    ['expired code', [`/ORBPURGE=${CODE}`], markText({ expires: Date.now() - 1000 })],
    ['wrong code', ['/ORBPURGE=00000000000000000000000000000000'], markText()],
    ['short code', ['/ORBPURGE=abc'], markText({ code: 'abc' })],
    ['code not hex', [`/ORBPURGE=${'g'.repeat(32)}`], markText({ code: 'g'.repeat(32) })],
    ['no mark', [`/ORBPURGE=${CODE}`], null],
    ['a mark with no code (from Windows)', [`/ORBPURGE=${CODE}`], markText({ code: '', expires: 0 })]
  ]) {
    check(`${name}: nothing is deleted`, () => {
      const d = install(name.replace(/\W+/g, '-'), { mark }); uninstall(d, ['/S', ...args]);
      assert.ok(exists(d.data, 'ubicacion.json') && exists(d.data, 'claves', 'k.v2.enc') && exists(d.local, 'EBWebView', 'x'));
    });
  }
  check('an update (/UPDATE): nothing deleted, no mark written', () => {
    const d = install('update', { mark: markText() }); uninstall(d, ['/S', '/UPDATE', `/ORBPURGE=${CODE}`]);
    assert.ok(exists(d.data, 'ubicacion.json') && exists(d.local, 'EBWebView', 'x'));
    const e = install('update2'); uninstall(e, ['/S', '/UPDATE']);
    assert.ok(!exists(e.data, 'desinstalado.json'));
  });
  check('a junction in the data folder is removed as a link, never entered', () => {
    const d = install('junction', { mark: markText() });
    const outside = path.join(tmp, 'ajena'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'mia.txt'), 'mia');
    fs.symlinkSync(outside, path.join(d.data, 'enlace'), 'junction');
    uninstall(d, ['/S', `/ORBPURGE=${CODE}`]);
    assert.ok(!exists(d.data)); assert.equal(fs.readFileSync(path.join(outside, 'mia.txt'), 'utf8'), 'mia');
  });
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp folder */ }
  for (const r of results) console.log(r.join('  '));
  if (results.some((r) => r[0] !== 'ok')) process.exit(1);
}
