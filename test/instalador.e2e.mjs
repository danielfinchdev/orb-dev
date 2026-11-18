// Pictures of the new installer face. It starts the TEST binary (built with `npm run installer:build -- --prueba`: no setup inside,
// so it can install nothing), hidden and with a debugging port, goes through every screen and every ending in light and dark,
// and saves PNGs in test-results/instalador/. Nothing is installed, uninstalled or written outside that folder.
//   node test/instalador.e2e.mjs [--exe <orb-instalador.exe>]
// It is a heavy job (several windows of WebView2): take the PC's heavy turn first. It is not part of `npm test`.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argExe = process.argv.indexOf('--exe');
const EXE = argExe > 0 ? process.argv[argExe + 1] : path.join(ROOT, 'src-tauri', 'installer', 'target', 'release', `Orb-${JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version}-instalador-nuevo-PRUEBA.exe`);
const OUT = path.join(ROOT, 'test-results', 'instalador');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 30000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await wait(200); } throw new Error(`${what}${last ? `: ${last.message}` : ''}`); };

if (!fs.existsSync(EXE)) { console.error(`no existe ${EXE} (npm run installer:build -- --prueba)`); process.exit(2); }
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const shots = [];

async function launch(args) {
  const port = 9700 + Math.floor(Math.random() * 200);
  const child = spawn(EXE, ['--prueba=ok', ...args.filter((a) => !a.startsWith('--prueba')), `--puerto=${port}`, '--oculta', ...args.filter((a) => a.startsWith('--prueba'))], { stdio: 'ignore', env: { ...process.env, ORB_INSTALADOR_PRUEBA: '1' } });
  const kill = () => { if (child.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } } };
  try {
    const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana del instalador (CDP)');
    const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://orbinst.localhost/')), 'la página');
    await page.waitForSelector('.win .bar');
    const cdp = await page.context().newCDPSession(page);
    const scheme = (value) => cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    const close = async () => { try { await browser.close(); } catch { /* gone */ } kill(); };
    return { page, scheme, close, child };
  } catch (e) { kill(); throw e; }
}

async function snap(run, name, lang) {
  for (const [value, label] of [['light', 'claro'], ['dark', 'oscuro']]) {
    await run.scheme(value);
    await wait(150);
    const file = `${String(++n).padStart(2, '0')}-${name}-${lang}-${label}.png`;
    await run.page.screenshot({ path: path.join(OUT, file) });
    shots.push(file);
  }
}

const text = (run) => run.page.locator('.content').innerText();

async function walk({ name, lang, args, finalText, extra }) {
  const run = await launch([`--lang=${lang}`, '--pausa=2400', ...args]);
  try {
    const { page } = run;
    const size = await page.evaluate(() => [innerWidth, innerHeight]);
    assert.deepEqual(size, [760, 520], 'the window is the size of the mock-up');
    await page.waitForSelector('[data-screen="hola"]');
    await snap(run, `${name}-1-bienvenida`, lang);
    if (extra) await extra(run);
    await page.click('[data-act="to-donde"]');
    await page.waitForSelector('[data-screen="donde"]');
    await snap(run, `${name}-2-donde`, lang);
    assert.equal(await page.locator('.testbar').count(), 1, 'the test banner is on every screen');
    if (name === 'ok' && lang === 'es') {
      // Orb 3.8.0's own folder is never accepted as the destination
      await page.fill('#dir', 'C:\\Users\\Dani\\AppData\\Local\\Programs\\Orb');
      await page.dispatchEvent('#dir', 'change');
      await page.waitForSelector('.field.bad');
      assert.match(await text(run), /carpeta de Orb 3\.8\.0/);
      assert.equal(await page.locator('[data-act="install"]').isDisabled(), true);
      await snap(run, 'carpeta-electron', lang);
      await page.fill('#dir', 'C:\\Users\\Dani\\AppData\\Local\\Orb');
      await page.dispatchEvent('#dir', 'change');
      await page.waitForSelector('.field:not(.bad)');
    }
    await page.click('[data-act="install"]');
    await page.waitForSelector('[data-screen="copia"]');
    await page.waitForSelector('.tasks li.cur');
    // a reload in the middle of the installation brings the same screen back (the state is kept by the program)
    await page.reload();
    await page.waitForSelector('[data-screen="copia"]');
    await page.keyboard.press('F5');
    await wait(300);
    assert.equal(await page.locator('[data-screen="copia"]').count(), 1, 'F5 does nothing');
    await snap(run, `${name}-3-instalando`, lang);
    await page.waitForSelector('[data-screen="listo"], [data-screen="error"]', { timeout: 20000 });
    const body = await text(run);
    assert.match(body, finalText, `${name}: the ending says what happened`);
    await snap(run, `${name}-4-final`, lang);
  } finally { await run.close(); }
}

const CASES = [
  { name: 'ok', args: ['--prueba=ok'], finalText: { es: /Orb está instalado/, en: /Orb is installed/ }, extra: null },
  { name: 'rechazo-abierto', args: ['--prueba=rechazo:abierto'], finalText: { es: /Orb 3\.8\.0 sigue abierto/, en: /Orb 3\.8\.0 is still open/ } },
  { name: 'rechazo-otro', args: ['--prueba=rechazo:otro'], finalText: { es: /Hay otro Orb abierto/, en: /Another Orb is open/ } },
  { name: 'rechazo-admin', args: ['--prueba=rechazo:elevado'], finalText: { es: /como administrador/, en: /as administrator/ } },
  { name: 'rechazo-carpeta', args: ['--prueba=rechazo:carpeta'], finalText: { es: /junto a otros archivos/, en: /next to other files/ } },
  { name: 'rechazo-desinstalador', args: ['--prueba=rechazo:desinstalador'], finalText: { es: /No se pudo desinstalar Orb 3\.8\.0/, en: /could not be uninstalled/ } },
  { name: 'orb-abierto', args: ['--prueba=abierto'], finalText: { es: /Orb 3\.8\.0 sigue abierto/, en: /Orb 3\.8\.0 is still open/ } },
  { name: 'error', args: ['--prueba=error'], finalText: { es: /código 1603/, en: /code 1603/ } },
];

for (const c of CASES) await walk({ ...c, lang: 'es', finalText: c.finalText.es });
for (const c of CASES.filter((x) => ['ok', 'rechazo-desinstalador', 'error'].includes(x.name))) await walk({ ...c, name: `${c.name}`, lang: 'en', finalText: c.finalText.en });

// A fresh install (no Orb 3.8.0), the cancel question and a ending with no "open Orb" switch.
{
  const run = await launch(['--lang=es', '--electron=no', '--pausa=300', '--abrir=no', '--prueba=ok']);
  try {
    await run.page.waitForSelector('[data-screen="hola"]');
    assert.equal(await run.page.locator('.notice').count(), 0, 'no Orb 3.8.0: no notice');
    await snap(run, 'nueva-1-bienvenida', 'es');
    await run.page.click('[data-act="ask-cancel"]');
    await run.page.waitForSelector('.dialog');
    await snap(run, 'cancelar', 'es');
    await run.page.click('[data-act="keep"]');
    await run.page.click('[data-act="to-donde"]');
    await run.page.fill('#dir', 'C:\\Windows\\Orb');
    await run.page.dispatchEvent('#dir', 'change');
    await run.page.waitForSelector('.field.bad');
    assert.equal(await run.page.locator('[data-act="install"]').isDisabled(), true, 'a folder that needs administrator cannot be installed to');
    await snap(run, 'carpeta-no-vale', 'es');
    await run.page.fill('#dir', 'C:\\Users\\Dani\\AppData\\Local\\Orb');
    await run.page.dispatchEvent('#dir', 'change');
    await run.page.click('[data-act="toggle-shortcuts"]');
    await run.page.click('[data-act="install"]');
    await run.page.waitForSelector('[data-screen="listo"]', { timeout: 20000 });
    assert.equal(await run.page.locator('[data-act="toggle-open"]').count(), 0, 'no known Orb to open: no switch');
    await snap(run, 'listo-sin-abrir', 'es');
  } finally { await run.close(); }
}

assert.ok(shots.length >= 60, `pictures taken: ${shots.length}`);
console.log(`${shots.length} capturas en ${OUT}`);
for (const s of shots) console.log(s);
