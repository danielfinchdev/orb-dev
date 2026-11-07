// Exploratory pass over the PACKAGED app (no agents needed): the welcome screen and the first run («Preparando tu PC»),
// every view in day and night, each section of Ajustes, the five visual themes, a narrow window and the settings'
// switches and checks, with screenshots in test-results/explora/ (explora-en/ with ORB_LANG=en) and the page errors
// collected. Not an assertion test: it is for looking at.   ORB_E2E_EXE=dist/win-unpacked/Orb.exe node test/explora.e2e.mjs
import { _electron as electron, chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHome, loadConfig, writeJson, merge } from '../src/core/home.mjs';
import { SKINS } from '../src/core/appearance.mjs';
import { throughStart, sandboxEnv } from './fixtures/e2e-flows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.ORB_E2E_EXE; // optional: a packaged build instead of the sources
const electronBin = (await import('electron')).default;
const LANG = process.env.ORB_LANG || '';
const OUT = path.join(ROOT, 'test-results', LANG ? `explora-${LANG}` : 'explora'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-explora-'));
const until = async (fn, what, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };
const notes = [];
const note = (s) => { notes.push(s); console.log(`  · ${s}`); };

// The sources run under Playwright's Electron driver; a packaged build refuses --inspect (a security fuse), so it is
// driven through the window's DevTools port instead (as smoke.e2e): then `app` is null and the pictures and the window
// size go through the page.
async function open(userData, env = {}) {
  let app = null; let page; let stop;
  if (exe) {
    const port = 9300 + Math.floor(Math.random() * 500);
    const child = spawn(exe, [`--remote-debugging-port=${port}`], { env: { ...process.env, ...sandboxEnv(tmp), ORB_USER_DATA: userData, ...env }, stdio: 'ignore' });
    const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 'la ventana de la app');
    page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('index.html')), 'la página principal');
    stop = async () => { await browser.close().catch(() => {}); try { if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill(); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 1500)); };
  } else {
    app = await electron.launch({ executablePath: electronBin, args: [ROOT], env: { ...process.env, ...sandboxEnv(tmp), ORB_USER_DATA: userData, ...env } });
    page = await app.firstWindow();
    stop = async () => { await app.close().catch(() => {}); };
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  return { app, page, errors, close: stop };
}
// The window's own capture (what the user sees, with the interface zoom and the screen scaling); the page's with a
// packaged build.
const shooter = (app, page) => async (name) => {
  await page.waitForTimeout(500);
  if (!app) { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); return; }
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html')).webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, 'base64'));
};
// Ajustes closes with Escape; if it does not (noted: that is a finding), the X closes it so the tour goes on.
const closeSettings = async (page, where) => {
  await page.keyboard.press('Escape');
  const closed = await until(async () => (await page.locator('[data-testid=settings-dialog]').count()) === 0, 'ajustes cerrado', 3000).catch(() => false);
  if (closed) return;
  note(`${where}: Escape no cerró Ajustes (se cierra con la X)`);
  await page.locator('[data-testid=settings-dialog] button:has(span.sr-only)').click();
  await until(async () => (await page.locator('[data-testid=settings-dialog]').count()) === 0, 'ajustes cerrado con la X');
};
// Text that overflows its box inside the main area (truncated labels are fine: they are meant to be cut).
const overflow = (page) => page.evaluate(() => [...document.querySelectorAll('main *, [role=dialog] *')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible' && e.clientWidth > 0 && !e.classList.contains('truncate') && !e.closest('.truncate, .sr-only') && !e.closest('pre, .overflow-x-auto, [data-slot=scroll-area-viewport]')).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 70)} ${e.scrollWidth}>${e.clientWidth}`));

try {
  // ---- 1. a brand-new PC: the welcome wizard, straight into the app.
  {
    const userData = path.join(tmp, 'nuevo'); fs.mkdirSync(userData);
    const base = path.join(tmp, 'PrimerPC'); fs.mkdirSync(base);
    const { app, page, errors, close } = await open(userData, { ORB_DEFAULT_BASE: base });
    const shot = shooter(app, page);
    // 3.7: the 3.5.1 welcome: the assistant's name, what to call you, the folder (3.8: already chosen: ORB_DEFAULT_BASE);
    // 3.8: «Ordenar carpetas» when there is something to move and «Crea tu contraseña maestra»; on Windows «Preparando
    // tu PC».
    await page.waitForSelector('[data-testid=setup-datos]');
    note(`ventana inicial: ${(await page.evaluate(() => [innerWidth, innerHeight])).join('x')}`);
    await page.fill('[data-testid=setup-user]', 'Ana');
    await shot('00-bienvenida');
    const screens = { layout: '00a-ordenar-carpetas', master: '00a-contrasena-maestra', prepare: '00b-preparo-equipo' };
    const onScreen = (name) => shot(screens[name]);
    if (app) {
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, base);
      await page.click('[data-testid=setup-folder]');
      await page.click('[data-testid=setup-create]');
    } else {
      // A packaged build: Windows' folder dialog cannot be answered from here, so the same call the button makes; then
      // the app shows the master password screen of an Orb that has none yet (main.jsx, phase 'master').
      await page.evaluate((folder) => window.orb.setup({ base: folder, assistantName: 'Orbe', userName: 'Ana' }), base);
      await page.reload();
    }
    const seen = await throughStart(page, { ready: '[data-testid=sidebar-home]', onScreen });
    note(`pantallas de bienvenida: ${seen.join(' → ') || 'ninguna'}`);
    if (!seen.includes('master')) note('no salió «Crea tu contraseña maestra»');
    await shot('01c-primer-chat');
    note(`errores en bienvenida: ${errors.join(' | ') || 'ninguno'}`);
    await close();
  }

  // ---- 2. an assistant already created: every view
  const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Alex' });
  writeJson(path.join(home, 'core', 'orb.json'), merge(loadConfig(home), { ui: { tourDone: true } })); // 2.6: no guided tour in the tests
  fs.mkdirSync(path.join(home, 'web', 'webviaproject', 'src'), { recursive: true });
  fs.writeFileSync(path.join(home, 'web', 'webviaproject', 'src', 'index.html'), '<h1>hola</h1>\n');
  const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
  const { app, page, errors, close } = await open(userData);
  const shot = shooter(app, page);
  const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
  // 3.8: a folder made before the first start has no master password yet: «Crea tu contraseña maestra» once.
  await throughStart(page, { ready: '[data-testid=chat-greeting]' });
  // ORB_LANG=en: the same tour in English (the interface and the engine's notices follow config.language).
  if (LANG) { await call('config.save', { patch: { language: LANG } }); await page.reload(); await page.waitForSelector('[data-testid=sidebar-home]'); }
  if (await page.isVisible('text=Preparando tu PC')) { await shot('01-preparo-equipo'); await page.click('text=Continuar'); }
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  const setDark = async (on) => { if (on !== (await dark())) await page.getByRole('button', { name: /claro y oscuro|day and night|light and dark/i }).click(); };
  // The robot at the top goes back to the chat; the professional theme has no robot (nothing drawn): there, a new chat
  // from the list's «+».
  const goChat = async () => {
    if (await page.locator('[data-testid=sidebar-home]').isVisible()) await page.click('[data-testid=sidebar-home]');
    else { await page.click('[data-testid=chats-new]'); await page.click('[data-testid=new-conversation]'); }
  };
  const views = [['sidebar-home', 'chat'], ['nav-tasks', 'tareas'], ['nav-projects', 'proyectos'], ['nav-agents', 'agentes'], ['nav-memories', 'bitacoras'], ['memories-activity', 'actividad'], ['nav-settings', 'ajustes']];
  const SECTIONS = ['general', 'magiclink', 'agentes', 'datos', 'avanzado', 'acerca'];
  for (const theme of ['dia', 'noche']) {
    await setDark(theme === 'noche');
    for (const [nav, name] of views) {
      if (nav === 'sidebar-home') await goChat(); else await page.click(`[data-testid=${nav}]`);
      await shot(`${theme}-${name}`);
      if (theme === 'dia') {
        const wide = await overflow(page);
        if (wide.length) note(`${name}: contenido más ancho que su caja → ${wide.join(' | ')}`);
      }
      if (name === 'ajustes') {
        // each section of the settings window
        for (const id of SECTIONS) {
          await page.click(`[data-testid=settings-nav-${id}]`);
          await shot(`${theme}-ajustes-${id}`);
          if (theme === 'dia') {
            const wide = await overflow(page);
            if (wide.length) note(`ajustes/${id}: contenido más ancho que su caja → ${wide.join(' | ')}`);
          }
        }
        await closeSettings(page, `${theme}/ajustes`);
      }
    }
    // the dialogs and menus of the chat
    await goChat();
    await page.click('[data-testid=project-picker]'); await shot(`${theme}-chat-menu-proyecto`); await page.keyboard.press('Escape');
    await page.waitForSelector('[role=menu]', { state: 'detached' }).catch(() => {}); await page.waitForTimeout(300);
    // 3.6: the list's «+» (Nuevo chat, Nuevo proyecto).
    await page.click('[data-testid=chats-new]').catch(() => note('sin botón «+» en la lista de chats'));
    await shot(`${theme}-menu-nuevo`);
    await page.click('[data-testid=new-conversation]', { timeout: 5000 }).catch(() => note('sin «Nuevo chat» en el menú «+»'));
    await shot(`${theme}-nueva-conversacion`); await page.keyboard.press('Escape');
  }
  // checks and switches in the night theme: their computed colors
  await page.click('[data-testid=nav-settings]');
  const controls = await page.evaluate(() => [...document.querySelectorAll('button[role=checkbox],button[role=switch]')].slice(0, 12).map((b) => {
    const cs = getComputedStyle(b); const label = (b.closest('label,div')?.innerText ?? '').split('\n')[0].slice(0, 40);
    return `${b.getAttribute('role')} ${b.dataset.state} bg=${cs.backgroundColor} border=${cs.borderColor} color=${cs.color} «${label}»`;
  }));
  note(`controles en noche:\n    ${controls.join('\n    ')}`);
  await closeSettings(page, 'controles');

  // ---- 3. the visual themes (Ajustes → Apariencia), each in day and night: the chat, Tareas and the Apariencia section.
  // The professional theme has no robot anywhere.
  for (const skin of SKINS) {
    await call('config.save', { patch: { ui: { skin } } });
    await until(async () => (await page.evaluate(() => document.documentElement.dataset.skin)) === skin, `tema ${skin}`);
    for (const theme of ['dia', 'noche']) {
      await setDark(theme === 'noche');
      await goChat(); await shot(`tema-${skin}-${theme}-chat`);
      await page.click('[data-testid=nav-tasks]'); await shot(`tema-${skin}-${theme}-tareas`);
      await page.click('[data-testid=nav-settings]'); await page.click('[data-testid=settings-nav-general]'); await shot(`tema-${skin}-${theme}-ajustes`);
      if (theme === 'dia') {
        const wide = await overflow(page);
        if (wide.length) note(`tema ${skin}: contenido más ancho que su caja → ${wide.join(' | ')}`);
        const robots = await page.evaluate(() => document.querySelectorAll('.orb').length);
        if (skin === 'profesional' && robots) note(`tema profesional: quedan ${robots} robots en pantalla`);
        if (skin !== 'profesional' && !robots) note(`tema ${skin}: no se ve el robot`);
      }
      await closeSettings(page, `tema ${skin}/${theme}`);
    }
  }
  await call('config.save', { patch: { ui: { skin: SKINS[0] } } });
  await setDark(false);

  // ---- 4. narrow window and a small laptop height
  for (const [w, h, name] of [[420, 860, 'estrecha'], [1280, 640, 'portatil-bajo']]) {
    if (app) await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html')).setContentSize(w, h), [w, h]);
    else await page.setViewportSize({ width: w, height: h });
    for (const [nav, view] of [['sidebar-home', 'chat'], ['nav-tasks', 'tareas'], ['nav-settings', 'ajustes']]) {
      if (w < 700) { await page.getByRole('button', { name: /^(Menú|Menu)$/ }).click(); await page.locator(`[data-testid=${nav}]:visible`).click(); } else if (nav === 'sidebar-home') await goChat(); else await page.click(`[data-testid=${nav}]`);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw > iw + 1) note(`${name}/${view}: se sale por los lados (${sw} > ${iw})`);
      await shot(`${name}-${view}`);
      if (view === 'ajustes') {
        for (const id of ['general', 'agentes', 'acerca']) { await page.click(`[data-testid=settings-nav-${id}]`); await shot(`${name}-ajustes-${id}`); }
        await closeSettings(page, `${name}/ajustes`);
      }
    }
  }
  const state = await call('app.state');
  note(`versión ${state.version}, agentes: ${(await call('agents.status')).map((a) => `${a.id}=${a.installed ? 'instalado' : 'no'}/${a.login ?? '?'}`).join(', ')}`);
  note(`errores de la página: ${errors.join(' | ') || 'ninguno'}`);
  await close();
} catch (error) {
  console.error(`✖ ${error.stack}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'notas.txt'), notes.join('\n'));
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* a file still open: the temp folder stays */ }
}
