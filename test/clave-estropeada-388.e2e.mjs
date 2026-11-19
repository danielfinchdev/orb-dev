// E2E of the start-up way out when Windows cannot read this PC's key (3.8.8): the sealed key files are damaged, Orb must
// show the start error screen with "Empezar con una clave nueva" (not a blank window or a loop); cancelling the dialog
// touches nothing; confirming it (typing EMPEZAR) restarts the engine with a new key, keeps the old one aside and leaves
// the non-secret data (a project) in place.
//   npm run tauri:build:e2e && node test/clave-estropeada-388.e2e.mjs
// Everything lives in a temp folder (ORB_USER_DATA, workspace, backups); nothing of this PC's real profile is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/domain/workspace/home.mjs';
import { loadConfig, merge } from '../src/platform/config-file.mjs';
import { writeJson } from '../src/platform/paths.mjs';
import { secretDir, secretCopy } from '../src/engine/desktop-home.mjs';
import { throughStart, sandboxEnv, TEST_MASTER } from './fixtures/e2e-flows.mjs';
import { launchOrb, E2E_EXE, isTestBuild } from './fixtures/launch-orb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.resolve(E2E_EXE);
if (!isTestBuild(exe)) { console.error(`${exe} is not the test build (npm run tauri:build:e2e)`); process.exit(2); }
const OUT = path.join(ROOT, 'test-results', 'clave-estropeada'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-clave-'));
const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
const { home } = createHome(base, { assistantName: 'Nova', userName: 'Ana' });
writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } }));
const userData = path.join(tmp, 'datos-app'); fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
const env = { ...sandboxEnv(tmp), ORB_NO_UPDATE: '1' };
const PROJECT = 'proyecto-reconocible';
// The ORB2 sealed key (DPAPI blob) in the workspace and its copy outside it: both must be unreadable to fail.
const dataDir = secretDir(home);
const keyFiles = [path.join(dataDir, 'clave2.enc'), secretCopy(userData, home).replace(/\.enc$/, '.v2.enc')];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const until = async (fn, what, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };
const note = (m) => console.log(`  · ${m}`);
const logTail = () => { try { return fs.readFileSync(path.join(home, 'core', 'ejecuciones', 'motor.log'), 'utf8').split('\n').slice(-15).join('\n'); } catch { return '(no motor.log)'; } };

let orb = null;
const errors = [];
const open = async () => { orb = await launchOrb({ exe, userData, env }); orb.page.on('pageerror', (e) => errors.push(e.message)); return orb.page; };
const bodyText = (page) => page.evaluate(() => document.body.innerText).catch(() => '');
try {
  // 1. first start: Orb makes its key; one recognisable project
  let page = await open();
  await throughStart(page, { ready: '[data-testid=chat-greeting]' });
  await orb.call('projects.create', { name: PROJECT });
  assert.ok((await orb.call('projects.list')).some((p) => p.name === PROJECT), 'proyecto creado');
  await orb.close(); orb = null;
  for (const f of keyFiles) assert.ok(fs.existsSync(f), `la clave protegida existe: ${f}`);

  // 2. damage them: same size and ORB2 header, the sealed bytes after it overwritten (DPAPI cannot open that)
  for (const f of keyFiles) { const b = fs.readFileSync(f); for (let i = Math.min(8, b.length - 1); i < b.length; i++) b[i] = (b[i] ^ 0xa5) & 0xff; fs.writeFileSync(f, b); }
  const damaged = keyFiles.map(sha);

  // 3. second start: the error screen with the way out
  page = await open();
  try { await page.waitForSelector('[data-testid=app-error-new-secret]', { timeout: 40000 }); } catch (e) { throw new Error(`no salió la pantalla de error con «Empezar con una clave nueva». Se ve: ${(await bodyText(page)).slice(0, 400)}\nmotor.log:\n${logTail()}`); }
  const errText = await bodyText(page);
  note(`pantalla de error: ${errText.replace(/\s+/g, ' ').slice(0, 300)}`);
  assert.match(errText, /Empezar con una clave nueva/);
  await page.screenshot({ path: path.join(OUT, '1-error-de-arranque.png'), scale: 'css' });

  // 5. cancel: stays on the error screen, files untouched
  await page.click('[data-testid=app-error-new-secret]');
  // With a recovery code (the test profile has one) the dialog is a plain confirm; without it, the word must be typed.
  const word = page.locator('[data-testid=new-secret-word]');
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  const typed = await word.count() > 0;
  note(`typed word asked: ${typed} · `);
  note(`diálogo: ${(await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400)}`);
  await page.getByRole('button', { name: /^Cancelar$/ }).click();
  await dlg.waitFor({ state: 'detached' });
  assert.ok(await page.locator('[data-testid=app-error-new-secret]').isVisible(), 'sigue la pantalla de error');
  assert.deepEqual(keyFiles.map(sha), damaged, 'cancelar no toca los archivos estropeados');

  // 4. confirm: type the word, new key, the app starts again
  await page.click('[data-testid=app-error-new-secret]');
  const ok = dlg.getByRole('button', { name: 'Empezar con una clave nueva' });
  await dlg.waitFor();
  if (await word.count()) { assert.ok(await ok.isDisabled(), 'el botón espera a la palabra'); await word.fill('EMPEZAR'); }
  await ok.click();
  const screen = await until(async () => {
    const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid));
    return ['chat-greeting', 'master-locked', 'master-create'].find((s) => ids.includes(s)) ?? null;
  }, 'una pantalla tras elegir la clave nueva', 60000).catch(async (e) => { throw new Error(`${e.message}. Se ve: ${(await bodyText(page)).slice(0, 400)}
motor.log:
${logTail()}`); });
  note(`tras confirmar llega: ${screen} · ${(await bodyText(page)).replace(/\s+/g, ' ').slice(0, 200)}`);
  assert.notEqual(screen, 'app-error', `volvió a la pantalla de error. motor.log:\n${logTail()}`);
  await page.screenshot({ path: path.join(OUT, '2-tras-clave-nueva.png'), scale: 'css' });
  if (screen === 'master-locked') { await page.fill('[data-testid=master-password]', TEST_MASTER); await page.click('[data-testid=master-unlock]'); }
  else if (screen === 'master-create') await throughStart(page, { ready: '[data-testid=chat-greeting]' });
  await page.waitForSelector('[data-testid=chat-greeting]', { timeout: 60000 });

  // the new key exists, the old one was kept aside, the project is still there
  const files = fs.readdirSync(dataDir); note(`core/datos: ${files.join(', ')}`);
  assert.ok(fs.existsSync(keyFiles[0]) && sha(keyFiles[0]) !== damaged[0], 'hay una clave nueva (clave2.enc cambió)');
  assert.ok(files.some((f) => /^clave2.*ilegible/i.test(f)), 'la clave anterior se guardó aparte (clave2*ilegible*)');
  assert.ok((await orb.call('projects.list')).some((p) => p.name === PROJECT), 'el proyecto sigue ahí');
  assert.deepEqual(errors, [], `errores de la página: ${errors.join(' | ')}`);
  console.log('✔ clave estropeada: pantalla de error, cancelar no toca nada, clave nueva, la anterior aparte y los datos siguen');
} catch (error) {
  console.error(`✖ clave estropeada: ${error.stack ?? error}`);
  console.error(`motor.log:\n${logTail()}`);
  process.exitCode = 1;
} finally {
  await orb?.close().catch(() => {});
  setTimeout(() => {
    for (let i = 0; i < 8; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch (e) { if (i === 7) console.warn(`aviso: no se pudo borrar ${tmp}: ${e.message}`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); } }
    process.exit();
  }, 1500);
}
