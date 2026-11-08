// 3.8.1 (D9): Orb on Tauri updating itself, with nobody at the PC. The e2e build (npm run tauri:build:e2e) runs with its
// window never shown, its data in %TEMP%, and its updater pointed at a local feed (ORB_UPDATE_URL, which only that build
// reads): latest.json made by scripts/release-manifests.mjs for a fake 9.9.9 installer signed with Orb's updater key.
//   - a new version is found and downloaded through the window's own buttons (window.orb.update), its signature checked
//     against the public key in tauri.conf.json;
//   - a tampered installer, or one signed for another version than the feed announces (requireSignedVersion), is refused
//     and the window offers to try again;
//   - nothing is installed: «Reiniciar e instalar» would run the real installer on this PC (left for the owner's PC).
// Needs the updater's private key: TAURI_SIGNING_PRIVATE_KEY (its path or contents) and TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
//   node test/tauri-actualizar.e2e.mjs [--exe <Orb.exe>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { makeManifests } from '../scripts/release-manifests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argExe = process.argv.indexOf('--exe');
const EXE = argExe > 0 ? process.argv[argExe + 1] : path.join(ROOT, 'src-tauri', 'target-e2e', 'release', 'Orb.exe');
if (!fs.existsSync(EXE)) { console.error(`no existe ${EXE} (npm run tauri:build:e2e)`); process.exit(2); }
if (!process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD == null) { console.error('falta la clave del actualizador (TAURI_SIGNING_PRIVATE_KEY y TAURI_SIGNING_PRIVATE_KEY_PASSWORD)'); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 60000, every = 200) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(every); } throw new Error(`no llegó: ${what}`); };
const results = [];
const check = (name, fn) => { try { fn(); results.push(['✔', name]); } catch (error) { results.push(['✖', name, error.message.split('\n')[0]]); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-e2e-actualizar-'));
const USER_DATA = path.join(tmp, 'datos-app');
fs.mkdirSync(USER_DATA, { recursive: true });

// ---- three feeds: a good release, a tampered installer, and an installer signed for another version
// The key as `tauri build` takes it: its path or its contents (`signer sign` wants a path in _PATH).
const KEY = process.env.TAURI_SIGNING_PRIVATE_KEY;
const signEnv = { ...process.env };
if (fs.existsSync(KEY)) { delete signEnv.TAURI_SIGNING_PRIVATE_KEY; signEnv.TAURI_SIGNING_PRIVATE_KEY_PATH = KEY; }
const sign = (file, version) => execFileSync(process.execPath, [path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'signer', 'sign', '--app-version', version, file], { env: signEnv, stdio: 'ignore' });
const feeds = {};
for (const [name, signedFor] of [['buena', '9.9.9'], ['alterada', '9.9.9'], ['otra-version', '9.9.8']]) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir);
  const setup = path.join(dir, 'Orb_9.9.9_x64-setup.exe');
  fs.writeFileSync(setup, crypto.randomBytes(256 * 1024));
  sign(setup, signedFor);
  feeds[name] = { dir, setup };
}
let mode = 'buena';
const served = [];
const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, 'http://x').pathname); served.push(`${mode}:${name}`);
  const file = path.join(feeds[mode].dir, name);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (mode === 'alterada' && name.endsWith('.exe')) { body = Buffer.from(body); body[1000] ^= 0xff; }
  res.writeHead(200, { 'content-length': body.length }); res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
for (const [name, f] of Object.entries(feeds)) {
  if (name === 'otra-version') {
    // The trusted comment says 9.9.8: the manifest generator refuses it, so this manifest is written by hand.
    fs.writeFileSync(path.join(f.dir, 'latest.json'), JSON.stringify({ version: '9.9.9', pub_date: new Date().toISOString(), platforms: { 'windows-x86_64': { url: `${base}Orb_9.9.9_x64-setup.exe`, signature: fs.readFileSync(`${f.setup}.sig`, 'utf8') } } }));
  } else makeManifests({ setup: f.setup, out: f.dir, version: '9.9.9', base });
}

// ---- Orb, hidden, its updater on the local feed
const port = 9400 + Math.floor(Math.random() * 500);
const env = { ...process.env, ORB_USER_DATA: USER_DATA, ORB_UPDATE_URL: base, ORB_NO_ADB: '1', ORB_E2E_CDP_PORT: String(port), ORB_HIDDEN_WINDOW: '1' };
for (const k of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'ORB_NO_UPDATE', 'ORB_FAKE_UPDATE']) delete env[k];
const app = spawn(EXE, [], { env, stdio: 'ignore' });
const exited = new Promise((r) => app.once('exit', r));
let cdp = null;
try {
  cdp = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana (CDP)', 60000, 250);
  const page = await until(() => cdp.contexts().flatMap((c) => c.pages()).find((p) => /tauri\.localhost/.test(p.url())), 'la página principal', 60000, 250);
  await page.waitForFunction(() => Boolean(window.orb?.update), null, { timeout: 30000 });
  const update = (what) => page.evaluate((w) => window.orb.update[w](), what);
  // The window hears each change as 'app:update'.
  await page.evaluate(() => { window.__updates = []; window.orb.on('app:update', (s) => window.__updates.push(s)); });
  const settle = (states) => until(async () => { const s = await update('get'); return states.includes(s.state) ? s : null; }, states.join('/'), 60000);

  const first = await update('get');
  await update('check');
  const found = await settle(['available', 'error', 'none']);
  await update('download');
  const done = await settle(['downloaded', 'available']);
  const heard = await page.evaluate(() => window.__updates.map((s) => s.state));
  check('encuentra la 9.9.9 en el latest.json y la descarga con su firma comprobada (clave de Orb)', () => {
    assert.equal(first.state, 'idle', JSON.stringify(first));
    assert.equal(first.portable, false);
    assert.equal(found.state, 'available', JSON.stringify(found));
    assert.equal(found.version, '9.9.9');
    assert.equal(done.state, 'downloaded', JSON.stringify(done));
    assert.equal(done.percent, 100);
    assert.ok(heard.includes('checking') && heard.includes('downloading') && heard.includes('downloaded'), heard.join(' '));
    assert.ok(served.includes('buena:latest.json') && served.includes('buena:Orb_9.9.9_x64-setup.exe'), served.join(' '));
  });

  // A fresh Orb for each refusal (a downloaded version stays until it is installed).
  // The first one is ended from outside: closing it with a version downloaded would run that installer.
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  await Promise.race([exited, wait(15000)]);
  for (const [name, why] of [['alterada', 'un instalador alterado'], ['otra-version', 'un instalador firmado para otra versión (requireSignedVersion)']]) {
    mode = name;
    const again = spawn(EXE, [], { env, stdio: 'ignore' });
    const gone = new Promise((r) => again.once('exit', r));
    try {
      await cdp.close().catch(() => {});
      cdp = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana (CDP)', 60000, 250);
      const p2 = await until(() => cdp.contexts().flatMap((c) => c.pages()).find((p) => /tauri\.localhost/.test(p.url())), 'la página principal', 60000, 250);
      await p2.waitForFunction(() => Boolean(window.orb?.update), null, { timeout: 30000 });
      const u2 = (what) => p2.evaluate((w) => window.orb.update[w](), what);
      await u2('check');
      const f2 = await until(async () => { const s = await u2('get'); return ['available', 'error'].includes(s.state) ? s : null; }, 'check', 60000);
      await u2('download');
      const d2 = await until(async () => { const s = await u2('get'); return s.state !== 'downloading' && (s.state === 'downloaded' || s.error) ? s : null; }, 'download', 60000);
      check(`rechaza ${why} y vuelve a «Descargar e instalar» con el motivo`, () => {
        assert.equal(f2.state, 'available', JSON.stringify(f2));
        assert.equal(d2.state, 'available', JSON.stringify(d2));
        assert.ok(d2.error, 'sin motivo');
      });
      await p2.evaluate(() => window.orb.windowControls.act('close')).catch(() => {});
      await Promise.race([gone, wait(15000)]);
      if (again.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(again.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
    } catch (error) { results.push(['✖', `rechazo: ${name}`, error.message]); try { execFileSync('taskkill', ['/PID', String(again.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  }
} catch (error) {
  results.push(['✖', 'la prueba', error.stack ?? error.message]);
} finally {
  try { await cdp?.close(); } catch { /* gone */ }
  if (app.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  server.close();
}
for (const [mark, name, why] of results) console.log(`${mark} ${name}${why ? `\n    ${why}` : ''}`);
console.log(`\n${results.filter((r) => r[0] === '✔').length}/${results.length} · datos en ${tmp}`);
process.exitCode = results.some((r) => r[0] === '✖') ? 1 : 0;
