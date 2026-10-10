// Exploratory pass over the PACKAGED app (no agents needed): the welcome screen and the first run («Preparando tu PC»),
// every view in day and night, each section of Ajustes, the five visual themes, a narrow window and the settings'
// switches and checks, with screenshots in test-results/explora/ (explora-en/ with ORB_LANG=en) and the page errors
// collected. Not an assertion test: it is for looking at.   ORB_E2E_EXE=dist/win-unpacked/Orb.exe node test/explora.e2e.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHome } from '../src/core/home.mjs';
import { SKINS } from '../src/core/appearance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.ORB_E2E_EXE; // optional: a packaged build instead of the sources
const electronBin = (await import('electron')).default;
const LANG = process.env.ORB_LANG || '';
const OUT = path.join(ROOT, 'test-results', LANG ? `explora-${LANG}` : 'explora'); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-explora-'));
const until = async (fn, what, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`no llegó: ${what}`); };
const notes = [];
const note = (s) => { notes.push(s); console.log(`  · ${s}`); };

async function open(userData) {
  const app = await electron.launch({ executablePath: exe || electronBin, args: exe ? [] : [ROOT], env: { ...process.env, ORB_USER_DATA: userData } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  const close = async () => { await app.close().catch(() => {}); };
  return { app, page, errors, close };
}
// The window's own capture (what the user sees, with the interface zoom and the screen scaling).
const shooter = (app, page) => async (name) => {
  await page.waitForTimeout(500);
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
  // ---- 1. a brand-new PC: the welcome screen and, on Windows, «Preparando tu PC» with the installer (nothing is installed:
  // the list is only looked at, then «Continuar»). The folder dialog is replaced by a fixed answer.
  {
    const userData = path.join(tmp, 'nuevo'); fs.mkdirSync(userData);
    const base = path.join(tmp, 'PrimerPC'); fs.mkdirSync(base);
    const { app, page, errors, close } = await open(userData);
    const shot = shooter(app, page);
    await page.waitForSelector('text=Crear y empezar');
    note(`ventana inicial: ${(await page.evaluate(() => [innerWidth, innerHeight])).join('x')}`);
    await shot('00-bienvenida');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, base);
    await page.getByRole('button', { name: /Elegir ubicación|Choose location/ }).click();
    await until(async () => (await page.locator('[data-testid=setup-target]').innerText()).includes('PrimerPC'), 'carpeta elegida');
    await page.click('text=Crear y empezar');
    const prepared = await page.waitForSelector('[data-testid=prepare-title]', { timeout: 20000 }).catch(() => null);
    if (prepared) {
      await shot('01-preparo-equipo');
      await until(async () => (await page.getByText(/Instalar seleccionados|Todo está instalado|Install selected|Everything is installed/).count()) > 0, 'instalador comprobado', 60000).catch(() => note('el instalador no terminó de comprobar en 60 s'));
      const missing = await page.evaluate(() => [...document.querySelectorAll('label')].filter((l) => l.querySelector('button[role=checkbox]')).map((l) => l.innerText.split('\n')[0]));
      note(`primer arranque, no instalados según la app: ${missing.join(', ') || 'ninguno'}`);
      await shot('01b-preparo-equipo-comprobado');
      const wide = await overflow(page);
      if (wide.length) note(`preparo equipo: contenido más ancho que su caja → ${wide.join(' | ')}`);
      await page.click('text=/^(Continuar|Continue)$/');
    } else note('sin pantalla «Preparando tu PC» (no es Windows o ya se pasó)');
    await page.waitForSelector('[data-testid=nav-chat]', { timeout: 30000 });
    await shot('01c-primer-chat');
    note(`errores en bienvenida: ${errors.join(' | ') || 'ninguno'}`);
    await close();
  }

  // ---- 2. an assistant already created: every view
  const base = path.join(tmp, 'Documentos'); fs.mkdirSync(base);
  const { home } = createHome(base, { assistantName: 'Orb', userName: 'Dani' });
  fs.mkdirSync(path.join(home, 'web', 'webviaproject', 'src'), { recursive: true });
  fs.writeFileSync(path.join(home, 'web', 'webviaproject', 'src', 'index.html'), '<h1>hola</h1>\n');
  const userData = path.join(tmp, 'datos'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'ubicacion.json'), JSON.stringify({ home }));
  const { app, page, errors, close } = await open(userData);
  const shot = shooter(app, page);
  const call = (method, params = {}) => page.evaluate(([m, p]) => window.orb.call(m, p), [method, params]);
  await page.waitForSelector('text=Soy Orb', { timeout: 30000 });
  // ORB_LANG=en: the same tour in English (the interface and the engine's notices follow config.language).
  if (LANG) { await call('config.save', { patch: { language: LANG } }); await page.reload(); await page.waitForSelector('[data-testid=nav-chat]'); }
  if (await page.isVisible('text=Preparando tu PC')) { await shot('01-preparo-equipo'); await page.click('text=Continuar'); }
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  const setDark = async (on) => { if (on !== (await dark())) await page.getByRole('button', { name: /claro y oscuro|day and night|light and dark/i }).click(); };
  const views = [['nav-chat', 'chat'], ['nav-tasks', 'tareas'], ['nav-projects', 'proyectos'], ['nav-agents', 'agentes'], ['nav-logs', 'bitacoras'], ['nav-activity', 'actividad'], ['nav-settings', 'ajustes']];
  const SECTIONS = ['apariencia', 'modelo', 'tareas', 'movil', 'herramientas', 'experto', 'actualizaciones', 'contribuye', 'apps'];
  for (const theme of ['dia', 'noche']) {
    await setDark(theme === 'noche');
    for (const [nav, name] of views) {
      await page.click(`[data-testid=${nav}]`);
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
    await page.click('[data-testid=nav-chat]');
    await page.click('[data-testid=project-picker]'); await shot(`${theme}-chat-menu-proyecto`); await page.keyboard.press('Escape');
    await page.click('[data-testid=new-conversation]').catch(() => note('sin botón nueva conversación visible'));
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
      await page.click('[data-testid=nav-chat]'); await shot(`tema-${skin}-${theme}-chat`);
      await page.click('[data-testid=nav-tasks]'); await shot(`tema-${skin}-${theme}-tareas`);
      await page.click('[data-testid=nav-settings]'); await page.click('[data-testid=settings-nav-apariencia]'); await shot(`tema-${skin}-${theme}-ajustes`);
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
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html')).setContentSize(w, h), [w, h]);
    for (const [nav, view] of [['nav-chat', 'chat'], ['nav-tasks', 'tareas'], ['nav-settings', 'ajustes']]) {
      if (w < 700) { await page.getByRole('button', { name: /^(Menú|Menu)$/ }).click(); await page.locator(`[data-testid=${nav}]:visible`).click(); } else await page.click(`[data-testid=${nav}]`);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw > iw + 1) note(`${name}/${view}: se sale por los lados (${sw} > ${iw})`);
      await shot(`${name}-${view}`);
      if (view === 'ajustes') {
        for (const id of ['apariencia', 'tareas', 'contribuye']) { await page.click(`[data-testid=settings-nav-${id}]`); await shot(`${name}-ajustes-${id}`); }
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
